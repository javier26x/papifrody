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
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 3 });

const db = getFirestore();
const APP_URL = "https://papifrody.web.app";

const BODIES = {
  weigh: "Pésate al despertar y registra el peso 📉",
  suppAM: "Toma tus suplementos de la mañana 💊",
  water: "Hora de agua + electrolitos 💧",
  protein: "¿Vas bien con la proteína de hoy? 🍗 (meta 160–180 g)",
  inject: "Hoy es día de inyección · Mounjaro 💉",
  suppPM: "Suplementos de la noche 🌙",
  log: "¿Ya registraste tu día en frody.body? ✍️"
};

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

exports.sendReminders = onSchedule(
  { schedule: "every 5 minutes", timeZone: "Etc/UTC", retryCount: 0 },
  async () => {
    const now = new Date();
    const snap = await db.collectionGroup("meta").get();
    let usersChecked = 0, pushed = 0;

    for (const doc of snap.docs) {
      if (doc.id !== "reminders") continue; // collectionGroup trae también meta/profile
      const data = doc.data() || {};
      if (!data.master) continue;
      const tokens = Object.keys(data.tokens || {});
      if (!tokens.length) continue;

      usersChecked++;
      const { minutes: nowMin, dateStr, weekday } = localParts(now, data.tz);
      const sentToday = (data.sent && data.sent[dateStr]) || {};
      const due = [];

      (data.items || []).forEach((it) => {
        if (!it || !it.enabled) return;
        if (it.days === "mon" && weekday !== "Mon") return;
        if (sentToday[it.id]) return;
        const m = /^(\d{1,2}):(\d{2})$/.exec(it.time || "");
        if (!m) return;
        const sched = (parseInt(m[1], 10) % 24) * 60 + parseInt(m[2], 10);
        const diff = nowMin - sched;
        if (diff >= 0 && diff < 5) due.push(it); // vencido en esta ventana de 5 min
      });

      if (!due.length) continue;

      const badTokens = new Set();
      for (const it of due) {
        const body = BODIES[it.id] || "Recordatorio frody.body";
        const res = await getMessaging().sendEachForMulticast({
          tokens,
          data: { title: "frody.body", body, tag: "frody-" + it.id, url: APP_URL },
          webpush: {
            fcmOptions: { link: APP_URL },
            headers: { Urgency: "high", TTL: "3600" }
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

      // marca enviados de hoy (reemplaza 'sent' → descarta días anteriores) y
      // limpia tokens muertos. update() reemplaza el campo entero (no fusiona).
      const todaySent = Object.assign({}, sentToday);
      due.forEach((it) => { todaySent[it.id] = true; });
      const update = { sent: { [dateStr]: todaySent } };
      if (badTokens.size) {
        update.tokens = Object.assign({}, data.tokens);
        badTokens.forEach((t) => { delete update.tokens[t]; });
      }
      await doc.ref.update(update);
    }

    logger.info(`sendReminders: ${usersChecked} usuario(s), ${pushed} push enviados`);
    return null;
  }
);
