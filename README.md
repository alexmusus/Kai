# Kai

Reproductor web para ver las series y películas de anime guardadas en una cuenta de MEGA. Funciona en el navegador de la PC, Mac, iPhone, iPad y Android, sin servidores propios: todo pasa entre el navegador y MEGA.

## Qué hace

- **Perfiles** tipo Netflix, cada uno con su propio progreso, sincronizado entre dispositivos.
- **Biblioteca** armada desde la carpeta `Anime` de MEGA: cada carpeta es una serie y sus subcarpetas son temporadas. Una carpeta `Peliculas` se muestra como un estante de pósters, y cada película (una subcarpeta o un archivo suelto) tiene su propia página con imagen y sinopsis; en el catálogo y la búsqueda salen sueltas.
- **Temporadas, siempre con la misma forma:** cada carpeta de temporada lleva un número al inicio (el orden) y el nombre tal como viene de animeav1; no hace falta copiar el de AniList. Las OVAs van como `N. OVA` (o `N. [serie] OVA`) justo después de su temporada. Se pueden usar decimales para meter algo en medio sin renombrar lo demás, y si dos carpetas tienen el mismo número son las partes de una temporada:
  ```
  Anime/Yahari Ore no Seishun Love Comedy wa Machigatteiru./
    1. Yahari Ore no Seishun Love Comedy wa Machigatteiru.        → "Temporada 1"
    2. OVA                                                        → "OVA" (la de la temporada 1)
    3. Yahari Ore no Seishun Love Comedy wa Machigatteiru. Zoku   → "Temporada 2"
    4. OVA                                                        → "OVA" (la de Zoku)
  Anime/Re Zero kara Hajimeru Isekai Seikatsu/
    1. Re Zero kara Hajimeru Isekai Seikatsu 1st Season           → "Temporada 1"
    2. Re Zero kara Hajimeru Isekai Seikatsu - Memory Snow        → "Memory Snow"
    3. Re Zero kara Hajimeru Isekai Seikatsu 2nd Season           → "Temporada 2"
  Anime/Dorohedoro/
    1. Temporada 1 · 2. Temporada 2 · 3. OVA                      → "Temporada 1", "Temporada 2", "OVA"
  ```
  Kai decide con AniList qué es cada carpeta: las series se cuentan como "Temporada 1, 2, 3…"; las OVAs, especiales y películas muestran su subtítulo o "OVA" / "Especial" / "Película". Las tarjetas llevan el año y los capítulos, y al entrar a una temporada se ve su nombre completo. Si renombras o mueves una carpeta, lo visto y el minuto donde ibas no se pierden.
- **Subtitulado y doblado:** el idioma va al final del nombre del archivo: `_SUB` (subtitulado) o `_DUB` (doblado; también `_DOB`, `_LAT`, `[Latino]`). Las dos versiones de un capítulo van en la misma carpeta (`472_0_SUB.mp4` y `472_0_DUB.mp4`) y Kai muestra una sola, con un botón **Sub | Doblado** en la serie o la película; cada perfil recuerda lo que eligió. Lo visto se comparte: si viste el 5 subtitulado, también queda visto doblado. Si un capítulo solo existe en el otro idioma, sale marcado ("Solo sub"). Los pósters llevan una etiqueta SUB / DOB y el catálogo se puede filtrar por idioma. Si el archivo no dice nada, Kai usa el idioma del audio del MP4 (español = doblado) después de reproducirlo una vez.
- **Menú de temporadas:** al entrar a una serie con varias temporadas salen sus tarjetas (póster, año, capítulos vistos, "Viendo" o "Nuevo"); al tocar una se abren sus capítulos, con botones para la anterior, la siguiente o volver al menú.
- **Fichas por temporada:** cada temporada se busca en AniList con el nombre de su carpeta (póster, banner, sinopsis y nota); las tipo "Temporada 2" buscan "[serie] Season 2", y la Temporada 1 usa la ficha de la serie. Una OVA sin subtítulo toma la OVA de la temporada que tiene antes. Si la primera temporada tiene nombre propio, el nombre de la carpeta de la serie ("Fate") no se busca: es solo el nombre del grupo.
- **Al terminar una temporada, Kai se detiene:** no pasa solo a la siguiente; ofrece un botón para verla si quieres.
- **Cine** (películas que no son anime): una carpeta `Cine` dentro de `Anime`, con una subcarpeta por película (por ejemplo `El gigante de hierro (1999)`). No sale en el inicio ni en los catálogos: se abre con el botón **Cine** al final del inicio y aparece al buscar. Los pósters, la sinopsis en español y la nota vienen de TMDB; la clave gratis de TMDB se pega una vez en **Ajustes → Cine** y se guarda en tu MEGA (no en el código), así sirve en todos los dispositivos.
- **Sinopsis e imágenes** de AniList para cada serie y película, automáticas. Las sinopsis se traducen al español en Chrome de computadora (en segundo plano, con el traductor de Chrome) y se guardan en `.kai-sinopsis.json` en tu MEGA, así los demás dispositivos (iPhone, Mac, Android) las ven ya traducidas. La primera vez hay que tocar "Traducir sinopsis al español" en Chrome para que descargue el traductor. Las fichas encontradas (póster, banner, sinopsis, nota) se guardan en `.kai-fichas.json` en tu MEGA: los demás dispositivos y perfiles las usan sin volver a buscar en AniList.
- **Códec de cada video** en pequeño sobre su miniatura, con un puntito rojo si el dispositivo donde estás no lo puede reproducir (por ejemplo AV1 en un iPad M2).
- **Inicio** con las series y las **Películas** en orden alfabético, lo marcado para **Más tarde** y búsqueda rápida (la lupa). El botón de inicio está en todas las páginas.
- **Seguir en otro dispositivo:** si dejaste algo a medias en otro dispositivo, el inicio ofrece seguir en ese mismo segundo.
- **Inicio:** Continuar viendo (los 3 más recientes) y Más tarde en horizontal, y las filas **Series** y **Películas** en pósters, cada una con su botón **Ver catálogo**. Si empezaste algo en otro dispositivo, una tarjeta ofrece seguir ahí mismo (en la PC, arriba a la derecha).
- **Descubrir** (botones al final del inicio): **Porque viste…** muestra recomendaciones de AniList según las series que tienes en MEGA (las que ya empezaste pesan más), y **En emisión** lo que está saliendo ahora con buena nota y cuándo sale el próximo capítulo. Lo que ya tienes sale a color y lleva a su página; lo demás en blanco y negro, con sinopsis y enlaces para buscarlo en animeav1 o verlo en AniList.
- **Catálogos de Series y de Películas** con buscador y filtros por género, año y tipo, en orden alfabético (también se pueden ordenar por recientes o por año). Al buscar o usar una etiqueta se busca en todo, series y películas juntas. En cada ficha, arriba va lo informativo (capítulos, vistos y la nota de AniList) y abajo el año, el tipo y los géneros, que son botones que llevan al catálogo filtrado.
- **Reproductor propio:** marcas de capítulos, ±10 s, velocidad, ventana flotante, pantalla completa, salta la intro sola y pasa al siguiente capítulo dentro de la temporada.
- **Gestos en el teléfono:** doble toque a los lados para ±10 s, mantener presionado para 2×, deslizar arriba para pantalla completa y abajo para salir de ella o pasar al mini reproductor. En iPhone el video se gira solo, aunque tengas el bloqueo de rotación.
- **Mini reproductor:** el video sigue sonando mientras navegas por Kai.
- **Rápido:** lo ya visto queda en memoria (retroceder no gasta cuota de MEGA) y prepara el inicio del siguiente capítulo.
- **Descargas sin conexión,** de uno en uno o varios a la vez. En Chrome y Edge de computadora se pueden guardar en una carpeta como MP4. Nada se borra solo: lo descargado se quita a mano desde Descargados.
- **Tema:** automático, claro u oscuro. El modo claro tiene cuatro tonos para que no canse la vista (Blanco, Gris, Celeste y Arena) y el oscuro dos (Negro y Gris Culero, un gris medio como el de Lightroom). Se eligen en Ajustes.
- **Sincronización en el botón del menú:** una ruedita azul gira mientras sincroniza; un puntito verde abajo a la derecha indica que todo está al día (azul: falta por sincronizar; gris: sin conexión).
- **Novedades** en Ajustes con lo que se agrega a MEGA (un puntito en el menú avisa que hay algo nuevo). Aviso del uso de la cuota de MEGA y de cuando hay una versión nueva de Kai (también se puede buscar en Ajustes).
- **Kai, el gatito:** en el teléfono, sentado asomándose detrás del título de la portada; en la PC, echado encima de la fecha. En el teléfono parpadea de vez en cuando. Se apaga en Ajustes.
- **Visto por todos:** en Ajustes, lista lo que ya terminaron todos los perfiles, por si quieres liberar espacio en MEGA.

## Notas

- La cuota de transferencia de MEGA gratis se renueva sola en unas horas; ver y descargar cuentan para ella. Aunque se agote, los perfiles se pueden elegir igual.
- Si un video se corta, Kai pide a MEGA un enlace nuevo y sigue donde iba. Si un archivo viene en un formato que el navegador no reproduce, Kai dice cuál es.
