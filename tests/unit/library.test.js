// La biblioteca armada desde el árbol de MEGA (models/library.js), con un árbol simulado.
import { describe, it, expect, beforeEach } from 'vitest';
import { state, index } from '../../models/store.js';
import { goneNodes } from '../../models/mega.js';
import { buildLibrary as build0, setLibrary, setLangPref, librarySignature, migrateProgressKeys, langsOf, langPref } from '../../models/library.js';

let nid = 0;
const file = (name, extra = {}) => ({ name, nodeId: 'n' + (++nid), key: Array(32).fill(1), size: 100, timestamp: 1000 + nid, ...extra });
const dir = (name, children) => {
  const d = { name, directory: true, nodeId: 'd' + (++nid), children };
  for (const c of children) c.parent = d;
  return d;
};
// buildLibrary recibe el árbol, pero las rutas las saca de state.storage (el de la sesión): se ponen los dos
const buildLibrary = (st) => { state.storage = st; return build0(st); };
const tree = (anime) => {
  const root = dir('', [anime]);
  root.parent = null;
  return { root };
};

beforeEach(() => {
  nid = 0;
  localStorage.clear();
  goneNodes.clear();
  state.profile = { id: 't' };
  state.progress = {};
  state.library = null;
  state.settings.root = 'Anime';
});

describe('buildLibrary', () => {
  it('series, temporadas en orden, capítulos y subtítulos', () => {
    const st = tree(dir('Anime', [
      dir('Fate', [
        dir('2. Fate Zero', [file('2_1_SUB.mp4'), file('2_0_SUB.mp4')]),
        dir('1. Fate UBW', [file('1_1_SUB.mp4'), file('1_1_SUB.srt')]),
        dir('1.5 Prologo', [file('p_1_SUB.mp4')]),
        dir('Vacía', [file('notas.txt')]),
      ]),
      dir('Dorohedoro', [file('9_2_SUB.mp4'), file('9_1_SUB.mp4')]),
      dir('.oculta', [file('x.mp4')]),
      dir('Sin videos', [dir('1. Nada', [])]),
    ]));
    const lib = buildLibrary(st);
    expect(lib.v).toBe(2);
    expect(lib.series.map((s) => s.name)).toEqual(['Dorohedoro', 'Fate']);
    const fate = lib.series[1];
    expect(fate.seasons.map((se) => [se.num, se.title])).toEqual([[1, 'Fate UBW'], [1.5, 'Prologo'], [2, 'Fate Zero']]);
    expect(fate.seasons[2].episodes.map((e) => e.ep)).toEqual([0, 1]);
    const ubw = fate.seasons[0].episodes[0];
    expect(ubw.path).toBe('Anime/Fate/1. Fate UBW/1_1_SUB.mp4');
    expect(ubw.subs.map((s) => s.name)).toEqual(['1_1_SUB.srt']);
    expect(ubw.mime).toBe('video/mp4');
    const dor = lib.series[0];
    expect(dor.seasons).toHaveLength(1);
    expect(dor.seasons[0].num).toBe(null);
    expect(dor.seasons[0].episodes.map((e) => e.name)).toEqual(['9_1_SUB.mp4', '9_2_SUB.mp4']);
    expect(dor.added).toBe(Math.max(...dor.seasons[0].episodes.map((e) => e.ts)));
  });

  it('sin la carpeta de la biblioteca', () => {
    expect(() => buildLibrary(tree(dir('Otra', [])))).toThrow('NOROOT');
  });

  it('lo que Kai borró no aparece aunque MEGA aún no lo confirme', () => {
    const gone = file('1_2_SUB.mp4');
    const lib1 = buildLibrary(tree(dir('Anime', [dir('S', [file('1_1_SUB.mp4'), gone])])));
    expect(lib1.series[0].seasons[0].episodes).toHaveLength(2);
    goneNodes.add(gone.nodeId);
    const lib2 = buildLibrary(tree(dir('Anime', [dir('S', [file('1_1_SUB.mp4'), gone])])));
    expect(lib2.series[0].seasons[0].episodes.map((e) => e.name)).toEqual(['1_1_SUB.mp4']);
  });

  it('si hay dos carpetas con el mismo nombre, la que tiene más cosas', () => {
    const st = tree(dir('Anime', [dir('S', [file('1_1_SUB.mp4')])]));
    st.root.children.unshift(dir('anime', []));
    expect(buildLibrary(st).series.map((s) => s.name)).toEqual(['S']);
  });
});

describe('Sub y Doblado', () => {
  const twinsTree = () => tree(dir('Anime', [dir('Yahari', [dir('1. Zoku', [
    file('3_1_SUB.mp4'), file('3_1_DUB.mp4'), file('3_2_SUB.mp4'), file('3_2_DUB.mp4'), file('3_3_SUB.mp4'),
  ])])]));

  it('muestra un solo idioma y recuerda el elegido por perfil', () => {
    setLibrary(buildLibrary(twinsTree()));
    const se = state.library.series[0].seasons[0];
    expect(se.langs).toEqual(['sub', 'dob']);
    expect(se.episodes.map((e) => e.name)).toEqual(['3_1_SUB.mp4', '3_2_SUB.mp4', '3_3_SUB.mp4']);
    setLangPref(state.library.series[0], 'dob');
    const se2 = state.library.series[0].seasons[0];
    // el 3 solo existe subtitulado: se muestra igual
    expect(se2.episodes.map((e) => e.name)).toEqual(['3_1_DUB.mp4', '3_2_DUB.mp4', '3_3_SUB.mp4']);
    expect(index.twins.get('Anime/Yahari/1. Zoku/3_1_DUB.mp4')).toEqual(['Anime/Yahari/1. Zoku/3_1_SUB.mp4']);
    expect(index.byPath.get('Anime/Yahari/1. Zoku/3_1_SUB.mp4').ei).toBe(-1); // oculto en esta vista
    expect(langsOf([se2.episodes[0]])).toEqual(['sub', 'dob']); // cuenta la versión oculta
    expect(langsOf([se2.episodes[2]])).toEqual(['sub']);
  });

  it('sin elección, el idioma del último capítulo que viste', () => {
    setLibrary(buildLibrary(twinsTree()));
    state.progress['Anime/Yahari/1. Zoku/3_1_SUB.mp4'] = { t: 10, d: 100, u: 1 };
    state.progress['Anime/Yahari/1. Zoku/3_2_DUB.mp4'] = { t: 10, d: 100, u: 5 };
    expect(langPref(state.library.series[0])).toBe('dob');
  });

  it('una temporada sin gemelos no se toca', () => {
    setLibrary(buildLibrary(tree(dir('Anime', [dir('S', [file('1_1_DUB.mp4'), file('1_2_DUB.mp4')])]))));
    const se = state.library.series[0].seasons[0];
    expect(se.langs).toBe(null);
    expect(se.full).toBeUndefined();
    expect(se.episodes).toHaveLength(2);
  });
});

describe('progreso al renombrar carpetas', () => {
  it('lo visto pasa a la ruta nueva (mismo id de MEGA)', () => {
    const ep = file('1_1_SUB.mp4');
    setLibrary(buildLibrary(tree(dir('Anime', [dir('Fate', [dir('1. UBW', [ep])])]))));
    state.progress['Anime/Fate/1. UBW/1_1_SUB.mp4'] = { t: 50, d: 100, u: 7 };
    setLibrary(buildLibrary(tree(dir('Anime', [dir('Fate', [dir('1. Fate stay night Unlimited Blade Works', [ep])])]))));
    expect(state.progress).toEqual({ 'Anime/Fate/1. Fate stay night Unlimited Blade Works/1_1_SUB.mp4': { t: 50, d: 100, u: 7 } });
    expect(state.dirty).toBe(true);
  });

  it('rutas de la versión 1 (sin la carpeta raíz)', () => {
    setLibrary(buildLibrary(tree(dir('Anime', [dir('S', [file('1_1_SUB.mp4')])]))));
    const prog = { 'S/1_1_SUB.mp4': { u: 3 }, 'Otra/x.mp4': { u: 1 } };
    expect(migrateProgressKeys(prog)).toBe(true);
    expect(prog).toEqual({ 'Anime/S/1_1_SUB.mp4': { u: 3 }, 'Otra/x.mp4': { u: 1 } }); // lo desconocido se queda
  });

  it('si ya había progreso en la ruta nueva, gana el más reciente', () => {
    setLibrary(buildLibrary(tree(dir('Anime', [dir('S', [file('1_1_SUB.mp4')])]))));
    const prog = { 'S/1_1_SUB.mp4': { u: 3 }, 'Anime/S/1_1_SUB.mp4': { u: 9 } };
    migrateProgressKeys(prog);
    expect(prog).toEqual({ 'Anime/S/1_1_SUB.mp4': { u: 9 } });
  });
});

describe('librarySignature', () => {
  it('cambia solo si cambia lo que se ve', () => {
    const a = buildLibrary(tree(dir('Anime', [dir('S', [file('1_1_SUB.mp4')])])));
    nid = 0;
    const b = buildLibrary(tree(dir('Anime', [dir('S', [file('1_1_SUB.mp4')])])));
    expect(librarySignature(a)).toBe(librarySignature(b));
    nid = 0;
    const c = buildLibrary(tree(dir('Anime', [dir('S', [file('1_1_SUB.mp4'), file('1_2_SUB.mp4')])])));
    expect(librarySignature(c)).not.toBe(librarySignature(a));
    expect(librarySignature(null)).toBe('');
  });
});
