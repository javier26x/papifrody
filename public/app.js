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
const DEFAULT_PROFILE = { startWeight: 132.9, goal: 100 };

const SUPPS = [
  { id: "tareg",    name: "Tareg D",           dose: "160/12.5",          time: "08:00", slot: "Fármaco diario",       icon: "cardiology",        color: "#dd6a56" },
  { id: "ashwa",    name: "Ashwagandha",       dose: "450 mg · 1 cáp",    time: "10:00", slot: "Abre la ventana de comida", icon: "spa",          color: "#8b5cf6" },
  { id: "psyllium", name: "Psyllium",          dose: "5 g (1 cdita)",     time: "13:15", slot: "15 min antes de comer", icon: "grass",             color: "#23a56a" },
  { id: "omega1",   name: "Omega 3",           dose: "1.200 mg · 1 cáp",  time: "13:30", slot: "Almuerzo · con grasa",  icon: "set_meal",          color: "#e0922a" },
  { id: "zinc",     name: "Zinc Picolinato",   dose: "50 mg · 1 cáp",     time: "13:30", slot: "Almuerzo · 3 días sí/4 no", icon: "medication",    color: "#2bb7d9", optional: true },
  { id: "whey",     name: "Whey",              dose: "1–2 scoops",        time: "13:30", slot: "Cerrar proteína",       icon: "blender",           color: "#5566F0" },
  { id: "omega2",   name: "Omega 3",           dose: "1.200 mg · 1 cáp",  time: "17:30", slot: "Cena · con grasa",      icon: "set_meal",          color: "#e0922a" },
  { id: "mag",      name: "Magnesio Bisglic.", dose: "168 mg · 2 cáps",   time: "21:00", slot: "Noche",                 icon: "bedtime",           color: "#6f7df6" },
  { id: "creatina", name: "Creatina",          dose: "5 g (1 cdita)",     time: "13:30", slot: "Cualquier hora",        icon: "fitness_center",    color: "#ef6b53" },
  { id: "bonald",   name: "Bonal D (gotas)",   dose: "carga ×3",          time: "13:30", slot: "Domingo 13:30 · con comida", icon: "medication_liquid", color: "#1ea8a0", weekly: true },
  { id: "neuro",    name: "Neurobión",         dose: "inyección · ×3",    time: "",      slot: "Domingo",               icon: "vaccines",          color: "#a855f7", weekly: true }
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
  SUPPS.forEach((x) => { s[x.id] = false; });
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
function scoreOf(r) {
  const checks = [
    (Number(r.protein) || 0) >= 150,
    (Number(r.water) || 0) >= 8,
    (parseFloat(r.sleep) || 0) >= 7,
    r.sunAM, r.bike, r.strength, r.cleanFood, r.noLiquidSugar, r.stressOK,
    (!!r.supps && r.supps.creatina && r.supps.mag && (r.supps.omega1 || r.supps.omega2))
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
    bindForegroundPush(fb);
    return true;
  } catch (e) { console.warn("enablePush:", e); return false; }
}

function bindForegroundPush(fb) {
  if (push.bound || !push.msg || !fb.msgMod) return;
  push.bound = true;
  fb.msgMod.onMessage(push.msg, (payload) => {
    const d = (payload && payload.data) || {};
    try {
      if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker) {
        navigator.serviceWorker.ready.then((reg) => reg.showNotification(d.title || "frody.body", {
          body: d.body || "", icon: "icon-192.png", badge: "icon-192.png", tag: d.tag || "frody", data: { url: d.url || "./" }
        })).catch(() => {});
      }
    } catch (e) {}
    if (d.body) toast(d.body, "info");
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
let pendingRec = null;
function scheduleSave() {
  // captura una FOTO del día/registro actual: si navegas o cierras antes del
  // debounce, se escribe el día correcto, no el que esté en cursor al disparar.
  pendingDate = ymd(cursor);
  pendingRec = normalize(state.rec);
  setSync("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}
// fuerza la escritura pendiente ya (al cambiar de día, cerrar pestaña, etc.)
function flushPendingSave() {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; flushSave(); }
}
async function flushSave() {
  if (!pendingDate || !pendingRec) return;
  const date = pendingDate;
  const rec = pendingRec;
  // captura modo/usuario AHORA (síncrono): si el modo cambia durante el await,
  // la escritura igual va al destino correcto y no hace null-deref de state.user.
  const mode = state.mode;
  const user = state.user;
  saveTimer = null;
  pendingDate = null;
  pendingRec = null;
  // refleja en el cache local en memoria para que stats/gráfico se actualicen ya
  state.records[date] = normalize(rec);
  renderGlobal();
  if (mode === "cloud" && user) {
    try {
      const { fsMod, db } = await loadFirebase();
      const ref = fsMod.doc(db, "users", user.uid, "days", date);
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

function makeEvent(x, past) {
  const taken = !!state.rec.supps[x.id];
  const ev = document.createElement("div");
  ev.className = "ag-ev" + (taken ? " done" : (past ? " overdue" : ""));
  ev.style.setProperty("--c", x.color || "#5566F0");

  const ic = document.createElement("span");
  ic.className = "ag-ic"; ic.style.setProperty("--c", x.color || "#5566F0");
  ic.innerHTML = '<span class="ms">' + (x.icon || "medication") + "</span>";

  const tx = document.createElement("div"); tx.className = "ag-tx";
  const nm = document.createElement("span"); nm.className = "ag-name"; nm.textContent = x.name;
  const meta = document.createElement("span"); meta.className = "ag-meta";
  meta.textContent = [x.dose, x.slot].filter(Boolean).join(" · ");
  tx.appendChild(nm); tx.appendChild(meta);

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
    scheduleSave(); renderScore(); renderSuppCount();
  };

  ev.appendChild(ic); ev.appendChild(tx); ev.appendChild(tg);
  return ev;
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

  const timed = SUPPS.filter((x) => !x.weekly && tmin(x.time) != null).slice().sort((a, b) => tmin(a.time) - tmin(b.time));
  const flex = SUPPS.filter((x) => !x.weekly && tmin(x.time) == null);
  const weekly = SUPPS.filter((x) => x.weekly);

  // agrupar por franja horaria
  const groups = [];
  timed.forEach((x) => {
    let g = groups[groups.length - 1];
    if (!g || g.time !== x.time) { g = { time: x.time, min: tmin(x.time), items: [] }; groups.push(g); }
    g.items.push(x);
  });

  let nowDone = false;
  groups.forEach((g) => {
    if (isToday && !nowDone && g.min > nowMin) { box.appendChild(nowLine(nowMin)); nowDone = true; }
    box.appendChild(agRow(g.time, g.items, isToday && g.min <= nowMin));
  });
  if (isToday && !nowDone && groups.length) { box.appendChild(nowLine(nowMin)); nowDone = true; }

  if (flex.length) box.appendChild(agRow("—", flex, false));
  if (weekly.length) box.appendChild(agRow("Dom", weekly, false));

  renderSuppCount();
}

function renderSuppCount() {
  const el = $("suppCount");
  if (!el) return;
  // cuenta solo los obligatorios: excluye los opcionales/ciclados (Zinc) y los
  // semanales (Bonal D, Neurobión) salvo que sea domingo
  const isSunday = cursor.getDay() === 0;
  const items = SUPPS.filter((x) => !x.optional && (!x.weekly || isSunday));
  const taken = items.filter((x) => state.rec.supps[x.id]).length;
  el.textContent = taken + " / " + items.length + " suplementos " + (isSunday ? "de hoy" : "del día") + " tomados";
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
    SUPPS.forEach((x) => { row["sup_" + x.id] = b.supps[x.id] ? "sí" : ""; });
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
      scheduleSave(); renderScore();
    };
  });
  document.querySelectorAll("[data-step]").forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.step, d = +b.dataset.d;
      state.rec[k] = Math.max(0, (Number(state.rec[k]) || 0) + d);
      $(k + "Val").textContent = state.rec[k];
      scheduleSave(); renderScore();
    };
  });
  $("weight").oninput = function () { state.rec.weight = cleanNum(this.value); scheduleSave(); };
  $("waist").oninput = function () { state.rec.waist = cleanNum(this.value); scheduleSave(); };
  $("sleep").oninput = function () { state.rec.sleep = cleanNum(this.value); scheduleSave(); renderScore(); };
  $("gi").oninput = function () {
    state.rec.gi = Math.min(10, Math.max(0, Math.round(+this.value) || 0));
    $("giVal").textContent = state.rec.gi;
    this.setAttribute("aria-valuetext", state.rec.gi + " de 10");
    scheduleSave();
  };
  $("notes").oninput = function () { state.rec.notes = this.value; scheduleSave(); };

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

  // chequeo de medianoche por si la pestaña queda abierta y visible cruzándola
  setInterval(rolloverDay, 60 * 1000);
}

function rolloverDay() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  if (ymd(t) !== ymd(today)) {
    today = t;
    if (ymd(cursor) > ymd(today)) cursor = new Date(today);
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
