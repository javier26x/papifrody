# frody.body

Registro diario de peso, cintura, hábitos (6 pilares), Mounjaro y suplementos —
ahora con **sincronización en la nube** (Firebase) entre teléfono y notebook,
login con Google y soporte offline. Instalable como app (PWA).

> Migrado desde el `frodybody.html` original (localStorage de un solo archivo) a
> un proyecto Firebase deployable, conservando el diseño y agregando sync,
> auth, metas configurables y respaldo/restauración.

---

## Qué cambió respecto al original

- **Sync en la nube** con Firestore: tus datos viven bajo tu usuario y aparecen
  en cualquier dispositivo donde entres. Sync en vivo (`onSnapshot`).
- **Login con Google** (Firebase Auth). Sin sesión, sigue funcionando en modo
  local en ese dispositivo.
- **Offline-first**: persistencia local de Firestore + service worker. Registras
  sin red y se sincroniza al volver.
- **Migración de datos**: si tienes registros locales del archivo viejo, la app
  te ofrece subirlos a tu cuenta. También hay **Importar JSON** para tu backup.
- **Meta configurable**: peso inicial y meta editables (antes estaban fijos en
  132.9 → 100).
- **Mejoras de código**: arreglo de fugas de memoria del gráfico (instancia
  reutilizada, un solo listener de resize), comparaciones numéricas correctas,
  toggles accesibles (botones con `role="switch"` y teclado), escrituras
  *debounced* (menos writes a Firestore), indicador de estado de sync.
- **PWA**: `manifest.webmanifest`, iconos y service worker → instalable.

---

## Estructura

```
.
├── firebase.json            # hosting + firestore + emuladores
├── .firebaserc              # alias del proyecto (cambia "frody-body")
├── firestore.rules          # cada usuario solo accede a SUS datos
├── firestore.indexes.json
└── public/
    ├── index.html
    ├── styles.css
    ├── app.js               # lógica (módulo ES, Firebase por import dinámico)
    ├── firebase-config.js   # ← pega aquí tu config web
    ├── manifest.webmanifest
    ├── sw.js                # service worker (app-shell)
    └── icon-180/192/512.png
```

## Modelo de datos (Firestore)

```
users/{uid}/days/{YYYY-MM-DD}   → un documento por día
users/{uid}/meta/profile        → { startWeight, goal }
```

---

## Puesta en marcha

### 1. Crea el proyecto Firebase
1. https://console.firebase.google.com → **Add project**.
2. **Build → Authentication → Get started → Sign-in method →** habilita **Google**.
3. **Build → Firestore Database → Create database** (modo *production*).
4. **Project settings → Your apps → Web (`</>`)** y copia el objeto `firebaseConfig`.

### 2. Pega tu config
Edita `public/firebase-config.js` y reemplaza los `TODO_*` con tus valores reales.
(La `apiKey` web **no** es secreta; la seguridad está en `firestore.rules`.)

### 3. Apunta el proyecto
Edita `.firebaserc` y cambia `"frody-body"` por el **Project ID** real.

### 4. Instala la CLI y haz deploy
```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,hosting
```

Tu app queda en `https://TU-PROYECTO.web.app`. Para usar tu dominio
(`frody.cl`): **Hosting → Add custom domain**.

### Probar localmente con emuladores (opcional)
```bash
firebase emulators:start
```
Abre `http://localhost:5000`.

---

## Notas de seguridad

- Las reglas (`firestore.rules`) solo permiten que cada usuario lea/escriba
  `users/{su-uid}/**`. Haz `firebase deploy --only firestore:rules` tras cualquier cambio.
- Restringe la `apiKey` web por dominio en **Google Cloud Console → APIs &
  Services → Credentials** para producción.
- Autoriza tu dominio en **Authentication → Settings → Authorized domains** para
  que funcione el login con Google.

## Acceso privado (un solo usuario)

La app exige login **antes de ver o guardar nada** y solo permite **una cuenta**,
reforzado en dos capas:

- **Cliente:** `ALLOWED_EMAIL` en `public/app.js`. Otra cuenta se desconecta sola
  y ve un gate de "app privada".
- **Reglas:** `firestore.rules` solo concede acceso si
  `request.auth.token.email == 'javier.neo@gmail.com'` y el email está verificado.
  Esta es la barrera real (la UI por sí sola no protege los datos).

Para cambiar la cuenta autorizada, edita **ambos** lugares (la constante en
`app.js` y el email en `firestore.rules`) y vuelve a desplegar
`firebase deploy --only hosting,firestore:rules`.

## Respaldo
- **↓ Excel** / **↓ Backup JSON**: exportan todos tus registros.
- **↑ Importar JSON**: restaura un backup (formato del export original o `{fecha: {...}}`).
