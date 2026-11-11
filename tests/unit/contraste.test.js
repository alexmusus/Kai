// Los tonos del estilo Bloques tienen que leerse: el texto, el texto tenue y el apagado sobre el fondo y sobre las
// superficies, la letra del botón principal sobre su color, y el color de los enlaces sobre el fondo.
// (Papel salió con letra blanca sobre naranja, 2.9 de contraste; el mínimo para texto es 4.5.)
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = fs.readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

/** Las variables de color de un bloque de styles.css, por su selector exacto. */
function tone(selector) {
  const at = css.indexOf(selector + ' {');
  expect(at, selector).toBeGreaterThan(-1);
  const body = css.slice(at, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
}
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const base = "[data-style='bloques']";
const TONES = {
  Grafito: tone(`${base}[data-theme='dark']`),
  Bosque: { ...tone(`${base}[data-theme='dark']`), ...tone(`${base}[data-theme='dark'][data-dark='bosque']`) },
  Piedra: tone(`${base}[data-theme='light']`),
  Papel: { ...tone(`${base}[data-theme='light']`), ...tone(`${base}[data-theme='light'][data-tone='papel']`) },
};

describe('Bloques: contraste de cada tono', () => {
  for (const [name, t] of Object.entries(TONES)) {
    it(name, () => {
      const pairs = [
        ['texto / fondo', t['--text'], t['--bg']],
        ['texto / superficie', t['--text'], t['--surface']],
        ['texto / bloque', t['--text'], t['--surface2']],
        ['tenue / fondo', t['--dim'], t['--bg']],
        ['tenue / superficie', t['--dim'], t['--surface']],
        ['apagado / fondo', t['--faint'], t['--bg']],
        ['apagado / superficie', t['--faint'], t['--surface']],
        ['letra del botón / botón', t['--accent-ink'], t['--accent']],
        ['enlaces / fondo', t['--accent2'], t['--bg']],
        ['enlaces / superficie', t['--accent2'], t['--surface']],
      ];
      for (const [what, fg, bg] of pairs) expect(contrast(fg, bg), `${name}: ${what} (${fg} sobre ${bg})`).toBeGreaterThanOrEqual(4.5);
    });
  }
});
