# Arquitectura de Kai

Kai es una página estática: HTML, CSS y módulos ES que el navegador carga tal cual, sin compilar. No hay servidor
propio; todo pasa entre el navegador, MEGA, AniList y TMDB. Cloudflare Pages publica la raíz del repo.

## Capas

```
lib/          utilidades generales (localStorage, HTML seguro, tiempos). No saben nada de Kai.
models/       los datos y sus reglas: MEGA, biblioteca, nombres, progreso, perfiles, fichas, descargas.
views/        dibujan: reciben datos y devuelven HTML. No guardan nada ni hablan con MEGA.
controllers/  deciden: rutas, clics, reproductor, sincronización. Unen modelos y vistas.
app.js        punto de entrada: conecta los avisos de los modelos con las vistas, registra los controladores y arranca.
```

Las dependencias van en una sola dirección: `lib ← models ← views ← controllers`. Un modelo nunca importa una
vista; si algo cambió y hay que redibujar, el modelo avisa con un evento (`lib/events.js`) y el controlador
decide. ESLint lo revisa (`no-restricted-imports`).

| Modelo | De qué se encarga |
|---|---|
| `store.js` | estado compartido e índice de capítulos |
| `types.js` | la forma de los datos (solo tipos JSDoc) |
| `naming.js` | qué dicen los nombres: capítulo, idioma, temporada, OVAs |
| `mega.js` | sesión, árbol, leer y escribir archivos (avisa `tree-changed`) |
| `library.js` | biblioteca desde el árbol, índice, Sub/Doblado, carpetas renombradas; la imagen y el .txt con el nombre de un video |
| `profile-copies.js` | encontrar y separar lo que se copió entre perfiles |
| `collections.js` | Peliculas, Cine y Studio (música en vivo: artista y canción salen del nombre del archivo; su orden o el aleatorio) |
| `progress.js` | lo visto, Más tarde, Continuar viendo, seguir en otro dispositivo |
| `profiles.js` | perfiles y lo compartido, duplicados, respaldo |
| `sync.js` | juntar con MEGA y dejar una sola copia |
| `quota.js` | transferencia de MEGA (avisa `quota`) |
| `mp4.js` | lo que se lee de adentro del MP4 por rangos: formato, idioma del audio y capítulos (la intro) |
| `meta-api.js` | AniList y TMDB: buscar fichas, notas, recomendaciones; traducir sinopsis |
| `fichas.js` | leer las fichas guardadas y nombrar las temporadas ("Temporada 2", "OVA", "Memory Snow") |
| `fichas-sync.js` | buscar lo que falta, traducir sinopsis y compartirlas por MEGA (avisa `meta-changed`, `sync-needed`) |
| `news.js` | burbujas de "nuevo" y Novedades (avisa `news`) |
| `thumbs.js` | miniaturas de MEGA, guardadas en IndexedDB |
| `idb.js` | IndexedDB: descargas, miniaturas, capítulos leídos de los MP4 |
| `downloads.js` | descargas en pedazos, reanudar, carpeta de descargas (avisa `download-changed`, `download-done`, `notice`…) |
| `media.js` | leer videos por rangos, códec de cada archivo, si este navegador lo reproduce, capítulos guardados |
| `plans.js` | qué capítulo toca después y qué ofrece la portada, una temporada o una película |
| `context.js` | de qué serie, temporada o película es un capítulo, y su título |
| `updates.js` | si hay una versión nueva de Kai lista, y qué cambió (lo cuenta `sw.js`, en `CAMBIOS`) |
| `stats.js` | el resumen de un perfil: tiempo visto, series terminadas, lo más visto del mes |
| `discover.js` | Descubrir: recomendaciones y lo que está en emisión (AniList) |

| Utilidad (`lib/`) | De qué se encarga |
|---|---|
| `util.js` | `$`, `LS` (localStorage que nunca lanza), HTML seguro, tiempos y tamaños |
| `events.js` | avisos entre capas: `on` y `emit` |
| `route.js` | leer la dirección actual (`#/serie/3` → vista y argumento) |
| `nav-history.js` | la copia del historial del navegador: cada entrada lleva su posición, así "volver" e "Inicio" no se desfasan |
| `motion.js` | las animaciones: si van (`calmMotion`) y cuánto duran (variables CSS `--kai-…`, leídas al animar) |
| `diag.js` | registro de diagnóstico en pantalla; apagado no hace nada, se enciende abriendo Kai con `?diag=1` |

| Controlador | De qué se encarga |
|---|---|
| `router.js` | qué página se dibuja, historial de "volver", scroll al volver; las partes que salen iguales a las de antes se reusan (no parpadean); el reproductor se registra con `setPlayer` |
| `actions.js` | los botones (`data-act`): una tabla nombre → función; las del reproductor las atiende `player/` |
| `home.js` | portada estilo TV: destacado al pasar o enfocar un mosaico, flechas como control remoto |
| `lifecycle.js` | dirección, conexión, segundo plano y cierre: guardar y sincronizar a tiempo |
| `updates.js` | registrar el service worker, aviso de versión nueva (al tocarlo, qué cambió), "Buscar actualización" |
| `dock.js` | barra flotante: pestañas, menú del perfil, se achica al bajar (hasta tocarla; solo con transform y opacidad) con la burbuja para subir, tocar fuera solo cierra |
| `sync.js` | cuándo sincronizar y qué redibujar después |
| `account.js` | entrar a MEGA, crear y elegir perfil |
| `downloads.js` | elegir carpeta, copia aparte, poner en cola con el nombre de la serie |
| `sheet.js` | hoja de opciones de un capítulo |
| `picking.js` | "Seleccionar" varios capítulos (o todos de una vez) |
| `posters.js` | pósters de serie: menú al mantener presionado, tarjeta al pasar el ratón; flechas de las filas |
| `player/` | el reproductor: `state` (lo que suena), `dom` (sus elementos), `engine` (cargar, cambiar y guardar), `page` (la página de reproducción), `mini`, `controls`, `chapters` (marcas, saltar intro), `gestures` (toques y teclado), `events` (los del video) |

Las vistas (`views/`) dibujan; si necesitan navegar avisan `navigate`, y los formularios avisan `login` y
`profile-create`. Ninguna vista llama a un controlador. Antes de quitar o cerrar algo se pregunta con `askConfirm`
(`views/sheet.js`), nunca con `confirm()` del navegador: en iPhone a veces no aparece (ESLint lo prohíbe).

Fuera de las capas:

| Archivo | Por qué está aparte |
|---|---|
| `core.js` | Descifrado de MEGA. Script clásico: lo comparten la página y el service worker. |
| `sw.js` | Service worker: los archivos de la app salen de su caché sin preguntar al servidor (la caché lleva la versión; lo que casi nunca cambia va en otra aparte), funciona sin conexión y sirve el video descifrado por rangos (`/__stream`). |
| `vendor/mega.js` | megajs empaquetado. No se edita a mano. |

## Estado

`models/store.js` tiene el estado compartido (`state`) y el índice de capítulos (`index`). Son objetos únicos:
se cambian sus campos, nunca se reemplazan (`setIndex` cambia el contenido del índice). La forma de los datos
(`Episode`, `Season`, `Series`, `Library`, `Progress`…) está en `models/types.js`.

## Fluidez

- Volver atrás se dibuja en `popstate` (no en `hashchange`): así el gesto de volver del iPhone no muestra un cuadro
  de la página que se deja.
- Después de dibujar una página, cada parte idéntica a la que ya había en esa dirección se cambia por la de antes
  (`reuseIfSame` en `router.js`): lo ya pintado no se vuelve a pintar.
- Nada de desenfoque (`backdrop-filter`) en lo que se repite en listas (cada capítulo, cada póster).
- `html.lite` (teléfonos con 4 GB o menos, o Ajustes → Modo liviano; `views/theme.js`): sin desenfoques.
- `html.calm` (modo liviano, o Ajustes → Animaciones → Reducidas): sin vuelos ni fundidos. Las duraciones y curvas
  son variables CSS de `:root` (`--kai-fly-dur`, `--kai-fly-ease`, `--kai-page-in-dur`, `--kai-snap-dur`).
- El tema se pone en `index.html` antes de cargar el JS (un script en línea): sin destello del otro tema al abrir.
- Ningún desenfoque sobre el video ni en listas: el único que queda es el de la barra flotante (y el modo liviano
  lo quita).

## Estilos: Vidrio y Bloques (Kai 44)

Kai tiene dos estilos. **Vidrio** es el de siempre. **Bloques** está en prueba: solo aparece con el Laboratorio
encendido (Ajustes → Avanzado), y solo en ese dispositivo (`settings.lab`, `settings.style`).

- `html[data-style='bloques']` y su tono (`data-tone` claro: Piedra, Papel; `data-dark` oscuro: Grafito, Bosque). Los
  colores de fondo están en `models/store.js` (`BLOCK_TONES`, `BLOCK_DARK`), en el arranque de `index.html` y en
  `styles.css`; `tests/unit/tema-inicial.test.js` revisa que coincidan.
- Bloques no redefine cada componente: cambia las variables (`--surface`, `--surface2`, `--edge`, `--accent`,
  `--accent2`) y apunta a ellas las del vidrio (`--glass…`, `--card`, `--btn`, `--line`). Un componente nuevo que use
  esas variables sale bien en los dos estilos; si usa un color fijo, en Bloques se nota. Las capas flotantes (hoja de
  opciones, selección, avisos, tarjeta del póster, mini) y la portada oscura tienen su regla al final de `styles.css`
  ("Bloques: lo mismo en todas las pantallas").
- `tests/unit/contraste.test.js` exige contraste 4.5 en cada tono (texto, tenue, apagado, botón, enlaces): al cambiar
  un color de Bloques, esa prueba dice si se lee.
- `views/lively.js`: las animaciones al tocar de Bloques (la píldora que se desliza, los números que suben). Con Vidrio
  no observa nada.
- Los recorridos (`tests/e2e/recorridos.spec.js`, "Bloques …") abren los cuatro tonos y revisan el inicio, una serie,
  el menú de un capítulo y Ajustes.

## Diseño (Kai 39)

Estilo de las apps de Apple: fondo neutro, la imagen manda, datos en una línea sin pastillas, botones lisos
(`--btn`), tarjetas sólidas (`--card`) y un solo acento. La portada del inicio y de cada serie es una tarjeta
oscura igual en los dos temas (`hero-card`, `heroArtHTML` en `views/components.js`). En `styles.css`, los bloques
"Kai 39 · …" del final son el diseño actual; las reglas de arriba son la base que comparten. Al agregar algo, que
use los mismos tokens (`--btn`, `--card`, `--text`, `--dim`) para que se vea en los dos temas.
- Los gestos miden el video una vez al tocar y lo mueven una vez por cuadro (`requestAnimationFrame`).

## Reglas que no se rompen

- **Nada se borra solo, y Kai nunca borra de MEGA.**
- **Si un archivo de MEGA no se pudo leer, no es un archivo vacío:** no se sobrescribe (eso duplicó perfiles en la v4).
- Las fusiones de progreso y fichas usan la marca de tiempo (`u` / `at`): gana la más reciente.
- La sincronización del progreso va por perfil explícito (`syncProgress(home, io, pid)`): lo leído de un perfil solo
  se junta con lo local de ese perfil, aunque se cambie de perfil en medio. Se sube lo pendiente de todos los
  perfiles del dispositivo (`syncAllProgress`). Una marca posterior a la subida de su archivo (reloj adelantado)
  se baja a esa hora.
- Si el archivo de MEGA es el mismo de la última sincronización (su id, tamaño y fecha) y lo de aquí tampoco cambió,
  no se vuelve a bajar. Solo durante 5 minutos, por si este dispositivo dejó de recibir los avisos de MEGA; "Sincronizar
  ahora" y volver a Kai leen siempre (`forgetSyncSkips`).
- MEGA permite archivos repetidos con el mismo nombre: se leen todos, se juntan y queda una copia.
- El progreso se guarda por ruta del archivo; si una carpeta se renombra, se sigue por el id de MEGA.
- Lo que no se puede guardar o leer de localStorage no rompe la app: `LS` nunca lanza.

## Convenciones

- Módulos pequeños con un tema; funciones que reciben lo que usan en vez de leerlo de variables globales.
- Comentarios en español que explican el **porqué**; JSDoc con tipos en los modelos (`// @ts-check`).
- Nada de `var`; `const` siempre que se pueda; `===` (salvo `== null`).
- Formato con Prettier (120 columnas, comillas simples) en `app.js`, `lib/`, `models/`, `views/` y `controllers/`.
- Los controladores registran sus eventos en una función `init…()` que llama `app.js`, no al importarse
  (salvo `player/gestures.js` y `player/events.js`, que se cargan por eso mismo).
- Claves de localStorage: con prefijo `kai.` (lo pone `LS`), declaradas como constantes en el módulo dueño.
- Cada módulo nuevo va en `SHELL` de `sw.js` (para abrir sin conexión) y en un `<link rel="modulepreload">`
  de `index.html` (para pedirlos todos a la vez); `tests/unit/modulos.test.js` revisa las dos listas.
- Versiones (`sw.js`): lo que se ve en Ajustes es `VERSION.ENTREGA` ("Kai 44.3"; con entrega 1, "Kai 44"). `ENTREGA`
  sube en cada subida dentro de una versión (sin cambiar `sw.js` el navegador no instala lo nuevo) y vuelve a 1 al
  subir `VERSION`.
  GitHub Actions falla si cambia algo de la app sin que cambie una de las dos (`tests/version-check.mjs`).
- Lo que casi nunca cambia (`vendor/mega.js`, los íconos, el gatito y las letras de Bloques, `fonts/`) va en `ASSETS`, en su propia caché, que no se
  vuelve a bajar con cada versión: si cambia uno de esos archivos sube `ASSETS_V` (el mismo chequeo lo exige).

## Pruebas

En `tests/` (ver su README): ESLint, chequeo de tipos, Prettier, pruebas unitarias de los modelos (Vitest) y
recorridos en PC e iPhone con una biblioteca simulada (Playwright). GitHub Actions las corre en cada push.
Lo que no se puede simular y se prueba a mano: MEGA real, Safari de iPhone, AniList y TMDB en vivo, reproducción
y descargas.

## Ramas

`main` es lo publicado en kai.musus.dev. `prueba` se publica en prueba.kai-6og.pages.dev: ahí se prueba todo en
el iPhone antes de pasarlo a `main`.
