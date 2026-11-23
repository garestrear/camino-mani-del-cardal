# Camino Maní del Cardal

Primera versión de la app comunitaria de pavimentación en Maní del Cardal, Amagá. La portada muestra 1,4 km como longitud estimada. El avance se calcula sobre los tramos registrados por el equipo. Los aportes recibidos se muestran como totales de bultos de cemento, pesos colombianos y horas de trabajo.

## Vista previa

Ejecuta `python3 -m http.server 8000 --directory public` y abre http://localhost:8000. Mientras falte la configuración se muestra una vista previa sin cifras inventadas.

## Conectar mani project

1. Ejecuta `supabase/001_inicio.sql` en el editor SQL del proyecto de Supabase. La migración se aplica una sola vez.
2. En Authentication → Users crea la cuenta que usará la persona coordinadora. Copia su UID y ejecuta `insert into public.coordinadores (usuario) values ('UID_DE_AUTH');`, sustituyendo el valor.
3. En `public/config.js` pega la URL del proyecto, sin barra final, y la clave publicable de Supabase. Usa únicamente la clave que comienza con `sb_publishable_`.
4. Si el comité tiene un canal público para recibir aportes o anécdotas, agrega su enlace HTTPS en `contactUrl`.

La página pública muestra tramos, necesidades activas, historias publicadas y sumas de aportes. Las notas de aportes son privadas. La sección Administración permite registrar y editar las cuatro clases de datos. La sesión se mantiene en memoria mientras la página esté abierta. Las anécdotas se guardan como borradores salvo que se marque Publicar.

## GitHub y Vercel

Importa el repositorio `garestrear/camino-mani-del-cardal` a Vercel desde la cuenta universitaria. La configuración de Vercel publica solo `public/`, por lo que la migración y este README quedan en el repositorio. Abre la URL de Vercel, inicia sesión con la cuenta coordinadora y prueba un registro desde el panel. Verifica en una ventana privada que solo aparezcan los datos públicos.
