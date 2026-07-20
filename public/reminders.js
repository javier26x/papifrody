// =============================================================================
// reminders.js — recordatorios y notificaciones (suplementos, inyección, agua…).
//
// Cada recordatorio tiene su toggle y su hora. Estrategia:
//   • Si el navegador soporta Notification Triggers (Chrome/Android) → programa
//     las notificaciones en el dispositivo: llegan AUNQUE la app esté cerrada.
//   • Si no (p. ej. iOS Safari) → las dispara mientras la app está abierta.
// Es de presentación/dispositivo: NO toca Firebase ni los datos de salud.
// La config vive en localStorage (las notificaciones son por-dispositivo).
// =============================================================================
(function () {
  "use strict";

  var KEY = "frody:reminders";
  var FIRED_KEY = "frody:reminders:fired";

  // catálogo de recordatorios (alineado con el stack real)
  var DEFAULTS = [
    { id: "weigh",  label: "Pesaje al despertar",    icon: "monitor_weight", color: "#5566F0", time: "07:30", days: "daily" },
    { id: "tareg",  label: "Tareg D · en ayuno",     icon: "cardiology",     color: "#dd6a56", time: "07:00", days: "daily" },
    { id: "lunch",  label: "Almuerzo · suplementos", icon: "restaurant",     color: "#23a56a", time: "13:30", days: "daily" },
    { id: "water",  label: "Agua + electrolitos",    icon: "water_drop",     color: "#2bb7d9", time: "15:00", days: "daily" },
    { id: "omega",  label: "Cena · Omega + Mag",     icon: "set_meal",       color: "#e0922a", time: "17:30", days: "daily" },
    { id: "inject", label: "Inyección Mounjaro",     icon: "vaccines",       color: "#ef6b53", time: "09:00", days: "mon"   },
    { id: "weekly", label: "Bonal D + Neurobión",    icon: "event",          color: "#1ea8a0", time: "13:30", days: "sun"   },
    { id: "log",    label: "Registrar el día",       icon: "edit_note",      color: "#9aa0ac", time: "21:30", days: "daily" }
  ];
  var BODIES = {
    weigh:  "Pésate al despertar y registra el peso 📉",
    tareg:  "Tareg D en ayuno — antes de comer nada 💊",
    lunch:  "Almuerzo: Ashwagandha, Omega 3, Creatina, Whey y Zinc (si toca) 💊 (Psyllium 15 min antes)",
    water:  "Hora de agua + electrolitos 💧",
    omega:  "Cena (con grasa): Omega 3 + Magnesio 🐟🌙",
    inject: "Hoy es día de inyección · Mounjaro 5 mg 💉",
    weekly: "Domingo: Bonal D (gotas, con comida) + Neurobión (inyección) 📅",
    log:    "¿Ya registraste tu día en frody.body? ✍️"
  };
  // mapeo de día → número/nombre (soporta cualquier día de la semana)
  var DAYNUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  var DAYNAME = { sun: "Domingo", mon: "Lunes", tue: "Martes", wed: "Miércoles", thu: "Jueves", fri: "Viernes", sat: "Sábado" };

  var TRIGGERS_OK = (typeof window !== "undefined") && (typeof window.TimestampTrigger !== "undefined") &&
    ("serviceWorker" in navigator) && ("Notification" in window);

  // ---------- detección de plataforma (iOS necesita PWA instalada) ----------
  var IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS se hace pasar por Mac
  function isStandalone() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true;
  }
  // en iOS, el web push SOLO existe con la app instalada en la pantalla de inicio
  function iosNeedsInstall() { return IS_IOS && !isStandalone(); }
  function notifsAvailable() { return ("Notification" in window) && !iosNeedsInstall(); }

  // ---------- estado / persistencia ----------
  function defaults() {
    return { master: false, items: DEFAULTS.map(function (d) { return { id: d.id, time: d.time, enabled: false }; }) };
  }
  // horas default VIEJAS: si el usuario nunca las cambió (siguen igual al viejo
  // default), migramos al nuevo default en vez de dejar la hora obsoleta.
  var LEGACY_TIMES = { omega: "20:30", weekly: "11:00" };
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        var byId = {};
        (s.items || []).forEach(function (x) { byId[x.id] = x; });
        return {
          master: !!s.master,
          items: DEFAULTS.map(function (d) {
            var saved = byId[d.id] || {};
            var t = saved.time;
            if (!t || t === LEGACY_TIMES[d.id]) t = d.time; // migra las horas obsoletas
            return { id: d.id, time: t, enabled: !!saved.enabled };
          })
        };
      }
    } catch (e) {}
    return defaults();
  }
  function isTouched() { try { return localStorage.getItem(KEY) !== null; } catch (e) { return false; } }
  var cfg = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }
  function meta(id) { for (var i = 0; i < DEFAULTS.length; i++) if (DEFAULTS[i].id === id) return DEFAULTS[i]; return null; }

  function loadFired() { try { return JSON.parse(localStorage.getItem(FIRED_KEY)) || {}; } catch (e) { return {}; } }
  function saveFired(f) { try { localStorage.setItem(FIRED_KEY, JSON.stringify(f)); } catch (e) {} }

  // ---------- helpers de fecha ----------
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate() + 0).padStart(2, "0"); }
  function scheduleLabel(item) {
    var m = meta(item.id);
    var d = (m && m.days) || "daily";
    return (d === "daily" ? "Todos los días" : (DAYNAME[d] || d)) + " · " + item.time;
  }
  // próximas `count` marcas de tiempo futuras para un recordatorio
  function occurrences(item, count) {
    var m = meta(item.id), out = [], now = Date.now();
    var p = item.time.split(":"), h = +p[0], mi = +p[1];
    var d = new Date(); d.setHours(h, mi, 0, 0);
    var guard = 0;
    while (out.length < count && guard < 400) {
      guard++;
      var ok = !m || m.days === "daily" || (DAYNUM[m.days] !== undefined && d.getDay() === DAYNUM[m.days]);
      if (ok && d.getTime() > now + 1000) out.push(d.getTime());
      d = new Date(d.getTime()); d.setDate(d.getDate() + 1); d.setHours(h, mi, 0, 0);
    }
    return out;
  }

  // ---------- disparo ----------
  function fire(item) {
    var body = BODIES[item.id] || item.label;
    var opts = { body: body, tag: "frody-" + item.id, icon: "icon-192.png", badge: "icon-192.png", renotify: true, data: { id: item.id, url: "./" } };
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then(function (reg) { reg.showNotification("frody.body", opts); }).catch(function () {});
        } else {
          new Notification("frody.body", opts);
        }
      }
    } catch (e) {}
    window.dispatchEvent(new CustomEvent("frody-reminder-fired", { detail: { id: item.id, body: body } }));
  }

  // ---------- programación en el dispositivo (Notification Triggers) ----------
  async function scheduleTriggers() {
    if (pushOn()) return;   // el servidor (Cloud Functions) ya los manda
    if (!TRIGGERS_OK) return;
    try {
      var reg = await navigator.serviceWorker.ready;
      var existing = await reg.getNotifications({ includeTriggered: true });
      existing.forEach(function (n) { if (n.tag && n.tag.indexOf("frody-") === 0) n.close(); });
      if (!cfg.master || Notification.permission !== "granted") return;
      cfg.items.filter(function (i) { return i.enabled; }).forEach(function (it) {
        occurrences(it, 14).forEach(function (ts) {
          var tag = "frody-" + it.id + "-" + new Date(ts).toISOString().slice(0, 10);
          try {
            reg.showNotification("frody.body", {
              body: BODIES[it.id] || it.label, tag: tag, icon: "icon-192.png", badge: "icon-192.png",
              showTrigger: new window.TimestampTrigger(ts), data: { id: it.id, url: "./" }
            });
          } catch (e) {}
        });
      });
    } catch (e) { console.warn("reminders triggers:", e); }
  }

  // ---------- disparo en primer plano (fallback iOS/sin triggers) ----------
  function tick() {
    if (pushOn()) return;    // el servidor (Cloud Functions) ya los manda
    if (TRIGGERS_OK) return; // ya programado en el dispositivo
    if (!cfg.master || !("Notification" in window) || Notification.permission !== "granted") return;
    var now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes(), today = ymd(now);
    var fired = loadFired(), changed = false;
    cfg.items.forEach(function (it) {
      if (!it.enabled) return;
      var m = meta(it.id);
      if (m && m.days !== "daily" && DAYNUM[m.days] !== undefined && now.getDay() !== DAYNUM[m.days]) return;
      var p = it.time.split(":"), sched = (+p[0]) * 60 + (+p[1]);
      if (fired[it.id] === today) return;
      // dispara si ya pasó la hora hoy y dentro de una ventana de 3h
      if (nowMin >= sched && (nowMin - sched) <= 180) { fire(it); fired[it.id] = today; changed = true; }
    });
    if (changed) saveFired(fired);
  }

  // ---------- puente con el push del servidor (app.js / Cloud Functions) ----------
  // considera también la flag persistida: al abrir la app, evita que el tick local
  // dispare un duplicado antes de que enablePush() vuelva a poner active=true.
  function pushOn() {
    if (window.frodyPush && window.frodyPush.active) return true;
    try { return localStorage.getItem("frody:push-active") === "1"; } catch (e) { return false; }
  }
  function pushAvail() { return !!(window.frodyPush && window.frodyPush.available && window.frodyPush.available()); }
  function cloudSync() {
    if (!window.frodyPush || !window.frodyPush.syncConfig) return;
    window.frodyPush.syncConfig({
      master: cfg.master,
      items: cfg.items.map(function (it) {
        var m = meta(it.id);
        return { id: it.id, time: it.time, enabled: it.enabled, days: (m && m.days) || "daily", body: BODIES[it.id] || "" };
      })
    });
  }

  // adopta la config del servidor en este dispositivo (sin subir nada)
  function adoptRemote(remote) {
    cfg.master = !!remote.master;
    var byId = {};
    (remote.items || []).forEach(function (x) { byId[x.id] = x; });
    cfg.items.forEach(function (it) {
      var r = byId[it.id];
      if (r) { if (r.time) it.time = r.time; it.enabled = !!r.enabled; }
    });
    save(); render();
  }

  // guarda local, sube la config al servidor y, SOLO si el push del servidor no
  // está activo, programa los avisos localmente (así nunca llegan duplicados).
  function reschedule() { save(); cloudSync(); if (!pushOn()) scheduleTriggers(); }

  // ---------- permiso ----------
  async function ensurePermission() {
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    try { return await Notification.requestPermission(); } catch (e) { return Notification.permission; }
  }

  // ---------- UI ----------
  function toggleBtn(on, label, onChange) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "tg" + (on ? " on" : "");
    b.setAttribute("role", "switch"); b.setAttribute("aria-checked", on ? "true" : "false");
    if (label) b.setAttribute("aria-label", label);
    b.onclick = function () { onChange(b); };
    return b;
  }

  function permissionText() {
    if (iosNeedsInstall()) return "en iPhone, instala la app primero (mira abajo)";
    if (!("Notification" in window)) return "tu navegador no soporta notificaciones";
    if (Notification.permission === "denied") return "bloqueadas · actívalas en ajustes del sitio";
    if (Notification.permission === "granted") {
      if (!cfg.master) return "permitidas · activa el interruptor";
      return pushOn() ? "activas · llegan con la app cerrada" : "activas · solo con la app abierta";
    }
    return "toca para permitir notificaciones";
  }

  function render() {
    var box = document.getElementById("remindersBox");
    if (!box) return;
    box.innerHTML = "";

    // iPhone sin instalar: el web push NO existe en Safari pestaña. Guía clara.
    if (iosNeedsInstall()) {
      var ios = document.createElement("div");
      ios.className = "rem-ios";
      ios.innerHTML =
        '<b>📱 En iPhone: instala la app para recibir notificaciones</b>' +
        '<ol><li>Toca <b>Compartir</b> (el cuadrito con la flecha ↑) en Safari.</li>' +
        '<li>Elige <b>“Agregar a inicio”</b>.</li>' +
        '<li>Abre frody.body <b>desde el ícono</b> nuevo.</li>' +
        '<li>Ahí entra a Ajustes → Recordatorios y activa <b>Notificaciones</b>.</li></ol>' +
        '<span>Safari no entrega avisos en segundo plano; solo la app instalada (iOS 16.4+).</span>';
      box.appendChild(ios);
    }

    // fila maestra
    var master = document.createElement("div");
    master.className = "row";
    master.innerHTML =
      '<span class="row-ic" style="--c:#5566F0"><span class="ms">notifications</span></span>' +
      '<div class="row-main"><span class="row-t">Notificaciones</span><span class="row-s" id="remPerm"></span></div>';
    var mtg = toggleBtn(cfg.master, "Activar notificaciones", async function (btn) {
      if (!cfg.master) {
        if (iosNeedsInstall()) { render(); return; }   // en iPhone hay que instalar primero
        var st = await ensurePermission();
        if (st !== "granted") { cfg.master = false; render(); return; }
        cfg.master = true;
        // registra el token push (servidor) si está configurado
        if (pushAvail()) { try { await window.frodyPush.enable(); } catch (e) {} }
      } else { cfg.master = false; }
      btn.classList.toggle("on", cfg.master);
      btn.setAttribute("aria-checked", cfg.master ? "true" : "false");
      reschedule(); render();
    });
    master.appendChild(mtg);
    box.appendChild(master);

    // filas de cada recordatorio
    cfg.items.forEach(function (it) {
      var m = meta(it.id);
      var row = document.createElement("div");
      row.className = "row rem-row";
      row.innerHTML =
        '<span class="row-ic" style="--c:' + m.color + '"><span class="ms">' + m.icon + '</span></span>' +
        '<div class="row-main"><span class="row-t">' + m.label + '</span><span class="row-s rem-sub">' + scheduleLabel(it) + '</span></div>';
      var ctl = document.createElement("div"); ctl.className = "rem-ctl";
      var time = document.createElement("input");
      time.type = "time"; time.className = "rem-time"; time.value = it.time; time.setAttribute("aria-label", "Hora · " + m.label);
      time.onchange = function () {
        if (/^\d{2}:\d{2}$/.test(time.value)) { it.time = time.value; row.querySelector(".rem-sub").textContent = scheduleLabel(it); reschedule(); }
      };
      var tg = toggleBtn(it.enabled, m.label, function (btn) {
        it.enabled = !it.enabled;
        btn.classList.toggle("on", it.enabled);
        btn.setAttribute("aria-checked", it.enabled ? "true" : "false");
        reschedule();
      });
      ctl.appendChild(time); ctl.appendChild(tg);
      row.appendChild(ctl);
      box.appendChild(row);
    });

    // botón de prueba (solo con push de servidor disponible y notificaciones activas)
    if (pushAvail() && cfg.master) {
      var test = document.createElement("button");
      test.type = "button";
      test.className = "rem-test";
      test.textContent = "Enviar notificación de prueba";
      test.onclick = async function () {
        test.disabled = true;
        var old = test.textContent;
        test.textContent = "Enviando…";
        try { if (window.frodyPush && window.frodyPush.test) await window.frodyPush.test(); } catch (e) {}
        test.textContent = old; test.disabled = false;
      };
      box.appendChild(test);
    }

    // nota honesta sobre la entrega
    var note = document.createElement("div");
    note.className = "rem-note";
    if (iosNeedsInstall()) {
      note.textContent = "Mientras uses Safari sin instalar, los avisos NO llegan con la app cerrada (limitación de Apple).";
    } else if (pushOn()) {
      note.textContent = "Push del servidor activo: los avisos llegan aunque cierres la app.";
    } else if (pushAvail()) {
      note.textContent = "Activa Notificaciones para recibir los avisos con la app cerrada (push del servidor).";
    } else {
      note.textContent = TRIGGERS_OK
        ? "Programadas en tu dispositivo: llegan aunque cierres la app."
        : "Tu navegador solo entrega los avisos con la app abierta.";
    }
    box.appendChild(note);

    // diagnóstico (para saber por qué no llegan): plataforma · instalada · permiso · push
    var diag = document.createElement("div");
    diag.className = "rem-diag";
    var perm = ("Notification" in window) ? Notification.permission : "no-soportado";
    diag.textContent = "estado · " +
      (IS_IOS ? "iOS" : "navegador") + " · " +
      (isStandalone() ? "instalada" : "sin instalar") + " · permiso: " + perm +
      " · push servidor: " + (pushOn() ? "activo ✓" : (pushAvail() ? "disponible" : "no")) +
      (pushOn() ? "" : " · modo local (solo app abierta)");
    box.appendChild(diag);

    var permEl = document.getElementById("remPerm");
    if (permEl) permEl.textContent = permissionText();
  }

  // ---------- init ----------
  function init() {
    render();
    // primer plano: revisa cada 30 s (solo hace algo si no hay push ni triggers)
    setInterval(tick, 30 * 1000);
    tick();
    // refresca la ventana de programación al volver a la app
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") { scheduleTriggers(); tick(); render(); }
    });
    // cuando app.js entra en modo nube: NO pisar la config del servidor.
    // - si este dispositivo nunca tocó los recordatorios (config virgen) y el
    //   servidor ya tiene una config, la ADOPTAMOS (no subimos nada). Así abrir
    //   la app en el PC ya no apaga el push que configuraste en el teléfono.
    // - si este dispositivo tiene config propia, la subimos (acción previa del
    //   usuario aquí).
    window.addEventListener("frody-push-ready", async function () {
      try {
        if (!isTouched() && window.frodyPush && window.frodyPush.readConfig) {
          var remote = await window.frodyPush.readConfig();
          if (remote) adoptRemote(remote);
        } else if (isTouched()) {
          cloudSync();
        }
      } catch (e) { console.warn("reminders sync:", e); }
      if (cfg.master && pushAvail()) { try { await window.frodyPush.enable(); } catch (e) {} }
      render();
    });
    if (cfg.master && !pushOn()) scheduleTriggers();
  }

  // expone hooks mínimos para pruebas (no afecta el uso normal)
  window.frodyReminders = { tick: tick, render: render, config: function () { return cfg; }, fire: fire };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
