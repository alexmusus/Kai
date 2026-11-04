// @ts-check
/*
 * models/news.js — lo nuevo en MEGA, por perfil y por dispositivo:
 *  - "known": los capítulos que este perfil ya conocía de cada serie (lo demás lleva la burbuja de "nuevo").
 *  - Novedades: la lista de Ajustes → Novedades, con un puntito en el menú hasta que se mira.
 * Avisa con el evento "news" cuando cambia lo que hay sin leer.
 */

import { emit } from '../lib/events.js';
import { pkey, state } from './store.js';
import { LS } from '../lib/util.js';

/** @typedef {import('./types.js').Series} Series */

/** @typedef {Record<string, string[]>} KnownMap serie → ids de capítulos que el perfil ya conocía */

// se lee una vez y se guarda en memoria: antes se volvía a leer (y descifrar el JSON) por cada serie
/** @type {{ key: string | null, val: KnownMap | null }} */
let knownCache = { key: null, val: null };
/** @returns {KnownMap | null} null si este perfil todavía no tiene la lista (la primera vez) */
export function knownMap() {
  const key = pkey('known');
  if (knownCache.key !== key) knownCache = { key, val: LS.get(key, null) };
  return knownCache.val;
}
/** @param {KnownMap} k */
export function saveKnown(k) {
  knownCache = { key: pkey('known'), val: k };
  LS.set(pkey('known'), k);
}
/** La primera vez, todo lo que hay se da por conocido (si no, todo saldría como nuevo). */
export function initKnown() {
  if (!state.profile || !state.library || !state.library.series || knownMap()) return;
  saveKnown(Object.fromEntries(state.library.series.map((s) => [s.name, (s.full || s.all || []).map((e) => e.id)])));
}
/** Capítulos de la serie que este perfil todavía no conocía. @param {Series} s */
export function newEpisodes(s) {
  const k = knownMap();
  if (!k) return [];
  const set = new Set(k[s.name] || []);
  return (s.all || []).filter((e) => !set.has(e.id));
}
/** Todo lo de la serie pasa a conocido (se quita la burbuja). @param {Series} s */
export function markSeriesSeen(s) {
  const k = { ...(knownMap() || {}) };
  k[s.name] = [...new Set([...(k[s.name] || []), ...(s.full || s.all || []).map((e) => e.id)])];
  saveKnown(k);
}
/* Novedades: lo nuevo que llega a MEGA ya no sale como aviso en el inicio; se anota en Ajustes → Novedades
 * y el botón del menú muestra un puntito hasta que se mira. Por perfil y por dispositivo. */
const NEWS_DAYS = 30;
export function newsList() {
  const l = LS.get(pkey('news'), []);
  return (Array.isArray(l) ? l : []).filter((x) => x && x.name && Date.now() - (x.at || 0) < NEWS_DAYS * 86400000);
}
export function noteNews(name, n) {
  const l = newsList().filter((x) => x.name !== name);
  l.unshift({ name, n, at: Date.now() });
  LS.set(pkey('news'), l.slice(0, 60));
  LS.set(pkey('newsUnread'), true);
}
export const hasUnreadNews = () => !!(state.profile && LS.get(pkey('newsUnread'), false) && newsList().length);

/* Se recuerda qué capítulos ya se anunciaron (por su id), no cuántos había: así, si MEGA entrega la lista
 * a medias al abrir (unos segundos con menos capítulos), al completarse no se vuelve a anunciar lo mismo. */
const NEWS_IDS_MAX = 4000;
export function announceNew() {
  if (!state.library || !state.library.series || !state.profile) return;
  const told = LS.get(pkey('newsIds'), null);
  const first = !Array.isArray(told);
  const seen = new Set(first ? [] : told);
  const added = [];
  for (const s of state.library.series) {
    const fresh = newEpisodes(s);
    const unseen = fresh.filter((e) => !seen.has(e.id));
    if (!unseen.length) continue;
    unseen.forEach((e) => {
      seen.add(e.id);
      added.push(e.id);
    });
    // la primera vez (al pasar a esta versión) solo se toma nota, sin anunciar lo que ya se avisó antes
    if (!first) noteNews(s.name, fresh.length);
  }
  if (first || added.length) LS.set(pkey('newsIds'), [...seen].slice(-NEWS_IDS_MAX));
  emit('news');
}

/** Se miraron las novedades (Ajustes): se quita el puntito. */
export function markNewsRead() {
  LS.set(pkey('newsUnread'), false);
  emit('news');
}
