// Lo mínimo del navegador que necesitan los módulos de Kai para cargarse en Node.
import fs from 'node:fs';
import vm from 'node:vm';

globalThis.window = globalThis;
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
Object.defineProperty(globalThis.localStorage, 'keys', { value: () => [...mem.keys()] });
// lo poco de la página que tocan los modelos al cargarse (guardar al salir, quitar HTML de una sinopsis)
globalThis.addEventListener = () => {};
globalThis.document = {
  hidden: false,
  addEventListener: () => {},
  createElement: () => ({ set innerHTML(h) { this.textContent = String(h).replace(/<[^>]+>/g, ''); } }),
};
// core.js es un script clásico (lo comparte el service worker): define globalThis.MegaCore
vm.runInThisContext(fs.readFileSync(new URL('../../core.js', import.meta.url), 'utf8'));
