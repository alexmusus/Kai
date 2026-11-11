// Carreras de la sincronización: cambiar de perfil con una sincronización en curso, dos dispositivos y lo que queda
// sin subir. "MEGA" es una carpeta en memoria con compuertas: cada lectura o subida se puede dejar a medias para
// meter en ese hueco lo que haría una persona (cambiar de perfil, marcar un capítulo) u otro dispositivo.
import { describe, it, expect, beforeEach } from 'vitest';
import { state, setIndex, SHARED_FILE, profileFile } from '../../models/store.js';
import { goneNodes } from '../../models/mega.js';
import { syncShared, syncProgress, syncAllProgress, forgetSyncSkips } from '../../models/sync.js';
import { useProfile } from '../../models/profiles.js';
import { setProgress } from '../../models/progress.js';

const A = { id: 'pA', name: 'Alex' };
const B = { id: 'pB', name: 'Beto' };
const ep = (path) => ({ path });

function fakeMega(files = []) {
  let nid = 0;
  const home = { name: '', nodeId: 'root', directory: true, children: [] };
  const add = (name, content) => {
    // timestamp: la hora de subida que pone el servidor de MEGA (en segundos)
    const n = { name, nodeId: 'f' + ++nid, size: 1, key: Array(32).fill(0), content, timestamp: Math.floor(Date.now() / 1000) };
    home.children.push(n);
    return n;
  };
  for (const [name, content] of files) add(name, content);
  /** compuertas: gate.read / gate.write = función que devuelve una promesa a esperar antes de seguir */
  const gate = { read: null, write: null };
  const log = [];
  const reads = [];
  const io = {
    readJson: async (n) => {
      reads.push(n.name);
      if (gate.read) await gate.read(n);
      if (!home.children.includes(n)) throw new Error('ENOENT (el archivo ya no existe en MEGA)');
      return JSON.parse(JSON.stringify(n.content));
    },
    writeJson: async (folder, name, obj, replaced) => {
      const body = JSON.parse(JSON.stringify(obj)); // como megajs: el contenido se fija al empezar a subir
      if (gate.write) await gate.write(name, obj);
      log.push({ name, profile: obj.profile });
      const fresh = add(name, body);
      for (const r of replaced) {
        const i = home.children.indexOf(r);
        if (i >= 0) home.children.splice(i, 1);
      }
      return fresh;
    },
  };
  const items = (pid) => {
    let out = {};
    for (const n of home.children.filter((c) => c.name === profileFile(pid))) out = { ...out, ...n.content.items };
    return out;
  };
  /** una foto del árbol, como lo tendría un dispositivo que no se ha enterado de los cambios */
  const staleView = () => ({ ...home, children: [...home.children] });
  return { home, io, gate, log, reads, items, staleView };
}

/** Una promesa que se resuelve a mano. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

/** La cola de controllers/sync.js: una sincronización a la vez; si se pide otra mientras corre, se hace al terminar. */
function makeSync(m) {
  let syncing = null;
  let again = false;
  const doSync = async () => {
    try {
      await syncShared(m.home, m.io);
      await syncAllProgress(m.home, m.io);
    } catch {
      /* como el controlador: queda en "error" y se reintenta después */
    }
  };
  const sync = () => {
    if (syncing) {
      again = true;
      return syncing;
    }
    syncing = doSync().finally(() => {
      syncing = null;
      if (again) {
        again = false;
        sync();
      }
    });
    return syncing;
  };
  const idle = async () => {
    for (let i = 0; i < 50; i++) {
      await tick();
      if (!syncing) return;
      await syncing;
    }
  };
  return { sync, idle };
}

/** Dos dispositivos en una sola prueba: cada uno con su localStorage y su estado; se usan por turnos. */
function device() {
  const d = { ls: new Map(), profile: null, progress: {}, dirty: false, shared: null };
  return d;
}
function enter(d) {
  localStorage.clear();
  for (const [k, v] of d.ls) localStorage.setItem(k, v);
  state.profile = d.profile;
  state.progress = d.progress;
  state.dirty = d.dirty;
  state.shared = d.shared || { profiles: [A, B].map((p) => ({ ...p, created: 1, u: 1 })), intros: {}, picks: {}, legacyBy: null };
}
function leave(d) {
  d.ls = new Map(localStorage.keys().map((k) => [k, localStorage.getItem(k)]));
  d.profile = state.profile;
  d.progress = state.progress;
  d.dirty = state.dirty;
  d.shared = state.shared;
}

const localOf = (pid) => JSON.parse(localStorage.getItem(`kai.p.${pid}.progress`) || '{}');
const keys = (o) => Object.keys(o).sort();

beforeEach(() => {
  localStorage.clear();
  forgetSyncSkips();
  goneNodes.clear();
  state.storage = null;
  state.library = null;
  setIndex({ byId: new Map(), byPath: new Map(), twins: new Map() });
  state.settings.root = 'Anime';
  state.shared = { profiles: [A, B].map((p) => ({ ...p, created: 1, u: 1 })), intros: {}, picks: {}, legacyBy: null };
  state.sharedLoaded = true;
  state.profile = null;
  state.progress = {};
  state.dirty = false;
  // lo que cada perfil ya tenía guardado en este dispositivo
  localStorage.setItem('kai.p.pA.progress', JSON.stringify({ 'A/local.mp4': { t: 10, d: 100, w: false, u: 50 } }));
  localStorage.setItem('kai.p.pB.progress', JSON.stringify({ 'B/local.mp4': { t: 20, d: 100, w: false, u: 60 } }));
});

const megaAB = () =>
  fakeMega([
    [SHARED_FILE, { profiles: [A, B].map((p) => ({ ...p, created: 1, u: 1 })), intros: {}, picks: {}, keys: {}, legacyBy: null }],
    [profileFile('pA'), { profile: 'pA', items: { 'A/nube.mp4': { t: 1, d: 100, w: true, u: 40 } } }],
    [profileFile('pB'), { profile: 'pB', items: { 'B/nube.mp4': { t: 2, d: 100, w: true, u: 45 } } }],
  ]);

/** Lo que tiene que cumplirse SIEMPRE: nada de A en B ni de B en A, ni en MEGA ni en este dispositivo. */
function expectSeparated(m) {
  expect(keys(m.items('pA')).filter((k) => k.startsWith('B/')), 'archivo de A en MEGA con cosas de B').toEqual([]);
  expect(keys(m.items('pB')).filter((k) => k.startsWith('A/')), 'archivo de B en MEGA con cosas de A').toEqual([]);
  expect(keys(localOf('pA')).filter((k) => k.startsWith('B/')), 'A en este dispositivo con cosas de B').toEqual([]);
  expect(keys(localOf('pB')).filter((k) => k.startsWith('A/')), 'B en este dispositivo con cosas de A').toEqual([]);
  const mem = keys(state.progress).filter((k) => k.startsWith(state.profile.id === 'pA' ? 'B/' : 'A/'));
  expect(mem, 'lo que se ve en pantalla con cosas del otro perfil').toEqual([]);
}

describe('CAUSA RAÍZ · cambiar de perfil con una sincronización en curso', () => {
  it('1. cambio de perfil mientras se LEE el progreso de MEGA', async () => {
    const m = megaAB();
    const { sync, idle } = makeSync(m);
    useProfile(A);
    const reading = deferred();
    m.gate.read = (n) => (n.name === profileFile('pA') ? reading.promise : null);
    sync(); // la de Alex queda leyendo su archivo
    await tick();
    await tick();
    m.gate.read = null;
    useProfile(B); // la persona elige a Beto
    sync(); // selectProfile llama sync() justo después
    reading.resolve(); // termina la lectura del archivo de Alex
    await idle();
    await sync(); // y una más, como al volver a la pestaña
    await idle();
    expectSeparated(m);
  });

  it('2. cambio de perfil mientras se SUBE el progreso a MEGA', async () => {
    const m = megaAB();
    const { sync, idle } = makeSync(m);
    useProfile(A);
    const uploading = deferred();
    m.gate.write = (name) => (name === profileFile('pA') ? uploading.promise : null);
    sync();
    for (let i = 0; i < 6; i++) await tick();
    m.gate.write = null;
    useProfile(B);
    sync();
    uploading.resolve();
    await idle();
    await sync();
    await idle();
    expectSeparated(m);
  });

  it('3. ida y vuelta A → B → A mientras se lee', async () => {
    const m = megaAB();
    const { sync, idle } = makeSync(m);
    useProfile(A);
    const reading = deferred();
    m.gate.read = (n) => (n.name === profileFile('pA') ? reading.promise : null);
    sync();
    await tick();
    await tick();
    m.gate.read = null;
    useProfile(B);
    setProgress(ep('B/visto-en-el-cambio.mp4'), 99, 100); // Beto alcanza a marcar algo
    sync();
    useProfile(A);
    sync();
    reading.resolve();
    await idle();
    useProfile(B);
    await sync();
    await idle();
    expectSeparated(m);
  });

  it('4. cambio de perfil mientras se lee lo compartido (antes de empezar con el progreso)', async () => {
    const m = megaAB();
    const { sync, idle } = makeSync(m);
    useProfile(A);
    const reading = deferred();
    m.gate.read = (n) => (n.name === SHARED_FILE ? reading.promise : null);
    sync();
    await tick();
    m.gate.read = null;
    useProfile(B);
    sync();
    reading.resolve();
    await idle();
    expectSeparated(m);
  });

  it('5. tres cambios seguidos (A → B → A → B) con lecturas y subidas lentas', async () => {
    const m = megaAB();
    const { sync, idle } = makeSync(m);
    const slow = () => new Promise((r) => setTimeout(r, 5));
    m.gate.read = slow;
    m.gate.write = slow;
    for (const p of [A, B, A, B, A, B]) {
      useProfile(p);
      setProgress(ep(`${p.id === 'pA' ? 'A' : 'B'}/cambio-${Math.random().toString(36).slice(2, 6)}.mp4`), 5, 100);
      sync();
      await new Promise((r) => setTimeout(r, 7));
    }
    await idle();
    await sync();
    await idle();
    expectSeparated(m);
  });
});

describe('DOS DISPOSITIVOS · mismo perfil', () => {
  it('6. los dos leen antes de que el otro escriba (escrituras en distinto orden): no se pierde nada', async () => {
    const m = megaAB();
    const d1 = device();
    const d2 = device();
    enter(d1);
    useProfile(A);
    setProgress(ep('A/en-el-iphone.mp4'), 30, 100);
    leave(d1);
    enter(d2);
    useProfile(A);
    setProgress(ep('A/en-el-moto.mp4'), 40, 100);
    const viejo = m.staleView(); // el Moto todavía ve el archivo de antes
    leave(d2);

    enter(d1);
    await syncProgress(m.home, m.io); // el iPhone sube primero y borra el archivo viejo
    leave(d1);
    enter(d2);
    // el Moto, con el árbol sin actualizar, intenta leer el archivo que el iPhone ya reemplazó
    await expect(syncProgress(viejo, m.io)).rejects.toThrow(/ENOENT/);
    expect(state.dirty, 'lo del Moto sigue pendiente, no se perdió').toBe(true);
    await syncProgress(m.home, m.io); // cuando su árbol se entera, sincroniza bien
    leave(d2);
    enter(d1);
    await syncProgress(m.home, m.io);
    expect(keys(m.items('pA'))).toEqual(['A/en-el-iphone.mp4', 'A/en-el-moto.mp4', 'A/nube.mp4']);
    expect(keys(state.progress)).toEqual(keys(m.items('pA')));
  });

  it('7. un dispositivo sin conexión guarda y al volver se junta por capítulo (gana lo más reciente)', async () => {
    const m = megaAB();
    const d1 = device();
    const d2 = device();
    enter(d2); // el Moto, sin conexión: ve la mitad del capítulo 1
    useProfile(A);
    state.progress['A/cap1.mp4'] = { t: 600, d: 1400, w: false, u: 1000 };
    state.dirty = true;
    localStorage.setItem('kai.p.pA.progress', JSON.stringify(state.progress));
    leave(d2);
    enter(d1); // el iPhone, después, lo termina
    useProfile(A);
    state.progress['A/cap1.mp4'] = { t: 1400, d: 1400, w: true, u: 2000 };
    await syncProgress(m.home, m.io);
    leave(d1);
    enter(d2); // el Moto vuelve a tener conexión
    await syncProgress(m.home, m.io);
    expect(state.progress['A/cap1.mp4'].w, 'en el Moto queda como visto').toBe(true);
    expect(m.items('pA')['A/cap1.mp4'].w, 'y en MEGA sigue visto').toBe(true);
  });

  it('8. RELOJ: un dispositivo con la hora adelantada no pisa lo más nuevo de verdad', async () => {
    const m = megaAB();
    const d1 = device();
    const d2 = device();
    enter(d2); // el Moto con el reloj un día adelantado deja el capítulo a la mitad
    useProfile(A);
    state.progress['A/cap1.mp4'] = { t: 600, d: 1400, w: false, u: Date.now() + 86400e3 };
    await syncProgress(m.home, m.io);
    leave(d2);
    enter(d1); // el iPhone lo termina "después" (hora real)
    useProfile(A);
    setProgress(ep('A/cap1.mp4'), 1400, 1400, true);
    await syncProgress(m.home, m.io);
    expect(state.progress['A/cap1.mp4'].w, 'lo que acabo de ver se queda como visto').toBe(true);
  });
});

describe('LO QUE QUEDA SIN SUBIR', () => {
  it('9. lo último que vio Alex antes de cambiar a Beto llega a MEGA sin tener que volver a entrar como Alex', async () => {
    const m = megaAB();
    const { sync, idle } = makeSync(m);
    useProfile(A);
    await sync();
    await idle();
    const reading = deferred();
    m.gate.read = (n) => (n.name === profileFile('pA') ? reading.promise : null);
    setProgress(ep('A/lo-ultimo.mp4'), 700, 1400); // savePosition(true) al salir del reproductor
    sync();
    await tick();
    await tick();
    m.gate.read = null;
    useProfile(B); // elige a Beto antes de que termine
    sync();
    reading.resolve();
    await idle();
    await sync();
    await idle();
    expectSeparated(m);
    expect(keys(m.items('pA')), 'el archivo de Alex en MEGA').toContain('A/lo-ultimo.mp4');
  });

  it('10. lo que se marca mientras se está subiendo no queda como "ya sincronizado"', async () => {
    const m = megaAB();
    useProfile(A);
    const uploading = deferred();
    m.gate.write = () => uploading.promise;
    const p = syncProgress(m.home, m.io);
    for (let i = 0; i < 6; i++) await tick();
    setProgress(ep('A/durante-la-subida.mp4'), 50, 100); // el reproductor guarda cada 4 s
    uploading.resolve();
    await p;
    expect(keys(m.items('pA'))).not.toContain('A/durante-la-subida.mp4'); // todavía no subió (normal)
    expect(state.dirty, 'tiene que seguir marcado como pendiente').toBe(true);
  });
});

describe('NO VOLVER A BAJAR LO QUE NO CAMBIÓ', () => {
  const full = async (m) => {
    await syncShared(m.home, m.io);
    await syncProgress(m.home, m.io);
  };
  it('11. la segunda sincronización, sin cambios aquí ni en MEGA, no lee ni escribe nada', async () => {
    const m = megaAB();
    useProfile(A);
    await full(m); // la primera lee y sube lo de aquí
    await full(m); // esta lee el archivo recién subido y lo deja anotado
    const reads = m.reads.length;
    const writes = m.log.length;
    await full(m);
    await full(m);
    expect(m.reads.length, 'lecturas').toBe(reads);
    expect(m.log.length, 'subidas').toBe(writes);
    expect(state.dirty).toBe(false);
  });

  it('12. si algo cambió aquí, sí lee y sube', async () => {
    const m = megaAB();
    useProfile(A);
    await full(m);
    await full(m);
    const reads = m.reads.length;
    setProgress(ep('A/nuevo.mp4'), 30, 100);
    await full(m);
    expect(m.reads.length).toBeGreaterThan(reads);
    expect(keys(m.items('pA'))).toContain('A/nuevo.mp4');
    expect(state.dirty).toBe(false);
  });

  it('13. si otro dispositivo subió una copia nueva (otro archivo en MEGA), la lee', async () => {
    const m = megaAB();
    useProfile(A);
    await full(m);
    await full(m);
    // otro dispositivo reemplaza el archivo de Alex con algo más
    const old = m.home.children.find((c) => c.name === profileFile('pA'));
    const items = { ...old.content.items, 'A/en-otro.mp4': { t: 9, d: 100, w: true, u: Date.now() } };
    await m.io.writeJson(m.home, profileFile('pA'), { profile: 'pA', items }, [old]);
    await full(m);
    expect(keys(state.progress)).toContain('A/en-otro.mp4');
  });

  it('14. pedir "todo de nuevo" (Sincronizar ahora, volver a Kai) lee aunque nada parezca distinto', async () => {
    const m = megaAB();
    useProfile(A);
    await full(m);
    await full(m);
    const reads = m.reads.length;
    forgetSyncSkips();
    await full(m);
    expect(m.reads.length).toBeGreaterThan(reads);
  });

  it('15. otro perfil en el mismo dispositivo no se salta por lo que se sincronizó del primero', async () => {
    const m = megaAB();
    useProfile(A);
    await full(m);
    await full(m);
    useProfile(B);
    await full(m);
    expect(keys(state.progress)).toEqual(['B/local.mp4', 'B/nube.mp4']);
    expectSeparated(m);
  });
});
