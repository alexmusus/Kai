import { Storage } from './vendor/mega.js';
import { isSubtitleName, parseSubtitleFile, mp4Info, mp4Chapters, loadTrackCues, langName } from './subs.js';
import { searchAnime, animeById, toMeta, findForSeries, translateToSpanish, canTranslate } from './meta.js';

const C = window.MegaCore;
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');

/* ───────────────────────── utilidades ───────────────────────── */

const LS = {
  get(k, d) { try { const v = localStorage.getItem('kai.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kai.' + k, JSON.stringify(v)); } catch { /* sin espacio */ } },
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
};

/* ───────────────────────── estado ───────────────────────── */

const DEFAULTS = { root: 'Anime', autoRemoveLocal: true, trashOnFinish: false, autoplay: true, subs: 'on', subLabel: '', subSize: 'm', autoSkip: true, theme: 'auto' };
const SHARED_FILE = '.kai-compartido.json';            // perfiles, intros aprendidas e imágenes elegidas
const profileFile = (id) => `.kai-progreso-${id}.json`;  // progreso de cada perfil
const LEGACY_PROGRESS = ['.kai-progreso.json', '.yoru-progreso.json'];

const state = {
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
const pkey = (k) => `p.${state.profile ? state.profile.id : '_'}.${k}`;
function loadProfileState() {
  state.progress = LS.get(pkey('progress'), {});
  state.dirty = LS.get(pkey('dirty'), false);
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

/** "1. Fate UBW" → { num: 1, title: "Fate UBW" } */
export function seasonInfo(name) {
  const m = /^\s*(\d{1,3})\s*[.)\-_:]?\s+(.*)$/.exec(name) || /^\s*(\d{1,3})\s*$/.exec(name);
  if (m) return { num: Number(m[1]), title: (m[2] || '').trim() };
  const t = /(?:temporada|season|s)\s*(\d{1,3})\b/i.exec(name);
  return { num: t ? Number(t[1]) : null, title: name.trim() };
}

function episodeLabel(ep) {
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
    node = (node.children || []).find((c) => c.directory && c.name && c.name.toLowerCase() === p.toLowerCase());
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
    series.push({ name: sf.name, folderId: sf.nodeId, seasons });
  }
  series.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  return { root: state.settings.root, rootId: root.nodeId, v: 2, series, updated: Date.now() };
}

function buildIndex(lib) {
  const byId = new Map();
  const byPath = new Map();
  if (lib && lib.v === 2) {
    lib.series.forEach((s, si) => {
      s.all = [];
      s.seasons.forEach((se, ki) => se.episodes.forEach((ep, ei) => {
        const entry = { ep, si, ki, ei };
        s.all.push(ep);
        byId.set(ep.id, entry);
        byPath.set(ep.path, entry);
      }));
    });
  }
  return { byId, byPath };
}

function setLibrary(lib) {
  LS.set('library', lib);
  state.library = lib;
  index = buildIndex(lib);
  migrateProgressKeys(state.progress);
}

function librarySignature(lib) {
  if (!lib) return '';
  return lib.root + '|' + lib.series.map((s) => s.name + ':' + s.seasons.map((se) => se.name + '=' + se.episodes.map((e) => e.id + (e.fa ? '+' : '') + e.subs.length).join(',')).join(';')).join('|');
}

/** La versión 1 guardaba rutas relativas a la carpeta de series; ahora son desde la raíz de MEGA. */
function migrateProgressKeys(obj) {
  if (!state.library || !state.library.series) return false;
  const prefix = state.settings.root.replace(/^\/+|\/+$/g, '') + '/';
  let changed = false;
  for (const k of Object.keys(obj)) {
    if (index.byPath.has(k) || !index.byPath.has(prefix + k)) continue;
    const nk = prefix + k;
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
    return {
      ep: e.ep, list: s.all, shown: season.episodes, title: s.name,
      sub: season.title && season.title !== s.name ? season.title : (season.num != null ? `Temporada ${season.num}` : ''),
      back: '#/serie/' + e.si, si: e.si,
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

function prog(ep) { return state.progress[ep.path]; }

function setProgress(ep, t, d, watched) {
  const cur = state.progress[ep.path] || {};
  const w = watched ?? (cur.w || (d > 0 && t / d > 0.92));
  state.progress[ep.path] = { t: Math.round(t * 10) / 10, d: Math.round(d || cur.d || 0), w: !!w, u: Date.now() };
  state.dirty = true;
  saveProgressLocal();
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
    legacyBy: a.legacyBy || b.legacyBy || null,
  };
}

const filesNamed = (folder, name) => visibleChildren(folder).filter((c) => !c.directory && c.name === name);
/** Lee un JSON de MEGA. Si no se puede leer, lanza error (nunca se confunde con "vacío"). Si está dañado, devuelve null. */
async function readJson(n) {
  let text;
  try {
    text = await readNodeText({ id: n.nodeId, key: C.bytesToB64u(new Uint8Array(n.key)), size: n.size });
  } catch (err) {
    const e = new Error('No se pudo leer ' + n.name + ': ' + (err && err.message));
    e.cause = err;
    throw e;
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
    const hasShared = state.shared.profiles.length || Object.keys(state.shared.intros).length || Object.keys(state.shared.picks).length;
    if (hasShared && (sNodes.length !== 1 || stable(state.shared) !== stable(remoteShared))) {
      await writeJson(home, SHARED_FILE, { v: 3, app: 'kai', ...state.shared }, sNodes);
    }
    if (!state.sharedLoaded) { state.sharedLoaded = true; LS.set('sharedLoaded', true); }
    state.sharedError = false;

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
      if (!state.profile || route().view === 'perfiles') render();
    }
    console.warn('sync', err);
  }
  paintSync();
}

function paintSync() {
  const el = $('#sync');
  if (!el) return;
  const offline = !navigator.onLine;
  const pending = state.dirty || state.syncState === 'error';
  el.dataset.state = offline ? 'offline' : state.syncState === 'syncing' ? 'syncing' : pending ? 'pending' : 'ok';
  el.textContent = offline ? 'Sin conexión' : state.syncState === 'syncing' ? 'Sincronizando' : pending ? 'Por sincronizar' : 'Al día';
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

    // subtítulos en archivo aparte: se guardan con el capítulo
    meta.subs = [];
    for (const s of ep.subs || []) {
      try { meta.subs.push({ name: s.name, text: await readNodeText(s) }); } catch { /* sin subtítulo */ }
    }
    meta.done = true;
    await idb.put('dl', meta);
    state.saved.add(ep.id);
    state.dlMeta.set(ep.id, meta);
    cacheEmbeddedSubs(ep).catch(() => {});
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
 * Chrome y Edge en computadora dejan que la página escriba en una carpeta que tú eliges.
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
  const [view, ...rest] = h.split('/');
  return { view: view || 'home', arg: decodeURIComponent(rest.join('/')) };
}
let inAppNav = 0;
function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
function goBack(fallback = '#/') {
  if (inAppNav > 0) history.back();
  else location.replace(fallback);
}

function header(title, { actions = '', overlay = false } = {}) {
  return `<header class="bar ${overlay ? 'is-overlay' : ''}">
    <button class="icon-btn" data-act="back" aria-label="Volver">${ICON.back}</button>
    <h1 class="bar-title">${title}</h1>
    <span id="sync" class="sync" data-state="ok"></span>
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
  if (picking && (view !== 'serie' || String(picking.si) !== String(arg))) endPicking(false);
  if (view === 'play') {
    const c = resolveContext(arg);
    const si = c && c.si;
    setTint(si != null && state.library.series[si] ? seriesColor(state.library.series[si]) : null);
    renderWatch(arg);
  } else {
    stopPlayback();
    setTint(null);
    if (view === 'serie') renderSeries(arg);
    else if (view === 'explorar') renderExplorer(arg);
    else if (view === 'descargas') renderDownloads();
    else if (view === 'ajustes') renderSettings();
    else renderHome();
  }
  paintSync();
  paintDock();
  hydrateThumbs(app);
  const key = view + '/' + arg;
  if (key !== lastRouteKey && view !== 'play') window.scrollTo(0, 0);
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
  btn.innerHTML = `${avatarHTML(p, 'dock-avatar')}<span class="dock-dots" aria-hidden="true"><i></i><i></i><i></i></span>`;
  btn.setAttribute('aria-label', `Menú (${p.name})`);
  if (!dock.querySelector('.dock-panel').hidden) fillDock();
}

function fillDock() {
  const { view } = route();
  const p = visibleProfiles().find((x) => x.id === state.profile.id) || state.profile;
  const item = (href, icon, label, on, extra = '') => `<a class="dock-item ${on ? 'is-on' : ''}" href="${href}" role="menuitem">${icon}<span>${label}</span>${extra}</a>`;
  const dark = resolvedTheme() === 'dark';
  dock.querySelector('.dock-panel').innerHTML = `
    <a class="dock-profile" href="#/perfiles" role="menuitem">${avatarHTML(p)}<span><span class="dock-pname">${esc(p.name)}</span><span class="dock-psub">Cambiar perfil</span></span></a>
    ${item('#/', ICON.home, 'Biblioteca', view === 'home' || view === 'serie')}
    ${item('#/explorar', ICON.folder, 'Explorar MEGA', view === 'explorar')}
    ${item('#/descargas', ICON.saved, 'Descargados', view === 'descargas', `<span class="dock-count" id="dock-count">${state.saved.size || ''}</span>`)}
    ${item('#/ajustes', ICON.gear, 'Ajustes', view === 'ajustes')}
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
// nombres antiguos que aún usan otras partes
const closeDrawer = closeDock;
function paintDrawerCount() {
  const el = $('#dock-count');
  if (el) el.textContent = state.saved.size || '';
}
document.addEventListener('pointerdown', (e) => {
  if (!dock.contains(e.target)) closeDock();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dock.classList.contains('is-open')) { closeDock(); dock.querySelector('.dock-btn').focus(); }
});

/* ── entrar ── */

let loginNote = ''; // aviso que se mantiene en la pantalla de entrar aunque se vuelva a dibujar
function renderLogin(message = loginNote, needCode = false, email = '') {
  app.innerHTML = `<main class="login">
    <div class="login-mark" aria-hidden="true"><span class="orb"></span></div>
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
      ${list.length ? `<button class="btn" data-act="${editing ? 'profiles-done' : 'profiles-edit'}">${editing ? 'Listo' : 'Editar perfiles'}</button>` : ''}
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

function knownMap() { return LS.get(pkey('known'), null); }
function initKnown() {
  if (!state.profile || !state.library || !state.library.series || knownMap()) return;
  LS.set(pkey('known'), Object.fromEntries(state.library.series.map((s) => [s.name, s.all.map((e) => e.id)])));
}
function newEpisodes(s) {
  const k = knownMap();
  if (!k) return [];
  const set = new Set(k[s.name] || []);
  return s.all.filter((e) => !set.has(e.id));
}
function markSeriesSeen(s) {
  const k = knownMap() || {};
  k[s.name] = s.all.map((e) => e.id);
  LS.set(pkey('known'), k);
}
let lastNew = null;
function announceNew() {
  if (!state.library || !state.library.series || !state.profile) return;
  const now = Object.fromEntries(state.library.series.map((s) => [s.name, newEpisodes(s).length]));
  if (lastNew) {
    for (const [name, n] of Object.entries(now)) {
      if (n > (lastNew[name] || 0)) toast(`${name}: ${n === 1 ? 'un capítulo nuevo' : `${n} capítulos nuevos`}.`);
    }
  }
  lastNew = now;
}

/* ── sinopsis e imágenes ── */

function saveMeta() { LS.set('meta', state.meta); }
function metaFor(s) {
  const m = state.meta[s.name];
  return m && !m.none ? m : null;
}
function searchNames(s) {
  const titled = s.seasons.find((se) => se.title && se.title !== s.name);
  const t = titled ? titled.title : '';
  return [...new Set([t && !t.toLowerCase().includes(s.name.toLowerCase()) ? `${s.name} ${t}` : t, t, s.name].filter(Boolean))];
}

let metaRunning = false;
async function ensureMeta() {
  if (metaRunning || !navigator.onLine || !state.library || !state.library.series) return;
  metaRunning = true;
  let changed = false;
  try {
    for (const s of state.library.series) {
      const pick = state.shared.picks[s.name];
      const cur = state.meta[s.name];
      const stale = !cur || Date.now() - (cur.at || 0) > 30 * 86400000 || (pick && pick.id !== (cur.id || 0));
      if (!stale) continue;
      try {
        let m = null;
        if (pick && pick.id === 0) m = null;
        else if (pick) m = await animeById(pick.id);
        else m = await findForSeries(searchNames(s));
        state.meta[s.name] = m ? toMeta(m) : { none: true, id: 0, at: Date.now() };
        if (m) {
          const meta = state.meta[s.name];
          translateToSpanish(meta.synopsis).then((es) => { if (es) { meta.synopsisEs = es; saveMeta(); if (['home', 'serie'].includes(route().view)) softRender(); } });
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
  if (changed && ['home', 'serie'].includes(route().view)) softRender();
}

function synopsisOf(m) { return m ? (m.synopsisEs || m.synopsis || '') : ''; }

/** Color de la serie para teñir el fondo de Kai (nunca una imagen estirada). */
function seriesColor(s) {
  const m = metaFor(s);
  return (m && m.color) || `hsl(${hue(s.name)} 45% 55%)`;
}
function setTint(color) {
  const r = document.documentElement.style;
  if (color) r.setProperty('--tint', color); else r.removeProperty('--tint');
}

function tileHTML(s, si, { href, label = '', sub = '', pct = 0, badge = '' } = {}) {
  const m = metaFor(s);
  const img = m && (m.banner || m.cover);
  const coverEp = s.all.find((e) => e.fa);
  return `<a class="tile" href="${href}" data-si="${si}" style="--h:${hue(s.name)}">
    ${img ? `<img class="tile-img" src="${esc(img)}" alt="" loading="lazy" decoding="async">` : `<span class="tile-img is-fallback" ${coverEp ? `data-thumb="${esc(coverEp.id)}"` : ''}><span class="cover-glyph">${esc([...s.name.trim()][0] || '·')}</span></span>`}
    ${badge ? `<span class="tile-badge">${esc(badge)}</span>` : ''}
    <span class="tile-text"><span class="tile-title">${esc(label || s.name)}</span>${sub ? `<span class="tile-sub">${esc(sub)}</span>` : ''}</span>
    ${pct ? `<span class="tile-bar"><span style="width:${pct}%"></span></span>` : ''}
  </a>`;
}

function openMetaPicker(s) {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-back" data-act="close"></div>
    <div class="sheet-panel picker" role="dialog" aria-modal="true" aria-label="Elegir imagen para ${esc(s.name)}">
      <p class="sheet-title">Imagen y sinopsis de ${esc(s.name)}</p>
      <form class="picker-search" id="picker-search">
        <input name="q" value="${esc(searchNames(s)[0] || s.name)}" aria-label="Buscar en AniList" autocomplete="off">
        <button class="btn" type="submit">Buscar</button>
      </form>
      <div class="picker-results" id="picker-results"><p class="dim">Buscando…</p></div>
      <div class="btn-row picker-foot">
        <button class="btn btn-quiet" data-act="pick-none">Usar sin imagen</button>
        <button class="btn" data-act="close">Cerrar</button>
      </div>
    </div>`;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  let results = [];
  const run = async (q) => {
    const box = $('#picker-results');
    box.innerHTML = '<p class="dim">Buscando…</p>';
    try {
      results = await searchAnime(q, 12);
      box.innerHTML = results.length ? results.map((m, i) => {
        const t = toMeta(m);
        return `<button class="pick" data-act="pick" data-i="${i}">
          <span class="pick-img">${t.banner || t.cover ? `<img src="${esc(t.banner || t.cover)}" alt="" loading="lazy">` : ''}</span>
          <span class="pick-title">${esc(t.title)}</span><span class="pick-sub">${[t.year, t.format].filter(Boolean).join(', ')}</span>
        </button>`;
      }).join('') : '<p class="dim">Sin resultados. Prueba con el nombre completo en inglés o japonés.</p>';
    } catch (err) {
      box.innerHTML = `<p class="dim">${navigator.onLine ? esc(err.message) : 'Necesitas conexión para buscar.'}</p>`;
    }
  };
  $('#picker-search').addEventListener('submit', (e) => { e.preventDefault(); run(e.target.q.value.trim()); });
  run($('#picker-search').q.value);
  sheet.onclick = async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'close') { closeSheet(); return; }
    if (el.dataset.act === 'pick-none') {
      state.shared.picks[s.name] = { id: 0, u: Date.now() };
      state.meta[s.name] = { none: true, id: 0, at: Date.now() };
    } else if (el.dataset.act === 'pick') {
      const m = results[Number(el.dataset.i)];
      if (!m) return;
      state.shared.picks[s.name] = { id: m.id, u: Date.now() };
      state.meta[s.name] = toMeta(m);
      const meta = state.meta[s.name];
      translateToSpanish(meta.synopsis).then((es) => { if (es) { meta.synopsisEs = es; saveMeta(); softRender(); } });
    } else return;
    saveShared();
    saveMeta();
    closeSheet();
    softRender();
    sync();
  };
}

/* ── portada estilo TV ── */

function greeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  return state.profile ? `${g}, ${state.profile.name}` : g;
}
function clockHTML() {
  const d = new Date();
  const time = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
  const hm = time.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
  const ap = (time.find((p) => p.type === 'dayPeriod') || {}).value || '';
  const date = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  return `<span class="tv-hm">${esc(hm)}</span><span class="tv-ap">${esc(ap)}</span><span class="tv-sep" aria-hidden="true"></span><span class="tv-date">${esc(date)}</span>`;
}
setInterval(() => {
  const el = $('#tv-clock');
  if (el) el.innerHTML = clockHTML();
  const g = $('#tv-greet');
  if (g) g.textContent = greeting();
}, 20000);

function tvTop() {
  return `<header class="tv-top">
    <div class="tv-when">
      <p class="tv-greet" id="tv-greet">${esc(greeting())}</p>
      <p class="tv-clock" id="tv-clock">${clockHTML()}</p>
    </div>
    <span id="sync" class="sync" data-state="ok"></span>
  </header>`;
}

let heroSi = null;
let heroUser = false; // el usuario eligió qué serie destacar (mouse, teclado o entrando a ella)

function heroPlan(s) {
  const next = nextFor(s);
  const np = next && prog(next);
  const resume = np && np.t > 5 && !np.w;
  return { next, label: next ? `${resume ? 'Continuar' : 'Ver'} ${episodeLabel(next)}` : 'Serie terminada', left: resume ? fmtLeft(np) : '' };
}

function heroInnerHTML(s, si) {
  const m = metaFor(s);
  const plan = heroPlan(s);
  const fresh = newEpisodes(s).length;
  const facts = [m && m.year, m && m.format, plural(s.all.length, 'capítulo', 'capítulos'), ...((m && m.genres) || [])].filter(Boolean);
  const syn = synopsisOf(m);
  const coverEp = s.all.find((e) => e.fa);
  const poster = m && m.cover
    ? `<a class="hero-poster" href="#/serie/${si}" aria-hidden="true" tabindex="-1"><img src="${esc(m.cover)}" alt="" decoding="async"></a>`
    : (coverEp ? `<a class="hero-poster is-thumb" href="#/serie/${si}" aria-hidden="true" tabindex="-1"><span data-thumb="${esc(coverEp.id)}"></span></a>` : '');
  return `${poster}<div class="tvh-text"><h2 class="tv-title">${esc(s.name)}</h2>
    ${m && m.title && m.title.toLowerCase() !== s.name.toLowerCase() ? `<p class="tv-alt">${esc(m.title)}</p>` : ''}
    <p class="tv-facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}${fresh ? `<span class="tv-new">${fresh === 1 ? '1 nuevo' : `${fresh} nuevos`}</span>` : ''}</p>
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
  const siOf = (s) => lib.series.indexOf(s);
  if (!heroUser || heroSi == null || !lib.series[heroSi]) heroSi = cont[0] ? siOf(cont[0].series) : 0;
  const hs = lib.series[heroSi];
  setTint(seriesColor(hs));
  app.innerHTML = `<div class="tv is-home">
    ${tvTop()}
    <main class="tv-main">
      <section class="tv-hero" id="tv-hero">${heroInnerHTML(hs, heroSi)}</section>
      ${cont.length ? `<section class="tv-row"><h3 class="tv-row-title">Continuar viendo</h3><div class="tiles" role="list">
        ${cont.map((c) => tileHTML(c.series, siOf(c.series), {
          href: '#/play/' + encodeURIComponent(c.ep.id),
          sub: `${episodeLabel(c.ep)}${c.p && c.p.t > 5 ? `, ${fmtLeft(c.p)}` : ''}`,
          pct: c.p && c.p.d ? Math.min(100, (c.p.t / c.p.d) * 100) : 0,
        })).join('')}
      </div></section>` : ''}
      <section class="tv-row"><h3 class="tv-row-title">Series</h3><div class="tiles" role="list">
        ${lib.series.map((s, si) => {
          const fresh = newEpisodes(s).length;
          const seen = s.all.filter((e) => (prog(e) || {}).w).length;
          return tileHTML(s, si, {
            href: '#/serie/' + si,
            sub: seen ? `${seen} de ${s.all.length} vistos` : plural(s.all.length, 'capítulo', 'capítulos'),
            badge: fresh ? (fresh === 1 ? 'Nuevo' : `${fresh} nuevos`) : '',
          });
        }).join('')}
      </div></section>
    </main>
  </div>`;
}

/* ── serie ── */

const currentSeason = {};
function renderSeries(arg) {
  const lib = state.library;
  const si = Number(arg);
  const s = lib && lib.series && lib.series[si];
  if (!s) { go('#/'); return; }
  heroSi = si;
  heroUser = true;
  const m = metaFor(s);
  const plan = heroPlan(s);
  const next = plan.next;
  const ki = Math.min(currentSeason[s.name] ?? (next ? index.byId.get(next.id).ki : 0), s.seasons.length - 1);
  const season = s.seasons[ki];
  const fresh = new Set(newEpisodes(s).map((e) => e.id));
  const upcoming = next ? [next, ...nextUnseen(next, s.all, 2)].filter((x) => !state.saved.has(x.id)) : [];
  const facts = [m && m.year, m && m.format, plural(s.all.length, 'capítulo', 'capítulos'), ...((m && m.genres) || [])].filter(Boolean);
  const syn = synopsisOf(m);
  const coverEp = s.all.find((e) => e.fa);
  const seen = s.all.filter((e) => (prog(e) || {}).w).length;
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
            ${m && m.title && m.title.toLowerCase() !== s.name.toLowerCase() ? `<p class="tv-alt">${esc(m.title)}${m.native ? ` <span lang="ja">${esc(m.native)}</span>` : ''}</p>` : ''}
            <p class="tv-facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}${seen ? `<span>${seen} de ${s.all.length} vistos</span>` : ''}</p>
          </div>
        </div>
        ${syn ? `<p class="tv-synopsis is-long" id="synopsis">${esc(syn)}</p>` : ''}
        ${m && !m.synopsisEs && m.synopsis && canTranslate() ? '<button class="link-btn" data-act="translate">Traducir sinopsis al español</button>' : ''}
        <div class="tv-actions">
          ${next ? `<a class="tv-btn is-primary" href="#/play/${encodeURIComponent(next.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>` : '<span class="tv-done">Serie terminada</span>'}
          ${upcoming.length ? `<button class="tv-btn" data-act="series-dl" data-si="${si}">${ICON.down}<span>Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}</span></button>` : ''}
          <button class="tv-btn is-quiet" data-act="pick-image" data-si="${si}">${ICON.image}<span>${m ? 'Cambiar imagen' : 'Buscar imagen'}</span></button>
        </div>
      </section>
      <section class="ep-section">
        <div class="ep-head">
          <h3 class="ep-heading">Episodios</h3>
          <button class="pick-toggle" data-act="pick-mode" id="pick-toggle" aria-pressed="false">${ICON.check}<span>Seleccionar</span></button>
          ${s.seasons.length > 1 ? `<nav class="seasons" aria-label="Temporadas">${s.seasons.map((se, i) => `<button class="season ${i === ki ? 'is-on' : ''}" data-act="season" data-i="${i}" aria-pressed="${i === ki}">${esc(se.num != null ? `Temporada ${se.num}` : se.name)}</button>`).join('')}</nav>` : ''}
        </div>
        ${season.title && season.title !== s.name ? `<p class="season-title">${esc(season.title)}</p>` : ''}
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
  app.querySelectorAll('[data-act="season"]').forEach((b) => b.addEventListener('click', () => {
    currentSeason[s.name] = Number(b.dataset.i);
    if (picking) picking = { si, ki: Number(b.dataset.i), ids: new Set() };
    renderSeries(arg);
    hydrateThumbs(app);
  }));
  if (picking && (picking.si !== si || picking.ki !== ki)) picking = { si, ki, ids: new Set() };
  paintPick();
  // los "nuevos" se muestran esta vez y quedan vistos
  if (fresh.size) { markSeriesSeen(s); lastNew = null; announceNew(); }
}

/* ── selección de varios capítulos de una temporada para descargarlos juntos ── */

let picking = null; // { si, ki, ids: Set } mientras se eligen capítulos

function pickSeason() {
  const s = picking && state.library && state.library.series[picking.si];
  return s ? s.seasons[picking.ki] || null : null;
}
/** Se puede elegir lo que no está descargado ni en camino. */
const pickable = (ep) => !state.saved.has(ep.id) && !state.dls[ep.id] && !state.queue.some((q) => q.ep.id === ep.id);

function startPicking() {
  const s = state.library && state.library.series[heroSi];
  if (!s) return;
  const ki = Math.min(currentSeason[s.name] ?? 0, s.seasons.length - 1);
  const cur = $('.season.is-on');
  picking = { si: heroSi, ki: cur ? Number(cur.dataset.i) : ki, ids: new Set() };
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
  const p = prog(ep);
  const pct = p && p.d ? (p.w ? 100 : Math.min(100, (p.t / p.d) * 100)) : 0;
  const seen = !!(p && p.w);
  const status = current ? '<span class="ep-now"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>Reproduciendo</span>'
    : next && !seen ? `<span class="ep-next">${p && p.t > 5 ? `Seguir en ${fmtTime(p.t)}` : 'A continuación'}</span>`
    : episodeStatus(ep);
  return `<li class="ep ${seen ? 'is-seen' : ''} ${current ? 'is-current' : ''} ${next ? 'is-next' : ''}" data-id="${esc(ep.id)}">
    <a class="ep-main" href="#/play/${encodeURIComponent(ep.id)}" ${current ? 'aria-current="true"' : ''}>
      <span class="ep-thumb" ${ep.fa ? `data-thumb="${esc(ep.id)}"` : ''}>
        <span class="ep-num" aria-hidden="true">${ep.ep != null ? esc(ep.ep) : '·'}</span>
        <span class="ep-flags">${fresh ? '<span class="ep-new">Nuevo</span>' : ''}${state.saved.has(ep.id) ? `<span class="ep-flag" title="Descargado">${ICON.saved}</span>` : ''}${seen ? `<span class="ep-flag is-seen" title="Visto">${ICON.check}</span>` : ''}</span>
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
  app.innerHTML = header('Ajustes') + `<main class="settings">
    <section class="settings-group is-first">
      <p class="settings-label">Apariencia</p>
      <div class="segmented" role="group" aria-label="Tema">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<button class="seg ${s.theme === v ? 'is-on' : ''}" data-act="set-theme" data-v="${v}" aria-pressed="${s.theme === v}">${l}</button>`).join('')}</div>
    </section>
    <section class="settings-group">
      <p class="settings-label">Carpeta de series</p>
      <p class="settings-value">${esc(s.root)}</p>
      <a class="btn" href="#/explorar${state.library && state.library.rootId ? '/' + encodeURIComponent(state.library.rootId) : ''}">Cambiar carpeta</a>
    </section>
    <form id="settings" class="form settings-group">
      <label class="switch"><input type="checkbox" name="autoplay" ${s.autoplay ? 'checked' : ''}><span>Reproducir el siguiente capítulo solo</span></label>
      <label class="switch"><input type="checkbox" name="subs" ${s.subs !== 'off' ? 'checked' : ''}><span>Mostrar subtítulos cuando el capítulo los traiga</span></label>
      <label class="switch"><input type="checkbox" name="autoSkip" ${s.autoSkip ? 'checked' : ''}><span>Saltar intros solo cuando Kai sepa dónde están</span></label>
      <label class="switch"><input type="checkbox" name="ambient" ${s.ambient !== false ? 'checked' : ''}><span>Luz ambiental alrededor del video</span></label>
      <label class="switch"><input type="checkbox" name="autoRemoveLocal" ${s.autoRemoveLocal ? 'checked' : ''}><span>Quitar del dispositivo los capítulos que termine</span></label>
      <label class="switch"><input type="checkbox" name="trashOnFinish" ${s.trashOnFinish ? 'checked' : ''}><span>Mandar a la papelera de MEGA los capítulos que termine</span></label>
    </form>
    <section class="settings-group" id="dl-where">${downloadsWhereHTML()}</section>
    <section class="settings-group">
      <p class="dim" id="space">Calculando espacio…</p>
      <p class="dim">${esc(quotaText(true))}</p>
      <div class="btn-row">
        <button class="btn" data-act="sync-now">Sincronizar ahora</button>
        <a class="btn" href="#/descargas">Ver descargados</a>
      </div>
    </section>
    <section class="settings-group">
      <p class="dim">Sesión de MEGA: ${esc((LS.get('session', {}).options || {}).email || '')}</p>
      <button class="btn btn-quiet" data-act="logout">Cerrar sesión en este dispositivo</button>
    </section>
  </main>`;
  $('#settings').addEventListener('change', (e) => {
    const f = e.currentTarget;
    s.autoplay = f.autoplay.checked;
    s.subs = f.subs.checked ? 'on' : 'off';
    s.autoSkip = f.autoSkip.checked;
    s.ambient = f.ambient.checked;
    s.autoRemoveLocal = f.autoRemoveLocal.checked;
    s.trashOnFinish = f.trashOnFinish.checked;
    saveSettings();
  });
  paintSpace();
  paintDownloadsWhere();
}

function downloadsWhereHTML(perm = '') {
  if (!canFolder) {
    return `<p class="settings-label">Descargas</p>
      <p class="settings-value">Dentro de la app</p>
      <p class="dim">Este navegador no deja que una página guarde en una carpeta (eso solo lo permiten Chrome y Edge en computadora). Si quieres el archivo aparte, toca ⋯ en un capítulo descargado y elige «Guardar copia en el dispositivo».</p>`;
  }
  const d = dirHandle;
  if (!d) {
    return `<p class="settings-label">Descargas</p>
      <p class="settings-value">Dentro de la app</p>
      <p class="dim">Puedes elegir una carpeta de tu computadora: los capítulos quedarán ahí como MP4 normales, ordenados por serie y temporada.</p>
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
  sheet.innerHTML = `<div class="sheet-back" data-act="close"></div>
    <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${esc(episodeLabel(ep))}">
      <p class="sheet-title">${esc(episodeLabel(ep))}</p>
      <p class="sheet-sub">${esc(ep.name)}, ${fmtSize(ep.size)}${ep.subs && ep.subs.length ? ', con subtítulos aparte' : ''}</p>
      <button class="sheet-btn" data-act="toggle-seen">${p && p.w ? 'Marcar como no visto' : 'Marcar como visto'}</button>
      ${p && p.t > 5 && !p.w ? '<button class="sheet-btn" data-act="restart">Ver desde el principio</button>' : ''}
      ${saved || busy ? `<button class="sheet-btn" data-act="unsave">${busy ? 'Cancelar descarga' : 'Quitar del dispositivo'}</button>` : '<button class="sheet-btn" data-act="save">Descargar para ver sin conexión</button>'}
      ${upcoming.length ? `<button class="sheet-btn" data-act="save-next">Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}</button>` : ''}
      ${saved && (state.dlMeta.get(ep.id) || {}).where !== 'folder' ? '<button class="sheet-btn" data-act="export">Guardar copia en el dispositivo</button>' : ''}
      <button class="sheet-btn is-danger" data-act="trash">Mandar a la papelera de MEGA</button>
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
    else if (act === 'trash') trashEpisode(ep, true);
  };
}
function closeSheet() {
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  sheet.classList.remove('is-open');
  setTimeout(() => { sheet.hidden = true; sheet.innerHTML = ''; }, 180);
}

async function trashEpisode(ep, ask) {
  if (ask && !confirm(`¿Mandar ${episodeLabel(ep)} a la papelera de MEGA? Podrás recuperarlo desde mega.nz.`)) return;
  if (!state.storage) { toast('Necesitas conexión para esto.'); return; }
  const node = state.storage.files[ep.id];
  if (!node) return;
  try {
    await node.delete(false);
    goneNodes.add(ep.id);
    await removeDownload(ep.id, true);
    toast(`${episodeLabel(ep)} está en la papelera de MEGA.`);
    refreshLibrary();
  } catch (err) {
    toast(megaMessage(err));
  }
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
  if (!ctx) {
    if (LS.get('session', null) && (state.connecting || !state.library)) {
      app.innerHTML = header('') + '<main><section class="empty"><p class="dim">Cargando…</p></section></main>';
    } else go('#/');
    return;
  }
  const same = playing && playing.ep.id === id && stage.isConnected && app.contains(stage);
  if (!same) {
    parkStage();
    app.innerHTML = header('') + `<main class="watch">
      <div class="watch-grid">
        <div class="watch-main">
          <div class="stage-slot" id="stage-slot"><div class="ambi" id="ambi" aria-hidden="true"></div></div>
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
  big: $('#st-big'), play: $('#st-play'), chapter: $('#st-chapter'), lights: $('#st-lights'), seek: $('#st-seek'), time: $('#st-time'), cc: $('#st-cc'),
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
  const token = { ep, ctx, objectUrl: null, lastSaved: 0, lastSync: Date.now(), retried: false, source: null, chapters: [], autoSkipped: false, learned: false, undo: null, offer: null };
  playing = token;
  ui.msg.hidden = true;
  ui.nextCard.hidden = true;
  closeMenu();
  resetSubs();
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
  initSubtitles(ep, token);
}

async function streamUrl(ep) {
  if (!('serviceWorker' in navigator)) throw new Error('NOSW');
  if (!navigator.serviceWorker.controller) {
    await Promise.race([navigator.serviceWorker.ready, sleep(3000)]);
    await sleep(50);
    if (!navigator.serviceWorker.controller) throw new Error('NOSW');
  }
  const url = await downloadUrl(ep.id);
  const q = new URLSearchParams({ u: url, k: ep.key, s: String(ep.size), t: ep.mime });
  return '__stream?' + q.toString();
}

function playerMessage(text, offerDownload = false, offerFolder = false) {
  stage.classList.remove('is-loading');
  ui.msg.innerHTML = `<p>${esc(text)}</p><div class="btn-row">
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
  history.replaceState(null, '', '#/play/' + encodeURIComponent(ep.id));
  lastRouteKey = 'play/' + ep.id;
  const ctx = resolveContext(ep.id);
  if (ctx) { startPlayback(ctx); paintWatchInfo(); }
}
function playNext() { const n = neighbor(1); if (n) switchTo(n); }
function playPrev() { const n = neighbor(-1); if (n) switchTo(n); }

function savePosition(force = false) {
  if (!playing || !video.duration || !isFinite(video.duration) || !video.currentSrc) return;
  const now = Date.now();
  if (!force && now - playing.lastSaved < 4000) return;
  playing.lastSaved = now;
  setProgress(playing.ep, video.currentTime, video.duration);
  if (force || now - playing.lastSync > 60000) {
    playing.lastSync = now;
    sync();
  }
}

function finishCurrent() {
  if (!playing) return;
  savePosition(true);
  const ep = playing.ep;
  const p = prog(ep);
  if (p && p.w) {
    if (state.settings.autoRemoveLocal && state.saved.has(ep.id)) removeDownload(ep.id, true);
    if (state.settings.trashOnFinish && navigator.onLine) trashEpisode(ep, false);
  }
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
  resetSubs();
  closeMenu();
  if (isFullscreen()) exitFullscreen();
  if (video.getAttribute('src')) { video.removeAttribute('src'); video.load(); }
  stage.hidden = true;
  parkStage();
}

/* ── controles ── */

function paintControls() {
  const paused = video.paused;
  ui.play.innerHTML = paused ? ICON.play : ICON.pause;
  ui.play.setAttribute('aria-label', paused ? 'Reproducir' : 'Pausar');
  stage.classList.toggle('is-paused', paused);
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
  ui.time.textContent = `${fmtTime(t)} / ${fmtTime(d)}`;
  ui.next.hidden = !neighbor(1);
  paintSkip(t, d);
  const ch = chapterAt(seeking ? t : video.currentTime);
  ui.chapter.textContent = ch && ch.title ? ch.title : '';
  ui.mute.innerHTML = video.muted || video.volume === 0
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  ui.speed.textContent = speed === 1 ? '1×' : `${speed}×`;
  ui.fs.setAttribute('aria-label', isFullscreen() ? 'Salir de pantalla completa' : 'Pantalla completa');
  stage.classList.toggle('is-fs', isFullscreen());
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
  document.documentElement.classList.toggle('kai-fs-on', on);
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

/* ── menú del reproductor: subtítulos y velocidad ── */

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
    return;
  }
  const cur = subs.current;
  ui.menu.innerHTML = `<p class="menu-title">Subtítulos</p>
    <button class="menu-item ${!cur ? 'is-on' : ''}" data-act="m-sub" data-id="off">Desactivados</button>
    ${subs.tracks.map((t) => `<button class="menu-item ${cur === t ? 'is-on' : ''}" data-act="m-sub" data-id="${t.id}">${esc(t.label)}${t.note ? `<span class="menu-note">${esc(t.note)}</span>` : ''}</button>`).join('')}
    ${subs.status ? `<p class="menu-status">${esc(subs.status)}</p>` : ''}
    <label class="menu-item menu-file">Cargar archivo del dispositivo<input type="file" accept=".srt,.vtt,.ass,.ssa" data-act="m-file" hidden></label>
    <p class="menu-title">Tamaño</p>
    <div class="menu-sizes">${[['s', 'Pequeño'], ['m', 'Normal'], ['l', 'Grande']].map(([v, l]) => `<button class="menu-chip ${state.settings.subSize === v ? 'is-on' : ''}" data-act="m-size" data-v="${v}">${l}</button>`).join('')}</div>`;
}

/* ── subtítulos ── */

const subs = { tracks: [], current: null, status: '', ctrl: null, pool: new Map(), mine: new Set() };
let subSeq = 0;

function pooledTrack(label, lang) {
  let t = subs.pool.get(label);
  if (!t) {
    t = video.addTextTrack('subtitles', label, lang || '');
    subs.pool.set(label, t);
    subs.mine.add(t);
  }
  t.mode = 'hidden';
  while (t.cues && t.cues.length) t.removeCue(t.cues[0]);
  return t;
}

function resetSubs() {
  if (subs.ctrl) subs.ctrl.abort();
  subs.ctrl = null;
  subs.tracks = [];
  subs.current = null;
  subs.status = '';
  for (const t of video.textTracks) t.mode = 'disabled';
  paintCC();
}

function addSubTrack(label, lang, cues, note = '') {
  let finalLabel = label;
  for (let n = 2; subs.tracks.some((t) => t.label === finalLabel); n++) finalLabel = `${label} ${n}`;
  const track = pooledTrack(finalLabel, lang);
  const entry = { id: 's' + (++subSeq), label: finalLabel, lang, track, note, cues: [] };
  for (const c of cues || []) addCue(entry, c[0], c[1], c[2]);
  subs.tracks.push(entry);
  autoSelectSub();
  paintCC();
  return entry;
}

function addCue(entry, start, end, text) {
  entry.cues.push([start, end, text]);
  try { entry.track.addCue(new VTTCue(start, end, text)); } catch { /* cue inválido */ }
}

function selectSub(entry, remember = true) {
  subs.current = entry || null;
  for (const t of video.textTracks) t.mode = entry && t === entry.track ? 'showing' : 'disabled';
  if (remember) {
    state.settings.subs = entry ? 'on' : 'off';
    if (entry) state.settings.subLabel = entry.label;
    saveSettings();
  }
  paintCC();
}

function autoSelectSub() {
  if (subs.current || state.settings.subs === 'off' || !subs.tracks.length) return;
  const pref = subs.tracks.find((t) => t.label === state.settings.subLabel)
    || subs.tracks.find((t) => /^(spa|es)/i.test(t.lang || '') || /español/i.test(t.label))
    || subs.tracks[0];
  selectSub(pref, false);
}

function paintCC() {
  ui.cc.classList.toggle('is-on', !!subs.current);
  ui.cc.classList.toggle('has-subs', subs.tracks.length > 0);
  ui.cc.setAttribute('aria-label', subs.current ? `Subtítulos: ${subs.current.label}` : 'Subtítulos');
  video.className = 'cue-' + (state.settings.subSize || 'm');
  if (!ui.menu.hidden && ui.menu.dataset.kind === 'subs') paintMenu();
}

const whenMetadata = () => new Promise((res) => {
  if (video.readyState >= 1) res();
  else video.addEventListener('loadedmetadata', res, { once: true });
});

function nativeTextTracks() {
  return [...video.textTracks].filter((t) => !subs.mine.has(t) && (t.kind === 'subtitles' || t.kind === 'captions'));
}

/** Busca subtítulos: caché, archivos junto al video, pistas que el navegador ya entiende o pistas dentro del MP4. */
async function initSubtitles(ep, token) {
  const ctrl = new AbortController();
  subs.ctrl = ctrl;
  const alive = () => playing === token && !ctrl.signal.aborted;

  const cached = await idb.get('subcache', ep.id).catch(() => null);
  if (!alive()) return;
  if (cached && cached.v === 3) {
    for (const t of cached.tracks || []) addSubTrack(t.label, t.lang, t.cues, t.note);
    setChapters(token, cached.chapters || []);
    if (!subs.tracks.length) { subs.status = 'Este capítulo no trae subtítulos.'; paintCC(); }
    return;
  }

  const found = [];
  // 1) archivos .srt/.vtt/.ass junto al video
  const meta = state.dlMeta.get(ep.id);
  const files = meta && meta.subs && meta.subs.length ? meta.subs.map((s) => ({ name: s.name, text: s.text })) : (ep.subs || []);
  for (const f of files) {
    try {
      const text = f.text ?? (navigator.onLine ? await readNodeText(f) : null);
      if (!alive()) return;
      if (!text) continue;
      const cues = parseSubtitleFile(f.name, text);
      if (!cues.length) continue;
      const ext = f.name.split('.').pop().toUpperCase();
      const lang = /\.(spa|es|esp)\.\w+$/i.test(f.name) ? 'spa' : /\.(eng|en)\.\w+$/i.test(f.name) ? 'eng' : '';
      const entry = addSubTrack(langName(lang) || 'Subtítulos', lang, cues, `Archivo ${ext}`);
      found.push(entry);
    } catch { /* se ignora ese archivo */ }
  }

  // 2) pistas que el navegador ya lee del video (Safari)
  await whenMetadata();
  if (!alive()) return;
  const natives = nativeTextTracks();
  for (const t of natives) {
    subs.tracks.push({ id: 's' + (++subSeq), label: t.label || langName(t.language) || 'Subtítulos', lang: t.language, track: t, note: 'Incrustados', cues: null });
  }
  if (natives.length) { autoSelectSub(); paintCC(); }

  // 3) dentro del MP4: capítulos ("Intro", "Parte A"…) y pistas de subtítulos, leídos por partes
  if (!/mp4|quicktime/.test(ep.mime)) { saveSubCache(ep, found, []); return; }
  if (!natives.length) { subs.status = 'Buscando subtítulos dentro del video…'; paintCC(); }
  try {
    const read = await rangeReader(ep, token, ctrl.signal);
    const info = await mp4Info(read, ep.size);
    if (!alive()) return;
    const chapters = await mp4Chapters(info, read, video.duration);
    if (!alive()) return;
    setChapters(token, chapters);
    const tracks = natives.length ? [] : info.tracks;
    if (!tracks.length) {
      subs.status = found.length || natives.length ? '' : 'Este capítulo no trae subtítulos.';
      paintCC();
      saveSubCache(ep, found, chapters);
      return;
    }
    subs.status = 'Cargando subtítulos…';
    paintCC();
    const entries = tracks.map((t) => addSubTrack(t.name || langName(t.lang) || 'Subtítulos', t.lang, [], 'Incrustados'));
    await Promise.all(tracks.map((t, i) => loadTrackCues(t, read, {
      near: video.currentTime,
      signal: ctrl.signal,
      parallel: token.source && token.source.blob ? 2 : 6,
      onCue: (s, e, text) => { if (alive()) addCue(entries[i], s, e, text); },
    })));
    if (!alive()) return;
    subs.status = '';
    paintCC();
    saveSubCache(ep, [...found, ...entries], chapters);
  } catch (err) {
    if (!alive()) return;
    subs.status = 'No se pudieron leer los subtítulos.';
    paintCC();
    console.warn('subs', err);
  }
}

function saveSubCache(ep, entries, chapters) {
  const tracks = entries.filter((e) => e.cues && e.cues.length).map((e) => ({ label: e.label, lang: e.lang, note: e.note, cues: e.cues }));
  idb.put('subcache', { v: 3, tracks, chapters: (chapters || []).map((c) => ({ ...c, end: isFinite(c.end) ? c.end : null })), at: Date.now() }, ep.id).catch(() => {});
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

/** Después de descargar un capítulo, deja listos sus subtítulos incrustados para verlo sin conexión. */
async function cacheEmbeddedSubs(ep) {
  const have = await idb.get('subcache', ep.id).catch(() => null);
  if (have && have.v === 3) return;
  const blob = await localBlob(ep);
  if (!blob || !/mp4|quicktime/.test(ep.mime)) return;
  const read = async (a, b) => new Uint8Array(await blob.slice(a, b + 1).arrayBuffer());
  const meta = state.dlMeta.get(ep.id);
  const entries = [];
  for (const f of (meta && meta.subs) || []) {
    const cues = parseSubtitleFile(f.name, f.text);
    if (cues.length) entries.push({ label: 'Subtítulos', lang: '', note: `Archivo ${f.name.split('.').pop().toUpperCase()}`, cues });
  }
  const info = await mp4Info(read, ep.size);
  for (const t of info.tracks) {
    const cues = [];
    await loadTrackCues(t, read, { parallel: 2, onCue: (s, e, x) => cues.push([s, e, x]) });
    cues.sort((a, b) => a[0] - b[0]);
    entries.push({ label: t.name || langName(t.lang) || 'Subtítulos', lang: t.lang, note: 'Incrustados', cues });
  }
  saveSubCache(ep, entries, await mp4Chapters(info, read, null));
}

async function loadSubFile(file) {
  try {
    const text = await file.text();
    const cues = parseSubtitleFile(file.name, text);
    if (!cues.length) { toast('Ese archivo no tiene subtítulos que pueda leer.'); return; }
    const entry = addSubTrack(file.name.replace(/\.[^.]+$/, '').slice(0, 28), '', cues, 'Desde el dispositivo');
    selectSub(entry);
    closeMenu();
  } catch {
    toast('No se pudo leer el archivo.');
  }
}

/* ── capítulos e intros ── */

const INTRO = /^\s*(intro|opening|op\b|apertura|avance inicial)/i;
const OUTRO = /^\s*(ending|ed\b|outro|cr[eé]ditos|credits|cierre)/i;
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };

function setChapters(token, chapters) {
  if (playing !== token) return;
  token.chapters = (chapters || []).map((c) => ({ ...c, end: c.end == null || !isFinite(c.end) ? (video.duration || Infinity) : c.end }));
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
  if (ch && INTRO.test(ch.title) && t < ch.end - 2) return { label: 'Saltar intro', to: ch.end, sure: true };
  if (ch && OUTRO.test(ch.title) && neighbor(1)) return { label: 'Siguiente capítulo', act: 'next' };
  if (playing.chapters && playing.chapters.some((c) => INTRO.test(c.title))) return null;
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
    video.currentTime = Math.min(d - 1, offer.to);
    paintSkip(video.currentTime, d);
  }
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
    video.currentTime = Math.min(video.duration - 1, o.to);
    if (o.guess) learnIntro(from, o.to);
  }
  paintControls();
}

/* ── luz ambiental: los colores del video se reflejan alrededor del reproductor ── */

const ambiCanvas = document.createElement('canvas');
ambiCanvas.width = 12; ambiCanvas.height = 6;
const ambiCtx = ambiCanvas.getContext('2d', { willReadFrequently: true });
let ambiOk = true;
function sampleAmbient() {
  const el = $('#ambi');
  if (!el || !ambiOk || state.settings.ambient === false || video.readyState < 2 || document.hidden) return;
  try {
    ambiCtx.drawImage(video, 0, 0, 12, 6);
    const d = ambiCtx.getImageData(0, 0, 12, 6).data;
    const zone = (x0, x1) => {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 0; y < 6; y++) for (let x = x0; x < x1; x++) { const i = (y * 12 + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      return `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})`;
    };
    el.style.setProperty('--a1', zone(0, 4));
    el.style.setProperty('--a2', zone(4, 8));
    el.style.setProperty('--a3', zone(8, 12));
    el.classList.add('is-on');
  } catch {
    ambiOk = false; // el navegador no deja leer los colores de este video
  }
}
setInterval(() => { if (playing && !video.paused) sampleAmbient(); }, 900);
video.addEventListener('seeked', () => setTimeout(sampleAmbient, 120));
video.addEventListener('loadeddata', () => setTimeout(sampleAmbient, 120));

/* ── tema y luz ── */

const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function resolvedTheme() {
  const t = state.settings.theme;
  return t === 'light' || t === 'dark' ? t : (darkMQ.matches ? 'dark' : 'light');
}
function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#0d0e12' : '#eef0f4';
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
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'mega-bytes') countBytes(e.data.n);
    if (e.data && e.data.type === 'mega-quota') noteQuota(e.data.timeLeft || 3600);
  });
}

/* ── eventos del video ── */

video.addEventListener('timeupdate', () => { if (!seeking) paintControls(); savePosition(); });
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
  if (!n) { playerMessage(`Terminaste ${playing.ctx.title}.`); return; }
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
video.addEventListener('error', async () => {
  if (!playing || !video.getAttribute('src')) return;
  const { ep } = playing;
  const at = video.currentTime;
  if (!playing.objectUrl && !playing.retried && navigator.onLine) {
    // La URL de MEGA pudo vencer: se pide otra y se sigue en el mismo punto.
    playing.retried = true;
    try {
      const fresh = await downloadUrl(ep.id, true);
      await C.readRange(fresh, await C.fileKey(ep.key), 0, 15);
      video.src = await streamUrl(ep);
      video.addEventListener('loadedmetadata', () => { if (at) video.currentTime = at; }, { once: true });
      video.play().catch(() => {});
      return;
    } catch (err) {
      playerMessage(megaMessage(err));
      return;
    }
  }
  if (/\.mkv$/i.test(ep.name)) playerMessage('Este navegador no reproduce archivos MKV. Usa la versión MP4 del capítulo.');
  else if (!playing.objectUrl && navigator.onLine) playerMessage('No se pudo reproducir en línea. Puedes descargarlo y verlo desde el dispositivo.', true);
  else playerMessage('No se pudo reproducir este capítulo en este navegador.');
});

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
 * (cada toque rápido extra suma otros 10 s); deslizar arriba o abajo cambia el brillo;
 * mantener presionado reproduce a 2× mientras no se suelte. */
let lastTap = 0;
let lastTapSide = '';
let tapTimer;
let lastTouchEnd = 0;
let bright = Math.min(1.6, Math.max(0.35, Number(LS.get('bright', 1)) || 1));
const levelEl = $('#st-level');
const holdEl = $('#st-hold');
let levelTimer;

function applyBright() { video.style.filter = Math.abs(bright - 1) < 0.02 ? '' : `brightness(${bright.toFixed(2)})`; }
applyBright();
function showLevel(side) {
  levelEl.dataset.side = side;
  levelEl.style.setProperty('--lv', String(Math.round(((bright - 0.35) / 1.25) * 100)));
  levelEl.classList.add('is-on');
  clearTimeout(levelTimer);
  levelTimer = setTimeout(() => levelEl.classList.remove('is-on'), 700);
}

function tapSide(clientX) {
  const rect = stage.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width;
  return x < 0.4 ? 'left' : x > 0.6 ? 'right' : 'center';
}
// como en Android e iOS: el doble toque se mide desde que se soltó el primero hasta que empieza el segundo
const DOUBLE_TAP = 300;
function handleTouchTap(clientX, downAt = Date.now()) {
  const side = tapSide(clientX);
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
  const rect = stage.getBoundingClientRect();
  if (Date.now() - lastTap < DOUBLE_TAP) clearTimeout(tapTimer); // puede ser el segundo toque: no ocultar controles todavía
  touch = { id: e.pointerId, x: e.clientX, y: e.clientY, h: rect.height, mode: null, hold: false, start: bright, at: Date.now(), side: e.clientX - rect.left < rect.width / 2 ? 'left' : 'right' };
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
  const dx = e.clientX - t.x;
  const dy = t.y - e.clientY; // hacia arriba es positivo
  if (!t.mode && Math.hypot(dx, dy) > 12) {
    clearTimeout(t.timer);
    t.mode = Math.abs(dy) > Math.abs(dx) ? 'bright' : 'none';
    if (t.mode === 'bright') { t.y = e.clientY; t.start = bright; }
  }
  if (t.mode === 'bright') {
    const dy2 = t.y - e.clientY;
    // recorrer el alto del video cambia el brillo por completo
    bright = Math.min(1.6, Math.max(0.35, t.start + (dy2 / Math.max(160, t.h)) * 1.25));
    applyBright();
    showLevel(t.side);
  }
});
function touchEnd(e, cancelled) {
  const t = touch;
  if (!t || e.pointerId !== t.id) return;
  clearTimeout(t.timer);
  lastTouchEnd = Date.now();
  if (t.hold) endHold();
  else if (t.mode === 'bright') LS.set('bright', Number(bright.toFixed(2)));
  else if (!t.mode && !cancelled) handleTouchTap(e.clientX, t.at);
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
  handleTouchTap(e.clientX);
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
  else if (act === 'cc') openMenu('subs');
  else if (act === 'speed') openMenu('speed');
  else if (act === 'm-speed') { speed = Number(el.dataset.v); video.playbackRate = speed; paintMenu(); paintControls(); }
  else if (act === 'm-sub') { selectSub(el.dataset.id === 'off' ? null : subs.tracks.find((t) => t.id === el.dataset.id)); closeMenu(); }
  else if (act === 'm-size') { state.settings.subSize = el.dataset.v; saveSettings(); paintCC(); paintMenu(); }
  else if (act === 'p-next-now') { ui.nextCard.hidden = true; clearTimeout(nextTimer); playNext(); }
  else if (act === 'p-next-cancel') { clearTimeout(nextTimer); ui.nextCard.hidden = true; }
  else if (act === 'p-dl') downloadThenPlay();
  else if (act === 'p-folder' && playing) {
    const ctx = playing.ctx;
    dirAccess(state.dlMeta.get(playing.ep.id)?.dirKey, true).then((d) => { if (d) { playing = null; startPlayback(ctx); flushFolder(); } });
  }
});
ui.menu.addEventListener('change', (e) => {
  if (e.target.matches('[data-act="m-file"]') && e.target.files[0]) loadSubFile(e.target.files[0]);
});
document.addEventListener('pointerdown', (e) => {
  if (!ui.menu.hidden && !ui.menu.contains(e.target) && !e.target.closest('[data-act="cc"],[data-act="speed"]')) closeMenu();
});
['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => { paintControls(); wake(); }));

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
  else if (k === 'c') { const t = subs.current ? null : (subs.tracks[0] || null); selectSub(t); }
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
  else if (act === 'dir-pick') pickFolder();
  else if (act === 'dir-off') dropFolder();
  else if (act === 'dir-grant') {
    if (await dirAccess(null, true)) { flushFolder(); if (route().view === 'ajustes') paintDownloadsWhere(); else softRender(); }
    else toast('Sin permiso, Kai guarda las descargas dentro de la app.');
  }
  else if (act === 'pick-mode') { if (picking) endPicking(); else startPicking(); }
  else if (act === 'pick-all' || act === 'pick-unseen' || act === 'pick-dl') pickAction(act);
  else if (act === 'pick-image') { const sr = state.library.series[Number(el.dataset.si)]; if (sr) openMetaPicker(sr); }
  else if (act === 'series-dl') {
    const sr = state.library.series[Number(el.dataset.si)];
    const nx = sr && nextFor(sr);
    if (nx) {
      const ups = [nx, ...nextUnseen(nx, sr.all, 2)].filter((x) => !state.saved.has(x.id));
      ups.forEach((x) => queueDownload(x, sr.name));
      toast(`${plural(ups.length, 'capítulo', 'capítulos')} en cola de descarga.`);
    }
  }
  else if (act === 'translate') {
    const sr = state.library.series[heroSi];
    const m = sr && state.meta[sr.name];
    if (!m) return;
    el.textContent = 'Traduciendo…';
    const es = await translateToSpanish(m.synopsis, true);
    if (es) { m.synopsisEs = es; saveMeta(); softRender(); } else el.textContent = 'Este navegador no puede traducir ahora.';
  }
  else if (act === 'dock') { if (dock.classList.contains('is-open')) closeDock(); else openDock(); }
  else if (act === 'profiles-retry') {
    state.sharedError = false;
    renderProfiles();
    try { await connect(); if (syncing) await syncing.catch(() => {}); await sync(); } catch { /* se muestra abajo */ }
    if (!state.sharedLoaded) state.sharedError = true;
    render();
  }
  else if (act === 'theme') { state.settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark'; saveSettings(); applyTheme(); }
  else if (act === 'set-theme') { state.settings.theme = el.dataset.v; saveSettings(); applyTheme(); renderSettings(); }
  else if (act === 'lights') setLights(false);

  else if (act === 'back') goBack(playing ? playing.ctx.back : '#/');
  else if (act === 'dl' && ep) {
    if (state.dls[ep.id] || state.queue.some((q) => q.ep.id === ep.id)) removeDownload(ep.id);
    else if (state.saved.has(ep.id)) { if (confirm(`¿Quitar ${episodeLabel(ep)} del dispositivo?`)) removeDownload(ep.id); }
    else queueDownload(ep);
  } else if (act === 'more' && ep) openSheet(ep);
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
    state.profile = null; state.shared = { profiles: [], intros: {}, picks: {}, legacyBy: null }; state.sharedLoaded = false; state.meta = {};
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
app.addEventListener('keydown', (e) => {
  const t = e.target.closest('.tile');
  if (!t || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const row = t.parentElement;
  const tiles = [...row.children];
  const i = tiles.indexOf(t);
  let target = null;
  if (e.key === 'ArrowRight') target = tiles[i + 1];
  else if (e.key === 'ArrowLeft') target = tiles[i - 1];
  else {
    const rows = [...app.querySelectorAll('.tiles')];
    const r = rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1);
    if (rows[r]) target = rows[r].children[Math.min(i, rows[r].children.length - 1)];
    else if (e.key === 'ArrowUp') target = app.querySelector('.tv-hero .tv-btn');
  }
  if (target) { e.preventDefault(); target.focus(); target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
});

window.addEventListener('hashchange', () => { inAppNav++; render(); });
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

async function boot() {
  applyTheme();
  paintQuota();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e));
  }
  await refreshSaved().catch(() => {});
  render();
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
