// El tema se pone en index.html antes de que cargue el JS (para que no haya un destello del otro tema): los colores
// que usa ahí tienen que ser los mismos de models/store.js.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { TONES, DARK_TONES, BLOCK_TONES, BLOCK_DARK } from '../../models/store.js';

const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const inline = html.slice(html.indexOf('<script>', html.indexOf('theme-color')), html.indexOf('styles.css'));

describe('el tema antes del JS (index.html)', () => {
  it('conoce cada tono claro y oscuro con su color', () => {
    for (const [name, t] of [...Object.entries(TONES), ...Object.entries(DARK_TONES), ...Object.entries(BLOCK_TONES), ...Object.entries(BLOCK_DARK)])
      expect(inline, `${name} ${t.bg}`).toContain(`${name}: '${t.bg}'`);
  });
  it('va antes de la hoja de estilos y después del color de la barra del sistema', () => {
    expect(html.indexOf('name="theme-color"')).toBeLessThan(html.indexOf("dataset.theme = t"));
    expect(html.indexOf("dataset.theme = t")).toBeLessThan(html.indexOf('href="styles.css"'));
  });
});
