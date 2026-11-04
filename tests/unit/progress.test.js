// Progreso y perfiles: cómo se juntan las copias (lo más delicado: aquí se pueden perder cosas vistas).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state, setIndex } from '../../models/store.js';
import { buildIndex } from '../../models/library.js';
import { prog, setProgress, mergeProgress, continueList, laterList, setLaterFlag, isLater, markNow, DEVICE } from '../../models/progress.js';
import { mergeShared, dedupeProfiles, finalProfileId, normName } from '../../models/profiles.js';
import { stable } from '../../lib/util.js';
import { isCollection, isCine, collectionItems, cleanFileTitle, movieTitle } from '../../models/collections.js';

const ep = (path, n) => ({ id: path, name: path.split('/').pop(), path, ep: n, size: 1, key: 'k', fa: null, mime: 'video/mp4', ts: 0 });
const lib = (series) => ({ root: 'Anime', rootId: 'r', v: 2, series, updated: 0 });
const serie = (name, eps) => ({ name, folderId: name, added: 0, seasons: [{ num: null, title: '', name: '', episodes: eps }] });

function use(library) {
  state.library = library;
  setIndex(buildIndex(library));
}

beforeEach(() => {
  localStorage.clear();
  state.profile = { id: 'p1', name: 'Alex' };
  state.progress = {};
  state.dirty = false;
  state.shared = { profiles: [], intros: {}, picks: {}, legacyBy: null };
  use(null);
  vi.useRealTimers();
});

describe('mergeProgress', () => {
  it('de cada capítulo gana lo más reciente; no cambia las copias', () => {
    const a = { x: { t: 10, u: 1 }, y: { t: 50, u: 9 } };
    const b = { x: { t: 99, u: 5 }, y: { t: 1, u: 2 }, z: { t: 3, u: 1 } };
    expect(mergeProgress(a, b)).toEqual({ x: { t: 99, u: 5 }, y: { t: 50, u: 9 }, z: { t: 3, u: 1 } });
    expect(a.x.t).toBe(10);
  });
  it('ignora entradas sin marca de tiempo o vacías', () => {
    expect(mergeProgress({ x: { u: 1 } }, { x: { t: 5 }, y: null, z: { u: 'ayer' } })).toEqual({ x: { u: 1 } });
    expect(mergeProgress({ x: { u: 1 } }, null)).toEqual({ x: { u: 1 } });
  });
  it('si las dos dicen lo mismo a la misma hora, se queda la de aquí', () => {
    const mine = { x: { t: 1, u: 5 } };
    expect(mergeProgress(mine, { x: { t: 2, u: 5 } }).x.t).toBe(1);
  });
  it('juntar en cualquier orden da lo mismo (sin empates)', () => {
    const a = { x: { u: 1 }, y: { u: 7 } };
    const b = { x: { u: 3 }, z: { u: 2 } };
    expect(mergeProgress(a, b)).toEqual(mergeProgress(b, a));
  });
});

describe('prog con Sub y Doblado', () => {
  it('cuenta lo visto en cualquiera de los dos idiomas', () => {
    const sub = ep('Anime/S/1_1_SUB.mp4', 1);
    const dub = ep('Anime/S/1_1_DUB.mp4', 1);
    use(lib([serie('S', [sub, dub])]));
    state.progress[sub.path] = { t: 1400, d: 1420, w: true, u: 1 };
    state.progress[dub.path] = { t: 30, d: 1420, w: false, u: 9 };
    expect(prog(dub)).toEqual({ t: 30, d: 1420, w: true, u: 9 }); // el minuto del más reciente, y visto
    expect(prog(sub)).toEqual({ t: 30, d: 1420, w: true, u: 9 });
  });
  it('sin gemelo, lo suyo tal cual', () => {
    const a = ep('Anime/S/1_1_SUB.mp4', 1);
    use(lib([serie('S', [a])]));
    expect(prog(a)).toBeUndefined();
    state.progress[a.path] = { t: 1, u: 1 };
    expect(prog(a)).toBe(state.progress[a.path]);
  });
});

describe('setProgress', () => {
  it('queda visto al pasar del 92 % y ya no se desmarca solo', () => {
    const a = ep('Anime/S/1_1_SUB.mp4', 1);
    setProgress(a, 100, 1000);
    expect(state.progress[a.path]).toMatchObject({ t: 100, d: 1000, w: false });
    expect(state.dirty).toBe(true);
    setProgress(a, 930, 1000);
    expect(state.progress[a.path].w).toBe(true);
    setProgress(a, 10, 1000);
    expect(state.progress[a.path].w).toBe(true);
    setProgress(a, 10, 1000, false);
    expect(state.progress[a.path].w).toBe(false);
    expect(JSON.parse(localStorage.getItem('kai.p.p1.progress'))[a.path].t).toBe(10); // guardado aquí
  });
});

describe('continuar viendo y más tarde', () => {
  it('el último que tocaste; si lo terminaste, el siguiente sin ver', () => {
    const eps = [1, 2, 3].map((n) => ep(`Anime/A/x_${n}_SUB.mp4`, n));
    const other = ep('Anime/B/y_1_SUB.mp4', 1);
    use(lib([serie('A', eps), serie('B', [other])]));
    state.progress[eps[0].path] = { t: 1, d: 10, w: true, u: 5 };
    state.progress[eps[1].path] = { t: 1, d: 10, w: true, u: 6 };
    state.progress[other.path] = { t: 3, d: 10, u: 2 };
    expect(continueList().map((x) => [x.series.name, x.ep.ep, x.u])).toEqual([['A', 3, 6], ['B', 1, 2]]);
    state.progress[eps[2].path] = { t: 10, d: 10, w: true, u: 7 };
    expect(continueList().map((x) => x.series.name)).toEqual(['B']); // A terminada
  });
  it('más tarde: lo terminado no aparece', () => {
    const a = ep('Anime/A/x_1_SUB.mp4', 1);
    const s = serie('A', [a]);
    use(lib([s]));
    setLaterFlag(s, '', true);
    expect(isLater(s)).toBe(true);
    expect(laterList().map((x) => x.s.name)).toEqual(['A']);
    state.progress[a.path] = { w: true, u: 1 };
    expect(laterList()).toEqual([]);
  });
  it('lo que se está viendo aquí', () => {
    const a = ep('Anime/A/x_1_SUB.mp4', 1);
    use(lib([serie('A', [a])]));
    markNow(a, 61.6, 1420.2);
    expect(state.progress['@now']).toMatchObject({ p: a.path, t: 62, d: 1420, w: false, dev: DEVICE });
  });
});

describe('lo compartido entre perfiles', () => {
  it('de cada perfil, intro y clave gana lo más reciente; perfiles del más antiguo al más nuevo', () => {
    const a = { profiles: [{ id: 'a', name: 'Alex', created: 1, u: 1 }], intros: { S: { s: 80, u: 1 } }, keys: { tmdb: { v: 'viejo', u: 1 } } };
    const b = { profiles: [{ id: 'a', name: 'Alex M', created: 1, u: 2 }, { id: 'b', name: 'Diego', created: 0, u: 1 }], intros: { S: { s: 90, u: 0 } }, keys: { tmdb: { v: 'nuevo', u: 3 } } };
    const m = mergeShared(a, b);
    expect(m.profiles.map((p) => p.name)).toEqual(['Diego', 'Alex M']);
    expect(m.intros.S.s).toBe(80);
    expect(m.keys.tmdb.v).toBe('nuevo');
    expect(m.legacyBy).toBe(null);
  });
  it('perfiles con el mismo nombre se juntan en el más antiguo', () => {
    state.shared.profiles = [
      { id: 'viejo', name: 'Alex', created: 1 },
      { id: 'nuevo', name: ' alex ', created: 2 },
      { id: 'otro', name: 'Diego', created: 3 },
    ];
    state.shared.legacyBy = 'nuevo';
    expect(dedupeProfiles()).toBe(true);
    expect(state.shared.profiles[1]).toMatchObject({ deleted: true, mergedInto: 'viejo' });
    expect(state.shared.legacyBy).toBe('viejo');
    expect(finalProfileId('nuevo')).toBe('viejo');
    expect(finalProfileId('otro')).toBe('otro');
    expect(dedupeProfiles()).toBe(false); // ya no hay nada que juntar
  });
  it('finalProfileId no se queda dando vueltas', () => {
    state.shared.profiles = [{ id: 'a', mergedInto: 'b' }, { id: 'b', mergedInto: 'a' }];
    expect(['a', 'b']).toContain(finalProfileId('a'));
  });
  it('normName y stable', () => {
    expect(normName('  ÁLEX ')).toBe('álex');
    expect(stable({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(stable({ a: [{ c: 2, d: 1 }], b: 1 }));
  });
});

describe('colecciones', () => {
  it('Peliculas y Cine, con o sin tilde', () => {
    expect(isCollection({ name: 'Películas' })).toBe(true);
    expect(isCollection({ name: 'Peliculás' })).toBe(true); // tilde separada (macOS)
    expect(isCollection({ name: 'Cine' })).toBe(true);
    expect(isCine({ name: 'Otras películas' })).toBe(true);
    expect(isCollection({ name: 'Fate' })).toBe(false);
  });
  it('películas en subcarpetas o sueltas', () => {
    const s = {
      name: 'Peliculas',
      seasons: [
        { num: null, title: '', name: '', episodes: [ep('Anime/Peliculas/Howl [1080p] SUB.mp4', null)] },
        { num: null, title: 'Kimi no Na wa', name: 'Kimi no Na wa', episodes: [ep('Anime/Peliculas/Kimi no Na wa/k.mp4', null)] },
      ],
    };
    const items = collectionItems(s);
    expect(items.map((x) => [x.key, x.query])).toEqual([['howl [1080p] sub', 'Howl'], ['Kimi no Na wa', 'Kimi no Na wa']]);
    expect(movieTitle(s, items[0])).toBe('Howl');
    expect(movieTitle({ name: 'Cine' }, { key: 'x', title: 'El gigante de hierro (1999)', eps: [ep('a/b.mp4', null)] })).toBe('El gigante de hierro');
    expect(cleanFileTitle('01.mp4')).toBe('');
  });
});
