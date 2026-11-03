/*
 * El service worker guarda todos los archivos de Kai: después de abrirla una vez, abre sin conexión.
 * Si se agrega un módulo nuevo y no se pone en SHELL (sw.js), esta prueba falla.
 */
import { test, expect } from '@playwright/test';
import { buildFixture } from './fixture.js';

test.use({ serviceWorkers: 'allow' });

test('abre sin conexión con todos sus módulos', async ({ page, context }) => {
  const { ls } = buildFixture();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await context.route(/^(?!http:\/\/127\.0\.0\.1:8123\/)/, (r) => r.abort());
  await page.addInitScript((data) => {
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false }); // sin tocar MEGA (la sesión es de mentira)
    if (!localStorage.getItem('kai.library')) for (const [k, v] of Object.entries(data)) localStorage.setItem('kai.' + k, JSON.stringify(v));
  }, ls);
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // sin conexión justo después de instalarse: solo tiene lo que guardó al instalarse (SHELL)
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.tv-hero .tv-title')).toContainText('Yahari');
  expect(errors).toEqual([]);
});
