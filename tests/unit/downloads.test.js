// Descargas (models/downloads.js) con IndexedDB en memoria, MEGA simulado y una carpeta de mentira en memoria.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

/* ── una carpeta en memoria, como la que da showDirectoryPicker ── */
function memDir(name = 'Kai') {
  const kids = new Map();
  const dir = {
    kind: 'directory', name, kids, perm: 'granted',
    async queryPermission() { return dir.perm; },
    async requestPermission() { return dir.perm; },
    async getDirectoryHandle(n, { create } = {}) {
      if (!kids.has(n)) { if (!create) throw Object.assign(new Error('no'), { name: 'NotFoundError' }); kids.set(n, memDir(n)); }
      return kids.get(n);
    },
    async getFileHandle(n, { create } = {}) {
      if (!kids.has(n)) { if (!create) throw Object.assign(new Error('no'), { name: 'NotFoundError' }); kids.set(n, { kind: 'file', name: n, data: new Blob([]) }); }
      const f = kids.get(n);
      return {
        async getFile() { return f.data; },
        async createWritable() {
          const parts = [];
          return { async write(b) { parts.push(b); }, async close() { f.data = new Blob(parts); }, async abort() {} };
        },
      };
    },
    async removeEntry(n) { kids.delete(n); },
    keys() { return (async function* () { yield* kids.keys(); })(); },
  };
  return dir;
}
const tree = (d) => Object.fromEntries([...d.kids].map(([k, v]) => [k, v.kind === 'directory' ? tree(v) : v.data.size]));

let dl, store, events, C, idb;
const notices = [];
const changed = [];
let failNext = 0;
let quotaNext = false;

beforeAll(async () => {
  globalThis.showDirectoryPicker = () => {}; // como en Chrome: hay carpeta de descargas
  globalThis.navigator.wakeLock = undefined;
  dl = await import('../../models/downloads.js');
  store = await import('../../models/store.js');
  events = await import('../../lib/events.js');
  idb = (await import('../../models/idb.js')).idb;
  C = (await import('../../models/mega.js')).C;
  // el navegador guarda el acceso a la carpeta en IndexedDB; una carpeta de mentira no se puede guardar ahí
  const handles = new Map();
  const { put, get } = idb;
  idb.put = (st, v, k) => (st === 'subcache' && v && v.kind === 'directory' ? (handles.set(k, v), Promise.resolve()) : put(st, v, k));
  idb.get = (st, k) => (st === 'subcache' && handles.has(k) ? Promise.resolve(handles.get(k)) : get(st, k));
  // MEGA simulado: los bytes de cada pedazo son su posición (así se puede revisar que se armó en orden)
  C.fileKey = async () => ({});
  C.readRange = async (url, fk, start, end) => {
    if (quotaNext) throw Object.assign(new Error('cuota'), { code: 'QUOTA', timeLeft: 60 });
    if (failNext > 0) { failNext--; throw Object.assign(new Error('red'), { code: 'NET' }); }
    const out = new Uint8Array(end - start + 1);
    for (let i = 0; i < out.length; i++) out[i] = (start + i) % 251;
    return out;
  };
  events.on('notice', (t) => notices.push(t));
  events.on('download-changed', (id) => changed.push(id));
});

const MB = 1024 * 1024;
const ep = (id, size = 9 * MB, path = `Anime/Fate/1. UBW/${id}.mp4`) => ({ id, name: `${id}.mp4`, path, ep: 1, size, key: 'k', fa: null, mime: 'video/mp4', ts: 0 });
const waitDone = (id) => dl.downloadAndWait(ep(id), 'Fate');

beforeEach(async () => {
  localStorage.clear();
  notices.length = 0;
  changed.length = 0;
  failNext = 0;
  quotaNext = false;
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
  store.state.storage = { api: { request: async () => ({ g: 'https://mega/x' }) }, root: {} };
  store.state.settings.root = 'Anime';
  store.state.queue = [];
  store.state.dls = {};
  dl.forgetFolder();
  dl.setInUseCheck(() => false);
  await idb.clear('chunks');
  await idb.clear('dl');
  await dl.refreshSaved();
});
afterEach(() => { store.state.storage = null; });

describe('descargar', () => {
  it('baja en pedazos de 4 MB, queda guardado y se arma en orden', async () => {
    const e = ep('a', 9 * MB + 5);
    await dl.downloadAndWait(e, 'Fate');
    expect(store.state.saved.has('a')).toBe(true);
    expect((await idb.chunkKeys('a')).length).toBe(3);
    const blob = await dl.localBlob(e);
    expect(blob.size).toBe(9 * MB + 5);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[4 * MB], bytes[9 * MB + 4]]).toEqual([0, (4 * MB) % 251, (9 * MB + 4) % 251]);
    expect(notices).toContain('Episodio 1 listo para ver sin conexión.');
    expect(changed).toContain('a');
  });
  it('sin conexión no se pone en la cola', () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    dl.queueDownload(ep('b'), 'Fate');
    expect(store.state.queue).toEqual([]);
    expect(notices).toEqual(['Necesitas conexión para descargar.']);
  });
  it('un corte pasajero se reintenta', async () => {
    failNext = 2;
    await waitDone('c');
    expect(store.state.saved.has('c')).toBe(true);
  });
  it('sin cuota se detiene, avisa y sigue desde donde quedó la próxima vez', async () => {
    quotaNext = true;
    await waitDone('d');
    expect(store.state.saved.has('d')).toBe(false);
    expect(notices[0]).toMatch(/límite de transferencia/);
    quotaNext = false;
    await idb.put('chunks', { id: 'd', i: 0, blob: new Blob([new Uint8Array(4 * MB)]) }); // ya tenía el primer pedazo
    await waitDone('d');
    expect(store.state.saved.has('d')).toBe(true);
  });
  it('lo que quedó a medias sigue al abrir Kai', async () => {
    await idb.put('dl', { id: 'e', done: false, ep: ep('e'), title: 'Fate' });
    await dl.resumePendingDownloads();
    await dl.downloadAndWait(ep('e'), 'Fate');
    expect(store.state.saved.has('e')).toBe(true);
  });
  it('quitar borra los pedazos y avisa', async () => {
    await waitDone('f');
    await dl.removeDownload('f');
    expect(store.state.saved.has('f')).toBe(false);
    expect(await idb.chunkKeys('f')).toEqual([]);
    expect(notices).toContain('Quitado del dispositivo.');
    expect(await dl.localBlob(ep('f'))).toBe(null);
  });
  it('MKV se reproduce como WebM', () => {
    expect(dl.playType({ mime: 'video/x-matroska' })).toBe('video/webm');
    expect(dl.playType({ mime: 'video/mp4' })).toBe('video/mp4');
  });
});

describe('carpeta de descargas', () => {
  it('nombres de archivo válidos y ruta sin la carpeta de series', () => {
    expect(dl.safeName('Re:Zero / OVA?.')).toBe('Re Zero OVA');
    expect(dl.safeName('')).toBe('Kai');
    expect(dl.folderRel({ path: 'Anime/Fate/1. UBW/x.mp4', name: 'x.mp4' })).toEqual(['Fate', '1. UBW', 'x.mp4']);
    expect(dl.folderRel({ path: 'suelto.mp4', name: 'suelto.mp4' }, 'Mi MEGA')).toEqual(['Mi MEGA', 'suelto.mp4']);
  });
  it('al terminar pasa a la carpeta como MP4 y se borra la copia de la app', async () => {
    const root = memDir();
    await dl.useFolder(root);
    await waitDone('g');
    expect(tree(root)).toEqual({ Fate: { '1. UBW': { 'g.mp4': 9 * MB } } });
    expect(await idb.chunkKeys('g')).toEqual([]);
    expect((await dl.localBlob(ep('g'))).size).toBe(9 * MB);
    expect(notices).toContain('Episodio 1 listo para ver sin conexión en tu carpeta.');
  });
  it('sin permiso queda en la app, y pasa después (menos lo que se está viendo)', async () => {
    const root = memDir();
    root.perm = 'prompt';
    await dl.useFolder(root);
    await waitDone('h');
    await waitDone('i');
    expect(tree(root)).toEqual({});
    expect(notices.some((t) => /quedó dentro de la app/.test(t))).toBe(true);
    root.perm = 'granted';
    dl.setInUseCheck((id) => id === 'i');
    expect(await dl.flushFolder()).toBe(1);
    expect(tree(root)).toEqual({ Fate: { '1. UBW': { 'h.mp4': 9 * MB } } });
  });
  it('quitar borra el archivo y las carpetas que quedan vacías', async () => {
    const root = memDir();
    await dl.useFolder(root);
    await waitDone('j');
    await dl.removeDownload('j', true);
    expect(tree(root)).toEqual({});
  });
  it('sin permiso para borrar, se borra la próxima vez que haya', async () => {
    const root = memDir();
    await dl.useFolder(root);
    await waitDone('k');
    root.perm = 'prompt';
    await dl.removeDownload('k', true);
    expect(tree(root)).toEqual({ Fate: { '1. UBW': { 'k.mp4': 9 * MB } } });
    root.perm = 'granted';
    await dl.flushFolder();
    expect(tree(root)).toEqual({});
  });
  it('sin carpeta (Safari, Firefox): todo dentro de la app', async () => {
    await waitDone('l');
    expect((await idb.chunkKeys('l')).length).toBe(3);
  });
});
