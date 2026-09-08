# Primera entrega: turnos y escenario

## Incluido

- Pedidos del público pendientes de aprobación, retiro/restauración e historial de turnos finalizados.
- Orden por aprobación; lista debajo del botón de pantalla completa.
- Preparación explícita del video elegido en Deck A/B, sin iniciar la actuación al buscar.
- Video exacto conservado al guardar en el cancionero personal, sin sobrescribir la caché compartida.
- Nombre del cantante y aplausos arriba del reproductor, también en pantalla completa y salida pública.
- Inicio y cierre de actuaciones con validación de propietario y exclusión de inicios simultáneos.
- Finalización o devolución del turno; votos cerrados al finalizar y actualización de respaldo cada cuatro segundos.

## Base de datos

`database/stage-one.sql` documenta la migración aditiva
`stage_one_queue_and_performance_lifecycle`, aplicada a Supabase antes de publicar.
No borra datos previos. Las operaciones del organizador usan SECURITY INVOKER,
RLS y auth.uid(); el acceso público conserva las funciones específicas de participación.

Se verificaron en una transacción revertida: aislamiento entre propietarios,
aprobación, video exacto, actuación única, cierre, aplausos únicos y bloqueo de votos posteriores.
También se comprobó mediante interfaz el inicio de un turno, preparación en B y
actualización de aplausos en pantalla completa con una cuenta temporal.

## Separación de entornos

Los archivos de `/prueba`, sus API y su base SQLite siguen siendo locales.
No deben incluirse en esta entrega. Validar la compilación desde un checkout limpio
del commit publicado, no desde el directorio que contiene esos archivos sin seguimiento.

## Pendiente para otra entrega

- Reproductor de la pantalla pública como única fuente de audio/video y control remoto.
- Celebración automática al finalizar el video y navegación automática posterior.
- El diseño integral experimental de `/prueba`.

La salida pública actual continúa con reproductores sincronizados: esta entrega
no promete latencia cero ni cambia las limitaciones de YouTube/iOS.
