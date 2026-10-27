/*
 * meta.js — sinopsis e imágenes de AniList (gratis, sin cuenta).
 */

const API = 'https://graphql.anilist.co';
const FIELDS = `id
  title { romaji english native userPreferred }
  synonyms
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

/** ¿El resultado tiene que ver con la carpeta? Alguna palabra del nombre (4+ letras) aparece en sus títulos,
 * o el nombre se parece lo suficiente a alguno (p. ej. "Mi Heroe Academia" ≈ "My Hero Academia"). */
export function relatedTo(folder, m) {
  const titles = [...Object.values(m.title || {}), ...(m.synonyms || [])].map(squash).filter(Boolean);
  const words = String(folder).split(/[^\p{L}\p{N}]+/u).map(squash).filter((w) => w.length >= 4);
  if (words.some((w) => titles.some((t) => t.includes(w)))) return true;
  return titleScore(folder, m) >= 0.6;
}
/** Busca probando varios textos (serie + temporada, temporada, serie). De cada búsqueda solo acepta un
 * resultado que tenga que ver con el nombre de la carpeta: mejor sin imagen que con la de otro anime. */
export async function findForSeries(names, folder = names[names.length - 1]) {
  for (const q of names) {
    if (!q || q.length < 2) continue;
    const list = await searchAnime(q, 5);
    const hit = list.find((m) => relatedTo(folder, m));
    if (hit) return hit;
  }
  return null;
}

/* ── películas: buscar por el nombre del archivo, aunque no esté escrito igual que en AniList ──
 * AniList busca palabra por palabra, así que "Kimi No Nawa" no encuentra "Kimi no Na wa." y
 * "Joze to Tora…" no encuentra "Josee to Tora…". Se prueban variantes del nombre y cada resultado
 * se compara letra a letra sin espacios ni signos, con margen para una o dos letras distintas. */
const squash = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^0-9a-z぀-ヿ一-鿿]+/g, '');
function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/** Qué tanto se parece un resultado al nombre buscado (0 a 1). */
export function titleScore(name, m) {
  const q = squash(name);
  if (!q) return 0;
  const titles = [...Object.values(m.title || {}), ...(m.synonyms || [])].map(squash).filter(Boolean);
  let best = 0;
  for (const t of titles) {
    const d = editDistance(q, t);
    best = Math.max(best, 1 - d / Math.max(q.length, t.length));
    // "Kimi no Na wa" dentro de "Kimi no Na wa. (2016)" o al revés también vale
    if (q.length >= 6 && (t.startsWith(q) || q.startsWith(t))) best = Math.max(best, 0.85);
  }
  return best + (m.format === 'MOVIE' ? 0.04 : 0);
}
/** Variantes de búsqueda de un nombre: completo, sin las últimas palabras, sin las primeras,
 * y pares de palabras seguidas (basta con que dos palabras estén bien escritas). */
function movieQueries(name) {
  const w = String(name).split(/\s+/).filter(Boolean);
  const out = [w.join(' ')];
  for (let n = w.length - 1; n >= 2; n--) out.push(w.slice(0, n).join(' '));
  for (let i = 0; i + 1 < w.length; i++) out.push(w[i] + ' ' + w[i + 1]);
  for (let k = 1; k <= w.length - 2; k++) out.push(w.slice(k).join(' '));
  return [...new Set(out)].filter((q) => q.replace(/\s/g, '').length >= 5).slice(0, 7);
}
/** Busca una película por el nombre de su archivo. Devuelve el resultado de AniList o null. */
export async function findMovie(name, pause = () => Promise.resolve()) {
  let best = null;
  let bestScore = 0;
  const qs = movieQueries(name);
  for (let i = 0; i < qs.length; i++) {
    if (i) await pause();
    const list = await searchAnime(qs[i], 10);
    for (const m of list) {
      const sc = titleScore(name, m);
      if (sc > bestScore) { best = m; bestScore = sc; }
    }
    if (bestScore >= 0.84) break; // ya hay uno claramente igual
  }
  return bestScore >= 0.72 ? best : null;
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

/* ── Descubrir: recomendaciones y lo que está en emisión ── */

const DFIELDS = `id isAdult
  title { romaji english userPreferred }
  description(asHtml: false)
  coverImage { extraLarge large color }
  genres averageScore popularity seasonYear format episodes duration status
  nextAiringEpisode { episode airingAt }`;

/** Lo que muestra Kai de un anime en Descubrir. */
export function toDiscover(m) {
  return {
    id: m.id,
    title: (m.title && (m.title.english || m.title.romaji || m.title.userPreferred)) || '',
    romaji: (m.title && m.title.romaji) || '',
    synopsis: cleanText(m.description),
    cover: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || '',
    color: (m.coverImage && m.coverImage.color) || '',
    genres: (m.genres || []).map((g) => GENRES[g] || g),
    score: m.averageScore || null,
    year: m.seasonYear || null,
    format: FORMATS[m.format] || '',
    episodes: m.episodes || null,
    next: m.nextAiringEpisode ? { ep: m.nextAiringEpisode.episode, at: m.nextAiringEpisode.airingAt * 1000 } : null,
  };
}

/** Recomendaciones de AniList para varias series a la vez (de a 8 por pedido, para no saturar AniList).
 * Devuelve { idDeTuSerie: [{ rating, media }] }. */
export async function recommendationsFor(ids, pause = () => new Promise((r) => setTimeout(r, 800))) {
  const out = {};
  for (let i = 0; i < ids.length; i += 8) {
    const chunk = ids.slice(i, i + 8);
    const q = `query { ${chunk.map((id, k) => `a${k}: Media(id: ${Number(id)}, type: ANIME) { id recommendations(sort: RATING_DESC, perPage: 8) { nodes { rating mediaRecommendation { ${DFIELDS} } } } }`).join('\n')} }`;
    const data = await gql(q, {});
    chunk.forEach((id, k) => {
      const nodes = (data && data[`a${k}`] && data[`a${k}`].recommendations && data[`a${k}`].recommendations.nodes) || [];
      out[id] = nodes.filter((n) => n && n.mediaRecommendation && !n.mediaRecommendation.isAdult).map((n) => ({ rating: n.rating || 0, media: n.mediaRecommendation }));
    });
    if (i + 8 < ids.length) await pause();
  }
  return out;
}

/** Lo que está saliendo ahora y tiene buena puntuación (y suficiente gente que lo sigue, para que la nota sea confiable). */
export async function airingTop() {
  const data = await gql(`query { Page(perPage: 36) { media(type: ANIME, status: RELEASING, isAdult: false, sort: SCORE_DESC, averageScore_greater: 74, popularity_greater: 6000, format_in: [TV, TV_SHORT, ONA]) { ${DFIELDS} } } }`, {});
  // fuera los cortos de un par de minutos por capítulo (como Chiikawa): animeav1 casi nunca los tiene.
  // Si AniList no sabe la duración, la serie se queda.
  return ((data && data.Page && data.Page.media) || []).filter((m) => !(m.duration && m.duration < SHORT_MIN));
}
const SHORT_MIN = 8; // minutos por capítulo
