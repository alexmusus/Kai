# Kai

Reproductor web para tus series guardadas en MEGA. Recuerda dónde te quedaste en cualquier dispositivo y permite ver capítulos sin conexión. No usa servidores propios: todo pasa entre tu navegador y tu cuenta de MEGA.

## Publicarla gratis en GitHub Pages (una sola vez)

1. Crea una cuenta en github.com, si no tienes. Solo la necesitas para publicar; para ver tus series no se usa.
2. Arriba a la derecha, toca **+ → New repository**. Ponle de nombre `kai`, déjalo en **Public** y toca **Create repository**.
3. En la página del repositorio vacío, toca **uploading an existing file**. Arrastra **todo el contenido** de esta carpeta, incluida la carpeta `vendor`, y toca **Commit changes**.
4. Ve a **Settings → Pages**. En *Source* elige **Deploy from a branch**, rama **main**, carpeta **/ (root)**, y toca **Save**.
5. En uno o dos minutos la app queda en `https://TU-USUARIO.github.io/kai/`.

El repositorio es público, pero solo contiene el código de la app. Tus series, tu sesión y tu progreso nunca se suben ahí.

## Primer uso

1. Abre la dirección en el navegador de tu PC, tu Mac o tu teléfono.
2. Entra con tu correo y contraseña de MEGA. Si tienes verificación en dos pasos, te pedirá el código.
3. Kai busca la carpeta `Anime`. Si tus series están en otra, abre el botón flotante de abajo a la derecha → **Explorar MEGA**, entra a esa carpeta y toca **Usar como carpeta de series**.

## Cómo organizar MEGA

```
Anime/
  Fate/
    1. Fate UBW/
      472_0_SUB.mp4
      472_1_SUB.mp4
  Otra serie/
    Capítulo 01.mp4      ← sin temporadas también funciona
```

- Cada carpeta dentro de `Anime` es una serie. Las subcarpetas son temporadas y el número del inicio decide el orden (`1. …`, `2. …`).
- El número de capítulo sale del nombre. `472_5_SUB.mp4` es el 5, `Serie - 05 [1080p].mp4` es el 5 y `S01E05.mp4` es el 5.
- En la raíz de tu MEGA, Kai guarda `.kai-compartido.json` (perfiles, intros aprendidas, imágenes elegidas) y un `.kai-progreso-….json` por perfil. No los borres.
- Desde **Explorar MEGA** puedes reproducir cualquier video de tu cuenta, aunque no esté en la carpeta de series.

## Perfiles

Al abrir Kai eliges quién está viendo. Cada perfil tiene su propio progreso, su "Continuar viendo" y sus avisos de capítulos nuevos. Los perfiles se guardan en tu MEGA, así que aparecen en todos los dispositivos. Para cambiar de perfil, abre el botón flotante (tu inicial, abajo a la derecha) y toca tu nombre. Si creas un perfil con un nombre que ya existe, Kai entra al que ya estaba; y si por alguna razón quedaron dos perfiles con el mismo nombre, se juntan solos, con su progreso.

## Portadas y sinopsis

Kai busca cada serie en AniList (una base de datos de anime gratuita) usando el nombre de la carpeta y de la temporada, y trae imagen de fondo, póster, año, géneros y sinopsis. Si eligió mal, en la página de la serie toca **Cambiar imagen** y escoge otra; la elección se guarda para todos. La sinopsis viene en inglés: en Chrome reciente se traduce sola o con **Traducir sinopsis al español**. Con nombres de carpeta completos ("Fate stay night Unlimited Blade Works") acierta mucho más.

## Menú

Todo lo que antes estaba en el menú lateral vive en el botón flotante de abajo a la derecha: perfil, Biblioteca, Explorar MEGA, Descargados, Ajustes, actualizar, tema claro u oscuro y el uso de MEGA.

## Capítulos nuevos

Cuando importas capítulos nuevos a MEGA, la serie muestra la etiqueta **Nuevo** y Kai avisa al detectarlos. Al entrar a la serie dejan de marcarse.

## Subtítulos

Kai los busca en este orden:

1. **Dentro del MP4** (pista de subtítulos que se puede activar y desactivar, como hace VLC). Solo descarga el índice del archivo y los textos, no el video completo.
2. **Un archivo al lado del video** con el mismo nombre: `472_1_SUB.srt`, `.vtt` o `.ass`. Los `.ass` pierden colores y posiciones.
3. **Cargado desde el dispositivo**, desde el botón CC del reproductor.

Si los subtítulos están "quemados" en la imagen, se ven siempre y no hay nada que activar.

## Intros

- Si el MP4 trae capítulos (por ejemplo "Intro", "Parte A", "Parte B"), Kai salta la intro solo y muestra **Volver a la intro** por unos segundos por si no querías. En el capítulo de "Ending" ofrece pasar al siguiente.
- Si el video no trae capítulos, Kai aprende por serie: cuando adelantas el opening con la línea de tiempo o con **Saltar intro**, anota dónde estaba. Con dos capítulos de la misma serie donde el opening empieza en el mismo punto, empieza a saltarlo solo. Mientras no esté seguro, solo muestra el botón.
- Se puede apagar en Ajustes.

## Ver sin conexión

Toca la flecha de un capítulo para guardarlo en el dispositivo. Al terminar de verlo se quita solo del dispositivo; puedes cambiarlo en Ajustes. Mientras descarga, la app mantiene la pantalla encendida, y si se corta, sigue desde donde iba la próxima vez que la abras con internet.

**Varios a la vez:** en la página de la serie toca **Seleccionar** junto a "Episodios", marca los capítulos que quieras (o **Todos** / **Sin ver**) y toca **Descargar**. Se bajan uno tras otro, en orden. Los que ya están descargados no se pueden marcar.

### Guardar las descargas en una carpeta (Chrome y Edge en computadora)

En **Ajustes → Descargas → Elegir carpeta** escoges una carpeta de tu PC o Mac. Desde ahí, cada capítulo queda como un MP4 normal en `Tu carpeta/Serie/Temporada/archivo.mp4` (lo puedes abrir con VLC u otro reproductor), y lo que ya tenías descargado se pasa a esa carpeta. Mientras baja, el capítulo se guarda primero dentro de la app (para poder reanudar) y al terminar se mueve.

- Al cerrar el navegador, Chrome puede volver a pedir permiso para la carpeta. Kai lo pide solo cuando tocas descargar o reproducir; también hay un botón **Permitir acceso** en Ajustes y en Descargados. Si Chrome ofrece "Permitir en cada visita", elígelo y no vuelve a preguntar.
- Si borras un archivo a mano, Kai lo nota al intentar reproducirlo.
- **Quitar del dispositivo** (o terminar el capítulo, si está activado) borra el archivo de la carpeta y la carpeta de la temporada si queda vacía.
- **Safari (Mac y iPhone) y Firefox no permiten que una página guarde en una carpeta.** Ahí las descargas siguen dentro de la app. Si quieres una copia aparte, toca ⋯ en un capítulo descargado → **Guardar copia en el dispositivo** (en iPhone queda en la app Archivos → Descargas). Esa copia es para otros reproductores: Kai no la lee de vuelta.

## En iPhone

- Funciona en Safari sin instalar nada.
- iOS puede borrar los capítulos descargados de un sitio que no abres en unos 7 días. Si la usas a diario no pasa. Si quieres evitarlo del todo, en Safari toca **Compartir → Agregar a pantalla de inicio**.
- Las descargas se pausan si sales de Safari o bloqueas el teléfono, y continúan al volver.
- La pantalla completa del iPhone es la de Kai (no la del reproductor de iOS), para que los gestos sigan funcionando. Se ve mejor con Kai agregado a la pantalla de inicio, porque ahí no aparecen las barras de Safari.
- Si un capítulo no reproduce en línea, el reproductor ofrece **Descargar y ver**.

## Límites

- MEGA gratis tiene una cuota de transferencia que se renueva sola en unas horas. Ver en línea y descargar cuentan para esa cuota. En el botón flotante, abajo, Kai muestra cuánto ha usado en las últimas 6 horas y, si llegas al límite, cuándo se renueva.
- Reproduce MP4 en todos lados. MKV solo en algunos navegadores de escritorio y nunca en iPhone.

## Atajos de teclado en el reproductor

En la portada, las flechas del teclado se mueven entre las series como un control remoto.

En el reproductor: espacio: pausa · ← / →: 10 s · F: pantalla completa · M: silencio · C: subtítulos · S: saltar intro · B: apagar la luz · N / P: siguiente y anterior

En el teléfono, sobre el video:

- Un toque muestra u oculta los controles.
- Doble toque a la derecha o a la izquierda salta 10 s; cada toque rápido extra suma otros 10 s.
- Deslizar arriba o abajo (en cualquier lado) cambia el brillo del video. Es el brillo de la imagen, no el de la pantalla del teléfono, que una página web no puede cambiar. Se recuerda en cada dispositivo.
- Mantener presionado reproduce a 2× mientras no sueltes.
- Para desplazar la página, desliza fuera del video.

## Actualizar la app

Sube los archivos nuevos al mismo repositorio, reemplazando los anteriores. Al abrir la app la próxima vez se actualiza sola; si no ves el cambio, recarga una segunda vez.
