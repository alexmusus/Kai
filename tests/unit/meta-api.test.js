// Búsqueda de fichas en AniList (models/meta-api.js) contra un AniList simulado: una lista de fichas y una
// búsqueda parecida a la suya (todas las palabras buscadas aparecen en algún título). Los datos son de prueba,
// inspirados en casos reales que dieron problemas: Re Zero, Kaguya, Kimi no Na wa, Shingeki, Yahari.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { titleScore, seasonNumOf, noLang, relatedTo, findTitle, findSeason, findForSeries, sideStoriesOf, toMeta } from '../../models/meta-api.js';

const media = (id, romaji, english, format, year, extra = {}) => ({
  id, type: 'ANIME', title: { romaji, english, native: null, userPreferred: romaji }, synonyms: [],
  format, seasonYear: year, episodes: 12, genres: ['Comedy'], averageScore: 80,
  coverImage: { extraLarge: `https://img/${id}.jpg`, color: '#123456' }, bannerImage: null, description: 'Texto<br>con <i>HTML</i>.', ...extra,
});
const DB = [
  media(21355, 'Re:Zero kara Hajimeru Isekai Seikatsu', 'Re:ZERO -Starting Life in Another World-', 'TV', 2016),
  media(108632, 'Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season', 'Re:ZERO Season 2', 'TV', 2020),
  media(100049, 'Re:Zero kara Hajimeru Isekai Seikatsu: Memory Snow', 'Re:ZERO Memory Snow', 'MOVIE', 2018),
  media(108007, 'Re:Zero kara Hajimeru Isekai Seikatsu: Hyouketsu no Kizuna', 'Re:ZERO The Frozen Bond', 'MOVIE', 2019),
  media(101921, 'Kaguya-sama wa Kokurasetai: Tensai-tachi no Renai Zunousen', 'Kaguya-sama: Love is War', 'TV', 2019),
  media(112641, 'Kaguya-sama wa Kokurasetai?: Tensai-tachi no Renai Zunousen', 'Kaguya-sama: Love is War Season 2', 'TV', 2020),
  media(21519, 'Kimi no Na wa.', 'Your Name.', 'MOVIE', 2016),
  media(16498, 'Shingeki no Kyojin', 'Attack on Titan', 'TV', 2013),
  media(20958, 'Shingeki no Kyojin Season 2', 'Attack on Titan Season 2', 'TV', 2017),
  media(99147, 'Shingeki no Kyojin Season 3', 'Attack on Titan Season 3', 'TV', 2018),
  media(104578, 'Shingeki no Kyojin Season 3 Part 2', 'Attack on Titan Season 3 Part 2', 'TV', 2019),
  media(14813, 'Yahari Ore no Seishun Love Comedy wa Machigatteiru.', 'My Teen Romantic Comedy SNAFU', 'TV', 2013),
  media(18753, 'Yahari Ore no Seishun Love Comedy wa Machigatteiru.: Kochira to Shite mo Karera Karera no Seishun ga Machigatteiru.', 'My Teen Romantic Comedy SNAFU OVA', 'OVA', 2013, { episodes: 1 }),
  media(20698, 'Yahari Ore no Seishun Love Comedy wa Machigatteiru. Zoku', 'My Teen Romantic Comedy SNAFU TOO!', 'TV', 2015),
];
const RELATIONS = {
  14813: [{ relationType: 'SIDE_STORY', id: 18753 }, { relationType: 'SEQUEL', id: 20698 }],
  105228: [{ relationType: 'SEQUEL', id: 173172, format: 'ONA' }, { relationType: 'SIDE_STORY', id: 114622, format: 'OVA' }],
};
const words = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1);
const searches = [];

let realFetch;
beforeAll(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    let data;
    if (/media\(search/.test(query)) {
      searches.push(variables.q);
      const want = words(variables.q);
      const hits = DB.filter((m) => {
        const have = new Set([m.title.romaji, m.title.english, ...m.synonyms].flatMap(words));
        return want.every((w) => [...have].some((h) => h.startsWith(w)));
      });
      data = { Page: { media: hits.slice(0, variables.n) } };
    } else if (/relations/.test(query)) {
      const edges = (RELATIONS[variables.id] || []).map((r) => ({
        relationType: r.relationType,
        node: DB.find((m) => m.id === r.id) || media(r.id, 'Extra ' + r.id, null, r.format, 2020),
      }));
      data = { Media: { relations: { edges } } };
    }
    return new Response(JSON.stringify({ data }), { headers: { 'x-ratelimit-remaining': '29' } });
  };
});
afterAll(() => { globalThis.fetch = realFetch; });

const byId = (id) => DB.find((m) => m.id === id);

describe('número de temporada en el nombre', () => {
  it.each([
    ['Re Zero 2nd Season', 2], ['Shingeki no Kyojin Season 3', 3], ['Temporada 4', 4], ['Overlord III', 3], ['Fate Zero', null],
  ])('%s → %s', (t, n) => expect(seasonNumOf(t)).toBe(n));
});

describe('qué tanto se parece', () => {
  it('"1st Season" se compara sin eso (AniList no lo escribe)', () => {
    expect(titleScore('Re Zero kara Hajimeru Isekai Seikatsu 1st Season', byId(21355), 'tv')).toBeGreaterThanOrEqual(0.9);
  });
  it('otra temporada no vale', () => {
    expect(titleScore('Re Zero kara Hajimeru Isekai Seikatsu 1st Season', byId(108632), 'tv')).toBeLessThan(0.72);
  });
  it('mismo comienzo largo y final distinto no es lo mismo (Memory Snow ≠ Hyouketsu no Kizuna)', () => {
    expect(titleScore('Re Zero kara Hajimeru Isekai Seikatsu Memory Snow', byId(108007), 'movie')).toBeLessThan(0.72);
    expect(titleScore('Re Zero kara Hajimeru Isekai Seikatsu Memory Snow', byId(100049), 'movie')).toBeGreaterThanOrEqual(0.9);
  });
  it('el nombre sin el subtítulo de AniList (Kaguya)', () => {
    expect(titleScore('Kaguya-sama wa Kokurasetai', byId(101921), 'tv')).toBeGreaterThanOrEqual(0.85);
  });
  it('relatedTo: alguna palabra larga del nombre en los títulos', () => {
    expect(relatedTo('Shingeki no Kyojin', byId(20958))).toBe(true);
    expect(relatedTo('Dorohedoro', byId(20958))).toBe(false);
  });
  it('noLang quita el idioma antes de buscar', () => {
    expect(noLang('Shrek (Latino)')).toBe('Shrek');
    expect(noLang('Howl SUB')).toBe('Howl');
    expect(noLang('Sub')).toBe('Sub'); // si no queda nada, el nombre tal cual
  });
});

describe('buscar en AniList', () => {
  it('Kimi No Nawa (mal escrito) encuentra Kimi no Na wa.', async () => {
    expect((await findTitle('Kimi No Nawa', 'movie'))?.id).toBe(21519);
  });
  it('empate entre temporadas: gana la más antigua (Kaguya)', async () => {
    expect((await findTitle('Kaguya-sama wa Kokurasetai', 'tv'))?.id).toBe(101921);
  });
  it('Re Zero 1st Season es la primera, no la segunda', async () => {
    expect((await findTitle('Re Zero kara Hajimeru Isekai Seikatsu 1st Season', 'tv'))?.id).toBe(21355);
    expect((await findTitle('Re Zero kara Hajimeru Isekai Seikatsu 2nd Season', 'tv'))?.id).toBe(108632);
  });
  it('"Serie - Subtítulo" encuentra el subtítulo correcto', async () => {
    expect((await findTitle('Re Zero kara Hajimeru Isekai Seikatsu - Hyouketsu no Kizuna', 'movie'))?.id).toBe(108007);
  });
  it('Temporada N de una serie: la que dice ese número, no "Part 2"', async () => {
    expect((await findSeason('Shingeki no Kyojin', 2))?.id).toBe(20958);
    expect((await findSeason('Shingeki no Kyojin', 3))?.id).toBe(99147);
  });
  it('sin nada parecido: null (mejor sin imagen que con la de otro anime)', async () => {
    expect(await findTitle('Una serie que no existe para nada', 'tv')).toBe(null);
    expect(await findForSeries(['Dorohedoro'])).toBe(null);
  });
  it('la serie por el nombre de su carpeta', async () => {
    expect((await findForSeries(['Shingeki no Kyojin']))?.id).toBe(16498);
  });
  it('"Serie OVA" busca entre las historias paralelas de la serie', async () => {
    expect((await findTitle('Yahari Ore no Seishun Love Comedy wa Machigatteiru. OVA', 'ova'))?.id).toBe(18753);
  });
  it('OVAs relacionadas: la secuela OVA cuenta, la secuela ONA (otra temporada) no', async () => {
    expect((await sideStoriesOf(105228)).map((m) => m.id)).toEqual([114622]);
    expect((await sideStoriesOf(14813)).map((m) => m.id)).toEqual([18753]);
  });
});

describe('ficha', () => {
  it('toMeta: títulos, imágenes, formato y géneros en español, sinopsis sin HTML', () => {
    // el navegador quita el HTML con un <div>; aquí basta uno de mentira que quite las etiquetas
    globalThis.document = { createElement: () => ({ set innerHTML(h) { this.textContent = h.replace(/<[^>]+>/g, ''); } }) };
    const m = toMeta(byId(21519));
    delete globalThis.document;
    expect(m).toMatchObject({ id: 21519, title: 'Your Name.', romaji: 'Kimi no Na wa.', cover: 'https://img/21519.jpg', year: 2016, score: 80 });
    expect(m.format).toBe('Película');
    expect(m.genres).toEqual(['Comedia']);
    expect(m.synopsis).toBe('Texto\ncon HTML.');
  });
});
