// Lo que Kai entiende de los nombres de archivos y carpetas (models/naming.js).
import { describe, it, expect } from 'vitest';
import {
  episodeNumber, seasonInfo, langOf, stripLang, twinKey, langText, isVideoName,
  hasOwnTitle, isSpecialSeason, seasonOrdinal, seasonTab, afterSeriesName, isBareSpecial, specialWord, sortEpisodes,
} from '../../models/naming.js';

const se = (name) => ({ ...seasonInfo(name), name });
const serie = (name, folders) => ({ name, seasons: folders.map(se) });

describe('episodeNumber', () => {
  it.each([
    ['472_0_SUB.mp4', 0],
    ['472_5_SUB.mp4', 5],
    ['472_12_DUB.mp4', 12],
    ['472_7.5_SUB.mp4', 7.5],
    ['Serie - 05 [1080p].mp4', 5],
    ['S01E07.mp4', 7],
    ['Show s2 e11 x265.mkv', 11],
    ['[Grupo] Serie - 13 (1080p) [ABCD1234].mkv', 13],
    ['Serie 1080p x264 AAC 08.mp4', 8],
    ['Pelicula.mp4', null],
  ])('%s → %s', (name, n) => expect(episodeNumber(name)).toBe(n));
});

describe('seasonInfo', () => {
  it.each([
    ['1. Fate UBW', 1, 'Fate UBW'],
    ['1.5 OVA', 1.5, 'OVA'],
    ['1,5 OVA', 1.5, 'OVA'],
    ['2) Temporada 2', 2, 'Temporada 2'],
    ['3', 3, ''],
    ['Temporada 4', 4, 'Temporada 4'],
    ['Season 2', 2, 'Season 2'],
    ['Fate Zero', null, 'Fate Zero'],
  ])('%s → %s · %s', (name, num, title) => expect(seasonInfo(name)).toEqual({ num, title }));
});

describe('idioma en el nombre', () => {
  it.each([
    ['472_0_SUB.mp4', 'sub'],
    ['472_0_DUB.mp4', 'dob'],
    ['472_0_DOB.mp4', 'dob'],
    ['472_0_LAT.mp4', 'dob'],
    ['Howl [Latino].mp4', 'dob'],
    ['Shrek (Sub).mp4', 'sub'],
    ['Serie VOSE 01.mkv', 'sub'],
    ['472_0.mp4', null],
    ['Subaru.mp4', null], // "Sub" dentro de una palabra no cuenta
    ['Dublin.mp4', null],
  ])('%s → %s', (name, lang) => expect(langOf(name)).toBe(lang));

  it('quita la marca de idioma', () => {
    expect(stripLang('472_0_SUB')).toBe('472_0');
    expect(stripLang('472_0_DUB')).toBe('472_0');
    expect(stripLang('Howl [Latino]')).toBe('Howl');
    expect(stripLang('Shrek (Sub)')).toBe('Shrek');
  });
  it('las dos versiones de un capítulo son gemelas', () => {
    expect(twinKey({ name: '472_3_SUB.mp4' })).toBe(twinKey({ name: '472_3_DUB.mp4' }));
    expect(twinKey({ name: '472_3_SUB.mp4' })).not.toBe(twinKey({ name: '472_4_DUB.mp4' }));
  });
  it('texto de los idiomas', () => {
    expect(langText(['sub', 'dob'])).toBe('Sub y doblado');
    expect(langText(['dob'])).toBe('Doblado');
    expect(langText([])).toBe('');
  });
});

describe('videos', () => {
  it.each([['a.mp4', true], ['a.MKV', true], ['a.webm', true], ['a.srt', false], ['a', false], [null, false]])('%s → %s', (n, v) => expect(isVideoName(n)).toBe(v));
});

describe('temporadas', () => {
  it('nombre propio o genérico', () => {
    expect(hasOwnTitle(se('2. Fate Zero'))).toBe(true);
    expect(hasOwnTitle(se('2. Temporada 2'))).toBe(false);
    expect(hasOwnTitle(se('3. Temporada 2 - Parte 1'))).toBe(false);
    expect(hasOwnTitle(se('2. OVA'))).toBe(false);
    expect(hasOwnTitle(se('1.5 Prólogo UBW'))).toBe(true);
    expect(hasOwnTitle(se('4'))).toBe(false);
  });
  it('especiales', () => {
    expect(isSpecialSeason(se('2. OVA'))).toBe(true);
    expect(isSpecialSeason(se('3. Heavens Feel Película'))).toBe(true);
    expect(isSpecialSeason(se('2. Especiales'))).toBe(true);
    expect(isSpecialSeason(se('2. Fate Zero'))).toBe(false);
    expect(isSpecialSeason(se('1. Temporada 1'))).toBe(false);
  });
  it('el número de temporada cuenta solo las temporadas', () => {
    const s = serie('Dorohedoro', ['1. Temporada 1', '1.5 OVA', '2', '3. OVA']);
    expect(s.seasons.map((x) => seasonOrdinal(s, x))).toEqual([1, 1.5, 2, 3]);
    const t = serie('X', ['1', '2', '5']);
    expect(t.seasons.map((x) => seasonOrdinal(t, x))).toEqual([1, 2, 3]);
  });
  it('pestañas', () => {
    const s = serie('Fate', ['1. Fate UBW', '2. Fate Zero', '3. Temporada 3', '3. Temporada 3', '4. OVA', '5. Temporada 4 - Parte 2']);
    expect(s.seasons.map((x) => seasonTab(s, x))).toEqual(['Fate UBW', 'Fate Zero', 'Temporada 3 · Parte 1', 'Temporada 3 · Parte 2', 'OVA', 'Temporada 4 · Parte 2']);
    expect(seasonTab(s, { num: null, name: 'Sueltos', title: '' })).toBe('Sueltos');
  });
});

describe('OVAs y especiales', () => {
  const yah = 'Yahari Ore no Seishun Love Comedy wa Machigatteiru.';
  const s = serie(yah, [`1. ${yah}`, '2. OVA', `3. ${yah} Zoku`, `4. ${yah} OVA`, '5. Yahari Ore no Seishun Love Come wa Machigatteiru. Kan']);
  it('lo que dice la carpeta después del nombre de la serie', () => {
    expect(afterSeriesName(s, `${yah} Zoku`)).toBe('Zoku');
    expect(afterSeriesName(s, 'Yahari Ore no Seishun Love Come wa Machigatteiru. Kan')).toBe('Kan'); // "Come" ≈ "Comedy"
    expect(afterSeriesName(s, 'Otra cosa')).toBe('Otra cosa');
  });
  it('OVA a secas o "[serie] OVA" se busca entre las de la temporada de antes', () => {
    expect(isBareSpecial(s, s.seasons[1])).toBe(true);
    expect(isBareSpecial(s, s.seasons[3])).toBe(true);
    expect(isBareSpecial(s, s.seasons[2])).toBe(false);
    const rz = serie('Re Zero kara Hajimeru Isekai Seikatsu', ['2. Re Zero kara Hajimeru Isekai Seikatsu - Memory Snow OVA']);
    expect(isBareSpecial(rz, rz.seasons[0])).toBe(false);
  });
  it('palabra del tipo', () => {
    expect(specialWord(se('3. Heavens Feel Película'))).toBe('Película');
    expect(specialWord(se('2. OVA'))).toBe('OVA');
    expect(specialWord(se('2. Especiales'))).toBe('Especial');
    expect(specialWord(se('2. Algo'), { format: 'TV corta' })).toBe('TV corta');
    expect(specialWord(se('2. Algo'), { format: 'Serie' })).toBe('Especial');
  });
});

describe('orden de capítulos', () => {
  it('por número, y los que no tienen número al final por nombre', () => {
    const eps = ['472_10_SUB.mp4', 'Extra.mp4', '472_2_SUB.mp4', '472_1.5_SUB.mp4', 'Anexo 2.mp4'].map((name) => ({ name, ep: episodeNumber(name) }));
    eps.find((e) => e.name === 'Extra.mp4').ep = null;
    expect(sortEpisodes(eps).map((e) => e.name)).toEqual(['472_1.5_SUB.mp4', '472_2_SUB.mp4', 'Anexo 2.mp4', '472_10_SUB.mp4', 'Extra.mp4']);
  });
});
