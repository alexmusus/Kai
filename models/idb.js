// @ts-check
/*
 * models/idb.js — IndexedDB de Kai (base "yoru", el nombre viejo de la app, para no perder lo guardado):
 *  - chunks:   pedazos de 4 MB de los capítulos descargados, por [id, número]
 *  - dl:       datos de cada descarga (por id)
 *  - thumbs:   miniaturas de MEGA (por id)
 *  - subcache: capítulos leídos de los MP4 (y el acceso a la carpeta de descargas); el nombre viene de cuando también
 *              guardaba subtítulos
 * Cada operación es una transacción; los errores llegan como promesas rechazadas.
 */

export const idb = (() => {
  let dbp;
  const open = () =>
    dbp ||
    (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('yoru', 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['id', 'i'] });
        if (!db.objectStoreNames.contains('dl')) db.createObjectStore('dl', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs');
        if (!db.objectStoreNames.contains('subcache')) db.createObjectStore('subcache');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  const run = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode);
      const out = fn(tx.objectStore(store));
      tx.oncomplete = () => res(out && 'result' in out ? out.result : out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  };
  const range = (id) => IDBKeyRange.bound([id, 0], [id, Infinity]);
  return {
    get: (s, k) => run(s, 'readonly', (st) => st.get(k)),
    put: (s, v, k) => run(s, 'readwrite', (st) => (k === undefined ? st.put(v) : st.put(v, k))),
    del: (s, k) => run(s, 'readwrite', (st) => st.delete(k)),
    all: (s) => run(s, 'readonly', (st) => st.getAll()),
    chunkKeys: (id) => run('chunks', 'readonly', (st) => st.getAllKeys(range(id))),
    chunks: (id) => run('chunks', 'readonly', (st) => st.getAll(range(id))),
    dropChunks: (id) => run('chunks', 'readwrite', (st) => st.delete(range(id))),
    clear: (s) => run(s, 'readwrite', (st) => st.clear()),
  };
})();
