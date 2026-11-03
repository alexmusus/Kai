// Qué toca ver ahora y el texto del botón (models/plans.js).
import { describe, it, expect, beforeEach } from 'vitest';
import { state, setIndex } from '../../models/store.js';
import { buildIndex } from '../../models/library.js';
import { heroPlan, seasonPlan, moviePlan, nextFor } from '../../models/plans.js';

const ep = (path, n) => ({ id: path, name: path.split('/').pop(), path, ep: n, size: 1, key: 'k', fa: null, mime: 'video/mp4', ts: 0, subs: [] });
const season = (num, name, n) => ({ num, title: name, name: `${num}. ${name}`, episodes: Array.from({ length: n }, (_, i) => ep(`Anime/S/${num}/${i + 1}_SUB.mp4`, i + 1)) });
let s;
beforeEach(() => {
  localStorage.clear();
  state.meta = {};
  state.progress = {};
  s = { name: 'S', folderId: 'S', added: 0, seasons: [season(1, 'Temporada 1', 3), season(2, 'Temporada 2', 2)] };
  state.library = { root: 'Anime', rootId: 'r', v: 2, series: [s], updated: 0 };
  setIndex(buildIndex(state.library));
});
const watch = (e, u, extra = {}) => { state.progress[e.path] = { t: 1400, d: 1420, w: true, u, ...extra }; };

describe('qué ver', () => {
  it('sin ver nada: la primera temporada (con varias, se dice cuál)', () => {
    expect(heroPlan(s)).toMatchObject({ label: 'Ver Temporada 1', left: '' });
    expect(seasonPlan(s, s.seasons[0]).label).toBe('Ver Episodio 1');
  });
  it('a medias: Continuar, con lo que falta', () => {
    state.progress[s.seasons[0].episodes[1].path] = { t: 600, d: 1440, u: 5 };
    expect(heroPlan(s)).toMatchObject({ label: 'Continuar Episodio 2', left: 'quedan 14 min' });
  });
  it('terminada una temporada: se dice cuál sigue', () => {
    s.seasons[0].episodes.forEach((e, i) => watch(e, i + 1));
    expect(heroPlan(s).label).toBe('Ver Temporada 2');
    expect(seasonPlan(s, s.seasons[0])).toMatchObject({ next: null, label: 'Temporada vista' });
  });
  it('todo visto: Serie terminada', () => {
    s.all.forEach((e, i) => watch(e, i + 1));
    expect(nextFor(s)).toBe(null);
    expect(heroPlan(s).label).toBe('Serie terminada');
  });
  it('película en partes', () => {
    const it2 = { key: 'x', title: 'X', eps: [ep('a/1.mp4', null), ep('a/2.mp4', null)] };
    expect(moviePlan(it2).label).toBe('Ver parte 1');
    watch(it2.eps[0], 1);
    state.progress['a/2.mp4'] = { t: 65, d: 3000, u: 2 };
    expect(moviePlan(it2)).toMatchObject({ label: 'Continuar parte 2 en 1:05', seen: false });
    watch(it2.eps[1], 3);
    expect(moviePlan(it2)).toMatchObject({ label: 'Ver de nuevo', seen: true, pct: 100 });
  });
});
