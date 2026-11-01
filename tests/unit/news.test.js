// Lo nuevo en MEGA: burbujas de "nuevo" y Novedades (models/news.js).
import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../../models/store.js';
import { on } from '../../lib/events.js';
import { initKnown, newEpisodes, markSeriesSeen, announceNew, newsList, hasUnreadNews, saveKnown } from '../../models/news.js';

const ep = (id) => ({ id, name: id + '.mp4', path: 'Anime/S/' + id });
const serie = (name, ids) => ({ name, seasons: [], all: ids.map(ep) });

beforeEach(() => {
  localStorage.clear();
  state.profile = { id: 'p' + Math.random() }; // perfil nuevo: sin lista guardada en memoria
  state.library = { v: 2, series: [serie('A', ['a1', 'a2']), serie('B', ['b1'])] };
});

describe('capítulos nuevos', () => {
  it('la primera vez todo se da por conocido', () => {
    expect(newEpisodes(state.library.series[0])).toEqual([]);
    initKnown();
    expect(newEpisodes(state.library.series[0])).toEqual([]);
  });
  it('lo que llega después es nuevo hasta entrar a la serie', () => {
    initKnown();
    state.library.series[0].all.push(ep('a3'));
    expect(newEpisodes(state.library.series[0]).map((e) => e.id)).toEqual(['a3']);
    markSeriesSeen(state.library.series[0]);
    expect(newEpisodes(state.library.series[0])).toEqual([]);
  });
  it('cada perfil tiene su lista', () => {
    initKnown();
    state.library.series[1].all.push(ep('b2'));
    state.profile = { id: 'otro' };
    saveKnown({ A: ['a1', 'a2'], B: ['b1', 'b2'] });
    expect(newEpisodes(state.library.series[1])).toEqual([]);
  });
});

describe('novedades', () => {
  it('se anota una vez por capítulo, con puntito sin leer y aviso "news"', () => {
    let pings = 0;
    const off = on('news', () => pings++);
    initKnown();
    announceNew(); // primera vez: solo toma nota
    expect(newsList()).toEqual([]);
    state.library.series[0].all.push(ep('a3'), ep('a4'));
    announceNew();
    expect(newsList().map((x) => [x.name, x.n])).toEqual([['A', 2]]);
    expect(hasUnreadNews()).toBe(true);
    announceNew(); // lo mismo no se vuelve a anunciar
    expect(newsList()).toHaveLength(1);
    expect(pings).toBe(3);
    off();
  });
});
