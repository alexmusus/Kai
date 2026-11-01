// @ts-check
/*
 * models/fichas.js — leer las fichas de AniList/TMDB que Kai ya tiene (state.meta) y los nombres de las temporadas.
 * Buscar fichas nuevas, traducir sinopsis y compartirlas por MEGA está en fichas-sync.js.
 *
 * Claves de state.meta: el nombre de la serie ("Dorohedoro"), o "Serie/Carpeta" para una temporada o una película.
 * Una ficha con `none: true` quiere decir "se buscó y no se encontró" (no se vuelve a buscar enseguida).
 *
 * Qué ficha usa cada cosa:
 *  - Una serie con UNA temporada (o tipo "1. Temporada 1"): la de la carpeta de la serie.
 *  - Con varias temporadas, cada temporada que tiene nombre propio ("2. Fate Zero", "1.5 Prólogo UBW") tiene su propia
 *    ficha. Las genéricas ("2. Temporada 2") buscan "Serie Season 2"; si no la encuentran, usan la de la serie.
 *  - Si la primera temporada tiene nombre propio, la carpeta de la serie es solo el nombre del grupo ("Fate"): no se
 *    busca, y la serie se muestra con la ficha de la temporada que estás viendo (o la primera).
 */

import { state, index } from './store.js';
import { itemMetaKey, isCollection, collectionItems, isCine, itemMeta } from './collections.js';
import {
  isSpecialSeason,
  MAIN_FORMATS,
  isBareSpecial,
  afterSeriesName,
  spanishSeason,
  specialWord,
  seasonTab,
  hasOwnTitle,
} from './naming.js';
import { seasonNumOf } from './meta-api.js';
import { LS } from '../lib/util.js';
import { prog } from './progress.js';

/** La ficha propia de la temporada (sin usar la de la serie). */
export function ownSeasonMeta(s, se) {
  const m = se && se.name && state.meta[itemMetaKey(s, se.name)];
  return m && !m.none ? m : null;
}
/** ¿Es una temporada (serie) o un especial (OVA, especial, película)? */
export function isMainSeason(s, se) {
  if (isSpecialSeason(se)) return false;
  const m = ownSeasonMeta(s, se);
  return m && m.format ? MAIN_FORMATS.has(m.format) : true;
}
/* Nombres de las tarjetas de temporada (v37): manda lo que AniList dice que es cada carpeta, no cómo se llama.
 *  - Serie de TV (o sin ficha y sin "OVA" en el nombre) → "Temporada N", contando solo las temporadas;
 *    el número que dice la carpeta o AniList ("2nd Season") se respeta; "Part 2" o carpetas con el mismo número → "· Parte 2".
 *  - OVA, especial o película → su subtítulo ("Memory Snow"); si no tiene, "OVA" / "Especial" / "Película".
 *  Dentro de la temporada se muestra el nombre completo de AniList. */
const labelMemo = new WeakMap();
export function seasonLabels(s) {
  const key = s.seasons
    .map((se) => {
      const m = ownSeasonMeta(s, se);
      return `${se.name}|${m ? m.id + (m.format || '') : ''}`;
    })
    .join('/');
  const hit = labelMemo.get(s);
  if (hit && hit.key === key) return hit.map;
  const map = new Map();
  let prev = 0;
  for (const se of s.seasons) {
    const m = ownSeasonMeta(s, se);
    if (!isMainSeason(s, se)) {
      // sin la palabra del tipo al final ("… Heavens Feel Película" → "Heavens Feel")
      const rest = isBareSpecial(s, se)
        ? ''
        : afterSeriesName(s, se.title || se.name)
            .replace(/[([][^)\]]*[)\]]/g, ' ')
            .replace(
              /[\s.\-–:,]*\b(ovas?|oads?|onas?|especial(es)?|specials?|pel[ií]culas?|movies?|films?)\s*\d{0,2}\s*$/i,
              '',
            )
            .replace(/\s+/g, ' ')
            .trim();
      map.set(se, rest ? spanishSeason(rest[0].toUpperCase() + rest.slice(1)) : specialWord(se, m));
      continue;
    }
    const texts = [se.title, m && m.romaji, m && m.title].filter(Boolean);
    let part = null;
    for (const t of texts) {
      const p = /\b(?:part|parte|cour)\s*(\d{1,2})\b/i.exec(t);
      if (p) {
        part = Number(p[1]);
        break;
      }
    }
    let n = null;
    for (const t of texts) {
      const x = seasonNumOf(t);
      if (x) {
        n = x;
        break;
      }
    }
    const twins = s.seasons.filter((x) => x.num != null && x.num === se.num);
    if (twins.length > 1 && part == null) part = twins.indexOf(se) + 1;
    if (n == null) n = part && part > 1 ? Math.max(prev, 1) : prev + 1;
    prev = Math.max(prev, n);
    map.set(se, part ? `Temporada ${n} · Parte ${part}` : `Temporada ${n}`);
  }
  labelMemo.set(s, { key, map });
  return map;
}
/** Nombre de una temporada en tarjetas, botones y avisos: "Temporada 2", "OVA", "Memory Snow". */
export function seasonLabel(s, se) {
  return seasonLabels(s).get(se) || seasonTab(s, se);
}
/** Nombre completo para la página de la temporada: el de AniList; si no hay ficha, el de la carpeta. */
export function seasonFullName(s, se) {
  const m = ownSeasonMeta(s, se) || (seasonLabel(s, se) === 'Temporada 1' && !isFranchise(s) ? metaFor(s) : null);
  // dos carpetas con la misma ficha (Memory Snow y Hyouketsu no Kizuna son "Re:Zero… OVAs"): el nombre de la carpeta
  const shared = m && s.seasons.some((x) => x !== se && (ownSeasonMeta(s, x) || {}).id === m.id);
  if (m && !shared && (m.romaji || m.title)) return m.romaji || m.title;
  if (hasOwnTitle(se)) return se.title;
  return `${s.name} · ${seasonLabel(s, se)}`;
}

/* ── guardar ──
 * Las fichas llegan de a una al buscar en AniList: se juntan y se guardan una sola vez, 1.5 s después de la última
 * (y al salir de Kai, si falta). */
/** @type {ReturnType<typeof setTimeout> | 0} */
let metaTimer = 0;
export function saveMeta() {
  clearTimeout(metaTimer);
  metaTimer = setTimeout(flushMeta, 1500);
}
export function flushMetaNow() {
  clearTimeout(metaTimer);
  metaTimer = 0;
  LS.set('meta', state.meta);
}
export function flushMeta() {
  if (metaTimer) flushMetaNow();
}
addEventListener('pagehide', flushMeta);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushMeta();
});

/* ── qué ficha usa cada serie ── */

/** ¿Cada temporada tiene su ficha? (series con 2 o más temporadas, que no son colecciones) */
export const usesSeasonMeta = (s) => !!s && !isCollection(s) && s.seasons.length > 1;
/** ¿La carpeta de la serie es solo el nombre del grupo ("Fate")? */
export const isFranchise = (s) => usesSeasonMeta(s) && hasOwnTitle(s.seasons[0]);
/** La ficha propia de una temporada, si la serie usa fichas por temporada. */
export function seasonMeta(s, se) {
  if (!usesSeasonMeta(s) || !se || !se.name) return null;
  const m = state.meta[itemMetaKey(s, se.name)];
  return m && !m.none ? m : null;
}
/** La temporada que estás viendo: la del último capítulo que tocaste; si no, la primera. */
export function activeSeason(s) {
  let best = null;
  for (const ep of s.all) {
    const p = prog(ep);
    if (p && (!best || p.u > best.u)) best = { u: p.u, ep };
  }
  const e = best && index.byId.get(best.ep.id);
  return s.seasons[e ? e.ki : 0];
}
/** La ficha de una serie (en un grupo como "Fate", la de la temporada que estás viendo). */
export function metaFor(s) {
  if (isFranchise(s))
    return seasonMeta(s, activeSeason(s)) || s.seasons.map((se) => seasonMeta(s, se)).find(Boolean) || null;
  const m = state.meta[s.name];
  return m && !m.none ? m : null;
}

/** La sinopsis en español si la hay (traducida aquí o compartida por MEGA); si no, la original. */
export function synopsisOf(m) {
  return m ? m.synopsisEs || (m.id && state.syn[m.id] && state.syn[m.id].es) || m.synopsis || '' : '';
}
export const hasSpanish = (m) => !!(m && (m.synopsisEs || (m.id && state.syn[m.id])));

/** La clave de TMDB (Ajustes → Cine), guardada en lo compartido de MEGA, nunca en el código. */
export const tmdbKey = () => (state.shared.keys && state.shared.keys.tmdb && state.shared.keys.tmdb.v) || '';

/** Lo que se muestra de una serie: lo de AniList, o para una colección, lo armado con sus películas. */
export function displayMeta(s) {
  // una colección nunca usa la ficha de la carpeta (aunque haya quedado guardada de antes): se arma con sus películas
  if (!isCollection(s)) return metaFor(s);
  const items = collectionItems(s).map((it) => ({ ...it, m: itemMeta(s, it.key) }));
  const named = items
    .map((it) => {
      const t = it.title || (it.m && it.m.title) || '';
      return t ? `${t}${it.m && it.m.year ? ` (${it.m.year})` : ''}` : '';
    })
    .filter(Boolean);
  const list = named.length > 1 ? `${named.slice(0, -1).join(', ')} y ${named[named.length - 1]}` : named[0] || '';
  const text = `${items.length === 1 ? 'Una película' : `${items.length} películas`}${isCine(s) ? '' : ' de anime'} en tu MEGA${list ? `: ${list}` : ''}.`;
  return {
    collection: true,
    title: '',
    synopsis: text,
    synopsisEs: text,
    collage: items
      .map((it) => it.m && it.m.cover)
      .filter(Boolean)
      .slice(0, 8),
    color: (items.find((it) => it.m && it.m.color) || {}).m?.color || '',
    format: 'Colección',
    count: items.length,
    genres: [],
  };
}
