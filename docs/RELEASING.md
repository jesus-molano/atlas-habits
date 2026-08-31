# Publicar Atlas para Android

Atlas se distribuye como APK universal desde GitHub Releases. El workflow solo
acepta etiquetas estables con formato `vMAJOR.MINOR.PATCH` y exige que coincidan
con `package.json` y `app.config.ts`.

## 1. Crear y custodiar la clave

Crea la clave una sola vez en un equipo de confianza:

```bash
keytool -genkeypair -v \
  -storetype JKS \
  -keystore atlas-release.jks \
  -alias atlas \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

Guarda el JKS y sus contraseñas en dos copias cifradas fuera del repositorio.
Registra las huellas SHA-1 y SHA-256 que muestra este comando:

```bash
keytool -list -v -keystore atlas-release.jks -alias atlas
```

La misma huella SHA-256 se usa para el registro de desarrollador de Android y
la misma clave debe firmar todas las actualizaciones futuras.

## 2. Configurar el entorno de GitHub

Crea un entorno de Actions llamado `android-release`. Añade estos secretos
obligatorios:

- `ANDROID_KEYSTORE_BASE64`: contenido Base64 del JKS, sin modificarlo.
- `ANDROID_KEYSTORE_PASSWORD`.
- `ANDROID_KEY_ALIAS`.
- `ANDROID_KEY_PASSWORD`.

En GNU/Linux puedes generar el primer valor con:

```bash
base64 -w 0 atlas-release.jks
```

## 3. Incluir la sincronización opcional en la APK

La cuenta sigue siendo opcional para quien use Atlas, pero la APK oficial debe
incluir Google Sign-In y Firebase. Añade al mismo entorno el secreto
`GOOGLE_SERVICES_JSON_BASE64`, generado a partir del `google-services.json` de
la aplicación `atlas_habits.com`. El workflow deriva del JSON la API key, el
project ID, el app ID, el sender ID, el auth domain y el OAuth client web. No
hay que copiarlos a variables de GitHub.

Los valores `EXPO_PUBLIC_*` son identificadores públicos integrados en el APK;
nunca pongas allí un secreto OAuth, una cuenta de servicio o una clave privada.
El workflow valida el proyecto `atlas-habits`, el app ID, el package name, el
OAuth client web y las huellas de la clave de release antes de compilar. Si no
se configura el JSON, el release falla antes de compilar.

Las reglas de Firestore exigen acceso con Google y comparan siempre
`request.auth.uid` con el UID de la ruta `users/{userId}`. Cada cuenta queda
aislada en su propio espacio y la primera APK puede sincronizar sin publicar
otra versión para fijar un UID.

## 4. Publicar

Actualiza los tres valores antes de crear la etiqueta:

- `version` en `package.json`, siguiendo SemVer.
- `version` en `app.config.ts`, con el mismo valor.
- `android.versionCode` en `app.config.ts`, con un entero mayor que el de todas
  las Releases anteriores.

Después ejecuta:

```bash
npm ci
npm run typecheck
npm test
git tag v0.1.0
git push origin v0.1.0
```

El workflow genera el proyecto nativo, compila con Android SDK 36, firma el APK
y comprueba la huella pública fijada, package name, `versionName`,
`versionCode` y ausencia del flag debuggable. Solo después crea o actualiza de
forma idempotente la Release con `atlas.apk` y `atlas.apk.sha256`.

## 5. Verificar una descarga

Descarga los dos archivos de la misma Release y ejecuta:

```bash
sha256sum --check atlas.apk.sha256
apksigner verify --verbose --print-certs atlas.apk
```

La primera instalación requiere autorizar la fuente de instalación en Android.
Las actualizaciones posteriores deben conservar package name y certificado; el
actualizador de Atlas también exige un `versionCode` superior y confirmación
visible del sistema.
