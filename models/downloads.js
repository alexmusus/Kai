// @ts-check
/*
 * models/downloads.js — capítulos guardados para ver sin conexión.
 *
 * Cada capítulo se baja en pedazos de 4 MB (3 a la vez) a IndexedDB, así se puede reanudar si se corta.
 * Se descarga uno a la vez (cola). Nada se borra solo: lo descargado se quita a mano desde Descargados.
 *
 * Carpeta de descargas: Chrome y Edge (computadora y Android) dejan que la página escriba en una carpeta que tú
 * eliges. Al terminar, el capítulo se pasa a la carpeta como un MP4 normal (Serie/Temporada/archivo.mp4) y la copia
 * de la app se borra. Safari (Mac y iPhone) y Firefox no lo permiten: ahí se puede guardar una copia aparte.
 * El acceso a cada carpeta elegida se guarda en IndexedDB ('subcache', con una clave propia para no cambiar la
 * versión de la base); las descargas solo anotan esa clave. La carpeta actual va en localStorage.
 *
 * Avisos que emite:
 *  - "download-changed" (id): empezó, avanzó, terminó o se quitó una descarga
 *  - "download-done" (ep): terminó una descarga (para leer sus capítulos y subtítulos)
 *  - "downloads-removed": se quitó algo (para redibujar Descargados)
 *  - "folder-moved" (n): pasaron capítulos a la carpeta
 *  - "notice" (texto): algo que decirle a quien usa Kai
 */

import { LS, sleep, plural } from '../lib/util.js';
import { emit } from '../lib/events.js';
import { state, index } from './store.js';
import { idb } from './idb.js';
import { C, downloadUrl, megaMessage } from './mega.js';
import { countBytes, noteQuota } from './quota.js';
import { episodeLabel } from './collections.js';

/** @typedef {import('./types.js').Episode} Episode */

export const CHUNK = 4 * 1024 * 1024;
const PARALLEL = 3;
const KEY_DIR = 'dirKey'; //          clave de la carpeta actual en 'subcache'
const KEY_TRASH = 'folderTrash'; //   archivos de la carpeta por borrar cuando haya permiso

/** ¿Se está usando este capítulo ahora (reproduciéndose)? Lo dice el reproductor con setInUseCheck. */
let inUse = (/** @type {string} */ id) => false;
/** @param {(id: string) => boolean} fn */
export function setInUseCheck(fn) {
  inUse = fn;
}

/** Lo descargado en este dispositivo (lee IndexedDB y actualiza state.saved y state.dlMeta). */
export async function refreshSaved() {
  const metas = await idb.all('dl').catch(() => []);
  state.dlMeta = new Map(metas.map((/** @type {any} */ m) => [m.id, m]));
  state.saved = new Set(metas.filter((/** @type {any} */ m) => m.done).map((/** @type {any} */ m) => m.id));
  return metas;
}

/* ── pantalla encendida mientras descarga ── */

/** @type {any} */
let wakeLock = null;
export async function holdWake() {
  try {
    if (!wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await /** @type {any} */ (navigator).wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
  } catch {
    /* el navegador no lo permite */
  }
}
function releaseWake() {
  if (!Object.keys(state.dls).length && !state.queue.length && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

/* ── la cola ── */

/**
 * Pone un capítulo en la cola; se descarga uno a la vez.
 * @param {Episode} ep
 * @param {string} title nombre de la serie (para agrupar en Descargados)
 */
export function queueDownload(ep, title) {
  if (state.dls[ep.id] || state.saved.has(ep.id) || state.queue.some((q) => q.ep.id === ep.id)) return;
  if (!navigator.onLine) {
    emit('notice', 'Necesitas conexión para descargar.');
    return;
  }
  state.queue.push({ ep, title });
  askFolderIfNeeded();
  emit('download-changed', ep.id);
  pumpDownloads();
}

/** @type {Promise<void> | null} */
let downloading = null;
function pumpDownloads() {
  if (downloading || !state.queue.length) return;
  const job = state.queue.shift();
  downloading = runDownload(job.ep, job.title).finally(() => {
    downloading = null;
    pumpDownloads();
  });
}

/** Pone en la cola y espera a que termine (o a que se quite). @param {Episode} ep @param {string} title */
export function downloadAndWait(ep, title) {
  queueDownload(ep, title);
  return new Promise((/** @type {(v?: void) => void} */ resolve) => {
    const check = () => {
      if (state.saved.has(ep.id) || (!state.dls[ep.id] && !state.queue.some((q) => q.ep.id === ep.id))) resolve();
      else setTimeout(check, 400);
    };
    check();
  });
}

/** Al abrir Kai: sigue lo que quedó a medias (y quita lo que ya no está en MEGA). */
export async function resumePendingDownloads() {
  const metas = await refreshSaved();
  if (!navigator.onLine) return;
  for (const m of metas) {
    if (m.done) continue;
    const ep = (index.byId.get(m.id) || {}).ep || m.ep;
    if (ep) queueDownload(ep, m.title);
    else removeDownload(m.id, true);
  }
}

/** @param {Episode} ep @param {string} title */
async function runDownload(ep, title) {
  const task = { loaded: 0, total: ep.size, ctrl: new AbortController() };
  state.dls[ep.id] = task;
  emit('download-changed', ep.id);
  holdWake();
  try {
    navigator.storage && navigator.storage.persist && navigator.storage.persist();
  } catch {
    /* el navegador decide */
  }
  try {
    const meta = (await idb.get('dl', ep.id)) || { id: ep.id, done: false, at: Date.now() };
    Object.assign(meta, { ep, title: title || meta.title || '', size: ep.size, mime: ep.mime, path: ep.path });
    await idb.put('dl', meta);
    state.dlMeta.set(ep.id, meta);
    const have = new Set((await idb.chunkKeys(ep.id)).map((/** @type {any} */ k) => k[1]));
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
        const i = /** @type {number} */ (todo.shift());
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
            const e = /** @type {any} */ (err);
            if (task.ctrl.signal.aborted) return;
            if (e.code === 'QUOTA') noteQuota(e.timeLeft || 3600);
            if (e.code === 'QUOTA' || tries >= 4) throw err;
            if (e.code === 'HTTP') url = await downloadUrl(ep.id, true); // el enlace venció
            await sleep(800 * (tries + 1));
          }
        }
        if (Date.now() - lastPaint > 250) {
          lastPaint = Date.now();
          emit('download-changed', ep.id);
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (task.ctrl.signal.aborted) return;

    meta.done = true;
    await idb.put('dl', meta);
    state.saved.add(ep.id);
    state.dlMeta.set(ep.id, meta);
    emit('download-done', ep);
    let where = '';
    if (await getDir()) {
      try {
        where = (await moveToFolder(ep.id)) ? ' en tu carpeta' : '';
        if (!where)
          emit(
            'notice',
            `${episodeLabel(ep)} quedó dentro de la app: Kai no tiene permiso para tu carpeta ahora (Ajustes → Permitir acceso).`,
          );
      } catch {
        emit('notice', `No se pudo guardar ${episodeLabel(ep)} en tu carpeta; quedó dentro de la app.`);
      }
    }
    if (where || !(await getDir())) emit('notice', `${episodeLabel(ep)} listo para ver sin conexión${where}.`);
  } catch (err) {
    if (!task.ctrl.signal.aborted) emit('notice', megaMessage(err));
  } finally {
    delete state.dls[ep.id];
    emit('download-changed', ep.id);
    releaseWake();
  }
}

/**
 * Quita un capítulo del dispositivo (o detiene su descarga). Si estaba en la carpeta y ahora no hay permiso,
 * se borra de ahí la próxima vez que Kai pueda entrar.
 * @param {string} id
 * @param {boolean} [quiet] sin aviso
 */
export async function removeDownload(id, quiet = false) {
  const t = state.dls[id];
  if (t) t.ctrl.abort();
  state.queue = state.queue.filter((q) => q.ep.id !== id);
  const meta = state.dlMeta.get(id) || (await idb.get('dl', id).catch(() => null));
  if (meta && meta.where === 'folder' && meta.rel) {
    if (!(await deleteFromFolder(meta.rel, meta.dirKey)))
      LS.set(KEY_TRASH, [...LS.get(KEY_TRASH, []), { rel: meta.rel, dirKey: meta.dirKey }]);
  }
  await idb.dropChunks(id).catch(() => {});
  await idb.del('dl', id).catch(() => {});
  state.saved.delete(id);
  state.dlMeta.delete(id);
  delete state.dls[id];
  emit('download-changed', id);
  if (!quiet) emit('notice', 'Quitado del dispositivo.');
  emit('downloads-removed');
}

/** Tipo para reproducir: MKV se le pasa al navegador como WebM (es casi lo mismo y así lo intenta). @param {Episode} ep */
export const playType = (ep) => (ep.mime === 'video/x-matroska' ? 'video/webm' : ep.mime);

/**
 * El capítulo descargado: de la carpeta elegida o de la app; null si no está descargado.
 * Lanza Error('NOFOLDER') / Error('NOFILE') si está en una carpeta que no se puede abrir.
 * @param {Episode} ep
 * @param {boolean} [ask] pedir permiso de la carpeta (solo funciona justo después de un toque)
 * @returns {Promise<Blob | null>}
 */
export async function localBlob(ep, ask = false) {
  if (!state.saved.has(ep.id)) return null;
  const meta = state.dlMeta.get(ep.id) || (await idb.get('dl', ep.id).catch(() => null));
  if (meta && meta.where === 'folder') {
    const dir = await dirAccess(meta.dirKey, ask);
    if (!dir) throw new Error('NOFOLDER');
    try {
      const { file } = await fileAt(dir, meta.rel, false);
      const f = await file.getFile();
      return f.slice(0, f.size, playType(ep)); // sin copiar: solo le pone el tipo
    } catch {
      throw new Error('NOFILE');
    }
  }
  const chunks = await idb.chunks(ep.id);
  if (!chunks.length) return null;
  chunks.sort((/** @type {any} */ a, /** @type {any} */ b) => a.i - b.i);
  return new Blob(
    chunks.map((/** @type {any} */ c) => c.blob),
    { type: playType(ep) },
  );
}

/* ── carpeta de descargas ── */

export const canFolder = typeof (/** @type {any} */ (window).showDirectoryPicker) === 'function';
/** @type {Map<string, any>} */
const handleCache = new Map();
/** @type {any} carpeta actual ya leída (para mostrar su nombre sin esperar) */
let dirHandle = null;
/** La carpeta actual, si ya se leyó (sin esperar). */
export const currentDir = () => dirHandle;

/** @param {string} key */
async function loadHandle(key) {
  if (!key || !canFolder) return null;
  if (!handleCache.has(key)) handleCache.set(key, (await idb.get('subcache', key).catch(() => null)) || null);
  return handleCache.get(key);
}
/** La carpeta elegida (sin revisar el permiso), o null. */
export async function getDir() {
  dirHandle = await loadHandle(LS.get(KEY_DIR, ''));
  return dirHandle;
}
/** 'granted', 'prompt' o 'denied'. @param {any} d */
export async function dirPermission(d) {
  try {
    return await d.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}
/**
 * La carpeta lista para usar, o null. Con `ask` pide permiso (solo funciona justo después de un toque).
 * @param {any} d la carpeta, su clave, o null para la actual
 * @param {boolean} [ask]
 */
export async function dirAccess(d, ask = false) {
  if (typeof d === 'string') d = await loadHandle(d);
  d = d || (await getDir());
  if (!d) return null;
  if ((await dirPermission(d)) === 'granted') return d;
  if (!ask) return null;
  try {
    return (await d.requestPermission({ mode: 'readwrite' })) === 'granted' ? d : null;
  } catch {
    return null;
  }
}
/** Si hay carpeta sin permiso y quien usa Kai acaba de tocar algo, aprovecha para pedirlo. */
export function askFolderIfNeeded() {
  const act = /** @type {any} */ (navigator).userActivation;
  if (!canFolder || !(act && act.isActive)) return;
  getDir().then(async (d) => {
    if (d && (await dirPermission(d)) === 'prompt' && (await dirAccess(d, true))) flushFolder();
  });
}

/** Nombre que sirve en cualquier sistema de archivos. @param {unknown} s */
export const safeName = (s) =>
  String(s || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '') || 'Kai';

/**
 * Ruta dentro de la carpeta: la misma de MEGA sin la carpeta de series, p. ej. Fate/1. Fate UBW/472_0_SUB.mp4
 * @param {{ path?: string, name: string }} ep
 * @param {string} [title] carpeta si el archivo está suelto
 * @returns {string[]}
 */
export function folderRel(ep, title) {
  let p = String(ep.path || ep.name);
  const root = String(state.settings.root || '').replace(/^\/+|\/+$/g, '');
  if (root && p.toLowerCase().startsWith(root.toLowerCase() + '/')) p = p.slice(root.length + 1);
  const parts = p.split('/').filter(Boolean);
  if (parts.length < 2) parts.unshift(title || 'Kai');
  return parts.map(safeName);
}
/** @param {any} dir @param {string[]} rel @param {boolean} create */
async function fileAt(dir, rel, create) {
  let d = dir;
  const dirs = [d];
  for (const part of rel.slice(0, -1)) {
    d = await d.getDirectoryHandle(part, { create });
    dirs.push(d);
  }
  return { dirs, file: await d.getFileHandle(rel[rel.length - 1], { create }) };
}

/** Pasa un capítulo ya descargado en la app a la carpeta. @param {string} id @returns {Promise<boolean>} */
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
    try {
      await w.abort();
    } catch {
      /* ya estaba cerrado */
    }
    throw err;
  }
  Object.assign(meta, { where: 'folder', rel, dirKey: LS.get(KEY_DIR, '') });
  await idb.put('dl', meta);
  state.dlMeta.set(id, meta);
  await idb.dropChunks(id).catch(() => {});
  return true;
}

/** @type {Promise<number> | null} */
let flushing = null;
/** Mueve a la carpeta lo que quedó en la app y borra lo que estaba pendiente de borrar. @returns {Promise<number>} */
export function flushFolder() {
  if (flushing) return flushing;
  flushing = (async () => {
    if (!(await dirAccess(null))) return 0;
    let moved = 0;
    for (const m of await idb.all('dl').catch(() => [])) {
      if (!m.done || m.where === 'folder' || inUse(m.id)) continue;
      try {
        if (await moveToFolder(m.id)) moved++;
      } catch {
        /* queda en la app */
      }
    }
    const left = [];
    for (const t of LS.get(KEY_TRASH, [])) if (!(await deleteFromFolder(t.rel, t.dirKey))) left.push(t);
    LS.set(KEY_TRASH, left);
    if (moved) {
      emit('notice', `${plural(moved, 'capítulo pasó', 'capítulos pasaron')} a tu carpeta.`);
      emit('folder-moved', moved);
    }
    return moved;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/**
 * Borra un archivo de la carpeta y las carpetas de serie y temporada si quedan vacías.
 * @param {string[]} rel @param {any} d la carpeta o su clave
 * @returns {Promise<boolean>} false si no hay permiso ahora
 */
async function deleteFromFolder(rel, d) {
  const dir = await dirAccess(d);
  if (!dir) return false;
  try {
    const { dirs } = await fileAt(dir, rel, false);
    await dirs[dirs.length - 1].removeEntry(rel[rel.length - 1]);
    for (let i = dirs.length - 1; i > 0; i--) {
      // ¿quedó vacía? (basta con ver si tiene una primera entrada)
      const empty = (await dirs[i].keys().next()).done;
      if (!empty) break;
      await dirs[i - 1].removeEntry(rel[i - 1]);
    }
  } catch (err) {
    if (err && /** @type {any} */ (err).name !== 'NotFoundError') return false;
  }
  return true;
}

/** Quita todas las descargas de este dispositivo (lo de la carpeta se borra ahora o cuando haya permiso). */
export async function removeAllDownloads() {
  Object.values(state.dls).forEach((t) => t.ctrl.abort());
  state.queue = [];
  for (const m of await idb.all('dl').catch(() => [])) {
    if (m.where === 'folder' && m.rel && !(await deleteFromFolder(m.rel, m.dirKey)))
      LS.set(KEY_TRASH, [...LS.get(KEY_TRASH, []), { rel: m.rel, dirKey: m.dirKey }]);
  }
  await idb.clear('chunks');
  await idb.clear('dl');
  state.saved.clear();
  state.dlMeta.clear();
}

/** Guarda la carpeta que se eligió (ya con permiso) como la de las descargas. @param {any} d */
export async function useFolder(d) {
  const key = 'kai:carpeta:' + Date.now().toString(36);
  await idb.put('subcache', d, key);
  handleCache.set(key, d);
  LS.set(KEY_DIR, key);
  dirHandle = d;
}
/** Las descargas nuevas vuelven a la app. El acceso guardado se queda: lo usan las que ya están en esa carpeta. */
export function forgetFolder() {
  LS.del(KEY_DIR);
  dirHandle = null;
}

/** Se puede elegir lo que no está descargado ni en camino. */
export const pickable = (ep) =>
  !state.saved.has(ep.id) && !state.dls[ep.id] && !state.queue.some((q) => q.ep.id === ep.id);
