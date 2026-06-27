// ---------------------------------------------------------------------------
// Configuración de tu proyecto Firebase.
//
// 1. Crea un proyecto en https://console.firebase.google.com
// 2. Agrega una "Web app" (</>) y copia el objeto firebaseConfig que te da.
// 3. Pega esos valores acá abajo (reemplaza los TODO).
// 4. En la consola: Authentication → Sign-in method → habilita "Google".
// 5. Firestore Database → crea la base (modo producción) y haz deploy de las
//    reglas con `firebase deploy --only firestore:rules`.
//
// Nota: estas claves NO son secretas. La apiKey web de Firebase es pública por
// diseño; la seguridad real vive en firestore.rules (cada quien ve solo lo suyo).
// Aun así, en producción restringe la apiKey por dominio en Google Cloud Console.
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: "AIzaSyASVNx7goELmi4R9tYaM0VrhA9fNf2zO70",
  authDomain: "papifrody.firebaseapp.com",
  projectId: "papifrody",
  storageBucket: "papifrody.firebasestorage.app",
  messagingSenderId: "479189128043",
  appId: "1:479189128043:web:53ef06facf11c526bf722e"
};

// Devuelve true si todavía no pegaste tu config real. En ese caso la app corre
// en "modo local" (localStorage), exactamente como el archivo original.
export function isConfigured() {
  return !Object.values(firebaseConfig).some(function (v) {
    return typeof v !== "string" || v.indexOf("TODO_") === 0;
  });
}
