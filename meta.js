/*
 * meta.js — sinopsis e imágenes de AniList (gratis, sin cuenta).
 */

const API = 'https://graphql.anilist.co';
const FIELDS = `id
  title { romaji english native userPreferred }
  description(asHtml: false)
  bannerImage
  coverImage { extraLarge large color }
  seasonYear episodes format genres`;

async function gql(query, variables) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (r.status === 429) throw new Error('AniList pidió esperar un momento.');
  if (!r.ok) throw new Error('AniList respondió ' + r.status);
  const j = await r.json();
  if (j.errors && !j.data) throw new Error(j.errors[0] && j.errors[0].message);
  return j.data;
}

export async function searchAnime(q, perPage = 8) {
  const data = await gql(`query ($q: String, $n: Int) { Page(perPage: $n) { media(search: $q, type: ANIME, sort: SEARCH_MATCH) { ${FIELDS} } } }`, { q, n: perPage });
  return (data && data.Page && data.Page.media) || [];
}

export async function animeById(id) {
  const data = await gql(`query ($id: Int) { Media(id: $id, type: ANIME) { ${FIELDS} } }`, { id });
  return data && data.Media;
}

const GENRES = {
  Action: 'Acción', Adventure: 'Aventura', Comedy: 'Comedia', Drama: 'Drama', Ecchi: 'Ecchi', Fantasy: 'Fantasía',
  Horror: 'Terror', 'Mahou Shoujo': 'Chicas mágicas', Mecha: 'Mecha', Music: 'Música', Mystery: 'Misterio',
  Psychological: 'Psicológico', Romance: 'Romance', 'Sci-Fi': 'Ciencia ficción', 'Slice of Life': 'Vida cotidiana',
  Sports: 'Deportes', Supernatural: 'Sobrenatural', Thriller: 'Suspenso', Hentai: 'Hentai',
};
const FORMATS = { TV: 'Serie', TV_SHORT: 'Serie corta', MOVIE: 'Película', SPECIAL: 'Especial', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Video musical' };

function cleanText(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.innerHTML = s.replace(/<br\s*\/?>/gi, '\n');
  return div.textContent
    .replace(/\(Source:[^)]*\)/gi, '')
    .replace(/\[Written by[^\]]*\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lo que Kai guarda de cada serie. */
export function toMeta(m) {
  return {
    id: m.id,
    v: 2,
    title: (m.title && (m.title.english || m.title.romaji || m.title.userPreferred)) || '',
    romaji: (m.title && m.title.romaji) || '',
    native: (m.title && m.title.native) || '',
    synopsis: cleanText(m.description),
    banner: m.bannerImage || '',
    cover: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || '',
    color: (m.coverImage && m.coverImage.color) || '',
    year: m.seasonYear || null,
    episodes: m.episodes || null,
    format: FORMATS[m.format] || '',
    genres: (m.genres || []).map((g) => GENRES[g] || g), // todos: sirven para filtrar en el catálogo
    at: Date.now(),
  };
}

/** Busca probando varios textos (temporada, serie + temporada, serie) y se queda con el primero que encuentre. */
export async function findForSeries(names) {
  for (const q of names) {
    if (!q || q.length < 2) continue;
    const list = await searchAnime(q, 1);
    if (list.length) return list[0];
  }
  return null;
}

/** Traducción en el propio navegador (Chrome reciente). Devuelve null si no se puede sin intervención. */
let translator = null;
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
export function translateToSpanish(text, allowDownload = false) {
  return withTimeout(doTranslate(text, allowDownload), allowDownload ? 60000 : 2500);
}
async function doTranslate(text, allowDownload) {
  if (!text || !('Translator' in self)) return null;
  try {
    if (!translator) {
      const opts = { sourceLanguage: 'en', targetLanguage: 'es' };
      const avail = await self.Translator.availability(opts);
      if (avail === 'unavailable') return null;
      if (avail !== 'available' && !allowDownload) return null;
      translator = await self.Translator.create(opts);
    }
    return await translator.translate(text);
  } catch {
    return null;
  }
}
export const canTranslate = () => 'Translator' in self;
