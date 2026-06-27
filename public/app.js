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
import { firebaseConfig, isConfigured } from "./firebase-config.js";

"use strict";

// ---------- constantes ----------
const PREFIX = "frodybody:";
const PROFILE_KEY = "frodybody:profile";
const FB_VERSION = "10.12.2";
const FB_CDN = "https://www.gstatic.com/firebasejs/" + FB_VERSION;
const DEFAULT_PROFILE = { startWeight: 132.9, goal: 100 };

const SUPPS = [
  { id: "ashwa", name: "Ashwagandha" },
  { id: "omega1", name: "Omega 3 (1ª)" },
  { id: "omega2", name: "Omega 3 (2ª)" },
  { id: "zinc", name: "Zinc" },
  { id: "creatina", name: "Creatina" },
  { id: "whey", name: "Whey" },
  { id: "psyllium", name: "Psyllium" },
  { id: "mag", name: "Magnesio" },
  { id: "tareg", name: "Tareg D" },
  { id: "bonald", name: "Bonal D", weekly: true },
  { id: "neuro", name: "Neurobión", weekly: true }
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
function normalize(o) {
  const b = blank();
  if (!o || typeof o !== "object") return b;
  for (const k in b) {
    if (k === "supps") {
      for (const s in b.supps) {
        if (o.supps && s in o.supps) b.supps[s] = !!o.supps[s];
      }
    } else if (k in o && o[k] != null) {
      b[k] = o[k];
    }
  }
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
    (r.supps.creatina && r.supps.mag && (r.supps.omega1 || r.supps.omega2))
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
  const [appMod, authMod, fsMod] = await Promise.all([
    import(FB_CDN + "/firebase-app.js"),
    import(FB_CDN + "/firebase-auth.js"),
    import(FB_CDN + "/firebase-firestore.js")
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
  cloud.fb = { appMod, authMod, fsMod, app, auth, db };
  return cloud.fb;
}

// =============================================================================
// AUTH
// =============================================================================
async function initAuth() {
  if (!isConfigured()) { enterLocalMode(); renderBanner(); return; }
  try {
    const { authMod, auth } = await loadFirebase();
    await authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
    authMod.onAuthStateChanged(auth, (user) => {
      if (user) enterCloudMode(user);
      else enterLocalMode();
      renderAuthUI();
      renderBanner();
    });
  } catch (e) {
    console.error("Firebase no se pudo iniciar, sigo en modo local:", e);
    enterLocalMode();
    renderBanner();
    toast("Firebase no disponible · modo local", "err");
  }
}

async function signIn() {
  try {
    const { authMod, auth } = await loadFirebase();
    const provider = new authMod.GoogleAuthProvider();
    await authMod.signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    if (e && e.code === "auth/popup-blocked") {
      // fallback a redirect si el popup fue bloqueado
      try {
        const { authMod, auth } = await loadFirebase();
        await authMod.signInWithRedirect(auth, new authMod.GoogleAuthProvider());
        return;
      } catch (e2) { console.error(e2); }
    }
    if (!(e && e.code === "auth/cancelled-popup-request") && !(e && e.code === "auth/popup-closed-by-user")) {
      toast("No se pudo entrar", "err");
    }
  }
}

async function doSignOut() {
  try {
    const { authMod, auth } = await loadFirebase();
    await authMod.signOut(auth);
    toast("Sesión cerrada", "info");
  } catch (e) { console.error(e); }
}

// =============================================================================
// switch de modos
// =============================================================================
function detachCloud() {
  if (cloud.unsubDays) { cloud.unsubDays(); cloud.unsubDays = null; }
  if (cloud.unsubProfile) { cloud.unsubProfile(); cloud.unsubProfile = null; }
}

function enterLocalMode() {
  detachCloud();
  state.mode = "local";
  state.user = null;
  state.migrationChecked = false;
  state.showMigration = false;
  localLoadAll();
  state.rec = currentRec();
  setSync("local");
  renderAll();
}

async function enterCloudMode(user) {
  state.mode = "cloud";
  state.user = user;
  state.migrationChecked = false;
  state.showMigration = false;
  setSync(state.online ? "synced" : "offline");
  try {
    const { fsMod, db } = await loadFirebase();
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
  } catch (e) {
    console.error(e);
    enterLocalMode();
  }
}

function onCloudData(meta) {
  // refresca el día en cursor solo si no estás editándolo (evita pisar lo que tipeas)
  const remote = currentRec();
  const editing = isEditingDayField();
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
function scheduleSave() {
  pendingDate = ymd(cursor);
  setSync("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}
async function flushSave() {
  const date = pendingDate || ymd(cursor);
  const rec = state.rec;
  // refleja en el cache local en memoria para que stats/gráfico se actualicen ya
  state.records[date] = normalize(rec);
  renderGlobal();
  if (state.mode === "cloud" && state.user) {
    try {
      const { fsMod, db } = await loadFirebase();
      const ref = fsMod.doc(db, "users", state.user.uid, "days", date);
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
function scheduleProfileSave() {
  clearTimeout(profileTimer);
  profileTimer = setTimeout(async () => {
    if (state.mode === "cloud" && state.user) {
      try {
        const { fsMod, db } = await loadFirebase();
        await fsMod.setDoc(fsMod.doc(db, "users", state.user.uid, "meta", "profile"), state.profile);
        flashSaved();
      } catch (e) { console.error("save profile:", e); }
    } else {
      localSaveProfile(state.profile);
      flashSaved();
    }
  }, 500);
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
  $("notes").value = r.notes;
  TOGGLES.forEach((k) => {
    const el = document.querySelector('[data-toggle="' + k + '"]');
    if (el) { el.classList.toggle("on", !!r[k]); el.setAttribute("aria-checked", r[k] ? "true" : "false"); }
  });
  renderChips();
  renderScore();
}

function renderChips() {
  const box = $("chips");
  box.innerHTML = "";
  SUPPS.forEach((x) => {
    const c = document.createElement("button");
    c.type = "button";
    c.className = "chip" + (x.weekly ? " weekly" : "") + (state.rec.supps[x.id] ? " on" : "");
    c.textContent = x.name;
    c.setAttribute("aria-pressed", state.rec.supps[x.id] ? "true" : "false");
    c.onclick = () => {
      state.rec.supps[x.id] = !state.rec.supps[x.id];
      c.classList.toggle("on");
      c.setAttribute("aria-pressed", state.rec.supps[x.id] ? "true" : "false");
      scheduleSave(); renderScore();
    };
    box.appendChild(c);
  });
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
    $("adhAvg").textContent = "adherencia " + Math.round(sum / recs.length) + "%";
  } else {
    $("adhAvg").textContent = "adherencia —";
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
  chart.setOption({
    grid: { left: 38, right: 14, top: 18, bottom: 24 },
    tooltip: { trigger: "axis", backgroundColor: "#1E222B", borderColor: "#323845", textStyle: { color: "#ECEAE3", fontFamily: "JetBrains Mono", fontSize: 11 } },
    xAxis: { type: "category", data: pts.map((p) => p[0].slice(5)), axisLine: { lineStyle: { color: "#323845" } }, axisLabel: { color: "#6B7280", fontFamily: "JetBrains Mono", fontSize: 9 } },
    yAxis: { type: "value", scale: true, axisLabel: { color: "#6B7280", fontFamily: "JetBrains Mono", fontSize: 9 }, splitLine: { lineStyle: { color: "rgba(50,56,69,.5)" } } },
    series: [{
      type: "line", data: pts.map((p) => p[1]), smooth: true, symbol: "circle", symbolSize: 6,
      lineStyle: { color: "#F2A93B", width: 2.5 }, itemStyle: { color: "#F2A93B" },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(242,169,59,.18)" }, { offset: 1, color: "rgba(242,169,59,0)" }]) },
      markLine: { silent: true, symbol: "none", data: [{ yAxis: state.profile.goal }], lineStyle: { color: "#5BC08A", type: "dashed" }, label: { formatter: "meta " + state.profile.goal, color: "#5BC08A", fontFamily: "JetBrains Mono", fontSize: 10 } }
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
    bar.style.background = pct >= 80 ? "#5BC08A" : pct >= 50 ? "#F2A93B" : pct > 0 ? "#DD6A56" : "#272C37";
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
    avatar.innerHTML = photo ? '<img alt="" referrerpolicy="no-referrer" src="' + photo + '">' : initial;
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
  txt.innerHTML = "Sincronizado en la nube como <b>" + (state.user.displayName || state.user.email) + "</b>. Tus registros aparecen en cualquier dispositivo donde entres. Funciona offline y sincroniza al volver la red.";
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
  const jump = $("todayJump");
  jump.onclick = () => { cursor = new Date(today); switchDay(); };
  jump.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cursor = new Date(today); switchDay(); } };

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
  $("weight").oninput = function () { state.rec.weight = this.value === "" ? "" : parseFloat(this.value); scheduleSave(); };
  $("waist").oninput = function () { state.rec.waist = this.value === "" ? "" : parseFloat(this.value); scheduleSave(); };
  $("sleep").oninput = function () { state.rec.sleep = this.value === "" ? "" : parseFloat(this.value); scheduleSave(); renderScore(); };
  $("gi").oninput = function () { state.rec.gi = +this.value; $("giVal").textContent = this.value; scheduleSave(); };
  $("notes").oninput = function () { state.rec.notes = this.value; scheduleSave(); };

  $("startWeight").oninput = function () { state.profile.startWeight = this.value === "" ? DEFAULT_PROFILE.startWeight : parseFloat(this.value); renderGlobal(); scheduleProfileSave(); };
  $("goalWeight").oninput = function () { state.profile.goal = this.value === "" ? DEFAULT_PROFILE.goal : parseFloat(this.value); renderGlobal(); scheduleProfileSave(); };

  $("expXlsx").onclick = exportXlsx;
  $("expJson").onclick = exportJson;
  $("impJson").onclick = () => $("impFile").click();
  $("impFile").onchange = function () { if (this.files && this.files[0]) importJson(this.files[0]); this.value = ""; };

  $("signInBtn").onclick = signIn;
  $("avatarBtn").onclick = () => { if (confirm("¿Cerrar sesión?")) doSignOut(); };

  window.addEventListener("online", () => { state.online = true; if (state.mode === "cloud") setSync("synced"); });
  window.addEventListener("offline", () => { state.online = false; if (state.mode === "cloud") setSync("offline"); });

  // si vuelve la medianoche con la pestaña abierta, recalcular "hoy"
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const t = new Date(); t.setHours(0, 0, 0, 0);
      if (ymd(t) !== ymd(today)) { today = t; if (ymd(cursor) > ymd(today)) cursor = new Date(today); renderAll(); }
    }
  });
}

// =============================================================================
// service worker (app shell offline)
// =============================================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW no registrado:", e));
  });
}

// =============================================================================
// init
// =============================================================================
state.rec = blank();
bind();
enterLocalMode();   // arranca local; si hay sesión, initAuth cambia a nube
initAuth();
