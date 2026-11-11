// @ts-check
/*
 * models/stats.js — el resumen de lo que vio un perfil: tiempo, capítulos, series terminadas y lo más visto del mes.
 * Sale del progreso que ya se guarda (nada nuevo que sincronizar).
 */

import { isCollection, isStudio } from './collections.js';

/** @typedef {{ t?: number, d?: number, w?: boolean, u?: number }} Prog */
/** @typedef {{ name: string, all?: { path: string }[] }} StatSeries */
/**
 * @typedef {object} ProfileStats
 * @property {number} seconds  tiempo visto (lo terminado completo, y lo que va de lo que está a medias)
 * @property {number} eps      capítulos (y películas) terminados
 * @property {string[]} done   series terminadas completas
 * @property {number} monthSeconds  tiempo de lo terminado este mes
 * @property {{ name: string, eps: number }[]} monthTop  lo más visto este mes (hasta 3)
 */

/**
 * @param {StatSeries[]} series
 * @param {(ep: any) => Prog | undefined} progOf
 * @param {number} [now]
 * @returns {ProfileStats}
 */
export function profileStats(series, progOf, now = Date.now()) {
  const d0 = new Date(now);
  const monthStart = new Date(d0.getFullYear(), d0.getMonth(), 1).getTime();
  let seconds = 0;
  let eps = 0;
  let monthSeconds = 0;
  /** @type {string[]} */
  const done = [];
  /** @type {Map<string, number>} */
  const month = new Map();
  for (const s of series || []) {
    const all = s.all || [];
    let seen = 0;
    for (const e of all) {
      const p = progOf(e);
      if (!p) continue;
      if (p.w) {
        seen++;
        seconds += p.d || 0;
        if ((p.u || 0) >= monthStart) {
          monthSeconds += p.d || 0;
          month.set(s.name, (month.get(s.name) || 0) + 1);
        }
      } else seconds += p.t || 0;
    }
    eps += seen;
    // una serie (no las colecciones de películas ni Studio) cuenta como terminada si viste todos sus capítulos
    if (all.length && seen === all.length && !isCollection(s) && !isStudio(s)) done.push(s.name);
  }
  const monthTop = [...month.entries()]
    .map(([name, n]) => ({ name, eps: n }))
    .sort((a, b) => b.eps - a.eps || a.name.localeCompare(b.name, 'es'))
    .slice(0, 3);
  return { seconds, eps, done, monthSeconds, monthTop };
}

/**
 * Lo visto en los últimos 7 días (hoy es el último): el tiempo y los capítulos terminados, en total y por día.
 * Sale de la fecha en que se tocó cada capítulo por última vez (`u`), así que es una aproximación: un capítulo
 * visto en dos días cuenta entero el segundo.
 * @param {StatSeries[]} series
 * @param {(ep: any) => Prog | undefined} progOf
 * @param {number} [now]
 * @returns {{ seconds: number, eps: number, days: number[], labels: string[] }}
 */
export function weekStats(series, progOf, now = Date.now()) {
  const DAY = 86400000;
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - 6 * DAY;
  const days = Array(7).fill(0);
  let seconds = 0;
  let eps = 0;
  for (const s of series || []) {
    for (const e of s.all || []) {
      const p = progOf(e);
      if (!p || !p.u || p.u < start || p.u > now) continue;
      const sec = p.w ? p.d || 0 : p.t || 0;
      if (!sec) continue;
      days[Math.min(6, Math.floor((p.u - start) / DAY))] += sec;
      seconds += sec;
      if (p.w) eps++;
    }
  }
  const names = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const labels = days.map((_, i) => names[new Date(start + i * DAY).getDay()]);
  return { seconds, eps, days, labels };
}

/** "12 h", "3 h 20 min", "45 min" (corto: "3 h", redondeado a la hora). @param {number} s @param {boolean} [short] */
export function fmtWatched(s, short = false) {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  if (short) return `${Math.round(m / 60)} h`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h >= 10 || !r ? `${h} h` : `${h} h ${r} min`;
}
