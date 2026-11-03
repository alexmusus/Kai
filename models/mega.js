// @ts-check
/*
 * models/mega.js — la cuenta de MEGA: la sesión, el árbol de carpetas y leer o escribir archivos.
 *
 * Avisos que emite:
 *  - "tree-changed": llegaron cambios de MEGA (un archivo nuevo, borrado, movido…); se avisa 1.5 s después del
 *    último, para no rearmar la biblioteca por cada uno. No avisa por los archivos de datos de Kai (.kai-…).
 */

import { Storage } from '../vendor/mega.js';
import { noteQuota, quotaUntil } from './quota.js';
import { fmtWait, LS, sleep } from '../lib/util.js';
import { emit } from '../lib/events.js';
import { state } from './store.js';

/** @typedef {import('./types.js').MegaNode} MegaNode */

/** Cifrado de MEGA (core.js, cargado antes que los módulos; lo comparte el service worker). */
export const C = window.MegaCore;

const KEY_SESSION = 'session';
const URL_TTL_MS = 20 * 60 * 1000; // los enlaces de descarga de MEGA duran un rato; se piden de nuevo antes
const TREE_EVENTS = ['add', 'delete', 'move', 'update'];

// megajs no conserva el atributo "fa" (miniaturas); lo guardamos al importar cada nodo.
const importFile = Storage.prototype._importFile;
Storage.prototype._importFile = function (/** @type {any} */ f) {
  const file = importFile.call(this, f);
  if (file && f && f.fa) file.fa = f.fa;
  return file;
};

/* ── el árbol ── */

/** @type {Set<string>} borrados por Kai; megajs los quita del árbol cuando MEGA lo confirma */
export const goneNodes = new Set();
/** Lo que Kai borró ya no se muestra, aunque MEGA aún no lo haya confirmado. @param {MegaNode} n */
export const isGone = (n) => goneNodes.has(n.nodeId);
/** Lo que hay dentro de una carpeta, sin lo borrado. @param {MegaNode} n */
export const visibleChildren = (n) => (n.children || []).filter((c) => c.name && !isGone(c));
/** Archivos con ese nombre exacto (puede haber más de uno: MEGA permite nombres repetidos). @param {MegaNode} folder @param {string} name */
export const filesNamed = (folder, name) => visibleChildren(folder).filter((c) => !c.directory && c.name === name);

/**
 * MEGA a veces entrega primero una foto vieja de tus carpetas y enseguida manda los cambios que faltan
 * (por eso al tocar Actualizar se veía unos segundos One Piece y otras series de hace meses). Antes de usar
 * el árbol nuevo se espera a que esos cambios dejen de llegar: 2.5 s sin novedades (máximo 20 s).
 * @param {any} st sesión de megajs
 * @returns {Promise<void>}
 */
export function settleTree(st) {
  return new Promise((/** @type {() => void} */ resolve) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let quiet;
    const done = () => {
      clearTimeout(quiet);
      clearTimeout(cap);
      TREE_EVENTS.forEach((ev) => st.removeListener(ev, bump));
      resolve();
    };
    const bump = () => {
      clearTimeout(quiet);
      quiet = setTimeout(done, 2500);
    };
    const cap = setTimeout(done, 20000);
    TREE_EVENTS.forEach((ev) => st.on(ev, bump));
    bump();
  });
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let treeTimer;
/** Avisa "tree-changed" cuando llegan cambios de MEGA. @param {any} st */
function watchStorage(st) {
  const later = (/** @type {MegaNode | undefined} */ f) => {
    if (f && f.name && f.name.startsWith('.kai-')) return;
    clearTimeout(treeTimer);
    treeTimer = setTimeout(() => emit('tree-changed'), 1500);
  };
  TREE_EVENTS.forEach((ev) => st.on(ev, later));
}

/* ── la sesión ── */

/**
 * Entra a MEGA con correo y contraseña (y el código de 6 dígitos si la cuenta lo pide). Guarda la sesión sin la
 * contraseña. Lanza el error de MEGA si no se pudo (megaMessage lo explica).
 * @param {string} email @param {string} password @param {string | null} [code]
 */
export async function login(email, password, code) {
  /** @type {Record<string, any>} */
  const opts = { email, password, keepalive: true, autoload: true };
  if (code) opts.secondFactorCode = code;
  const st = new Storage(opts);
  await st.ready;
  const json = st.toJSON();
  delete json.options.password;
  delete json.options.secondFactorCode;
  LS.set(KEY_SESSION, json);
  state.storage = st;
  watchStorage(st);
}

/**
 * Vuelve a abrir la sesión guardada y espera a que el árbol esté al día. Devuelve false si no hay sesión o ya se
 * está conectando. Una sesión incompleta (vieja o dañada) lanza Error('ESID'): se pide entrar de nuevo; solo se
 * borra la sesión, el progreso y los perfiles siguen en MEGA.
 */
export async function connect() {
  const sess = LS.get(KEY_SESSION, null);
  if (!sess || state.connecting) return false;
  state.connecting = true;
  try {
    if (!sess.key || !sess.sid || !sess.options) throw new Error('ESID');
    let st;
    try {
      st = Storage.fromJSON(JSON.parse(JSON.stringify(sess)));
    } catch {
      throw new Error('ESID');
    }
    await st.reload(true);
    await settleTree(st);
    st.status = 'ready';
    if (state.storage && state.storage !== st) {
      try {
        state.storage.api.close();
      } catch {
        /* la sesión vieja ya estaba cerrada */
      }
    }
    state.storage = st;
    watchStorage(st);
    return true;
  } finally {
    state.connecting = false;
  }
}

/**
 * Un error de MEGA en palabras para la pantalla. "MFA" quiere decir que falta el código de 6 dígitos.
 * Si es el límite de transferencia, además lo anota (noteQuota).
 * @param {any} err
 */
export function megaMessage(err) {
  if (err && err.code === 'QUOTA') {
    noteQuota(err.timeLeft || 0);
    const until = quotaUntil();
    const m = until ? Math.ceil((until - Date.now()) / 60000) : 0;
    return (
      'Llegaste al límite de transferencia gratuita de MEGA.' +
      (m ? ` Se renueva en ${fmtWait(m)}.` : ' Se renueva solo en unas horas.')
    );
  }
  const msg = String((err && err.message) || err);
  if (/ENOENT|invalid credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/EMFAREQUIRED/.test(msg)) return 'MFA';
  if (/ESID/.test(msg)) return 'Tu sesión de MEGA venció. Vuelve a entrar.';
  if (/EBLOCKED/.test(msg)) return 'MEGA bloqueó esta cuenta. Revísala en mega.nz.';
  if (/ERATELIMIT|EAGAIN|ETEMPUNAVAIL/.test(msg)) return 'MEGA está ocupado. Intenta de nuevo en unos segundos.';
  if (/EOVERQUOTA|Bandwidth|QUOTA|509/.test(msg))
    return 'Llegaste al límite de transferencia gratuita de MEGA. Se renueva solo en unas horas.';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'No hay conexión con MEGA.';
  return 'Algo falló con MEGA: ' + msg;
}

/* ── leer y escribir archivos ── */

/** @type {Map<string, { url: string, at: number }>} enlaces de descarga de MEGA por id */
export const urlCache = new Map();

/**
 * Enlace de descarga de un archivo (cifrado). Lanza Error('EOVERQUOTA') si MEGA no da enlace por el límite.
 * @param {string} id @param {boolean} [fresh] pedir uno nuevo aunque haya uno guardado
 * @returns {Promise<string>}
 */
export async function downloadUrl(id, fresh = false) {
  const c = urlCache.get(id);
  if (!fresh && c && Date.now() - c.at < URL_TTL_MS) return c.url;
  if (!state.storage) await connect();
  if (!state.storage) throw new Error('Sin sesión');
  const r = await state.storage.api.request({ a: 'g', g: 1, ssl: 2, n: id });
  if (r.tl > 0) noteQuota(r.tl);
  if (typeof r.g !== 'string' || !r.g.startsWith('http')) throw new Error('EOVERQUOTA');
  urlCache.set(id, { url: r.g, at: Date.now() });
  return r.g;
}

/**
 * Texto de un archivo de MEGA (UTF-8; si no lo es, Windows-1252 como los .srt viejos).
 * @param {{ id: string, key: string, size?: number }} node
 */
export async function readNodeText(node) {
  const url = await downloadUrl(node.id, true);
  const fk = await C.fileKey(node.key);
  if (!node.size) return '';
  const bytes = await C.readRange(url, fk, 0, node.size - 1);
  const utf8 = new TextDecoder().decode(bytes);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}

/**
 * Lee un JSON de MEGA. Regla de Kai: si no se puede LEER, lanza error — nunca se confunde con "vacío" (eso
 * duplicó perfiles en la v4). Un fallo pasajero se reintenta un par de veces. Si se lee pero está dañado, null.
 * @param {MegaNode} n
 * @param {{ read?: typeof readNodeText, wait?: (ms: number) => Promise<void>, online?: () => boolean }} [io] solo para pruebas
 */
export async function readJson(n, io = {}) {
  const read = io.read || readNodeText;
  const wait = io.wait || sleep;
  const online = io.online || (() => navigator.onLine);
  let text;
  for (let tries = 0; ; tries++) {
    try {
      text = await read({
        id: n.nodeId,
        key: C.bytesToB64u(new Uint8Array(/** @type {ArrayLike<number>} */ (n.key))),
        size: n.size,
      });
      break;
    } catch (err) {
      const quota = /** @type {any} */ (err) && /** @type {any} */ (err).code === 'QUOTA';
      if (tries < 2 && online() && !quota) {
        await wait(1200 * (tries + 1));
        continue;
      }
      const e = new Error(
        'No se pudo leer ' + n.name + ': ' + /** @type {any} */ (err && /** @type {any} */ (err).message),
      );
      /** @type {any} */ (e).cause = err;
      throw e;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Sube un JSON y después borra las copias que reemplaza (primero subir: si falla, lo anterior sigue ahí).
 * @param {any} folder carpeta de megajs
 * @param {string} name
 * @param {unknown} obj
 * @param {any[]} replaced archivos viejos con ese nombre
 */
export async function writeJson(folder, name, obj, replaced) {
  const buf = new TextEncoder().encode(JSON.stringify(obj));
  const fresh = await folder.upload({ name, size: buf.length }, buf).complete;
  for (const n of replaced) {
    if (n === fresh) continue;
    goneNodes.add(n.nodeId);
    await n.delete(true).catch(() => {});
  }
  return fresh;
}
