// @ts-check
/*
 * models/discover.js — Descubrir: "Porque viste…" (recomendaciones de AniList según tus series de MEGA; las que ya
 * empezaste pesan el doble) y "En emisión" (lo que está saliendo con buena nota). Se guarda un rato en el navegador.
 */

import { state } from './store.js';
import { isAside, isCollection, collectionItems, itemMeta } from './collections.js';
import { movieHref } from '../lib/route.js';
import { metaFor, seasonMeta } from './fichas.js';
import { LS } from '../lib/util.js';
import { airingTop, toDiscover, recommendationsFor } from './meta-api.js';
import { prog } from './progress.js';
import { translateMissing } from './fichas-sync.js';

// sube cuando cambia qué se muestra en Descubrir, para no enseñar una lista guardada con lo de antes
const DISCOVER_V = 2;
export const discoverFresh = (d) => !!(d && d.v === DISCOVER_V && d.items && d.items.length);
export const DISCOVER = {
  porque: { title: 'Porque viste…', ttl: 24 * 3600000 },
  emision: { title: 'En emisión', ttl: 6 * 3600000 },
};
/** Lo que tienes en MEGA, por id de AniList → a dónde lleva en Kai. */
export function ownedIds() {
  const out = new Map();
  const lib = state.library;
  if (!lib || lib.v !== 2) return out;
  lib.series.forEach((s, si) => {
    if (isAside(s)) return;
    if (isCollection(s)) {
      for (const it of collectionItems(s)) {
        const m = itemMeta(s, it.key);
        if (m && m.id) out.set(m.id, movieHref(si, it.key));
      }
    } else {
      const m = metaFor(s);
      if (m && m.id) out.set(m.id, '#/serie/' + si);
      for (const se of s.seasons) {
        const sm = seasonMeta(s, se);
        if (sm && sm.id) out.set(sm.id, '#/serie/' + si);
      }
    }
  });
  return out;
}
/** @type {Promise<any> | null} */
let discoverJob = null;
/**
 * La lista de Descubrir (de la caché si está al día).
 * @param {'porque' | 'emision'} kind
 * @param {boolean} [force] volver a pedirla aunque esté al día
 */
export async function loadDiscover(kind, force = false) {
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
      if (lib && lib.v === 2)
        for (const s of lib.series) {
          if (isCollection(s)) continue;
          const m = metaFor(s);
          if (!m || !m.id) continue;
          // "ya la empezaste": vista, o más de un minuto de algún capítulo
          const watched = (s.all || []).some((e) => {
            const p = prog(e);
            return !!p && (!!p.w || (p.t || 0) > 60);
          });
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
      items = [...score.values()]
        .sort((a, b) => b.pts - a.pts)
        .slice(0, 30)
        .map((r) => ({
          ...toDiscover(r.m),
          because: r.from
            .sort((a, b) => b.pts - a.pts)
            .slice(0, 2)
            .map((x) => x.name),
        }));
    }
    const out = { v: DISCOVER_V, at: Date.now(), items };
    const store = LS.get('discover', {}) || {};
    store[kind] = out;
    LS.set('discover', store);
    setTimeout(translateMissing, 1000);
    return out;
  })().finally(() => {
    discoverJob = null;
  });
  return discoverJob;
}
