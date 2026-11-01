/* Abre Kai con la biblioteca de prueba, sin conexión y con la hora fija. */
import { expect } from '@playwright/test';
import { buildFixture, NOW } from './fixture.js';

export async function openKai(page, hash = '#/', { extraLS = {}, realClock = false } = {}) {
  const { ls, library, yah } = buildFixture();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // nada sale a internet: ni MEGA, ni AniList, ni fuentes
  await page.route(/^(?!http:\/\/127\.0\.0\.1:8123\/)/, (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
  // la hora fija hace que las capturas salgan iguales; el reproductor necesita que el reloj avance
  if (!realClock) await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ data }) => {
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false });
    Math.random = (() => { let x = 42; return () => ((x = (x * 16807) % 2147483647) / 2147483647); })();
    if (!sessionStorage.getItem('seeded')) {
      localStorage.clear();
      for (const [k, v] of Object.entries(data)) localStorage.setItem('kai.' + k, JSON.stringify(v));
      sessionStorage.setItem('seeded', '1');
    }
  }, { data: { ...ls, ...extraLS } });
  await page.goto('/' + hash);
  await expect(page.locator('#app')).not.toBeEmpty();
  await page.waitForTimeout(400);
  return { errors, library, yah, si: (name) => library.series.findIndex((s) => s.name === name) };
}
