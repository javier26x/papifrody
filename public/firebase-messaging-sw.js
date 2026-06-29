/* firebase-messaging-sw.js — recibe los push de FCM con la app CERRADA.
   El SDK de FCM registra este worker automáticamente. Como el servidor envía un
   payload `webpush.notification`, el navegador lo MUESTRA solo (incluido iOS) y
   abre `fcmOptions.link` al tocarlo — no hace falta código extra y así no se
   duplican notificaciones. La config va inline (las claves web son públicas). */
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

// inicializa messaging en el worker: habilita el despliegue automático de los
// mensajes `notification` en segundo plano y el click hacia fcmOptions.link.
firebase.messaging();
