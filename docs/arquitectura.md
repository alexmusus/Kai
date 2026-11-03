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
| `library.js` | biblioteca desde el árbol, índice, Sub/Doblado, carpetas renombradas |
| `collections.js` | Peliculas y Cine |
| `progress.js` | lo visto, Más tarde, Continuar viendo, seguir en otro dispositivo |
| `profiles.js` | perfiles y lo compartido, duplicados, respaldo |
| `sync.js` | juntar con MEGA y dejar una sola copia |
| `quota.js` | transferencia de MEGA (avisa `quota`) |
| `subs.js` | subtítulos y capítulos dentro del MP4, leídos por rangos; archivos .srt/.vtt/.ass |
| `meta-api.js` | AniList y TMDB: buscar fichas, notas, recomendaciones; traducir sinopsis |
| `fichas.js` | leer las fichas guardadas y nombrar las temporadas ("Temporada 2", "OVA", "Memory Snow") |
| `fichas-sync.js` | buscar lo que falta, traducir sinopsis y compartirlas por MEGA (avisa `meta-changed`, `sync-needed`) |
| `news.js` | burbujas de "nuevo" y Novedades (avisa `news`) |
| `thumbs.js` | miniaturas de MEGA, guardadas en IndexedDB |
| `idb.js` | IndexedDB: descargas, miniaturas, subtítulos leídos |
| `downloads.js` | descargas en pedazos, reanudar, carpeta de descargas (avisa `download-changed`, `download-done`, `notice`…) |
| `media.js` | leer videos por rangos, códec de cada archivo, si este navegador lo reproduce, capítulos guardados |
| `plans.js` | qué capítulo toca después y qué ofrece la portada, una temporada o una película |
| `context.js` | de qué serie, temporada o película es un capítulo, y su título |
| `updates.js` | si hay una versión nueva de Kai lista |
| `discover.js` | Descubrir: recomendaciones y lo que está en emisión (AniList) |

| Utilidad (`lib/`) | De qué se encarga |
|---|---|
| `util.js` | `$`, `LS` (localStorage que nunca lanza), HTML seguro, tiempos y tamaños |
| `events.js` | avisos entre capas: `on` y `emit` |
| `route.js` | leer la dirección actual (`#/serie/3` → vista y argumento) |
| `nav-history.js` | la copia del historial del navegador: cada entrada lleva su posición, así "volver" e "Inicio" no se desfasan |

| Controlador | De qué se encarga |
|---|---|
| `router.js` | qué página se dibuja, historial de "volver", scroll al volver; el reproductor se registra con `setPlayer` |
| `actions.js` | los botones (`data-act`): una tabla nombre → función; las del reproductor las atiende `player/` |
| `home.js` | portada estilo TV: destacado al pasar o enfocar un mosaico, flechas como control remoto |
| `lifecycle.js` | dirección, conexión, segundo plano y cierre: guardar y sincronizar a tiempo |
| `updates.js` | registrar el service worker, aviso de versión nueva, "Buscar actualización" |
| `dock.js` | botón flotante: menú, flecha para subir, tocar fuera solo cierra |
| `sync.js` | cuándo sincronizar y qué redibujar después |
| `account.js` | entrar a MEGA, crear y elegir perfil |
| `downloads.js` | elegir carpeta, copia aparte, poner en cola con el nombre de la serie |
| `sheet.js` | hoja de opciones de un capítulo |
| `picking.js` | "Seleccionar" varios capítulos |
| `player/` | el reproductor: `state` (lo que suena), `dom` (sus elementos), `engine` (cargar, cambiar y guardar), `page` (la página de reproducción), `mini`, `controls`, `chapters` (marcas, saltar intro), `gestures` (toques y teclado), `events` (los del video) |

Las vistas (`views/`) dibujan; si necesitan navegar avisan `navigate`, y los formularios avisan `login` y
`profile-create`. Ninguna vista llama a un controlador. Antes de quitar o cerrar algo se pregunta con `askConfirm`
(`views/sheet.js`), nunca con `confirm()` del navegador: en iPhone a veces no aparece (ESLint lo prohíbe).

Fuera de las capas:

| Archivo | Por qué está aparte |
|---|---|
| `core.js` | Descifrado de MEGA. Script clásico: lo comparten la página y el service worker. |
| `sw.js` | Service worker: funciona sin conexión y sirve el video descifrado por rangos (`/__stream`). |
| `vendor/mega.js` | megajs empaquetado. No se edita a mano. |

## Estado

`models/store.js` tiene el estado compartido (`state`) y el índice de capítulos (`index`). Son objetos únicos:
se cambian sus campos, nunca se reemplazan (`setIndex` cambia el contenido del índice). La forma de los datos
(`Episode`, `Season`, `Series`, `Library`, `Progress`…) está en `models/types.js`.

## Reglas que no se rompen

- **Nada se borra solo, y Kai nunca borra de MEGA.**
- **Si un archivo de MEGA no se pudo leer, no es un archivo vacío:** no se sobrescribe (eso duplicó perfiles en la v4).
- Las fusiones de progreso y fichas usan la marca de tiempo (`u` / `at`): gana la más reciente.
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
- Versiones (`sw.js`): `VERSION` es la de Kai y sube solo al pasar `prueba` a `main`; `ENTREGA` sube en cada
  subida a `prueba` (sin cambiar `sw.js` el navegador no instala lo nuevo) y vuelve a 1 al subir `VERSION`.

## Pruebas

En `tests/` (ver su README): ESLint, chequeo de tipos, Prettier, pruebas unitarias de los modelos (Vitest) y
recorridos en PC e iPhone con una biblioteca simulada (Playwright). GitHub Actions las corre en cada push.
Lo que no se puede simular y se prueba a mano: MEGA real, Safari de iPhone, AniList y TMDB en vivo, reproducción
y descargas.

## Ramas

`main` es lo publicado en kai.musus.dev. `prueba` se publica en prueba.kai-6og.pages.dev: ahí se prueba todo en
el iPhone antes de pasarlo a `main`.
