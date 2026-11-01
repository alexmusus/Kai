/*
 * models/naming.js — qué dice el nombre de cada archivo y carpeta: número de capítulo, idioma (Sub/Doblado),
 * número y nombre de temporada, OVAs y especiales. Funciones puras: no tocan la pantalla ni MEGA.
 */

/* ── idioma de cada archivo: "472_0_SUB.mp4" (subtitulado) / "472_0_DOB.mp4" (doblado) ──
 * Las dos versiones de un capítulo van en la misma carpeta; Kai muestra una sola (la que elijas) y comparte lo visto. */
export const LANG_WORDS = 'sub(?:s|titulad[oa])?|vose|dob(?:lad[oa])?|dub(?:bed)?|lat(?:ino)?|castellano|espa[nñ]ol';
export const LANG_RE = new RegExp(`(?:^|[\\s_.\\-[(])(${LANG_WORDS})(?=$|[\\s_.\\-\\])])`, 'gi');
export const LANG_BOX_RE = new RegExp(`\\s*[[(]\\s*(?:${LANG_WORDS})\\s*[\\])]`, 'gi'); // "[Latino]", "(Sub)"
export function langOf(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  const all = [...base.matchAll(LANG_RE)];
  if (!all.length) return null;
  return /^(sub|vose)/i.test(all[all.length - 1][1]) ? 'sub' : 'dob';
}
/** El nombre sin la marca de idioma: "472_0_SUB" y "472_0_DOB" son el mismo capítulo; "Howl [Latino]" → "Howl". */
export function stripLang(name) {
  return String(name || '').replace(LANG_BOX_RE, '').replace(LANG_RE, '').replace(/[\s_.\-]+$/, '').trim();
}
export const twinKey = (ep) => stripLang(ep.name.replace(/\.[^.]+$/, '')).toLowerCase();
export const LANG_LABEL = { sub: 'Sub', dob: 'Doblado' };

export const langText = (langs) => (langs.length > 1 ? 'Sub y doblado' : langs.length ? LANG_LABEL[langs[0]] : '');

export const VIDEO = /\.(mp4|m4v|webm|mov|mkv)$/i;
export const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska' };
export const isVideoName = (n) => VIDEO.test(n || '');

/** "472_5_SUB.mp4" → 5,  "Serie - 05 [1080p].mp4" → 5,  "S01E07.mp4" → 7 */
export function episodeNumber(name) {
  const base = name.replace(/\.[^.]+$/, '');
  let m = /s\d{1,2}\s*e(\d{1,4})/i.exec(base);
  if (m) return Number(m[1]);
  m = /^\d+_(\d+(?:\.\d+)?)(?:_|$)/.exec(base);
  if (m) return Number(m[1]);
  const clean = base
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
    .replace(/\b(\d{3,4}p|[xh]\.?26[45]|10\s?bits?|8\s?bits?|aac\d?(\.\d)?|ddp?\d\.\d)\b/gi, ' ');
  const nums = clean.match(/\d+(?:\.\d+)?/g);
  return nums ? Number(nums[nums.length - 1]) : null;
}

/** "1. Fate UBW" → { num: 1, title: "Fate UBW" } · "1.5 OVA" → { num: 1.5, title: "OVA" } (el número decide el orden) */
export function seasonInfo(name) {
  const m = /^\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*[.)\-_:]?\s+(.*)$/.exec(name) || /^\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*$/.exec(name);
  if (m) return { num: Number(m[1].replace(',', '.')), title: (m[2] || '').trim() };
  const t = /(?:temporada|season|s)\s*(\d{1,3})\b/i.exec(name);
  return { num: t ? Number(t[1]) : null, title: name.trim() };
}

/* Carpetas de temporada: el número del inicio decide el ORDEN y el nombre decide la PESTAÑA.
 *  "2. Fate Zero" → "Fate Zero" · "1.5 OVA" → "OVA" · "3. Temporada 2 - Parte 1" → "Temporada 2 · Parte 1"
 *  "1. Temporada 1" o solo "1" → "Temporada N", contando solo las temporadas (no OVAs, especiales ni películas). */
export const SPECIAL_RE = /\b(ovas?|oads?|onas?|especial(es)?|specials?|pel[ií]culas?|movies?|films?|recap|resumen|extras?|pr[oó]logo|gekijouban)\b/i;
export const GENERIC_SEASON_RE = /^\s*(?:(?:temporada|season|s)\s*\d{1,3}\b)?\s*(?:[-–·:,]?\s*(?:parte|part|cour)\s*\d{1,2})?\s*$/i;
/** ¿El nombre de la temporada dice algo propio (sirve para buscarla en AniList y para la pestaña)? */
export const BARE_SPECIAL_RE = /^\s*(ovas?|oads?|onas?|especial(es)?|specials?|pel[ií]culas?|movies?|extras?|recap|resumen)\s*\d{0,2}\s*$/i; // "OVA" a secas no sirve para buscar
export const hasOwnTitle = (se) => !!(se && se.title && !GENERIC_SEASON_RE.test(se.title) && !BARE_SPECIAL_RE.test(se.title));
export const isSpecialSeason = (se) => !!(se && se.title && SPECIAL_RE.test(se.title));
/** Número de temporada que corresponde: el que dice el nombre ("Temporada 2") o el puesto entre las temporadas. */
export function seasonOrdinal(s, se) {
  const said = /(?:temporada|season)\s*(\d{1,3})\b/i.exec(se.title || '');
  if (said) return Number(said[1]);
  const nums = [...new Set(s.seasons.filter((x) => x.num != null && !isSpecialSeason(x)).map((x) => x.num))].sort((a, b) => a - b);
  const i = nums.indexOf(se.num);
  return i >= 0 ? i + 1 : se.num;
}
export function seasonTab(s, se) {
  if (se.num == null) return se.name;
  if (hasOwnTitle(se) || isSpecialSeason(se)) return se.title;
  const n = seasonOrdinal(s, se);
  const part = /\b(?:parte|part|cour)\s*(\d{1,2})\b/i.exec(se.title || '');
  if (part) return `Temporada ${n} · Parte ${part[1]}`;
  const twins = s.seasons.filter((x) => x.num === se.num);
  return twins.length > 1 ? `Temporada ${n} · Parte ${twins.indexOf(se) + 1}` : `Temporada ${n}`;
}

/* Nombres de las tarjetas de temporada (v37): manda lo que AniList dice que es cada carpeta, no cómo se llama.
 *  - Serie de TV (o sin ficha y sin "OVA" en el nombre) → "Temporada N", contando solo las temporadas;
 *    el número que dice la carpeta o AniList ("2nd Season") se respeta; "Part 2" o carpetas con el mismo número → "· Parte 2".
 *  - OVA, especial o película → su subtítulo ("Memory Snow"); si no tiene, "OVA" / "Especial" / "Película".
 *  Dentro de la temporada se muestra el nombre completo de AniList. */
export const MAIN_FORMATS = new Set(['Serie', 'Serie corta', 'ONA']);
export const squashW = (w) => String(w || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^0-9a-z]+/g, '');
export const sameWord = (a, b) => { a = squashW(a); b = squashW(b); return a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))); };
/** Lo que dice la carpeta después del nombre de la serie, aunque esté escrito un poco distinto ("Love Come" / "Love Comedy"). */
export function afterSeriesName(s, title) {
  const sw = String(s.name).split(/\s+/).filter(Boolean);
  const tw = String(title || '').split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < sw.length && i < tw.length && sameWord(sw[i], tw[i])) i++;
  if (i < Math.min(2, sw.length)) return String(title || '').trim();
  return tw.slice(i).join(' ').replace(/^[\s.\-–:,]+/, '').trim();
}

/** "OVA" a secas, o "Serie OVA" sin nada más: se busca entre las OVAs de la temporada de antes. */
export function isBareSpecial(s, se) {
  if (!isSpecialSeason(se)) return false;
  const rest = afterSeriesName(s, se.title || se.name).replace(/[([][^)\]]*[)\]]/g, ' ').trim();
  return !rest || BARE_SPECIAL_RE.test(rest);
}
export function specialWord(se, m) {
  const t = se.title || se.name || '';
  if (/\b(pel[ií]culas?|movies?|films?|gekijouban)\b/i.test(t)) return 'Película';
  if (/\b(ovas?|oads?)\b/i.test(t)) return 'OVA';
  if (/\b(especial(es)?|specials?)\b/i.test(t)) return 'Especial';
  if (/\bonas?\b/i.test(t)) return 'ONA';
  return (m && m.format && m.format !== 'Serie') ? m.format : 'Especial';
}

export const baseName = (n) => n.replace(/\.[^.]+$/, '').toLowerCase();

export function sortEpisodes(list) {
  return list.sort((a, b) => {
    if (a.ep != null && b.ep != null && a.ep !== b.ep) return a.ep - b.ep;
    if (a.ep != null && b.ep == null) return -1;
    if (a.ep == null && b.ep != null) return 1;
    return a.name.localeCompare(b.name, 'es', { numeric: true });
  });
}
