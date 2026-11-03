/*
 * El reproductor con un capítulo de verdad: un video de prueba (VP9 + Opus, 2:30, con capítulos "Avance inicial",
 * "Opening" y "Parte A") guardado como si estuviera descargado, así se reproduce sin conexión y sin MEGA.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { openKai } from './kai.js';
import { buildFixture } from './fixture.js';

const VIDEO = 'tests/e2e/media/capitulo.mp4';
const SIZE = fs.statSync(new URL('./media/capitulo.mp4', import.meta.url)).size;

/** Abre Kai con los dos primeros capítulos de Dorohedoro descargados (el video de prueba). */
async function openWithDownloads(page, hash = '#/', extra = {}) {
  const { ls } = buildFixture();
  const dor = ls.library.series.find((s) => s.name === 'Dorohedoro');
  const eps = dor.seasons[0].episodes.slice(0, 2);
  for (const e of eps) e.size = SIZE;
  // sin progreso guardado en Dorohedoro: empieza desde el principio
  const progress = Object.fromEntries(Object.entries(ls['p.pA.progress']).filter(([k]) => !k.includes('Dorohedoro')));
  const k = await openKai(page, '#/', { realClock: true, extraLS: { library: ls.library, 'p.pA.progress': progress, ...extra } });
  await page.evaluate(async ({ eps, url }) => {
    const blob = await (await fetch(url)).blob();
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('yoru', 2);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(['dl', 'chunks'], 'readwrite');
      for (const ep of eps) {
        tx.objectStore('dl').put({ id: ep.id, done: true, ep, title: 'Dorohedoro', size: ep.size, mime: ep.mime, path: ep.path, at: 1 });
        tx.objectStore('chunks').put({ id: ep.id, i: 0, blob });
      }
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, { eps, url: '/' + VIDEO });
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.reload();
  await page.waitForTimeout(400);
  return { ...k, eps };
}
const time = (page) => page.evaluate(() => document.querySelector('#video').currentTime);

test('reproduce un capítulo descargado: controles, intro, velocidad, progreso y mini reproductor', async ({ page }) => {
  const k = await openWithDownloads(page);
  await page.evaluate((id) => { location.hash = '#/play/' + id; }, k.eps[0].id);
  const video = page.locator('#video');
  await expect.poll(() => page.evaluate(() => document.querySelector('#video').readyState), { timeout: 10000 }).toBeGreaterThan(1);
  await page.evaluate(() => { const v = document.querySelector('#video'); v.muted = true; return v.play(); });
  await expect.poll(() => time(page), { timeout: 10000 }).toBeGreaterThan(0.5);
  await expect(page.locator('#app')).toContainText('Dorohedoro');

  // las marcas de capítulos del MP4; al entrar al Opening (5 s → 1:35) lo salta solo y ofrece volver
  await expect.poll(() => page.locator('#st-marks *').count(), { timeout: 10000 }).toBeGreaterThan(0);
  await page.evaluate(() => { document.querySelector('#video').currentTime = 10; });
  await expect.poll(() => time(page), { timeout: 10000 }).toBeGreaterThan(94);
  await expect(page.locator('#st-skip')).toHaveText('Volver a la intro');
  await page.locator('#st-skip').click();
  await expect.poll(() => time(page)).toBeLessThan(20);
  // ya no lo vuelve a saltar solo; el botón lo salta a mano
  await expect(page.locator('#st-skip')).toHaveText('Saltar intro');
  await page.locator('#st-skip').click();
  await expect.poll(() => time(page)).toBeGreaterThan(94);

  // ±10 s con el teclado
  const before = await time(page);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => time(page)).toBeLessThan(before - 5);

  // velocidad
  await page.locator('#st-speed').click();
  await page.locator('#st-menu [data-v="1.5"], #st-menu button:has-text("1.5")').first().click();
  await expect.poll(() => page.evaluate(() => document.querySelector('#video').playbackRate)).toBe(1.5);

  // al salir, sigue sonando en el mini reproductor y el progreso queda guardado (cada 4 s)
  await page.waitForTimeout(4500);
  await page.evaluate(() => { location.hash = '#/'; });
  await expect(page.locator('#mini')).toBeVisible();
  const saved = await page.evaluate((path) => JSON.parse(localStorage.getItem('kai.p.pA.progress'))[path], k.eps[0].path);
  expect(saved.t).toBeGreaterThan(80);
  expect(saved.w).toBe(false);
  await page.locator('#mini [data-act="mini-close"]').click();
  await expect(page.locator('#mini')).toBeHidden();
  await expect(video).toHaveCount(1);
  expect(k.errors).toEqual([]);
});

test('al terminar un capítulo queda visto y ofrece el siguiente', async ({ page }) => {
  const k = await openWithDownloads(page, '#/', { settings: { root: 'Anime', autoplay: false, autoSkip: true, theme: 'dark', cat: false } });
  await page.evaluate((id) => { location.hash = '#/play/' + id; }, k.eps[0].id);
  await expect.poll(() => page.evaluate(() => document.querySelector('#video').readyState), { timeout: 10000 }).toBeGreaterThan(1);
  await page.evaluate(() => { const v = document.querySelector('#video'); v.muted = true; v.currentTime = 147; return v.play(); });
  await expect(page.locator('#p-next')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#p-next')).toContainText('Episodio 2');
  const saved = await page.evaluate((path) => JSON.parse(localStorage.getItem('kai.p.pA.progress'))[path], k.eps[0].path);
  expect(saved.w).toBe(true);
  await page.locator('[data-act="p-next-now"]').click();
  await expect(page).toHaveURL(new RegExp(`#/play/${k.eps[1].id}$`));
  expect(k.errors).toEqual([]);
});

test('quitar un capítulo y quitar todas las descargas preguntan con la hoja de Kai', async ({ page }) => {
  const k = await openWithDownloads(page, '#/descargas');
  page.on('dialog', (d) => { k.errors.push('ventana del navegador: ' + d.message()); d.dismiss(); });
  await expect(page.locator('.downloads .ep')).toHaveCount(2);
  // uno: Escape es que no
  await page.locator(`.ep[data-id="${k.eps[0].id}"] [data-act="dl"]`).click();
  await expect(page.locator('#sheet [role="alertdialog"]')).toContainText('del dispositivo?');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet')).toBeHidden();
  await page.locator(`.ep[data-id="${k.eps[0].id}"] [data-act="dl"]`).click();
  await page.locator('#sheet [data-act="confirm-ok"]').click();
  await expect(page.locator('.downloads .ep')).toHaveCount(1);
  // todas
  await page.locator('[data-act="clear-dl"]').click();
  await expect(page.locator('#sheet [role="alertdialog"]')).toContainText('¿Quitar todas las descargas?');
  await page.locator('#sheet [data-act="confirm-ok"]').click();
  await expect(page.locator('.downloads')).toContainText('No hay capítulos descargados.');
  expect(await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('yoru', 2);
    r.onsuccess = () => { const q = r.result.transaction('dl').objectStore('dl').count(); q.onsuccess = () => res(q.result); };
  }))).toBe(0);
  expect(k.errors).toEqual([]);
});

test('deslizar hacia abajo en el video pasa al mini reproductor, y tocar el mini vuelve al reproductor', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone', 'gesto táctil');
  await page.emulateMedia({ reducedMotion: 'no-preference' }); // para ver las animaciones entre grande y mini
  const k = await openWithDownloads(page, '#/serie/' + 0);
  const dor = k.si('Dorohedoro');
  await page.evaluate((h) => { location.hash = h; }, `#/serie/${dor}`);
  await page.waitForTimeout(200);
  await page.evaluate((id) => { location.hash = '#/play/' + id; }, k.eps[0].id);
  await expect.poll(() => page.evaluate(() => document.querySelector('#video').readyState), { timeout: 10000 }).toBeGreaterThan(1);
  await page.evaluate(() => { const v = document.querySelector('#video'); v.muted = true; return v.play(); });
  // el dedo baja 160 px desde el centro del video, en varios pasos
  await page.evaluate(async () => {
    const tap = document.querySelector('#st-tap');
    const r = tap.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y0 = r.top + r.height / 3;
    const ev = (type, y) => tap.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true }));
    ev('pointerdown', y0);
    for (let d = 10; d <= 160; d += 15) {
      ev('pointermove', y0 + d);
      await new Promise((res) => requestAnimationFrame(res));
    }
    ev('pointerup', y0 + 160);
    // al soltar: el mini ya está a la vista y volando, sin esperar a que el navegador vuelva atrás
    window.__atRelease = {
      mini: !document.querySelector('#mini').hidden,
      flying: document.querySelector('#mini').getAnimations().length > 0,
      leaving: document.querySelector('#app').classList.contains('is-leaving'),
    };
  });
  expect(await page.evaluate(() => window.__atRelease)).toEqual({ mini: true, flying: true, leaving: true });
  await expect(page).toHaveURL(new RegExp(`#/serie/${dor}$`));
  await expect(page.locator('#mini')).toBeVisible();
  // sin restos del gesto en el video
  expect(await page.evaluate(() => document.querySelector('#stage').style.transform)).toBe('');
  expect(await page.evaluate(() => document.querySelector('#video').paused)).toBe(false);
  // tocar el mini vuelve al reproductor grande, entrando con su animación
  await expect(page.locator('#app.is-leaving')).toHaveCount(0);
  await page.evaluate(() => {
    // lo que se anima justo después de llegar al reproductor
    addEventListener('hashchange', () => {
      const slot = document.querySelector('#stage-slot');
      window.__grow = !!slot && slot.getAnimations().length > 0;
    }, { once: true });
  });
  await page.locator('#mini .mini-open').click();
  await expect(page).toHaveURL(/#\/play\//);
  expect(await page.evaluate(() => window.__grow)).toBe(true);
  await expect(page.locator('#mini')).toBeHidden();
  expect(k.errors).toEqual([]);
});
