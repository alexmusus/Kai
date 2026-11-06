// Separar lo que se copió de un perfil a otro (models/profile-copies.js).
import { describe, it, expect, beforeEach } from 'vitest';
import { state, profileFile } from '../../models/store.js';
import { goneNodes } from '../../models/mega.js';
import { findCopies, groupCopies, removals, dropFromProfile, readProfileItems } from '../../models/profile-copies.js';
import { mergeProgress } from '../../models/progress.js';
import { LS } from '../../lib/util.js';

const lib = {
  series: [
    { name: 'Dorohedoro', all: [{ path: 'Anime/Dorohedoro/1.mp4' }, { path: 'Anime/Dorohedoro/2.mp4' }] },
    { name: 'Frieren', all: [{ path: 'Anime/Frieren/1.mp4' }] },
  ],
};

beforeEach(() => {
  localStorage.clear();
  goneNodes.clear();
  state.profile = null;
  state.progress = {};
});

describe('encontrar lo copiado', () => {
  it('cuenta solo lo idéntico (hasta el momento en que se marcó); lo visto por separado no', () => {
    const copia = { t: 1400, d: 1440, w: true, u: 1700000000123 };
    const copies = findCopies({
      alex: { 'Anime/Dorohedoro/1.mp4': copia, 'Anime/Frieren/1.mp4': { w: true, t: 1, d: 1, u: 5 } },
      antwan: { 'Anime/Dorohedoro/1.mp4': { ...copia }, 'Anime/Frieren/1.mp4': { w: true, t: 1, d: 1, u: 6 } },
      wilson: {},
    });
    expect([...copies]).toEqual([['Anime/Dorohedoro/1.mp4', ['alex', 'antwan']]]);
  });
  it('Más tarde también; "@now" y lo ya quitado no', () => {
    const later = { on: true, u: 9 };
    const copies = findCopies({
      a: { '@later/Frieren': later, '@now': { p: 'x', u: 1 }, 'Anime/Dorohedoro/2.mp4': { t: 0, w: false, u: 3 } },
      b: { '@later/Frieren': { ...later }, '@now': { p: 'x', u: 1 }, 'Anime/Dorohedoro/2.mp4': { t: 0, w: false, u: 3 } },
    });
    expect([...copies.keys()]).toEqual(['@later/Frieren']);
  });
  it('se agrupa por serie', () => {
    const copies = new Map([
      ['Anime/Dorohedoro/1.mp4', ['b', 'a']],
      ['Anime/Dorohedoro/2.mp4', ['a', 'b']],
      ['@later/Dorohedoro', ['a', 'b']],
      ['@later/Frieren', ['a', 'b']],
    ]);
    expect(groupCopies(copies, lib)).toEqual([
      { name: 'Dorohedoro', keys: ['Anime/Dorohedoro/1.mp4', 'Anime/Dorohedoro/2.mp4', '@later/Dorohedoro'], pids: ['a', 'b'], eps: 2, later: true },
      { name: 'Frieren', keys: ['@later/Frieren'], pids: ['a', 'b'], eps: 0, later: true },
    ]);
  });
});

describe('quitarlo del perfil que no era', () => {
  it('las marcas nuevas ganan a la copia al juntar', () => {
    const items = { 'Anime/Dorohedoro/1.mp4': { t: 1400, d: 1440, w: true, u: 100 }, '@later/Frieren': { on: true, u: 100 } };
    const marks = removals(items, Object.keys(items), 200);
    const merged = mergeProgress(items, marks);
    expect(merged['Anime/Dorohedoro/1.mp4']).toEqual({ t: 0, d: 1440, w: false, u: 200 });
    expect(merged['@later/Frieren']).toEqual({ on: false, u: 200 });
    // y en otro dispositivo que todavía tiene la copia vieja, también gana
    expect(mergeProgress(marks, items)).toEqual(marks);
  });

  it('en MEGA (una sola copia del archivo) y en la copia de este dispositivo', async () => {
    const home = { name: '', nodeId: 'root', directory: true, children: [] };
    const file = { name: profileFile('antwan'), nodeId: 'f1', parent: home, content: { items: { 'Anime/Frieren/1.mp4': { w: true, t: 1, d: 1, u: 5 }, mio: { w: true, t: 1, d: 1, u: 4 } } } };
    home.children.push(file);
    const writes = [];
    const io = { readJson: async (n) => n.content, writeJson: async (folder, name, obj, replaced) => writes.push({ name, obj, replaced: replaced.map((r) => r.nodeId) }) };
    LS.set('p.antwan.progress', { 'Anime/Frieren/1.mp4': { w: true, t: 1, d: 1, u: 5 } });
    state.profile = { id: 'alex', name: 'Alex' };
    await dropFromProfile(home, 'antwan', ['Anime/Frieren/1.mp4'], io);
    expect(writes).toHaveLength(1);
    expect(writes[0].replaced).toEqual(['f1']);
    expect(writes[0].obj.items['Anime/Frieren/1.mp4'].w).toBe(false);
    expect(writes[0].obj.items.mio.w).toBe(true); // lo demás de Antwan queda
    expect(LS.get('p.antwan.progress', null)['Anime/Frieren/1.mp4'].w).toBe(false);
    expect(state.progress).toEqual({}); // Alex (el activo) no se toca
  });

  it('el perfil activo se lee junto con lo de este dispositivo', async () => {
    const home = { name: '', nodeId: 'root', directory: true, children: [{ name: profileFile('alex'), nodeId: 'f1', content: { items: { a: { w: true, u: 1 } } } }] };
    state.profile = { id: 'alex', name: 'Alex' };
    state.progress = { b: { w: true, u: 2 } };
    const items = await readProfileItems(home, 'alex', { readJson: async (n) => n.content, writeJson: async () => {} });
    expect(Object.keys(items).sort()).toEqual(['a', 'b']);
  });
});
