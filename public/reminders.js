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
    { id: "ashwa",  label: "Ashwagandha",            icon: "medication",     color: "#8b5cf6", time: "10:00", days: "daily" },
    { id: "lunch",  label: "Suplementos · almuerzo", icon: "restaurant",     color: "#23a56a", time: "13:30", days: "daily" },
    { id: "water",  label: "Agua + electrolitos",    icon: "water_drop",     color: "#2bb7d9", time: "15:00", days: "daily" },
    { id: "omega",  label: "Omega 3 · cena",         icon: "set_meal",       color: "#e0922a", time: "20:30", days: "daily" },
    { id: "mag",    label: "Magnesio",               icon: "bedtime",        color: "#6f7df6", time: "21:00", days: "daily" },
    { id: "inject", label: "Inyección Mounjaro",     icon: "vaccines",       color: "#ef6b53", time: "09:00", days: "mon"   },
    { id: "weekly", label: "Bonal D + Neurobión",    icon: "event",          color: "#1ea8a0", time: "11:00", days: "sun"   },
    { id: "log",    label: "Registrar el día",       icon: "edit_note",      color: "#9aa0ac", time: "21:30", days: "daily" }
  ];
  var BODIES = {
    weigh:  "Pésate al despertar y registra el peso 📉",
    ashwa:  "Ashwagandha KSM-66 450 mg — abre tu ventana de comida 🧘",
    lunch:  "Con el almuerzo: Omega 3, Zinc, Whey y Vit D3 💊 (Psyllium 15 min antes)",
    water:  "Hora de agua + electrolitos 💧",
    omega:  "Omega 3 con la cena (con grasa) 🐟",
    mag:    "Magnesio bisglicinato 168 mg 🌙",
    inject: "Hoy es día de inyección · Mounjaro 5 mg 💉",
    weekly: "Domingo: Bonal D (gotas) + Neurobión (inyección) 📅",
    log:    "¿Ya registraste tu día en frody.body? ✍️"
  };
  // mapeo de día → número/nombre (soporta cualquier día de la semana)
  var DAYNUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  var DAYNAME = { sun: "Domingo", mon: "Lunes", tue: "Martes", wed: "Miércoles", thu: "Jueves", fri: "Viernes", sat: "Sábado" };

  var TRIGGERS_OK = (typeof window !== "undefined") && (typeof window.TimestampTrigger !== "undefined") &&
    ("serviceWorker" in navigator) && ("Notification" in window);

  // ---------- estado / persistencia ----------
  function defaults() {
    return { master: false, items: DEFAULTS.map(function (d) { return { id: d.id, time: d.time, enabled: false }; }) };
  }
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
            return { id: d.id, time: saved.time || d.time, enabled: !!saved.enabled };
          })
        };
      }
    } catch (e) {}
    return defaults();
  }
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
  function pushOn() { return !!(window.frodyPush && window.frodyPush.active); }
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
    if (!("Notification" in window)) return "tu navegador no soporta notificaciones";
    if (Notification.permission === "denied") return "bloqueadas en el navegador · actívalas en ajustes del sitio";
    if (Notification.permission === "granted") return cfg.master ? "activadas" : "permitidas · activa el interruptor";
    return "toca para permitir notificaciones";
  }

  function render() {
    var box = document.getElementById("remindersBox");
    if (!box) return;
    box.innerHTML = "";

    // fila maestra
    var master = document.createElement("div");
    master.className = "row";
    master.innerHTML =
      '<span class="row-ic" style="--c:#5566F0"><span class="ms">notifications</span></span>' +
      '<div class="row-main"><span class="row-t">Notificaciones</span><span class="row-s" id="remPerm"></span></div>';
    var mtg = toggleBtn(cfg.master, "Activar notificaciones", async function (btn) {
      if (!cfg.master) {
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
    if (pushAvail()) {
      note.textContent = pushOn()
        ? "Push del servidor activo: los avisos llegan con la app cerrada en cualquier dispositivo (en iPhone, instala la app en la pantalla de inicio)."
        : "Push del servidor disponible: activa Notificaciones para recibir los avisos con la app cerrada.";
    } else {
      note.textContent = TRIGGERS_OK
        ? "Programadas en tu dispositivo: llegan aunque cierres la app. Instálala para que no se borren."
        : "Tu navegador (p. ej. iPhone) solo entrega los avisos con la app abierta. Para recibirlos cerrada, ábrela en Android/Chrome o instálala.";
    }
    box.appendChild(note);

    var perm = document.getElementById("remPerm");
    if (perm) perm.textContent = permissionText();
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
    // cuando app.js entra en modo nube: sube la config y registra el token push
    window.addEventListener("frody-push-ready", async function () {
      cloudSync();
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
