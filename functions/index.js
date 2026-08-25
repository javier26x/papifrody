// =============================================================================
// frody.body — Cloud Functions
// Envía los recordatorios push (FCM) a su hora, aunque la app esté CERRADA.
// Cloud Scheduler ejecuta sendReminders cada 5 minutos; la función busca los
// recordatorios "vencidos" en esa ventana (en la zona horaria del usuario) y
// manda el push a sus dispositivos.
//
// Datos que escribe el cliente en  users/{uid}/meta/reminders :
//   { master:bool, tz:"America/Santiago", items:[{id,time,enabled,days}],
//     tokens:{ "<fcmToken>": {ua, updatedAt} }, sent:{ "YYYY-MM-DD": {id:true} } }
// =============================================================================
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
// Topes explícitos de costo: aunque algo se dispare, no puede escalar solo.
setGlobalOptions({ region: "us-central1", maxInstances: 3, memory: "256MiB", timeoutSeconds: 120 });

const db = getFirestore();
const APP_URL = "https://papifrody.web.app";
const ALLOWED_EMAIL = "javier.neo@gmail.com";

// respaldo por si un item llega sin 'body' (el cliente normalmente lo manda)
// Sistema v9.2 — los 3 modos metabólicos del día.
const BODIES = {
  despertar: "500 ml de agua, 5 min de sol en los ojos y creatina. Pésate en ayunas ☀️",
  tareg: "Tareg D 160/12.5 💊 — la presión controlada vale más que todo el stack",
  ventana: "Abre la ventana: proteína primero, porción moderada + Ashwagandha 450 mg 🏗️",
  cafeina: "Última cafeína del día ☕ — después de esta hora se la cobras al sueño profundo",
  psyllium: "Psyllium 5 g + vaso grande de agua, AHORA (15 min antes del plato) 🌾",
  almuerzo: "Almuerzo: 30–40 g proteína · orden verde → proteína → carbo. Omega 3 + Zinc (si toca) 🥗",
  caminata: "Caminata 10–15 min 🚶 — el músculo capta glucosa sin insulina. El hack más rentable",
  cena: "Cena liviana proteica + Omega 3 (2ª, con grasa) 🐟",
  cierre: "CIERRE: cocina cerrada. Lávate los dientes 🦷 — de aquí en adelante solo líquidos",
  mag: "Magnesio Bisglicinato 168 mg · 2 cáps 🌙 — GABA → sueño profundo → hormona de crecimiento",
  log: "¿Ya registraste tu día en frody.body? ✍️",
  pantallas: "Pantallas fuera, luz cálida 📵 — la partida de las 22:30 se paga en hambre mañana",
  cama: "A la cama. Pieza 17–19 °C, dormido a las 23:00 🛏️",
  inject: "Hoy es día de inyección · Mounjaro 💉",
  mealprep: "Domingo: meal prep + caja de emergencia llena 🥡 — decidir con hambre es perder"
};
const DOW_CODE = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };
// avisos de fármaco: quedan fijos en pantalla hasta que los descartes
const IMPORTANT = new Set(["tareg", "mag", "inject"]);

// hora/fecha/día-de-semana locales en la zona horaria del usuario
function localParts(date, tz) {
  let p;
  try {
    p = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false
    }).formatToParts(date);
  } catch (e) {
    p = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false
    }).formatToParts(date);
  }
  const o = {};
  for (const x of p) o[x.type] = x.value;
  const hour = parseInt(o.hour, 10) % 24; // en-CA puede dar "24" a medianoche
  return {
    minutes: hour * 60 + parseInt(o.minute, 10),
    dateStr: `${o.year}-${o.month}-${o.day}`,
    weekday: o.weekday // "Mon", "Tue", ...
  };
}

// Cron alineado a :00/:15/:30/:45. Todos los recordatorios caen en :00 o :30,
// así que la puntualidad es la misma que con "cada 5 min" pero con 1/3 de las
// corridas (menos invocaciones, lecturas y escrituras = más margen gratis).
exports.sendReminders = onSchedule(
  { schedule: "0,15,30,45 * * * *", timeZone: "Etc/UTC", retryCount: 2 },
  async () => {
    const now = new Date();
    const snap = await db.collectionGroup("meta").get();
    let usersChecked = 0, pushed = 0;

    for (const doc of snap.docs) {
      if (doc.id !== "reminders") continue; // collectionGroup trae también meta/profile
      // aislamiento: un usuario/doc con datos malos NO debe tumbar toda la corrida
      try {
        const data = doc.data() || {};
        if (!data.master) continue;
        usersChecked++;
        const tokens = Object.keys(data.tokens || {});
        const { minutes: nowMin, dateStr, weekday } = localParts(now, data.tz);
        const sentToday = (data.sent && data.sent[dateStr]) || {};
        const due = [];

        if (tokens.length) {
          (data.items || []).forEach((it) => {
            if (!it || !it.enabled) return;
            if (it.days && it.days !== "daily" && DOW_CODE[it.days] && weekday !== DOW_CODE[it.days]) return;
            if (sentToday[it.id]) return;
            const m = /^(\d{1,2}):(\d{2})$/.exec(it.time || "");
            if (!m) return;
            const sched = (parseInt(m[1], 10) % 24) * 60 + parseInt(m[2], 10);
            const diff = nowMin - sched;
            // ventana de 40 min: aguanta DOS corridas fallidas seguidas (cron cada
            // 15 min) y aun así el recordatorio sale; 'sent' evita duplicados.
            if (diff >= 0 && diff < 40) due.push(it);
          });
        }

        const badTokens = new Set();
        for (const it of due) {
          const body = it.body || BODIES[it.id] || "Recordatorio frody.body";
          const res = await getMessaging().sendEachForMulticast({
            tokens,
            data: { id: it.id }, // para dedupe por-id en primer plano
            webpush: {
              notification: {
                title: "frody.body", body,
                icon: APP_URL + "/icon-192.png", badge: APP_URL + "/icon-192.png",
                tag: "frody-" + it.id,
                requireInteraction: IMPORTANT.has(it.id) // avisos clave quedan fijos hasta descartarlos
              },
              fcmOptions: { link: APP_URL },
              headers: { Urgency: "high", TTL: "10800" } // 3 h: llega aunque estés offline un rato
            }
          });
          pushed += res.successCount;
          res.responses.forEach((r, i) => {
            if (!r.success) {
              const code = r.error && r.error.code;
              if (code === "messaging/registration-token-not-registered" ||
                  code === "messaging/invalid-argument" ||
                  code === "messaging/invalid-registration-token") {
                badTokens.add(tokens[i]);
              }
            }
          });
        }

        // heartbeat + enviados de hoy + limpieza de tokens muertos (SIEMPRE que
        // master=true, aunque no haya due: así el cliente sabe que el cron vive).
        const todaySent = Object.assign({}, sentToday);
        due.forEach((it) => { todaySent[it.id] = true; });
        const update = { lastServerRun: Date.now(), sent: { [dateStr]: todaySent } };
        if (badTokens.size) {
          update.tokens = Object.assign({}, data.tokens);
          badTokens.forEach((t) => { delete update.tokens[t]; });
        }
        await doc.ref.update(update);
      } catch (e) {
        logger.error("sendReminders user loop:", e);
      }
    }

    logger.info(`sendReminders: ${usersChecked} usuario(s), ${pushed} push enviados`);
    return null;
  }
);

// Notificación de prueba a demanda (botón en la app). Solo la cuenta autorizada.
exports.sendTestPush = onCall(async (req) => {
  const auth = req.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Inicia sesión.");
  if (auth.token.email !== ALLOWED_EMAIL || auth.token.email_verified !== true) {
    throw new HttpsError("permission-denied", "Cuenta no autorizada.");
  }
  const ref = db.doc(`users/${auth.uid}/meta/reminders`);
  const snap = await ref.get();
  const tokensMap = (snap.exists ? snap.data() : {}).tokens || {};
  const tokens = Object.keys(tokensMap);
  if (!tokens.length) {
    throw new HttpsError("failed-precondition", "No hay dispositivos registrados. Activa las notificaciones primero.");
  }
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    webpush: {
      notification: { title: "frody.body", body: "✅ Notificación de prueba — ¡el push funciona!", icon: APP_URL + "/icon-192.png", badge: APP_URL + "/icon-192.png", tag: "frody-test" },
      fcmOptions: { link: APP_URL },
      headers: { Urgency: "high", TTL: "600" }
    }
  });
  // poda tokens muertos
  const bad = {};
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-argument" ||
          code === "messaging/invalid-registration-token") bad[tokens[i]] = true;
    }
  });
  if (Object.keys(bad).length) {
    const kept = Object.assign({}, tokensMap);
    Object.keys(bad).forEach((t) => delete kept[t]);
    await ref.update({ tokens: kept });
  }
  logger.info(`sendTestPush: ${res.successCount} ok, ${res.failureCount} fallidos`);
  return { sent: res.successCount, failed: res.failureCount };
});
