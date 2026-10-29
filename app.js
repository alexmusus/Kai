import { Storage } from './vendor/mega.js';
import { isSubtitleName, mp4Info, mp4Chapters, mp4Formats, mp4QuickFormats, pickIntro, OUTRO_RE as OUTRO } from './subs.js';
import { searchAnime, animeById, toMeta, findForSeries, findMovie, findTitle, findSeason, scoresByIds, tmdbFindMovie, tmdbCheckKey, translateToSpanish, canTranslate, recommendationsFor, airingTop, toDiscover } from './meta.js';

const C = window.MegaCore;
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');

/* ───────────────────────── utilidades ───────────────────────── */

const LS = {
  get(k, d) { try { const v = localStorage.getItem('kai.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  // si el navegador se queda sin espacio, se sueltan copias que se pueden volver a traer de MEGA o de internet
  // (antes fallaba sin avisar: por ejemplo, las burbujas de "nuevos" volvían al reabrir Kai)
  set(k, v) {
    const str = JSON.stringify(v);
    for (const spare of [null, ['discover'], ['syn', 'synSig'], ['meta', 'fichasSig']]) {
      if (spare) { if (spare.includes(k)) continue; spare.forEach((x) => { try { localStorage.removeItem('kai.' + x); } catch { /* nada */ } }); }
      try { localStorage.setItem('kai.' + k, str); if (spare) LS.freed = true; return true; } catch { /* sigue liberando */ }
    }
    LS.full = true;
    return false;
  },
  del(k) { try { localStorage.removeItem('kai.' + k); } catch { /* nada */ } },
};
// La app se llamaba Yoru: se conserva la sesión y el progreso guardados con ese nombre.
try {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('yoru.') && localStorage.getItem('kai.' + k.slice(5)) === null) localStorage.setItem('kai.' + k.slice(5), localStorage.getItem(k));
    if (k.startsWith('yoru.')) localStorage.removeItem(k);
  }
} catch { /* nada */ }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
function fmtLeft(p) {
  const left = Math.max(0, (p.d || 0) - (p.t || 0));
  const m = Math.round(left / 60);
  return m <= 1 ? 'casi al final' : `quedan ${m} min`;
}
function fmtSize(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return Math.round(b / 1e6) + ' MB';
  return Math.max(1, Math.round(b / 1e3)) + ' KB';
}
function hue(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const ICON = {
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  top: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6 11.5l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
  saved: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14"/><path d="M7.5 11l3 3 6-6.5"/></svg>',
  queued: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.5"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true" class="solid"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true" class="solid"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true" class="solid"><path d="M6 5.5v13l9-6.5zM16.5 5.5H19v13h-2.5z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true" class="solid"><path d="M18 5.5v13l-9-6.5zM5 5.5h2.5v13H5z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.2L12 4.5l8 6.7V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19z"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  later: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-5-3.6L7 20z"/></svg>',
  laterOn: '<svg viewBox="0 0 24 24" aria-hidden="true" class="solid"><path d="M7 4h10v16l-5-3.6L7 20z"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
};

/* ── idioma de cada archivo: "472_0_SUB.mp4" (subtitulado) / "472_0_DOB.mp4" (doblado) ──
 * Las dos versiones de un capítulo van en la misma carpeta; Kai muestra una sola (la que elijas) y comparte lo visto. */
const LANG_WORDS = 'sub(?:s|titulad[oa])?|vose|dob(?:lad[oa])?|dub(?:bed)?|lat(?:ino)?|castellano|espa[nñ]ol';
const LANG_RE = new RegExp(`(?:^|[\\s_.\\-[(])(${LANG_WORDS})(?=$|[\\s_.\\-\\])])`, 'gi');
const LANG_BOX_RE = new RegExp(`\\s*[[(]\\s*(?:${LANG_WORDS})\\s*[\\])]`, 'gi'); // "[Latino]", "(Sub)"
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
const twinKey = (ep) => stripLang(ep.name.replace(/\.[^.]+$/, '')).toLowerCase();
const LANG_LABEL = { sub: 'Sub', dob: 'Doblado' };
/** Idiomas de una lista de capítulos, contando las versiones ocultas en el otro idioma. */
function langsOf(eps) {
  const out = new Set();
  for (const ep of eps) {
    if (ep.lang) out.add(ep.lang);
    for (const path of (index.twins && index.twins.get(ep.path)) || []) { const t = index.byPath.get(path); if (t && t.ep.lang) out.add(t.ep.lang); }
  }
  return ['sub', 'dob'].filter((l) => out.has(l));
}
const langText = (langs) => (langs.length > 1 ? 'Sub y doblado' : langs.length ? LANG_LABEL[langs[0]] : '');
const langChip = (langs) => (langs.length ? `<span class="lang-chip">${langs.map((l) => (l === 'sub' ? 'SUB' : 'DOB')).join(' · ')}</span>` : '');

/* ───────────────────────── estado ───────────────────────── */

/** Tonos del modo claro (el color de fondo sirve para la barra del sistema). */
const DARK_TONES = { negro: { label: 'Negro', bg: '#0d0e12' }, gris: { label: 'Gris Culero', bg: '#4d4d4d' } };
const TONES = { blanco: { label: 'Blanco', bg: '#eef0f4' }, gris: { label: 'Gris', bg: '#c6c8cb' }, celeste: { label: 'Celeste', bg: '#d9e5f0' }, arena: { label: 'Arena', bg: '#e6e0d5' } };
const DEFAULTS = { root: 'Anime', autoplay: true, autoSkip: true, theme: 'auto' };
const FICHAS_FILE = '.kai-fichas.json';               // fichas de AniList/TMDB ya encontradas (así los demás no las buscan)
const SYN_FILE = '.kai-sinopsis.json';                 // sinopsis traducidas al español (se comparten entre dispositivos)
const SHARED_FILE = '.kai-compartido.json';            // perfiles, intros aprendidas e imágenes elegidas
const profileFile = (id) => `.kai-progreso-${id}.json`;  // progreso de cada perfil
const LEGACY_PROGRESS = ['.kai-progreso.json', '.yoru-progreso.json'];

const state = {
  syn: LS.get('syn', {}) || {}, // sinopsis en español por id de AniList: { es, u }
  synDirty: false,
  storage: null,
  connecting: false,
  library: LS.get('library', null),
  profile: LS.get('profile', null),
  shared: { profiles: [], intros: {}, picks: {}, legacyBy: null, ...LS.get('shared', {}) },
  sharedLoaded: LS.get('sharedLoaded', false),
  sharedError: false,
  meta: LS.get('meta', {}),
  progress: {},
  dirty: false,
  settings: { ...DEFAULTS, ...LS.get('settings', {}) },
  saved: new Set(),      // descargados completos
  dlMeta: new Map(),     // id -> metadatos guardados de la descarga
  dls: {},               // descargas en curso: id -> { loaded, total, ctrl }
  queue: [],             // descargas en espera: [{ ep, title }]
  error: null,
  syncState: 'idle',
};
let index = buildIndex(state.library);
const knownEps = new Map(); // capítulos vistos fuera de la biblioteca (explorar, descargados)

function saveSettings() { LS.set('settings', state.settings); }
// nada descargado se borra solo: se quita a mano desde Descargados (pedido de Alex, v11)
delete state.settings.autoRemoveLocal;
const pkey = (k) => `p.${state.profile ? state.profile.id : '_'}.${k}`;
function loadProfileState() {
  state.progress = LS.get(pkey('progress'), {});
  state.dirty = LS.get(pkey('dirty'), false);
  if (state.library && migrateProgressKeys(state.progress)) state.dirty = true; // rutas de carpetas renombradas
  try { if (state.library) index = buildIndex(state.library); } catch { /* aún no hay índice */ } // el idioma elegido es de cada perfil
}
function saveProgressLocal() {
  if (!state.profile) return;
  LS.set(pkey('progress'), state.progress);
  LS.set(pkey('dirty'), state.dirty);
}
function saveShared() { LS.set('shared', state.shared); }
const visibleProfiles = () => state.shared.profiles.filter((p) => !p.deleted);
loadProfileState();

/* ───────────────────────── nombres → capítulos ───────────────────────── */

const VIDEO = /\.(mp4|m4v|webm|mov|mkv)$/i;
const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska' };
const isVideoName = (n) => VIDEO.test(n || '');

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
const SPECIAL_RE = /\b(ovas?|oads?|onas?|especial(es)?|specials?|pel[ií]culas?|movies?|films?|recap|resumen|extras?|pr[oó]logo|gekijouban)\b/i;
const GENERIC_SEASON_RE = /^\s*(?:(?:temporada|season|s)\s*\d{1,3}\b)?\s*(?:[-–·:,]?\s*(?:parte|part|cour)\s*\d{1,2})?\s*$/i;
/** ¿El nombre de la temporada dice algo propio (sirve para buscarla en AniList y para la pestaña)? */
const BARE_SPECIAL_RE = /^\s*(ovas?|oads?|onas?|especial(es)?|specials?|pel[ií]culas?|movies?|extras?|recap|resumen)\s*\d{0,2}\s*$/i; // "OVA" a secas no sirve para buscar
const hasOwnTitle = (se) => !!(se && se.title && !GENERIC_SEASON_RE.test(se.title) && !BARE_SPECIAL_RE.test(se.title));
const isSpecialSeason = (se) => !!(se && se.title && SPECIAL_RE.test(se.title));
/** Número de temporada que corresponde: el que dice el nombre ("Temporada 2") o el puesto entre las temporadas. */
function seasonOrdinal(s, se) {
  const said = /(?:temporada|season)\s*(\d{1,3})\b/i.exec(se.title || '');
  if (said) return Number(said[1]);
  const nums = [...new Set(s.seasons.filter((x) => x.num != null && !isSpecialSeason(x)).map((x) => x.num))].sort((a, b) => a - b);
  const i = nums.indexOf(se.num);
  return i >= 0 ? i + 1 : se.num;
}
function seasonTab(s, se) {
  if (se.num == null) return se.name;
  if (hasOwnTitle(se) || isSpecialSeason(se)) return se.title;
  const n = seasonOrdinal(s, se);
  const part = /\b(?:parte|part|cour)\s*(\d{1,2})\b/i.exec(se.title || '');
  if (part) return `Temporada ${n} · Parte ${part[1]}`;
  const twins = s.seasons.filter((x) => x.num === se.num);
  return twins.length > 1 ? `Temporada ${n} · Parte ${twins.indexOf(se) + 1}` : `Temporada ${n}`;
}

function episodeLabel(ep) {
  const e = index.byId.get(ep.id);
  const s = e && state.library && state.library.series && state.library.series[e.si];
  if (isCollection(s)) {
    const it = itemFor(s, ep);
    const m = itemMeta(s, it.key);
    const t = it.title || (m && m.title) || ep.name.replace(/\.[^.]+$/, '');
    return it.eps.length > 1 ? `${t} · parte ${it.eps.indexOf(ep) + 1}` : t;
  }
  return ep.ep != null ? `Episodio ${ep.ep}` : ep.name.replace(/\.[^.]+$/, '');
}

const baseName = (n) => n.replace(/\.[^.]+$/, '').toLowerCase();

function nodePath(node) {
  const parts = [];
  for (let n = node; n && n.parent && n !== state.storage.root; n = n.parent) parts.unshift(n.name);
  return parts.join('/');
}

function findFolder(storage, path) {
  const parts = path.split('/').map((p) => p.trim()).filter(Boolean);
  let node = storage.root;
  for (const p of parts) {
    // si hay dos carpetas con el mismo nombre, se usa la que tiene más cosas (el orden en que MEGA las entrega puede cambiar)
    const same = (node.children || []).filter((c) => c.directory && c.name && c.name.toLowerCase() === p.toLowerCase());
    node = same.sort((a, b) => (b.children || []).length - (a.children || []).length)[0];
    if (!node) return null;
  }
  return node;
}

/** Capítulo a partir de un nodo de MEGA. `folderPath` es la ruta desde la raíz de MEGA. */
function makeEpisode(f, folderPath, siblings = []) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  const base = baseName(f.name);
  const subs = siblings
    .filter((s) => !s.directory && s.key && isSubtitleName(s.name) && !goneNodes.has(s.nodeId))
    .filter((s) => baseName(s.name) === base || baseName(s.name).startsWith(base + '.'))
    .map((s) => ({ id: s.nodeId, name: s.name, size: s.size, key: C.bytesToB64u(new Uint8Array(s.key)) }));
  return {
    id: f.nodeId,
    name: f.name,
    path: (folderPath ? folderPath + '/' : '') + f.name,
    ep: episodeNumber(f.name),
    size: f.size,
    key: C.bytesToB64u(new Uint8Array(f.key)),
    fa: f.fa || null,
    mime: MIME[ext] || 'video/mp4',
    ts: f.timestamp || 0, // cuándo llegó a MEGA, para "agregados recientemente"
    subs,
  };
}

function sortEpisodes(list) {
  return list.sort((a, b) => {
    if (a.ep != null && b.ep != null && a.ep !== b.ep) return a.ep - b.ep;
    if (a.ep != null && b.ep == null) return -1;
    if (a.ep == null && b.ep != null) return 1;
    return a.name.localeCompare(b.name, 'es', { numeric: true });
  });
}

const isPlayable = (c) => !c.directory && c.name && isVideoName(c.name) && c.key && !goneNodes.has(c.nodeId);
const visibleChildren = (n) => (n.children || []).filter((c) => c.name && !goneNodes.has(c.nodeId));

function buildLibrary(storage) {
  const root = findFolder(storage, state.settings.root);
  if (!root) {
    const err = new Error('NOROOT');
    throw err;
  }
  const rootPath = nodePath(root);
  const series = [];
  for (const sf of visibleChildren(root).filter((c) => c.directory && !c.name.startsWith('.'))) {
    const seasons = [];
    const kids = visibleChildren(sf);
    const direct = kids.filter(isPlayable);
    if (direct.length) {
      seasons.push({ num: null, title: '', name: '', episodes: sortEpisodes(direct.map((f) => makeEpisode(f, rootPath + '/' + sf.name, kids))) });
    }
    for (const se of kids.filter((c) => c.directory)) {
      const sk = visibleChildren(se);
      const vids = sk.filter(isPlayable);
      if (!vids.length) continue;
      seasons.push({ ...seasonInfo(se.name), name: se.name, episodes: sortEpisodes(vids.map((f) => makeEpisode(f, rootPath + '/' + sf.name + '/' + se.name, sk))) });
    }
    if (!seasons.length) continue;
    seasons.sort((a, b) => (a.num ?? 9999) - (b.num ?? 9999) || a.name.localeCompare(b.name, 'es', { numeric: true }));
    const added = Math.max(0, ...seasons.flatMap((se) => se.episodes.map((e) => e.ts || 0)));
    series.push({ name: sf.name, folderId: sf.nodeId, seasons, added });
  }
  series.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  return { root: state.settings.root, rootId: root.nodeId, v: 2, series, updated: Date.now() };
}

function buildIndex(lib) {
  const byId = new Map();
  const byPath = new Map();
  const twins = new Map(); // ruta → rutas del mismo capítulo en el otro idioma
  if (lib && lib.v === 2) {
    lib.series.forEach((s, si) => {
      s.all = [];
      s.full = [];
      s.langs = [];
      const pref = langPref(s);
      const heard = LS.get('alang', {}) || {};
      s.seasons.forEach((se, ki) => {
        const full = se.full || se.episodes;
        const groups = new Map();
        for (const ep of full) {
          ep.lang = langOf(ep.name) || heard[ep.id] || null;
          if (ep.lang && !s.langs.includes(ep.lang)) s.langs.push(ep.lang);
          const k = twinKey(ep);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(ep);
        }
        const isTwin = (g) => g.length > 1 && new Set(g.map((e) => e.lang)).size > 1;
        if ([...groups.values()].some(isTwin)) {
          se.full = full;
          se.langs = ['sub', 'dob'].filter((l) => full.some((e) => e.lang === l));
          // de cada capítulo, la versión elegida; si no existe en ese idioma, la otra
          se.episodes = full.filter((ep) => {
            const g = groups.get(twinKey(ep));
            if (!isTwin(g)) return true;
            return (g.find((e) => e.lang === pref) || g[0]) === ep;
          });
          for (const g of groups.values()) if (isTwin(g)) for (const e of g) twins.set(e.path, g.filter((x) => x !== e).map((x) => x.path));
        } else {
          delete se.full;
          se.langs = null;
          se.episodes = full;
        }
        for (const ep of full) {
          const entry = { ep, si, ki, ei: se.episodes.indexOf(ep) };
          byId.set(ep.id, entry);
          byPath.set(ep.path, entry);
          s.full.push(ep);
        }
        s.all.push(...se.episodes);
      });
    });
  }
  return { byId, byPath, twins };
}
/** Idioma que se muestra de una serie con las dos versiones: el que elegiste aquí; si no, el del último capítulo
 *  que viste de ella (así se sigue igual en otro dispositivo); si no, el último que elegiste en cualquier serie. */
// (con function: el índice se arma antes de que exista pkey)
function langKey(k) { return `p.${state.profile ? state.profile.id : '_'}.${k}`; }
function langPref(s) {
  const own = (LS.get(langKey('lang'), {}) || {})[s.name];
  if (own) return own;
  let best = null;
  for (const se of s.seasons) for (const ep of se.full || se.episodes) {
    const p = state.progress[ep.path];
    const l = p && langOf(ep.name);
    if (l && (!best || (p.u || 0) > best.u)) best = { u: p.u || 0, l };
  }
  return best ? best.l : LS.get(langKey('langLast'), 'sub');
}
/** Si el archivo no dice SUB/DOB en el nombre, el idioma del audio lo dice: español = doblado, japonés = sub. */
function learnAudioLang(ep, code) {
  if (!ep || langOf(ep.name)) return;
  const l = /^(spa|es|esl|esp)$/i.test(code || '') ? 'dob' : /^(jpn|ja)$/i.test(code || '') ? 'sub' : '';
  if (!l) return;
  const heard = LS.get('alang', {}) || {};
  if (heard[ep.id] === l) return;
  heard[ep.id] = l;
  LS.set('alang', heard);
  index = buildIndex(state.library);
}
function setLangPref(s, lang) {
  const all = LS.get(pkey('lang'), {}) || {};
  all[s.name] = lang;
  LS.set(pkey('lang'), all);
  LS.set(pkey('langLast'), lang);
  index = buildIndex(state.library);
}

function setLibrary(lib) {
  rememberPaths(state.library); // las rutas de antes, por si se renombró o movió una carpeta
  // si no cabe, mejor no dejar guardada una biblioteca vieja (se mostraría al abrir Kai hasta conectar con MEGA)
  if (!LS.set('library', lib)) LS.del('library');
  state.library = lib;
  index = buildIndex(lib);
  rememberPaths(lib);
  if (migrateProgressKeys(state.progress)) { state.dirty = true; saveProgressLocal(); }
}

/* El progreso se guarda por ruta del archivo. MEGA le da a cada archivo un id que no cambia al renombrar o mover,
 * así que Kai recuerda qué ruta tuvo cada id: si una carpeta cambia de nombre, lo visto pasa a la ruta nueva. */
function rememberPaths(lib) {
  if (!lib || lib.v !== 2) return;
  const known = LS.get('pathIds', {}) || {};
  let changed = false;
  for (const s of lib.series) for (const se of s.seasons) for (const ep of se.full || se.episodes) {
    if (known[ep.path] !== ep.id) { known[ep.path] = ep.id; changed = true; }
  }
  if (changed) LS.set('pathIds', known);
}

function librarySignature(lib) {
  if (!lib) return '';
  return lib.root + '|' + lib.series.map((s) => s.name + '@' + (s.added || 0) + ':' + s.seasons.map((se) => se.name + '=' + (se.full || se.episodes).map((e) => e.id + (e.fa ? '+' : '') + e.subs.length).join(',')).join(';')).join('|');
}

/** La versión 1 guardaba rutas relativas a la carpeta de series; ahora son desde la raíz de MEGA. */
function migrateProgressKeys(obj) {
  if (!state.library || !state.library.series) return false;
  const prefix = state.settings.root.replace(/^\/+|\/+$/g, '') + '/';
  let changed = false;
  const known = LS.get('pathIds', {}) || {};
  for (const k of Object.keys(obj)) {
    if (index.byPath.has(k)) continue;
    let nk = index.byPath.has(prefix + k) ? prefix + k : null;
    if (!nk && known[k]) { const e = index.byId.get(known[k]); if (e && e.ep.path !== k) nk = e.ep.path; } // carpeta renombrada o movida
    if (!nk) continue;
    if (!obj[nk] || obj[nk].u < obj[k].u) obj[nk] = obj[k];
    delete obj[k];
    changed = true;
  }
  return changed;
}

/* ───────────────────────── IndexedDB ───────────────────────── */

const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('yoru', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['id', 'i'] });
      if (!db.objectStoreNames.contains('dl')) db.createObjectStore('dl', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs');
      if (!db.objectStoreNames.contains('subcache')) db.createObjectStore('subcache');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode);
      const out = fn(tx.objectStore(store));
      tx.oncomplete = () => res(out && 'result' in out ? out.result : out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  };
  const range = (id) => IDBKeyRange.bound([id, 0], [id, Infinity]);
  return {
    get: (s, k) => run(s, 'readonly', (st) => st.get(k)),
    put: (s, v, k) => run(s, 'readwrite', (st) => (k === undefined ? st.put(v) : st.put(v, k))),
    del: (s, k) => run(s, 'readwrite', (st) => st.delete(k)),
    all: (s) => run(s, 'readonly', (st) => st.getAll()),
    chunkKeys: (id) => run('chunks', 'readonly', (st) => st.getAllKeys(range(id))),
    chunks: (id) => run('chunks', 'readonly', (st) => st.getAll(range(id))),
    dropChunks: (id) => run('chunks', 'readwrite', (st) => st.delete(range(id))),
    clear: (s) => run(s, 'readwrite', (st) => st.clear()),
  };
})();

/* ───────────────────────── MEGA ───────────────────────── */

// megajs no conserva el atributo "fa" (miniaturas); lo guardamos al importar cada nodo.
const importFile = Storage.prototype._importFile;
Storage.prototype._importFile = function (f) {
  const file = importFile.call(this, f);
  if (file && f && f.fa) file.fa = f.fa;
  return file;
};

function megaMessage(err) {
  if (err && err.code === 'QUOTA') {
    noteQuota(err.timeLeft || 0);
    const q = LS.get('quota', null);
    const m = q && q.until > Date.now() ? Math.ceil((q.until - Date.now()) / 60000) : 0;
    return 'Llegaste al límite de transferencia gratuita de MEGA.' + (m ? ` Se renueva en ${m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`}.` : ' Se renueva solo en unas horas.');
  }
  const msg = String((err && err.message) || err);
  if (/ENOENT|invalid credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/EMFAREQUIRED/.test(msg)) return 'MFA';
  if (/ESID/.test(msg)) return 'Tu sesión de MEGA venció. Vuelve a entrar.';
  if (/EBLOCKED/.test(msg)) return 'MEGA bloqueó esta cuenta. Revísala en mega.nz.';
  if (/ERATELIMIT|EAGAIN|ETEMPUNAVAIL/.test(msg)) return 'MEGA está ocupado. Intenta de nuevo en unos segundos.';
  if (/EOVERQUOTA|Bandwidth|QUOTA|509/.test(msg)) return 'Llegaste al límite de transferencia gratuita de MEGA. Se renueva solo en unas horas.';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'No hay conexión con MEGA.';
  return 'Algo falló con MEGA: ' + msg;
}

async function login(email, password, code) {
  const opts = { email, password, keepalive: true, autoload: true };
  if (code) opts.secondFactorCode = code;
  const st = new Storage(opts);
  await st.ready;
  const json = st.toJSON();
  delete json.options.password;
  delete json.options.secondFactorCode;
  LS.set('session', json);
  loginNote = '';
  state.storage = st;
  watchStorage(st);
}

async function connect() {
  const sess = LS.get('session', null);
  if (!sess || state.connecting) return false;
  state.connecting = true;
  try {
    // una sesión incompleta (vieja o dañada) no se puede restaurar: se pide entrar de nuevo.
    // Solo se borra la sesión; el progreso y los perfiles siguen en MEGA.
    if (!sess.key || !sess.sid || !sess.options) throw new Error('ESID');
    let st;
    try { st = Storage.fromJSON(JSON.parse(JSON.stringify(sess))); } catch { throw new Error('ESID'); }
    await st.reload(true);
    await settleTree(st);
    st.status = 'ready';
    if (state.storage && state.storage !== st) {
      try { state.storage.api.close(); } catch { /* nada */ }
    }
    state.storage = st;
    watchStorage(st);
    return true;
  } finally {
    state.connecting = false;
  }
}

/* MEGA a veces entrega primero una foto vieja de tus carpetas y enseguida manda los cambios que faltan
 * (por eso al tocar Actualizar se veía unos segundos One Piece y otras series de hace meses). Antes de usar
 * el árbol nuevo se espera a que esos cambios dejen de llegar: 2.5 s sin novedades (máximo 20 s). */
function settleTree(st) {
  return new Promise((resolve) => {
    let quiet;
    const evs = ['add', 'delete', 'move', 'update'];
    const done = () => { clearTimeout(quiet); clearTimeout(cap); evs.forEach((ev) => st.removeListener(ev, bump)); resolve(); };
    const bump = () => { clearTimeout(quiet); quiet = setTimeout(done, 2500); };
    const cap = setTimeout(done, 20000);
    evs.forEach((ev) => st.on(ev, bump));
    bump();
  });
}

let libraryTimer;
function watchStorage(st) {
  const later = (f) => {
    if (f && f.name && f.name.startsWith('.kai-')) return;
    clearTimeout(libraryTimer);
    libraryTimer = setTimeout(() => refreshLibrary(), 1500);
  };
  ['add', 'delete', 'move', 'update'].forEach((ev) => st.on(ev, later));
}

function refreshLibrary(rerender = true) {
  if (!state.storage) return;
  const before = librarySignature(state.library);
  const hadError = !!state.error;
  try {
    const lib = buildLibrary(state.storage);
    if (librarySignature(lib) !== before || !state.library || state.library.v !== 2) setLibrary(lib);
    state.error = null;
    initKnown();
    announceNew();
    ensureMeta();
  } catch (err) {
    state.error = err;
  }
  const changed = librarySignature(state.library) !== before || hadError !== !!state.error;
  if (rerender && changed) softRender();
}

const urlCache = new Map();
const goneNodes = new Set(); // borrados por nosotros; megajs los quita del árbol cuando MEGA lo confirma

async function downloadUrl(id, fresh = false) {
  const c = urlCache.get(id);
  if (!fresh && c && Date.now() - c.at < 20 * 60 * 1000) return c.url;
  if (!state.storage) await connect();
  if (!state.storage) throw new Error('Sin sesión');
  const r = await state.storage.api.request({ a: 'g', g: 1, ssl: 2, n: id });
  if (r.tl > 0) noteQuota(r.tl);
  if (typeof r.g !== 'string' || !r.g.startsWith('http')) throw new Error('EOVERQUOTA');
  urlCache.set(id, { url: r.g, at: Date.now() });
  return r.g;
}

async function readNodeText(node) {
  const url = await downloadUrl(node.id, true);
  const fk = await C.fileKey(node.key);
  if (!node.size) return '';
  const bytes = await C.readRange(url, fk, 0, node.size - 1);
  const utf8 = new TextDecoder().decode(bytes);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}

/* ───────────────────────── miniaturas ───────────────────────── */

const thumbUrls = new Map();
const thumbQueue = [];
let thumbActive = 0;

function thumbFor(ep) {
  if (!ep || !ep.fa) return Promise.resolve(null);
  if (thumbUrls.has(ep.id)) return thumbUrls.get(ep.id);
  const p = new Promise((resolve) => {
    thumbQueue.push(async () => {
      try {
        let blob = await idb.get('thumbs', ep.id).catch(() => null);
        if (!blob && state.storage && navigator.onLine) {
          blob = await fetchThumb(ep);
          if (blob) idb.put('thumbs', blob, ep.id).catch(() => {});
        }
        resolve(blob ? URL.createObjectURL(blob) : null);
      } catch {
        resolve(null);
      }
    });
    pumpThumbs();
  });
  thumbUrls.set(ep.id, p);
  p.then((u) => { if (!u) thumbUrls.delete(ep.id); });
  return p;
}

function pumpThumbs() {
  while (thumbActive < 3 && thumbQueue.length) {
    const job = thumbQueue.shift();
    thumbActive++;
    job().finally(() => { thumbActive--; pumpThumbs(); });
  }
}

async function fetchThumb(ep) {
  const attrs = ep.fa.split('/').map((s) => /(\d+):(\d+)\*([\w-]+)/.exec(s)).filter(Boolean)
    .map((m) => ({ type: Number(m[2]), h: m[3] }));
  const pick = attrs.find((a) => a.type === 1) || attrs.find((a) => a.type === 0);
  if (!pick) return null;
  const r = await state.storage.api.request({ a: 'ufa', fah: pick.h, ssl: 2, r: 1 });
  if (!r || !r.p) return null;
  const res = await fetch(r.p + '/' + pick.type, { method: 'POST', body: C.b64uToBytes(pick.h) });
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length < 12) return null;
  const len = new DataView(buf.buffer, buf.byteOffset + 8, 4).getUint32(0, true);
  const fk = await C.fileKey(ep.key);
  const dec = await C.cbcDecryptNoPad(fk, buf.subarray(12, 12 + len));
  return new Blob([dec], { type: 'image/jpeg' });
}

const thumbObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    thumbObserver.unobserve(e.target);
    loadThumb(e.target);
  }
}, { rootMargin: '300px' }) : null;

function loadThumb(el) {
  const ep = epById(el.dataset.thumb);
  if (!ep) return;
  thumbFor(ep).then((u) => {
    if (!u) return;
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.onload = () => { el.prepend(img); el.classList.add('has-img'); };
    img.src = u;
  });
}

function hydrateThumbs(scope = document) {
  scope.querySelectorAll('[data-thumb]:not(.thumb-seen)').forEach((el) => {
    el.classList.add('thumb-seen');
    if (thumbObserver) thumbObserver.observe(el); else loadThumb(el);
  });
  hydrateCodecs(scope);
}

/* ── códec de cada video, en pequeño sobre la miniatura ──
 * Se lee una sola vez por archivo (solo el principio del índice del MP4) y se guarda.
 * El puntito rojo depende de ESTE dispositivo: el mismo AV1 lo lleva en el iPad M2 y no en el iPhone. */
const codecCache = LS.get('codecs', {}) || {};
const codecKey = (ep) => `${ep.id}:${ep.size}`;
const CODEC_NAMES = { avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC', hev1: 'HEVC', av01: 'AV1', vp09: 'VP9', vp08: 'VP8', mp4v: 'MPEG-4' };
function codecTagHTML(ep) {
  if (!/mp4|quicktime/.test(ep.mime || '')) return '';
  const f = codecCache[codecKey(ep)];
  if (!f) return `<span class="ep-codec is-pending" data-codec="${esc(ep.id)}"></span>`;
  return codecTagInner(f);
}
function codecTagInner(f) {
  if (!f.video) return '';
  const name = CODEC_NAMES[f.video.codec] || f.video.codec.toUpperCase();
  const prob = formatProblem(f);
  return `<span class="ep-codec ${prob ? 'is-bad' : ''}" title="${esc(prob ? `${name}: este dispositivo no lo puede reproducir` : name)}">${prob ? '<i aria-hidden="true"></i>' : ''}${esc(name)}</span>`;
}
const codecQueue = [];
let codecActive = 0;
const codecObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    codecObserver.unobserve(e.target);
    const tag = e.target.querySelector('.ep-codec.is-pending');
    if (tag) codecQueue.push(tag);
  }
  pumpCodecs();
}, { rootMargin: '200px' }) : null;
function hydrateCodecs(scope = document) {
  if (!codecObserver || !navigator.onLine) return;
  // se observa la miniatura (la etiqueta pendiente está oculta y el navegador no avisa de lo oculto)
  scope.querySelectorAll('.ep-codec.is-pending:not(.codec-seen)').forEach((el) => {
    el.classList.add('codec-seen');
    codecObserver.observe(el.closest('.ep-thumb') || el.parentElement);
  });
}
function pumpCodecs() {
  while (codecActive < 2 && codecQueue.length) {
    const el = codecQueue.shift();
    const ep = epById(el.dataset.codec);
    if (!ep || !el.isConnected) continue;
    codecActive++;
    readCodec(ep).then((f) => {
      if (!f) return;
      document.querySelectorAll(`.ep-codec[data-codec="${CSS.escape(ep.id)}"]`).forEach((x) => { x.outerHTML = codecTagInner(f); });
    }).catch(() => {}).finally(() => { codecActive--; pumpCodecs(); });
  }
}
async function readCodec(ep) {
  const k = codecKey(ep);
  if (codecCache[k]) return codecCache[k];
  const f = await mp4QuickFormats(await rangeReader(ep, null), ep.size);
  if (!f) return null;
  codecCache[k] = { video: f.video, audio: f.audio };
  LS.set('codecs', codecCache);
  return codecCache[k];
}

function coverHTML(name, ep, cls = '') {
  const initial = esc([...String(name).trim()][0] || '·');
  return `<div class="cover ${cls}" style="--h:${hue(name)}" ${ep && ep.fa ? `data-thumb="${esc(ep.id)}"` : ''}>
    <span class="cover-glyph" aria-hidden="true">${initial}</span></div>`;
}

/* ───────────────────────── capítulos fuera de la biblioteca ───────────────────────── */

function epById(id) {
  const e = index.byId.get(id);
  if (e) return e.ep;
  if (knownEps.has(id)) return knownEps.get(id);
  const m = state.dlMeta.get(id);
  return m && m.ep ? m.ep : null;
}

/** Todo lo que el reproductor necesita: el capítulo, su lista y a dónde vuelve. */
function resolveContext(id) {
  const e = index.byId.get(id);
  if (e) {
    const s = state.library.series[e.si];
    const season = s.seasons[e.ki];
    // un capítulo en el idioma que no está elegido (desde Descargados, por ejemplo): la lista sigue en su idioma
    const list = e.ei >= 0 || !season.full ? season.episodes : season.full.filter((x) => !index.twins.has(x.path) || x.lang === e.ep.lang);
    return {
      // la lista del reproductor es solo la temporada: al terminarla, Kai se detiene (no pasa sola a la siguiente)
      ep: e.ep, list, shown: list, title: s.name,
      sub: isCollection(s) ? '' : s.seasons.length > 1 ? seasonTab(s, season) : (hasOwnTitle(season) && season.title !== s.name ? season.title : ''),
      ki: e.ki,
      back: isCollection(s) ? movieHref(e.si, itemFor(s, e.ep).key) : seasonHref(e.si, s, e.ki), si: e.si,
    };
  }
  const node = state.storage && state.storage.files[id];
  if (node && node.parent && isPlayable(node)) {
    const parent = node.parent;
    const kids = visibleChildren(parent);
    const list = sortEpisodes(kids.filter(isPlayable).map((f) => index.byId.get(f.nodeId)?.ep || makeEpisode(f, nodePath(parent), kids)));
    list.forEach((x) => { if (!index.byId.has(x.id)) knownEps.set(x.id, x); });
    const name = parent === state.storage.root ? 'Mi MEGA' : parent.name;
    return { ep: list.find((x) => x.id === id), list, shown: list, title: name, sub: '', back: '#/explorar/' + parent.nodeId };
  }
  const m = state.dlMeta.get(id);
  if (m && m.ep) {
    const list = sortEpisodes([...state.dlMeta.values()].filter((x) => x.ep && x.title === m.title).map((x) => x.ep));
    return { ep: m.ep, list, shown: list, title: m.title || 'Descargados', sub: '', back: '#/descargas' };
  }
  return null;
}

function titleFor(ep) {
  const c = resolveContext(ep.id);
  return c ? c.title : '';
}

/* ───────────────────────── progreso ───────────────────────── */

/** Lo visto de un capítulo. Si está en los dos idiomas, cuenta lo de ambos: el minuto del más reciente y,
 *  si cualquiera de los dos se terminó, queda visto. */
function prog(ep) {
  const own = state.progress[ep.path];
  const tw = index.twins && index.twins.get(ep.path);
  if (!tw) return own;
  let best = own;
  let w = !!(own && own.w);
  for (const path of tw) {
    const q = state.progress[path];
    if (!q) continue;
    if (q.w) w = true;
    if (!best || (q.u || 0) > (best.u || 0)) best = q;
  }
  return best && best.w !== w ? { ...best, w } : best;
}

function setProgress(ep, t, d, watched) {
  const cur = state.progress[ep.path] || {};
  const w = watched ?? (cur.w || (d > 0 && t / d > 0.92));
  state.progress[ep.path] = { t: Math.round(t * 10) / 10, d: Math.round(d || cur.d || 0), w: !!w, u: Date.now() };
  state.dirty = true;
  saveProgressLocal();
}

/* ── este dispositivo: para "Seguir en otro dispositivo" ── */
const DEVICE = (() => {
  let d = LS.get('device', null);
  if (!d) { d = Math.random().toString(36).slice(2, 10); LS.set('device', d); }
  return d;
})();
function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'teléfono Android' : 'tablet Android';
  if (/Windows/.test(ua)) return 'PC';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'otro dispositivo';
}

/* Entradas especiales dentro del progreso de cada perfil (se sincronizan y fusionan igual, por `u`):
 *  "@now"               qué se está viendo, en qué segundo y en qué dispositivo
 *  "@later/<serie>"      la serie está en "Más tarde"; "@later/<serie>/<película>" para una película */
function markNow(ep, t, d) {
  const p = prog(ep) || {};
  state.progress['@now'] = { p: ep.path, t: Math.round(t), d: Math.round(d || 0), w: !!p.w, dev: DEVICE, dn: deviceName(), u: Date.now() };
}
/** Lo que quedó viendo este perfil en otro dispositivo hace poco, si conviene ofrecer seguir aquí. */
function resumeOffer() {
  const n = state.progress['@now'];
  if (!n || !n.p || n.dev === DEVICE || n.w || n.t < 15 || Date.now() - n.u > 12 * 3600000) return null;
  if (playing || LS.get('nowSeen', 0) === n.u) return null;
  const e = index.byPath.get(n.p);
  if (!e) return null; // ya no está en MEGA
  const p = prog(e.ep);
  if (p && p.w) return null;
  return { ep: e.ep, s: state.library.series[e.si], n };
}

const laterKey = (s, itemKey = '') => `@later/${s.name}${itemKey ? '/' + itemKey : ''}`;
const isLater = (s, itemKey = '') => !!(state.progress[laterKey(s, itemKey)] || {}).on;
function setLater(s, itemKey, on) {
  state.progress[laterKey(s, itemKey)] = { on: !!on, u: Date.now() };
  state.dirty = true;
  saveProgressLocal();
  toast(on ? 'Agregado a Más tarde.' : 'Quitado de Más tarde.');
  softRender();
  sync();
}
/** Lo marcado para más tarde que sigue en MEGA y sin terminar, lo más reciente primero. */
function laterList() {
  const lib = state.library;
  if (!lib || lib.v !== 2) return [];
  const out = [];
  lib.series.forEach((s, si) => {
    const coll = isCollection(s);
    const items = coll ? collectionItems(s) : [null];
    for (const it of items) {
      const v = state.progress[laterKey(s, it ? it.key : '')];
      if (!v || !v.on) continue;
      const eps = it ? it.eps : s.all;
      if (eps.length && eps.every((e) => (prog(e) || {}).w)) continue; // ya lo vio todo
      out.push({ s, si, it, u: v.u });
    }
  });
  return out.sort((a, b) => b.u - a.u);
}

function continueList() {
  if (!state.library || state.library.v !== 2) return [];
  const out = [];
  state.library.series.forEach((s) => {
    let best = null;
    for (const ep of s.all) {
      const p = prog(ep);
      if (p && (!best || p.u > best.p.u)) best = { ep, p };
    }
    if (!best) return;
    let ep = best.ep;
    let p = best.p;
    if (p.w) {
      const i = s.all.indexOf(ep);
      ep = s.all.slice(i + 1).find((x) => !(prog(x) || {}).w);
      if (!ep) return;
      p = prog(ep) || null;
    }
    out.push({ series: s, ep, p, u: best.p.u });
  });
  return out.sort((a, b) => b.u - a.u);
}

function mergeProgress(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (!v || typeof v.u !== 'number') continue;
    if (!out[k] || v.u > out[k].u) out[k] = v;
  }
  return out;
}

/* Respaldo de los perfiles en los atributos de la carpeta de la biblioteca: llegan con la lista de
 * archivos de MEGA, sin descargar nada, así que se pueden ver aunque la cuota esté agotada. */
const BACKUP_ATTR = 'kaip';
async function backupProfiles() {
  const folder = state.storage && findFolder(state.storage, state.settings.root);
  if (!folder || typeof folder.setAttributes !== 'function') return;
  const want = visibleProfiles().filter((p) => !p.mergedInto).map((p) => ({ i: p.id, n: p.name, h: p.hue, c: p.created || 0, u: p.u || 0 }));
  if (!want.length || JSON.stringify((folder.attributes || {})[BACKUP_ATTR]) === JSON.stringify(want)) return;
  try { await folder.setAttributes({ [BACKUP_ATTR]: want }); } catch (err) { console.warn('respaldo de perfiles', err); }
}
function profilesFromBackup() {
  const folder = state.storage && findFolder(state.storage, state.settings.root);
  const b = folder && folder.attributes && folder.attributes[BACKUP_ATTR];
  return Array.isArray(b) ? b.filter((x) => x && x.i && x.n).map((x) => ({ id: x.i, name: x.n, hue: x.h, created: x.c, u: x.u })) : [];
}

let syncing = null;
function sync() {
  if (syncing) return syncing;
  syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

function mergeShared(a, b) {
  const byU = (x, y) => {
    const out = { ...x };
    for (const [k, v] of Object.entries(y || {})) if (v && (!out[k] || (v.u || 0) > (out[k].u || 0))) out[k] = v;
    return out;
  };
  const profiles = byU(Object.fromEntries((a.profiles || []).map((p) => [p.id, p])), Object.fromEntries((b.profiles || []).map((p) => [p.id, p])));
  return {
    profiles: Object.values(profiles).sort((x, y) => (x.created || 0) - (y.created || 0)),
    intros: byU(a.intros, b.intros),
    picks: byU(a.picks, b.picks),
    keys: byU(a.keys, b.keys), // claves de servicios (TMDB para Cine): { tmdb: { v, u } }
    legacyBy: a.legacyBy || b.legacyBy || null,
  };
}

const filesNamed = (folder, name) => visibleChildren(folder).filter((c) => !c.directory && c.name === name);
/** Lee un JSON de MEGA. Si no se puede leer, lanza error (nunca se confunde con "vacío"). Si está dañado, devuelve null. */
async function readJson(n) {
  let text;
  // un fallo pasajero de MEGA se reintenta un par de veces; si sigue fallando, NUNCA se trata como vacío
  for (let tries = 0; ; tries++) {
    try {
      text = await readNodeText({ id: n.nodeId, key: C.bytesToB64u(new Uint8Array(n.key)), size: n.size });
      break;
    } catch (err) {
      if (tries < 2 && navigator.onLine && !(err && err.code === 'QUOTA')) { await sleep(1200 * (tries + 1)); continue; }
      const e = new Error('No se pudo leer ' + n.name + ': ' + (err && err.message));
      e.cause = err;
      throw e;
    }
  }
  try { return JSON.parse(text); } catch { return null; }
}

const normName = (n) => String(n || '').trim().toLocaleLowerCase('es');

/** Perfiles con el mismo nombre se juntan en el más antiguo. */
function dedupeProfiles() {
  const keep = new Map();
  let changed = false;
  for (const p of state.shared.profiles) {
    if (p.deleted) continue;
    const k = normName(p.name);
    const first = keep.get(k);
    if (!first) { keep.set(k, p); continue; }
    p.deleted = true;
    p.mergedInto = first.id;
    p.u = Date.now();
    if (state.shared.legacyBy === p.id) state.shared.legacyBy = first.id;
    changed = true;
  }
  return changed;
}

function finalProfileId(id) {
  for (let i = 0; i < 8; i++) {
    const p = state.shared.profiles.find((x) => x.id === id);
    if (!p || !p.mergedInto) return id;
    id = p.mergedInto;
  }
  return id;
}
async function writeJson(folder, name, obj, replaced) {
  const buf = new TextEncoder().encode(JSON.stringify(obj));
  const fresh = await folder.upload({ name, size: buf.length }, buf).complete;
  for (const n of replaced) {
    if (n === fresh) continue;
    goneNodes.add(n.nodeId);
    await n.delete(true).catch(() => {});
  }
  return fresh;
}

async function doSync() {
  if (!state.storage || !navigator.onLine) return;
  const home = state.storage.root;
  state.syncState = 'syncing';
  paintSync();
  try {
    // 1) lo compartido entre perfiles
    const sNodes = filesNamed(home, SHARED_FILE);
    let remoteShared = { profiles: [], intros: {}, picks: {}, legacyBy: null };
    for (const n of sNodes) { const d = await readJson(n); if (d) remoteShared = mergeShared(remoteShared, d); }
    const before = stable(state.shared);
    state.shared = mergeShared(state.shared, remoteShared);
    dedupeProfiles();
    const sharedChanged = stable(state.shared) !== before;
    saveShared();
    // si este dispositivo estaba en un perfil que se juntó con otro, pasa al que quedó
    if (state.profile) {
      const fid = finalProfileId(state.profile.id);
      if (fid !== state.profile.id) {
        const keeper = state.shared.profiles.find((x) => x.id === fid);
        const mine = state.progress;
        state.profile = { id: keeper.id, name: keeper.name };
        LS.set('profile', state.profile);
        loadProfileState();
        state.progress = mergeProgress(state.progress, mine);
        state.dirty = true;
        saveProgressLocal();
      }
    }
    const hasShared = state.shared.profiles.length || Object.keys(state.shared.intros).length || Object.keys(state.shared.picks).length || Object.keys(state.shared.keys || {}).length;
    if (hasShared && (sNodes.length !== 1 || stable(state.shared) !== stable(remoteShared))) {
      await writeJson(home, SHARED_FILE, { v: 3, app: 'kai', ...state.shared }, sNodes);
    }
    if (!state.sharedLoaded) { state.sharedLoaded = true; LS.set('sharedLoaded', true); }
    state.sharedError = false;
    await backupProfiles();
    // 1b) sinopsis traducidas (un fallo aquí no frena el progreso)
    try { await syncSynopses(home); } catch (err) { console.warn('sinopsis', err); }
    try { await syncFichas(home); } catch (err) { console.warn('fichas', err); }

    // 2) progreso del perfil activo
    let changedHere = false;
    if (state.profile) {
      const pid = state.profile.id;
      const nodes = filesNamed(home, profileFile(pid));
      const libRoot = findFolder(state.storage, state.settings.root);
      // el primer perfil se queda con el progreso de antes de que hubiera perfiles
      const legacy = state.shared.legacyBy === pid ? [
        ...visibleChildren(home).filter((c) => !c.directory && LEGACY_PROGRESS.includes(c.name)),
        ...(libRoot ? filesNamed(libRoot, '.progreso.json') : []),
      ] : [];
      // progreso de perfiles duplicados que se juntaron con este
      const absorbed = state.shared.profiles.filter((x) => x.mergedInto === pid).flatMap((x) => filesNamed(home, profileFile(x.id)));
      legacy.push(...absorbed);
      let remote = {};
      for (const n of [...nodes, ...legacy]) {
        const data = await readJson(n);
        if (!data) continue;
        const items = data.items || {};
        migrateProgressKeys(items);
        remote = mergeProgress(remote, items);
        if (data.intros) state.shared.intros = mergeShared(state.shared, { intros: data.intros }).intros;
      }
      const merged = mergeProgress(state.progress, remote);
      changedHere = JSON.stringify(merged) !== JSON.stringify(state.progress);
      const hasData = Object.keys(merged).length > 0;
      const needUpload = hasData && (nodes.length !== 1 || legacy.length > 0 || Object.keys(merged).some((k) => !remote[k] || merged[k].u > remote[k].u));
      state.progress = merged;
      if (needUpload) await writeJson(home, profileFile(pid), { v: 3, app: 'kai', profile: pid, items: merged }, [...nodes, ...legacy]);
      state.dirty = false;
      saveProgressLocal();
    }
    state.syncState = 'idle';
    if (changedHere || sharedChanged) softRender();
  } catch (err) {
    state.syncState = 'error';
    if (!state.sharedLoaded) {
      state.sharedError = true;
      state.sharedErrorMsg = megaMessage((err && err.cause) || err); // el motivo real: cuota, sesión, red…
      // sin poder leer el archivo de perfiles (p. ej. sin cuota), se muestran los del respaldo para poder entrar;
      // no se escribe nada en MEGA hasta poder leer el archivo de verdad
      for (const p of profilesFromBackup()) if (!state.shared.profiles.some((x) => x.id === p.id)) state.shared.profiles.push(p);
      if (!state.profile || route().view === 'perfiles') render();
    }
    console.warn('sync', err);
  }
  paintSync();
}

/** El estado de sincronización vive en el botón flotante: ruedita azul mientras sincroniza, puntito verde si está al día. */
const SYNC_LABEL = { offline: 'sin conexión', syncing: 'sincronizando', pending: 'por sincronizar', ok: 'al día' };
function paintSync() {
  const d = $('#dock');
  if (!d) return;
  const offline = !navigator.onLine;
  const pending = state.dirty || state.syncState === 'error';
  const st = offline ? 'offline' : state.syncState === 'syncing' ? 'syncing' : pending ? 'pending' : 'ok';
  d.dataset.sync = st;
  const btn = d.querySelector('.dock-btn');
  if (btn && btn.dataset.name) btn.setAttribute('aria-label', `Menú (${btn.dataset.name}), ${SYNC_LABEL[st]}${hasUnreadNews() ? ', hay novedades' : ''}`);
}

/* ───────────────────────── descargas ───────────────────────── */

const CHUNK = 4 * 1024 * 1024;
const PARALLEL = 3;
let wakeLock = null;

async function refreshSaved() {
  const metas = await idb.all('dl').catch(() => []);
  state.dlMeta = new Map(metas.map((m) => [m.id, m]));
  state.saved = new Set(metas.filter((m) => m.done).map((m) => m.id));
  return metas;
}

async function holdWake() {
  try {
    if (!wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* no soportado */ }
}
function releaseWake() {
  if (!Object.keys(state.dls).length && !state.queue.length && wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

/** Pone un capítulo en la cola; se descarga uno a la vez. */
function queueDownload(ep, title) {
  if (state.dls[ep.id] || state.saved.has(ep.id) || state.queue.some((q) => q.ep.id === ep.id)) return;
  if (!navigator.onLine) { toast('Necesitas conexión para descargar.'); return; }
  state.queue.push({ ep, title: title || titleFor(ep) });
  askFolderIfNeeded();
  paintEpisode(ep.id);
  pumpDownloads();
}

let downloading = null;
async function pumpDownloads() {
  if (downloading || !state.queue.length) return;
  const job = state.queue.shift();
  downloading = runDownload(job.ep, job.title).finally(() => {
    downloading = null;
    pumpDownloads();
  });
}

function downloadAndWait(ep, title) {
  queueDownload(ep, title);
  return new Promise((resolve) => {
    const check = () => {
      if (state.saved.has(ep.id) || (!state.dls[ep.id] && !state.queue.some((q) => q.ep.id === ep.id))) resolve();
      else setTimeout(check, 400);
    };
    check();
  });
}

async function runDownload(ep, title) {
  const task = { loaded: 0, total: ep.size, ctrl: new AbortController() };
  state.dls[ep.id] = task;
  paintEpisode(ep.id);
  holdWake();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* nada */ }
  try {
    const meta = (await idb.get('dl', ep.id)) || { id: ep.id, done: false, at: Date.now() };
    Object.assign(meta, { ep, title: title || meta.title || '', size: ep.size, mime: ep.mime, path: ep.path });
    await idb.put('dl', meta);
    state.dlMeta.set(ep.id, meta);
    const have = new Set((await idb.chunkKeys(ep.id)).map((k) => k[1]));
    const n = Math.ceil(ep.size / CHUNK);
    const todo = [];
    for (let i = 0; i < n; i++) if (!have.has(i)) todo.push(i);
    task.loaded = Math.min(ep.size, (n - todo.length) * CHUNK);
    const fk = await C.fileKey(ep.key);
    let url = await downloadUrl(ep.id);
    let lastPaint = 0;

    const worker = async () => {
      while (todo.length) {
        if (task.ctrl.signal.aborted) return;
        const i = todo.shift();
        const start = i * CHUNK;
        const end = Math.min(ep.size, start + CHUNK) - 1;
        for (let tries = 0; ; tries++) {
          try {
            const data = await C.readRange(url, fk, start, end, task.ctrl.signal);
            await idb.put('chunks', { id: ep.id, i, blob: new Blob([data]) });
            task.loaded += data.length;
            countBytes(data.length);
            break;
          } catch (err) {
            if (task.ctrl.signal.aborted) return;
            if (err.code === 'QUOTA') noteQuota(err.timeLeft || 3600);
            if (err.code === 'QUOTA' || tries >= 4) throw err;
            if (err.code === 'HTTP') url = await downloadUrl(ep.id, true);
            await sleep(800 * (tries + 1));
          }
        }
        if (Date.now() - lastPaint > 250) { lastPaint = Date.now(); paintEpisode(ep.id); }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (task.ctrl.signal.aborted) return;

    meta.done = true;
    await idb.put('dl', meta);
    state.saved.add(ep.id);
    state.dlMeta.set(ep.id, meta);
    cacheChapters(ep).catch(() => {});
    let where = '';
    if (await getDir()) {
      try {
        where = (await moveToFolder(ep.id)) ? ' en tu carpeta' : '';
        if (!where) toast(`${episodeLabel(ep)} quedó dentro de la app: Kai no tiene permiso para tu carpeta ahora (Ajustes → Permitir acceso).`);
      } catch {
        toast(`No se pudo guardar ${episodeLabel(ep)} en tu carpeta; quedó dentro de la app.`);
      }
    }
    if (where || !(await getDir())) toast(`${episodeLabel(ep)} listo para ver sin conexión${where}.`);
  } catch (err) {
    if (!task.ctrl.signal.aborted) toast(megaMessage(err));
  } finally {
    delete state.dls[ep.id];
    paintEpisode(ep.id);
    paintDrawerCount();
    releaseWake();
  }
}

async function removeDownload(id, quiet = false) {
  const t = state.dls[id];
  if (t) t.ctrl.abort();
  state.queue = state.queue.filter((q) => q.ep.id !== id);
  const meta = state.dlMeta.get(id) || (await idb.get('dl', id).catch(() => null));
  if (meta && meta.where === 'folder' && meta.rel) {
    // sin permiso ahora: se borra la próxima vez que Kai pueda entrar a la carpeta
    if (!(await deleteFromFolder(meta.rel, meta.dirKey))) LS.set('folderTrash', [...LS.get('folderTrash', []), { rel: meta.rel, dirKey: meta.dirKey }]);
  }
  await idb.dropChunks(id).catch(() => {});
  await idb.del('dl', id).catch(() => {});
  state.saved.delete(id);
  state.dlMeta.delete(id);
  delete state.dls[id];
  paintEpisode(id);
  paintDrawerCount();
  if (!quiet) toast('Quitado del dispositivo.');
  if (route().view === 'descargas') renderDownloads();
}

async function resumePendingDownloads() {
  const metas = await refreshSaved();
  if (!navigator.onLine) return;
  for (const m of metas) {
    if (m.done) continue;
    const ep = (index.byId.get(m.id) || {}).ep || m.ep;
    if (ep) queueDownload(ep, m.title); else removeDownload(m.id, true);
  }
}

const playType = (ep) => (ep.mime === 'video/x-matroska' ? 'video/webm' : ep.mime);

/** El capítulo descargado: de la carpeta elegida o de la app. Lanza NOFOLDER / NOFILE si está en una carpeta que no se puede abrir. */
async function localBlob(ep, ask = false) {
  if (!state.saved.has(ep.id)) return null;
  const meta = state.dlMeta.get(ep.id) || (await idb.get('dl', ep.id).catch(() => null));
  if (meta && meta.where === 'folder') {
    const dir = await dirAccess(meta.dirKey, ask);
    if (!dir) throw new Error('NOFOLDER');
    try {
      const { file } = await fileAt(dir, meta.rel, false);
      const f = await file.getFile();
      return f.slice(0, f.size, playType(ep)); // sin copiar: solo le pone el tipo
    } catch { throw new Error('NOFILE'); }
  }
  const chunks = await idb.chunks(ep.id);
  if (!chunks.length) return null;
  chunks.sort((a, b) => a.i - b.i);
  return new Blob(chunks.map((c) => c.blob), { type: playType(ep) });
}

/* ── carpeta de descargas ──
 * Chrome y Edge (computadora y Android) dejan que la página escriba en una carpeta que tú eliges.
 * Cada capítulo se baja primero a la app (así se puede reanudar) y al terminar se pasa a la
 * carpeta como un MP4 normal (Serie/Temporada/archivo.mp4); la copia de la app se borra.
 * Safari (Mac y iPhone) y Firefox no lo permiten: ahí se puede guardar una copia aparte. */
const canFolder = typeof window.showDirectoryPicker === 'function';
// El acceso a cada carpeta elegida se guarda en 'subcache' (para no cambiar la versión de la base)
// con una clave propia; las descargas solo anotan esa clave. La carpeta actual va en localStorage.
const handleCache = new Map();
let dirHandle = null; // carpeta actual ya leída (para mostrar su nombre sin esperar)

async function loadHandle(key) {
  if (!key || !canFolder) return null;
  if (!handleCache.has(key)) handleCache.set(key, (await idb.get('subcache', key).catch(() => null)) || null);
  return handleCache.get(key);
}
async function getDir() {
  dirHandle = await loadHandle(LS.get('dirKey', ''));
  return dirHandle;
}
async function dirPermission(d) {
  try { return await d.queryPermission({ mode: 'readwrite' }); } catch { return 'denied'; }
}
/** La carpeta lista para usar, o null. Con `ask` pide permiso (solo funciona justo después de un toque). */
async function dirAccess(d, ask = false) {
  if (typeof d === 'string') d = await loadHandle(d);
  d = d || (await getDir());
  if (!d) return null;
  if ((await dirPermission(d)) === 'granted') return d;
  if (!ask) return null;
  try { return (await d.requestPermission({ mode: 'readwrite' })) === 'granted' ? d : null; } catch { return null; }
}
/** Si hay carpeta sin permiso y el usuario acaba de tocar algo, aprovecha para pedirlo. */
function askFolderIfNeeded() {
  if (!canFolder || !(navigator.userActivation && navigator.userActivation.isActive)) return;
  getDir().then(async (d) => {
    if (d && (await dirPermission(d)) === 'prompt' && (await dirAccess(d, true))) flushFolder();
  });
}

const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'Kai';
/** Ruta dentro de la carpeta: la misma de MEGA sin la carpeta de series, p. ej. Fate/1. Fate UBW/472_0_SUB.mp4 */
function folderRel(ep, title) {
  let p = String(ep.path || ep.name);
  const root = String(state.settings.root || '').replace(/^\/+|\/+$/g, '');
  if (root && p.toLowerCase().startsWith(root.toLowerCase() + '/')) p = p.slice(root.length + 1);
  const parts = p.split('/').filter(Boolean);
  if (parts.length < 2) parts.unshift(title || 'Kai');
  return parts.map(safeName);
}
async function fileAt(dir, rel, create) {
  let d = dir;
  const dirs = [d];
  for (const part of rel.slice(0, -1)) { d = await d.getDirectoryHandle(part, { create }); dirs.push(d); }
  return { dirs, file: await d.getFileHandle(rel[rel.length - 1], { create }) };
}

/** Pasa un capítulo ya descargado en la app a la carpeta. */
async function moveToFolder(id) {
  const meta = await idb.get('dl', id);
  if (!meta || !meta.done || meta.where === 'folder' || !meta.ep) return false;
  const dir = await dirAccess(null);
  if (!dir) return false;
  const ep = meta.ep;
  const rel = folderRel(ep, meta.title);
  const { file } = await fileAt(dir, rel, true);
  const w = await file.createWritable();
  try {
    const n = Math.ceil(ep.size / CHUNK);
    for (let i = 0; i < n; i++) {
      const c = await idb.get('chunks', [id, i]);
      if (!c) throw new Error('Falta una parte del capítulo');
      await w.write(c.blob);
    }
    await w.close();
  } catch (err) {
    try { await w.abort(); } catch { /* nada */ }
    throw err;
  }
  Object.assign(meta, { where: 'folder', rel, dirKey: LS.get('dirKey', '') });
  await idb.put('dl', meta);
  state.dlMeta.set(id, meta);
  await idb.dropChunks(id).catch(() => {});
  return true;
}

let flushing = null;
/** Mueve a la carpeta lo que quedó en la app y borra lo que estaba pendiente de borrar. */
function flushFolder() {
  if (flushing) return flushing;
  flushing = (async () => {
    if (!(await dirAccess(null))) return 0;
    let moved = 0;
    for (const m of await idb.all('dl').catch(() => [])) {
      if (!m.done || m.where === 'folder' || (playing && playing.ep.id === m.id)) continue;
      try { if (await moveToFolder(m.id)) moved++; } catch { /* queda en la app */ }
    }
    const trash = LS.get('folderTrash', []);
    const left = [];
    for (const t of trash) { if (!(await deleteFromFolder(t.rel, t.dirKey))) left.push(t); }
    LS.set('folderTrash', left);
    if (moved) { toast(`${plural(moved, 'capítulo pasó', 'capítulos pasaron')} a tu carpeta.`); paintSpace(); }
    return moved;
  })().finally(() => { flushing = null; });
  return flushing;
}

/** Borra un archivo de la carpeta y las carpetas de serie y temporada si quedan vacías. */
async function deleteFromFolder(rel, d) {
  const dir = await dirAccess(d);
  if (!dir) return false;
  try {
    const { dirs } = await fileAt(dir, rel, false);
    await dirs[dirs.length - 1].removeEntry(rel[rel.length - 1]);
    for (let i = dirs.length - 1; i > 0; i--) {
      let empty = true;
      for await (const _ of dirs[i].keys()) { empty = false; break; } // eslint-disable-line no-unused-vars
      if (!empty) break;
      await dirs[i - 1].removeEntry(rel[i - 1]);
    }
  } catch (err) {
    if (err && err.name !== 'NotFoundError') return false;
  }
  return true;
}

async function pickFolder() {
  let d;
  try { d = await window.showDirectoryPicker({ id: 'kai-descargas', mode: 'readwrite', startIn: 'videos' }); } catch { return; } // canceló
  if (!(await dirAccess(d, true))) { toast('Kai necesita permiso para guardar en esa carpeta.'); return; }
  const key = 'kai:carpeta:' + Date.now().toString(36);
  await idb.put('subcache', d, key);
  handleCache.set(key, d);
  LS.set('dirKey', key);
  dirHandle = d;
  toast(`Las descargas se guardarán en «${d.name}».`);
  if (route().view === 'ajustes') renderSettings();
  flushFolder();
}
async function dropFolder() {
  if (!confirm('Las descargas nuevas se guardarán dentro de la app. Lo que ya está en la carpeta se queda ahí y Kai lo sigue usando.')) return;
  LS.del('dirKey'); // el acceso guardado se queda: lo usan las descargas que ya están en esa carpeta
  dirHandle = null;
  if (route().view === 'ajustes') renderSettings();
}

/** Copia aparte del capítulo (Safari, iPhone, Firefox): el navegador la guarda en Descargas o en Archivos. */
async function exportCopy(ep) {
  const blob = await localBlob(ep, true).catch(() => null);
  if (!blob) { toast('Primero descarga el capítulo.'); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = ep.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

function nextUnseen(ep, list, n) {
  const i = list.findIndex((x) => x.id === ep.id);
  return list.slice(i + 1).filter((x) => !(prog(x) || {}).w).slice(0, n);
}

/* ───────────────────────── rutas y vistas ───────────────────────── */

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const [view, ...rest] = path.split('/');
  return { view: view || 'home', arg: decodeURIComponent(rest.join('/')), q: new URLSearchParams(query) };
}
/* Historial propio de Kai: "volver" salta las entradas que son la misma página (otra pestaña o
 * temporada de la misma serie) hasta llegar a una distinta, en vez de retroceder de a un paso. */
const navStack = [location.hash || '#/'];
let navBackSteps = 0; // pasos que Kai mismo pidió retroceder
let navReplacing = false;
const navPage = (h) => String(h || '#/').split('?')[0];
/* Al volver atrás (deslizar desde el borde en iPhone, o el botón), la página vuelve a donde estaba, no arriba:
 * si no, Safari muestra la foto de la página donde estabas y luego salta al inicio, y las portadas parpadean. */
const scrollMemo = new Map();
let navWasBack = false;
addEventListener('scroll', () => { scrollMemo.set(location.hash || '#/', window.scrollY); }, { passive: true });
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
function onHashChange() {
  const h = location.hash || '#/';
  navWasBack = !!navBackSteps || (navStack.length > 1 && navStack[navStack.length - 2] === h);
  if (navBackSteps) { navStack.length = Math.max(1, navStack.length - navBackSteps); navBackSteps = 0; navStack[navStack.length - 1] = h; }
  else if (navReplacing) { navStack[navStack.length - 1] = h; navReplacing = false; }
  else if (navStack.length > 1 && navStack[navStack.length - 2] === h) navStack.pop(); // botón atrás del navegador
  else if (navStack[navStack.length - 1] !== h) navStack.push(h);
}
function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
function goHome() {
  if (navPage(location.hash) === '#/' || !location.hash) { render(); return; }
  // si el inicio está en el historial, se vuelve a él; si no, se va directo
  const i = navStack.map(navPage).lastIndexOf('#/');
  if (i >= 0 && i < navStack.length - 1) { navBackSteps = navStack.length - 1 - i; history.go(-navBackSteps); }
  else go('#/');
}
function goBack(fallback = '#/') {
  const cur = navPage(navStack[navStack.length - 1]);
  let i = navStack.length - 2;
  while (i >= 0 && navPage(navStack[i]) === cur) i--;
  if (i >= 0) { navBackSteps = navStack.length - 1 - i; history.go(-navBackSteps); }
  else { navReplacing = true; location.replace(fallback); }
}

function header(title, { actions = '', overlay = false } = {}) {
  return `<header class="bar ${overlay ? 'is-overlay' : ''}">
    <button class="icon-btn" data-act="back" aria-label="Volver">${ICON.back}</button>
    <button class="icon-btn" data-act="home" aria-label="Inicio">${ICON.home}</button>
    <h1 class="bar-title">${title}</h1>
    ${actions}
  </header>`;
}

let lastRouteKey = '';

/** Vuelve a dibujar la vista actual sin tocar el reproductor. */
function softRender() {
  if (route().view === 'play') { paintWatchInfo(); return; }
  render();
}

function render() {
  closeDrawer();
  if (!LS.get('session', null)) { stopPlayback(); renderLogin(); return; }
  const { view, arg } = route();
  if (!state.profile || !visibleProfiles().some((p) => p.id === state.profile.id) && state.sharedLoaded) {
    if (state.profile && state.sharedLoaded) { state.profile = null; LS.del('profile'); }
    if (!state.profile) { stopPlayback(); renderProfiles(); paintDock(); lastRouteKey = 'perfiles'; return; }
  }
  if (view === 'perfiles') { stopPlayback(); renderProfiles(); paintDock(); lastRouteKey = 'perfiles'; return; }
  if (picking && (view !== 'serie' || String(picking.si) !== arg.split('/')[0])) endPicking(false);
  if (view === 'play') {
    const c = resolveContext(arg);
    const si = c && c.si;
    setTint(si != null && state.library.series[si] ? seriesColor(state.library.series[si]) : null);
    renderWatch(arg);
  } else {
    if (playing && video.currentSrc) enterMini(); else stopPlayback();
    setTint(null);
    if (view === 'serie') renderSeries(arg);
    else if (view === 'pelicula') renderMovie(arg);
    else if (view === 'explorar') renderExplorer(arg);
    else if (view === 'catalogo') renderCatalog();
    else if (view === 'descargas') renderDownloads();
    else if (view === 'ajustes') renderSettings();
    else if (view === 'descubrir') renderDiscover(arg);
    else renderHome();
  }
  paintSync();
  paintDock();
  hydrateThumbs(app);
  const key = view + '/' + arg;
  if (key !== lastRouteKey && view !== 'play') window.scrollTo(0, navWasBack ? scrollMemo.get(location.hash || '#/') || 0 : 0);
  navWasBack = false;
  if (key !== lastRouteKey && view === 'play' && lastRouteKey.split('/')[0] !== 'play') window.scrollTo(0, 0);
  lastRouteKey = key;
}

/* ── botón flotante (reemplaza el menú lateral) ── */

const dock = $('#dock');

function paintDock() {
  const v = route().view;
  const show = !!(LS.get('session', null) && state.profile && v !== 'perfiles');
  dock.hidden = !show;
  if (!show) { closeDock(); return; }
  const p = visibleProfiles().find((x) => x.id === state.profile.id) || state.profile;
  const btn = dock.querySelector('.dock-btn');
  btn.innerHTML = `${avatarHTML(p, 'dock-avatar')}<span class="dock-top" aria-hidden="true">${ICON.top}</span><span class="dock-ring" aria-hidden="true"></span><span class="dock-state" aria-hidden="true"></span>`;
  btn.dataset.name = p.name;
  paintSync();
  paintNewsDot();
  if (!dock.querySelector('.dock-panel').hidden) fillDock();
}

function fillDock() {
  const { view } = route();
  const p = visibleProfiles().find((x) => x.id === state.profile.id) || state.profile;
  const item = (href, icon, label, on, extra = '') => `<a class="dock-item ${on ? 'is-on' : ''}" href="${href}" role="menuitem">${icon}<span>${label}</span>${extra}</a>`;
  const dark = resolvedTheme() === 'dark';
  dock.querySelector('.dock-panel').innerHTML = `
    <a class="dock-profile" href="#/perfiles" role="menuitem">${avatarHTML(p)}<span><span class="dock-pname">${esc(p.name)}</span><span class="dock-psub">Cambiar perfil</span></span></a>
    ${item('#/', ICON.home, 'Inicio', view === 'home' || view === 'serie')}
    ${item('#/explorar', ICON.folder, 'Explorar MEGA', view === 'explorar')}
    ${item('#/descargas', ICON.saved, 'Descargados', view === 'descargas', `<span class="dock-count" id="dock-count">${state.saved.size || ''}</span>`)}
    ${item('#/ajustes', ICON.gear, 'Ajustes', view === 'ajustes', hasUnreadNews() ? '<span class="dock-news">Novedades</span>' : '')}
    <div class="dock-row">
      <button class="dock-chip" data-act="refresh" role="menuitem">${ICON.refresh}<span>Actualizar</span></button>
      <button class="dock-chip" data-act="theme" role="menuitem">${dark ? ICON.sun : ICON.moon}<span>${dark ? 'Claro' : 'Oscuro'}</span></button>
    </div>
    <p class="dock-quota" id="drawer-quota">${quotaText()}</p>`;
}

function openDock() {
  fillDock();
  const panel = dock.querySelector('.dock-panel');
  panel.hidden = false;
  dock.classList.add('is-open');
  dock.querySelector('.dock-btn').setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => panel.classList.add('is-in'));
  const first = panel.querySelector('.dock-item.is-on') || panel.querySelector('.dock-item');
  if (first) first.focus({ preventScroll: true });
}
function closeDock() {
  const panel = dock.querySelector('.dock-panel');
  if (!panel || panel.hidden) return;
  panel.classList.remove('is-in');
  dock.classList.remove('is-open');
  dock.querySelector('.dock-btn').setAttribute('aria-expanded', 'false');
  setTimeout(() => { if (!panel.classList.contains('is-in')) panel.hidden = true; }, 180);
}
/* Ir arriba: en pantallas táctiles, el botón flotante se vuelve una flecha cuando bajaste más de dos pantallas
 * y empiezas a subir. Vuelve a ser el de siempre al llegar arriba, al seguir bajando o tras unos segundos quieto.
 * (UP_ON_IOS: en iPhone/iPad ya se sube tocando la hora; se deja encendido mientras Alex lo prueba.) */
const UP_ON_IOS = true;
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const UP_ENABLED = matchMedia('(pointer: coarse)').matches && (UP_ON_IOS || !IS_IOS);
let upLastY = 0, upIdle = 0, upFrame = 0, upHoldUntil = 0; // upHoldUntil: mientras sube solo, no volver a mostrar la flecha
function setDockUp(on) {
  if (dock.classList.contains('is-up') === on) return;
  dock.classList.toggle('is-up', on);
  const btn = dock.querySelector('.dock-btn');
  if (btn) btn.setAttribute('aria-label', on ? 'Ir arriba' : 'Menú');
}
function checkDockUp() {
  upFrame = 0;
  const y = window.scrollY;
  const dy = y - upLastY;
  if (Math.abs(dy) < 6) return; // movimientos mínimos no cuentan
  upLastY = y;
  clearTimeout(upIdle);
  const ok = !dock.hidden && !dock.classList.contains('is-open') && route().view !== 'play';
  if (!ok || y < 80 || dy > 0 || Date.now() < upHoldUntil) { setDockUp(false); return; }
  if (y > window.innerHeight * 2) {
    setDockUp(true);
    upIdle = setTimeout(() => setDockUp(false), 3000);
  }
}
if (UP_ENABLED) {
  addEventListener('scroll', () => { if (!upFrame) upFrame = requestAnimationFrame(checkDockUp); }, { passive: true });
}

// nombres antiguos que aún usan otras partes
const closeDrawer = closeDock;
function paintDrawerCount() {
  const el = $('#dock-count');
  if (el) el.textContent = state.saved.size || '';
}
// Con el menú abierto, tocar fuera solo lo cierra: ese toque no abre un capítulo, ni reproduce, ni sigue un enlace.
let dockSwallow = 0; // hasta cuándo se ignora el clic de ese toque
document.addEventListener('pointerdown', (e) => {
  if (!dock.classList.contains('is-open')) { dockSwallow = 0; return; } // un toque nuevo con el menú cerrado nunca se ignora
  if (dock.contains(e.target)) return;
  closeDock();
  e.stopPropagation(); // que no llegue a los gestos del reproductor
  dockSwallow = Date.now() + 800;
}, true);
document.addEventListener('click', (e) => {
  if (Date.now() > dockSwallow || dock.contains(e.target)) return;
  dockSwallow = 0;
  e.preventDefault();
  e.stopPropagation();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dock.classList.contains('is-open')) { closeDock(); dock.querySelector('.dock-btn').focus(); }
});

/* ── entrar ── */

let loginNote = ''; // aviso que se mantiene en la pantalla de entrar aunque se vuelva a dibujar
function renderLogin(message = loginNote, needCode = false, email = '') {
  app.innerHTML = `<main class="login">
    <div class="login-mark" aria-hidden="true"><img class="login-icon" src="icon-192.png" alt=""></div>
    <h1 class="login-title">Kai</h1>
    <p class="login-lead">Tus series de MEGA, donde te quedaste, en cualquier pantalla.</p>
    <form id="login" class="form" autocomplete="on">
      <label>Correo de MEGA<input name="email" type="email" required autocomplete="username" value="${esc(email)}"></label>
      <label>Contraseña<input name="password" type="password" required autocomplete="current-password"></label>
      ${needCode ? '<label>Código de verificación<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label>' : ''}
      ${message ? `<p class="form-error" role="alert">${esc(message)}</p>` : ''}
      <button class="btn btn-lamp" type="submit">Entrar</button>
      <p class="form-note">Tu contraseña va directo a MEGA y no se guarda. En este dispositivo solo queda la sesión.</p>
    </form>
  </main>`;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      await login(f.get('email').toString().trim(), f.get('password').toString(), f.get('code') && f.get('code').toString());
      refreshLibrary(false);
      location.hash = '#/';
      render();
      sync();
    } catch (err) {
      const m = megaMessage(err);
      if (m === 'MFA') renderLogin('', true, f.get('email').toString());
      else renderLogin(m, needCode, f.get('email').toString());
    }
  });
}

/* ── perfiles ── */

const AVATAR_HUES = [210, 340, 150, 30, 270, 190, 0, 90];

function avatarHTML(p, cls = '') {
  const h = p.hue ?? hue(p.name);
  return `<span class="avatar ${cls}" style="--h:${h}" aria-hidden="true">${esc([...p.name.trim()][0] || '?').toUpperCase()}</span>`;
}

function renderProfiles(editing = false, adding = false) {
  const list = visibleProfiles();
  // solo se ofrece crear perfil cuando Kai pudo confirmar en MEGA cuáles existen
  const blocked = !state.sharedLoaded;
  const failed = blocked && (state.sharedError || !navigator.onLine);
  const waiting = blocked && !failed;
  const first = !list.length;
  app.innerHTML = `<main class="profiles">
    <div class="profiles-inner">
      <h1 class="profiles-title">${first && !blocked ? 'Crea tu perfil' : '¿Quién está viendo?'}</h1>
      ${first && !blocked ? '<p class="profiles-lead">Cada perfil guarda su propio progreso y aparece en todos tus dispositivos.</p>' : ''}
      ${waiting && first ? '<p class="profiles-lead">Buscando perfiles en tu MEGA…</p>' : ''}
      ${failed ? `<p class="profiles-lead">${navigator.onLine ? 'No pude leer tus perfiles en MEGA.' : 'Conéctate a internet para cargar tus perfiles.'}</p>
        ${navigator.onLine && state.sharedErrorMsg && state.sharedErrorMsg !== 'MFA' ? `<p class="profiles-why">${esc(state.sharedErrorMsg)}${/límite de transferencia/i.test(state.sharedErrorMsg) ? ' MEGA cuenta ese límite por conexión: con datos móviles u otra red suele funcionar de inmediato.' : ''}</p>` : ''}
        ${navigator.onLine && list.length ? '<p class="profiles-why">Puedes entrar con tu perfil igual: tu progreso se junta con el de MEGA en cuanto se pueda leer.</p>' : ''}
        ${navigator.onLine ? '<button class="btn btn-lamp" data-act="profiles-retry">Reintentar</button>' : ''}` : ''}
      <ul class="profile-grid">
        ${list.map((p) => `<li><button class="profile-tile ${editing ? 'is-editing' : ''}" data-act="${editing ? 'profile-delete' : 'profile-pick'}" data-id="${esc(p.id)}">
          ${avatarHTML(p, 'avatar-xl')}<span class="profile-name">${esc(p.name)}</span>${editing ? '<span class="profile-remove">Quitar</span>' : ''}
        </button></li>`).join('')}
        ${!editing && !blocked ? `<li>${adding || first ? `<form class="profile-new" id="profile-new">
            <input name="name" maxlength="20" placeholder="Nombre" required autocomplete="off" aria-label="Nombre del perfil">
            <button class="btn btn-lamp" type="submit">Crear</button>
          </form>` : `<button class="profile-tile is-add" data-act="profile-add"><span class="avatar avatar-xl avatar-add" aria-hidden="true">+</span><span class="profile-name">Agregar</span></button>`}</li>` : ''}
      </ul>
      ${list.length && !blocked ? `<button class="btn" data-act="${editing ? 'profiles-done' : 'profiles-edit'}">${editing ? 'Listo' : 'Editar perfiles'}</button>` : ''}
    </div>
  </main>`;
  const form = $('#profile-new');
  if (form) {
    form.name.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      if (!name) return;
      const btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Revisando…';
      await createProfile(name);
    });
  }
}

async function createProfile(name) {
  // antes de crear, vuelve a mirar MEGA por si otro dispositivo ya creó perfiles
  if (navigator.onLine) {
    try {
      await connect();
      if (syncing) await syncing.catch(() => {});
      await sync();
    } catch { /* se revisa abajo */ }
    if (!state.sharedLoaded || state.sharedError) { renderProfiles(); return; }
  }
  const same = visibleProfiles().find((x) => normName(x.name) === normName(name));
  if (same) {
    toast(`Ya tenías el perfil ${same.name}; entraste con ese.`);
    selectProfile(same.id);
    return;
  }
  const isFirst = !state.shared.profiles.length;
  const used = new Set(state.shared.profiles.map((p) => p.hue));
  const p = { id: Math.random().toString(36).slice(2, 10), name, hue: AVATAR_HUES.find((h) => !used.has(h)) ?? hue(name), created: Date.now(), u: Date.now() };
  state.shared.profiles.push(p);
  if (isFirst && !state.shared.legacyBy) state.shared.legacyBy = p.id;
  saveShared();
  // el progreso de antes de los perfiles pasa al primero
  if (isFirst) {
    const old = LS.get('progress', null);
    if (old) { LS.set(`p.${p.id}.progress`, old); LS.set(`p.${p.id}.dirty`, true); LS.del('progress'); LS.del('dirty'); }
  }
  selectProfile(p.id);
}

function selectProfile(id) {
  const p = visibleProfiles().find((x) => x.id === id);
  if (!p) return;
  if (state.profile && state.profile.id !== id) { savePosition(true); stopPlayback(); }
  state.profile = { id: p.id, name: p.name };
  LS.set('profile', state.profile);
  loadProfileState();
  initKnown();
  lastNew = null;
  announceNew();
  location.hash = '#/';
  render();
  sync();
}

/* ── capítulos nuevos ── */

// se lee una vez y se guarda en memoria: antes se volvía a leer (y descifrar el JSON) por cada serie
let knownCache = { key: null, val: null };
function knownMap() {
  const key = pkey('known');
  if (knownCache.key !== key) knownCache = { key, val: LS.get(key, null) };
  return knownCache.val;
}
function saveKnown(k) { knownCache = { key: pkey('known'), val: k }; LS.set(pkey('known'), k); }
function initKnown() {
  if (!state.profile || !state.library || !state.library.series || knownMap()) return;
  saveKnown(Object.fromEntries(state.library.series.map((s) => [s.name, (s.full || s.all).map((e) => e.id)])));
}
function newEpisodes(s) {
  const k = knownMap();
  if (!k) return [];
  const set = new Set(k[s.name] || []);
  return s.all.filter((e) => !set.has(e.id));
}
function markSeriesSeen(s) {
  const k = { ...(knownMap() || {}) };
  k[s.name] = [...new Set([...(k[s.name] || []), ...(s.full || s.all).map((e) => e.id)])];
  saveKnown(k);
}
let lastNew = null;
/* Al importar varios capítulos, MEGA avisa de cada archivo por separado: los cambios se juntan
 * unos segundos y se muestra un solo aviso ("Hay contenido nuevo: Fate (3), Frieren (1)"). */
/* Novedades: lo nuevo que llega a MEGA ya no sale como aviso en el inicio; se anota en Ajustes → Novedades
 * y el botón del menú muestra un puntito hasta que se mira. Por perfil y por dispositivo. */
const NEWS_DAYS = 30;
function newsList() {
  const l = LS.get(pkey('news'), []);
  return (Array.isArray(l) ? l : []).filter((x) => x && x.name && Date.now() - (x.at || 0) < NEWS_DAYS * 86400000);
}
function noteNews(name, n) {
  const l = newsList().filter((x) => x.name !== name);
  l.unshift({ name, n, at: Date.now() });
  LS.set(pkey('news'), l.slice(0, 60));
  LS.set(pkey('newsUnread'), true);
}
const hasUnreadNews = () => !!(state.profile && LS.get(pkey('newsUnread'), false) && newsList().length);
function paintNewsDot() {
  const btn = dock && dock.querySelector('.dock-btn');
  if (btn) btn.classList.toggle('has-news', hasUnreadNews());
}
/* Se recuerda qué capítulos ya se anunciaron (por su id), no cuántos había: así, si MEGA entrega la lista
 * a medias al abrir (unos segundos con menos capítulos), al completarse no se vuelve a anunciar lo mismo. */
const NEWS_IDS_MAX = 4000;
function announceNew() {
  if (!state.library || !state.library.series || !state.profile) return;
  let told = LS.get(pkey('newsIds'), null);
  const first = !Array.isArray(told);
  const seen = new Set(first ? [] : told);
  const added = [];
  for (const s of state.library.series) {
    const fresh = newEpisodes(s);
    const unseen = fresh.filter((e) => !seen.has(e.id));
    if (!unseen.length) continue;
    unseen.forEach((e) => { seen.add(e.id); added.push(e.id); });
    // la primera vez (al pasar a esta versión) solo se toma nota, sin anunciar lo que ya se avisó antes
    if (!first) noteNews(s.name, fresh.length);
  }
  if (first || added.length) LS.set(pkey('newsIds'), [...seen].slice(-NEWS_IDS_MAX));
  LS.del(pkey('newsCount'));
  lastNew = null;
  paintNewsDot();
}
function newsHTML() {
  const lib = state.library && state.library.v === 2 ? state.library : null;
  const items = newsList();
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 60 ? `hace ${Math.max(1, m)} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
  };
  const rows = items.map((x) => {
    const si = lib ? lib.series.findIndex((s) => s.name === x.name) : -1;
    const what = `${x.n === 1 ? 'un capítulo nuevo' : `${x.n} capítulos nuevos`}`;
    const label = `<strong>${esc(x.name)}</strong>: ${what} <span class="dim">· ${ago(x.at)}</span>`;
    return `<li>${si >= 0 ? `<a href="#/serie/${si}">${label}</a>` : label}</li>`;
  });
  return `<p class="settings-label">Novedades</p>
    ${rows.length ? `<ul class="news-list">${rows.join('')}</ul><button class="btn btn-quiet" data-act="news-clear">Limpiar</button>`
      : '<p class="dim">Aquí aparece lo que se agregue a tu MEGA. Por ahora no hay nada nuevo.</p>'}
    ${!rows.length && lib && lib.series.some((s) => newEpisodes(s).length) ? '<button class="btn btn-quiet" data-act="news-clear">Quitar las burbujas de "nuevo"</button>' : ''}`;
}

/* ── sinopsis e imágenes ── */

// las fichas llegan de a una al buscar en AniList: se juntan y se guardan una sola vez (y al salir, si falta)
let metaTimer = 0;
function saveMeta() { clearTimeout(metaTimer); metaTimer = setTimeout(flushMeta, 1500); }
function flushMetaNow() { clearTimeout(metaTimer); metaTimer = 0; LS.set('meta', state.meta); }
function flushMeta() { if (metaTimer) { clearTimeout(metaTimer); metaTimer = 0; LS.set('meta', state.meta); } }
addEventListener('pagehide', flushMeta);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushMeta(); });
/* Fichas de AniList:
 *  - Una serie con UNA temporada (o tipo "1. Temporada 1"): se busca con el nombre de la carpeta de la serie.
 *  - Con varias temporadas, cada temporada que tiene nombre propio ("2. Fate Zero", "1.5 Prólogo UBW") se busca
 *    con ese nombre exacto y tiene su propio póster, banner y sinopsis. Las genéricas ("2. Temporada 2") buscan
 *    "Serie Season 2" y solo se aceptan si son de esa serie; si no, usan la ficha de la serie.
 *  - Si la primera temporada tiene nombre propio, la carpeta de la serie es solo el nombre del grupo ("Fate"):
 *    no se busca, y la serie se muestra con la ficha de la temporada que estás viendo (o la primera). */
const usesSeasonMeta = (s) => !!s && !isCollection(s) && s.seasons.length > 1;
const isFranchise = (s) => usesSeasonMeta(s) && hasOwnTitle(s.seasons[0]);
function seasonMeta(s, se) {
  if (!usesSeasonMeta(s) || !se || !se.name) return null;
  const m = state.meta[itemMetaKey(s, se.name)];
  return m && !m.none ? m : null;
}
/** La temporada que estás viendo: la del último capítulo que tocaste; si no, la primera. */
function activeSeason(s) {
  let best = null;
  for (const ep of s.all) { const p = prog(ep); if (p && (!best || p.u > best.u)) best = { u: p.u, ep }; }
  const e = best && index.byId.get(best.ep.id);
  return s.seasons[e ? e.ki : 0];
}
function metaFor(s) {
  if (isFranchise(s)) return seasonMeta(s, activeSeason(s)) || s.seasons.map((se) => seasonMeta(s, se)).find(Boolean) || null;
  const m = state.meta[s.name];
  return m && !m.none ? m : null;
}
/** Lo que se busca en AniList para una temporada, o null si usa la ficha de la serie. */
function seasonQuery(s, se) {
  if (hasOwnTitle(se)) {
    const t = se.title;
    const kind = /\b(pel[ií]culas?|movies?|films?|gekijouban)\b/i.test(t) ? 'movie' : SPECIAL_RE.test(t) ? 'ova' : 'tv';
    // "(Película)", "[OVA]"… solo dicen el tipo: no se buscan
    const name = t.replace(/[([][^)\]]*[)\]]/g, (x) => (SPECIAL_RE.test(x) ? ' ' : x)).replace(/\s+/g, ' ').trim();
    return { name: name || t, kind };
  }
  const n = seasonOrdinal(s, se);
  return n > 1 && !isSpecialSeason(se) ? { series: s.name, n } : null;
}
function searchNames(s) {
  return [s.name];
}

let metaRunning = false;
/** ¿Ya tiene ficha guardada (encontrada o no) todo lo que se busca de esta serie? */
function hasAllMeta(s) {
  if (isCollection(s)) return collectionItems(s).every((it) => state.meta[itemMetaKey(s, it.key)]);
  const seasonsOk = !usesSeasonMeta(s) || s.seasons.every((se) => !seasonQuery(s, se) || state.meta[itemMetaKey(s, se.name)]);
  return seasonsOk && (isFranchise(s) || !!state.meta[s.name]);
}
async function ensureMeta() {
  if (metaRunning || !navigator.onLine || !state.library || !state.library.series) return;
  metaRunning = true;
  let changed = false;
  try {
    // antes de buscar nada, lo que otros dispositivos ya encontraron (si MEGA no responde, se busca igual)
    if (!fichasPulled && state.storage) { try { await syncFichas(state.storage.root, false); } catch (err) { console.warn('fichas', err); fichasPulled = true; } }
    // 1) las fichas guardadas antes de la v29 no traían la nota: se pide solo la nota, todas juntas (1–2 pedidos),
    //    en vez de volver a buscar cada serie y película (eso agotaba el límite de AniList y dejaba otras sin ficha)
    const old = Object.values(state.meta).filter((m) => m && !m.none && typeof m.id === 'number' && m.src !== 'TMDB' && ((m.sv && m.sv < 6) || (m.mv && m.mv < 5)));
    if (old.length) {
      try {
        const sc = await scoresByIds([...new Set(old.map((m) => m.id))]);
        for (const m of old) {
          if (m.id in sc) m.score = sc[m.id];
          if (m.sv) m.sv = 6;
          if (m.mv) m.mv = 5;
        }
        changed = true;
        saveMeta();
      } catch (err) { console.warn('anilist notas', err); }
    }
    // 2) primero lo que todavía no tiene ficha (p. ej. temporadas recién organizadas), después el resto
    const order = [...state.library.series].sort((a, b) => Number(hasAllMeta(a)) - Number(hasAllMeta(b)));
    for (const s of order) {
      const pick = null; // todo automático: ya no se usan fichas elegidas a mano
      if (isCine(s)) {
        // Cine: cada película en TMDB (sin clave no se busca nada)
        const key = tmdbKey();
        if (!key) continue;
        for (const it of collectionItems(s)) {
          const k = itemMetaKey(s, it.key);
          const c = state.meta[k];
          const age = Date.now() - ((c && c.at) || 0);
          if (c && c.tm === 1 && c.key === key.slice(-6) && (c.none ? age < 86400000 : age < 30 * 86400000)) continue;
          let m = null;
          try { if (it.query) m = await tmdbFindMovie(it.query, key); } catch (err) { console.warn('tmdb', err); break; }
          state.meta[k] = m ? { ...m, tm: 1, key: key.slice(-6) } : { none: true, id: 0, tm: 1, key: key.slice(-6), at: Date.now() };
          changed = true;
          saveMeta();
          await sleep(250);
        }
        continue;
      }
      if (isCollection(s)) {
        // cada película por separado; la carpeta no se busca
        let failed = false;
        for (const it of collectionItems(s)) {
          const k = itemMetaKey(s, it.key);
          const c = state.meta[k];
          const age = Date.now() - ((c && c.at) || 0);
          // todo automático: lo encontrado se guarda 30 días; lo que no se encontró se vuelve a buscar al día siguiente
          if (c && c.mv === 5 && (c.none ? age < 86400000 : age < 30 * 86400000)) continue;
          let m = null;
          try {
            if (it.query) m = await findMovie(it.query, () => sleep(400));
          } catch (err) { console.warn('anilist', err); failed = true; break; }
          state.meta[k] = m ? { ...toMeta(m), mv: 5 } : { none: true, id: 0, mv: 5, at: Date.now() };
          changed = true;
          saveMeta();
          await sleep(400);
        }
        if (failed) break;
        continue;
      }
      if (usesSeasonMeta(s)) {
        // cada temporada con su ficha (sm: 1); lo encontrado dura 30 días, lo no encontrado se reintenta al día siguiente
        let failed = false;
        for (const se of s.seasons) {
          const q = seasonQuery(s, se);
          if (!q) continue;
          const k = itemMetaKey(s, se.name);
          const c = state.meta[k];
          const age = Date.now() - ((c && c.at) || 0);
          // las que dicen número de temporada o "Serie - Subtítulo" se buscan de nuevo una vez (v36 las encuentra mejor)
          const need = /\b(season|temporada)\b|\d(st|nd|rd|th)\b|\s[-–]\s/i.test(se.name) ? 2 : 1;
          if (c && (c.sm || 0) >= need && (c.none ? age < 86400000 : age < 30 * 86400000)) continue;
          let m = null;
          try {
            m = q.name ? await findTitle(q.name, q.kind, () => sleep(400)) : await findSeason(q.series, q.n);
          } catch (err) { console.warn('anilist', err); failed = true; break; }
          state.meta[k] = m ? { ...toMeta(m), sm: 2 } : { none: true, id: 0, sm: 2, at: Date.now() };
          if (m) {
            const meta = state.meta[k];
            translateToSpanish(meta.synopsis).then((es) => { if (es) { meta.synopsisEs = es; saveMeta(); if (['home', 'serie'].includes(route().view)) softRender(); } });
          }
          changed = true;
          saveMeta();
          await sleep(400);
        }
        if (failed) break;
        if (isFranchise(s)) continue; // "Fate": la carpeta de la serie no se busca
      }
      const cur = state.meta[s.name];
      // sv: 6 = buscada solo con el nombre de la carpeta, con la nota de AniList (las de antes se vuelven a buscar una vez)
      const stale = !cur || Date.now() - (cur.at || 0) > (cur.none ? 86400000 : 30 * 86400000) || (pick && pick.id !== (cur.id || 0)) || (!cur.none && cur.v !== 2) || (!pick && cur.sv !== 6);
      if (!stale) continue;
      try {
        let m = null;
        if (pick && pick.id === 0) m = null;
        else if (pick) m = await animeById(pick.id);
        else m = await findForSeries(searchNames(s), s.name);
        state.meta[s.name] = m ? { ...toMeta(m), sv: 6 } : { none: true, id: 0, sv: 6, at: Date.now() };
        if (m) {
          const meta = state.meta[s.name];
          translateToSpanish(meta.synopsis).then((es) => { if (es) { meta.synopsisEs = es; saveMeta(); if (['home', 'serie', 'pelicula'].includes(route().view)) softRender(); } });
        }
        changed = true;
        saveMeta();
      } catch (err) {
        console.warn('anilist', err);
        break;
      }
      await sleep(400);
    }
  } finally {
    metaRunning = false;
  }
  if (changed) { fichasDirty = true; sync(); }
  if (changed && ['home', 'serie', 'pelicula'].includes(route().view)) softRender();
  setTimeout(translateMissing, 1500);
}

function synopsisOf(m) { return m ? (m.synopsisEs || (m.id && state.syn[m.id] && state.syn[m.id].es) || m.synopsis || '') : ''; }
const hasSpanish = (m) => !!(m && (m.synopsisEs || (m.id && state.syn[m.id])));

/* ── sinopsis en español compartidas ──
 * Solo Chrome de computadora trae traductor. Donde lo hay, Kai traduce en segundo plano, de una en una, las sinopsis
 * que falten y las guarda en MEGA (.kai-sinopsis.json); los demás dispositivos las leen de ahí ya traducidas. */
function saveSyn() { LS.set('syn', state.syn); }
let synRunning = false;
async function translateMissing() {
  if (synRunning || !canTranslate()) return;
  synRunning = true;
  let added = 0;
  try {
    const disc = LS.get('discover', {}) || {};
    const extra = Object.values(disc).flatMap((d) => (d && d.items) || []);
    for (const m of [...Object.values(state.meta), ...extra]) {
      if (!m || m.none || !m.id || m.src === 'TMDB') continue; // lo de TMDB ya viene en español
      if (state.syn[m.id]) continue;
      // lo que este navegador ya había traducido antes también se comparte
      let es = m.synopsisEs || null;
      if (!es && m.synopsis) {
        if (document.hidden) break;
        es = await translateToSpanish(m.synopsis);
        if (!es) break; // el traductor no está listo (se activa la primera vez con el botón "Traducir")
        await sleep(250);
      }
      if (!es) continue;
      state.syn[m.id] = { es, u: Date.now() };
      added++;
      if (added % 10 === 0) { saveSyn(); state.synDirty = true; }
    }
  } finally {
    synRunning = false;
    if (added) { saveSyn(); state.synDirty = true; sync(); if (['home', 'serie', 'pelicula'].includes(route().view)) softRender(); }
  }
}
/** Junta las traducciones de MEGA con las de aquí. Si el archivo no se puede leer, no se toca (nunca se pisa). */
async function syncSynopses(home) {
  const nodes = filesNamed(home, SYN_FILE);
  const sig = nodes.map((n) => `${n.nodeId}:${n.size}:${n.timestamp || 0}`).join('|');
  let remote = {};
  const known = LS.get('synSig', '');
  if (sig && sig !== known) {
    for (const n of nodes) { const d = await readJson(n); if (d && d.items) remote = mergeSyn(remote, d.items); }
    const before = Object.keys(state.syn).length;
    state.syn = mergeSyn(state.syn, remote);
    saveSyn();
    LS.set('synSig', sig);
    if (Object.keys(state.syn).length !== before && ['home', 'serie', 'pelicula'].includes(route().view)) softRender();
  } else if (sig) {
    remote = null; // sin cambios en MEGA desde la última vez
  }
  const needWrite = Object.keys(state.syn).length && (state.synDirty || nodes.length > 1 || (!nodes.length) || (remote && Object.keys(state.syn).some((k) => !remote[k] || state.syn[k].u > remote[k].u)));
  if (needWrite) {
    const fresh = await writeJson(home, SYN_FILE, { v: 1, app: 'kai', items: state.syn }, nodes);
    state.synDirty = false;
    // la firma del archivo recién subido: así este dispositivo no lo vuelve a descargar
    if (fresh && fresh.nodeId) LS.set('synSig', `${fresh.nodeId}:${fresh.size}:${fresh.timestamp || 0}`); else LS.del('synSig');
  }
}
/* ── fichas compartidas ──
 * Lo que un dispositivo encuentra en AniList (o TMDB) se guarda en MEGA (.kai-fichas.json): los demás dispositivos
 * y perfiles lo usan sin volver a buscar. Gana la ficha más reciente (marca "at"). Si el archivo no se puede leer,
 * no se toca (nunca se pisa). */
let fichasDirty = false;
let fichasPulled = false;
async function syncFichas(home, write = true) {
  const nodes = filesNamed(home, FICHAS_FILE);
  const sig = nodes.map((n) => `${n.nodeId}:${n.size}:${n.timestamp || 0}`).join('|');
  let remote = null;
  if (sig && sig !== LS.get('fichasSig', '')) {
    remote = {};
    for (const n of nodes) { const d = await readJson(n); if (d && d.items) remote = mergeFichas(remote, d.items); }
    const before = JSON.stringify(Object.keys(state.meta).map((k) => [k, (state.meta[k] || {}).at]));
    state.meta = mergeFichas(state.meta, remote);
    flushMetaNow();
    LS.set('fichasSig', sig);
    if (JSON.stringify(Object.keys(state.meta).map((k) => [k, (state.meta[k] || {}).at])) !== before && ['home', 'serie', 'pelicula', 'catalogo'].includes(route().view)) softRender();
  }
  fichasPulled = true;
  if (!write) return;
  const newer = remote && Object.keys(state.meta).some((k) => state.meta[k] && (!remote[k] || (state.meta[k].at || 0) > (remote[k].at || 0)));
  if (Object.keys(state.meta).length && (fichasDirty || nodes.length !== 1 || newer)) {
    fichasDirty = false;
    const fresh = await writeJson(home, FICHAS_FILE, { v: 1, app: 'kai', items: state.meta }, nodes);
    if (fresh && fresh.nodeId) LS.set('fichasSig', `${fresh.nodeId}:${fresh.size}:${fresh.timestamp || 0}`); else LS.del('fichasSig');
  }
}
function mergeFichas(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) if (v && typeof v === 'object' && (!out[k] || (v.at || 0) > (out[k].at || 0))) out[k] = v;
  return out;
}

function mergeSyn(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) if (v && v.es && (!out[k] || (v.u || 0) > (out[k].u || 0))) out[k] = v;
  return out;
}

/* ── colecciones: una carpeta "Películas" no es una serie ──
 * Cada película (subcarpeta, o archivo si están sueltos) se busca por separado en AniList,
 * y la carpeta se muestra con un mosaico de sus pósters y un texto propio. */
// "Películas" puede venir con la tilde en cualquier codificación (macOS la guarda separada), o sin tilde
const COLLECTION_RE = /^(peliculas?|movies?|films?|filmes)\b/i;
/* Cine: películas que no son anime (p. ej. "El gigante de hierro"). Carpeta "Cine" (u "Otras películas") dentro de Anime:
 * funciona como Películas (estante y página de cada una) pero no sale en el inicio ni en los catálogos, solo con su
 * botón al final del inicio y al buscar. Sus fichas vienen de TMDB (con la clave que se pone en Ajustes). */
const CINE_RE = /^(cine|otras peliculas)\b/i;
const plainName = (s) => String((s && s.name) || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const isCine = (s) => !!s && CINE_RE.test(plainName(s));
const isCollection = (s) => !!s && (COLLECTION_RE.test(plainName(s)) || isCine(s));
const tmdbKey = () => (state.shared.keys && state.shared.keys.tmdb && state.shared.keys.tmdb.v) || '';
function cleanFileTitle(name) {
  const t = String(name).replace(/\.[^.]+$/, '').replace(/[[(][^\])]*[\])]/g, ' ').replace(/[_.]+/g, ' ')
    .replace(/\b(1080p|720p|480p|2160p|4k|x26[45]|hevc|aac|sub|subs|subtitulado|vose|dub|dob|doblado|lat|latino|castellano|esp|spa|bd|bdrip|web|webrip)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  return /\p{L}{3}/u.test(t) ? t : '';
}
/** Clave de una película suelta: el nombre del archivo sin el idioma ("Howl_DOB.mp4" y "Howl_SUB.mp4" son la misma). */
const movieKey = (ep) => (ep.lang ? stripLang(baseName(ep.name)) : baseName(ep.name));
/** Las películas de una colección: { key, title, query, eps } */
function collectionItems(s) {
  const out = [];
  for (const se of s.seasons) {
    if (se.name) out.push({ key: se.name, title: se.title || se.name, query: se.title || se.name, eps: se.episodes });
    else for (const ep of se.episodes) out.push({ key: movieKey(ep), title: '', query: cleanFileTitle(ep.name), eps: [ep] });
  }
  return out;
}
const itemMetaKey = (s, key) => `${s.name}/${key}`; // un nombre de carpeta nunca lleva "/"
function itemFor(s, ep) {
  const e = index.byId.get(ep.id);
  if (!e || !isCollection(s)) return null;
  const se = s.seasons[e.ki];
  return se && se.name ? { key: se.name, title: se.title || se.name, eps: se.episodes } : { key: movieKey(ep), title: '', eps: [ep] };
}
function movieImage(s, it) {
  const m = itemMeta(s, it.key);
  return (m && (m.banner || m.cover)) || '';
}
/** Dirección de la página de una película de la colección. */
const movieHref = (si, key) => `#/pelicula/${si}/${encodeURIComponent(key)}`;
/** Nombre que se muestra de una película: el de su carpeta, o el de AniList si es un archivo suelto. */
function movieTitle(s, it) {
  const m = itemMeta(s, it.key);
  // Cine: el título en español de TMDB, o el nombre de la carpeta sin el año ("El gigante de hierro (1999)")
  if (isCine(s)) return (m && m.title) || (it.title || it.query || '').replace(/\s*[([]\s*(?:19|20)\d{2}\s*[)\]]\s*$/, '') || it.eps[0].name.replace(/\.[^.]+$/, '');
  return it.title || (m && m.title) || it.query || it.eps[0].name.replace(/\.[^.]+$/, '');
}
function itemMeta(s, key) {
  const m = state.meta[itemMetaKey(s, key)];
  return m && !m.none ? m : null;
}
/** Lo que se muestra de una serie: lo de AniList, o para una colección, lo armado con sus películas. */
function displayMeta(s) {
  // una colección nunca usa la ficha de la carpeta (aunque haya quedado guardada de antes): se arma con sus películas
  if (!isCollection(s)) return metaFor(s);
  const items = collectionItems(s).map((it) => ({ ...it, m: itemMeta(s, it.key) }));
  const named = items.map((it) => {
    const t = it.title || (it.m && it.m.title) || '';
    return t ? `${t}${it.m && it.m.year ? ` (${it.m.year})` : ''}` : '';
  }).filter(Boolean);
  const list = named.length > 1 ? `${named.slice(0, -1).join(', ')} y ${named[named.length - 1]}` : named[0] || '';
  const text = `${items.length === 1 ? 'Una película' : `${items.length} películas`}${isCine(s) ? '' : ' de anime'} en tu MEGA${list ? `: ${list}` : ''}.`;
  return {
    collection: true, title: '', synopsis: text, synopsisEs: text,
    collage: items.map((it) => it.m && it.m.cover).filter(Boolean).slice(0, 8),
    color: (items.find((it) => it.m && it.m.color) || {}).m?.color || '',
    format: 'Colección', count: items.length, genres: [],
  };
}
function collageHTML(urls, cls = '') {
  const u = urls.slice(0, 4);
  return `<span class="collage n${u.length} ${cls}" aria-hidden="true">${u.map((x) => `<img src="${esc(x)}" alt="" loading="lazy" decoding="async">`).join('')}</span>`;
}
/** Imagen para la tarjeta de un capítulo: la del anime (o de la película), no un fotograma. */
function episodeArt(ep) {
  const e = index.byId.get(ep.id);
  const s = e && state.library && state.library.series[e.si];
  if (!s) return '';
  const m = isCollection(s) ? itemMeta(s, itemFor(s, ep).key) : (seasonMeta(s, s.seasons[e.ki]) || metaFor(s));
  return m ? m.banner || m.cover || '' : '';
}

/** Color de la serie para teñir el fondo de Kai (nunca una imagen estirada). */
function seriesColor(s) {
  const m = displayMeta(s);
  return (m && m.color) || `hsl(${hue(s.name)} 45% 55%)`;
}
function setTint(color) {
  const r = document.documentElement.style;
  if (color) r.setProperty('--tint', color); else r.removeProperty('--tint');
}

function tileHTML(s, si, { href, label = '', sub = '', pct = 0, badge = '', img: own = '' } = {}) {
  const m = own ? null : displayMeta(s);
  const img = own || (m && (m.banner || m.cover));
  const coverEp = s.all.find((e) => e.fa);
  return `<a class="tile" href="${href}" data-si="${si}" style="--h:${hue(s.name)}">
    ${m && m.collage && m.collage.length ? collageHTML(m.collage, 'tile-img') : img ? `<img class="tile-img" src="${esc(img)}" alt="" loading="lazy" decoding="async">` : `<span class="tile-img is-fallback" ${coverEp ? `data-thumb="${esc(coverEp.id)}"` : ''}><span class="cover-glyph">${esc([...s.name.trim()][0] || '·')}</span></span>`}
    ${badge ? `<span class="tile-badge">${esc(badge)}</span>` : ''}
    <span class="tile-text"><span class="tile-title">${esc(label || s.name)}</span>${sub ? `<span class="tile-sub">${esc(sub)}</span>` : ''}</span>
    ${pct ? `<span class="tile-bar"><span style="width:${pct}%"></span></span>` : ''}
  </a>`;
}

/* ── portada estilo TV ── */

function greeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  return state.profile ? `${g}, ${state.profile.name}` : g;
}
function clockParts() {
  const d = new Date();
  const time = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
  const hm = time.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
  const ap = (time.find((p) => p.type === 'dayPeriod') || {}).value || '';
  const date = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  return { hm, ap, date };
}
function clockHTML() {
  const { hm, ap, date } = clockParts();
  // en la PC, Kai va echado encima de la fecha
  return `<span class="tv-hm">${esc(hm)}</span><span class="tv-ap">${esc(ap)}</span><span class="tv-sep" aria-hidden="true"></span><span class="tv-date"><span class="tv-date-t">${esc(date)}</span>${catHTML('top')}</span>`;
}
setInterval(() => {
  // solo cambia el texto (así Kai no se vuelve a cargar cada vez)
  const el = $('#tv-clock');
  if (el) {
    const p = clockParts();
    for (const [sel, v] of [['.tv-hm', p.hm], ['.tv-ap', p.ap], ['.tv-date-t', p.date]]) { const x = el.querySelector(sel); if (x && x.textContent !== v) x.textContent = v; }
  }
  const g = $('#tv-greet');
  if (g) g.textContent = greeting();
}, 20000);

function tvTop() {
  return `<header class="tv-top">
    <div class="tv-when">
      <p class="tv-greet" id="tv-greet">${esc(greeting())}</p>
      <p class="tv-clock" id="tv-clock">${clockHTML()}</p>
    </div>
    <div class="tv-top-tools">
      <button class="tv-icon" data-act="home-search" aria-label="Buscar" aria-expanded="false">${ICON.search}</button>
    </div>
  </header>
  <div class="home-search" id="home-search" hidden>
    <span class="search-icon">${ICON.search}</span>
    <input id="home-q" type="search" placeholder="Buscar un anime o película" autocomplete="off" enterkeyhint="search" aria-label="Buscar">
    <button class="tv-icon is-small" data-act="home-search-close" aria-label="Cerrar la búsqueda">${ICON.close}</button>
  </div>`;
}

let heroSi = null;
let heroUser = false; // el usuario eligió qué serie destacar (mouse, teclado o entrando a ella)

function heroPlan(s) {
  const next = nextFor(s);
  const np = next && prog(next);
  const resume = np && np.t > 5 && !np.w;
  // al empezar otra temporada se dice cuál ("Ver Fate Zero"), no "Ver Episodio 1"
  const e = next && index.byId.get(next.id);
  const startsSeason = e && !isCollection(s) && s.seasons.length > 1 && e.ei === 0 && !resume;
  const label = !next ? 'Serie terminada' : startsSeason ? `Ver ${seasonTab(s, s.seasons[e.ki])}` : `${resume ? 'Continuar' : 'Ver'} ${episodeLabel(next)}`;
  return { next, label, left: resume ? fmtLeft(np) : '' };
}
/** Lo siguiente dentro de UNA temporada (la pestaña que estás mirando). */
function seasonPlan(s, se) {
  let cur = null;
  for (const ep of se.episodes) { const p = prog(ep); if (p && p.t > 5 && !p.w && (!cur || p.u > cur.p.u)) cur = { ep, p }; }
  const next = cur ? cur.ep : se.episodes.find((e) => !(prog(e) || {}).w) || null;
  if (!next) return { next: null, label: 'Temporada vista', left: '' };
  const np = prog(next);
  const resume = np && np.t > 5 && !np.w;
  return { next, label: `${resume ? 'Continuar' : 'Ver'} ${episodeLabel(next)}`, left: resume ? fmtLeft(np) : '' };
}

/** Año, tipo y géneros: cada uno lleva al catálogo filtrado por esa etiqueta. */
function factsHTML(s, m, extra = '') {
  const chip = (label, params) => `<a class="fact" href="#/catalogo?${new URLSearchParams(params)}">${esc(label)}</a>`;
  return [
    m && m.year ? chip(m.year, { y: m.year }) : '',
    m && m.format ? (m.collection ? `<span>${esc(m.format)}</span>` : chip(m.format, { f: m.format })) : '',
    `<span>${esc(countLabel(s, m))}</span>`,
    ...((m && m.genres) || []).slice(0, 3).map((g) => chip(g, { g })),
  ].join('') + extra;
}
/** Etiquetas de la página de una serie, en filas:
 *  arriba lo informativo (capítulos, vistos) | ★ nota de AniList; abajo lo que se toca (año, tipo, géneros → catálogo). */
function factsRowsHTML(s, m, { count = null, seen = 0, total = 0, lang = '' } = {}) {
  const chip = (label, params) => `<a class="fact" href="#/catalogo?${new URLSearchParams(params)}">${esc(label)}</a>`;
  const info = [
    `<span>${esc(count != null ? plural(count, 'capítulo', 'capítulos') : countLabel(s, m))}</span>`,
    lang ? `<span>${esc(lang)}</span>` : '',
    seen ? `<span>${seen} de ${total} vistos</span>` : '',
  ].filter(Boolean).join('');
  const links = [
    m && m.year ? chip(m.year, { y: m.year }) : '',
    m && m.format ? (m.collection ? `<span>${esc(m.format)}</span>` : chip(m.format, { f: m.format })) : '',
    ...((m && m.genres) || []).slice(0, 3).map((g) => chip(g, { g })),
  ].join('');
  return factRows(info, m, links);
}
function factRows(info, m, links) {
  const score = m && m.score ? `${info ? '<span class="fact-sep" aria-hidden="true">|</span>' : ''}<span class="fact-score" title="Nota en ${esc(m.src || 'AniList')}">★ ${esc(m.score)}</span>` : '';
  return `<div class="facts-rows">${info || score ? `<p class="tv-facts is-info">${info}${score}</p>` : ''}${links ? `<p class="tv-facts">${links}</p>` : ''}</div>`;
}
function countLabel(s, m) {
  return m && m.collection ? plural(m.count, 'película', 'películas') : plural(s.all.length, 'capítulo', 'capítulos');
}
/** Kai, el gatito: sentado detrás del título de la portada, parpadeando de vez en cuando. */
function catHTML(where) {
  if (state.settings.cat === false) return '';
  if (where === 'top') return '<span class="kcat-sit is-top" aria-hidden="true"><img src="gato/echado.webp" alt="" decoding="async"></span>';
  return `<span class="kcat-sit is-${where}" aria-hidden="true"><img src="gato/sentado.webp" alt="" decoding="async"><img class="is-blink" src="gato/sentado-cierra.webp" alt="" decoding="async"></span>`;
}
(function blinkLoop() {
  setTimeout(() => {
    // en el teléfono parpadea el del título; en la PC, el echado sobre la fecha todavía no tiene dibujo con ojos cerrados
    const el = !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches && [...document.querySelectorAll('.kcat-sit.is-title')].find((x) => x.offsetParent);
    if (el) {
      const blink = (then) => { el.classList.add('is-closed'); setTimeout(() => { el.classList.remove('is-closed'); if (then) setTimeout(then, 180); }, 150); };
      blink(Math.random() < 0.25 ? () => blink() : null); // a veces dos seguidas
    }
    blinkLoop();
  }, 3000 + Math.random() * 3000);
})();

function heroInnerHTML(s, si) {
  const m = displayMeta(s);
  const plan = heroPlan(s);
  const fresh = newEpisodes(s).length;
  const facts = [m && m.year, m && m.format, countLabel(s, m), ...((m && m.genres) || []).slice(0, 3)].filter(Boolean);
  const syn = synopsisOf(m);
  const coverEp = s.all.find((e) => e.fa);
  const poster = m && m.collage && m.collage.length
    ? `<a class="hero-poster is-collage" href="#/serie/${si}" aria-hidden="true" tabindex="-1">${collageHTML(m.collage)}</a>`
    : m && m.cover
    ? `<a class="hero-poster" href="#/serie/${si}" aria-hidden="true" tabindex="-1"><img src="${esc(m.cover)}" alt="" decoding="async"></a>`
    : (coverEp ? `<a class="hero-poster is-thumb" href="#/serie/${si}" aria-hidden="true" tabindex="-1"><span data-thumb="${esc(coverEp.id)}"></span></a>` : '');
  return `${poster}<div class="tvh-text"><h2 class="tv-title"><span class="tvt">${esc(s.name)}${catHTML('title')}</span></h2>
    ${m && m.title && m.title.toLowerCase() !== s.name.toLowerCase() ? `<p class="tv-alt">${esc(m.title)}</p>` : ''}
    <p class="tv-facts">${factsHTML(s, m, fresh ? `<span class="tv-new">${fresh === 1 ? '1 nuevo' : `${fresh} nuevos`}</span>` : '')}</p>
    ${syn ? `<p class="tv-synopsis">${esc(syn.replace(/\s*\n+\s*/g, ' '))}</p>` : ''}
    <div class="tv-actions">
      ${plan.next ? `<a class="tv-btn is-primary" href="#/play/${encodeURIComponent(plan.next.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>` : ''}
      <a class="tv-btn" href="#/serie/${si}">${ICON.menu}<span>Episodios</span></a>
    </div></div>`;
}

function setHero(si) {
  heroUser = true;
  if (!state.library || heroSi === si) return;
  const s = state.library.series[si];
  if (!s) return;
  heroSi = si;
  const box = $('#tv-hero');
  if (!box) return;
  setTint(seriesColor(s));
  box.classList.add('is-switching');
  setTimeout(() => {
    box.innerHTML = heroInnerHTML(s, si);
    hydrateThumbs(box);
    box.classList.remove('is-switching');
  }, 120);
}

function renderHome() {
  const lib = state.library && state.library.v === 2 ? state.library : null;
  const err = state.error;
  let body = '';
  if (err && err.message === 'NOROOT') {
    body = `<section class="empty tv-empty">
      <p>No encontré la carpeta <strong>${esc(state.settings.root)}</strong> en tu MEGA.</p>
      <p class="dim">Elige la carpeta donde guardas tus series. Cada carpeta adentro será una serie.</p>
      <a class="tv-btn is-primary" href="#/explorar">Elegir carpeta</a>
    </section>`;
  } else if (!lib) {
    body = `<section class="empty tv-empty"><p class="dim">${navigator.onLine ? 'Conectando con MEGA…' : 'Sin conexión. Lo que descargaste está en Descargados.'}</p>
      ${navigator.onLine ? '' : '<a class="tv-btn" href="#/descargas">Ver descargados</a>'}</section>`;
  } else if (!lib.series.length) {
    body = `<section class="empty tv-empty"><p>La carpeta <strong>${esc(lib.root)}</strong> está vacía.</p>
      <p class="dim">Crea una carpeta por serie y pon los capítulos adentro, o una subcarpeta por temporada.</p></section>`;
  }
  if (body) {
    app.innerHTML = `<div class="tv">${tvTop()}<main class="tv-main">${body}</main></div>`;
    return;
  }
  const cont = continueList();
  const later = laterList();
  const siOf = (s) => lib.series.indexOf(s);
  // la portada muestra una serie (la carpeta de películas no tiene una ficha propia que mostrar)
  if (!heroUser || heroSi == null || !lib.series[heroSi] || isCollection(lib.series[heroSi])) {
    const c = cont.find((x) => !isCollection(x.series));
    const first = lib.series.findIndex((x) => !isCollection(x));
    heroSi = c ? siOf(c.series) : Math.max(0, first);
  }
  const hs = lib.series[heroSi];
  setTint(seriesColor(hs));
  app.innerHTML = `<div class="tv is-home">
    ${tvTop()}
    <main class="tv-main">
      ${resumeCardHTML()}
      <section class="tv-hero" id="tv-hero">${heroInnerHTML(hs, heroSi)}</section>
      <section class="tv-row" id="home-results" hidden></section>
      ${cont.length ? `<section class="tv-row"><h3 class="tv-row-title">Continuar viendo</h3><div class="tiles is-grid" role="list">
        ${cont.slice(0, HOME_CONTINUE).map((c) => tileHTML(c.series, siOf(c.series), {
          // primero la página de la serie (o de la película), con "Continuar" listo
          href: isCollection(c.series) ? movieHref(siOf(c.series), itemFor(c.series, c.ep).key) : '#/serie/' + siOf(c.series),
          label: isCollection(c.series) ? movieTitle(c.series, itemFor(c.series, c.ep)) : '',
          img: isCollection(c.series) ? movieImage(c.series, itemFor(c.series, c.ep)) : '',
          sub: `${episodeLabel(c.ep)}${c.p && c.p.t > 5 ? `, ${fmtLeft(c.p)}` : ''}`,
          pct: c.p && c.p.d ? Math.min(100, (c.p.t / c.p.d) * 100) : 0,
        })).join('')}
      </div></section>` : ''}
      ${later.length ? `<section class="tv-row"><h3 class="tv-row-title">Más tarde</h3><div class="tiles is-grid" role="list">
        ${later.slice(0, 12).map(({ s, si, it }) => tileHTML(s, si, {
          href: it ? movieHref(si, it.key) : '#/serie/' + si,
          label: it ? movieTitle(s, it) : s.name,
          img: it ? movieImage(s, it) : '',
          sub: it ? 'Película' : plural(s.all.length, 'capítulo', 'capítulos'),
        })).join('')}
      </div></section>` : ''}
      <section class="tv-row">
        <div class="tv-row-head"><h3 class="tv-row-title">Series</h3>
          <a class="tv-more" href="#/catalogo?t=series">${ICON.grid}<span>Ver catálogo${lib.series.filter((x) => !isCollection(x)).length > HOME_RECENT ? ` (${lib.series.filter((x) => !isCollection(x)).length})` : ''}</span></a></div>
        <ul class="shelf is-row" role="list">${recentSeries(lib).map(({ s, si }) => seriesPosterHTML(s, si)).join('')}</ul>
</section>
      ${homeMoviesHTML(lib)}
      <nav class="discover-links" aria-label="Descubrir">
        ${lib.series.some(isCine) ? `<a class="tv-more" href="#/serie/${lib.series.findIndex(isCine)}">${ICON.grid}<span>${esc(lib.series.find(isCine).name)}</span></a>` : ''}
        <a class="tv-more" href="#/descubrir/porque">${ICON.grid}<span>Porque viste…</span></a>
        <a class="tv-more" href="#/descubrir/emision">${ICON.grid}<span>En emisión</span></a>
      </nav>
    </main>
  </div>`;
}
/** Fila "Películas" del inicio: las 10 más recientes y el enlace al estante completo. */
function homeMoviesHTML(lib) {
  const si = lib.series.findIndex((x) => isCollection(x) && !isCine(x));
  if (si < 0) return '';
  const s = lib.series[si];
  const items = shelfItems(s);
  if (!items.length) return '';
  const fresh = new Set(newEpisodes(s).map((e) => e.id));
  return `<section class="tv-row">
    <div class="tv-row-head"><h3 class="tv-row-title">Películas</h3>
      <a class="tv-more" href="#/catalogo?t=peliculas">${ICON.grid}<span>Ver catálogo${items.length > HOME_MOVIES ? ` (${items.length})` : ''}</span></a></div>
    <ul class="shelf is-row" role="list">${items.slice(0, HOME_MOVIES).map((x) => moviePosterHTML(s, si, x, fresh)).join('')}</ul>
  </section>`;
}

/** Tarjeta "Estabas viendo … en el iPhone — Seguir aquí". */
function resumeCardHTML() {
  const o = resumeOffer();
  if (!o) return '';
  const mins = Math.round((Date.now() - o.n.u) / 60000);
  const when = mins < 2 ? 'hace un momento' : mins < 60 ? `hace ${mins} min` : `hace ${Math.round(mins / 60)} h`;
  const title = isCollection(o.s) ? episodeLabel(o.ep) : `${o.s.name} · ${episodeLabel(o.ep)}`;
  return `<section class="resume-card" aria-label="Seguir en este dispositivo">
    <div class="resume-text"><p class="resume-kicker">En tu ${esc(o.n.dn || 'otro dispositivo')}, ${when}</p>
      <p class="resume-title">${esc(title)}</p></div>
    <button class="tv-btn is-primary" data-act="resume-here">${ICON.play}<span>Seguir aquí en ${fmtTime(o.n.t)}</span></button>
    <button class="icon-btn resume-x" data-act="resume-dismiss" aria-label="Descartar">${ICON.close}</button>
  </section>`;
}

/* ── Ajustes: lo que ya vieron todos los perfiles (solo informa; no borra nada) ── */
async function paintSeenByAll(btn) {
  const box = $('#seen-all-list');
  if (!box) return;
  const profiles = visibleProfiles().filter((p) => !p.mergedInto);
  if (profiles.length < 2) { box.innerHTML = '<p class="dim">Solo hay un perfil: aquí aparecerá lo que hayan visto todos cuando haya más.</p>'; return; }
  if (!state.storage || !state.library || state.library.v !== 2) { box.innerHTML = '<p class="dim">Necesitas conexión con MEGA para revisar.</p>'; return; }
  btn.disabled = true;
  box.innerHTML = '<p class="dim">Revisando el progreso de cada perfil…</p>';
  try {
    const home = state.storage.root;
    const all = [];
    for (const p of profiles) {
      if (state.profile && p.id === state.profile.id) { all.push(state.progress); continue; }
      let items = {};
      for (const n of filesNamed(home, profileFile(p.id))) {
        const data = await readJson(n); // si no se puede leer, falla todo: nunca se supone "no visto"
        if (data && data.items) items = mergeProgress(items, data.items);
      }
      all.push(items);
    }
    const rows = [];
    let bytes = 0;
    for (const sr of state.library.series) {
      const done = sr.all.filter((ep) => all.every((pr) => (pr[ep.path] || {}).w));
      if (!done.length) continue;
      const size = done.reduce((t, ep) => t + (ep.size || 0), 0);
      bytes += size;
      const what = isCollection(sr) ? done.map(episodeLabel).join(', ') : done.length === sr.all.length ? 'todos los capítulos' : done.map((ep) => ep.ep != null ? ep.ep : episodeLabel(ep)).join(', ');
      rows.push(`<li><strong>${esc(sr.name)}</strong>: ${esc(what)} <span class="dim">(${fmtSize(size)})</span></li>`);
    }
    box.innerHTML = rows.length
      ? `<ul class="seen-all">${rows.join('')}</ul><p class="dim">En total ${fmtSize(bytes)} que ya vieron ${profiles.map((p) => p.name).join(', ')}.</p>`
      : `<p class="dim">Todavía no hay capítulos que hayan terminado todos (${esc(profiles.map((p) => p.name).join(', '))}).</p>`;
  } catch (err) {
    box.innerHTML = `<p class="dim">${esc(megaMessage(err.cause || err))}</p>`;
  } finally {
    btn.disabled = false;
  }
}

/* ── catálogo: todo lo que hay, con buscador y filtros ── */

const HOME_RECENT = 10;
const HOME_MOVIES = 10;
const HOME_CONTINUE = 3;
const norm = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function recentSeries(lib) {
  return lib.series.map((s, si) => ({ s, si })).filter(({ s }) => !isCollection(s))
    .sort((a, b) => (b.s.added || 0) - (a.s.added || 0) || a.s.name.localeCompare(b.s.name, 'es', { numeric: true }))
    .slice(0, HOME_RECENT);
}

/** Series y, de las colecciones, cada película por separado (cada una con sus etiquetas de AniList). */
function catalogEntries() {
  const lib = state.library;
  if (!lib || lib.v !== 2) return [];
  const out = [];
  lib.series.forEach((s, si) => {
    if (isCollection(s)) {
      for (const it of collectionItems(s)) {
        const m = itemMeta(s, it.key);
        const title = it.title || (m && m.title) || it.eps[0].name.replace(/\.[^.]+$/, '');
        out.push({
          si, title: movieTitle(s, it), m, img: m && (m.banner || m.cover), year: m && m.year, genres: (m && m.genres) || [], format: 'Película',
          added: Math.max(0, ...it.eps.map((e) => e.ts || 0)), href: movieHref(si, it.key), movie: it.key, cine: isCine(s), langs: langsOf(it.eps),
          words: norm([title, m && m.title, m && m.romaji, m && m.native, s.name].join(' ')),
        });
      }
    } else {
      const m = metaFor(s);
      out.push({
        si, title: s.name, m, img: m && (m.banner || m.cover), year: m && m.year, genres: (m && m.genres) || [],
        format: (m && m.format) || 'Serie', added: s.added || 0, count: s.all.length, langs: langsOf(s.all),
        words: norm([s.name, m && m.title, m && m.romaji, m && m.native, ...s.seasons.map((se) => se.title)].join(' ')),
      });
    }
  });
  return out;
}
function filterEntries(list, { q = '', g = '', y = '', f = '', l = '' }) {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  return list.filter((e) => terms.every((t) => e.words.includes(t))
    && (!g || e.genres.includes(g)) && (!y || String(e.year) === String(y)) && (!f || e.format === f) && (!l || (e.langs || []).includes(l)));
}
function sortEntries(list, o) {
  const az = (a, b) => a.title.localeCompare(b.title, 'es', { numeric: true });
  if (o === 'az') return list.sort(az);
  if (o === 'year') return list.sort((a, b) => (b.year || 0) - (a.year || 0) || az(a, b));
  return list.sort((a, b) => (b.added || 0) - (a.added || 0) || az(a, b));
}
/** Una serie como póster vertical (mismo diseño que las películas). */
function seriesPosterHTML(s, si) {
  const m = displayMeta(s);
  const fresh = newEpisodes(s).length;
  const seen = s.all.filter((e) => (prog(e) || {}).w).length;
  const sub = seen ? `${seen} de ${s.all.length} vistos` : plural(s.all.length, 'capítulo', 'capítulos');
  const coverEp = s.all.find((e) => e.fa) || s.all[0];
  const pct = s.all.length && seen ? Math.round((seen / s.all.length) * 100) : 0;
  return `<li><a class="shelf-item" href="#/serie/${si}" style="--h:${hue(s.name)}">
    <span class="shelf-poster">
      ${m && m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy" decoding="async">` : `<span class="is-fallback" ${coverEp ? `data-thumb="${esc(coverEp.id)}"` : ''}><span class="cover-glyph">${esc([...s.name.trim()][0] || '·')}</span></span>`}
      ${fresh ? `<span class="tile-badge">${fresh === 1 ? 'Nuevo' : `${fresh} nuevos`}</span>` : ''}
      ${langChip(langsOf(s.all))}
      ${pct && pct < 100 ? `<span class="tile-bar"><span style="width:${pct}%"></span></span>` : ''}
    </span>
    <span class="shelf-title">${esc(s.name)}</span>
    <span class="shelf-sub">${esc(sub)}</span>
  </a></li>`;
}
/** Cualquier título del catálogo como póster: serie o película. */
function posterAny(e) { return e.movie ? posterEntry(e) : seriesPosterHTML(state.library.series[e.si], e.si); }

/** Una película del catálogo como póster (mismo diseño que la fila del inicio). */
let posterCache = null; // se arma una vez por dibujo: { s, items: Map(clave → película), fresh }
function posterEntry(e) {
  const s = state.library.series[e.si];
  if (!posterCache || posterCache.s !== s) posterCache = { s, items: new Map(shelfItems(s).map((y) => [y.it.key, y])), fresh: new Set(newEpisodes(s).map((ep) => ep.id)) };
  const x = posterCache.items.get(e.movie);
  return x ? moviePosterHTML(s, e.si, x, posterCache.fresh) : '';
}
function entryTile(e) {
  const sub = [e.year, e.format, e.count ? plural(e.count, 'capítulo', 'capítulos') : ''].filter(Boolean).join(' · ');
  return `<a class="tile" href="${e.href || '#/serie/' + e.si}" style="--h:${hue(e.title)}">
    ${e.img ? `<img class="tile-img" src="${esc(e.img)}" alt="" loading="lazy" decoding="async">` : `<span class="tile-img is-fallback"><span class="cover-glyph">${esc([...e.title.trim()][0] || '·')}</span></span>`}
    <span class="tile-text"><span class="tile-title">${esc(e.title)}</span>${sub ? `<span class="tile-sub">${esc(sub)}</span>` : ''}</span>
  </a>`;
}

/* Dos catálogos, Series y Películas (?t=series | ?t=peliculas). Al buscar o filtrar por una etiqueta,
 * se busca en todo: series y películas juntas. */
const CAT_TITLES = { series: 'Series', peliculas: 'Películas' };
const isFiltering = (st) => !!(st.q || st.g || st.y || st.f || st.l);
function catalogBase(t, st) {
  const all = catalogEntries().filter((e) => !e.cine || st.q); // Cine no se mezcla: solo aparece al buscar
  if (!CAT_TITLES[t] || isFiltering(st)) return all;
  return all.filter((e) => (t === 'peliculas') === !!e.movie);
}
function renderCatalog() {
  const q = route().q;
  const t = CAT_TITLES[q.get('t')] ? q.get('t') : '';
  const all = catalogEntries();
  const count = (key) => {
    const m = new Map();
    for (const e of all) for (const v of [].concat(e[key] || [])) if (v) m.set(String(v), (m.get(String(v)) || 0) + 1);
    return m;
  };
  const genres = [...count('genres').entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')).map(([v, n]) => [v, `${v} (${n})`]);
  const years = [...count('year').keys()].sort((a, b) => b - a).map((v) => [v, v]);
  const formats = [...count('format').keys()].sort().map((v) => [v, v]);
  const select = (name, label, opts, all = true) => {
    const cur = q.get(name) || '';
    const known = !cur || opts.some(([v]) => v === cur);
    return `<label class="cat-select"><span>${label}</span><select name="${name}">
      ${all ? `<option value="">Todos</option>` : ''}${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      ${known ? '' : `<option value="${esc(cur)}" selected>${esc(cur)}</option>`}</select></label>`;
  };
  app.innerHTML = header(CAT_TITLES[t] || 'Catálogo') + `<main class="catalog" data-t="${t}">
    <form class="cat-search" id="cat-form" role="search">
      <span class="search-icon">${ICON.search}</span>
      <input id="cat-q" name="q" type="search" placeholder="Buscar series y películas" value="${esc(q.get('q') || '')}" autocomplete="off" enterkeyhint="search" aria-label="Buscar">
    </form>
    <div class="cat-filters" id="cat-filters">
      ${select('g', 'Género', genres)}${select('y', 'Año', years)}${select('f', 'Tipo', formats)}
      ${all.some((e) => e.langs && e.langs.length) ? select('l', 'Idioma', [['sub', 'Subtitulado'], ['dob', 'Doblado']]) : ''}
      ${select('o', 'Orden', [['recent', 'Recientes'], ['az', 'A–Z'], ['year', 'Año']], false)}
      <button class="link-btn cat-clear" type="button" data-act="cat-clear" hidden>Quitar filtros</button>
    </div>
    <p class="dim cat-count" id="cat-count" aria-live="polite"></p>
    <div id="cat-results"></div>
  </main>`;
  const form = $('#cat-form');
  form.addEventListener('submit', (e) => { e.preventDefault(); $('#cat-q').blur(); });
  $('#cat-q').addEventListener('input', debounce(paintCatalog, 120));
  $('#cat-filters').addEventListener('change', paintCatalog);
  paintCatalog();
  if (q.get('buscar') === '1') $('#cat-q').focus();
}
function catalogState() {
  const val = (n) => { const el = app.querySelector(`#cat-filters [name="${n}"]`); return el ? el.value : ''; };
  return { q: ($('#cat-q') || {}).value || '', g: val('g'), y: val('y'), f: val('f'), l: val('l'), o: val('o') || 'recent' };
}
function paintCatalog() {
  const box = $('#cat-results');
  if (!box) return;
  const st = catalogState();
  const t = (app.querySelector('.catalog') || {}).dataset?.t || '';
  const list = sortEntries(filterEntries(catalogBase(t, st), st), st.o);
  // series y películas, como pósters
  const posters = true;
  // si al teclear sigue saliendo lo mismo, no se vuelven a dibujar todos los mosaicos
  const sig = (posters ? 'p' : 't') + list.map((e) => e.href || e.si).join('|') + '#' + list.map((e) => e.img || '').join('').length;
  if (box.dataset.sig !== sig) {
    posterCache = null;
    box.innerHTML = posters ? `<ul class="shelf" role="list">${list.map(posterAny).join('')}</ul>` : `<div class="tiles is-grid" role="list">${list.map(entryTile).join('')}</div>`;
    box.dataset.sig = sig;
    if (posters) hydrateThumbs(box);
  }
  $('#cat-count').textContent = list.length ? plural(list.length, 'título', 'títulos') : (state.library ? 'Nada coincide con la búsqueda o los filtros.' : 'Cargando la biblioteca…');
  app.querySelector('[data-act="cat-clear"]').hidden = !(st.g || st.y || st.f || st.l || st.q);
  // la dirección refleja la búsqueda (para volver atrás o compartirla), sin redibujar la página
  const params = new URLSearchParams();
  if (t) params.set('t', t);
  for (const k of ['q', 'g', 'y', 'f', 'l']) if (st[k]) params.set(k, st[k]);
  if (st.o !== 'recent') params.set('o', st.o);
  const h = '#/catalogo' + (params.toString() ? '?' + params : '');
  if (location.hash !== h) history.replaceState(null, '', h);
}

/* búsqueda rápida desde el inicio */
function openHomeSearch() {
  const bar = $('#home-search');
  if (!bar) return;
  bar.hidden = false;
  app.querySelector('[data-act="home-search"]').setAttribute('aria-expanded', 'true');
  const input = $('#home-q');
  input.focus();
  input.oninput = debounce(paintHomeSearch, 120);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go('#/catalogo?' + new URLSearchParams({ q: input.value })); }
    else if (e.key === 'Escape') closeHomeSearch();
  };
}
// tocar o hacer clic en cualquier otra parte cierra el buscador (sus resultados y la lupa no cuentan)
document.addEventListener('pointerdown', (e) => {
  const bar = $('#home-search');
  if (!bar || bar.hidden) return;
  if (e.target.closest('#home-search, #home-results, [data-act="home-search"]')) return;
  closeHomeSearch();
});
function closeHomeSearch() {
  const bar = $('#home-search');
  if (!bar) return;
  bar.hidden = true;
  $('#home-q').value = '';
  app.querySelector('[data-act="home-search"]').setAttribute('aria-expanded', 'false');
  paintHomeSearch();
}
function paintHomeSearch() {
  const box = $('#home-results');
  const tv = app.querySelector('.tv.is-home');
  if (!box || !tv) return;
  const qv = ($('#home-q') || {}).value || '';
  const on = !!qv.trim();
  tv.classList.toggle('is-searching', on);
  box.hidden = !on;
  if (!on) { box.innerHTML = ''; return; }
  const list = sortEntries(filterEntries(catalogEntries(), { q: qv }), 'az');
  box.innerHTML = `<div class="tv-row-head"><h3 class="tv-row-title">${list.length ? plural(list.length, 'resultado', 'resultados') : 'Sin resultados'}</h3>
      <a class="tv-more" href="#/catalogo?${new URLSearchParams({ q: qv })}">${ICON.grid}<span>Buscar en el catálogo</span></a></div>
    <ul class="shelf is-row" role="list">${list.slice(0, 24).map(posterAny).join('')}</ul>`;
  posterCache = null;
}

/* ── serie ── */

/** Botones Sub | Doblado de una serie que tiene capítulos en los dos idiomas. */
function langSwitchHTML(s, langs) {
  if (!langs || langs.length < 2) return '';
  const cur = langPref(s);
  return `<div class="lang-switch" role="group" aria-label="Idioma">${langs.map((l) => `<button class="${l === cur ? 'is-on' : ''}" data-act="lang" data-lang="${l}" aria-pressed="${l === cur}">${l === 'sub' ? 'Sub' : 'Doblado'}</button>`).join('')}</div>`;
}
/** Dirección de una temporada: con varias, cada una tiene su página (#/serie/3/1); con una sola, la serie. */
function seasonHref(si, s, ki) { return s && !isCollection(s) && s.seasons.length > 1 ? `#/serie/${si}/${ki}` : `#/serie/${si}`; }
/** Nombre corto para la tarjeta de una temporada: sin repetir el nombre (largo) de la serie.
 *  "Yahari Ore no Seishun… Zoku" → "Zoku"; la que se llama igual que la serie → "Temporada 1". */
/** "2nd Season", "Season 2 Part 2" → "Temporada 2", "Temporada 2 · Parte 2" (todo en español). */
function spanishSeason(t) {
  const m = /^\s*(?:(\d{1,2})(?:st|nd|rd|th)\s+season|season\s*(\d{1,2})|temporada\s*(\d{1,2}))(?:\s*[-–·:,]?\s*(?:part|parte|cour)\s*(\d{1,2}))?\s*$/i.exec(t);
  return m ? `Temporada ${m[1] || m[2] || m[3]}${m[4] ? ` · Parte ${m[4]}` : ''}` : t;
}
function seasonShort(s, se) {
  const t = seasonTab(s, se);
  if (s.name.length < 10 || !t.toLowerCase().startsWith(s.name.toLowerCase())) return spanishSeason(t);
  const rest = t.slice(s.name.length).replace(/^[\s.\-–:,]+/, '').trim();
  return rest ? spanishSeason(rest[0].toUpperCase() + rest.slice(1)) : `Temporada ${seasonOrdinal(s, se)}`;
}

function renderSeries(arg) {
  const lib = state.library;
  const [siPart, kiPart] = String(arg).split('/');
  const si = Number(siPart);
  const s = lib && lib.series && lib.series[si];
  if (!s) { go('#/'); return; }
  if (isCollection(s)) { renderShelf(s, si); return; }
  heroSi = si;
  heroUser = true;
  const flat = false;
  const multi = s.seasons.length > 1;
  // con varias temporadas, primero el menú de temporadas; los capítulos, al entrar a una
  if (multi && kiPart == null) { renderSeasonMenu(s, si); return; }
  const ki = multi ? Number(kiPart) : 0;
  if (multi && !(ki >= 0 && ki < s.seasons.length)) { navReplacing = true; location.replace('#/serie/' + si); return; }
  const season = s.seasons[ki];
  // con varias temporadas, el botón grande es de la temporada que estás mirando
  const plan = multi ? seasonPlan(s, season) : heroPlan(s);
  const next = plan.next;
  // cada temporada con su ficha (póster, banner, sinopsis); si no tiene, la de la serie
  const ownMeta = flat ? null : seasonMeta(s, season);
  const m = ownMeta || displayMeta(s);
  const fresh = new Set(newEpisodes(s).map((e) => e.id));
  const upcoming = next ? [next, ...nextUnseen(next, flat || s.seasons.length < 2 ? s.all : season.episodes, 2)].filter((x) => !state.saved.has(x.id)) : [];
  const syn = synopsisOf(m);
  const coverEp = season.episodes.find((e) => e.fa) || s.all.find((e) => e.fa);
  const scope = !flat && s.seasons.length > 1 ? season.episodes : s.all; // con pestañas, los números son de la temporada
  const seen = scope.filter((e) => (prog(e) || {}).w).length;
  const collage = m && m.collage && m.collage.length ? m.collage : null;
  setTint(seriesColor(s));
  app.innerHTML = header('', { overlay: true }) + `<div class="tv is-series">
    <div class="series-wash" aria-hidden="true">${m && m.cover ? `<img src="${esc(m.cover)}" alt="">` : ''}</div>
    <main class="tv-main series-main">
      <section class="series-hero ${(m && m.banner) || collage ? 'has-banner' : ''}">
        ${collage ? `<div class="banner is-collage" aria-hidden="true">${Array.from({ length: Math.max(12, collage.length) }, (_, i) => collage[i % collage.length]).map((u) => `<img src="${esc(u)}" alt="" decoding="async">`).join('')}</div>`
          : m && m.banner ? `<div class="banner"><img src="${esc(m.banner)}" alt="" decoding="async"></div>` : ''}
        <div class="series-top">
          ${collage ? `<span class="poster is-collage">${collageHTML(collage)}</span>` : m && m.cover ? `<img class="poster" src="${esc(m.cover)}" alt="" decoding="async">` : (coverEp ? `<span class="poster is-thumb" data-thumb="${esc(coverEp.id)}"></span>` : '')}
          <div class="series-info">
            ${multi ? `<p class="tv-kicker"><a href="#/serie/${si}">${esc(s.name)}</a><span>${ki + 1} de ${s.seasons.length}</span></p>` : ''}
            <h2 class="tv-title">${esc(multi ? seasonShort(s, season) : s.name)}</h2>
            ${m && m.title && m.title.toLowerCase() !== (multi ? seasonShort(s, season) : s.name).toLowerCase() ? `<p class="tv-alt">${esc(m.title)}${m.native ? ` <span lang="ja">${esc(m.native)}</span>` : ''}</p>` : ''}
            ${factsRowsHTML(s, m, { count: flat ? null : scope.length, seen, total: scope.length, lang: langText(langsOf(season.episodes)) })}
          </div>
        </div>
        ${syn ? `<p class="tv-synopsis is-long" id="synopsis">${esc(syn)}</p>` : ''}
        ${m && !hasSpanish(m) && m.synopsis && canTranslate() ? `<button class="link-btn" data-act="translate"${ownMeta ? ` data-key="${esc(season.name)}"` : ''}>Traducir sinopsis al español</button>` : ''}
        <div class="tv-actions">
          ${next ? `<a class="tv-btn is-primary" href="#/play/${encodeURIComponent(next.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>` : `<span class="tv-done">${esc(plan.label)}</span>`}
          ${upcoming.length ? `<button class="tv-btn" data-act="series-dl" data-si="${si}"${multi ? ` data-from="${esc(next.id)}"` : ''}>${ICON.down}<span>Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}</span></button>` : ''}
          ${flat ? '' : `<button class="tv-btn ${isLater(s) ? 'is-on' : ''}" data-act="later" data-si="${si}" aria-pressed="${isLater(s)}">${isLater(s) ? ICON.laterOn : ICON.later}<span>Más tarde</span></button>`}
        </div>
      </section>
      <section class="ep-section">
        <div class="ep-head">
          <h3 class="ep-heading">${flat ? 'Películas' : 'Episodios'}</h3>
          <button class="pick-toggle" data-act="pick-mode" id="pick-toggle" aria-pressed="false">${ICON.check}<span>Seleccionar</span></button>
          ${langSwitchHTML(s, season.langs)}
          ${multi ? `<nav class="season-step" aria-label="Otras temporadas">
            ${ki > 0 ? `<a class="step-btn" href="#/serie/${si}/${ki - 1}" data-replace title="${esc(seasonTab(s, s.seasons[ki - 1]))}">${ICON.back}<span>Anterior</span></a>` : ''}
            <a class="step-btn" href="#/serie/${si}" data-replace>${ICON.grid}<span>Temporadas</span></a>
            ${ki < s.seasons.length - 1 ? `<a class="step-btn is-next" href="#/serie/${si}/${ki + 1}" data-replace title="${esc(seasonTab(s, s.seasons[ki + 1]))}"><span>Siguiente</span>${ICON.back}</a>` : ''}
          </nav>` : ''}
        </div>
        ${season.title && season.title !== s.name && !multi ? `<p class="season-title">${esc(season.title)}</p>` : ''}
        <ol class="episodes is-grid" id="season-eps">${season.episodes.map((ep) => episodeRow(ep, { fresh: fresh.has(ep.id), next: next && ep.id === next.id })).join('')}</ol>
      </section>
    </main>
    <div class="pick-bar" id="pick-bar" role="toolbar" aria-label="Capítulos seleccionados" hidden>
      <span class="pick-count" id="pick-count" aria-live="polite"></span>
      <button class="pick-btn" data-act="pick-all">Todos</button>
      <button class="pick-btn" data-act="pick-unseen">Sin ver</button>
      <button class="pick-btn is-primary" data-act="pick-dl" disabled>${ICON.down}<span>Descargar</span></button>
    </div>
  </div>`;
  if (picking && (picking.si !== si || picking.ki !== ki)) picking = { si, ki, ids: new Set() };
  paintPick();
  let focusId = null;
  try { focusId = sessionStorage.getItem('kai.focus'); sessionStorage.removeItem('kai.focus'); } catch { /* nada */ }
  const fli = focusId && app.querySelector(`.ep[data-id="${CSS.escape(focusId)}"]`);
  if (fli) requestAnimationFrame(() => { fli.scrollIntoView({ block: 'center' }); fli.classList.add('is-flash'); });
  // los "nuevos" se muestran esta vez y quedan vistos
  if (fresh.size) { markSeriesSeen(s); lastNew = null; announceNew(); }
}

/** Menú de una serie con varias temporadas: la ficha de la serie y una tarjeta por temporada. */
function renderSeasonMenu(s, si) {
  const m = displayMeta(s);
  const plan = heroPlan(s);
  const next = plan.next;
  const nextKi = next ? index.byId.get(next.id).ki : -1;
  const fresh = new Set(newEpisodes(s).map((e) => e.id));
  const upcoming = next ? [next, ...nextUnseen(next, s.all, 2)].filter((x) => !state.saved.has(x.id)) : [];
  const syn = synopsisOf(m);
  const seen = s.all.filter((e) => (prog(e) || {}).w).length;
  const coverEp = s.all.find((e) => e.fa);
  // la ficha de una franquicia ("Fate") es la de una de sus temporadas: traducir va a esa
  const metaKey = isFranchise(s) ? (s.seasons.find((se) => seasonMeta(s, se) === m) || {}).name : '';
  const cards = s.seasons.map((se, ki) => {
    const sm = seasonMeta(s, se) || (isFranchise(s) ? null : m);
    const t = seasonShort(s, se);
    const done = se.episodes.filter((e) => (prog(e) || {}).w).length;
    const all = done === se.episodes.length;
    const isNew = se.episodes.some((e) => fresh.has(e.id));
    const first = se.episodes.find((e) => e.fa) || se.episodes[0];
    const sub = [sm && sm.year && seasonMeta(s, se) ? sm.year : '', all ? 'Vista' : done ? `${done} de ${plural(se.episodes.length, 'capítulo', 'capítulos')}` : plural(se.episodes.length, 'capítulo', 'capítulos')].filter(Boolean).join(' · ');
    return `<li><a class="shelf-item" href="#/serie/${si}/${ki}" style="--h:${hue(t)}">
      <span class="shelf-poster">
        ${sm && sm.cover ? `<img src="${esc(sm.cover)}" alt="" loading="lazy" decoding="async">` : first ? `<span class="is-fallback" data-thumb="${esc(first.id)}"><span class="cover-glyph">${esc([...t.trim()][0] || '·')}</span></span>` : ''}
        ${isNew ? '<span class="tile-badge">Nuevo</span>' : ki === nextKi && done ? '<span class="tile-badge">Viendo</span>' : ''}
        ${langChip(langsOf(se.episodes))}
        ${done && !all ? `<span class="tile-bar"><span style="width:${(done / se.episodes.length) * 100}%"></span></span>` : ''}
      </span>
      <span class="shelf-title" title="${esc(seasonTab(s, se))}">${esc(t)}</span>
      <span class="shelf-sub">${esc(sub)}</span>
    </a></li>`;
  }).join('');
  setTint(seriesColor(s));
  app.innerHTML = header('', { overlay: true }) + `<div class="tv is-series">
    <div class="series-wash" aria-hidden="true">${m && m.cover ? `<img src="${esc(m.cover)}" alt="">` : ''}</div>
    <main class="tv-main series-main">
      <section class="series-hero ${m && m.banner ? 'has-banner' : ''}">
        ${m && m.banner ? `<div class="banner"><img src="${esc(m.banner)}" alt="" decoding="async"></div>` : ''}
        <div class="series-top">
          ${m && m.cover ? `<img class="poster" src="${esc(m.cover)}" alt="" decoding="async">` : (coverEp ? `<span class="poster is-thumb" data-thumb="${esc(coverEp.id)}"></span>` : '')}
          <div class="series-info">
            <h2 class="tv-title">${esc(s.name)}</h2>
            ${m && m.title && !isFranchise(s) && m.title.toLowerCase() !== s.name.toLowerCase() ? `<p class="tv-alt">${esc(m.title)}${m.native ? ` <span lang="ja">${esc(m.native)}</span>` : ''}</p>` : ''}
            ${factRows(`<span>${plural(s.seasons.length, 'temporada', 'temporadas')}</span><span>${plural(s.all.length, 'capítulo', 'capítulos')}</span>${langsOf(s.all).length ? `<span>${esc(langText(langsOf(s.all)))}</span>` : ''}${seen ? `<span>${seen} vistos</span>` : ''}`, m,
              [m && m.year ? `<a class="fact" href="#/catalogo?${new URLSearchParams({ y: m.year })}">${esc(m.year)}</a>` : '', ...((m && m.genres) || []).slice(0, 3).map((g) => `<a class="fact" href="#/catalogo?${new URLSearchParams({ g })}">${esc(g)}</a>`)].join(''))}
          </div>
        </div>
        ${syn ? `<p class="tv-synopsis is-long" id="synopsis">${esc(syn)}</p>` : ''}
        ${m && !hasSpanish(m) && m.synopsis && canTranslate() ? `<button class="link-btn" data-act="translate"${metaKey ? ` data-key="${esc(metaKey)}"` : ''}>Traducir sinopsis al español</button>` : ''}
        <div class="tv-actions">
          ${next ? `<a class="tv-btn is-primary" href="#/play/${encodeURIComponent(next.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>` : `<span class="tv-done">${esc(plan.label)}</span>`}
          ${upcoming.length ? `<button class="tv-btn" data-act="series-dl" data-si="${si}">${ICON.down}<span>Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}</span></button>` : ''}
          <button class="tv-btn ${isLater(s) ? 'is-on' : ''}" data-act="later" data-si="${si}" aria-pressed="${isLater(s)}">${isLater(s) ? ICON.laterOn : ICON.later}<span>Más tarde</span></button>
        </div>
      </section>
      <section class="ep-section">
        <div class="ep-head"><h3 class="ep-heading">Temporadas</h3>${langSwitchHTML(s, s.seasons.some((se) => se.langs) ? ['sub', 'dob'] : null)}</div>
        <ul class="shelf season-grid" role="list">${cards}</ul>
      </section>
    </main>
  </div>`;
  if (fresh.size) { markSeriesSeen(s); lastNew = null; announceNew(); }
}

/* ── películas: el estante (la carpeta) y la página de cada una ── */

/** Lo siguiente que conviene ver de una película (o de sus partes) y cómo decirlo en el botón. */
function moviePlan(it) {
  const eps = it.eps;
  const next = eps.find((e) => !(prog(e) || {}).w) || null;
  const ep = next || eps[0];
  const p = prog(ep);
  const part = eps.length > 1 ? ` parte ${eps.indexOf(ep) + 1}` : '';
  const label = !next ? 'Ver de nuevo' : p && p.t > 5 ? `Continuar${part} en ${fmtTime(p.t)}` : `Ver${part}`;
  const pct = p && p.d ? (p.w ? 100 : Math.min(100, (p.t / p.d) * 100)) : 0;
  return { ep, label, pct, seen: !next, left: next && p && p.t > 5 ? fmtLeft(p) : '' };
}

/** Las películas de la colección, las agregadas más recientemente primero. */
function shelfItems(s) {
  return collectionItems(s).map((it) => ({ it, m: itemMeta(s, it.key), plan: moviePlan(it), added: Math.max(0, ...it.eps.map((e) => e.ts || 0)) }))
    .sort((a, b) => b.added - a.added || movieTitle(s, a.it).localeCompare(movieTitle(s, b.it), 'es', { numeric: true }));
}
function moviePosterHTML(s, si, { it, m, plan }, fresh) {
  const t = movieTitle(s, it);
  const isNew = it.eps.some((e) => fresh.has(e.id));
  const sub = [m && m.year, plan.seen ? 'Vista' : plan.left].filter(Boolean).join(' · ');
  return `<li><a class="shelf-item" href="${movieHref(si, it.key)}" style="--h:${hue(t)}">
    <span class="shelf-poster">
      ${m && m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy" decoding="async">` : `<span class="is-fallback" data-thumb="${esc(it.eps[0].id)}"><span class="cover-glyph">${esc([...t.trim()][0] || '·')}</span></span>`}
      ${isNew ? '<span class="tile-badge">Nueva</span>' : ''}
      ${langChip(langsOf(it.eps))}
      ${plan.pct && !plan.seen ? `<span class="tile-bar"><span style="width:${plan.pct}%"></span></span>` : ''}
    </span>
    <span class="shelf-title">${esc(t)}</span>
    ${sub ? `<span class="shelf-sub">${esc(sub)}</span>` : ''}
  </a></li>`;
}

function renderShelf(s, si) {
  setTint(seriesColor(s));
  const fresh = new Set(newEpisodes(s).map((e) => e.id));
  const items = shelfItems(s);
  app.innerHTML = header(esc(s.name)) + `<main class="shelf-main">
    <p class="dim shelf-count">${plural(items.length, 'película', 'películas')}</p>
    <ul class="shelf" role="list">${items.map((x) => moviePosterHTML(s, si, x, fresh)).join('')}</ul>
  </main>`;
  if (fresh.size) { markSeriesSeen(s); lastNew = null; announceNew(); }
}

function renderMovie(arg) {
  const lib = state.library;
  const cut = arg.indexOf('/');
  const si = Number(arg.slice(0, cut));
  const key = arg.slice(cut + 1);
  const s = lib && lib.series && lib.series[si];
  const it = s && isCollection(s) ? collectionItems(s).find((x) => x.key === key) : null;
  if (!it) { go(s ? '#/serie/' + si : '#/'); return; }
  heroSi = si;
  const m = itemMeta(s, it.key);
  const t = movieTitle(s, it);
  const plan = moviePlan(it);
  const syn = synopsisOf(m);
  const pending = it.eps.filter((e) => !state.saved.has(e.id));
  const busy = it.eps.some((e) => state.dls[e.id] || state.queue.some((q) => q.ep.id === e.id));
  const dur = (prog(plan.ep) || {}).d;
  const chip = (label, params) => `<a class="fact" href="#/catalogo?${new URLSearchParams(params)}">${esc(label)}</a>`;
  const facts = factRows(
    [dur ? `<span>${Math.round(dur / 60)} min</span>` : '', it.eps.length > 1 ? `<span>${it.eps.length} partes</span>` : '', langsOf(it.eps).length ? `<span>${esc(langText(langsOf(it.eps)))}</span>` : ''].join(''),
    m,
    [m && m.year ? chip(m.year, { y: m.year }) : '', chip('Película', { f: 'Película' }), ...((m && m.genres) || []).slice(0, 3).map((g) => chip(g, { g }))].join(''),
  );
  const later = isLater(s, it.key);
  setTint((m && m.color) || seriesColor(s));
  app.innerHTML = header('', { overlay: true }) + `<div class="tv is-series is-movie">
    <div class="series-wash" aria-hidden="true">${m && m.cover ? `<img src="${esc(m.cover)}" alt="">` : ''}</div>
    <main class="tv-main series-main">
      <section class="series-hero ${m && m.banner ? 'has-banner' : ''}">
        ${m && m.banner ? `<div class="banner"><img src="${esc(m.banner)}" alt="" decoding="async"></div>` : ''}
        <div class="series-top">
          ${m && m.cover ? `<img class="poster" src="${esc(m.cover)}" alt="" decoding="async">` : `<span class="poster is-thumb" data-thumb="${esc(it.eps[0].id)}"></span>`}
          <div class="series-info">
            <h2 class="tv-title">${esc(t)}</h2>
            ${m && m.title && m.title.toLowerCase() !== t.toLowerCase() ? `<p class="tv-alt">${esc(m.title)}${m.native ? ` <span lang="ja">${esc(m.native)}</span>` : ''}</p>` : ''}
            ${facts}
          </div>
        </div>
        ${syn ? `<p class="tv-synopsis is-long" id="synopsis">${esc(syn)}</p>` : ''}
        ${m && !hasSpanish(m) && m.synopsis && canTranslate() ? `<button class="link-btn" data-act="translate" data-key="${esc(it.key)}">Traducir sinopsis al español</button>` : ''}
        <div class="tv-actions">
          <a class="tv-btn is-primary" href="#/play/${encodeURIComponent(plan.ep.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>
          ${busy ? `<span class="tv-btn is-quiet">${ICON.queued}<span>Descargando…</span></span>`
            : pending.length ? `<button class="tv-btn" data-act="movie-dl" data-si="${si}" data-key="${esc(it.key)}">${ICON.down}<span>Descargar</span></button>`
            : `<span class="tv-btn is-quiet">${ICON.saved}<span>Descargada</span></span>`}
          <button class="tv-btn ${later ? 'is-on' : ''}" data-act="later-item" data-si="${si}" data-key="${esc(it.key)}" aria-pressed="${later}">${later ? ICON.laterOn : ICON.later}<span>Más tarde</span></button>
          ${langSwitchHTML(s, langsOf(it.eps).length > 1 ? langsOf(it.eps) : null)}
        </div>
      </section>
      ${it.eps.length > 1 ? `<section class="ep-section">
        <div class="ep-head"><h3 class="ep-heading">Partes</h3></div>
        <ol class="episodes is-grid" id="season-eps">${it.eps.map((ep) => episodeRow(ep, { next: ep.id === plan.ep.id && !plan.seen })).join('')}</ol>
      </section>` : ''}
    </main>
  </div>`;
}

/* ── selección de varios capítulos de una temporada para descargarlos juntos ── */

let picking = null; // { si, ki, ids: Set } mientras se eligen capítulos

function pickSeason() {
  const s = picking && state.library && state.library.series[picking.si];
  if (!s) return null;
  return isCollection(s) ? { episodes: s.all } : s.seasons[picking.ki] || null;
}
/** Se puede elegir lo que no está descargado ni en camino. */
const pickable = (ep) => !state.saved.has(ep.id) && !state.dls[ep.id] && !state.queue.some((q) => q.ep.id === ep.id);

function startPicking() {
  const s = state.library && state.library.series[heroSi];
  if (!s) return;
  const ki = Number(route().arg.split('/')[1]) || 0;
  picking = { si: heroSi, ki: Math.min(ki, s.seasons.length - 1), ids: new Set() };
  paintPick();
}
function endPicking(repaint = true) {
  picking = null;
  document.documentElement.classList.remove('is-picking');
  if (repaint) paintPick();
}

function paintPick() {
  const on = !!picking;
  document.documentElement.classList.toggle('is-picking', on);
  const list = $('#season-eps');
  const bar = $('#pick-bar');
  const btn = $('#pick-toggle');
  if (!list || !bar) return;
  list.classList.toggle('is-picking', on);
  if (btn) {
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-on', on);
    btn.querySelector('span').textContent = on ? 'Cancelar' : 'Seleccionar';
  }
  bar.hidden = !on;
  list.querySelectorAll('.ep').forEach((li) => {
    const ep = epById(li.dataset.id);
    const picked = on && picking.ids.has(li.dataset.id);
    li.classList.toggle('is-picked', picked);
    li.classList.toggle('is-unpickable', on && !!ep && !pickable(ep));
    const a = li.querySelector('.ep-main');
    if (on) { a.setAttribute('role', 'checkbox'); a.setAttribute('aria-checked', String(picked)); } else { a.removeAttribute('role'); a.removeAttribute('aria-checked'); }
  });
  if (!on) return;
  const eps = [...picking.ids].map(epById).filter(Boolean);
  const size = eps.reduce((a, e) => a + (e.size || 0), 0);
  $('#pick-count').textContent = eps.length ? `${plural(eps.length, 'capítulo', 'capítulos')}, ${fmtSize(size)}` : 'Toca los capítulos que quieras';
  bar.querySelector('[data-act="pick-dl"]').disabled = !eps.length;
  const season = pickSeason();
  const all = season ? season.episodes.filter(pickable) : [];
  bar.querySelector('[data-act="pick-all"]').textContent = all.length && all.every((e) => picking.ids.has(e.id)) ? 'Ninguno' : 'Todos';
}

function pickAction(act) {
  const season = pickSeason();
  if (!picking || !season) return;
  const avail = season.episodes.filter(pickable);
  if (act === 'pick-all') {
    const allOn = avail.length && avail.every((e) => picking.ids.has(e.id));
    picking.ids = allOn ? new Set() : new Set(avail.map((e) => e.id));
  } else if (act === 'pick-unseen') {
    picking.ids = new Set(avail.filter((e) => !(prog(e) || {}).w).map((e) => e.id));
    if (!picking.ids.size) toast('No hay capítulos sin ver para descargar en esta temporada.');
  } else if (act === 'pick-dl') {
    const s = state.library.series[picking.si];
    const eps = season.episodes.filter((e) => picking.ids.has(e.id) && pickable(e)); // en el orden de la temporada
    if (!navigator.onLine) { toast('Necesitas conexión para descargar.'); return; }
    eps.forEach((e) => queueDownload(e, s.name));
    if (eps.length) toast(`${plural(eps.length, 'capítulo', 'capítulos')} en cola de descarga.`);
    endPicking();
    return;
  }
  paintPick();
}

// en modo selección, tocar un capítulo lo marca en vez de abrirlo
// cambiar de temporada (anterior, siguiente, al menú) no deja una entrada más en el historial
app.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-replace]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  navReplacing = true;
  location.replace(a.getAttribute('href'));
});
app.addEventListener('click', (e) => {
  if (!picking) return;
  const li = e.target.closest('#season-eps.is-picking .ep');
  if (!li) return;
  e.preventDefault();
  e.stopPropagation();
  const ep = epById(li.dataset.id);
  if (!ep) return;
  if (!pickable(ep)) { toast(state.saved.has(ep.id) ? 'Ya está descargado.' : 'Ya se está descargando.'); return; }
  if (picking.ids.has(ep.id)) picking.ids.delete(ep.id); else picking.ids.add(ep.id);
  paintPick();
}, true);

function nextFor(s) {
  const c = continueList().find((x) => x.series === s);
  if (c) return c.ep;
  if (s.all.every((e) => (prog(e) || {}).w)) return null;
  return s.all.find((e) => !(prog(e) || {}).w) || s.all[0];
}

function episodeStatus(ep) {
  const p = prog(ep);
  if (p && p.w) return `<span class="ep-seen">${ICON.check}Visto</span>`;
  if (p && p.t > 5) return `${fmtTime(p.t)} de ${fmtTime(p.d)}`;
  return 'Sin ver';
}

function dlButton(ep) {
  const t = state.dls[ep.id];
  if (t) {
    const pct = Math.max(2, Math.min(100, Math.round((t.loaded / t.total) * 100)));
    return `<button class="dl is-busy" data-act="dl" style="--p:${pct}" aria-label="Descargando ${pct}%. Toca para cancelar"><span class="dl-pct">${pct}</span></button>`;
  }
  if (state.queue.some((q) => q.ep.id === ep.id)) return `<button class="dl is-queued" data-act="dl" aria-label="En cola. Toca para cancelar">${ICON.queued}</button>`;
  if (state.saved.has(ep.id)) return `<button class="dl is-saved" data-act="dl" aria-label="Descargado. Toca para quitarlo del dispositivo">${ICON.saved}</button>`;
  return `<button class="dl" data-act="dl" aria-label="Descargar para ver sin conexión">${ICON.down}</button>`;
}

function episodeRow(ep, { current = false, extra = '', fresh = false, next = false } = {}) {
  const art = episodeArt(ep);
  const e = index.byId.get(ep.id);
  const movie = !!e && isCollection(state.library.series[e.si]);
  const p = prog(ep);
  const pct = p && p.d ? (p.w ? 100 : Math.min(100, (p.t / p.d) * 100)) : 0;
  const seen = !!(p && p.w);
  // en una temporada con los dos idiomas, el capítulo que solo existe en el otro se marca
  const sr = e && state.library.series[e.si];
  const only = sr && sr.seasons[e.ki] && sr.seasons[e.ki].langs && ep.lang && !index.twins.has(ep.path) && ep.lang !== langPref(sr) ? `Solo ${ep.lang === 'sub' ? 'sub' : 'doblado'}` : '';
  const status = current ? '<span class="ep-now"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>Reproduciendo</span>'
    : next && !seen ? `<span class="ep-next">${p && p.t > 5 ? `Seguir en ${fmtTime(p.t)}` : 'A continuación'}</span>`
    : episodeStatus(ep);
  return `<li class="ep ${seen ? 'is-seen' : ''} ${current ? 'is-current' : ''} ${next ? 'is-next' : ''}" data-id="${esc(ep.id)}">
    <a class="ep-main" href="#/play/${encodeURIComponent(ep.id)}" ${current ? 'aria-current="true"' : ''}>
      <span class="ep-thumb ${art ? 'has-img is-art' : ''}" ${!art && ep.fa ? `data-thumb="${esc(ep.id)}"` : ''}>
        ${art ? `<img src="${esc(art)}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="ep-num" aria-hidden="true">${movie ? '' : ep.ep != null ? esc(ep.ep) : '·'}</span>
        <span class="ep-flags">${only ? `<span class="ep-new is-lang">${only}</span>` : ''}${fresh ? '<span class="ep-new">Nuevo</span>' : ''}${state.saved.has(ep.id) ? `<span class="ep-flag" title="Descargado">${ICON.saved}</span>` : ''}${seen ? `<span class="ep-flag is-seen" title="Visto">${ICON.check}</span>` : ''}</span>
        ${codecTagHTML(ep)}
        <span class="ep-play" aria-hidden="true">${ICON.play}</span>
        ${pct ? `<span class="mini-bar"><span style="width:${pct}%"></span></span>` : ''}
      </span>
      <span class="ep-text">
        <span class="ep-title">${esc(episodeLabel(ep))}</span>
        <span class="ep-sub">${status}${extra}</span>
      </span>
    </a>
    <span class="ep-tools">
      ${dlButton(ep)}
      <button class="icon-btn ep-more" data-act="more" aria-label="Más opciones">${ICON.more}</button>
    </span>
  </li>`;
}

/* Las imágenes aparecen con un fundido solo la primera vez que se cargan. Al redibujar una página (o volver a
 * ella) las que ya estaban cargadas se muestran de una vez: si no, todas parpadeaban en cada cambio. */
const seenImgs = new Set();
function settleImages(root) {
  for (const img of root.querySelectorAll ? root.querySelectorAll('img') : []) {
    if (seenImgs.has(img.src) || (img.complete && img.naturalWidth)) {
      // ya cargada: sin fundido y dibujada en el mismo instante (sin el cuadro vacío de la carga diferida)
      img.classList.add('no-fade'); img.decoding = 'sync'; img.loading = 'eager'; seenImgs.add(img.src);
    }
    else img.addEventListener('load', () => seenImgs.add(img.src), { once: true });
  }
}
new MutationObserver((list) => {
  for (const m of list) for (const n of m.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.tagName === 'IMG') settleImages(n.parentNode || n); else settleImages(n);
  }
}).observe(document.body, { childList: true, subtree: true });

function paintEpisode(id) {
  const ep = epById(id);
  if (!ep) return;
  document.querySelectorAll(`.ep[data-id="${CSS.escape(id)}"] [data-act="dl"]`).forEach((btn) => { btn.outerHTML = dlButton(ep); });
  const wd = document.querySelector(`[data-act="w-dl"][data-id="${CSS.escape(id)}"]`);
  if (wd) wd.outerHTML = watchDlButton(ep);
}

/* ── explorar MEGA ── */

function renderExplorer(arg) {
  const st = state.storage;
  if (!st) {
    app.innerHTML = header('Explorar') + `<main><section class="empty">
      <p class="dim">${navigator.onLine ? 'Conectando con MEGA…' : 'Explorar necesita conexión. Lo que descargaste está en Descargados.'}</p>
      ${navigator.onLine ? '' : '<a class="btn" href="#/descargas">Ver descargados</a>'}</section></main>`;
    return;
  }
  let node = (arg && st.files[arg]) || st.root;
  if (!node.directory) node = node.parent || st.root;
  const crumbs = [];
  for (let n = node; n; n = n.parent) crumbs.unshift(n);
  const kids = visibleChildren(node).filter((c) => !c.name.startsWith('.'));
  const folders = kids.filter((c) => c.directory).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  const here = nodePath(node);
  const videos = sortEpisodes(kids.filter(isPlayable).map((f) => index.byId.get(f.nodeId)?.ep || makeEpisode(f, here, kids)));
  videos.forEach((v) => { if (!index.byId.has(v.id)) knownEps.set(v.id, v); });
  const others = kids.filter((c) => !c.directory && !isPlayable(c)).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  const isRoot = node === st.root;
  const isLibrary = state.library && state.library.rootId === node.nodeId;

  app.innerHTML = header('Explorar') + `<main class="explorer">
    <nav class="crumbs" aria-label="Ubicación">${crumbs.map((n, i) => i === crumbs.length - 1
      ? `<span aria-current="page">${esc(n === st.root ? 'Mi MEGA' : n.name)}</span>`
      : `<a href="#/explorar/${encodeURIComponent(n.nodeId)}">${esc(n === st.root ? 'Mi MEGA' : n.name)}</a>`).join('<span class="crumb-sep" aria-hidden="true">/</span>')}</nav>
    ${!isRoot ? `<div class="explorer-actions">${isLibrary
      ? '<p class="dim">Esta es tu carpeta de series.</p>'
      : `<button class="btn" data-act="set-root" data-id="${esc(node.nodeId)}">Usar como carpeta de series</button>`}</div>` : ''}
    ${!kids.length ? '<p class="empty dim">Carpeta vacía.</p>' : ''}
    ${folders.length ? `<ul class="files">${folders.map((f) => {
      const n = visibleChildren(f).filter((c) => !c.name.startsWith('.')).length;
      return `<li><a class="file-row" href="#/explorar/${encodeURIComponent(f.nodeId)}">
        <span class="file-icon">${ICON.folder}</span>
        <span class="file-text"><span class="file-name">${esc(f.name)}</span><span class="file-meta">${plural(n, 'elemento', 'elementos')}</span></span>
      </a></li>`;
    }).join('')}</ul>` : ''}
    ${videos.length ? `<ol class="episodes">${videos.map((ep) => episodeRow(ep)).join('')}</ol>` : ''}
    ${others.length ? `<ul class="files is-dim">${others.map((f) => `<li class="file-row">
        <span class="file-icon">${ICON.file}</span>
        <span class="file-text"><span class="file-name">${esc(f.name)}</span><span class="file-meta">${isSubtitleName(f.name) ? 'Subtítulos, ' : ''}${fmtSize(f.size || 0)}</span></span>
      </li>`).join('')}</ul>` : ''}
  </main>`;
}

/* ── descargados ── */

async function renderDownloads() {
  if (!app.querySelector('main.downloads')) app.innerHTML = header('Descargados') + '<main class="downloads"></main>';
  const metas = [...(await refreshSaved()).values()].filter((m) => m.ep || index.byId.get(m.id));
  if (route().view !== 'descargas') return;
  for (const m of metas) if (!m.ep) m.ep = index.byId.get(m.id).ep;
  metas.forEach((m) => { if (!index.byId.has(m.id)) knownEps.set(m.id, m.ep); });
  const groups = new Map();
  for (const m of metas) {
    const t = m.title || titleFor(m.ep) || 'Otros';
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(m.ep);
  }
  const total = metas.filter((m) => m.done).reduce((a, m) => a + (m.size || 0), 0);
  const folderN = metas.filter((m) => m.done && m.where === 'folder').length;
  const dir = await getDir();
  const perm = dir ? await dirPermission(dir) : '';
  let free = '';
  try {
    const est = await navigator.storage.estimate();
    if (est.quota) free = `, quedan ${fmtSize(Math.max(0, est.quota - est.usage))} disponibles`;
  } catch { /* nada */ }
  if (route().view !== 'descargas') return;
  app.innerHTML = header('Descargados') + `<main class="downloads">
    ${metas.length ? `<p class="dim downloads-sum">${plural(state.saved.size, 'capítulo', 'capítulos')} en este dispositivo, ${fmtSize(total)}${folderN ? ` (${folderN === state.saved.size ? 'todos' : folderN} en tu carpeta${dir ? ` «${esc(dir.name)}»` : ''})` : ''}${free}.</p>` : ''}
    ${dir && perm === 'prompt' ? '<p class="downloads-sum"><button class="btn btn-lamp" data-act="dir-grant">Permitir acceso a tu carpeta de descargas</button></p>' : ''}
    ${!metas.length ? `<section class="empty"><p>No hay capítulos descargados.</p>
      <p class="dim">Toca la flecha junto a un capítulo para verlo sin conexión.</p></section>` : ''}
    ${[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([t, eps]) => `<section class="block">
      <h3 class="group-title">${esc(t)}</h3>
      <ol class="episodes">${sortEpisodes(eps).map((ep) => episodeRow(ep)).join('')}</ol>
    </section>`).join('')}
    ${metas.length ? '<button class="btn btn-quiet" data-act="clear-dl">Quitar todas las descargas</button>' : ''}
  </main>`;
  paintSync();
  hydrateThumbs(app);
}

/* ── ajustes ── */

function renderSettings() {
  const s = state.settings;
  const unread = hasUnreadNews();
  LS.set(pkey('newsUnread'), false);
  paintNewsDot();
  app.innerHTML = header('Ajustes') + `<main class="settings">
    <section class="settings-group is-first ${unread ? 'has-news' : ''}" id="news">${newsHTML()}</section>
    <section class="settings-group">
      <p class="settings-label">Apariencia</p>
      <div class="segmented" role="group" aria-label="Tema">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<button class="seg ${s.theme === v ? 'is-on' : ''}" data-act="set-theme" data-v="${v}" aria-pressed="${s.theme === v}">${l}</button>`).join('')}</div>
      <p class="settings-label">Tono del modo claro</p>
      <div class="segmented" role="group" aria-label="Tono del modo claro">${Object.entries(TONES).map(([v, o]) => `<button class="seg ${(s.tone || 'blanco') === v ? 'is-on' : ''}" data-act="set-tone" data-v="${v}" aria-pressed="${(s.tone || 'blanco') === v}">${o.label}</button>`).join('')}</div>
      <p class="settings-label">Tono del modo oscuro</p>
      <div class="segmented" role="group" aria-label="Tono del modo oscuro">${Object.entries(DARK_TONES).map(([v, o]) => `<button class="seg ${(s.darkTone || 'negro') === v ? 'is-on' : ''}" data-act="set-dark-tone" data-v="${v}" aria-pressed="${(s.darkTone || 'negro') === v}">${o.label}</button>`).join('')}</div>
      <p class="dim settings-hint">El tono claro se usa con el tema Claro y el oscuro con el tema Oscuro; en Automático, cada uno según la hora del sistema.</p>
    </section>
    <section class="settings-group" id="cine-key">${cineKeyHTML()}</section>
    <section class="settings-group">
      <p class="settings-label">Carpeta de series</p>
      <p class="settings-value">${esc(s.root)}</p>
      <a class="btn" href="#/explorar${state.library && state.library.rootId ? '/' + encodeURIComponent(state.library.rootId) : ''}">Cambiar carpeta</a>
    </section>
    <form id="settings" class="form settings-group">
      <label class="switch"><input type="checkbox" name="autoplay" ${s.autoplay ? 'checked' : ''}><span>Reproducir el siguiente capítulo solo</span></label>
      <label class="switch"><input type="checkbox" name="autoSkip" ${s.autoSkip ? 'checked' : ''}><span>Saltar intros solo cuando Kai sepa dónde están</span></label>
      <label class="switch"><input type="checkbox" name="cat" ${s.cat !== false ? 'checked' : ''}><span>Kai, el gatito, en el inicio</span></label>
      <label class="switch"><input type="checkbox" name="prefetchNext" ${s.prefetchNext !== false ? 'checked' : ''}><span>Preparar el siguiente capítulo para que empiece sin espera (usa unos 3 MB de MEGA)</span></label>
    </form>
    <section class="settings-group" id="dl-where">${downloadsWhereHTML()}</section>
    <section class="settings-group" id="seen-all">
      <p class="settings-label">Visto por todos</p>
      <p class="dim">Capítulos que ya terminaron todos los perfiles. Es solo un aviso, por si quieres liberar espacio en MEGA; Kai no borra nada.</p>
      <div id="seen-all-list"></div>
      <button class="btn" data-act="seen-all">${ICON.refresh}<span>Revisar</span></button>
    </section>
    <section class="settings-group">
      <p class="dim" id="space">Calculando espacio…</p>
      <p class="dim">${esc(quotaText(true))}</p>
      <div class="btn-row">
        <button class="btn" data-act="sync-now">Sincronizar ahora</button>
        <a class="btn" href="#/descargas">Ver descargados</a>
      </div>
    </section>
    <section class="settings-group">
      <p class="settings-label">Versión</p>
      <p class="settings-value" id="app-version">…</p>
      <button class="btn" data-act="check-update" id="check-update">${ICON.refresh}<span>${updateReady ? 'Actualizar ahora' : 'Buscar actualización'}</span></button>
    </section>
    <section class="settings-group">
      <p class="dim">Sesión de MEGA: ${esc((LS.get('session', {}).options || {}).email || '')}</p>
      <p class="dim">Datos de Kai en este navegador: ${(() => {
        const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
        const sizes = [];
        try { for (const k of Object.keys(localStorage)) if (k.startsWith('kai.')) sizes.push([k.slice(4), (localStorage.getItem(k) || '').length]); } catch { /* nada */ }
        const lib = LS.get('library', null);
        const libInfo = lib && lib.series ? ` · biblioteca guardada: ${lib.series.length} carpetas` : ' · sin biblioteca guardada';
        return kb(sizes.reduce((a, b) => a + b[1], 0)) + ' (' + sizes.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${esc(k)} ${kb(n)}`).join(', ') + ')' + libInfo;
      })()}${LS.full ? ' · <strong>sin espacio: algo no se pudo guardar</strong>' : LS.freed ? ' · se liberó espacio' : ''}</p>
      <button class="btn btn-quiet" data-act="logout">Cerrar sesión en este dispositivo</button>
    </section>
  </main>`;
  $('#settings').addEventListener('change', (e) => {
    const f = e.currentTarget;
    s.autoplay = f.autoplay.checked;
    s.autoSkip = f.autoSkip.checked;
    s.prefetchNext = f.prefetchNext.checked;
    s.cat = f.cat.checked;
    saveSettings();
  });
  paintSpace();
  paintDownloadsWhere();
  bindCineKey();
  swVersion().then((v) => { const el = $('#app-version'); if (el) el.textContent = v ? v.replace('kai-v', 'Kai ') : 'Sin instalar'; });
}

/** Ajustes → Cine: la clave de TMDB, guardada en tu MEGA (no en el código) para que todos tus dispositivos la usen. */
function cineKeyHTML(note = '') {
  const key = tmdbKey();
  const lib = state.library;
  const cine = lib && lib.series && lib.series.find(isCine);
  return `<p class="settings-label">Cine</p>
    <p class="dim">Películas que no son anime, en la carpeta <strong>${esc(state.settings.root)}/Cine</strong>, una subcarpeta por película (por ejemplo «El gigante de hierro (1999)»). No salen en el inicio: se abren con el botón Cine al final. Sus pósters y sinopsis vienen de TMDB.</p>
    ${key ? `<p class="settings-value">Clave de TMDB guardada (…${esc(key.slice(-4))})${cine ? '' : ' · todavía no hay carpeta Cine'}</p>
      <div class="btn-row"><button class="btn btn-quiet" data-act="tmdb-del">Quitar la clave</button></div>`
    : `<form class="form tmdb-form" id="tmdb-form" autocomplete="off">
        <label>Clave de la API de TMDB<input id="tmdb-key" name="k" type="password" spellcheck="false" autocapitalize="off" placeholder="Pega aquí tu clave"></label>
        <button class="btn" type="submit">Guardar</button>
      </form>`}
    ${note ? `<p class="dim" role="status">${esc(note)}</p>` : ''}`;
}
function paintCineKey(note) { const el = $('#cine-key'); if (el) { el.innerHTML = cineKeyHTML(note); bindCineKey(); } }
function bindCineKey() {
  const f = $('#tmdb-form');
  if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = f.k.value.trim();
    if (!v) return;
    f.querySelector('button').textContent = 'Revisando…';
    let ok;
    try { ok = await tmdbCheckKey(v); } catch { paintCineKey('Sin conexión con TMDB. Intenta de nuevo.'); return; }
    if (!ok) { paintCineKey('TMDB dice que esa clave no es válida. Copia la «Clave de la API» de themoviedb.org → Ajustes → API.'); return; }
    setTmdbKey(v);
    paintCineKey('Lista. Kai ya está buscando las fichas de tus películas de Cine.');
  });
}
function setTmdbKey(v) {
  state.shared.keys = { ...(state.shared.keys || {}), tmdb: { v, u: Date.now() } };
  saveShared();
  sync();
  setTimeout(ensureMeta, 500);
}

function downloadsWhereHTML(perm = '') {
  if (!canFolder) {
    return `<p class="settings-label">Descargas</p>
      <p class="settings-value">Dentro de la app</p>
      <p class="dim">Este navegador no deja que una página guarde en una carpeta (Chrome y Edge en computadora sí lo permiten). Si quieres el archivo aparte, toca ⋯ en un capítulo descargado y elige «Guardar copia en el dispositivo».</p>`;
  }
  const d = dirHandle;
  if (!d) {
    return `<p class="settings-label">Descargas</p>
      <p class="settings-value">Dentro de la app</p>
      <p class="dim">Puedes elegir una carpeta de este dispositivo: los capítulos quedarán ahí como MP4 normales, ordenados por serie y temporada.</p>
      <button class="btn" data-act="dir-pick">${ICON.folder}<span>Elegir carpeta</span></button>`;
  }
  return `<p class="settings-label">Descargas</p>
    <p class="settings-value">${ICON.folder} ${esc(d.name)}</p>
    <p class="dim">Cada capítulo queda como MP4 en <span class="mono">${esc(d.name)}/Serie/Temporada/</span>.${perm === 'prompt' ? ' Kai necesita que le vuelvas a dar permiso para usarla.' : ''}</p>
    <div class="btn-row">
      ${perm === 'prompt' ? '<button class="btn btn-lamp" data-act="dir-grant">Permitir acceso</button>' : ''}
      <button class="btn" data-act="dir-pick">Cambiar carpeta</button>
      <button class="btn" data-act="dir-off">Guardar dentro de la app</button>
    </div>`;
}
async function paintDownloadsWhere() {
  const d = await getDir();
  const perm = d ? await dirPermission(d) : '';
  const el = $('#dl-where');
  if (el) el.innerHTML = downloadsWhereHTML(perm);
}

async function paintSpace() {
  const el = $('#space');
  if (!el) return;
  const metas = await refreshSaved();
  const sum = (list) => list.reduce((a, m) => a + (m.size || 0), 0);
  const inApp = metas.filter((m) => m.done && m.where !== 'folder');
  const inFolder = metas.filter((m) => m.done && m.where === 'folder');
  const parts = [];
  if (inApp.length) parts.push(`${plural(inApp.length, 'capítulo', 'capítulos')} dentro de la app (${fmtSize(sum(inApp))})`);
  if (inFolder.length) parts.push(`${plural(inFolder.length, 'capítulo', 'capítulos')} en tu carpeta (${fmtSize(sum(inFolder))})`);
  let extra = '';
  try {
    const est = await navigator.storage.estimate();
    if (est.quota) extra = ` Espacio disponible para la app: ${fmtSize(Math.max(0, est.quota - est.usage))}.`;
  } catch { /* nada */ }
  try {
    let kept = await navigator.storage.persisted();
    if (!kept) kept = await navigator.storage.persist();
    extra += kept ? ' El sistema guarda las descargas de forma permanente.'
      : ' El sistema podría borrar las descargas si se queda sin espacio.';
  } catch { /* no soportado */ }
  if ($('#space')) $('#space').textContent = `${parts.length ? parts.join(' y ') + '.' : 'Ningún capítulo descargado.'}${extra}`;
}

/* ── hoja de opciones de un capítulo ── */

function openSheet(ep) {
  const sheet = $('#sheet');
  const p = prog(ep);
  const saved = state.saved.has(ep.id);
  const busy = !!state.dls[ep.id] || state.queue.some((q) => q.ep.id === ep.id);
  const ctx = resolveContext(ep.id);
  const upcoming = ctx ? nextUnseen(ep, ctx.list, 3).filter((x) => !state.saved.has(x.id)) : [];
  const ie = index.byId.get(ep.id);
  const series = ie ? state.library.series[ie.si] : null;
  const movie = series ? itemFor(series, ep) : null; // solo las películas de la colección
  sheet.innerHTML = `<div class="sheet-back" data-act="close"></div>
    <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${esc(episodeLabel(ep))}">
      <p class="sheet-title">${esc(episodeLabel(ep))}</p>
      <p class="sheet-sub">${esc(ep.name)}, ${fmtSize(ep.size)}</p>
      <button class="sheet-btn" data-act="toggle-seen">${p && p.w ? 'Marcar como no visto' : 'Marcar como visto'}</button>
      ${p && p.t > 5 && !p.w ? '<button class="sheet-btn" data-act="restart">Ver desde el principio</button>' : ''}
      ${saved || busy ? `<button class="sheet-btn" data-act="unsave">${busy ? 'Cancelar descarga' : 'Quitar del dispositivo'}</button>` : '<button class="sheet-btn" data-act="save">Descargar para ver sin conexión</button>'}
      ${upcoming.length ? `<button class="sheet-btn" data-act="save-next">Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}</button>` : ''}
      ${saved && (state.dlMeta.get(ep.id) || {}).where !== 'folder' ? '<button class="sheet-btn" data-act="export">Guardar copia en el dispositivo</button>' : ''}
      ${movie ? `<button class="sheet-btn" data-act="later-movie">${isLater(series, movie.key) ? 'Quitar de Más tarde' : 'Ver más tarde'}</button>` : ''}
      <button class="sheet-btn is-quiet" data-act="close">Cerrar</button>
    </div>`;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  sheet.querySelector('.sheet-btn').focus();
  sheet.onclick = async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    closeSheet();
    if (act === 'toggle-seen') {
      const now = prog(ep);
      setProgress(ep, now && now.w ? 0 : (now && now.d) || 0, (now && now.d) || 0, !(now && now.w));
      softRender(); sync();
    } else if (act === 'restart') {
      setProgress(ep, 0, (p && p.d) || 0, false);
      go('#/play/' + encodeURIComponent(ep.id));
    } else if (act === 'save') queueDownload(ep);
    else if (act === 'save-next') { upcoming.forEach((x) => queueDownload(x, ctx.title)); toast(`${plural(upcoming.length, 'capítulo', 'capítulos')} en cola de descarga.`); }
    else if (act === 'unsave') removeDownload(ep.id);
    else if (act === 'export') exportCopy(ep);
    else if (act === 'later-movie') setLater(series, movie.key, !isLater(series, movie.key));
  };
}
/* ── Descubrir: "Porque viste…" y "En emisión" ──
 * Con AniList: recomendaciones de las series que tienes en MEGA (las que ya viste pesan más) y lo que está
 * saliendo ahora con buena nota. Lo que ya tienes sale a color y lleva a su página; lo que no, en blanco y negro. */
const ANIMEAV1_SEARCH = (t) => 'https://animeav1.com/catalogo?search=' + encodeURIComponent(t);
// sube cuando cambia qué se muestra en Descubrir, para no enseñar una lista guardada con lo de antes
const DISCOVER_V = 2;
const discoverFresh = (d) => !!(d && d.v === DISCOVER_V && d.items && d.items.length);
const DISCOVER = {
  porque: { title: 'Porque viste…', ttl: 24 * 3600000 },
  emision: { title: 'En emisión', ttl: 6 * 3600000 },
};
/** Lo que tienes en MEGA, por id de AniList → a dónde lleva en Kai. */
function ownedIds() {
  const out = new Map();
  const lib = state.library;
  if (!lib || lib.v !== 2) return out;
  lib.series.forEach((s, si) => {
    if (isCine(s)) return;
    if (isCollection(s)) { for (const it of collectionItems(s)) { const m = itemMeta(s, it.key); if (m && m.id) out.set(m.id, movieHref(si, it.key)); } }
    else {
      const m = metaFor(s); if (m && m.id) out.set(m.id, '#/serie/' + si);
      for (const se of s.seasons) { const sm = seasonMeta(s, se); if (sm && sm.id) out.set(sm.id, '#/serie/' + si); }
    }
  });
  return out;
}
let discoverJob = null;
async function loadDiscover(kind, force = false) {
  const all = LS.get('discover', {}) || {};
  const cur = all[kind];
  if (!force && discoverFresh(cur) && Date.now() - cur.at < DISCOVER[kind].ttl) return cur;
  if (discoverJob) return discoverJob;
  discoverJob = (async () => {
    let items = [];
    if (kind === 'emision') {
      items = (await airingTop()).map(toDiscover);
    } else {
      // tus series de MEGA (sin repetir la misma ficha); las que ya empezaste a ver cuentan doble
      const lib = state.library;
      const src = new Map();
      if (lib && lib.v === 2) for (const s of lib.series) {
        if (isCollection(s)) continue;
        const m = metaFor(s);
        if (!m || !m.id) continue;
        const watched = s.all.some((e) => { const p = prog(e); return p && (p.w || p.t > 60); });
        src.set(m.id, { name: s.name, w: watched ? 2 : 1 });
      }
      const recs = await recommendationsFor([...src.keys()].slice(0, 40));
      const score = new Map();
      for (const [id, list] of Object.entries(recs)) {
        const from = src.get(Number(id));
        list.forEach(({ rating, media }, rank) => {
          if (src.has(media.id)) return; // no recomendar una serie que es la misma fuente
          const r = score.get(media.id) || { m: media, pts: 0, from: [] };
          r.pts += from.w * (1 + Math.log10(1 + Math.max(0, rating))) * (1 - rank * 0.05);
          r.from.push({ name: from.name, pts: from.w * (1 + Math.log10(1 + Math.max(0, rating))) });
          score.set(media.id, r);
        });
      }
      items = [...score.values()].sort((a, b) => b.pts - a.pts).slice(0, 30).map((r) => ({
        ...toDiscover(r.m), because: r.from.sort((a, b) => b.pts - a.pts).slice(0, 2).map((x) => x.name),
      }));
    }
    const out = { v: DISCOVER_V, at: Date.now(), items };
    const store = LS.get('discover', {}) || {};
    store[kind] = out;
    LS.set('discover', store);
    setTimeout(translateMissing, 1000);
    return out;
  })().finally(() => { discoverJob = null; });
  return discoverJob;
}
function airingIn(at) {
  const h = Math.round((at - Date.now()) / 3600000);
  if (h <= 0) return 'sale hoy';
  if (h < 24) return `en ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'mañana' : `en ${d} días`;
}
function discoverPosterHTML(x, owned, kind) {
  const href = owned.get(x.id);
  const sub = kind === 'emision'
    ? [x.next ? `Ep. ${x.next.ep} ${airingIn(x.next.at)}` : '', x.score ? `★ ${x.score}` : ''].filter(Boolean).join(' · ')
    : (x.because && x.because.length ? `Porque viste ${x.because.join(' y ')}` : (x.score ? `★ ${x.score}` : ''));
  const inner = `<span class="shelf-poster">
      ${x.cover ? `<img src="${esc(x.cover)}" alt="" loading="lazy" decoding="async">` : `<span class="is-fallback"><span class="cover-glyph">${esc([...(x.title || '·').trim()][0])}</span></span>`}
      ${href ? '<span class="tile-badge">En Kai</span>' : ''}
    </span>
    <span class="shelf-title">${esc(x.title)}</span>
    ${sub ? `<span class="shelf-sub">${esc(sub)}</span>` : ''}`;
  return href
    ? `<li><a class="shelf-item" href="${href}" style="--h:${hue(x.title)}">${inner}</a></li>`
    : `<li><button class="shelf-item is-gray" data-act="discover-open" data-id="${x.id}" style="--h:${hue(x.title)}">${inner}</button></li>`;
}
async function renderDiscover(kind) {
  if (!DISCOVER[kind]) kind = 'porque';
  const other = kind === 'porque' ? 'emision' : 'porque';
  app.innerHTML = header(DISCOVER[kind].title) + `<main class="shelf-main discover" data-kind="${kind}">
    <p class="dim shelf-count" id="disc-note">${kind === 'porque' ? 'Recomendaciones de AniList según lo que tienes en MEGA.' : 'Lo que está saliendo ahora y tiene buena nota en AniList.'}</p>
    <div id="disc-list"><p class="dim">Buscando en AniList…</p></div>
    <p class="discover-foot"><a class="tv-more" href="#/descubrir/${other}">${ICON.grid}<span>${DISCOVER[other].title}</span></a></p>
  </main>`;
  const paint = (d) => {
    const box = $('#disc-list');
    if (!box || route().view !== 'descubrir') return;
    const owned = ownedIds();
    if (!d.items.length) { box.innerHTML = `<p class="dim">${kind === 'porque' ? 'Todavía no hay recomendaciones: agrega series a MEGA y espera a que Kai encuentre sus fichas.' : 'AniList no devolvió nada ahora.'}</p>`; return; }
    box.innerHTML = `<ul class="shelf" role="list">${d.items.map((x) => discoverPosterHTML(x, owned, kind)).join('')}</ul>`;
  };
  const cached = (LS.get('discover', {}) || {})[kind];
  if (discoverFresh(cached)) paint(cached);
  try { paint(await loadDiscover(kind)); } catch (err) {
    const box = $('#disc-list');
    if (box && !discoverFresh(cached)) box.innerHTML = `<p class="dim">No se pudo consultar AniList (${esc(err.message || 'sin conexión')}). Intenta en un momento.</p>`;
  }
}
function openDiscoverSheet(id) {
  const all = LS.get('discover', {}) || {};
  const x = Object.values(all).flatMap((d) => (d && d.items) || []).find((y) => y.id === id);
  if (!x) return;
  const syn = (state.syn[x.id] && state.syn[x.id].es) || x.synopsis || '';
  const short = syn.length > 420 ? syn.slice(0, 400).replace(/\s+\S*$/, '') + '…' : syn;
  const facts = [x.year, x.format, x.episodes ? plural(x.episodes, 'capítulo', 'capítulos') : '', x.score ? `★ ${x.score}` : ''].filter(Boolean).join(' · ');
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-back" data-act="close"></div>
    <div class="sheet-panel discover-sheet" role="dialog" aria-modal="true" aria-label="${esc(x.title)}">
      <div class="discover-head">
        ${x.cover ? `<img class="discover-cover" src="${esc(x.cover)}" alt="">` : ''}
        <div><p class="sheet-title">${esc(x.title)}</p>
          <p class="sheet-sub">${esc(facts)}</p>
          ${x.genres.length ? `<p class="sheet-sub">${esc(x.genres.slice(0, 4).join(', '))}</p>` : ''}
          ${x.next ? `<p class="sheet-sub">Capítulo ${x.next.ep} ${airingIn(x.next.at)}</p>` : ''}</div>
      </div>
      ${short ? `<p class="discover-syn">${esc(short)}</p>` : ''}
      <a class="sheet-btn" href="${ANIMEAV1_SEARCH(x.romaji || x.title)}" target="_blank" rel="noopener">Buscar en animeav1</a>
      <a class="sheet-btn" href="https://anilist.co/anime/${x.id}" target="_blank" rel="noopener">Ver en AniList</a>
      <button class="sheet-btn is-quiet" data-act="close">Cerrar</button>
    </div>`;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  sheet.onclick = (e) => { if (e.target.closest('[data-act="close"]') || e.target.closest('a.sheet-btn')) closeSheet(); };
}

function closeSheet() {
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  sheet.classList.remove('is-open');
  setTimeout(() => { sheet.hidden = true; sheet.innerHTML = ''; }, 180);
}

/* ───────────────────────── página de reproducción ───────────────────────── */

const stage = $('#stage');
const parking = $('#stage-parking');
const video = $('#video');
let playing = null;

function watchDlButton(ep) {
  const t = state.dls[ep.id];
  const queued = state.queue.some((q) => q.ep.id === ep.id);
  const label = t ? `Descargando ${Math.round((t.loaded / t.total) * 100)}%` : queued ? 'En cola' : state.saved.has(ep.id) ? 'Descargado' : 'Descargar';
  const icon = t || queued ? ICON.queued : state.saved.has(ep.id) ? ICON.saved : ICON.down;
  return `<button class="btn ${state.saved.has(ep.id) ? 'is-saved' : ''}" data-act="w-dl" data-id="${esc(ep.id)}">${icon}<span>${label}</span></button>`;
}

function renderWatch(id) {
  const ctx = resolveContext(id);
  // ver un capítulo cuenta como haber visto lo nuevo de esa serie (si no, la burbuja seguía en el inicio)
  const ws = ctx && ctx.si != null && state.library && state.library.series[ctx.si];
  if (ws && newEpisodes(ws).length) { markSeriesSeen(ws); lastNew = null; }
  if (!ctx) {
    if (LS.get('session', null) && (state.connecting || !state.library)) {
      app.innerHTML = header('') + '<main><section class="empty"><p class="dim">Cargando…</p></section></main>';
    } else go('#/');
    return;
  }
  const same = playing && playing.ep.id === id && stage.isConnected && app.contains(stage);
  if (!same) {
    leaveMini();
    parkStage();
    app.innerHTML = header('') + `<main class="watch">
      <div class="watch-grid">
        <div class="watch-main">
          <div class="stage-slot" id="stage-slot"></div>
          <div class="watch-info" id="watch-info"></div>
        </div>
        <aside class="watch-list" id="watch-list"></aside>
      </div>
    </main>`;
    $('#stage-slot').appendChild(stage);
    stage.hidden = false;
    if (!playing || playing.ep.id !== id) startPlayback(ctx);
    else playing.ctx = ctx;
  }
  paintWatchInfo();
}

function paintWatchInfo() {
  if (!playing || route().view !== 'play') return;
  const ctx = resolveContext(playing.ep.id) || playing.ctx;
  playing.ctx = ctx;
  const ep = playing.ep;
  const i = ctx.list.findIndex((x) => x.id === ep.id);
  const prev = ctx.list[i - 1];
  const next = ctx.list[i + 1];
  const upcoming = nextUnseen(ep, ctx.list, 3).filter((x) => !state.saved.has(x.id) && !state.dls[x.id]);
  const info = $('#watch-info');
  if (!info) return;
  info.innerHTML = `<div class="watch-text">
      <a class="watch-series" href="${ctx.back}">${esc(ctx.title)}</a>
      <h2 class="watch-title">${esc(episodeLabel(ep))}</h2>
      ${ctx.sub ? `<p class="watch-sub">${esc(ctx.sub)}</p>` : ''}
    </div>
    <div class="watch-actions">
      ${prev ? `<a class="btn" href="#/play/${encodeURIComponent(prev.id)}" data-replace>${ICON.prev}<span>Anterior</span></a>` : ''}
      ${next ? `<a class="btn" href="#/play/${encodeURIComponent(next.id)}" data-replace><span>Siguiente</span>${ICON.next}</a>` : ''}
      ${watchDlButton(ep)}
      ${upcoming.length ? `<button class="btn" data-act="w-dl-next">${ICON.down}<span>Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}</span></button>` : ''}
      <button class="icon-btn" data-act="w-more" aria-label="Más opciones">${ICON.more}</button>
    </div>`;
  const list = $('#watch-list');
  const nextUp = ctx.list[i + 1];
  const done = ctx.shown.filter((x) => (prog(x) || {}).w).length;
  list.innerHTML = `<div class="wl-head"><h3 class="wl-title">${esc(ctx.sub || ctx.title)}</h3><span class="wl-count">${done} de ${ctx.shown.length} vistos</span></div>
    <ol class="episodes is-compact">${ctx.shown.map((x) => episodeRow(x, { current: x.id === ep.id, next: nextUp && x.id === nextUp.id })).join('')}</ol>`;
  hydrateThumbs(list);
  const cur = list.querySelector('.is-current');
  if (cur && list.scrollHeight > list.clientHeight) cur.scrollIntoView({ block: 'nearest' });
}

function parkStage() {
  if (stage.parentElement !== parking) parking.appendChild(stage);
}

/* ───────────────────────── motor del reproductor ───────────────────────── */

const ui = {
  big: $('#st-big'), play: $('#st-play'), chapter: $('#st-chapter'), lights: $('#st-lights'), seek: $('#st-seek'), time: $('#st-time'),
  speed: $('#st-speed'), pip: $('#st-pip'), fs: $('#st-fs'), mute: $('#st-mute'), next: $('#st-next'),
  skip: $('#st-skip'), menu: $('#st-menu'), flash: $('#st-flash'), nextCard: $('#p-next'), msg: $('#p-msg'), tap: $('#st-tap'),
};
let speed = 1;
let idleTimer;
let nextTimer;
let seeking = false;

async function startPlayback(ctx) {
  if (playing) finishCurrent();
  clearTimeout(nextTimer);
  const ep = ctx.ep;
  const token = { ep, ctx, objectUrl: null, lastSaved: 0, lastSync: Date.now(), recover: [], source: null, chapters: [], autoSkipped: false, learned: false, undo: null, offer: null };
  playing = token;
  ui.msg.hidden = true;
  ui.nextCard.hidden = true;
  closeMenu();
  resetChapters();
  $('#st-marks').innerHTML = '';
  stage.classList.add('is-loading');
  stage.classList.remove('is-ended');
  video.removeAttribute('src');
  video.load();
  paintControls();

  let src = null;
  let localErr = null;
  const blob = await localBlob(ep, true).catch((err) => { localErr = err; return null; });
  if (playing !== token) return;
  if (blob) {
    src = token.objectUrl = URL.createObjectURL(blob);
    token.source = { blob };
  } else if (navigator.onLine) {
    try {
      src = await streamUrl(ep);
      token.source = { stream: true };
    } catch (err) {
      if (playing !== token) return;
      return playerMessage(err.message === 'NOSW'
        ? 'La app se está preparando. Recarga la página y vuelve a intentarlo.'
        : megaMessage(err));
    }
  } else if (localErr && localErr.message === 'NOFOLDER') {
    return playerMessage('Kai necesita permiso para abrir tu carpeta de descargas.', false, true);
  } else if (localErr && localErr.message === 'NOFILE') {
    return playerMessage('El archivo ya no está en tu carpeta de descargas.');
  } else {
    return playerMessage('Este capítulo no está descargado y no hay conexión.');
  }
  if (playing !== token) return;

  const p = prog(ep);
  const startAt = p && !p.w && p.t > 5 ? Math.max(0, p.t - 3) : 0;
  // #t= hace que el navegador empiece directo en ese punto, sin un salto aparte
  video.src = startAt ? `${src}#t=${startAt.toFixed(1)}` : src;
  video.addEventListener('loadedmetadata', () => {
    if (playing !== token) return;
    if (startAt && video.duration && startAt < video.duration - 2 && Math.abs(video.currentTime - startAt) > 2) video.currentTime = startAt;
    video.playbackRate = speed;
  }, { once: true });
  setMediaSession(ep, ctx);
  video.play().catch(() => { stage.classList.remove('is-loading'); paintControls(); });
  initChapters(ep, token);
}

async function streamUrl(ep) {
  if (!('serviceWorker' in navigator)) throw new Error('NOSW');
  if (!navigator.serviceWorker.controller) {
    await Promise.race([navigator.serviceWorker.ready, sleep(3000)]);
    await sleep(50);
    if (!navigator.serviceWorker.controller) throw new Error('NOSW');
  }
  const url = await downloadUrl(ep.id);
  const q = new URLSearchParams({ u: url, k: ep.key, s: String(ep.size), t: ep.mime, i: ep.id });
  return '__stream?' + q.toString();
}

function playerMessage(text, offerDownload = false, offerFolder = false, detail = '') {
  stage.classList.remove('is-loading');
  ui.msg.innerHTML = `<p>${esc(text)}</p>${detail ? `<p class="p-detail">${esc(detail)}</p>` : ''}<div class="btn-row">
    ${offerDownload ? '<button class="btn btn-lamp" data-act="p-dl">Descargar y ver</button>' : ''}
    ${offerFolder ? '<button class="btn btn-lamp" data-act="p-folder">Permitir acceso</button>' : ''}
    <a class="btn" href="${playing ? playing.ctx.back : '#/'}">Volver</a></div>`;
  ui.msg.hidden = false;
}

async function downloadThenPlay() {
  if (!playing) return;
  const { ep, ctx } = playing;
  ui.msg.innerHTML = '<p id="p-dl-status">Descargando…</p>';
  const tick = setInterval(() => {
    const t = state.dls[ep.id];
    const st = $('#p-dl-status');
    if (t && st) st.textContent = `Descargando… ${Math.round((t.loaded / t.total) * 100)}%`;
  }, 400);
  await downloadAndWait(ep, ctx.title);
  clearInterval(tick);
  if (!playing || playing.ep !== ep) return;
  if (state.saved.has(ep.id)) { playing = null; startPlayback(ctx); }
  else playerMessage('No se pudo descargar el capítulo.');
}

function setMediaSession(ep, ctx) {
  if (!('mediaSession' in navigator)) return;
  try {
    const meta = (art) => new MediaMetadata({ title: episodeLabel(ep), artist: ctx.title, album: 'Kai', artwork: art || [] });
    navigator.mediaSession.metadata = meta();
    thumbFor(ep).then((u) => {
      if (u && playing && playing.ep === ep) navigator.mediaSession.metadata = meta([{ src: u, sizes: '320x180', type: 'image/jpeg' }]);
    });
    const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* nada */ } };
    set('nexttrack', () => playNext());
    set('previoustrack', () => playPrev());
    set('seekbackward', () => seekBy(-10));
    set('seekforward', () => seekBy(10));
  } catch { /* nada */ }
}

function neighbor(delta) {
  if (!playing) return null;
  const list = playing.ctx.list;
  const i = list.findIndex((x) => x.id === playing.ep.id);
  return i >= 0 ? list[i + delta] || null : null;
}
function switchTo(ep) {
  if (!ep) return;
  const ctx = resolveContext(ep.id);
  if (!ctx) return;
  if (route().view === 'play') {
    history.replaceState(null, '', '#/play/' + encodeURIComponent(ep.id));
    lastRouteKey = 'play/' + ep.id;
    startPlayback(ctx);
    paintWatchInfo();
  } else {
    startPlayback(ctx); // sigue en el mini reproductor
    paintMini();
  }
}
function playNext() { const n = neighbor(1); if (n) switchTo(n); }
function playPrev() { const n = neighbor(-1); if (n) switchTo(n); }

function savePosition(force = false) {
  if (!playing || !video.duration || !isFinite(video.duration) || !video.currentSrc) return;
  const now = Date.now();
  if (!force && now - playing.lastSaved < 4000) return;
  playing.lastSaved = now;
  setProgress(playing.ep, video.currentTime, video.duration);
  markNow(playing.ep, video.currentTime, video.duration);
  if (force || now - playing.lastSync > 60000) {
    playing.lastSync = now;
    sync();
  }
}

function finishCurrent() {
  if (!playing) return;
  savePosition(true);
  const ep = playing.ep;
  if (playing.objectUrl) {
    const u = playing.objectUrl;
    setTimeout(() => URL.revokeObjectURL(u), 1500);
  }
}

function stopPlayback() {
  clearTimeout(nextTimer);
  if (document.body.classList.contains('lights-off')) setLights(false);
  if (playing) {
    video.pause();
    finishCurrent();
    playing = null;
  }
  resetChapters();
  closeMenu();
  if (isFullscreen()) exitFullscreen();
  if (video.getAttribute('src')) { video.removeAttribute('src'); video.load(); }
  stage.hidden = true;
  leaveMini();
  parkStage();
}

/* ── mini reproductor ── */

const mini = $('#mini');
function enterMini() {
  if (!playing) return;
  if (stage.classList.contains('kai-fs')) setKaiFullscreen(false);
  else if (isFullscreen()) exitFullscreen();
  if (document.body.classList.contains('lights-off')) setLights(false);
  closeMenu();
  const slot = $('#mini-slot');
  if (stage.parentElement !== slot) slot.prepend(stage);
  stage.classList.add('is-mini');
  stage.hidden = false;
  mini.hidden = false;
  document.documentElement.classList.add('has-mini');
  paintMini();
}
function leaveMini() {
  stage.classList.remove('is-mini');
  if (mini.hidden) return;
  mini.hidden = true;
  document.documentElement.classList.remove('has-mini');
}
function paintMini() {
  if (mini.hidden || !playing) return;
  $('#mini-title').textContent = episodeLabel(playing.ep);
  $('#mini-sub').textContent = playing.ctx.title || '';
  const t = $('#mini-toggle');
  t.innerHTML = video.paused ? ICON.play : ICON.pause;
  t.setAttribute('aria-label', video.paused ? 'Reproducir' : 'Pausar');
  const d = isFinite(video.duration) ? video.duration : 0;
  mini.style.setProperty('--mp', d ? (video.currentTime / d) * 100 + '%' : '0%');
}
['play', 'pause', 'timeupdate', 'loadedmetadata'].forEach((ev) => video.addEventListener(ev, paintMini));

// al volver de la ventana flotante del sistema con el botón "volver a la pestaña", regresa al reproductor grande
function backFromSystemPip() {
  setTimeout(() => {
    if (playing && !video.paused && route().view !== 'play') go('#/play/' + encodeURIComponent(playing.ep.id));
  }, 60);
}
video.addEventListener('leavepictureinpicture', backFromSystemPip);
video.addEventListener('webkitpresentationmodechanged', () => { if (video.webkitPresentationMode === 'inline') backFromSystemPip(); });

/* ── controles ── */

// se llama varias veces por segundo: solo toca el DOM cuando algo cambió
const painted = {};
function setOnce(key, value, apply) {
  if (painted[key] === value) return;
  painted[key] = value;
  apply(value);
}
function paintControls() {
  const paused = video.paused;
  setOnce('play', paused, (v) => {
    ui.play.innerHTML = v ? ICON.play : ICON.pause;
    ui.play.setAttribute('aria-label', v ? 'Reproducir' : 'Pausar');
    stage.classList.toggle('is-paused', v);
  });
  const d = isFinite(video.duration) ? video.duration : 0;
  const t = seeking ? Number(ui.seek.value) : video.currentTime;
  ui.seek.max = String(d || 0);
  if (!seeking) ui.seek.value = String(t || 0);
  let buf = 0;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= t + 0.5) buf = Math.max(buf, video.buffered.end(i));
  }
  stage.style.setProperty('--played', d ? (t / d) * 100 + '%' : '0%');
  stage.style.setProperty('--buffered', d ? (buf / d) * 100 + '%' : '0%');
  setOnce('time', `${fmtTime(t)} / ${fmtTime(d)}`, (v) => { ui.time.textContent = v; });
  setOnce('next', !neighbor(1), (v) => { ui.next.hidden = v; });
  paintSkip(t, d);
  const ch = chapterAt(seeking ? t : video.currentTime);
  setOnce('chapter', ch && ch.title ? ch.title : '', (v) => { ui.chapter.textContent = v; });
  setOnce('mute', video.muted || video.volume === 0, (v) => {
    ui.mute.innerHTML = v
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  });
  setOnce('speed', speed === 1 ? '1×' : `${speed}×`, (v) => { ui.speed.textContent = v; });
  setOnce('fs', isFullscreen(), (v) => {
    ui.fs.setAttribute('aria-label', v ? 'Salir de pantalla completa' : 'Pantalla completa');
    stage.classList.toggle('is-fs', v);
  });
}

function wake() {
  stage.classList.remove('is-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!video.paused && ui.menu.hidden && !seeking) stage.classList.add('is-idle');
  }, 2800);
}

function togglePlay() {
  if (!video.currentSrc) return;
  if (video.paused) video.play().catch(() => {}); else video.pause();
}

function seekBy(s) {
  if (!video.duration) return;
  video.currentTime = Math.max(0, Math.min(video.duration - 0.5, video.currentTime + s));
  ui.flash.textContent = s > 0 ? `+${s} s` : `−${-s} s`;
  ui.flash.dataset.side = s > 0 ? 'right' : 'left';
  ui.flash.classList.remove('is-on');
  void ui.flash.offsetWidth;
  ui.flash.classList.add('is-on');
  wake();
}

const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement || stage.classList.contains('kai-fs'));
/* iPhone no deja poner en pantalla completa un elemento de la página, solo el reproductor
 * nativo de iOS, que tapa los controles y gestos de Kai. Ahí se usa una pantalla completa
 * propia: el reproductor ocupa toda la pantalla (sin barras si Kai está en la pantalla de inicio). */
function setKaiFullscreen(on) {
  stage.classList.toggle('kai-fs', on);
  // en el teléfono (sin girar la pantalla) el video horizontal se muestra girado; ver styles.css
  const wide = !video.videoWidth || video.videoWidth >= video.videoHeight;
  stage.classList.toggle('kai-rot', on && wide && matchMedia('(pointer: coarse)').matches);
  document.documentElement.classList.toggle('kai-fs-on', on);
  paintThemeColor();
  paintControls();
  wake();
}
function exitFullscreen() {
  if (stage.classList.contains('kai-fs')) { setKaiFullscreen(false); return; }
  const fn = document.exitFullscreen || document.webkitExitFullscreen;
  if (fn) fn.call(document).catch?.(() => {});
}
function toggleFullscreen() {
  if (isFullscreen()) { exitFullscreen(); return; }
  const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
  if (req) {
    Promise.resolve(req.call(stage)).then(() => {
      try { screen.orientation.lock('landscape').catch(() => {}); } catch { /* nada */ }
    }).catch(() => setKaiFullscreen(true));
  } else {
    setKaiFullscreen(true);
  }
}

async function togglePip() {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (video.requestPictureInPicture) await video.requestPictureInPicture();
    else if (video.webkitSetPresentationMode) video.webkitSetPresentationMode(video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
  } catch { toast('Este navegador no permite ventana flotante aquí.'); }
}

/* ── menú del reproductor: velocidad ── */

function openMenu(kind) {
  if (!ui.menu.hidden && ui.menu.dataset.kind === kind) { closeMenu(); return; }
  ui.menu.dataset.kind = kind;
  paintMenu();
  ui.menu.hidden = false;
  wake();
}
function closeMenu() { ui.menu.hidden = true; }

function paintMenu() {
  if (ui.menu.hidden && !ui.menu.dataset.kind) return;
  const kind = ui.menu.dataset.kind;
  if (kind === 'speed') {
    ui.menu.innerHTML = `<p class="menu-title">Velocidad</p>${[0.75, 1, 1.25, 1.5, 2].map((v) => `<button class="menu-item ${v === speed ? 'is-on' : ''}" data-act="m-speed" data-v="${v}">${v === 1 ? 'Normal' : v + '×'}</button>`).join('')}`;
  }
}

/* ── capítulos del MP4 ("Intro", "Parte A"…) ──
 * Los videos traen los subtítulos dentro de la imagen, así que Kai ya no busca pistas ni archivos de subtítulos:
 * solo lee los capítulos, y desde MEGA lo hace cuando el video ya empezó, para no quitarle velocidad al arranque. */
let chapCtrl = null;
function resetChapters() {
  if (chapCtrl) chapCtrl.abort();
  chapCtrl = null;
}

/** Espera a que el video esté sonando (o a que pase `ms`, por si no arranca solo). */
const whenPlaying = (ms) => new Promise((res) => {
  if (!video.paused && video.readyState >= 3) { res(); return; }
  let timer = 0;
  const done = () => { clearTimeout(timer); video.removeEventListener('playing', done); res(); };
  timer = setTimeout(done, ms);
  video.addEventListener('playing', done);
});

async function initChapters(ep, token) {
  // mientras no se sepa si el video trae capítulos, Kai no adivina dónde está la intro (ni salta sola con lo aprendido)
  token.chaptersDone = false;
  const giveUp = setTimeout(() => { token.chaptersDone = true; }, 12000);
  try { await loadChapters(ep, token); } catch (err) { if (playing === token) console.warn('capítulos', err); } finally { clearTimeout(giveUp); token.chaptersDone = true; }
}
async function loadChapters(ep, token) {
  const ctrl = new AbortController();
  chapCtrl = ctrl;
  const alive = () => playing === token && !ctrl.signal.aborted;
  const cached = await idb.get('subcache', ep.id).catch(() => null);
  if (!alive()) return;
  if (cached && cached.v === 3) { setChapters(token, cached.chapters || []); return; }
  if (!/mp4|quicktime/.test(ep.mime)) return;
  // desde MEGA, primero que arranque el video; si está descargado, se lee al instante
  if (!(token.source && token.source.blob)) await whenPlaying(4000);
  if (!alive()) return;
  const read = await rangeReader(ep, token, ctrl.signal);
  const info = await mp4Info(read, ep.size);
  learnAudioLang(ep, info.audioLang);
  if (!alive()) return;
  const chapters = await mp4Chapters(info, read, video.duration);
  if (!alive()) return;
  setChapters(token, chapters);
  saveChapterCache(ep, chapters);
}

function saveChapterCache(ep, chapters) {
  idb.put('subcache', { v: 3, tracks: [], chapters: (chapters || []).map((c) => ({ ...c, end: isFinite(c.end) ? c.end : null })), at: Date.now() }, ep.id).catch(() => {});
}

/** Lector por rangos: del archivo descargado o de MEGA descifrando al vuelo. */
async function rangeReader(ep, token, signal) {
  const blob = token && token.source && token.source.blob;
  if (blob) return async (a, b) => new Uint8Array(await blob.slice(a, b + 1).arrayBuffer());
  const fk = await C.fileKey(ep.key);
  let url = await downloadUrl(ep.id);
  return async (a, b) => {
    try {
      return await C.readRange(url, fk, a, b, signal);
    } catch (err) {
      if (err.code !== 'HTTP') throw err;
      url = await downloadUrl(ep.id, true);
      return C.readRange(url, fk, a, b, signal);
    }
  };
}

/** Después de descargar un capítulo, deja listos sus capítulos para verlo sin conexión. */
async function cacheChapters(ep) {
  const have = await idb.get('subcache', ep.id).catch(() => null);
  if (have && have.v === 3) return;
  const blob = await localBlob(ep);
  if (!blob || !/mp4|quicktime/.test(ep.mime)) return;
  const read = async (a, b) => new Uint8Array(await blob.slice(a, b + 1).arrayBuffer());
  const info = await mp4Info(read, ep.size);
  learnAudioLang(ep, info.audioLang);
  saveChapterCache(ep, await mp4Chapters(info, read, null));
}

/* ── capítulos e intros ── */

const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };

function setChapters(token, chapters) {
  if (playing !== token) return;
  token.chapters = (chapters || []).map((c) => ({ ...c, end: c.end == null || !isFinite(c.end) ? (video.duration || Infinity) : c.end }));
  token.intro = pickIntro(token.chapters); // el opening de verdad (no el pedacito de anime que a veces va antes)
  token.chaptersDone = true;
  paintMarks();
  paintControls();
}

function chapterAt(t) {
  const list = playing && playing.chapters;
  return list ? list.find((c) => t >= c.start && t < c.end) : null;
}

function paintMarks() {
  const el = $('#st-marks');
  const d = video.duration;
  const list = (playing && playing.chapters) || [];
  el.innerHTML = d && isFinite(d) ? list.filter((c) => c.start > 0.5 && c.start < d).map((c) => `<span style="left:${(c.start / d) * 100}%"></span>`).join('') : '';
}

/* Sin capítulos, Kai aprende por serie dónde saltaste el opening. */
function introStats() { return state.shared.intros || {}; }
function learnIntro(from, to) {
  if (!playing || playing.learned) return;
  const len = to - from;
  if (from > 360 || len < 40 || len > 150) return;
  playing.learned = true;
  const all = introStats();
  const key = playing.ctx.title;
  const st = all[key] || { starts: [], lens: [] };
  st.starts = [...st.starts, Math.round(from)].slice(-5);
  st.lens = [...st.lens, Math.round(len)].slice(-5);
  st.u = Date.now();
  all[key] = st;
  state.shared.intros = all;
  saveShared();
  state.dirty = true;
}
function learnedIntro() {
  const st = playing && introStats()[playing.ctx.title];
  if (!st || !st.lens.length) return null;
  const len = median(st.lens);
  const recent = st.starts.slice(-3);
  const start = median(recent);
  const sure = recent.length >= 2 && recent.every((x) => Math.abs(x - start) <= 8);
  return { len, start, sure };
}

/** Qué ofrece el botón flotante en este momento: saltar intro, ir al siguiente o deshacer. */
function skipOffer(t, d) {
  if (!playing || !d) return null;
  if (playing.undo && Date.now() < playing.undo.until) return { label: 'Volver a la intro', act: 'undo' };
  const ch = chapterAt(t);
  if (ch && ch === playing.intro && t < ch.end - 2) return { label: 'Saltar intro', to: ch.end, sure: true };
  if (ch && OUTRO.test(ch.title) && neighbor(1)) return { label: 'Siguiente capítulo', act: 'next' };
  if (!playing.chaptersDone) return null;
  if (playing.intro) return null; // con el opening marcado en el MP4 no hace falta adivinar
  if (d < 400 || t > 360) return null;
  const li = learnedIntro();
  if (li && li.sure) {
    if (t >= li.start - 3 && t < li.start + li.len - 3) return { label: 'Saltar intro', to: li.start + li.len, sure: true, learned: true };
    return null;
  }
  if (t < 3) return null;
  if (li) return { label: 'Saltar intro', to: t + li.len, guess: true };
  return { label: 'Saltar 85 s', to: t + 85, guess: true };
}

function paintSkip(t, d) {
  const offer = skipOffer(t, d);
  playing && (playing.offer = offer);
  ui.skip.hidden = !offer;
  if (!offer) return;
  if (ui.skip.textContent !== offer.label) ui.skip.textContent = offer.label;
  ui.skip.classList.toggle('is-sticky', !!(offer.sure || offer.act));
  // saltar solo: únicamente cuando Kai sabe dónde está la intro
  if (offer.sure && state.settings.autoSkip && !playing.autoSkipped && !video.paused) {
    playing.autoSkipped = true;
    playing.undo = { at: t, until: Date.now() + 6000 };
    seekSure(Math.min(d - 1, offer.to));
    paintSkip(video.currentTime, d);
  }
}

/** Salta a un punto y comprueba que llegó: si el navegador se queda corto (aún no tenía esa parte), lo intenta otra vez. */
function seekSure(to) {
  const tok = playing;
  let tries = 0;
  const check = () => {
    if (playing !== tok) return;
    if (video.currentTime < to - 1.5 && tries < 3) { tries++; video.currentTime = to; video.addEventListener('seeked', check, { once: true }); }
  };
  video.currentTime = to;
  video.addEventListener('seeked', check, { once: true });
}

function doSkip() {
  if (!playing) return;
  const o = skipOffer(video.currentTime, video.duration);
  if (!o) return;
  if (o.act === 'undo') {
    video.currentTime = playing.undo.at;
    playing.undo = null;
    playing.autoSkipped = true;
  } else if (o.act === 'next') playNext();
  else {
    const from = video.currentTime;
    playing.autoSkipped = true;
    seekSure(Math.min(video.duration - 1, o.to));
    if (o.guess) learnIntro(from, o.to);
  }
  paintControls();
}

/* ── tema y luz ── */

const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function resolvedTheme() {
  const t = state.settings.theme;
  return t === 'light' || t === 'dark' ? t : (darkMQ.matches ? 'dark' : 'light');
}
/* color de la barra del sistema; en pantalla completa negro, porque en Android ese color también pinta
 * el hueco de la cámara (en tema claro salía una franja blanca) */
function paintThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  meta.content = isFullscreen() ? '#000000' : resolvedTheme() === 'dark' ? (DARK_TONES[state.settings.darkTone] || DARK_TONES.negro).bg : (TONES[state.settings.tone] || TONES.blanco).bg;
}
function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  const tone = state.settings.tone;
  if (t === 'light' && tone && tone !== 'blanco' && TONES[tone]) document.documentElement.dataset.tone = tone;
  else delete document.documentElement.dataset.tone;
  if (t === 'dark' && state.settings.darkTone === 'gris') document.documentElement.dataset.dark = 'gris';
  else delete document.documentElement.dataset.dark;
  paintThemeColor();
  if (dock.classList.contains('is-open')) fillDock();
  document.querySelectorAll('[data-act="theme"]:not(.dock-chip)').forEach((b) => {
    b.innerHTML = t === 'dark' ? ICON.sun : ICON.moon;
    b.setAttribute('aria-label', `Cambiar a tema ${t === 'dark' ? 'claro' : 'oscuro'}`);
  });
}
darkMQ.addEventListener('change', applyTheme);

function setLights(off) {
  document.body.classList.toggle('lights-off', off);
  $('#lights').hidden = !off;
  ui.lights.classList.toggle('is-on', off);
  ui.lights.setAttribute('aria-label', off ? 'Encender la luz' : 'Apagar la luz');
}

/* ── cuota de MEGA ── */

function xferLog() { return LS.get('xfer', []).filter((x) => Date.now() - x[0] < 6 * 3600 * 1000); }
function countBytes(n) {
  if (!n) return;
  const log = xferLog();
  const minute = Math.floor(Date.now() / 60000) * 60000;
  const last = log[log.length - 1];
  if (last && last[0] === minute) last[1] += n; else log.push([minute, n]);
  LS.set('xfer', log);
  paintQuota();
}
function noteQuota(seconds) {
  if (!seconds || seconds <= 0) return;
  LS.set('quota', { until: Date.now() + seconds * 1000 });
  paintQuota();
}
function quotaText(long = false) {
  const q = LS.get('quota', null);
  if (q && q.until > Date.now()) {
    const m = Math.ceil((q.until - Date.now()) / 60000);
    const when = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
    return `Límite de MEGA alcanzado. Se renueva en ${when}.`;
  }
  const pro = LS.get('pro', null);
  if (pro) return `Transferencia de MEGA: ${fmtSize(pro.used)} de ${fmtSize(pro.total)}.`;
  const used = xferLog().reduce((a, x) => a + x[1], 0);
  if (!used) return long ? 'Kai no ha usado transferencia de MEGA en las últimas 6 horas.' : '';
  return long
    ? `Kai usó ${fmtSize(used)} de transferencia de MEGA en las últimas 6 horas. MEGA gratis no publica un límite fijo; si se acaba, se renueva solo.`
    : `MEGA: ${fmtSize(used)} en 6 h`;
}
function paintQuota() {
  const el = $('#drawer-quota');
  if (el) el.textContent = quotaText();
  const q = LS.get('quota', null);
  document.body.classList.toggle('quota-hit', !!(q && q.until > Date.now()));
}
async function refreshAccountInfo() {
  try {
    const r = await state.storage.api.request({ a: 'uq', xfer: 1, pro: 1 });
    if (r && r.utype > 0 && r.mxfer) LS.set('pro', { used: r.caxfer || 0, total: r.mxfer });
    else LS.del('pro');
    paintQuota();
  } catch { /* nada */ }
}
let lastStreamError = '';
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'mega-bytes') countBytes(e.data.n);
    if (e.data && e.data.type === 'mega-quota') noteQuota(e.data.timeLeft || 3600);
    if (e.data && e.data.type === 'stream-error') lastStreamError = String(e.data.msg || '').slice(0, 80);
    // el service worker encontró el enlace de MEGA caducado: se pide otro y se le responde por su canal
    if (e.data && e.data.type === 'need-url' && e.ports && e.ports[0]) {
      const port = e.ports[0];
      downloadUrl(e.data.id, true).then((url) => port.postMessage({ url }), () => port.postMessage({ url: '' }));
    }
  });
}

/* ── eventos del video ── */

video.addEventListener('timeupdate', () => { if (!seeking) paintControls(); savePosition(); maybePrefetchNext(); });

/** En los últimos minutos baja en silencio el inicio del siguiente capítulo (unos 3 MB) para que empiece sin espera. */
function maybePrefetchNext() {
  if (!playing || playing.prefetched || state.settings.prefetchNext === false || !navigator.onLine) return;
  const d = video.duration;
  if (!isFinite(d) || d - video.currentTime > 150) return;
  playing.prefetched = true;
  const n = neighbor(1);
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!n || !sw || state.saved.has(n.id) || (LS.get('quota', null) || {}).until > Date.now()) return;
  downloadUrl(n.id).then((u) => sw.postMessage({ type: 'prefetch', u, k: n.key, s: n.size, i: n.id, blocks: 3 })).catch(() => {});
}
video.addEventListener('progress', paintControls);
video.addEventListener('durationchange', () => { paintControls(); paintMarks(); });
video.addEventListener('play', () => { paintControls(); wake(); document.body.classList.add('is-playing'); });
video.addEventListener('pause', () => { paintControls(); savePosition(true); stage.classList.remove('is-idle'); document.body.classList.remove('is-playing'); });
video.addEventListener('emptied', () => document.body.classList.remove('is-playing'));
video.addEventListener('waiting', () => stage.classList.add('is-loading'));
['playing', 'canplay', 'seeked'].forEach((ev) => video.addEventListener(ev, () => stage.classList.remove('is-loading')));
video.addEventListener('volumechange', paintControls);
video.addEventListener('ended', () => {
  if (!playing) return;
  setProgress(playing.ep, video.duration, video.duration, true);
  sync();
  stage.classList.add('is-ended');
  const n = neighbor(1);
  if (!n) {
    // fin de la temporada: no sigue sola. Si hay otra después, se ofrece, pero solo si la tocas.
    const lib = state.library;
    const s = playing.ctx.si != null && lib && lib.series[playing.ctx.si];
    const nextSe = s && !isCollection(s) && playing.ctx.ki != null ? s.seasons[playing.ctx.ki + 1] : null;
    if (!nextSe) { playerMessage(`Terminaste ${playing.ctx.title}.`); return; }
    const first = nextSe.episodes.find((e) => !(prog(e) || {}).w) || nextSe.episodes[0];
    ui.nextCard.innerHTML = `<p>Terminaste ${esc(seasonTab(s, s.seasons[playing.ctx.ki]))}</p>
      <div class="btn-row">
        <button class="btn btn-lamp" data-act="p-next-season" data-id="${esc(first.id)}">${ICON.play}<span>Ver ${esc(seasonTab(s, nextSe))}</span></button>
        <a class="btn" href="${playing.ctx.back}">Volver</a>
      </div>`;
    ui.nextCard.hidden = false;
    return;
  }
  let left = 6;
  ui.nextCard.innerHTML = `<p>Sigue ${esc(episodeLabel(n))}</p>
    <div class="btn-row">
      <button class="btn btn-lamp" data-act="p-next-now">${ICON.play}<span>Ver ahora</span></button>
      ${state.settings.autoplay ? `<button class="btn" data-act="p-next-cancel">Quedarme aquí <span id="p-count">${left}</span></button>` : ''}
    </div>`;
  ui.nextCard.hidden = false;
  if (state.settings.autoplay) {
    const tick = () => {
      left -= 1;
      const c = $('#p-count');
      if (c) c.textContent = left;
      if (left <= 0) { ui.nextCard.hidden = true; playNext(); } else nextTimer = setTimeout(tick, 1000);
    };
    nextTimer = setTimeout(tick, 1000);
  }
});
/* ── formato del video: por qué un navegador no puede reproducir un archivo ── */
const isSafariUA = /Safari\//.test(navigator.userAgent) && !/Chrome|CriOS|Chromium|Edg|Android|FxiOS/.test(navigator.userAgent);
function canPlay(type) {
  try { return !!video.canPlayType(type) || !!(window.MediaSource && MediaSource.isTypeSupported(type)); } catch { return false; }
}
/** Si el formato del archivo no se puede reproducir en este navegador: { what, fix }; si no, null.
 * Se le pregunta al propio navegador por el códec exacto, así el aviso vale para cada dispositivo. */
const hex2 = (n) => (n & 255).toString(16).padStart(2, '0').toUpperCase();
function formatProblem(f) {
  if (!f || !f.video) return null;
  const v = f.video;
  const a = f.audio || {};
  const elsewhere = isSafariUA ? 'En Chrome de la PC quizá sí se vea.' : 'Prueba en otro navegador o dispositivo.';
  if (/^avc[13]$/.test(v.codec)) {
    if (!canPlay(`video/mp4; codecs="avc1.${hex2(v.profile || 100)}0028"`)) {
      return v.bits > 8
        ? { what: 'H.264 de 10 bits (Hi10P)', fix: `Este navegador no reproduce ese formato. ${elsewhere} Lo seguro es la versión en H.264 normal (8 bits).` }
        : { what: `H.264 (perfil ${v.profile})`, fix: `Este navegador no reproduce ese perfil de H.264. ${elsewhere}` };
    }
  } else if (/^(hev1|hvc1)$/.test(v.codec)) {
    const what = `HEVC (H.265)${v.bits > 8 ? ' de 10 bits' : ''}`;
    if (v.codec === 'hev1' && isSafariUA) return { what: what + ' marcado como "hev1"', fix: 'Safari solo acepta HEVC marcado como "hvc1". Se arregla sin perder calidad: ffmpeg -i entrada.mp4 -c copy -tag:v hvc1 salida.mp4' };
    if (!canPlay(`video/mp4; codecs="hvc1.${v.bits > 8 ? '2.4.L120' : '1.6.L93'}.B0"`)) return { what, fix: `Este navegador no reproduce HEVC en este equipo. ${isSafariUA ? '' : 'Safari en iPhone, iPad y Mac sí.'}`.trim() };
  } else if (v.codec === 'av01') {
    if (!canPlay(`video/mp4; codecs="av01.0.08M.${v.bits > 8 ? '10' : '08'}"`)) return { what: 'AV1', fix: `Este dispositivo no reproduce AV1. ${elsewhere}` };
  } else if (!canPlay(`video/mp4; codecs="${{ vp09: `vp09.00.10.${v.bits > 8 ? '10' : '08'}`, vp08: 'vp8', mp4v: 'mp4v.20.8' }[v.codec] || v.codec}"`)) {
    const names = { mp4v: 'MPEG-4 Part 2 (XviD/DivX)', mp2v: 'MPEG-2', vp08: 'VP8' };
    return { what: names[v.codec] || `el formato "${v.codec}"`, fix: 'Este navegador no reproduce ese formato de video. Hace falta la versión en H.264.' };
  }
  if (/^(ac-3|ec-3)$/.test(a.codec) && !canPlay(`audio/mp4; codecs="${a.codec}"`)) {
    return { what: `audio Dolby (${a.codec === 'ec-3' ? 'E-AC-3' : 'AC-3'})`, fix: `Este navegador no reproduce ese audio. ${isSafariUA ? '' : 'Safari y Edge sí.'}`.trim() };
  }
  if (/^dts/i.test(a.codec || '')) return { what: 'audio DTS', fix: 'Los navegadores no reproducen audio DTS. Hace falta una versión con audio AAC.' };
  return null;
}
function formatSummary(f) {
  if (!f) return 'formato no leído';
  const v = f.video;
  const vs = v ? `${v.codec}${v.profile ? ' perfil ' + v.profile : ''}, ${v.bits} bits` : 'sin video';
  return `video ${vs}; audio ${(f.audio && f.audio.codec) || 'ninguno'}`;
}

video.addEventListener('error', async () => {
  if (!playing || !video.getAttribute('src')) return;
  const { ep } = playing;
  const at = video.currentTime;
  // Un tropiezo de MEGA o de la red no termina la reproducción: se pide un enlace nuevo y se sigue
  // en el mismo punto. Hasta 4 intentos en 3 minutos, para no quedar en un ciclo si de verdad no hay forma.
  const now = Date.now();
  const code = video.error ? video.error.code : 0;
  playing.recover = (playing.recover || []).filter((t) => now - t < 180000);
  // código 3 (decodificar) o 4 (formato no soportado): repetir no sirve más de una vez; se revisa el formato
  const formatError = code === 3 || code === 4;
  if (formatError && (playing.recover.length >= 1 || playing.objectUrl)) { explainFormat(ep, code); return; }
  if (!playing.objectUrl && playing.recover.length < 4 && navigator.onLine) {
    playing.recover.push(now);
    stage.classList.add('is-loading');
    if (playing.recover.length > 1) await sleep(1500 * (playing.recover.length - 1));
    if (!playing || playing.ep !== ep) return;
    try {
      // se comprueba el enlace nuevo; un tropiezo pasajero de MEGA aquí no cuenta como fallo
      for (let tries = 1; ; tries++) {
        try {
          const fresh = await downloadUrl(ep.id, true);
          await C.readRange(fresh, await C.fileKey(ep.key), 0, 15);
          break;
        } catch (err) {
          const passing = !err.status || err.status === 408 || err.status === 429 || err.status >= 500;
          if (!passing || tries >= 3 || /QUOTA|509/.test(String(err.code || err.message))) throw err;
          await sleep(1500 * tries);
          if (!playing || playing.ep !== ep) return;
        }
      }
      video.src = await streamUrl(ep);
      video.addEventListener('loadedmetadata', () => { if (at) video.currentTime = at; }, { once: true });
      video.play().catch(() => {});
      return;
    } catch (err) {
      playerMessage(megaMessage(err));
      return;
    }
  }
  // detalle para saber la causa si vuelve a pasar (código del navegador y último error del service worker)
  const me = video.error;
  const detail = `Detalle: ${me ? `código ${me.code}${me.message ? `, ${me.message.slice(0, 80)}` : ''}` : 'sin código'}${lastStreamError ? `; ${lastStreamError}` : ''}; ${playing.recover.length} intentos`;
  if (/\.mkv$/i.test(ep.name)) playerMessage('Este navegador no reproduce archivos MKV. Usa la versión MP4 del capítulo.');
  else if (!playing.objectUrl && navigator.onLine) playerMessage('No se pudo reproducir en línea. Puedes descargarlo y verlo desde el dispositivo.', true, false, detail);
  else playerMessage('No se pudo reproducir este capítulo en este navegador.');
});

async function explainFormat(ep, code) {
  const token = playing;
  stage.classList.add('is-loading');
  let f = null;
  try { f = await mp4Formats(await rangeReader(ep, token), ep.size); } catch (err) { console.warn('formato', err); }
  if (f && f.video) { codecCache[codecKey(ep)] = { video: f.video, audio: f.audio }; LS.set('codecs', codecCache); }
  if (playing !== token) return;
  const prob = formatProblem(f);
  const detail = `Detalle: código ${code}; ${formatSummary(f)}`;
  if (prob) playerMessage(`Este video viene en ${prob.what}. ${prob.fix}`, false, false, detail);
  else playerMessage('Este navegador no pudo reproducir el video, aunque su formato parece normal. El archivo podría estar dañado o incompleto en MEGA.', !token.objectUrl, false, detail);
}

let seekFrom = null;
ui.seek.addEventListener('input', () => { if (!seeking) seekFrom = video.currentTime; seeking = true; paintControls(); wake(); });
ui.seek.addEventListener('change', () => {
  const to = Number(ui.seek.value);
  if (seekFrom != null && !(playing && playing.chapters && playing.chapters.length)) learnIntro(seekFrom, to);
  video.currentTime = to;
  seeking = false;
  seekFrom = null;
  paintControls();
});
ui.seek.addEventListener('pointerup', () => { if (seeking) { video.currentTime = Number(ui.seek.value); seeking = false; } });

/* Gestos sobre el video.
 * Mouse: un clic pausa, doble clic pantalla completa.
 * Táctil: un toque muestra u oculta los controles; doble toque a la izquierda o derecha salta 10 s
 * (cada toque rápido extra suma otros 10 s); mantener presionado reproduce a 2× mientras no se suelte.
 * Deslizar: en la página, arriba = pantalla completa y abajo = mini reproductor; en pantalla completa,
 * abajo = salir. */
let lastTap = 0;
let lastTapSide = '';
let tapTimer;
let lastTouchEnd = 0;
const holdEl = $('#st-hold');

/** ¿El reproductor está girado 90° con CSS (iPhone vertical en pantalla completa)? */
const isRotated = () => stage.classList.contains('kai-rot') && stage.classList.contains('kai-fs') && matchMedia('(orientation: portrait)').matches;
/** Punto del toque en coordenadas del video (x hacia la derecha, y hacia abajo del video), aunque esté girado. */
function videoPoint(e) {
  if (isRotated()) return { x: e.clientY, y: innerWidth - e.clientX, w: innerHeight, h: innerWidth };
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
}

LS.del('bright'); // la barra de brillo se quitó en v16

function tapSide(fx) {
  return fx < 0.4 ? 'left' : fx > 0.6 ? 'right' : 'center';
}
// como en Android e iOS: el doble toque se mide desde que se soltó el primero hasta que empieza el segundo
const DOUBLE_TAP = 300;
function handleTouchTap(fx, downAt = Date.now()) {
  const side = tapSide(fx);
  const now = Date.now();
  const gap = downAt - lastTap;
  // racha de toques: tras un doble toque, cada toque rápido del mismo lado suma otros 10 s
  if (lastTapSide === side + '-streak' && gap < 650 && side !== 'center') {
    lastTap = now;
    seekBy(side === 'left' ? -10 : 10);
    return;
  }
  if (gap < DOUBLE_TAP && lastTapSide === side) {
    clearTimeout(tapTimer);
    lastTap = now;
    if (side === 'center') { lastTapSide = ''; togglePlay(); return; }
    lastTapSide = side + '-streak';
    seekBy(side === 'left' ? -10 : 10);
    return;
  }
  lastTap = now;
  lastTapSide = side;
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => {
    if (stage.classList.contains('is-idle') || video.paused) wake(); else stage.classList.add('is-idle');
  }, DOUBLE_TAP + 60);
}

let touch = null; // gesto táctil en curso
function endHold() {
  if (!touch || !touch.hold) return;
  touch.hold = false;
  video.playbackRate = speed;
  holdEl.classList.remove('is-on');
}
ui.tap.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || !e.isPrimary) return;
  try { ui.tap.setPointerCapture(e.pointerId); } catch { /* nada */ }
  const p = videoPoint(e);
  if (Date.now() - lastTap < DOUBLE_TAP) clearTimeout(tapTimer); // puede ser el segundo toque: no ocultar controles todavía
  touch = { id: e.pointerId, x: p.x, y: p.y, w: p.w, h: p.h, mode: null, hold: false, at: Date.now() };
  const t = touch;
  t.timer = setTimeout(() => {
    if (touch !== t || t.mode || !video.currentSrc || video.paused || video.ended) return;
    t.hold = true;
    t.mode = 'hold';
    video.playbackRate = 2;
    holdEl.classList.add('is-on');
    clearTimeout(tapTimer);
  }, 500);
});
ui.tap.addEventListener('pointermove', (e) => {
  const t = touch;
  if (!t || e.pointerId !== t.id) return;
  const p = videoPoint(e);
  const dx = p.x - t.x;
  const dy = t.y - p.y; // hacia arriba del video es positivo
  if (!t.mode && Math.hypot(dx, dy) > 12) {
    clearTimeout(t.timer);
    const vertical = Math.abs(dy) > Math.abs(dx);
    // en pantalla completa, abajo = salir; en la página, abajo = mini reproductor y arriba = pantalla completa
    t.mode = !vertical ? 'none' : isFullscreen() ? (dy < 0 ? 'fs-down' : 'none') : dy < 0 ? 'down' : 'up';
  }
  if (t.mode === 'down' || t.mode === 'fs-down') {
    const d = Math.max(0, p.y - t.y);
    t.dist = d;
    // el video sigue al dedo; girado, "abajo" del video es hacia la izquierda de la pantalla
    const k = Math.min(d, 220);
    const base = isRotated() ? 'rotate(90deg) ' : '';
    stage.style.transition = 'none';
    stage.style.transform = `${base}translateY(${k * 0.6}px) scale(${1 - k / 1100})`;
    stage.style.opacity = String(1 - k / 600);
  } else if (t.mode === 'up') {
    t.dist = Math.max(0, t.y - p.y);
  }
});
function touchEnd(e, cancelled) {
  const t = touch;
  if (!t || e.pointerId !== t.id) return;
  clearTimeout(t.timer);
  lastTouchEnd = Date.now();
  if (t.hold) endHold();
  else if (t.mode === 'down' || t.mode === 'fs-down') {
    stage.style.transition = 'transform 0.2s, opacity 0.2s';
    stage.style.transform = '';
    stage.style.opacity = '';
    setTimeout(() => { stage.style.transition = ''; }, 220);
    if (!cancelled && t.dist > 70) {
      if (t.mode === 'fs-down') exitFullscreen(); // vuelve al reproductor normal
      else if (playing) goBack(playing.ctx.back); // queda en el mini reproductor
    }
  } else if (t.mode === 'up') {
    if (!cancelled && t.dist > 60) toggleFullscreen();
  }
  else if (!t.mode && !cancelled) handleTouchTap(t.x / Math.max(1, t.w), t.at);
  touch = null;
}
ui.tap.addEventListener('pointerup', (e) => touchEnd(e, false));
ui.tap.addEventListener('pointercancel', (e) => touchEnd(e, true));
ui.tap.addEventListener('contextmenu', (e) => e.preventDefault()); // mantener presionado no abre el menú del sistema

ui.tap.addEventListener('click', (e) => {
  if (Date.now() - lastTouchEnd < 800) return; // ya lo manejaron los gestos táctiles
  if (e.pointerType === 'mouse' || (!e.pointerType && matchMedia('(hover: hover)').matches)) {
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { togglePlay(); }, 200);
    wake();
    return;
  }
  const p = videoPoint(e);
  handleTouchTap(p.x / Math.max(1, p.w));
});
ui.tap.addEventListener('dblclick', (e) => {
  if (!matchMedia('(hover: hover)').matches) return;
  clearTimeout(tapTimer);
  e.preventDefault();
  toggleFullscreen();
});
stage.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wake(); });

stage.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el === ui.tap) return;
  const act = el.dataset.act;
  wake();
  if (act === 'toggle') togglePlay();
  else if (act === 'back10') seekBy(-10);
  else if (act === 'fwd10') seekBy(10);
  else if (act === 'next') playNext();
  else if (act === 'skip') doSkip();
  else if (act === 'lights') setLights(!document.body.classList.contains('lights-off'));
  else if (act === 'fs') toggleFullscreen();
  else if (act === 'pip') togglePip();
  else if (act === 'mute') video.muted = !video.muted;
  else if (act === 'speed') openMenu('speed');
  else if (act === 'm-speed') { speed = Number(el.dataset.v); video.playbackRate = speed; paintMenu(); paintControls(); }
  else if (act === 'p-next-now') { ui.nextCard.hidden = true; clearTimeout(nextTimer); playNext(); }
  else if (act === 'p-next-season') { ui.nextCard.hidden = true; switchTo(epById(el.dataset.id)); }
  else if (act === 'p-next-cancel') { clearTimeout(nextTimer); ui.nextCard.hidden = true; }
  else if (act === 'p-dl') downloadThenPlay();
  else if (act === 'p-folder' && playing) {
    const ctx = playing.ctx;
    dirAccess(state.dlMeta.get(playing.ep.id)?.dirKey, true).then((d) => { if (d) { playing = null; startPlayback(ctx); flushFolder(); } });
  }
});
ui.menu.addEventListener('change', (e) => {
});
document.addEventListener('pointerdown', (e) => {
  if (!ui.menu.hidden && !ui.menu.contains(e.target) && !e.target.closest('[data-act="cc"],[data-act="speed"]')) closeMenu();
});
['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => {
  document.documentElement.classList.toggle('kai-fs-on', isFullscreen());
  paintThemeColor();
  paintControls();
  wake();
}));

if (!(document.pictureInPictureEnabled || video.webkitSupportsPresentationMode)) ui.pip.hidden = true;

document.addEventListener('keydown', (e) => {
  if (route().view !== 'play' || !playing) {
    if (e.key === 'Escape') { closeSheet(); closeDrawer(); if (picking) endPicking(); }
    return;
  }
  if (e.target.closest('input:not([type="range"]), textarea, select')) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'k') { e.preventDefault(); togglePlay(); }
  else if (k === 'arrowright' || k === 'l') { e.preventDefault(); seekBy(10); }
  else if (k === 'arrowleft' || k === 'j') { e.preventDefault(); seekBy(-10); }
  else if (k === 'f') toggleFullscreen();
  else if (k === 'm') video.muted = !video.muted;
  else if (k === 'n') playNext();
  else if (k === 'b') setLights(!document.body.classList.contains('lights-off'));
  else if (k === 's' && playing && playing.offer) doSkip();
  else if (k === 'p') playPrev();
  else if (k === 'escape') { if (!ui.menu.hidden) closeMenu(); else if (stage.classList.contains('kai-fs')) setKaiFullscreen(false); }
  else return;
  wake();
});

/* ───────────────────────── avisos ───────────────────────── */

let toastTimer;
let toastSeq = 0;
function toast(text) {
  toastSeq++;
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 3800);
}

/* ───────────────────────── eventos globales ───────────────────────── */

document.addEventListener('click', async (e) => {
  // cambiar de capítulo desde la página de reproducción sin llenar el historial
  const link = e.target.closest('a[href^="#/play/"]');
  if (link && route().view === 'play' && app.contains(link)) {
    e.preventDefault();
    const id = decodeURIComponent(link.getAttribute('href').slice('#/play/'.length));
    const ep = epById(id) || (resolveContext(id) || {}).ep;
    if (ep && (!playing || playing.ep.id !== id)) switchTo(ep);
    return;
  }
  const focusLink = e.target.closest('a[data-focus]');
  if (focusLink) { try { sessionStorage.setItem('kai.focus', focusLink.dataset.focus); } catch { /* nada */ } }
  const el = e.target.closest('[data-act]');
  if (!el || stage.contains(el)) return;
  const act = el.dataset.act;
  const li = el.closest('.ep');
  const ep = li && epById(li.dataset.id);
  if (act === 'profile-pick') selectProfile(el.dataset.id);
  else if (act === 'profile-add') renderProfiles(false, true);
  else if (act === 'profiles-edit') renderProfiles(true);
  else if (act === 'profiles-done') renderProfiles(false);
  else if (act === 'profile-delete') {
    const prof = visibleProfiles().find((x) => x.id === el.dataset.id);
    if (!prof || !confirm(`¿Quitar el perfil ${prof.name}? Su progreso deja de mostrarse en Kai.`)) return;
    prof.deleted = true; prof.u = Date.now();
    saveShared();
    if (state.profile && state.profile.id === prof.id) { state.profile = null; LS.del('profile'); }
    renderProfiles(visibleProfiles().length > 0);
    sync();
  }
  else if (act === 'check-update') checkUpdate();
  else if (act === 'home-search') { if ($('#home-search') && !$('#home-search').hidden) closeHomeSearch(); else openHomeSearch(); }
  else if (act === 'home-search-close') closeHomeSearch();
  else if (act === 'cat-clear') { const t = (app.querySelector('.catalog') || {}).dataset?.t; go('#/catalogo' + (t ? '?t=' + t : '')); }
  else if (act === 'apply-update') applyUpdate();
  else if (act === 'dismiss-update') { const n = $('#update-notice'); if (n) n.remove(); }
  else if (act === 'mini-open' && playing) go('#/play/' + encodeURIComponent(playing.ep.id));
  else if (act === 'mini-toggle') togglePlay();
  else if (act === 'mini-close') stopPlayback();
  else if (act === 'dir-pick') pickFolder();
  else if (act === 'dir-off') dropFolder();
  else if (act === 'dir-grant') {
    if (await dirAccess(null, true)) { flushFolder(); if (route().view === 'ajustes') paintDownloadsWhere(); else softRender(); }
    else toast('Sin permiso, Kai guarda las descargas dentro de la app.');
  }
  else if (act === 'pick-mode') { if (picking) endPicking(); else startPicking(); }
  else if (act === 'pick-all' || act === 'pick-unseen' || act === 'pick-dl') pickAction(act);
  else if (act === 'seen-all') paintSeenByAll(el);
  else if (act === 'news-clear') {
    LS.set(pkey('news'), []);
    // "Limpiar" también quita las burbujas de "Nuevo" de los pósters: todo lo que hay queda como ya visto
    if (state.library && state.library.series) saveKnown(Object.fromEntries(state.library.series.map((s) => [s.name, (s.full || s.all).map((e) => e.id)])));
    lastNew = null;
    app.querySelectorAll('.tile-badge, .ep-new:not(.is-lang)').forEach((b) => { if (/nuev/i.test(b.textContent)) b.remove(); });
    paintDock();
    const box = $('#news'); if (box) box.innerHTML = newsHTML();
  }
  else if (act === 'movie-dl' || act === 'later-item') {
    const sr = state.library.series[Number(el.dataset.si)];
    const it = sr && collectionItems(sr).find((x) => x.key === el.dataset.key);
    if (!it) return;
    if (act === 'later-item') setLater(sr, it.key, !isLater(sr, it.key));
    else { it.eps.filter((e) => !state.saved.has(e.id)).forEach((e) => queueDownload(e, movieTitle(sr, it))); softRender(); }
  }
  else if (act === 'later') { const sr = state.library.series[Number(el.dataset.si)]; if (sr) setLater(sr, '', !isLater(sr)); }
  else if (act === 'resume-here') {
    const o = resumeOffer();
    if (!o) { render(); return; }
    LS.set('nowSeen', o.n.u);
    const p = prog(o.ep);
    // se empieza justo donde quedó el otro dispositivo
    if (!p || Math.abs((p.t || 0) - o.n.t) > 5) setProgress(o.ep, o.n.t, o.n.d || (p && p.d) || 0, false);
    go('#/play/' + encodeURIComponent(o.ep.id));
  }
  else if (act === 'resume-dismiss') { const o = resumeOffer(); if (o) LS.set('nowSeen', o.n.u); render(); }
  else if (act === 'lang') {
    const sr = state.library && state.library.series[heroSi];
    if (!sr) return;
    setLangPref(sr, el.dataset.lang);
    if (picking) picking.ids = new Set();
    softRender();
  }
  else if (act === 'series-dl') {
    const sr = state.library.series[Number(el.dataset.si)];
    // en la página de una temporada, los siguientes de esa temporada
    const nx = sr && (el.dataset.from ? epById(el.dataset.from) : nextFor(sr));
    const e = nx && el.dataset.from && index.byId.get(nx.id);
    if (nx) {
      const ups = [nx, ...nextUnseen(nx, e ? sr.seasons[e.ki].episodes : sr.all, 2)].filter((x) => !state.saved.has(x.id));
      ups.forEach((x) => queueDownload(x, sr.name));
      toast(`${plural(ups.length, 'capítulo', 'capítulos')} en cola de descarga.`);
    }
  }
  else if (act === 'tmdb-del') { setTmdbKey(''); paintCineKey('Clave quitada.'); }
  else if (act === 'translate') {
    const sr = state.library.series[heroSi];
    const m = sr && state.meta[el.dataset.key ? itemMetaKey(sr, el.dataset.key) : sr.name];
    if (!m) return;
    el.textContent = 'Traduciendo…';
    const es = await translateToSpanish(m.synopsis, true);
    if (es) {
      m.synopsisEs = es; saveMeta();
      if (m.id) { state.syn[m.id] = { es, u: Date.now() }; saveSyn(); state.synDirty = true; sync(); }
      softRender();
      translateMissing(); // ya con el traductor listo, sigue con las demás
    } else el.textContent = 'Este navegador no puede traducir ahora.';
  }
  else if (act === 'dock') {
    if (dock.classList.contains('is-up')) {
      setDockUp(false);
      upHoldUntil = Date.now() + 1500;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (dock.classList.contains('is-open')) closeDock(); else openDock();
  }
  else if (act === 'profiles-retry') {
    state.sharedError = false;
    renderProfiles();
    try { await connect(); if (syncing) await syncing.catch(() => {}); await sync(); } catch (err) { state.sharedErrorMsg = megaMessage(err); }
    if (!state.sharedLoaded) state.sharedError = true;
    render();
  }
  else if (act === 'theme') { state.settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark'; saveSettings(); applyTheme(); }
  else if (act === 'set-theme') { state.settings.theme = el.dataset.v; saveSettings(); applyTheme(); renderSettings(); }
  else if (act === 'set-dark-tone') { state.settings.darkTone = el.dataset.v; saveSettings(); applyTheme(); renderSettings(); }
  else if (act === 'set-tone') { state.settings.tone = el.dataset.v; saveSettings(); applyTheme(); renderSettings(); }
  else if (act === 'lights') setLights(false);

  else if (act === 'back') goBack(playing ? playing.ctx.back : '#/');
  else if (act === 'home') goHome();
  else if (act === 'dl' && ep) {
    if (state.dls[ep.id] || state.queue.some((q) => q.ep.id === ep.id)) removeDownload(ep.id);
    else if (state.saved.has(ep.id)) { if (confirm(`¿Quitar ${episodeLabel(ep)} del dispositivo?`)) removeDownload(ep.id); }
    else queueDownload(ep);
  } else if (act === 'more' && ep) openSheet(ep);
  else if (act === 'discover-open') openDiscoverSheet(Number(el.dataset.id));
  else if (act === 'w-more' && playing) openSheet(playing.ep);
  else if (act === 'w-dl' && playing) {
    const cur = playing.ep;
    if (state.saved.has(cur.id)) { if (confirm(`¿Quitar ${episodeLabel(cur)} del dispositivo?`)) removeDownload(cur.id); }
    else if (state.dls[cur.id] || state.queue.some((q) => q.ep.id === cur.id)) removeDownload(cur.id);
    else queueDownload(cur, playing.ctx.title);
  } else if (act === 'w-dl-next' && playing) {
    const ups = nextUnseen(playing.ep, playing.ctx.list, 3).filter((x) => !state.saved.has(x.id));
    ups.forEach((x) => queueDownload(x, playing.ctx.title));
    toast(`${plural(ups.length, 'capítulo', 'capítulos')} en cola de descarga.`);
    paintWatchInfo();
  } else if (act === 'set-root') {
    const node = state.storage && state.storage.files[el.dataset.id];
    if (!node) return;
    state.settings.root = nodePath(node);
    saveSettings();
    state.error = null;
    refreshLibrary(false);
    sync();
    toast(`Tus series ahora salen de ${node.name}.`);
    go('#/');
  } else if (act === 'refresh') {
    el.classList.add('is-spinning');
    try {
      const seq = toastSeq;
      await connect();
      refreshLibrary();
      await sync();
      if (toastSeq === seq) toast('Biblioteca actualizada.');
    } catch (err) {
      toast(megaMessage(err));
    }
    el.classList.remove('is-spinning');
  } else if (act === 'sync-now') {
    await sync();
    toast(state.syncState === 'error' ? 'No se pudo sincronizar. Revisa la conexión.' : 'Progreso sincronizado.');
  } else if (act === 'clear-dl') {
    if (!confirm('¿Quitar todos los capítulos descargados de este dispositivo?')) return;
    Object.values(state.dls).forEach((t) => t.ctrl.abort());
    state.queue = [];
    for (const m of await idb.all('dl').catch(() => [])) {
      if (m.where === 'folder' && m.rel && !(await deleteFromFolder(m.rel, m.dirKey))) LS.set('folderTrash', [...LS.get('folderTrash', []), { rel: m.rel, dirKey: m.dirKey }]);
    }
    await idb.clear('chunks'); await idb.clear('dl');
    state.saved.clear(); state.dlMeta.clear();
    toast('Descargas quitadas.');
    render();
  } else if (act === 'logout') {
    if (!confirm('Cerrar sesión borra de este dispositivo la biblioteca y los capítulos descargados. Tu progreso sigue en MEGA.')) return;
    if (state.dirty) await sync().catch(() => {});
    try { if (state.storage) state.storage.close(); } catch { /* nada */ }
    state.storage = null;
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('kai.') && k !== 'kai.settings') localStorage.removeItem(k); } catch { /* nada */ }
    for (const s of ['chunks', 'dl', 'thumbs', 'subcache']) await idb.clear(s).catch(() => {});
    state.library = null; index = buildIndex(null); state.progress = {}; state.saved.clear(); state.dlMeta.clear();
    state.profile = null; state.shared = { profiles: [], intros: {}, picks: {}, legacyBy: null }; state.sharedLoaded = false; state.meta = {}; fichasPulled = false;
    location.hash = '';
    render();
  }
});

let heroTimer;
app.addEventListener('pointerover', (e) => {
  const t = e.target.closest('.tile');
  if (!t || e.pointerType !== 'mouse' || route().view !== 'home') return;
  clearTimeout(heroTimer);
  heroTimer = setTimeout(() => setHero(Number(t.dataset.si)), 140);
});
app.addEventListener('focusin', (e) => {
  const t = e.target.closest('.tile');
  if (t && route().view === 'home') { clearTimeout(heroTimer); setHero(Number(t.dataset.si)); }
});
// flechas como control remoto: va al mosaico o botón más cercano en esa dirección
app.addEventListener('keydown', (e) => {
  const t = e.target.closest('.tile');
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!t || !dir) return;
  const a = t.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of app.querySelectorAll('.tile, .tv-hero .tv-btn')) {
    if (el === t || !el.offsetParent) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 4) continue;
    const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
    const score = along + across * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { e.preventDefault(); best.focus(); best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
});

window.addEventListener('hashchange', () => { onHashChange(); render(); });
window.addEventListener('online', async () => {
  paintSync();
  try { if (!state.storage) { await connect(); refreshLibrary(); } } catch { /* nada */ }
  sync();
  resumePendingDownloads();
});
window.addEventListener('offline', paintSync);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    savePosition(true);
    if (state.dirty) sync();
  } else {
    if (Object.keys(state.dls).length) holdWake();
    if (state.storage && route().view !== 'play') sync();
  }
});
window.addEventListener('pagehide', () => savePosition(true));

/* ───────────────────────── arranque ───────────────────────── */

/* ── actualizaciones ──
 * El service worker se instala solo cuando cambia; al activarse toma el control de la página
 * (controllerchange). Ahí Kai avisa que hay versión nueva y basta con recargar. */
let swReg = null;
let updateReady = false;
let hadController = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
function swVersion() {
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!sw) return Promise.resolve('');
  return new Promise((res) => {
    const done = (e) => { if (e.data && e.data.type === 'version') { navigator.serviceWorker.removeEventListener('message', done); res(e.data.version); } };
    navigator.serviceWorker.addEventListener('message', done);
    sw.postMessage({ type: 'version' });
    setTimeout(() => res(''), 2000);
  });
}
function showUpdateNotice() {
  updateReady = true;
  const btn = $('#check-update');
  if (btn) btn.querySelector('span').textContent = 'Actualizar ahora';
  if ($('#update-notice')) return;
  const el = document.createElement('div');
  el.id = 'update-notice';
  el.className = 'update-notice';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>Hay una versión nueva de Kai.</span><button class="update-btn" data-act="apply-update">Actualizar</button><button class="update-x" data-act="dismiss-update" aria-label="Más tarde">${'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'}</button>`;
  document.body.appendChild(el);
}
function applyUpdate() {
  savePosition(true);
  location.reload();
}
async function checkUpdate() {
  if (updateReady) { applyUpdate(); return; }
  const btn = $('#check-update');
  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Buscando…'; }
  let found = false;
  try {
    if (!swReg && navigator.serviceWorker) swReg = await navigator.serviceWorker.getRegistration();
    if (swReg) {
      await swReg.update();
      found = !!(swReg.installing || swReg.waiting);
      // si hay una nueva, se instala y toma el control en unos segundos
      for (let i = 0; i < 40 && found && !updateReady; i++) await sleep(250);
    }
  } catch { /* sin conexión */ }
  if (btn) { btn.disabled = false; btn.querySelector('span').textContent = updateReady ? 'Actualizar ahora' : 'Buscar actualización'; }
  if (!updateReady) toast(navigator.onLine ? (found ? 'Descargando la versión nueva…' : 'Ya tienes la última versión.') : 'Necesitas conexión para buscar actualizaciones.');
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; } // primera instalación: no hay nada que avisar
    showUpdateNotice();
  });
}

async function boot() {
  applyTheme();
  paintQuota();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; }).catch((e) => console.warn('sw', e));
  }
  await refreshSaved().catch(() => {});
  render();
  // Samsung Internet oscurece las páginas a su manera y Kai no lo puede evitar desde aquí: se avisa una vez
  if (/SamsungBrowser/.test(navigator.userAgent) && !LS.get('samsungHint', false)) {
    LS.set('samsungHint', true);
    setTimeout(() => toast('Si Kai se ve con colores raros aquí, desactiva el modo oscuro de Samsung Internet o usa Chrome.'), 2500);
  }
  getDir().then((d) => { if (d) flushFolder(); }).catch(() => {}); // si la carpeta ya tiene permiso, termina lo pendiente
  if (!LS.get('session', null) || !navigator.onLine) return;
  try {
    await connect();
    refreshLibrary(false);
    render();
    await sync();
    if (!state.profile || route().view === 'perfiles') render();
    resumePendingDownloads();
    refreshAccountInfo();
    ensureMeta();
  } catch (err) {
    const m = megaMessage(err);
    if (/venció/.test(m)) {
      LS.del('session');
      loginNote = m;
      renderLogin(m);
    } else {
      toast(m);
      render();
    }
  }
}

boot();
