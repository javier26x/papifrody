/* firebase-messaging-sw.js — recibe los push de FCM cuando la app está cerrada.
   El SDK de FCM registra ESTE worker automáticamente (scope propio), aparte del
   sw.js que cachea la app. La config va inline (un worker clásico no puede
   importar el módulo ES firebase-config.js); estas claves son públicas. */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyASVNx7goELmi4R9tYaM0VrhA9fNf2zO70",
  authDomain: "papifrody.firebaseapp.com",
  projectId: "papifrody",
  storageBucket: "papifrody.firebasestorage.app",
  messagingSenderId: "479189128043",
  appId: "1:479189128043:web:53ef06facf11c526bf722e"
});

const messaging = firebase.messaging();

// mensajes en segundo plano (app cerrada / pestaña oculta)
messaging.onBackgroundMessage(function (payload) {
  const d = (payload && (payload.data || payload.notification)) || {};
  const title = d.title || "frody.body";
  self.registration.showNotification(title, {
    body: d.body || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: d.tag || "frody-reminder",
    renotify: true,
    data: { url: (payload.fcmOptions && payload.fcmOptions.link) || d.url || "./" }
  });
});

// al tocar la notificación: enfoca o abre la app
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
