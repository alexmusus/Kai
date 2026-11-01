// Nombres de temporadas según sus fichas y fichas compartidas por MEGA (models/fichas.js, models/fichas-sync.js).
import { describe, it, expect, beforeEach } from 'vitest';
import { state, setIndex } from '../../models/store.js';
import { seasonInfo } from '../../models/naming.js';
import { seasonLabel, seasonFullName, metaFor, isFranchise, displayMeta, synopsisOf } from '../../models/fichas.js';
import { mergeFichas, mergeSyn, syncFichas, seasonQuery, hasAllMeta } from '../../models/fichas-sync.js';

const se = (name, eps = 12) => ({ ...seasonInfo(name), name, episodes: Array.from({ length: eps }, (_, i) => ({ id: name + i })) });
const serie = (name, folders) => ({ name, seasons: folders.map((f) => (Array.isArray(f) ? se(...f) : se(f))), all: [] });
const ficha = (id, romaji, format, extra = {}) => ({ id, romaji, title: romaji, format, year: 2020, at: 1, ...extra });

beforeEach(() => {
  localStorage.clear();
  state.meta = {};
  state.syn = {};
  state.progress = {};
  setIndex({ byId: new Map(), byPath: new Map(), twins: new Map() });
});

describe('nombres de las temporadas', () => {
  it('Yahari: las series se cuentan, las OVAs dicen OVA', () => {
    const y = 'Yahari Ore no Seishun Love Comedy wa Machigatteiru.';
    const s = serie(y, [`1. ${y}`, ['2. OVA', 1], `3. ${y} Zoku`, ['4. OVA', 1]]);
    state.meta[`${y}/3. ${y} Zoku`] = ficha(20698, `${y} Zoku`, 'Serie');
    state.meta[`${y}/2. OVA`] = ficha(18753, 'Yahari OVA', 'OVA');
    expect(s.seasons.map((x) => seasonLabel(s, x))).toEqual(['Temporada 1', 'OVA', 'Temporada 2', 'OVA']);
  });
  it('Re Zero: "2nd Season" es la Temporada 2; Memory Snow muestra su subtítulo', () => {
    const r = 'Re Zero kara Hajimeru Isekai Seikatsu';
    const s = serie(r, [`1. ${r} 1st Season`, [`2. ${r} - Memory Snow`, 1], `3. ${r} 2nd Season`]);
    state.meta[`${r}/2. ${r} - Memory Snow`] = ficha(100049, 'Re:Zero Memory Snow', 'Película');
    expect(s.seasons.map((x) => seasonLabel(s, x))).toEqual(['Temporada 1', 'Memory Snow', 'Temporada 2']);
  });
  it('dos carpetas con el mismo número son partes', () => {
    const s = serie('X', ['1', '2. Temporada 2', '2. Temporada 2 b']);
    expect(s.seasons.map((x) => seasonLabel(s, x))).toEqual(['Temporada 1', 'Temporada 2 · Parte 1', 'Temporada 2 · Parte 2']);
  });
  it('nombre completo: el de AniList; si dos carpetas comparten ficha, el de la carpeta', () => {
    const s = serie('Re Zero', ['1. Temporada 1', ['2. Memory Snow OVA', 1], ['3. Hyouketsu no Kizuna OVA', 1]]);
    state.meta['Re Zero'] = ficha(21355, 'Re:Zero kara Hajimeru Isekai Seikatsu', 'Serie'); // la Temporada 1 usa la de la serie
    state.meta['Re Zero/2. Memory Snow OVA'] = ficha(100049, 'Re:Zero OVAs', 'OVA');
    state.meta['Re Zero/3. Hyouketsu no Kizuna OVA'] = ficha(100049, 'Re:Zero OVAs', 'OVA');
    expect(seasonFullName(s, s.seasons[0])).toBe('Re:Zero kara Hajimeru Isekai Seikatsu');
    expect(seasonFullName(s, s.seasons[1])).toBe('Memory Snow OVA');
  });
});

describe('qué ficha usa cada serie', () => {
  it('un grupo como Fate (primera temporada con nombre propio) usa la de una temporada', () => {
    const s = serie('Fate', ['1. Fate UBW', '2. Fate Zero']);
    expect(isFranchise(s)).toBe(true);
    state.meta['Fate'] = ficha(1, 'Imagen al azar', 'Serie'); // la carpeta "Fate" nunca se usa
    state.meta['Fate/1. Fate UBW'] = ficha(2, 'Fate/stay night UBW', 'Serie');
    expect(metaFor(s).id).toBe(2);
  });
  it('lo que se busca de cada temporada', () => {
    const s = serie('Dorohedoro', ['1. Temporada 1', '2. Temporada 2', ['3. OVA', 1], '4. Dorohedoro Ma no Omake (Pelicula)', '5. Dorohedoro Pelicula']);
    expect(s.seasons.map((x) => seasonQuery(s, x))).toEqual([
      null, // la Temporada 1 usa la ficha de la serie
      { series: 'Dorohedoro', n: 2 },
      { ovaOf: 2 }, // "OVA" a secas: entre las relacionadas de la temporada de antes
      { name: 'Dorohedoro Ma no Omake', kind: 'movie' }, // "(Película)" solo dice el tipo
      { ovaOf: 4 }, // "Serie Película" sin subtítulo también se busca entre las relacionadas
    ]);
  });
  it('una serie no está completa hasta tener la ficha de cada cosa que se busca', () => {
    const s = serie('Dorohedoro', ['1. Temporada 1', '2. Temporada 2']);
    expect(hasAllMeta(s)).toBe(false);
    state.meta['Dorohedoro'] = ficha(105228, 'Dorohedoro', 'Serie');
    state.meta['Dorohedoro/2. Temporada 2'] = { none: true, id: 0, at: 1 }; // buscada y no encontrada también cuenta
    expect(hasAllMeta(s)).toBe(true);
  });
  it('una colección se describe con sus películas', () => {
    const s = { name: 'Peliculas', seasons: [se('Kimi no Na wa', 1), se('Koe no Katachi', 1)], all: [] };
    state.meta['Peliculas/Kimi no Na wa'] = ficha(21519, 'Your Name.', 'Película', { title: 'Your Name.', year: 2016, cover: 'a.jpg' });
    const m = displayMeta(s);
    expect(m.synopsis).toBe('2 películas de anime en tu MEGA: Kimi no Na wa (2016) y Koe no Katachi.');
    expect(m.collage).toEqual(['a.jpg']);
  });
  it('la sinopsis en español si la hay', () => {
    state.syn[7] = { es: 'Hola', u: 1 };
    expect(synopsisOf({ id: 7, synopsis: 'Hello' })).toBe('Hola');
    expect(synopsisOf({ id: 8, synopsis: 'Hello' })).toBe('Hello');
    expect(synopsisOf(null)).toBe('');
  });
});

describe('fichas compartidas', () => {
  it('gana la ficha más reciente; lo que no es ficha se ignora', () => {
    expect(mergeFichas({ a: { id: 1, at: 5 } }, { a: { id: 2, at: 3 }, b: { id: 3, at: 1 }, c: 'basura' })).toEqual({ a: { id: 1, at: 5 }, b: { id: 3, at: 1 } });
    expect(mergeSyn({ 1: { es: 'a', u: 1 } }, { 1: { es: 'b', u: 2 }, 2: { u: 9 } })).toEqual({ 1: { es: 'b', u: 2 } });
  });
  it('si .kai-fichas.json no se puede leer, no se pisa', async () => {
    const home = { children: [{ name: '.kai-fichas.json', nodeId: 'x', size: 10, key: Array(32).fill(0) }] };
    state.meta = { a: { id: 1, at: 1 } };
    // sin sesión de MEGA, leer falla: syncFichas tiene que fallar sin escribir
    await expect(syncFichas(home)).rejects.toThrow();
  });
});
