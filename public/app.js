// =============================================================================
// frody.body — registro diario (versión Firebase)
//
// Funciona en dos modos, de forma transparente:
//   • LOCAL  → localStorage (igual que el archivo original). Es el modo por
//              defecto y también el fallback cuando no hay sesión o no hay red.
//   • CLOUD  → Firestore, por usuario, con sync en vivo entre dispositivos y
//              persistencia offline. Se activa al entrar con Google.
//
// El SDK de Firebase se carga con import() dinámico SOLO si hay config, así la
// app sigue abriendo aunque no haya internet ni Firebase configurado.
// =============================================================================
import { firebaseConfig, isConfigured, VAPID_KEY, pushConfigured } from "./firebase-config.js";

"use strict";

// ---------- constantes ----------
// app personal: solo esta cuenta puede entrar (reforzado también en firestore.rules)
const ALLOWED_EMAIL = "javier.neo@gmail.com";
const PREFIX = "frodybody:";
const PROFILE_KEY = "frodybody:profile";
const FB_VERSION = "10.12.2";
const FB_CDN = "https://www.gstatic.com/firebasejs/" + FB_VERSION;
const DEFAULT_PROFILE = { startWeight: 132.9, goal: 100, doneVitD: false, doneControl: false };
const CRIT_KEYS = ["doneVitD", "doneControl"];

// =============================================================================
// SISTEMA v9.2 — el día en 3 modos metabólicos
// Cada pieza está puesta donde su mecanismo rinde más. 'why' es el porqué: se
// despliega al tocar el ítem, para cuando dudes de algo a las 3 semanas.
//   kind "supp"   → cuenta en el contador de suplementos
//   kind "action" → ritual/protocolo (también se marca, no cuenta como supl.)
//   optional      → ciclado (Zinc): no exige marcarlo
//   paused        → congelado a la espera de la doctora
// =============================================================================
const MODES = {
  burn: {
    tag: "modo 1 · 07:30 – 10:00", name: "🔥 Quema", color: "#F2A93B",
    why: "En ayuno la insulina está en su punto más bajo del día: la grasa fluye y se oxida. Todo lo de esta franja existe para aprovechar o alargar ese estado."
  },
  build: {
    tag: "modo 2 · 10:00 – 18:00", name: "🏗️ Construcción", color: "#5BC08A",
    why: "La ventana. Ya no es quemar: es meter nutrientes sin disparar la insulina y sin pasar hambre después. Acá se fabrica la saciedad del día y se protege el músculo."
  },
  repair: {
    tag: "modo 3 · 18:00 – 23:00", name: "🌙 Reparación", color: "#7C83DB",
    why: "Se prepara la máquina que trabaja mientras duermes: la hormona de crecimiento nocturna preserva músculo y moviliza grasa. Esta franja decide el hambre de mañana."
  }
};

const PLAN = [
  // ---------------------------- 🔥 QUEMA ----------------------------
  { id: "aguaAM", mode: "burn", kind: "action", time: "07:30", name: "500 ml de agua", dose: "500 ml", slot: "lo primero",
    icon: "local_drink", color: "#2bb7d9",
    why: "Vienes de 8+ h sin líquido. La sed de la mañana se disfraza de hambre y de fatiga — rehidratar primero ordena las señales del día." },
  { id: "sol", mode: "burn", kind: "action", time: "07:30", name: "Sol en los ojos", dose: "5 min", slot: "ventana, balcón o vereda",
    icon: "wb_sunny", color: "#F2A93B",
    why: "Es una inversión a 15 horas: la luz matinal fija el reloj circadiano y programa que la melatonina suba sola cerca de las 23:00. Sin sol AM la noche se corre, y con ella la grelina y la leptina de mañana. El sol de la mañana es la primera pieza del sueño de la noche." },
  { id: "cafe", mode: "burn", kind: "action", time: "07:30", name: "Café o té verde", dose: "ventana óptima", slot: "corte 13:00",
    icon: "coffee", color: "#8b5cf6",
    why: "La cafeína (+ catequinas del té verde) moviliza grasa, pero la insulina alta bloquea que se queme. En ayuno la insulina está en el piso: la grasa liberada sí se oxida. Después de las 13:00 juega en contra — vida media de 6 h, roba sueño profundo y eso es más hambre mañana. Un té a las 16:00 literalmente te da más hambre al día siguiente." },
  { id: "movAM", mode: "burn", kind: "action", time: "07:30", name: "Moverse en ayunas", dose: "caminar", slot: "pasillo, escaleras, lo que haya",
    icon: "directions_walk", color: "#23a56a",
    why: "La grasa que la cafeína movilizó se usa si te mueves. Cafeína + ayuno + movimiento es la única pila de tres piezas con sinergia real. Cuando vuelva la bici en primavera, este bloque se potencia solo." },
  { id: "creatina", mode: "burn", kind: "supp", time: "07:30", name: "Creatina", dose: "5 g", slot: "la excepción horaria",
    icon: "fitness_center", color: "#ef6b53",
    why: "Funciona por saturación crónica, no por timing: la hora da lo mismo, lo que mata su efecto es saltársela. Va en la mañana solo para no olvidarla. Aviso: puede subir 0,5–1 kg de agua intramuscular las primeras semanas — no es grasa, no te asustes en la pesa." },
  { id: "tareg", mode: "burn", kind: "supp", time: "08:00", name: "Tareg D 160/12.5", dose: "1 comp", slot: "diario · permanente",
    icon: "cardiology", color: "#dd6a56",
    why: "La presión controlada es prevención directa de infarto y derrame: vale más que todo el stack de suplementos junto. Pendiente con la doctora: ajuste del diurético ahora sin fármaco." },

  // ------------------------ 🏗️ CONSTRUCCIÓN ------------------------
  { id: "ventana", mode: "build", kind: "action", time: "10:00", name: "Abrir ventana · proteína primero", dose: "porción moderada", slot: "no el plato fuerte",
    icon: "restaurant", color: "#5BC08A",
    why: "Proteína primero dispara GLP-1 y PYY, las mismas hormonas de saciedad que imitaba el Mounjaro, gratis. Y gasta 25–30% de sus propias calorías en digerirse (el carbo solo 5–10%). Moderada porque una comida gigante tras 16 h de ayuno dispara el reflujo: el plato fuerte va a las 13:30." },
  { id: "ashwa", mode: "build", kind: "supp", time: "10:00", name: "Ashwagandha KSM-66", dose: "450 mg · 1 cáp", slot: "antes del peak laboral",
    icon: "spa", color: "#8b5cf6",
    why: "Amortigua el pico de cortisol de la jornada laboral que viene. Cortisol crónico alto = grasa visceral + antojos de carbo, y el estrés del trabajo es tu gatillo de colapso documentado. Vigilar: si la fatiga persiste, es la primera a pausar." },
  { id: "cafeFin", mode: "build", kind: "action", time: "13:00", name: "Última cafeína", dose: "frontera", slot: "corte duro",
    icon: "no_drinks", color: "#dd6a56",
    why: "Es la frontera entre el modo Quema y el modo Reparación de la noche. Todo lo que tomes después de esta hora se lo cobras al sueño profundo — y el sueño profundo regula el hambre de mañana." },
  { id: "psyllium", mode: "build", kind: "supp", time: "13:15", name: "Psyllium + vaso grande", dose: "5 g", slot: "15 min ANTES de comer",
    icon: "grass", color: "#23a56a",
    why: "Forma un gel que estira el estómago (saciedad mecánica: llegas a comer con medio trabajo hecho) y ralentiza la glucosa de ESA comida. Tomado suelto a las 16:00 pierde las dos funciones. Es tu pieza más parecida al efecto del fármaco. Separado 1–2 h de los remedios." },
  { id: "almuerzo", mode: "build", kind: "action", time: "13:30", name: "Almuerzo · 30–40 g proteína", dose: "+ verde en volumen", slot: "orden: verde → proteína → carbo",
    icon: "lunch_dining", color: "#5BC08A",
    why: "30–40 g es la dosis que satura la síntesis muscular: 80 g de una no rinde el doble, repartir gana. El orden importa — la fibra primero hace de barrera física; el mismo plato comido al revés genera hasta un tercio más de pico de glucosa. Cero costo, puro orden." },
  { id: "omega1", mode: "build", kind: "supp", time: "13:30", name: "Omega 3 (1ª)", dose: "1.200 mg", slot: "con grasa",
    icon: "set_meal", color: "#e0922a",
    why: "Liposoluble: con grasa se absorbe 2–3× más. El rol oculto del omega: tu inflamación (PCR, ferritina) bloquea la señal de la leptina — el cerebro deja de 'ver' la grasa que tienes y sigue pidiendo comida. Bajar inflamación = recuperar el termostato de saciedad." },
  { id: "zinc", mode: "build", kind: "supp", time: "13:30", name: "Zinc Picolinato", dose: "50 mg", slot: "3 días sí / 4 no",
    icon: "medication", color: "#2bb7d9", optional: true,
    why: "Apoya la testosterona (267, piso del rango) sin vaciar el cobre. Ciclado porque a diario lo agota en meses. La testo sube sola al bajar grasa: esto solo acompaña." },
  { id: "vitd", mode: "build", kind: "supp", time: "13:30", name: "Vit D3 Swanson", dose: "5.000 UI", slot: "⚠ congelada · pendiente doctora",
    icon: "wb_twilight", color: "#9aa0ac", paused: true,
    why: "Subir tu D de 23,5 a 40–60 (insulina, testosterona, ánimo). CONGELADA hasta confirmar con la Dra. Arancibia que la carga de Bonal D terminó y que ella aprueba la mantención. No la retomes por tu cuenta." },
  { id: "caminata", mode: "build", kind: "action", time: "14:00", name: "Caminata post-almuerzo", dose: "10–15 min", slot: "ventana: 30–60 min tras comer",
    icon: "directions_walk", color: "#23a56a",
    why: "El músculo en movimiento capta glucosa SIN necesitar insulina (transportadores GLUT4). Es atacar tu HOMA 4.0 por una puerta lateral que no depende del páncreas. Caminar a las 17:00 por el almuerzo de las 13:30 ya no hace ese trabajo: la glucosa sube en los primeros 30–60 min. El hack más rentable de todo el sistema." },
  { id: "whey", mode: "build", kind: "supp", time: "", name: "Whey si falta proteína", dose: "1–2 scoops", slot: "tarde · cerrar la brecha",
    icon: "blender", color: "#5566F0",
    why: "Herramienta, no comida. Si a media tarde vas corto para los 160–180 g, un scoop cierra la brecha sin cocinar. La comida real sigue siendo la base (80% de tu proteína)." },
  { id: "cena", mode: "build", kind: "action", time: "17:30", name: "Cena liviana proteica", dose: "temprano", slot: "última comida",
    icon: "dinner_dining", color: "#5BC08A",
    why: "Crononutrición: tu sensibilidad a la insulina cae en la noche — la misma comida a las 21:00 genera más glucosa e insulina que a las 13:00. Comer temprano no es disciplina, es aprovechar que el cuerpo procesa mejor de día. Y liviano protege contra el reflujo nocturno." },
  { id: "omega2", mode: "build", kind: "supp", time: "17:30", name: "Omega 3 (2ª)", dose: "1.200 mg", slot: "con grasa",
    icon: "set_meal", color: "#e0922a",
    why: "Segunda dosis del día. Objetivo: bajar triglicéridos (158) e inflamación. Repartir en dos tomas con comida mejora la absorción frente a una sola dosis grande." },
  { id: "cierre", mode: "build", kind: "action", time: "18:00", name: "CIERRE · lávate los dientes", dose: "cocina cerrada", slot: "el corte del día",
    icon: "dentistry", color: "#F2A93B",
    why: "Señal conductual física de 'cocina cerrada'. El sabor a menta + el ritual cortan el picoteo automático de la noche, tu franja de mayor riesgo. Suena tonto; funciona porque no depende de voluntad, depende de hábito." },

  // ------------------------- 🌙 REPARACIÓN -------------------------
  { id: "liquidos", mode: "repair", kind: "action", time: "18:00", name: "Solo líquidos", dose: "agua · jengibre · manzanilla", slot: "emergencia: 1 huevo o whey",
    icon: "emoji_food_beverage", color: "#4FB3A6",
    why: "Jengibre y no cualquier té: es procinético, acelera el vaciamiento del estómago — justo lo contrario de la menta, que relaja el esfínter y empeora la acidez. Es TU té de la noche: anti-acidez, sin cafeína y con evidencia real." },
  { id: "mag", mode: "repair", kind: "supp", time: "21:00", name: "Magnesio Bisglicinato", dose: "168 mg · 2 cáps", slot: "el freno del sistema nervioso",
    icon: "bedtime", color: "#6f7df6",
    why: "Potencia el GABA para entrar a sueño profundo. El dato clave: la hormona de crecimiento — que preserva músculo y moviliza grasa nocturna — se libera casi toda en el sueño profundo de la PRIMERA mitad de la noche. Acostarse a las 23:00 no es igual que dormir 8 h desde la 1: esa ventana de GH se pierde y no se recupera. Si suelta el estómago, bajar a 1 cáp." },
  { id: "pantallas", mode: "repair", kind: "action", time: "22:00", name: "Pantallas fuera · luz cálida", dose: "sin azul", slot: "gaming antes de las 21:00 o no va",
    icon: "phonelink_off", color: "#7C83DB",
    why: "La luz azul frena la melatonina que el sol de las 7:30 programó: son los dos extremos del mismo circuito. Y el gaming competitivo suma cortisol justo cuando el cuerpo necesita bajarlo. No es castigo: es que la partida de las 22:30 se paga en grelina mañana." },
  { id: "cama", mode: "repair", kind: "action", time: "22:30", name: "A la cama · pieza 17–19 °C", dose: "dormido 23:00", slot: "8,5 h hasta las 07:30",
    icon: "hotel", color: "#5566F0",
    why: "Doble función del frío: activa algo de grasa parda (gasto extra) y, más importante, la caída de temperatura corporal es la señal fisiológica de entrada al sueño profundo. Pieza fría = te duermes más rápido y más profundo." }
];
const TOGGLES = ["injected", "sunAM", "bike", "strength", "cleanFood", "noLiquidSugar", "stressOK"];
const DAY_FIELDS = ["weight", "waist", "injected", "gi", "protein", "water", "sleep",
  "sunAM", "bike", "strength", "cleanFood", "noLiquidSugar", "stressOK", "supps", "notes"];

// ---------- date helpers ----------
function ymd(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const DOW = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MON = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function isMonday(d) { return d.getDay() === 1; }

let today = new Date(); today.setHours(0, 0, 0, 0);
let cursor = new Date(today);

// ---------- estado global ----------
const state = {
  mode: "local",            // 'local' | 'cloud'
  records: {},              // { 'YYYY-MM-DD': recObj }
  profile: { ...DEFAULT_PROFILE },
  rec: null,                // copia de trabajo del día en cursor
  user: null,               // usuario Firebase (o null)
  online: navigator.onLine,
  migrationChecked: false,  // ¿ya evaluamos si hay datos locales que migrar?
  showMigration: false      // ¿mostrar el CTA de migración ahora mismo?
};

// =============================================================================
// modelo de registro
// =============================================================================
function blank() {
  const s = {};
  PLAN.forEach((x) => { s[x.id] = false; });
  return {
    weight: "", waist: "", injected: false, gi: 0, protein: 0, water: 0, sleep: "",
    sunAM: false, bike: false, strength: false, cleanFood: false,
    noLiquidSugar: false, stressOK: false, supps: s, notes: ""
  };
}

// Convierte cualquier objeto crudo (localStorage o Firestore) en un registro
// completo y saneado, ignorando campos extra (p. ej. updatedAt).
// number-o-vacío: devuelve "" o un número finito (nunca NaN)
function cleanNum(v) {
  if (v === "" || v == null) return "";
  const n = Number(v);
  return isFinite(n) ? n : "";
}

function normalize(o) {
  const b = blank();
  if (!o || typeof o !== "object") return b;
  for (const k in b) {
    if (k === "supps") {
      for (const s in b.supps) {
        if (o.supps && typeof o.supps === "object" && s in o.supps) b.supps[s] = !!o.supps[s];
      }
    } else if (k in o && o[k] != null) {
      b[k] = o[k];
    }
  }
  // saneo de tipos/rangos: cumple firestore.rules y evita que un import/migración
  // con un dato sucio (gi fuera de 0-10, notes gigante, NaN) rechace la escritura.
  TOGGLES.forEach((f) => { b[f] = !!b[f]; });
  b.gi = Math.min(10, Math.max(0, Math.round(Number(b.gi) || 0)));
  b.protein = Math.max(0, Math.round(Number(b.protein) || 0));
  b.water = Math.max(0, Math.round(Number(b.water) || 0));
  b.weight = cleanNum(b.weight);
  b.waist = cleanNum(b.waist);
  b.sleep = cleanNum(b.sleep);
  if (typeof b.notes !== "string") b.notes = b.notes == null ? "" : String(b.notes);
  if (b.notes.length > 4000) b.notes = b.notes.slice(0, 4000);
  return b;
}

function recsEqual(a, b) {
  return JSON.stringify(stripForCompare(a)) === JSON.stringify(stripForCompare(b));
}
function stripForCompare(r) {
  const c = normalize(r);
  return c; // ya excluye updatedAt y normaliza tipos
}

// =============================================================================
// score
// =============================================================================
// Score v9.2: mide el sistema, no la fuerza de voluntad.
// Nota: la bici vuelve en primavera — hasta entonces "moverse en ayunas" cumple
// esa casilla, para que el 100% sea alcanzable hoy y no una meta imposible.
function scoreOf(r) {
  const s = r.supps || {};
  const checks = [
    (Number(r.protein) || 0) >= 160,                   // meta 160–180 g
    (Number(r.water) || 0) >= 8,
    (parseFloat(r.sleep) || 0) >= 7,
    !!(r.sunAM || s.sol),                              // luz matinal → melatonina de la noche
    !!(r.bike || s.movAM),                             // movimiento en ayunas (bici cuando vuelva)
    !!r.strength,
    !!r.cleanFood,
    !!r.noLiquidSugar,
    !!r.stressOK,
    !!(s.creatina && s.mag && (s.omega1 || s.omega2)), // suplementos clave del día
    !!s.caminata,                                      // el hack más rentable del sistema
    !!s.cierre                                         // cocina cerrada 18:00
  ];
  const done = checks.filter(Boolean).length;
  return { done, total: checks.length };
}
function scorePct(r) { const s = scoreOf(r); return Math.round((s.done / s.total) * 100); }

// =============================================================================
// helpers DOM
// =============================================================================
const $ = (id) => document.getElementById(id);

// =============================================================================
// STORAGE: local backend (localStorage con fallback a memoria)
// =============================================================================
const local = (function () {
  const mem = {};
  let hasLS = false;
  try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); hasLS = true; } catch (e) {}
  return {
    available: hasLS,
    get(k) { if (hasLS) { try { return localStorage.getItem(k); } catch (e) {} } return k in mem ? mem[k] : null; },
    set(k, v) { if (hasLS) { try { localStorage.setItem(k, v); return; } catch (e) {} } mem[k] = v; },
    del(k) { if (hasLS) { try { localStorage.removeItem(k); return; } catch (e) {} } delete mem[k]; },
    keys() { if (hasLS) { try { return Object.keys(localStorage); } catch (e) {} } return Object.keys(mem); }
  };
})();

function localLoadAll() {
  const recs = {};
  local.keys().forEach((k) => {
    if (k.indexOf(PREFIX) === 0 && k !== PROFILE_KEY) {
      try { recs[k.slice(PREFIX.length)] = normalize(JSON.parse(local.get(k))); } catch (e) {}
    }
  });
  state.records = recs;
  const praw = local.get(PROFILE_KEY);
  state.profile = praw ? sanitizeProfile(JSON.parse(praw)) : { ...DEFAULT_PROFILE };
}
function localSaveDay(date, rec) {
  const payload = { ...rec, updatedAt: Date.now() };
  local.set(PREFIX + date, JSON.stringify(payload));
}
function localSaveProfile(p) { local.set(PROFILE_KEY, JSON.stringify(p)); }

function sanitizeProfile(p) {
  const out = { ...DEFAULT_PROFILE };
  if (p && typeof p === "object") {
    if (isFinite(p.startWeight)) out.startWeight = Number(p.startWeight);
    if (isFinite(p.goal)) out.goal = Number(p.goal);
    CRIT_KEYS.forEach((k) => { out[k] = !!p[k]; });
  }
  return out;
}

// =============================================================================
// STORAGE: cloud backend (Firestore) — se carga bajo demanda
// =============================================================================
const cloud = {
  ready: false,
  fb: null,          // módulos firestore + auth + refs
  unsubDays: null,
  unsubProfile: null
};

async function loadFirebase() {
  if (cloud.fb) return cloud.fb;
  const [appMod, authMod, fsMod, msgMod, fnMod] = await Promise.all([
    import(FB_CDN + "/firebase-app.js"),
    import(FB_CDN + "/firebase-auth.js"),
    import(FB_CDN + "/firebase-firestore.js"),
    import(FB_CDN + "/firebase-messaging.js").catch(() => null), // opcional (push)
    import(FB_CDN + "/firebase-functions.js").catch(() => null)  // opcional (callable de prueba)
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  // Persistencia offline multi-pestaña (cache local que se sincroniza al volver la red).
  let db;
  try {
    db = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() })
    });
  } catch (e) {
    // si ya estaba inicializado o el navegador no soporta el cache persistente
    db = fsMod.getFirestore(app);
  }
  cloud.fb = { appMod, authMod, fsMod, msgMod, fnMod, app, auth, db };
  return cloud.fb;
}

// =============================================================================
// PUSH (FCM) — notificaciones que llegan con la app CERRADA (vía Cloud Functions)
// reminders.js maneja la UI; aquí registramos el token y subimos la config al
// servidor. window.frodyPush es el puente entre ambos.
// =============================================================================
const push = { msg: null, bound: false };

async function enablePush() {
  if (!pushConfigured() || state.mode !== "cloud" || !state.user) return false;
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  try {
    const fb = await loadFirebase();
    if (!fb.msgMod || !(await fb.msgMod.isSupported())) return false;
    if (!push.msg) push.msg = fb.msgMod.getMessaging(fb.app);
    const token = await fb.msgMod.getToken(push.msg, { vapidKey: VAPID_KEY });
    if (!token) return false;
    await fb.fsMod.setDoc(
      fb.fsMod.doc(fb.db, "users", state.user.uid, "meta", "reminders"),
      { tokens: { [token]: { ua: navigator.userAgent.slice(0, 180), updatedAt: Date.now() } } },
      { merge: true }
    );
    window.frodyPush.active = true;
    try { localStorage.setItem("frody:push-active", "1"); } catch (e) {} // recuerda entre sesiones (evita duplicado local al abrir)
    bindForegroundPush(fb);
    return true;
  } catch (e) {
    console.warn("enablePush:", e);
    window.frodyPush.active = false;
    try { localStorage.removeItem("frody:push-active"); } catch (e2) {}
    return false;
  }
}

function bindForegroundPush(fb) {
  if (push.bound || !push.msg || !fb.msgMod) return;
  push.bound = true;
  fb.msgMod.onMessage(push.msg, (payload) => {
    // en primer plano el navegador NO despliega solo: lo mostramos nosotros.
    const n = (payload && (payload.notification || payload.data)) || {};
    const id = (payload && payload.data && payload.data.id) || "";
    const body = n.body || "";
    try {
      if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker) {
        navigator.serviceWorker.ready.then((reg) => reg.showNotification(n.title || "frody.body", {
          body: body, icon: "icon-192.png", badge: "icon-192.png", tag: id ? "frody-" + id : "frody", data: { url: "./" }
        })).catch(() => {});
      }
    } catch (e) {}
    if (body) toast(body, "info");
  });
}

// reminders.js llama esto cuando cambias horarios/toggles: deja al servidor la
// config (con tu zona horaria) sin tocar tokens/sent.
async function syncPushConfig(cfg) {
  if (state.mode !== "cloud" || !state.user) return;
  try {
    const fb = await loadFirebase();
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";
    const items = (cfg.items || []).map((it) => ({ id: it.id, time: it.time, enabled: !!it.enabled, days: it.days || "daily", body: it.body || "" }));
    await fb.fsMod.setDoc(
      fb.fsMod.doc(fb.db, "users", state.user.uid, "meta", "reminders"),
      { master: !!cfg.master, tz, items },
      { merge: true }
    );
  } catch (e) { console.warn("syncPushConfig:", e); }
}

// lee la config de recordatorios del servidor (para que un dispositivo nuevo
// adopte lo configurado en otro, en vez de pisarlo).
async function readPushConfig() {
  if (state.mode !== "cloud" || !state.user) return null;
  try {
    const fb = await loadFirebase();
    const snap = await fb.fsMod.getDoc(fb.fsMod.doc(fb.db, "users", state.user.uid, "meta", "reminders"));
    if (!snap.exists()) return null;
    const d = snap.data() || {};
    return {
      master: !!d.master,
      items: Array.isArray(d.items) ? d.items.map((it) => ({ id: it.id, time: it.time, enabled: !!it.enabled })) : null,
      lastServerRun: typeof d.lastServerRun === "number" ? d.lastServerRun : 0
    };
  } catch (e) { console.warn("readPushConfig:", e); return null; }
}

// envía una notificación de prueba a demanda (llama a la Cloud Function)
async function testPush() {
  if (state.mode !== "cloud" || !state.user) { toast("Inicia sesión primero", "err"); return false; }
  try {
    const fb = await loadFirebase();
    if (!fb.fnMod) { toast("Funciones no disponibles", "err"); return false; }
    const fns = fb.fnMod.getFunctions(fb.app, "us-central1");
    const call = fb.fnMod.httpsCallable(fns, "sendTestPush");
    const r = await call();
    const sent = (r && r.data && r.data.sent) || 0;
    toast(sent ? "Prueba enviada a " + sent + " dispositivo(s) ✓" : "No se pudo enviar", sent ? "info" : "err");
    return sent > 0;
  } catch (e) {
    console.warn("testPush:", e);
    const msg = (e && e.message) || "";
    toast(/dispositivos registrados/i.test(msg) ? "Activa las notificaciones primero" : "Error al enviar la prueba", "err");
    return false;
  }
}

window.frodyPush = {
  active: false,
  available: function () { return pushConfigured(); },
  enable: enablePush,
  syncConfig: syncPushConfig,
  readConfig: readPushConfig,
  test: testPush
};

// =============================================================================
// AUTH
// =============================================================================
let pendingGateMsg = "";   // mensaje a mostrar en el gate tras un signOut forzado

async function initAuth() {
  if (!isConfigured()) { lockGate({ msg: "Falta configurar Firebase en firebase-config.js." }); return; }
  lockGate({ loading: true });
  try {
    const { authMod, auth } = await loadFirebase();
    await authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
    // completa el login si venimos de un signInWithRedirect (y surfacea sus errores)
    authMod.getRedirectResult(auth).catch((e) => { console.error("redirect result:", e); });
    authMod.onAuthStateChanged(auth, handleAuthUser);
  } catch (e) {
    console.error("Firebase no se pudo iniciar:", e);
    lockGate({ err: "No se pudo conectar con Firebase. Revisa tu conexión y reintenta." });
  }
}

// decide acceso: solo la cuenta autorizada entra; cualquier otra se desconecta
async function handleAuthUser(user) {
  if (!user) {
    detachCloud();
    state.user = null;
    lockGate({ msg: pendingGateMsg });
    pendingGateMsg = "";
    renderAuthUI();
    return;
  }
  if (user.email !== ALLOWED_EMAIL || !user.emailVerified) {
    pendingGateMsg = "Esta es una app privada. La cuenta " + (user.email || "elegida") + " no tiene acceso.";
    try { const { authMod, auth } = await loadFirebase(); await authMod.signOut(auth); }
    catch (e) { console.error(e); lockGate({ err: pendingGateMsg }); pendingGateMsg = ""; }
    return; // el signOut dispara handleAuthUser(null), que muestra el mensaje
  }
  // cuenta autorizada
  pendingGateMsg = "";
  unlockGate();
  if (state.mode !== "cloud" || !state.user || state.user.uid !== user.uid) enterCloudMode(user);
  renderAuthUI();
}

async function signIn() {
  lockGate({ loading: true, loadingTxt: "Conectando con Google…" });
  try {
    const { authMod, auth } = await loadFirebase();
    const provider = new authMod.GoogleAuthProvider();
    // sugiere la cuenta correcta y obliga a elegir cuenta
    provider.setCustomParameters({ login_hint: ALLOWED_EMAIL, prompt: "select_account" });
    await authMod.signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    if (e && e.code === "auth/popup-blocked") {
      try {
        const { authMod, auth } = await loadFirebase();
        const p = new authMod.GoogleAuthProvider();
        p.setCustomParameters({ login_hint: ALLOWED_EMAIL, prompt: "select_account" });
        await authMod.signInWithRedirect(auth, p);
        return;
      } catch (e2) { console.error(e2); }
    }
    // volver a mostrar el botón (a menos que el usuario solo cerró el popup)
    lockGate({ msg: (e && (e.code === "auth/cancelled-popup-request" || e.code === "auth/popup-closed-by-user")) ? "" : "No se pudo entrar. Reintenta." });
  }
}

async function doSignOut() {
  try {
    const { authMod, auth } = await loadFirebase();
    await authMod.signOut(auth);
  } catch (e) { console.error(e); }
}

// ---------- gate de login ----------
function lockGate(opts) {
  opts = opts || {};
  document.body.classList.add("locked");
  const gate = $("gate"); gate.hidden = false;
  const btn = $("gateSignIn"); const msg = $("gateMsg");
  msg.classList.toggle("err", !!opts.err);
  if (opts.loading) {
    btn.hidden = true;
    msg.textContent = opts.loadingTxt || "Verificando sesión…";
  } else {
    btn.hidden = false;
    msg.textContent = opts.err || opts.msg || "";
  }
}
function unlockGate() {
  document.body.classList.remove("locked");
  $("gate").hidden = true;
}

// =============================================================================
// switch de modos
// =============================================================================
let cloudGen = 0; // invalida suscripciones de enterCloudMode que quedaron en vuelo
function detachCloud() {
  if (cloud.unsubDays) { cloud.unsubDays(); cloud.unsubDays = null; }
  if (cloud.unsubProfile) { cloud.unsubProfile(); cloud.unsubProfile = null; }
}

async function enterCloudMode(user) {
  flushPendingSave();
  flushPendingProfile();
  const gen = ++cloudGen;
  detachCloud(); // síncrono: no dejes suscripciones de una invocación anterior vivas
  state.mode = "cloud";
  state.user = user;
  state.migrationChecked = false;
  state.showMigration = false;
  setSync(state.online ? "synced" : "offline");
  // render inmediato del armazón (los snapshots rellenan los datos enseguida)
  state.rec = currentRec();
  renderAll();
  try {
    const { fsMod, db } = await loadFirebase();
    if (gen !== cloudGen) return; // otra transición de auth ganó mientras cargábamos
    const daysCol = fsMod.collection(db, "users", user.uid, "days");
    const profileRef = fsMod.doc(db, "users", user.uid, "meta", "profile");

    detachCloud();
    cloud.unsubProfile = fsMod.onSnapshot(profileRef, (snap) => {
      state.profile = snap.exists() ? sanitizeProfile(snap.data()) : { ...DEFAULT_PROFILE };
      renderSettings();
      renderGlobal();
    }, (err) => console.error("profile snapshot:", err));

    cloud.unsubDays = fsMod.onSnapshot(daysCol, (snap) => {
      const recs = {};
      snap.forEach((d) => { recs[d.id] = normalize(d.data()); });
      state.records = recs;
      onCloudData(snap.metadata);
      maybeOfferMigration(snap.metadata);
    }, (err) => {
      console.error("days snapshot:", err);
      toast("Error de sincronización", "err");
    });
    // avisa a reminders.js que ya puede sincronizar config / registrar token push
    window.dispatchEvent(new CustomEvent("frody-push-ready"));
  } catch (e) {
    console.error(e);
    toast("Error al cargar tus datos", "err");
  }
}

function onCloudData(meta) {
  // refresca el día en cursor solo si no estás editándolo NI hay una escritura
  // pendiente (un toggle/stepper/chip recién tocado aún sin flush) — así un eco
  // de snapshot no descarta lo que acabas de marcar.
  const remote = currentRec();
  const editing = isEditingDayField() || saveTimer !== null;
  if (!editing && !recsEqual(remote, state.rec)) {
    state.rec = remote;
    renderRec();
  } else {
    // igual refrescamos toggles/score por si cambió desde otro dispositivo
    renderScore();
  }
  if (meta && meta.fromCache && !state.online) setSync("offline");
  else if (meta && meta.hasPendingWrites) setSync("saving");
  else setSync(state.online ? "synced" : "offline");
  renderGlobal();
}

function isEditingDayField() {
  const a = document.activeElement;
  if (!a) return false;
  return ["weight", "waist", "sleep", "notes", "gi"].indexOf(a.id) >= 0;
}

// =============================================================================
// lectura/escritura unificada
// =============================================================================
function currentRec() {
  const r = state.records[ymd(cursor)];
  return r ? normalize(r) : blank();
}

let saveTimer = null;
let pendingDate = null;
let pendingPatch = {};        // SOLO los campos que el usuario cambió desde el último flush
let pendingPatchSupps = {};   // SOLO los suplementos cambiados
// marca un campo/suplemento como "sucio" para escribir solo eso (no el doc entero)
function mark(k) { pendingPatch[k] = state.rec[k]; }
function markSupp(id) { pendingPatchSupps[id] = state.rec.supps[id]; }

function scheduleSave() {
  pendingDate = ymd(cursor);   // el patch pertenece al día que se está editando
  setSync("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}
// fuerza la escritura pendiente ya (al cambiar de día, cerrar pestaña, etc.)
function flushPendingSave() {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; flushSave(); }
}
async function flushSave() {
  const date = pendingDate;
  const patch = pendingPatch;
  const psupps = pendingPatchSupps;
  // limpia el estado pendiente YA (síncrono) para no re-disparar / mezclar días
  saveTimer = null;
  pendingDate = null;
  pendingPatch = {};
  pendingPatchSupps = {};
  if (!date || (!Object.keys(patch).length && !Object.keys(psupps).length)) return;

  const mode = state.mode;
  const user = state.user;
  // monta los cambios SOBRE la última versión remota conocida del día (no sobre
  // una foto vieja): así nunca se pisan campos que el OTRO dispositivo tocó.
  const rec = state.records[date] ? normalize(state.records[date]) : blank();
  Object.keys(patch).forEach((k) => { rec[k] = patch[k]; });
  Object.keys(psupps).forEach((id) => { rec.supps[id] = psupps[id]; });
  state.records[date] = normalize(rec);
  renderGlobal();
  if (mode === "cloud" && user) {
    try {
      const { fsMod, db } = await loadFirebase();
      const ref = fsMod.doc(db, "users", user.uid, "days", date);
      // doc completo (las reglas exigen todos los campos) pero ya reconciliado
      await fsMod.setDoc(ref, { ...rec, updatedAt: fsMod.serverTimestamp() });
      flashSaved();
      setSync(state.online ? "synced" : "offline");
    } catch (e) {
      console.error("save day:", e);
      setSync("offline");
      toast("Guardado offline · sincroniza al volver la red", "info");
    }
  } else {
    localSaveDay(date, rec);
    flashSaved();
    setSync("local");
  }
}

let profileTimer = null;
let pendingProfile = null;
function scheduleProfileSave() {
  pendingProfile = { ...state.profile };
  clearTimeout(profileTimer);
  profileTimer = setTimeout(flushProfile, 500);
}
function flushPendingProfile() {
  if (profileTimer !== null) { clearTimeout(profileTimer); profileTimer = null; flushProfile(); }
}
async function flushProfile() {
  if (!pendingProfile) return;
  const p = pendingProfile;
  const mode = state.mode;
  const user = state.user;
  profileTimer = null;
  pendingProfile = null;
  if (mode === "cloud" && user) {
    try {
      const { fsMod, db } = await loadFirebase();
      await fsMod.setDoc(fsMod.doc(db, "users", user.uid, "meta", "profile"), p);
      flashSaved();
    } catch (e) { console.error("save profile:", e); }
  } else {
    localSaveProfile(p);
    flashSaved();
  }
}

// =============================================================================
// migración local → nube
// =============================================================================
function localDayCount() {
  return local.keys().filter((k) => k.indexOf(PREFIX) === 0 && k !== PROFILE_KEY).length;
}

function maybeOfferMigration(meta) {
  if (state.mode !== "cloud" || state.migrationChecked) return;
  if (meta && meta.fromCache) return; // espera una confirmación real del servidor
  state.migrationChecked = true;
  const cloudDays = Object.keys(state.records).length;
  if (cloudDays === 0 && localDayCount() > 0) {
    state.showMigration = true;
    renderBanner();
  }
}

async function migrateLocalToCloud() {
  if (state.mode !== "cloud" || !state.user) return;
  const entries = [];
  local.keys().forEach((k) => {
    if (k.indexOf(PREFIX) === 0 && k !== PROFILE_KEY) {
      try { entries.push([k.slice(PREFIX.length), normalize(JSON.parse(local.get(k)))]); } catch (e) {}
    }
  });
  if (!entries.length) { toast("No hay datos locales", "info"); return; }
  try {
    const { fsMod, db } = await loadFirebase();
    // batches de 400 (límite 500)
    for (let i = 0; i < entries.length; i += 400) {
      const batch = fsMod.writeBatch(db);
      entries.slice(i, i + 400).forEach(([date, rec]) => {
        batch.set(fsMod.doc(db, "users", state.user.uid, "days", date), { ...rec, updatedAt: fsMod.serverTimestamp() });
      });
      await batch.commit();
    }
    // perfil local también
    const praw = local.get(PROFILE_KEY);
    if (praw) {
      try { await fsMod.setDoc(fsMod.doc(db, "users", state.user.uid, "meta", "profile"), sanitizeProfile(JSON.parse(praw))); } catch (e) {}
    }
    toast("Subidos " + entries.length + " días a la nube ✓");
    state.showMigration = false;
    renderBanner();
  } catch (e) {
    console.error("migración:", e);
    toast("Error al subir datos", "err");
  }
}

// =============================================================================
// RENDER
// =============================================================================
function renderAll() {
  renderDate();
  renderRec();
  renderSettings();
  renderGlobal();
  renderAuthUI();
  renderBanner();
  renderCrit();
}

// acciones críticas del Sistema: se pueden marcar resueltas y viaja al perfil,
// así queda igual en el teléfono y en el PC.
function renderCrit() {
  CRIT_KEYS.forEach((k) => {
    const btn = document.querySelector('[data-crit="' + k + '"]');
    if (!btn) return;
    const card = btn.closest(".crit");
    const done = !!state.profile[k];
    if (card) card.classList.toggle("done", done);
    btn.textContent = done ? "✓ Resuelto · reabrir" : "Marcar como resuelto";
  });
}

function bindCrit() {
  CRIT_KEYS.forEach((k) => {
    const btn = document.querySelector('[data-crit="' + k + '"]');
    if (!btn) return;
    btn.addEventListener("click", () => {
      state.profile[k] = !state.profile[k];
      scheduleProfileSave();
      renderCrit();
    });
  });
}

function renderDate() {
  $("dow").textContent = DOW[cursor.getDay()];
  $("dfull").textContent = cursor.getDate() + " " + MON[cursor.getMonth()] + " " + cursor.getFullYear();
  $("todayPill").textContent = ymd(cursor) === ymd(today) ? "● HOY" : "";
  $("nextDay").disabled = ymd(cursor) === ymd(today);

  const mc = $("mounjaroCard");
  const injSub = $("injSub");
  if (isMonday(cursor)) { mc.classList.remove("dayoff"); injSub.textContent = "día de inyección · lunes"; }
  else { mc.classList.add("dayoff"); injSub.textContent = "registro (tu día es lunes)"; }
}

function renderRec() {
  const r = state.rec;
  $("weight").value = r.weight;
  $("waist").value = r.waist;
  $("sleep").value = r.sleep;
  $("proteinVal").textContent = r.protein;
  $("waterVal").textContent = r.water;
  $("gi").value = r.gi;
  $("giVal").textContent = r.gi;
  $("gi").setAttribute("aria-valuetext", r.gi + " de 10");
  $("notes").value = r.notes;
  TOGGLES.forEach((k) => {
    const el = document.querySelector('[data-toggle="' + k + '"]');
    if (el) { el.classList.toggle("on", !!r[k]); el.setAttribute("aria-checked", r[k] ? "true" : "false"); }
  });
  renderChips();
  renderScore();
}

// ---------- stack como agenda diaria (estilo Outlook) ----------
function tmin(hhmm) { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function fmtMin(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }

// cabecera de un modo metabólico (con su porqué siempre visible)
function modeHead(key, m) {
  const h = document.createElement("div");
  h.className = "ag-mode ag-mode-" + key;
  h.style.setProperty("--c", m.color);
  const tag = document.createElement("div"); tag.className = "ag-mode-tag"; tag.textContent = m.tag;
  const nm = document.createElement("div"); nm.className = "ag-mode-name"; nm.textContent = m.name;
  const why = document.createElement("div"); why.className = "ag-mode-why"; why.textContent = m.why;
  h.appendChild(tag); h.appendChild(nm); h.appendChild(why);
  return h;
}

function makeEvent(x, past) {
  const taken = !!state.rec.supps[x.id];
  const wrap = document.createElement("div");
  wrap.className = "ag-item";

  const ev = document.createElement("div");
  ev.className = "ag-ev" + (taken ? " done" : (past ? " overdue" : "")) + (x.paused ? " paused" : "");
  ev.style.setProperty("--c", x.color || "#5566F0");

  const ic = document.createElement("span");
  ic.className = "ag-ic"; ic.style.setProperty("--c", x.color || "#5566F0");
  ic.innerHTML = '<span class="ms">' + (x.icon || "medication") + "</span>";

  // zona de texto = botón que despliega el porqué
  const tx = document.createElement("button");
  tx.type = "button"; tx.className = "ag-tx";
  tx.setAttribute("aria-expanded", "false");
  const nm = document.createElement("span"); nm.className = "ag-name"; nm.textContent = x.name;
  if (x.optional) nm.appendChild(badge("ciclado"));
  if (x.paused) nm.appendChild(badge("congelada", "warn"));
  const meta = document.createElement("span"); meta.className = "ag-meta";
  meta.textContent = [x.dose, x.slot].filter(Boolean).join(" · ");
  tx.appendChild(nm); tx.appendChild(meta);

  const why = document.createElement("div");
  why.className = "ag-why"; why.hidden = true;
  why.innerHTML = '<i>→ por qué:</i> ' + escapeHtml(x.why || "");
  tx.onclick = () => {
    const open = why.hidden;
    why.hidden = !open;
    tx.setAttribute("aria-expanded", open ? "true" : "false");
    ev.classList.toggle("open", open);
  };

  const tg = document.createElement("button");
  tg.type = "button"; tg.className = "tg" + (taken ? " on" : "");
  tg.setAttribute("role", "switch"); tg.setAttribute("aria-checked", taken ? "true" : "false");
  tg.setAttribute("aria-label", x.name);
  tg.onclick = () => {
    const on = !state.rec.supps[x.id];
    state.rec.supps[x.id] = on;
    tg.classList.toggle("on", on);
    tg.setAttribute("aria-checked", on ? "true" : "false");
    ev.classList.toggle("done", on);
    ev.classList.toggle("overdue", !on && past);
    markSupp(x.id); scheduleSave(); renderScore(); renderSuppCount();
  };

  ev.appendChild(ic); ev.appendChild(tx); ev.appendChild(tg);
  wrap.appendChild(ev); wrap.appendChild(why);
  return wrap;
}

function badge(text, kind) {
  const b = document.createElement("span");
  b.className = "ag-badge" + (kind ? " ag-badge-" + kind : "");
  b.textContent = text;
  return b;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function agRow(timeLabel, items, past) {
  const row = document.createElement("div");
  row.className = "ag-row" + (past ? " ag-past" : "");
  const tm = document.createElement("div"); tm.className = "ag-time"; tm.textContent = timeLabel;
  const rail = document.createElement("div"); rail.className = "ag-rail";
  const dot = document.createElement("span"); dot.className = "ag-dot"; dot.style.setProperty("--c", items[0].color || "#5566F0");
  rail.appendChild(dot);
  const evs = document.createElement("div"); evs.className = "ag-events";
  items.forEach((x) => evs.appendChild(makeEvent(x, past)));
  row.appendChild(tm); row.appendChild(rail); row.appendChild(evs);
  return row;
}

function nowLine(min) {
  const d = document.createElement("div"); d.className = "ag-now";
  const t = document.createElement("div"); t.className = "ag-now-time"; t.textContent = fmtMin(min);
  const l = document.createElement("div"); l.className = "ag-now-line";
  d.appendChild(t); d.appendChild(l);
  return d;
}

function renderChips() {
  const box = $("chips");
  box.className = "agenda";
  box.innerHTML = "";

  const isToday = ymd(cursor) === ymd(today);
  let nowMin = null;
  if (isToday) { const n = new Date(); nowMin = n.getHours() * 60 + n.getMinutes(); }

  // recorre los 3 modos en orden; dentro de cada modo agrupa por hora
  let nowDone = false;
  ["burn", "build", "repair"].forEach((mk) => {
    const m = MODES[mk];
    const mine = PLAN.filter((x) => x.mode === mk);
    if (!mine.length) return;

    box.appendChild(modeHead(mk, m));

    const timed = mine.filter((x) => tmin(x.time) != null).slice().sort((a, b) => tmin(a.time) - tmin(b.time));
    const flex = mine.filter((x) => tmin(x.time) == null);

    const groups = [];
    timed.forEach((x) => {
      let g = groups[groups.length - 1];
      if (!g || g.time !== x.time) { g = { time: x.time, min: tmin(x.time), items: [] }; groups.push(g); }
      g.items.push(x);
    });

    groups.forEach((g) => {
      if (isToday && !nowDone && g.min > nowMin) { box.appendChild(nowLine(nowMin)); nowDone = true; }
      box.appendChild(agRow(g.time, g.items, isToday && g.min <= nowMin));
    });
    if (flex.length) box.appendChild(agRow("—", flex, false));
  });
  if (isToday && !nowDone) box.appendChild(nowLine(nowMin));

  renderSuppCount();
}

function renderSuppCount() {
  const el = $("suppCount");
  if (!el) return;
  // dos cuentas separadas: suplementos obligatorios (excluye el Zinc ciclado y
  // la Vit D congelada) y acciones del protocolo (rituales del día)
  const supps = PLAN.filter((x) => x.kind === "supp" && !x.optional && !x.paused);
  const acts = PLAN.filter((x) => x.kind === "action");
  const st = supps.filter((x) => state.rec.supps[x.id]).length;
  const at = acts.filter((x) => state.rec.supps[x.id]).length;
  el.textContent = st + " / " + supps.length + " suplementos · " + at + " / " + acts.length + " acciones del protocolo";
}

function renderScore() {
  const s = scoreOf(state.rec);
  const pct = Math.round((s.done / s.total) * 100);
  $("scoreNum").textContent = pct + "%";
  $("scoreDet").textContent = s.done + " / " + s.total + " hábitos";
  const off = 176 - (176 * pct) / 100;
  const fill = $("ringFill");
  fill.style.strokeDashoffset = off;
  fill.setAttribute("stroke", pct >= 80 ? "#5BC08A" : pct >= 50 ? "#F2A93B" : "#DD6A56");
}

function renderSettings() {
  if (document.activeElement && document.activeElement.id === "startWeight") {} else $("startWeight").value = state.profile.startWeight;
  if (document.activeElement && document.activeElement.id === "goalWeight") {} else $("goalWeight").value = state.profile.goal;
}

function sortedRecords() {
  return Object.keys(state.records).sort().map((d) => ({ ...state.records[d], __date: d }));
}

function renderGlobal() {
  const recs = sortedRecords();
  $("daysTracked").innerHTML = recs.length + " <small>días</small>";

  // último peso conocido
  let lastW = state.profile.startWeight;
  for (let i = recs.length - 1; i >= 0; i--) {
    const w = parseFloat(recs[i].weight);
    if (isFinite(w)) { lastW = w; break; }
  }
  $("curWeight").textContent = isFinite(lastW) ? lastW.toFixed(1) : "—";

  const goal = state.profile.goal;
  const start = state.profile.startWeight;
  const faltan = lastW - goal;
  const perdidos = start - lastW;
  let txt;
  if (faltan <= 0) {
    txt = "🎯 meta " + goal + " alcanzada" + (perdidos > 0 ? " · −" + perdidos.toFixed(1) + " kg" : "");
  } else {
    txt = "meta " + goal + " · faltan " + faltan.toFixed(1) + (perdidos > 0 ? " · −" + perdidos.toFixed(1) + " kg" : "");
  }
  $("weightDelta").textContent = txt;

  // adherencia promedio
  if (recs.length) {
    let sum = 0;
    recs.forEach((r) => { sum += scorePct(r); });
    $("adhAvg").textContent = Math.round(sum / recs.length) + "%";
  } else {
    $("adhAvg").textContent = "—";
  }

  streakCount();
  renderChart(recs);
  renderAdh();
}

function streakCount() {
  const set = state.records;
  let n = 0;
  const d = new Date(today);
  if (!set[ymd(d)]) d.setDate(d.getDate() - 1); // si hoy no hay registro, parte de ayer
  while (set[ymd(d)]) { n++; d.setDate(d.getDate() - 1); }
  $("streak").textContent = n;
}

// ---------- chart (instancia reutilizada, sin fugas) ----------
let chart = null;
let resizeBound = false;
function renderChart(recs) {
  const empty = $("chartEmpty");
  const mini = $("chartMini");
  if (typeof echarts === "undefined") { empty.textContent = "(gráfico se carga en un momento…)"; empty.style.display = "block"; return; }
  const pts = recs
    .filter((r) => isFinite(parseFloat(r.weight)))
    .map((r) => [r.__date, parseFloat(r.weight)]);
  if (pts.length < 2) {
    if (chart) { chart.dispose(); chart = null; }
    empty.style.display = "block"; mini.textContent = ""; return;
  }
  empty.style.display = "none";
  if (!chart) chart = echarts.init($("weightChart"), null, { renderer: "canvas" });
  // colores tomados del tema activo (claro/oscuro) vía variables CSS
  const cs = getComputedStyle(document.documentElement);
  const cvar = (n, f) => (cs.getPropertyValue(n).trim() || f);
  const cAxis = cvar("--chart-axis", "#9aa0ac");
  const cGrid = cvar("--chart-grid", "rgba(120,130,150,.16)");
  const cTipBg = cvar("--card", "#1E222B");
  const cTipBd = cvar("--hair", "#323845");
  const cInk = cvar("--ink", "#ECEAE3");
  const cLine = cvar("--accent", "#5566F0");
  const cArea = cvar("--chart-area", "rgba(85,102,240,.18)");
  const cGoal = cvar("--ok", "#1f9e63");
  chart.setOption({
    grid: { left: 38, right: 16, top: 18, bottom: 24 },
    tooltip: { trigger: "axis", backgroundColor: cTipBg, borderColor: cTipBd, textStyle: { color: cInk, fontFamily: "JetBrains Mono", fontSize: 11 } },
    xAxis: { type: "category", data: pts.map((p) => p[0].slice(5)), axisLine: { lineStyle: { color: cGrid } }, axisLabel: { color: cAxis, fontFamily: "JetBrains Mono", fontSize: 9 } },
    yAxis: { type: "value", scale: true, axisLabel: { color: cAxis, fontFamily: "JetBrains Mono", fontSize: 9 }, splitLine: { lineStyle: { color: cGrid } } },
    series: [{
      type: "line", data: pts.map((p) => p[1]), smooth: true, symbol: "circle", symbolSize: 6,
      lineStyle: { color: cLine, width: 2.5 }, itemStyle: { color: cLine },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: cArea }, { offset: 1, color: "rgba(85,102,240,0)" }]) },
      markLine: { silent: true, symbol: "none", data: [{ yAxis: state.profile.goal }], lineStyle: { color: cGoal, type: "dashed" }, label: { formatter: "meta " + state.profile.goal, color: cGoal, fontFamily: "JetBrains Mono", fontSize: 10 } }
    }]
  }, { notMerge: true });
  if (!resizeBound) { window.addEventListener("resize", () => { if (chart) chart.resize(); }); resizeBound = true; }
  const first = pts[0][1], last = pts[pts.length - 1][1], diff = last - first;
  mini.textContent = pts.length + " registros · " + (diff <= 0 ? diff.toFixed(1) : "+" + diff.toFixed(1)) + " kg desde el primero";
}

function renderAdh() {
  const box = $("adhBars");
  box.innerHTML = "";
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = ymd(d), r = state.records[ds];
    const pct = r ? scorePct(r) : 0;
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = Math.max(4, pct * 0.72) + "px";
    bar.style.background = pct >= 80 ? "#23A56A" : pct >= 50 ? "#F2A93B" : pct > 0 ? "#DD6A56" : (getComputedStyle(document.documentElement).getPropertyValue("--bar-empty").trim() || "#272C37");
    bar.title = ds + " · " + pct + "%";
    const lbl = document.createElement("span"); lbl.textContent = DOW[d.getDay()].slice(0, 2);
    bar.appendChild(lbl);
    box.appendChild(bar);
  }
}

// ---------- auth UI ----------
function renderAuthUI() {
  const signBtn = $("signInBtn");
  const avatar = $("avatarBtn");
  if (!isConfigured()) { signBtn.hidden = true; avatar.hidden = true; return; }
  if (state.user) {
    signBtn.hidden = true;
    avatar.hidden = false;
    const photo = state.user.photoURL;
    const initial = (state.user.displayName || state.user.email || "?").trim().charAt(0).toUpperCase();
    // construir el <img> con createElement/.src (nunca innerHTML con datos de identidad)
    avatar.textContent = "";
    if (photo) {
      const img = document.createElement("img");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = photo;
      avatar.appendChild(img);
    } else {
      avatar.textContent = initial;
    }
  } else {
    signBtn.hidden = false;
    avatar.hidden = true;
  }
}

// ---------- sync pill ----------
function setSync(stateName) {
  const el = $("sync");
  const txt = { synced: "en la nube", saving: "guardando…", offline: "offline", local: "local" };
  el.dataset.state = stateName;
  $("syncTxt").textContent = txt[stateName] || stateName;
}

// ---------- banner ----------
function renderBanner() {
  const txt = $("noteBannerTxt");
  const actions = $("noteBannerActions");
  const banner = $("noteBanner");
  actions.innerHTML = "";
  banner.classList.remove("cta");

  if (!isConfigured()) {
    banner.classList.add("cta");
    txt.innerHTML = "Estás en <b>modo local</b> (este dispositivo). Para sincronizar entre tu teléfono y notebook, pega tu config en <b>firebase-config.js</b> y haz <b>firebase deploy</b>. Mientras tanto, tus datos viven seguros en este navegador.";
    return;
  }
  if (!state.user) {
    banner.classList.add("cta");
    txt.innerHTML = "Estás sin sesión: los datos se guardan <b>solo en este dispositivo</b>. Entra con Google para sincronizar en la nube.";
    const b = document.createElement("button");
    b.textContent = "Entrar con Google";
    b.onclick = signIn;
    actions.appendChild(b);
    return;
  }
  // con sesión
  if (state.showMigration && localDayCount() > 0) {
    banner.classList.add("cta");
    txt.innerHTML = "Tienes <b>" + localDayCount() + " días</b> guardados localmente en este dispositivo. ¿Los subimos a tu cuenta en la nube?";
    const b = document.createElement("button");
    b.textContent = "Subir a la nube";
    b.onclick = migrateLocalToCloud;
    const g = document.createElement("button");
    g.textContent = "Ahora no";
    g.className = "ghost";
    g.onclick = () => { state.showMigration = false; renderBanner(); };
    actions.appendChild(b); actions.appendChild(g);
    return;
  }
  // nombre por textContent: displayName/email los controla el usuario en su cuenta
  txt.innerHTML = "Sincronizado en la nube como <b></b>. Tus registros aparecen en cualquier dispositivo donde entres. Funciona offline y sincroniza al volver la red.";
  txt.querySelector("b").textContent = state.user.displayName || state.user.email || "tu cuenta";
}

// =============================================================================
// toast / saved
// =============================================================================
let savedTimer = null;
function flashSaved() { toast("guardado ✓"); }
function toast(msg, kind) {
  const t = $("savetag");
  t.textContent = msg;
  t.className = "savetag show" + (kind ? " " + kind : "");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { t.className = "savetag"; }, kind === "info" || kind === "err" ? 1800 : 900);
}

// =============================================================================
// navegación de días
// =============================================================================
function switchDay() {
  flushPendingSave();      // persiste el día que dejas antes de cambiar de rec
  state.rec = currentRec();
  renderDate();
  renderRec();
}

// =============================================================================
// export / import
// =============================================================================
function buildDump() {
  // mismo formato que el backup original: { 'frodybody:FECHA': '<json string>' }
  const dump = {};
  Object.keys(state.records).forEach((date) => {
    dump[PREFIX + date] = JSON.stringify(state.records[date]);
  });
  dump[PROFILE_KEY] = JSON.stringify(state.profile);
  return dump;
}

function flatten() {
  return sortedRecords().map((r) => {
    const b = normalize(r);
    const sc = scoreOf(b);
    const row = {
      fecha: r.__date, peso: b.weight, cintura: b.waist, mounjaro: b.injected ? "sí" : "", gi: b.gi,
      proteina_g: b.protein, agua_vasos: b.water, sueno_h: b.sleep, sol_am: b.sunAM ? "sí" : "", bici: b.bike ? "sí" : "",
      fuerza: b.strength ? "sí" : "", comida_limpia: b.cleanFood ? "sí" : "", sin_azucar_liq: b.noLiquidSugar ? "sí" : "",
      estres_ok: b.stressOK ? "sí" : "", score_pct: Math.round((sc.done / sc.total) * 100), notas: b.notes
    };
    PLAN.forEach((x) => { row["sup_" + x.id] = b.supps[x.id] ? "sí" : ""; });
    return row;
  });
}

function exportXlsx() {
  if (typeof XLSX === "undefined") { toast("Excel no disponible aún", "err"); return; }
  const data = flatten();
  if (!data.length) { toast("Aún no hay registros", "info"); return; }
  const ws = XLSX.utils.json_to_sheet(data), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "frody.body");
  XLSX.writeFile(wb, "frody-body-" + ymd(today) + ".xlsx");
}

function exportJson() {
  const blob = new Blob([JSON.stringify(buildDump(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "frody-body-backup-" + ymd(today) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function importJson(file) {
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch (e) { toast("JSON inválido", "err"); return; }

  // soporta { 'frodybody:FECHA': '<json>' }  o  { 'FECHA': {...} }
  const days = [];
  let profile = null;
  Object.keys(parsed).forEach((k) => {
    if (k === PROFILE_KEY) { try { profile = sanitizeProfile(JSON.parse(parsed[k])); } catch (e) {} return; }
    let date = k.indexOf(PREFIX) === 0 ? k.slice(PREFIX.length) : k;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let val = parsed[k];
    if (typeof val === "string") { try { val = JSON.parse(val); } catch (e) { return; } }
    days.push([date, normalize(val)]);
  });
  if (!days.length) { toast("No encontré días en el archivo", "err"); return; }
  if (!confirm("Importar " + days.length + " días? Se combinarán con los existentes (sobrescribe fechas repetidas).")) return;

  if (state.mode === "cloud" && state.user) {
    try {
      const { fsMod, db } = await loadFirebase();
      for (let i = 0; i < days.length; i += 400) {
        const batch = fsMod.writeBatch(db);
        days.slice(i, i + 400).forEach(([date, rec]) => batch.set(fsMod.doc(db, "users", state.user.uid, "days", date), { ...rec, updatedAt: fsMod.serverTimestamp() }));
        await batch.commit();
      }
      if (profile) await fsMod.setDoc(fsMod.doc(db, "users", state.user.uid, "meta", "profile"), profile);
      toast("Importados " + days.length + " días ✓");
    } catch (e) { console.error(e); toast("Error al importar", "err"); }
  } else {
    days.forEach(([date, rec]) => { localSaveDay(date, rec); state.records[date] = rec; });
    if (profile) { state.profile = profile; localSaveProfile(profile); }
    state.rec = currentRec();
    renderAll();
    toast("Importados " + days.length + " días ✓");
  }
}

// =============================================================================
// bind de eventos
// =============================================================================
function bind() {
  $("prevDay").onclick = () => { cursor.setDate(cursor.getDate() - 1); switchDay(); };
  $("nextDay").onclick = () => { if (ymd(cursor) === ymd(today)) return; cursor.setDate(cursor.getDate() + 1); switchDay(); };
  // #todayJump es un <button> nativo: Enter/Espacio los maneja el navegador
  $("todayJump").onclick = () => { cursor = new Date(today); switchDay(); };

  document.querySelectorAll("[data-toggle]").forEach((el) => {
    el.onclick = () => {
      const k = el.dataset.toggle;
      state.rec[k] = !state.rec[k];
      el.classList.toggle("on");
      el.setAttribute("aria-checked", state.rec[k] ? "true" : "false");
      mark(k); scheduleSave(); renderScore();
    };
  });
  document.querySelectorAll("[data-step]").forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.step, d = +b.dataset.d;
      state.rec[k] = Math.max(0, (Number(state.rec[k]) || 0) + d);
      $(k + "Val").textContent = state.rec[k];
      mark(k); scheduleSave(); renderScore();
    };
  });
  $("weight").oninput = function () { state.rec.weight = cleanNum(this.value); mark("weight"); scheduleSave(); };
  $("waist").oninput = function () { state.rec.waist = cleanNum(this.value); mark("waist"); scheduleSave(); };
  $("sleep").oninput = function () { state.rec.sleep = cleanNum(this.value); mark("sleep"); scheduleSave(); renderScore(); };
  $("gi").oninput = function () {
    state.rec.gi = Math.min(10, Math.max(0, Math.round(+this.value) || 0));
    $("giVal").textContent = state.rec.gi;
    this.setAttribute("aria-valuetext", state.rec.gi + " de 10");
    mark("gi"); scheduleSave();
  };
  $("notes").oninput = function () { state.rec.notes = this.value; mark("notes"); scheduleSave(); };

  // peso inicial / meta: solo persistir cuando hay un número finito (no pisar con default al borrar)
  $("startWeight").oninput = function () {
    const v = parseFloat(this.value);
    if (this.value !== "" && isFinite(v)) { state.profile.startWeight = v; renderGlobal(); scheduleProfileSave(); }
  };
  $("goalWeight").oninput = function () {
    const v = parseFloat(this.value);
    if (this.value !== "" && isFinite(v)) { state.profile.goal = v; renderGlobal(); scheduleProfileSave(); }
  };

  $("expXlsx").onclick = exportXlsx;
  $("expJson").onclick = exportJson;
  $("impJson").onclick = () => $("impFile").click();
  $("impFile").onchange = function () { if (this.files && this.files[0]) importJson(this.files[0]); this.value = ""; };

  bindCrit();

  $("gateSignIn").onclick = signIn;
  $("signInBtn").onclick = signIn;
  $("avatarBtn").onclick = () => { if (confirm("¿Cerrar sesión?")) doSignOut(); };

  window.addEventListener("online", () => { state.online = true; if (state.mode === "cloud") setSync("synced"); });
  window.addEventListener("offline", () => { state.online = false; if (state.mode === "cloud") setSync("offline"); });

  // no perder la última edición al cerrar/ocultar la pestaña dentro del debounce
  window.addEventListener("beforeunload", flushPendingSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { flushPendingSave(); flushPendingProfile(); }
    else { rolloverDay(); }
  });
  // ---- integración con la UI nueva (ui.js): re-dibujar el gráfico al mostrar
  //      la pestaña Tendencias o al cambiar de tema (claro/oscuro) ----
  window.addEventListener("frody-tab", (e) => {
    // re-crea el gráfico ya con el panel visible (evita init en 0×0 estando oculto)
    if (e.detail === "trend") { if (chart) { chart.dispose(); chart = null; } renderGlobal(); }
  });
  window.addEventListener("frody-theme", () => {
    if (chart) { chart.dispose(); chart = null; }
    renderGlobal();
  });

  // cada minuto: chequeo de medianoche + refresco de la agenda (línea de "ahora"
  // y estados vencido/pendiente no quedan congelados)
  setInterval(() => {
    rolloverDay();
    if (ymd(cursor) === ymd(today) && !document.hidden) renderChips();
  }, 60 * 1000);
}

function rolloverDay() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  if (ymd(t) !== ymd(today)) {
    flushPendingSave();                 // no mezclar el parche pendiente en el día nuevo
    today = t;
    if (ymd(cursor) > ymd(today)) { cursor = new Date(today); state.rec = currentRec(); }
    renderAll();
  }
}

// =============================================================================
// service worker (app shell offline)
// =============================================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW no registrado:", e));
  });
}

// =============================================================================
// init
// =============================================================================
state.rec = blank();
bind();
lockGate({ loading: true });  // bloqueado hasta verificar/iniciar sesión
initAuth();
