# Arquitectura de Kai

Kai es una página estática: HTML, CSS y módulos ES que el navegador carga tal cual, sin compilar. No hay servidor
propio; todo pasa entre el navegador, MEGA, AniList y TMDB. Cloudflare Pages publica la raíz del repo.

> Reestructura en curso: `app.js` se está repartiendo en `models/`, `views/` y `controllers/`. Mientras tanto,
> lo que aún no se movió sigue en `app.js`.

## Capas

```
lib/          utilidades generales (localStorage, HTML seguro, tiempos). No saben nada de Kai.
models/       los datos y sus reglas: MEGA, biblioteca, nombres, progreso, perfiles, fichas, descargas.
views/        dibujan: reciben datos y devuelven HTML. No guardan nada ni hablan con MEGA.
controllers/  deciden: rutas, clics, reproductor, sincronización. Unen modelos y vistas.
app.js        arranque.
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
- Formato con Prettier (120 columnas, comillas simples) en los módulos nuevos.
- Claves de localStorage: con prefijo `kai.` (lo pone `LS`), declaradas como constantes en el módulo dueño.
- Cada módulo nuevo va en `SHELL` de `sw.js` (para abrir sin conexión) y en un `<link rel="modulepreload">`
  de `index.html` (para pedirlos todos a la vez); `tests/unit/modulos.test.js` revisa las dos listas.
  Cada entrega sube `VERSION` en `sw.js`.

## Pruebas

En `tests/` (ver su README): ESLint, chequeo de tipos, Prettier, pruebas unitarias de los modelos (Vitest) y
recorridos en PC e iPhone con una biblioteca simulada (Playwright). GitHub Actions las corre en cada push.
Lo que no se puede simular y se prueba a mano: MEGA real, Safari de iPhone, AniList y TMDB en vivo, reproducción
y descargas.

## Ramas

`main` es lo publicado en kai.musus.dev. `prueba` se publica en prueba.kai-6og.pages.dev: ahí se prueba todo en
el iPhone antes de pasarlo a `main`.
