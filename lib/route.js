// @ts-check
/*
 * lib/route.js — la dirección (#/vista/arg?filtros) leída y armada. No navega: solo lee location.hash.
 */

/** @returns {{ view: string, arg: string, q: URLSearchParams }} */
export function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const [view, ...rest] = path.split('/');
  return { view: view || 'home', arg: decodeURIComponent(rest.join('/')), q: new URLSearchParams(query) };
}

/** Dirección de la página de una película de la colección. @param {number} si @param {string} key */
export const movieHref = (si, key) => `#/pelicula/${si}/${encodeURIComponent(key)}`;
