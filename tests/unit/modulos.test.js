// Todos los módulos que carga Kai tienen que estar en la caché del service worker (SHELL, para abrir sin conexión)
// y en los <link rel="modulepreload"> de index.html (para pedirlos todos a la vez).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Módulos alcanzables desde app.js siguiendo los import (estáticos y dinámicos con texto fijo). */
function moduleGraph(entry) {
  const seen = new Set();
  const visit = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    // sin comentarios: los JSDoc dicen import('./types.js') solo para los tipos
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
    const specs = [...code.matchAll(/\bimport\s*(?:[\w${},*\s]+from\s*)?['"](\.[^'"]+)['"]|\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g)];
    for (const m of specs) visit(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1] || m[2])));
  };
  visit(entry);
  return [...seen].sort();
}

const graph = moduleGraph('app.js');

describe('módulos de Kai', () => {
  it('todos están en la caché del service worker', () => {
    const shell = [...read('sw.js').match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(graph.filter((f) => !shell.includes(f))).toEqual([]);
  });
  it('todos se precargan desde index.html, y no se precarga nada que no exista', () => {
    const pre = [...read('index.html').matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]).sort();
    expect(pre).toEqual(graph);
  });
});
