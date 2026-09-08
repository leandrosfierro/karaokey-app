# Nuevo estudio Karaokey

La página principal y `/estudio` usan el nuevo diseño con Supabase Auth y las listas
existentes de cada cuenta. `/clasico` conserva la interfaz anterior y herramientas
especializadas, incluidas las importaciones por canal y la antigua cola manual.
No se incluyen `/prueba`, sus endpoints ni su base SQLite en la publicación.

## Funciones

- Mi fiesta, Próximos turnos, Biblioteca, Escenario y guía de primeros pasos.
- Simple/Pro, dúos, sorteo con canción o solo cantantes, exclusión de personas que
  ya cantaron o tienen turno reservado, nueva ronda y selección manual.
- Pedidos por QR: activación, desactivación, regeneración y enlace compartible.
- Turnos aprobados con nombres separados para dúos; retirada y restauración.
- Biblioteca de versiones exactas, búsqueda modal, importación de playlists,
  asociación de versión a canciones antiguas y eliminación confirmada.
- Preparación e inicio en A/B; salida pública de YouTube como reproductor principal
  y controles remotos en la ventana del organizador.
- Nombre/aplausos, cierre automático tras reproducción real, celebración y navegación
  a próximos turnos o sorteo. Inicio/cierre se validan en Supabase por propietario.

## Preparación de datos

Aplicar `database/stage-two.sql` después de stage-one. Es aditiva: conserva las
filas anteriores y permite almacenar ambos nombres del dúo. Se probó en una
transacción revertida el inicio solo-cantantes de un dúo y la finalización de ambos.

## Límites de plataforma

La pantalla de emisión utiliza otra ventana del **mismo navegador/equipo**. Los
invitados por QR usan Internet y no necesitan esa misma red. No se promete latencia
cero: la salida reproduce el medio y comunica su estado al control. Los archivos
locales siguen sonando en el equipo del organizador; YouTube no permite tono/tempo
y su volumen tiene restricciones en iOS. Probar el audio y permisos en el equipo
del evento antes de emitir. No hay gestión de múltiples fiestas simultáneas por
una misma cuenta; cada anfitrión dispone de su espacio independiente.

## Verificación

Lint, TypeScript, compilación limpia sin rutas de prueba y pruebas de transporte/
volúmenes. Prueba de interfaz previa: cuenta vacía, versión exacta, inicio, pausa
remota y fin automático. La nueva migración verifica ambos integrantes del dúo.
Para volver a la interfaz anterior sin perder datos, usar `/clasico`.
