// @ts-check
/*
 * models/plans.js — qué toca ver ahora: el capítulo siguiente de una serie, de una temporada o de una película,
 * y el texto del botón ("Continuar Episodio 6", "Ver Temporada 2", "Ver de nuevo").
 */

import { prog, continueList } from './progress.js';
import { index } from './store.js';
import { isCollection, episodeLabel, collectionItems, itemMeta, movieTitle } from './collections.js';
import { seasonLabel } from './fichas.js';
import { fmtLeft, fmtTime } from '../lib/util.js';

/** @typedef {import('./types.js').Episode} Episode */
/** @typedef {import('./types.js').Series} Series */
/** @typedef {import('./types.js').Season} Season */
/** @typedef {import('./types.js').Progress} Progress */

/** Segundo donde quedó (0 si no hay). @param {Progress | null | undefined} p */
const at = (p) => (p && p.t) || 0;
/** ¿Quedó a medias? (más de 5 s y sin terminar) @param {Progress | null | undefined} p @returns {p is Progress} */
const halfway = (p) => !!p && at(p) > 5 && !p.w;

export function heroPlan(s) {
  const next = nextFor(s);
  const np = next ? prog(next) : undefined;
  const resume = halfway(np);
  // al empezar otra temporada se dice cuál ("Ver Fate Zero"), no "Ver Episodio 1"
  const e = next && index.byId.get(next.id);
  const startsSeason = e && !isCollection(s) && s.seasons.length > 1 && e.ei === 0 && !resume;
  const label = !next
    ? 'Serie terminada'
    : startsSeason
      ? `Ver ${seasonLabel(s, s.seasons[e.ki])}`
      : `${resume ? 'Continuar' : 'Ver'} ${episodeLabel(next)}`;
  return { next, label, left: halfway(np) ? fmtLeft(np) : '' };
}
/** Lo siguiente dentro de UNA temporada (la pestaña que estás mirando). @param {Series} s @param {Season} se */
export function seasonPlan(s, se) {
  /** @type {{ ep: Episode, p: Progress } | null} */
  let cur = null;
  for (const ep of se.episodes) {
    const p = prog(ep);
    if (halfway(p) && (!cur || p.u > cur.p.u)) cur = { ep, p };
  }
  const next = cur ? cur.ep : se.episodes.find((e) => !(prog(e) || {}).w) || null;
  if (!next) return { next: null, label: 'Temporada vista', left: '' };
  const np = prog(next);
  const resume = halfway(np);
  return { next, label: `${resume ? 'Continuar' : 'Ver'} ${episodeLabel(next)}`, left: halfway(np) ? fmtLeft(np) : '' };
}

/** Lo siguiente que conviene ver de una película (o de sus partes) y cómo decirlo en el botón. @param {import('./collections.js').Movie} it */
export function moviePlan(it) {
  const eps = it.eps;
  const next = eps.find((e) => !(prog(e) || {}).w) || null;
  const ep = next || eps[0];
  const p = prog(ep);
  const part = eps.length > 1 ? ` parte ${eps.indexOf(ep) + 1}` : '';
  const label = !next ? 'Ver de nuevo' : at(p) > 5 ? `Continuar${part} en ${fmtTime(at(p))}` : `Ver${part}`;
  const pct = p && p.d ? (p.w ? 100 : Math.min(100, (at(p) / p.d) * 100)) : 0;
  return { ep, label, pct, seen: !next, left: next && p && at(p) > 5 ? fmtLeft(p) : '' };
}

/** Las películas de la colección, en orden alfabético (v37; antes, las más recientes primero). */
export function shelfItems(s) {
  return collectionItems(s)
    .map((it) => ({
      it,
      m: itemMeta(s, it.key),
      plan: moviePlan(it),
      added: Math.max(0, ...it.eps.map((e) => e.ts || 0)),
    }))
    .sort((a, b) => movieTitle(s, a.it).localeCompare(movieTitle(s, b.it), 'es', { numeric: true }));
}

export function nextFor(s) {
  const c = continueList().find((x) => x.series === s);
  if (c) return c.ep;
  if (s.all.every((e) => (prog(e) || {}).w)) return null;
  return s.all.find((e) => !(prog(e) || {}).w) || s.all[0];
}
