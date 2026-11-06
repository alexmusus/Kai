// @ts-check
/*
 * models/collections.js — colecciones: una carpeta "Peliculas" (o "Cine") no es una serie, es un estante de películas.
 * Cada película (una subcarpeta, o un archivo si están sueltos) tiene su propia ficha y su propia página.
 *
 * Cine: películas que no son anime (p. ej. "El gigante de hierro"). Carpeta "Cine" (u "Otras películas") dentro de
 * Anime: funciona como Películas pero no sale en el inicio ni en los catálogos, solo con su botón al final del inicio
 * y al buscar. Sus fichas vienen de TMDB (con la clave que se pone en Ajustes).
 *
 * Studio: música en vivo (carpeta "Studio" dentro de Anime), un video por canción. Tampoco sale en el inicio ni en
 * los catálogos: tiene su botón al final del inicio. No hay de dónde sacar fichas: el nombre del archivo dice el
 * artista, la canción y un detalle ("Juan Gabriel - Querida (Bellas Artes, 1990).mp4"), la imagen es un archivo
 * con el mismo nombre (.jpg, .png o .webp) y la descripción, si la hay, un .txt con el mismo nombre.
 */

import { stripLang, baseName } from './naming.js';
import { index, state } from './store.js';

/** @typedef {import('./types.js').Series} Series */
/** @typedef {import('./types.js').Episode} Episode */
/**
 * Una película de la colección.
 * @typedef {object} Movie
 * @property {string} key    nombre de su carpeta, o del archivo sin idioma si está suelta (identifica su ficha)
 * @property {string} title  nombre de la carpeta sin el número; '' si es un archivo suelto
 * @property {string} [query] lo que se busca en AniList/TMDB
 * @property {Episode[]} eps  sus archivos (más de uno si viene en partes)
 */

// "Películas" puede venir con la tilde en cualquier codificación (macOS la guarda separada), o sin tilde
export const COLLECTION_RE = /^(peliculas?|movies?|films?|filmes)\b/i;
export const CINE_RE = /^(cine|otras peliculas)\b/i;
export const STUDIO_RE = /^studio\b/i;

/** El nombre sin tildes. @param {{ name?: string } | null | undefined} s */
export const plainName = (s) =>
  String((s && s.name) || '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
/** @param {{ name?: string } | null | undefined} s */
export const isCine = (s) => !!s && CINE_RE.test(plainName(s));
/** @param {{ name?: string } | null | undefined} s */
export const isStudio = (s) => !!s && STUDIO_RE.test(plainName(s));
/** @param {{ name?: string } | null | undefined} s */
export const isCollection = (s) => !!s && (COLLECTION_RE.test(plainName(s)) || isCine(s) || isStudio(s));
/** Estantes aparte (Cine y Studio): no salen en el inicio ni en los catálogos, solo con su botón y al buscar. */
export const isAside = (/** @type {{ name?: string } | null | undefined} */ s) => isCine(s) || isStudio(s);

/**
 * Artista, canción y detalle de un video de Studio, por su nombre: "Juan Gabriel - Querida (Bellas Artes, 1990)".
 * Sin " - ", todo es la canción.
 * @param {string} name nombre del archivo
 * @returns {{ artist: string, song: string, detail: string }}
 */
export function studioTitle(name) {
  let t = String(name)
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let detail = '';
  const m = /\s*[([]([^)\]]+)[)\]]\s*$/.exec(t);
  if (m) {
    detail = m[1].trim();
    t = t.slice(0, m.index).trim();
  }
  const cut = t.search(/\s[-–—]\s/);
  if (cut < 0) return { artist: '', song: t, detail };
  return {
    artist: t.slice(0, cut).trim(),
    song: t
      .slice(cut)
      .replace(/^\s*[-–—]\s*/, '')
      .trim(),
    detail,
  };
}

const JUNK_WORDS =
  /\b(1080p|720p|480p|2160p|4k|x26[45]|hevc|aac|sub|subs|subtitulado|vose|dub|dob|doblado|lat|latino|castellano|esp|spa|bd|bdrip|web|webrip)\b/gi;

/**
 * Título de una película suelta a partir del nombre del archivo, sin calidad, códecs ni idioma; '' si no queda nada
 * que parezca un título (al menos 3 letras seguidas).
 * @param {string} name
 */
export function cleanFileTitle(name) {
  const t = String(name)
    .replace(/\.[^.]+$/, '')
    .replace(/[[(][^\])]*[\])]/g, ' ')
    .replace(/[_.]+/g, ' ')
    .replace(JUNK_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /\p{L}{3}/u.test(t) ? t : '';
}

/** Clave de una película suelta: el nombre del archivo sin el idioma ("Howl_DOB.mp4" y "Howl_SUB.mp4" son la misma). @param {Episode} ep */
export const movieKey = (ep) => (ep.lang ? stripLang(baseName(ep.name)) : baseName(ep.name));

/** Las películas de una colección. @param {Series} s @returns {Movie[]} */
export function collectionItems(s) {
  /** @type {Movie[]} */
  const out = [];
  for (const se of s.seasons) {
    if (se.name) out.push({ key: se.name, title: se.title || se.name, query: se.title || se.name, eps: se.episodes });
    else
      for (const ep of se.episodes)
        out.push({ key: movieKey(ep), title: '', query: cleanFileTitle(ep.name), eps: [ep] });
  }
  return out;
}

/** Clave de la ficha de una película o temporada en state.meta (un nombre de carpeta nunca lleva "/"). @param {{ name: string }} s @param {string} key */
export const itemMetaKey = (s, key) => `${s.name}/${key}`;

/** La película a la que pertenece un archivo (null si la serie no es colección). @param {Series} s @param {Episode} ep @returns {Movie | null} */
export function itemFor(s, ep) {
  const e = index.byId.get(ep.id);
  if (!e || !isCollection(s)) return null;
  const se = s.seasons[e.ki];
  return se && se.name
    ? { key: se.name, title: se.title || se.name, eps: se.episodes }
    : { key: movieKey(ep), title: '', eps: [ep] };
}

/** La ficha encontrada de una película o temporada, o null. @param {{ name: string }} s @param {string} key */
export function itemMeta(s, key) {
  const m = state.meta[itemMetaKey(s, key)];
  return m && !m.none ? m : null;
}

/**
 * Nombre que se muestra de una película: el de su carpeta, o el de AniList si es un archivo suelto.
 * En Cine, el título en español de TMDB, o el nombre de la carpeta sin el año ("El gigante de hierro (1999)").
 * @param {Series} s @param {Movie} it
 */
export function movieTitle(s, it) {
  const m = itemMeta(s, it.key);
  const fileName = it.eps[0].name.replace(/\.[^.]+$/, '');
  if (isCine(s))
    return (
      (m && m.title) || (it.title || it.query || '').replace(/\s*[([]\s*(?:19|20)\d{2}\s*[)\]]\s*$/, '') || fileName
    );
  return it.title || (m && m.title) || it.query || fileName;
}

/**
 * Nombre de un capítulo en avisos y tarjetas: "Episodio 5", o el título de la película ("Your Name · parte 2").
 * @param {Episode} ep
 */
export function episodeLabel(ep) {
  const e = index.byId.get(ep.id);
  const s = e && state.library && state.library.series && state.library.series[e.si];
  if (s && isStudio(s)) return studioTitle(ep.name).song;
  const it = s && isCollection(s) ? itemFor(s, ep) : null;
  if (s && it) {
    const m = itemMeta(s, it.key);
    const t = it.title || (m && m.title) || ep.name.replace(/\.[^.]+$/, '');
    return it.eps.length > 1 ? `${t} · parte ${it.eps.indexOf(ep) + 1}` : t;
  }
  return ep.ep != null ? `Episodio ${ep.ep}` : ep.name.replace(/\.[^.]+$/, '');
}

export function movieImage(s, it) {
  const m = itemMeta(s, it.key);
  return (m && (m.banner || m.cover)) || '';
}
