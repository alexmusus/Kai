// @ts-check
/*
 * models/context.js — a qué lista pertenece un capítulo (su temporada, su carpeta de MEGA o lo descargado de esa
 * serie), cómo se llama esa lista y a qué página se vuelve desde el reproductor.
 */

import { isCollection, isStudio, itemFor } from './collections.js';
import { movieHref } from '../lib/route.js';
import { index, state, knownEps } from './store.js';
import { seasonLabel } from './fichas.js';
import { hasOwnTitle, sortEpisodes } from './naming.js';

import { isPlayable, makeEpisode, nodePath } from './library.js';
import { visibleChildren } from './mega.js';

/** Dirección de una temporada: con varias, cada una tiene su página (#/serie/3/1); con una sola, la serie. */
export function seasonHref(si, s, ki) {
  return s && !isCollection(s) && s.seasons.length > 1 ? `#/serie/${si}/${ki}` : `#/serie/${si}`;
}

/** Todo lo que el reproductor necesita: el capítulo, su lista y a dónde vuelve. */
/** @param {string} id */
export function resolveContext(id) {
  const e = index.byId.get(id);
  if (e && state.library) {
    const s = state.library.series[e.si];
    const season = s.seasons[e.ki];
    // un capítulo en el idioma que no está elegido (desde Descargados, por ejemplo): la lista sigue en su idioma
    const list =
      e.ei >= 0 || !season.full
        ? season.episodes
        : season.full.filter((x) => !index.twins.has(x.path) || x.lang === e.ep.lang);
    return {
      // la lista del reproductor es solo la temporada: al terminarla, Kai se detiene (no pasa sola a la siguiente)
      ep: e.ep,
      list,
      shown: list,
      title: s.name,
      sub: isCollection(s)
        ? ''
        : s.seasons.length > 1
          ? seasonLabel(s, season)
          : hasOwnTitle(season) && season.title !== s.name
            ? season.title
            : '',
      ki: e.ki,
      back: isStudio(s)
        ? `#/serie/${e.si}`
        : isCollection(s)
          ? movieHref(e.si, (itemFor(s, e.ep) || { key: '' }).key)
          : seasonHref(e.si, s, e.ki),
      si: e.si,
    };
  }
  const node = state.storage && state.storage.files[id];
  if (node && node.parent && isPlayable(node)) {
    const parent = node.parent;
    const kids = visibleChildren(parent);
    const list = sortEpisodes(
      kids.filter(isPlayable).map((f) => index.byId.get(f.nodeId)?.ep || makeEpisode(f, nodePath(parent))),
    );
    list.forEach((x) => {
      if (!index.byId.has(x.id)) knownEps.set(x.id, x);
    });
    const name = parent === state.storage.root ? 'Mi MEGA' : parent.name;
    return {
      ep: list.find((x) => x.id === id),
      list,
      shown: list,
      title: name,
      sub: '',
      back: '#/explorar/' + parent.nodeId,
    };
  }
  const m = state.dlMeta.get(id);
  if (m && m.ep) {
    const list = sortEpisodes([...state.dlMeta.values()].filter((x) => x.ep && x.title === m.title).map((x) => x.ep));
    return { ep: m.ep, list, shown: list, title: m.title || 'Descargados', sub: '', back: '#/descargas' };
  }
  return null;
}

export function titleFor(ep) {
  const c = resolveContext(ep.id);
  return c ? c.title : '';
}
