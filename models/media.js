// @ts-check
/*
 * models/media.js — lo que Kai lee de cada video sin reproducirlo:
 *  - leer por rangos (del archivo descargado o de MEGA, descifrando al vuelo),
 *  - el códec de cada video (para la etiqueta "H.264", "AV1"…),
 *  - si este navegador puede reproducir ese formato y, si no, por qué y qué hacer,
 *  - los capítulos del MP4 ("Intro", "Parte A") guardados para verlos sin conexión.
 */

import { LS } from '../lib/util.js';
import { mp4QuickFormats, mp4Info, mp4Chapters } from './mp4.js';
import { idb } from './idb.js';
import { C, downloadUrl } from './mega.js';
import { localBlob } from './downloads.js';
import { learnAudioLang } from './library.js';

/** @typedef {import('./types.js').Episode} Episode */
/** @typedef {{ video: any, audio: any }} Formats códecs de video y audio de un archivo */
/** @typedef {(start: number, end: number) => Promise<Uint8Array>} RangeRead */

/* ── códec de cada video ──
 * Se lee una sola vez por archivo (solo el principio del índice del MP4) y se guarda. Si este dispositivo lo puede
 * reproducir se decide aparte (formatProblem): el mismo AV1 se ve en el iPhone y no en un iPad M2. */
const KEY_CODECS = 'codecs';
/** @type {Record<string, Formats>} */
const codecCache = LS.get(KEY_CODECS, {}) || {};
const codecKey = (/** @type {Episode} */ ep) => `${ep.id}:${ep.size}`;

/** El códec ya leído, o undefined. @param {Episode} ep */
export const knownCodec = (ep) => codecCache[codecKey(ep)];
/** Guarda el códec leído (también lo usa el reproductor cuando lee el formato completo). @param {Episode} ep @param {Formats} f */
export function rememberCodec(ep, f) {
  codecCache[codecKey(ep)] = { video: f.video, audio: f.audio };
  LS.set(KEY_CODECS, codecCache);
  return codecCache[codecKey(ep)];
}

/** Lee el códec (solo el principio del índice del MP4), o lo que ya se sabía. @param {Episode} ep */
export async function readCodec(ep) {
  const known = knownCodec(ep);
  if (known) return known;
  const f = await mp4QuickFormats(await rangeReader(ep), ep.size);
  return f ? rememberCodec(ep, f) : null;
}

/** Guarda los capítulos del MP4 (sin Infinity, que no se puede guardar). @param {Episode} ep @param {any[] | null} chapters */
export function saveChapterCache(ep, chapters) {
  const list = (chapters || []).map((c) => ({ ...c, end: isFinite(c.end) ? c.end : null }));
  idb.put('subcache', { v: 3, chapters: list, at: Date.now() }, ep.id).catch(() => {});
}

/**
 * Lector por rangos: del archivo descargado (si se pasa) o de MEGA descifrando al vuelo; si el enlace de MEGA
 * venció, pide otro y reintenta una vez.
 * @param {Episode} ep
 * @param {Blob | null} [blob] el archivo descargado
 * @param {AbortSignal} [signal]
 * @returns {Promise<RangeRead>}
 */
export async function rangeReader(ep, blob = null, signal) {
  if (blob) return async (a, b) => new Uint8Array(await blob.slice(a, b + 1).arrayBuffer());
  const fk = await C.fileKey(ep.key);
  let url = await downloadUrl(ep.id);
  return async (a, b) => {
    try {
      return await C.readRange(url, fk, a, b, signal);
    } catch (err) {
      if (/** @type {any} */ (err).code !== 'HTTP') throw err;
      url = await downloadUrl(ep.id, true);
      return C.readRange(url, fk, a, b, signal);
    }
  };
}

/** Después de descargar un capítulo, deja listos sus capítulos para verlo sin conexión. @param {Episode} ep */
export async function cacheChapters(ep) {
  const have = await idb.get('subcache', ep.id).catch(() => null);
  if (have && have.v === 3) return;
  const blob = await localBlob(ep);
  if (!blob || !/mp4|quicktime/.test(ep.mime)) return;
  const read = async (a, b) => new Uint8Array(await blob.slice(a, b + 1).arrayBuffer());
  const info = await mp4Info(read, ep.size);
  learnAudioLang(ep, info.audioLang);
  saveChapterCache(ep, await mp4Chapters(info, read, null));
}

/* ── formato del video: por qué un navegador no puede reproducir un archivo ── */
export const isSafariUA =
  /Safari\//.test(navigator.userAgent) && !/Chrome|CriOS|Chromium|Edg|Android|FxiOS/.test(navigator.userAgent);
/** @type {HTMLVideoElement | null} */
let probe = null;
/** ¿Este navegador reproduce ese tipo exacto ("video/mp4; codecs=…")? @param {string} type */
export function canPlay(type) {
  try {
    probe = probe || document.createElement('video');
    return !!probe.canPlayType(type) || !!(window.MediaSource && MediaSource.isTypeSupported(type));
  } catch {
    return false;
  }
}
/** Si el formato del archivo no se puede reproducir en este navegador: { what, fix }; si no, null.
 * Se le pregunta al propio navegador por el códec exacto, así el aviso vale para cada dispositivo. */
const hex2 = (/** @type {number} */ n) => (n & 255).toString(16).padStart(2, '0').toUpperCase();
/** @param {Formats | null | undefined} f @returns {{ what: string, fix: string } | null} */
export function formatProblem(f) {
  if (!f || !f.video) return null;
  const v = f.video;
  const a = f.audio || {};
  const elsewhere = isSafariUA ? 'En Chrome de la PC quizá sí se vea.' : 'Prueba en otro navegador o dispositivo.';
  if (/^avc[13]$/.test(v.codec)) {
    if (!canPlay(`video/mp4; codecs="avc1.${hex2(v.profile || 100)}0028"`)) {
      return v.bits > 8
        ? {
            what: 'H.264 de 10 bits (Hi10P)',
            fix: `Este navegador no reproduce ese formato. ${elsewhere} Lo seguro es la versión en H.264 normal (8 bits).`,
          }
        : { what: `H.264 (perfil ${v.profile})`, fix: `Este navegador no reproduce ese perfil de H.264. ${elsewhere}` };
    }
  } else if (/^(hev1|hvc1)$/.test(v.codec)) {
    const what = `HEVC (H.265)${v.bits > 8 ? ' de 10 bits' : ''}`;
    if (v.codec === 'hev1' && isSafariUA)
      return {
        what: what + ' marcado como "hev1"',
        fix: 'Safari solo acepta HEVC marcado como "hvc1". Se arregla sin perder calidad: ffmpeg -i entrada.mp4 -c copy -tag:v hvc1 salida.mp4',
      };
    if (!canPlay(`video/mp4; codecs="hvc1.${v.bits > 8 ? '2.4.L120' : '1.6.L93'}.B0"`))
      return {
        what,
        fix: `Este navegador no reproduce HEVC en este equipo. ${isSafariUA ? '' : 'Safari en iPhone, iPad y Mac sí.'}`.trim(),
      };
  } else if (v.codec === 'av01') {
    if (!canPlay(`video/mp4; codecs="av01.0.08M.${v.bits > 8 ? '10' : '08'}"`))
      return { what: 'AV1', fix: `Este dispositivo no reproduce AV1. ${elsewhere}` };
  } else if (
    !canPlay(
      `video/mp4; codecs="${{ vp09: `vp09.00.10.${v.bits > 8 ? '10' : '08'}`, vp08: 'vp8', mp4v: 'mp4v.20.8' }[v.codec] || v.codec}"`,
    )
  ) {
    const names = { mp4v: 'MPEG-4 Part 2 (XviD/DivX)', mp2v: 'MPEG-2', vp08: 'VP8' };
    return {
      what: names[v.codec] || `el formato "${v.codec}"`,
      fix: 'Este navegador no reproduce ese formato de video. Hace falta la versión en H.264.',
    };
  }
  if (/^(ac-3|ec-3)$/.test(a.codec) && !canPlay(`audio/mp4; codecs="${a.codec}"`)) {
    return {
      what: `audio Dolby (${a.codec === 'ec-3' ? 'E-AC-3' : 'AC-3'})`,
      fix: `Este navegador no reproduce ese audio. ${isSafariUA ? '' : 'Safari y Edge sí.'}`.trim(),
    };
  }
  if (/^dts/i.test(a.codec || ''))
    return { what: 'audio DTS', fix: 'Los navegadores no reproducen audio DTS. Hace falta una versión con audio AAC.' };
  return null;
}
/** Una línea con el formato, para el detalle del aviso. @param {Formats | null | undefined} f */
export function formatSummary(f) {
  if (!f) return 'formato no leído';
  const v = f.video;
  const vs = v ? `${v.codec}${v.profile ? ' perfil ' + v.profile : ''}, ${v.bits} bits` : 'sin video';
  return `video ${vs}; audio ${(f.audio && f.audio.codec) || 'ninguno'}`;
}
