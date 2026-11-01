// Sincronización con MEGA (models/sync.js) contra una cuenta simulada: archivos en memoria que se leen y escriben.
import { describe, it, expect, beforeEach } from 'vitest';
import { state, setIndex, SHARED_FILE, profileFile } from '../../models/store.js';
import { goneNodes } from '../../models/mega.js';
import { syncShared, syncProgress } from '../../models/sync.js';

/** Una cuenta de MEGA de mentira: la raíz con archivos JSON (o archivos que no se pueden leer). */
function fakeMega(files) {
  let nid = 0;
  const home = { name: '', nodeId: 'root', directory: true, children: [] };
  const add = (folder, name, content) => {
    const n = { name, nodeId: 'f' + ++nid, size: 1, key: Array(32).fill(0), parent: folder, content };
    folder.children.push(n);
    return n;
  };
  for (const [name, content] of files) add(home, name, content);
  const writes = [];
  const io = {
    readJson: async (n) => {
      if (n.content instanceof Error) throw n.content; // no se pudo leer (cuota, red…)
      return n.content;
    },
    writeJson: async (folder, name, obj, replaced) => {
      writes.push({ name, obj: JSON.parse(JSON.stringify(obj)), replaced: replaced.map((r) => r.nodeId) });
      const fresh = add(folder, name, JSON.parse(JSON.stringify(obj)));
      for (const r of replaced) if (r !== fresh) folder.children.splice(folder.children.indexOf(r), 1);
      return fresh;
    },
  };
  const named = (name) => home.children.filter((c) => c.name === name);
  return { home, io, writes, named };
}

beforeEach(() => {
  localStorage.clear();
  goneNodes.clear();
  state.storage = null;
  state.library = null;
  setIndex({ byId: new Map(), byPath: new Map(), twins: new Map() });
  state.settings.root = 'Anime';
  state.profile = null;
  state.progress = {};
  state.dirty = false;
  state.shared = { profiles: [], intros: {}, picks: {}, legacyBy: null };
  state.sharedLoaded = false;
});

describe('lo compartido', () => {
  it('si no se puede leer, falla y NO escribe nada (ni da por cargado)', async () => {
    const m = fakeMega([[SHARED_FILE, new Error('cuota')]]);
    state.shared.profiles = [{ id: 'nuevo', name: 'Nuevo', u: 1 }];
    await expect(syncShared(m.home, m.io)).rejects.toThrow('cuota');
    expect(m.writes).toEqual([]);
    expect(state.sharedLoaded).toBe(false);
  });

  it('junta lo de aquí con lo de MEGA y sube una sola copia', async () => {
    const m = fakeMega([[SHARED_FILE, { profiles: [{ id: 'a', name: 'Alex', created: 1, u: 1 }], intros: {}, picks: {} }]]);
    state.shared.profiles = [{ id: 'b', name: 'Diego', created: 2, u: 2 }];
    expect(await syncShared(m.home, m.io)).toBe(true);
    expect(m.named(SHARED_FILE)).toHaveLength(1);
    expect(m.named(SHARED_FILE)[0].content.profiles.map((p) => p.id)).toEqual(['a', 'b']);
    expect(state.sharedLoaded).toBe(true);
  });

  it('si MEGA ya tiene lo mismo, no escribe', async () => {
    const shared = { profiles: [{ id: 'a', name: 'Alex', created: 1, u: 1 }], intros: {}, picks: {}, keys: {}, legacyBy: null };
    const m = fakeMega([[SHARED_FILE, shared]]);
    state.shared = JSON.parse(JSON.stringify(shared));
    expect(await syncShared(m.home, m.io)).toBe(false);
    expect(m.writes).toEqual([]);
  });

  it('dos copias del archivo (MEGA permite nombres repetidos) se juntan en una', async () => {
    const m = fakeMega([
      [SHARED_FILE, { profiles: [{ id: 'a', name: 'Alex', created: 1, u: 1 }] }],
      [SHARED_FILE, { profiles: [{ id: 'b', name: 'Diego', created: 2, u: 1 }] }],
    ]);
    await syncShared(m.home, m.io);
    expect(m.named(SHARED_FILE)).toHaveLength(1);
    expect(m.writes[0].replaced).toHaveLength(2);
    expect(state.shared.profiles.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('una copia dañada (no es JSON) no borra lo demás', async () => {
    const m = fakeMega([[SHARED_FILE, null], [SHARED_FILE, { profiles: [{ id: 'a', name: 'Alex', u: 1 }] }]]);
    await syncShared(m.home, m.io);
    expect(state.shared.profiles.map((p) => p.id)).toEqual(['a']);
  });

  it('si mi perfil se juntó con otro del mismo nombre, paso al que quedó con lo que vi aquí', async () => {
    const m = fakeMega([[SHARED_FILE, { profiles: [{ id: 'viejo', name: 'Alex', created: 1, u: 1 }] }]]);
    state.shared.profiles = [{ id: 'nuevo', name: 'alex', created: 5, u: 5 }];
    state.profile = { id: 'nuevo', name: 'alex' };
    localStorage.setItem('kai.p.viejo.progress', JSON.stringify({ 'Anime/S/a.mp4': { t: 1, u: 1 } }));
    state.progress = { 'Anime/S/b.mp4': { t: 2, u: 2 } };
    await syncShared(m.home, m.io);
    expect(state.profile).toEqual({ id: 'viejo', name: 'Alex' });
    expect(Object.keys(state.progress).sort()).toEqual(['Anime/S/a.mp4', 'Anime/S/b.mp4']);
    expect(state.dirty).toBe(true);
  });
});

describe('el progreso', () => {
  beforeEach(() => {
    state.profile = { id: 'p1', name: 'Alex' };
    state.shared.profiles = [{ id: 'p1', name: 'Alex' }];
  });

  it('si no se puede leer, falla y NO escribe nada', async () => {
    const m = fakeMega([[profileFile('p1'), new Error('red')]]);
    state.progress = { x: { t: 1, u: 1 } };
    state.dirty = true;
    await expect(syncProgress(m.home, m.io)).rejects.toThrow('red');
    expect(m.writes).toEqual([]);
    expect(state.dirty).toBe(true); // sigue pendiente
  });

  it('trae lo de otro dispositivo y sube lo de aquí', async () => {
    const m = fakeMega([[profileFile('p1'), { items: { a: { t: 5, u: 9 }, b: { t: 1, u: 1 } } }]]);
    state.progress = { b: { t: 7, u: 5 }, c: { t: 3, u: 3 } };
    expect(await syncProgress(m.home, m.io)).toBe(true);
    expect(state.progress).toEqual({ a: { t: 5, u: 9 }, b: { t: 7, u: 5 }, c: { t: 3, u: 3 } });
    expect(m.named(profileFile('p1'))[0].content.items).toEqual(state.progress);
    expect(state.dirty).toBe(false);
  });

  it('si MEGA ya tiene todo, solo lee', async () => {
    const items = { a: { t: 5, u: 9 } };
    const m = fakeMega([[profileFile('p1'), { items }]]);
    state.progress = { a: { t: 5, u: 9 } };
    expect(await syncProgress(m.home, m.io)).toBe(false);
    expect(m.writes).toEqual([]);
  });

  it('sin nada que guardar, no crea archivos vacíos', async () => {
    const m = fakeMega([]);
    await syncProgress(m.home, m.io);
    expect(m.writes).toEqual([]);
  });

  it('el primer perfil se queda con el progreso de antes de que hubiera perfiles', async () => {
    const m = fakeMega([['.kai-progreso.json', { items: { viejo: { t: 1, u: 1 } } }]]);
    state.shared.legacyBy = 'p1';
    await syncProgress(m.home, m.io);
    expect(state.progress).toEqual({ viejo: { t: 1, u: 1 } });
    expect(m.named('.kai-progreso.json')).toEqual([]); // ya está en el archivo del perfil
    expect(m.named(profileFile('p1'))).toHaveLength(1);
  });

  it('suma el progreso de un perfil duplicado que se juntó con este', async () => {
    const m = fakeMega([
      [profileFile('p1'), { items: { a: { u: 1 } } }],
      [profileFile('dup'), { items: { b: { u: 2 } } }],
    ]);
    state.shared.profiles.push({ id: 'dup', name: 'alex', deleted: true, mergedInto: 'p1' });
    await syncProgress(m.home, m.io);
    expect(Object.keys(state.progress).sort()).toEqual(['a', 'b']);
    expect(m.named(profileFile('dup'))).toEqual([]);
  });

  it('otro perfil no ve mi progreso', async () => {
    const m = fakeMega([[profileFile('p2'), { items: { suyo: { u: 1 } } }]]);
    await syncProgress(m.home, m.io);
    expect(state.progress).toEqual({});
  });
});
