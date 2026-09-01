# Atlas

Atlas es una aplicación personal de hábitos, tareas y rutinas para Android 16. Es local-first, no tiene anuncios ni funciones de pago y puede funcionar sin cuenta ni conexión.

La interfaz usa una identidad propia: grafito, trayectorias finas y un único waypoint coral.

## Incluye

- Hábitos de sí/no, cantidad acumulable y duración con cronómetro.
- Repetición por días, franjas diarias, intervalos y cuotas semanales o mensuales.
- Tareas únicas o recurrentes, prioridad, fecha límite y checklist.
- Rutinas ordenadas con modo guiado, pasos opcionales y temporizadores.
- Historial corregible, días omitidos, pausas y margen de cierre.
- Progreso, rachas y estadísticas sin gamificación invasiva.
- Recordatorios exactos con acciones **Completar** y **Posponer**.
- Widgets de progreso, hábitos y próximas tareas.
- Datos locales en SQLite y sincronización opcional con Google/Firebase.
- Actualizaciones firmadas desde GitHub Releases.

## Requisitos

- Android 16 / API 36.
- Node.js 24.19 o posterior.
- JDK 17.
- Android SDK 36 para compilación local.

## Desarrollo

```bash
npm ci
npm run prebuild
npm run android
```

Expo Go no sirve para este proyecto porque Atlas integra widgets, alarmas exactas y un módulo nativo de actualización. Usa un development build.

Comprobaciones:

```bash
npm run typecheck
npm run lint
npm test
```

## Datos y sincronización

SQLite es siempre la fuente de verdad. La aplicación arranca y conserva todas las funciones locales aunque Firebase no esté configurado.

Para activar la cuenta de Google y la sincronización opcional:

1. Crea un proyecto gratuito en Firebase.
2. Registra la aplicación Android `atlas_habits.com`.
3. Activa Google como proveedor de Authentication y crea Firestore.
4. Copia `.env.example` a `.env.local` y rellena las variables públicas de Firebase.
5. Guarda `google-services.json` fuera del repositorio y define `ATLAS_GOOGLE_SERVICES_FILE` con su ruta antes de ejecutar `expo prebuild`.

Atlas no necesita Firebase Functions, Storage, Analytics ni un plan de pago. Consulta [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para el protocolo local-first y sus límites.

## APK firmado y GitHub Releases

El workflow `.github/workflows/android-release.yml` construye un APK `arm64-v8a` para el dispositivo objetivo, verifica su firma, genera `atlas.apk.sha256` y publica ambos archivos en una GitHub Release.

Configura estos secretos en el entorno `android-release` del repositorio:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

La cuenta es opcional para quien use la app, pero la APK oficial incluye esa
capacidad. Añade también el secreto `GOOGLE_SERVICES_JSON_BASE64`. El workflow deriva de ese JSON todos
los identificadores públicos de Firebase y Google. Las reglas aíslan los datos
por el UID de cada cuenta autenticada. Si omites el JSON, el release falla antes
de compilar. Consulta
[docs/RELEASING.md](docs/RELEASING.md) para los valores validados.

Después incrementa `version` en `package.json` y `app.config.ts`, aumenta
`android.versionCode`, crea un tag que coincida con la versión y súbelo:

```bash
git tag v0.1.1
git push origin v0.1.1
```

La clave de firma no se puede sustituir después sin romper las actualizaciones instaladas. Haz una copia cifrada fuera de GitHub.
`android.versionCode` también debe aumentar en cada Release. El proceso completo,
incluida la creación y verificación de la clave, está en
[docs/RELEASING.md](docs/RELEASING.md).

El CI también regenera el proyecto nativo sin Firebase y compila un APK debug
con Android API 36. Así detecta errores de Gradle, Kotlin, widgets y config
plugins antes de crear una etiqueta de Release.

## Privacidad

El uso sin cuenta no envía datos personales a ningún servidor. La sincronización solo se activa por decisión del usuario. Consulta [PRIVACY.md](PRIVACY.md).

## Estado del proyecto

Atlas está preparada como aplicación personal y repositorio público. Antes de distribuir el APK a más dispositivos, revisa los requisitos vigentes de verificación de desarrolladores de Android y prueba la actualización en un dispositivo secundario.
