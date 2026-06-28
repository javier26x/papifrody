// =============================================================================
// ui.js — navegación por tabs + tema claro/oscuro.
// Es puramente de presentación: NO toca los datos ni Firebase. Se comunica con
// app.js sólo por eventos (frody-tab / frody-theme) para re-dibujar el gráfico.
// =============================================================================
(function () {
  "use strict";
  var THEME_KEY = "frody:theme";
  var TAB_KEY = "frody:tab";
  var root = document.documentElement;

  function currentTheme() { return root.getAttribute("data-theme") === "dark" ? "dark" : "light"; }

  function applyTheme(t, persist) {
    t = t === "dark" ? "dark" : "light";
    root.setAttribute("data-theme", t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#0f1117" : "#eef0f5");
    var icon = document.getElementById("themeIcon");
    if (icon) icon.textContent = t === "dark" ? "light_mode" : "dark_mode";
    document.querySelectorAll("[data-theme-btn]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-theme-btn") === t ? "true" : "false");
    });
    if (persist) { try { localStorage.setItem(THEME_KEY, t); } catch (e) {} }
    window.dispatchEvent(new CustomEvent("frody-theme"));
  }
  function toggleTheme() { applyTheme(currentTheme() === "dark" ? "light" : "dark", true); }

  function showTab(name, persist) {
    var exists = document.querySelector('[data-panel="' + name + '"]');
    if (!exists) name = "hoy";
    document.querySelectorAll("[data-panel]").forEach(function (p) {
      p.hidden = p.getAttribute("data-panel") !== name;
    });
    document.querySelectorAll("[data-tab]").forEach(function (t) {
      var on = t.getAttribute("data-tab") === name;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    var sc = document.querySelector(".content");
    if (sc) sc.scrollTop = 0;
    if (persist) { try { localStorage.setItem(TAB_KEY, name); } catch (e) {} }
    window.dispatchEvent(new CustomEvent("frody-tab", { detail: name }));
  }

  function init() {
    // el tema ya lo fijó el script inline del <head>; aquí sólo sincronizamos la UI
    applyTheme(currentTheme(), false);

    var tbtn = document.getElementById("themeBtn");
    if (tbtn) tbtn.addEventListener("click", toggleTheme);
    document.querySelectorAll("[data-theme-btn]").forEach(function (b) {
      b.addEventListener("click", function () { applyTheme(b.getAttribute("data-theme-btn"), true); });
    });

    document.querySelectorAll("[data-tab]").forEach(function (t) {
      t.addEventListener("click", function () { showTab(t.getAttribute("data-tab"), true); });
    });

    var start = "hoy";
    try { start = localStorage.getItem(TAB_KEY) || "hoy"; } catch (e) {}
    showTab(start, false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
