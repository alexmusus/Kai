/*
 * core.js — cifrado de MEGA, compartido por la página y el service worker.
 *
 * MEGA cifra cada archivo con AES-128-CTR. La clave de nodo (32 bytes) contiene:
 *   clave AES = k[0..16] XOR k[16..32],  nonce = k[16..24]
 * El contador es nonce (8 bytes) || número de bloque de 16 bytes (64 bits, big-endian),
 * así que se puede descifrar cualquier rango del archivo sin leer lo anterior.
 */
(function (g) {
  'use strict';

  function b64uToBytes(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/,/g, '');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64u(u) {
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    }
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  const keyCache = new Map();

  function fileKey(k32) {
    if (keyCache.has(k32)) return keyCache.get(k32);
    const p = (async () => {
      const k = b64uToBytes(k32);
      if (k.length !== 32) throw new Error('Clave de archivo inválida');
      const raw = new Uint8Array(16);
      for (let i = 0; i < 16; i++) raw[i] = k[i] ^ k[i + 16];
      const nonce = k.slice(16, 24);
      const ctrKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-CTR' }, false, ['decrypt']);
      const cbcKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
      return { ctrKey, cbcKey, nonce };
    })();
    keyCache.set(k32, p);
    if (keyCache.size > 200) keyCache.delete(keyCache.keys().next().value);
    return p;
  }

  function counterAt(nonce, block) {
    const c = new Uint8Array(16);
    c.set(nonce, 0);
    const dv = new DataView(c.buffer);
    dv.setUint32(8, Math.floor(block / 4294967296));
    dv.setUint32(12, block >>> 0);
    return c;
  }

  /** Descifra `data` que empieza en `offset` (múltiplo de 16) del archivo. */
  async function decryptAt(fk, data, offset) {
    if (offset % 16) throw new Error('offset no alineado');
    const out = await crypto.subtle.decrypt(
      { name: 'AES-CTR', counter: counterAt(fk.nonce, offset / 16), length: 64 },
      fk.ctrKey, data);
    return new Uint8Array(out);
  }

  function megaError(status, headers) {
    const e = new Error(status === 509 ? 'Límite de transferencia de MEGA alcanzado' : 'MEGA respondió ' + status);
    e.code = status === 509 ? 'QUOTA' : 'HTTP';
    e.status = status;
    const tl = headers && headers.get('x-mega-time-left');
    if (tl) e.timeLeft = +tl;
    return e;
  }

  /** Descarga cifrado el rango [start, end] (inclusivo) de una URL de descarga de MEGA. */
  async function fetchRange(url, start, end, signal) {
    const r = await fetch(url + '/' + start + '-' + end, { signal, cache: 'no-store' });
    if (!r.ok) throw megaError(r.status, r.headers);
    return new Uint8Array(await r.arrayBuffer());
  }

  /** Devuelve los bytes descifrados del rango [start, end] (inclusivo). */
  async function readRange(url, fk, start, end, signal) {
    const aligned = start - (start % 16);
    const enc = await fetchRange(url, aligned, end, signal);
    const dec = await decryptAt(fk, enc, aligned);
    return dec.subarray(start - aligned);
  }

  /**
   * AES-CBC con IV en cero y sin relleno (atributos de archivo como miniaturas).
   * WebCrypto exige relleno PKCS#7, así que se añade un bloque final que al
   * descifrarse produce relleno válido y se descarta solo.
   */
  async function cbcDecryptNoPad(fk, data) {
    if (data.length % 16) {
      const padded = new Uint8Array(Math.ceil(data.length / 16) * 16);
      padded.set(data);
      data = padded;
    }
    const last = data.subarray(data.length - 16);
    const pad = new Uint8Array(16).fill(16);
    const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: last }, fk.cbcKey, pad));
    const full = new Uint8Array(data.length + 16);
    full.set(data);
    full.set(enc.subarray(0, 16), data.length);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, fk.cbcKey, full));
  }

  g.MegaCore = { b64uToBytes, bytesToB64u, fileKey, decryptAt, fetchRange, readRange, cbcDecryptNoPad };
})(typeof self !== 'undefined' ? self : globalThis);
