# Kai

Reproductor web para ver las series y películas de anime guardadas en una cuenta de MEGA. Funciona en el navegador de la PC, Mac, iPhone, iPad y Android, sin servidores propios: todo pasa entre el navegador y MEGA.

**Abrir:** https://alexmusus.github.io/kai/ y entrar con la cuenta de MEGA.

## Qué hace

- **Perfiles** tipo Netflix, cada uno con su propio progreso, sincronizado entre dispositivos.
- **Biblioteca** armada desde la carpeta `Anime` de MEGA: cada carpeta es una serie y sus subcarpetas son temporadas. Una carpeta `Peliculas` se muestra como colección.
- **Sinopsis e imágenes** de AniList para cada serie y película.
- **Inicio** con lo agregado recientemente y búsqueda rápida (la lupa).
- **Catálogo** con buscador y filtros por género, año y tipo. El año, el tipo y los géneros de cada ficha son botones que llevan al catálogo filtrado.
- **Reproductor propio:** marcas de capítulos, ±10 s, velocidad, subtítulos, ventana flotante, pantalla completa, salta la intro sola y pasa al siguiente capítulo.
- **Gestos en el teléfono:** doble toque a los lados para ±10 s, mantener presionado para 2×, deslizar abajo para el mini reproductor y, en pantalla completa, deslizar para el brillo.
- **Mini reproductor:** el video sigue sonando mientras navegas por Kai.
- **Rápido:** lo ya visto queda en memoria (retroceder no gasta cuota de MEGA) y prepara el inicio del siguiente capítulo.
- **Descargas sin conexión,** de uno en uno o varios a la vez. En Chrome y Edge se pueden guardar en una carpeta como MP4.
- **Aviso** de capítulos nuevos, del uso de la cuota de MEGA y de cuando hay una versión nueva de Kai (también se puede buscar en Ajustes).

## Notas

- La cuota de transferencia de MEGA gratis se renueva sola en unas horas; ver y descargar cuentan para ella.
- En iPhone, conviene agregar Kai a la pantalla de inicio (Compartir → Agregar a pantalla de inicio): se ve en pantalla completa y iOS no borra las descargas.
- Probarla en local: en la carpeta del proyecto, `python3 -m http.server 8000` y abrir http://localhost:8000.
