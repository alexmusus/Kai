// @ts-check
/*
 * models/progress.js — lo visto de cada perfil: el segundo donde quedó cada capítulo, "Más tarde",
 * qué se está viendo ahora (para seguir en otro dispositivo) y cómo se juntan dos copias del progreso.
 *
 * El progreso se guarda por ruta del archivo en state.progress y se sincroniza con MEGA
 * (.kai-progreso-<perfil>.json). Entradas especiales, que se sincronizan y fusionan igual (por `u`):
 *  "@now"                     qué se está viendo, en qué segundo y en qué dispositivo
 *  "@later/<serie>"            la serie está en "Más tarde"; "@later/<serie>/<película>" para una película
 */

import { state, index, saveProgressLocal } from './store.js';
import { LS } from '../lib/util.js';
import { isCollection, collectionItems } from './collections.js';

/** @typedef {import('./types.js').Episode} Episode */
/** @typedef {import('./types.js').Series} Series */
/** @typedef {import('./types.js').Progress} Progress */
/** @typedef {import('./types.js').ProgressMap} ProgressMap */
/** @typedef {import('./collections.js').Movie} Movie */

/** Visto si se llegó a este punto del capítulo (los créditos no hace falta verlos). */
const WATCHED_AT = 0.92;

/**
 * Lo visto de un capítulo. Si está en los dos idiomas, cuenta lo de ambos: el minuto del más reciente y,
 * si cualquiera de los dos se terminó, queda visto.
 * @param {Episode} ep
 * @returns {Progress | undefined}
 */
export function prog(ep) {
  const own = state.progress[ep.path];
  const tw = index.twins.get(ep.path);
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

/**
 * Anota dónde quedó un capítulo. Queda visto si se pide, si ya lo estaba, o si pasó del 92 %.
 * @param {Episode} ep
 * @param {number} t segundo
 * @param {number} d duración
 * @param {boolean} [watched]
 */
export function setProgress(ep, t, d, watched) {
  const cur = state.progress[ep.path] || {};
  const w = watched ?? (cur.w || (d > 0 && t / d > WATCHED_AT));
  state.progress[ep.path] = { t: Math.round(t * 10) / 10, d: Math.round(d || cur.d || 0), w: !!w, u: Date.now() };
  state.dirty = true;
  saveProgressLocal();
}

/**
 * Junta dos copias del progreso: de cada entrada gana la más reciente (`u`). Las entradas sin `u` se ignoran.
 * No cambia ninguna de las dos.
 * @param {ProgressMap} a
 * @param {ProgressMap | null | undefined} b
 * @returns {ProgressMap}
 */
export function mergeProgress(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (!v || typeof v.u !== 'number') continue;
    if (!out[k] || v.u > out[k].u) out[k] = v;
  }
  return out;
}

/* ── este dispositivo: para "Seguir en otro dispositivo" ── */

/** Id de este navegador (al azar, se guarda la primera vez). */
export const DEVICE = (() => {
  let d = LS.get('device', null);
  if (!d) {
    d = Math.random().toString(36).slice(2, 10);
    LS.set('device', d);
  }
  return /** @type {string} */ (d);
})();

/** "iPhone", "Mac", "PC"… para decir dónde quedó algo a medias. */
export function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'teléfono Android' : 'tablet Android';
  if (/Windows/.test(ua)) return 'PC';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'otro dispositivo';
}

/** Anota qué se está viendo aquí y en qué segundo. @param {Episode} ep @param {number} t @param {number} d */
export function markNow(ep, t, d) {
  const p = prog(ep);
  state.progress['@now'] = {
    p: ep.path,
    t: Math.round(t),
    d: Math.round(d || 0),
    w: !!(p && p.w),
    dev: DEVICE,
    dn: deviceName(),
    u: Date.now(),
  };
}

/**
 * Lo que este perfil dejó a medias en OTRO dispositivo hace poco (menos de 12 h), si conviene ofrecer seguir aquí:
 * no si ya se vio, si fueron menos de 15 s, si ya se descartó, o si aquí se está reproduciendo algo.
 * @param {boolean} busy ¿se está reproduciendo algo aquí?
 */
export function resumeOffer(busy) {
  const n = state.progress['@now'];
  if (!n || !n.p || n.dev === DEVICE || n.w || (n.t || 0) < 15 || Date.now() - n.u > 12 * 3600000) return null;
  if (busy || LS.get('nowSeen', 0) === n.u) return null;
  const e = index.byPath.get(n.p);
  if (!e || !state.library) return null; // ya no está en MEGA
  const p = prog(e.ep);
  if (p && p.w) return null;
  return { ep: e.ep, s: state.library.series[e.si], n };
}

/* ── Más tarde ── */

/** @param {{ name: string }} s @param {string} [itemKey] una película de la colección */
export const laterKey = (s, itemKey = '') => `@later/${s.name}${itemKey ? '/' + itemKey : ''}`;
/** @param {{ name: string }} s @param {string} [itemKey] */
export const isLater = (s, itemKey = '') => !!(state.progress[laterKey(s, itemKey)] || {}).on;

/** Marca o quita de "Más tarde" (queda por sincronizar). @param {{ name: string }} s @param {string} itemKey @param {boolean} on */
export function setLaterFlag(s, itemKey, on) {
  state.progress[laterKey(s, itemKey)] = { on: !!on, u: Date.now() };
  state.dirty = true;
  saveProgressLocal();
}

/**
 * Lo marcado para más tarde que sigue en MEGA y sin terminar, lo más reciente primero.
 * @returns {{ s: Series, si: number, it: Movie | null, u: number }[]}
 */
export function laterList() {
  const lib = state.library;
  if (!lib || lib.v !== 2) return [];
  /** @type {{ s: Series, si: number, it: Movie | null, u: number }[]} */
  const out = [];
  lib.series.forEach((s, si) => {
    const items = isCollection(s) ? collectionItems(s) : [null];
    for (const it of items) {
      const v = state.progress[laterKey(s, it ? it.key : '')];
      if (!v || !v.on) continue;
      const eps = it ? it.eps : s.all || [];
      if (eps.length && eps.every((e) => (prog(e) || {}).w)) continue; // ya lo vio todo
      out.push({ s, si, it, u: v.u });
    }
  });
  return out.sort((a, b) => b.u - a.u);
}

/**
 * "Continuar viendo": de cada serie, el último capítulo que se tocó; si ya se terminó, el siguiente sin ver.
 * Lo más reciente primero.
 * @returns {{ series: Series, ep: Episode, p: Progress | null, u: number }[]}
 */
export function continueList() {
  if (!state.library || state.library.v !== 2) return [];
  /** @type {{ series: Series, ep: Episode, p: Progress | null, u: number }[]} */
  const out = [];
  for (const s of state.library.series) {
    const all = s.all || [];
    /** @type {{ ep: Episode, p: Progress } | null} */
    let best = null;
    for (const ep of all) {
      const p = prog(ep);
      if (p && (!best || p.u > best.p.u)) best = { ep, p };
    }
    if (!best) continue;
    let ep = best.ep;
    /** @type {Progress | null} */
    let p = best.p;
    if (p.w) {
      const next = all.slice(all.indexOf(ep) + 1).find((x) => !(prog(x) || {}).w);
      if (!next) continue;
      ep = next;
      p = prog(ep) || null;
    }
    out.push({ series: s, ep, p, u: best.p.u });
  }
  return out.sort((a, b) => b.u - a.u);
}

/**
 * Los próximos `n` capítulos sin ver después de `ep` en la lista (para "descargar los 3 siguientes").
 * @param {Episode} ep @param {Episode[]} list @param {number} n
 */
export function nextUnseen(ep, list, n) {
  const i = list.findIndex((x) => x.id === ep.id);
  return list
    .slice(i + 1)
    .filter((x) => !(prog(x) || {}).w)
    .slice(0, n);
}
