# Seguridad

No publiques claves de firma, `google-services.json`, credenciales de Firebase ni datos exportados de Atlas en una incidencia.

Para informar de una vulnerabilidad, usa un aviso privado de seguridad de GitHub cuando el repositorio lo tenga habilitado. Incluye versión, dispositivo, pasos de reproducción e impacto. No adjuntes una base de datos real sin eliminar antes los datos personales.

Las Releases oficiales deben contener `atlas.apk` y `atlas.apk.sha256`. El
workflow compara el certificado del APK con el certificado de la clave de
Release, comprueba package name y `versionCode`, y rechaza APKs depurables.
Comprueba el SHA-256 antes de instalar manualmente.
