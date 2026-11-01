/*
 * Recorridos de Kai con una biblioteca simulada (sin MEGA ni internet).
 * Sirven de red mientras se reorganiza el código: lo que hoy funciona tiene que seguir igual.
 * Con KAI_SHOTS=<carpeta> además guarda una captura de cada pantalla, para compararlas antes y después.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { openKai } from './kai.js';

async function shot(page, name, info) {
  const dir = process.env.KAI_SHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${dir}/${info.project.name}-${name}.png`, fullPage: true });
}
const go = (page, hash) => page.evaluate((h) => { location.hash = h; }, hash).then(() => page.waitForTimeout(250));
const texts = (page, sel) => page.locator(sel).allInnerTexts().then((a) => a.map((t) => t.trim()));
const hrefs = (page, sel) => page.locator(sel).evaluateAll((els) => els.map((e) => e.getAttribute('href')));

test('inicio: portada, continuar viendo, series y películas', async ({ page }, info) => {
  const k = await openKai(page, '#/');
  await expect(page.locator('.tv-hero .tv-title')).toContainText('Yahari');
  const body = await page.locator('#app').innerText();
  expect(body).toContain('Continuar viendo');
  expect(body).toContain('Episodio 6');
  expect(body).toContain('Dorohedoro');
  expect(body).toContain('Kimi no Na wa');
  expect(body).not.toContain('El gigante de hierro'); // Cine no sale en el inicio
  await shot(page, 'inicio', info);
  expect(k.errors).toEqual([]);
});

test('serie con varias temporadas: menú con nombres uniformes', async ({ page }, info) => {
  const k = await openKai(page, '#/');
  await go(page, '#/serie/' + k.si(k.yah));
  expect(await texts(page, '.season-grid .shelf-title')).toEqual(['Temporada 1', 'OVA', 'Temporada 2', 'OVA']);
  await expect(page.locator('.tv-facts.is-info')).toContainText('4 temporadas');
  await shot(page, 'serie-menu', info);
  expect(k.errors).toEqual([]);
});

test('temporada: Sub/Doblado, anterior, siguiente y volver al menú', async ({ page }, info) => {
  const k = await openKai(page, '#/');
  const si = k.si(k.yah);
  await go(page, `#/serie/${si}/2`);
  const zoku = k.library.series[si].seasons[2].episodes;
  const sub = zoku.filter((e) => e.name.includes('_SUB')).map((e) => '#/play/' + e.id);
  const dub = zoku.filter((e) => e.name.includes('_DUB')).map((e) => '#/play/' + e.id);
  expect(await hrefs(page, '.episodes .ep-main')).toEqual(sub);
  await shot(page, 'temporada', info);
  await page.locator('[data-act="lang"][data-lang="dob"]').click();
  await page.waitForTimeout(250);
  expect(await hrefs(page, '.episodes .ep-main')).toEqual(dub);
  await page.reload();
  await page.waitForTimeout(400);
  expect(await hrefs(page, '.episodes .ep-main')).toEqual(dub); // el perfil recuerda el idioma
  await page.locator('.step-btn.is-next').click();
  await expect(page).toHaveURL(new RegExp(`#/serie/${si}/3$`));
  await page.locator('.season-step >> text=Temporadas').click();
  await expect(page).toHaveURL(new RegExp(`#/serie/${si}$`));
  expect(k.errors).toEqual([]);
});

test('serie de una temporada: lista de capítulos directa', async ({ page }, info) => {
  const k = await openKai(page, '#/');
  await go(page, '#/serie/' + k.si('Dorohedoro'));
  await expect(page.locator('.episodes .ep-main')).toHaveCount(12);
  await expect(page.locator('.tv-actions .is-primary')).toContainText('Episodio 3');
  await shot(page, 'serie-una', info);
  expect(k.errors).toEqual([]);
});

test('película y cine', async ({ page }, info) => {
  const k = await openKai(page, '#/');
  await go(page, `#/pelicula/${k.si('Peliculas')}/${encodeURIComponent('Kimi no Na wa')}`);
  await expect(page.locator('.tv-title')).toContainText('Kimi no Na wa');
  await expect(page.locator('.tv-actions .is-primary')).toHaveAttribute('href', /#\/play\//);
  await shot(page, 'pelicula', info);
  await go(page, `#/serie/${k.si('Peliculas')}`);
  expect(await page.locator('#app').innerText()).toContain('Koe no Katachi');
  await shot(page, 'estante', info);
  await go(page, `#/serie/${k.si('Cine')}`);
  expect(await page.locator('#app').innerText()).toContain('El gigante de hierro');
  expect(k.errors).toEqual([]);
});

test('catálogo: tipos, filtros y búsqueda', async ({ page }, info) => {
  const k = await openKai(page, '#/');
  await go(page, '#/catalogo?t=series');
  let body = await page.locator('.catalog').innerText();
  expect(body).toContain('Dorohedoro');
  expect(body).toContain('Yahari');
  expect(body).not.toContain('Koe no Katachi');
  await shot(page, 'catalogo', info);
  await go(page, '#/catalogo?' + new URLSearchParams({ g: 'Fantasía' }));
  body = await page.locator('.catalog').innerText();
  expect(body).toContain('Dorohedoro');
  expect(body).not.toContain('Yahari');
  await go(page, '#/catalogo?t=peliculas');
  body = await page.locator('.catalog').innerText();
  expect(body).toContain('Koe no Katachi');
  expect(body).not.toContain('Dorohedoro');
  await go(page, '#/catalogo?' + new URLSearchParams({ q: 'gigante' }));
  expect(await page.locator('.catalog').innerText()).toContain('gigante');
  expect(k.errors).toEqual([]);
});

test('volver atrás conserva el scroll', async ({ page }) => {
  const k = await openKai(page, '#/');
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(200);
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(100);
  await page.locator(`a[href="#/serie/${k.si('Dorohedoro')}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`#/serie/${k.si('Dorohedoro')}$`));
  await page.locator('.bar [data-act="back"]').click();
  await page.waitForTimeout(400);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThan(5);
  expect(k.errors).toEqual([]);
});

test('perfiles, ajustes, descargas', async ({ page }, info) => {
  const k = await openKai(page, '#/');
  await go(page, '#/perfiles');
  expect(await page.locator('#app').innerText()).toContain('Diego');
  await shot(page, 'perfiles', info);
  await go(page, '#/ajustes');
  expect(await page.locator('#app').innerText()).toContain('Gris Culero');
  await shot(page, 'ajustes', info);
  await go(page, '#/descargas');
  await page.waitForTimeout(300);
  await shot(page, 'descargas', info);
  expect(k.errors).toEqual([]);
});

test('reproducción sin conexión no rompe la página', async ({ page }, info) => {
  const k = await openKai(page, '#/');
  const ep = k.library.series[k.si('Dorohedoro')].seasons[0].episodes[2];
  await go(page, '#/play/' + ep.id);
  await page.waitForTimeout(500);
  expect(await page.locator('#app').innerText()).toContain('Dorohedoro');
  await shot(page, 'play', info);
  await go(page, '#/');
  expect(k.errors).toEqual([]);
});

test('etiqueta de códec: nombre y puntito rojo si este navegador no lo reproduce', async ({ page }) => {
  const { buildFixture } = await import('./fixture.js');
  const eps = buildFixture().library.series.find((s) => s.name === 'Dorohedoro').seasons[0].episodes;
  const codecs = {
    [`${eps[0].id}:${eps[0].size}`]: { video: { codec: 'avc1', profile: 100, bits: 8 }, audio: { codec: 'mp4a' } },
    [`${eps[1].id}:${eps[1].size}`]: { video: { codec: 'mp2v' }, audio: null }, // MPEG-2: ningún navegador
  };
  const k = await openKai(page, '#/', { extraLS: { codecs } });
  await go(page, '#/serie/' + k.si('Dorohedoro'));
  const tags = page.locator('.episodes .ep-codec');
  await expect(tags.nth(0)).toHaveText('H.264');
  await expect(tags.nth(0)).not.toHaveClass(/is-bad/);
  await expect(tags.nth(1)).toHaveText('MP2V');
  await expect(tags.nth(1)).toHaveClass(/is-bad/);
  expect(k.errors).toEqual([]);
});

test('seguir aquí lo que quedó a medias en otro dispositivo', async ({ page }, info) => {
  const { buildFixture, NOW } = await import('./fixture.js');
  const { ls } = buildFixture();
  const dor = ls.library.series.find((s) => s.name === 'Dorohedoro').seasons[0].episodes[4];
  const progress = { ...ls['p.pA.progress'], '@now': { p: dor.path, t: 754, d: 1440, w: false, dev: 'otro', dn: 'iPhone', u: NOW - 20 * 60000 } };
  const k = await openKai(page, '#/', { extraLS: { 'p.pA.progress': progress } });
  await expect(page.locator('.resume-card')).toContainText('En tu iPhone, hace 20 min');
  await expect(page.locator('.resume-card')).toContainText('Dorohedoro · Episodio 5');
  await expect(page.locator('.resume-card [data-act="resume-here"]')).toContainText('12:34');
  await shot(page, 'seguir-aqui', info);
  await page.locator('[data-act="resume-dismiss"]').click();
  await expect(page.locator('.resume-card')).toHaveCount(0);
  expect(k.errors).toEqual([]);
});

test('Seleccionar capítulos de una temporada', async ({ page }, info) => {
  const k = await openKai(page, '#/');
  await go(page, '#/serie/' + k.si('Dorohedoro'));
  await page.locator('[data-act="pick-mode"]').click();
  await expect(page.locator('#pick-bar')).toBeVisible();
  await expect(page.locator('#pick-count')).toHaveText('Toca los capítulos que quieras');
  const eps = page.locator('#season-eps .ep .ep-main');
  await eps.nth(0).click();
  await eps.nth(4).click();
  await expect(page).toHaveURL(new RegExp(`#/serie/${k.si('Dorohedoro')}$`)); // no abrió el capítulo
  await expect(page.locator('#pick-count')).toHaveText('2 capítulos, 500 MB');
  await page.locator('[data-act="pick-unseen"]').click(); // Dorohedoro: ninguno visto del todo
  await expect(page.locator('#pick-count')).toHaveText('12 capítulos, 3.0 GB');
  await expect(page.locator('[data-act="pick-all"]')).toHaveText('Ninguno');
  await shot(page, 'seleccionar', info);
  await page.locator('[data-act="pick-dl"]').click(); // sin conexión: avisa y no sale del modo
  await expect(page.locator('#pick-bar')).toBeVisible();
  await page.locator('[data-act="pick-mode"]').click();
  await expect(page.locator('#pick-bar')).toBeHidden();
  await eps.nth(1).click();
  await expect(page).toHaveURL(/#\/play\//); // fuera del modo, tocar abre el capítulo
  expect(k.errors).toEqual([]);
});

test('Descubrir: lo que ya tienes lleva a su página, lo demás abre su ficha', async ({ page }, info) => {
  const { NOW } = await import('./fixture.js');
  const item = (id, title, extra = {}) => ({ id, title, romaji: title, synopsis: `Sinopsis de ${title}.`, cover: '', color: '', genres: ['Acción'], score: 81, year: 2024, format: 'Serie', episodes: 12, next: null, ...extra });
  const discover = {
    emision: { v: 2, at: NOW, items: [item(105228, 'Dorohedoro'), item(999, 'Algo nuevo', { next: { ep: 5, at: NOW + 2 * 86400000 } })] },
    porque: { v: 2, at: NOW, items: [item(998, 'Otra cosa', { because: ['Dorohedoro'] })] },
  };
  const k = await openKai(page, '#/', { extraLS: { discover } });
  await go(page, '#/descubrir/emision');
  await expect(page.locator('#disc-list .shelf-item')).toHaveCount(2);
  await expect(page.locator('#disc-list a.shelf-item')).toHaveAttribute('href', `#/serie/${k.si('Dorohedoro')}`);
  await expect(page.locator('#disc-list')).toContainText('Ep. 5');
  await shot(page, 'descubrir', info);
  await page.locator('[data-act="discover-open"]').click();
  await expect(page.locator('#sheet')).toContainText('Algo nuevo');
  await page.keyboard.press('Escape');
  await go(page, '#/descubrir/porque');
  await expect(page.locator('#disc-list')).toContainText('Porque viste Dorohedoro');
  expect(k.errors).toEqual([]);
});

test('Explorar MEGA y Descargados sin conexión no rompen', async ({ page }) => {
  const k = await openKai(page, '#/');
  await go(page, '#/explorar');
  await go(page, '#/descargas');
  await expect(page.locator('main.downloads')).toBeVisible();
  expect(k.errors).toEqual([]);
});
