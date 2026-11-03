// @ts-check
/*
 * models/thumbs.js — miniaturas de MEGA (el atributo "fa" de cada video): se piden a MEGA, se descifran y se guardan
 * en IndexedDB. Máximo 3 a la vez; cada capítulo se pide una sola vez por sesión.
 */

import { idb } from './idb.js';
import { state } from './store.js';
import { C } from './mega.js';

/** @type {Map<string, Promise<string | null>>} id → URL de la imagen (blob:) */
const thumbUrls = new Map();
/** @type {Map<string, string>} id → URL ya lista, para dibujarla sin esperar (al volver a una página) */
const readyUrls = new Map();
/** @type {(() => Promise<void>)[]} */
const thumbQueue = [];
let thumbActive = 0;

/**
 * URL (blob:) de la miniatura de un capítulo, o null si no tiene o no se pudo.
 * @param {import('./types.js').Episode | null | undefined} ep
 * @returns {Promise<string | null>}
 */
export function thumbFor(ep) {
  if (!ep || !ep.fa) return Promise.resolve(null);
  const known = thumbUrls.get(ep.id);
  if (known) return known;
  /** @type {Promise<string | null>} */
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
  p.then((u) => {
    if (u) readyUrls.set(ep.id, u);
    else thumbUrls.delete(ep.id);
  });
  return p;
}

/** La miniatura de un capítulo si ya está lista en esta sesión (sin esperar), o ''. @param {string} id */
export const thumbReady = (id) => readyUrls.get(id) || '';

function pumpThumbs() {
  while (thumbActive < 3 && thumbQueue.length) {
    const job = /** @type {() => Promise<void>} */ (thumbQueue.shift());
    thumbActive++;
    job().finally(() => {
      thumbActive--;
      pumpThumbs();
    });
  }
}

/** Pide la miniatura a MEGA y la descifra. @param {import('./types.js').Episode} ep @returns {Promise<Blob | null>} */
async function fetchThumb(ep) {
  // "fa" es una lista "123:1*hash/124:0*hash": el tipo 1 es la vista previa grande, el 0 la miniatura
  const attrs = [];
  for (const part of String(ep.fa).split('/')) {
    const m = /(\d+):(\d+)\*([\w-]+)/.exec(part);
    if (m) attrs.push({ type: Number(m[2]), h: m[3] });
  }
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
