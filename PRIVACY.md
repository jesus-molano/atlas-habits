# Privacidad de Atlas

Última actualización: 31 de agosto de 2026.

Atlas está diseñada para uso personal. Sin una cuenta conectada, los hábitos, tareas, rutinas, notas, recordatorios e historial se guardan únicamente en el dispositivo mediante SQLite.
Atlas desactiva Android Auto Backup para que esa base de datos no se copie a la
cuenta de copia de seguridad del sistema.

## Sincronización opcional

Si el usuario activa **Acceder con Google y sincronizar**, Atlas recibe el identificador de la cuenta, nombre, correo y foto que Google facilite, y copia los datos de Atlas al proyecto Firebase configurado por el propio responsable de la instalación. Esos datos se usan solo para autenticar y sincronizar dispositivos.

Atlas no integra publicidad, analítica de comportamiento, venta de datos ni seguimiento entre aplicaciones.

## Permisos de Android

- **Notificaciones:** mostrar recordatorios y sus acciones.
- **Alarmas exactas:** entregar recordatorios a la hora elegida, incluso en reposo.
- **Instalar paquetes:** abrir la actualización de APK solicitada por el usuario.
- **Internet:** sincronización opcional y comprobación manual de GitHub Releases.

La compilación de Release bloquea tráfico HTTP sin cifrar; las conexiones de
sincronización y actualización usan HTTPS.

Los widgets leen el mismo almacenamiento local de Atlas. No envían información por sí mismos.

## Control y eliminación

El usuario puede corregir o borrar contenido desde la aplicación. Al desconectar la cuenta, la copia local se conserva para que Atlas siga funcionando. La eliminación de la copia remota se debe ejecutar desde la opción correspondiente antes de desconectar o desde el proyecto Firebase que aloja los datos.

## Cambios

Las modificaciones de esta política se publican junto con el código y las Releases del repositorio de Atlas.
