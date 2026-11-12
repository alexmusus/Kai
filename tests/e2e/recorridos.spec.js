/*
 * Recorridos de Kai con una biblioteca simulada (sin MEGA ni internet).
 * Sirven de red mientras se reorganiza el código: lo que hoy funciona tiene que seguir igual.
 * Con KAI_SHOTS=<carpeta> además guarda una captura de cada pantalla, para compararlas antes y después.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { openKai } from './kai.js';
import { buildFixture } from './fixture.js';

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

test('temporada: Sub/Doblado, pestañas de temporadas y volver al menú', async ({ page }, info) => {
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
  await expect(page.locator('.season-tab.is-on')).toHaveAttribute('href', `#/serie/${si}/2`);
  await page.locator(`.season-tab[href="#/serie/${si}/3"]`).click();
  await expect(page).toHaveURL(new RegExp(`#/serie/${si}/3$`));
  await page.locator('.season-tab.is-all').click();
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

test('volver atrás dibuja la página en popstate, sin esperar a hashchange (gesto de iPhone sin parpadeo)', async ({ page }) => {
  const k = await openKai(page, '#/');
  const dor = k.si('Dorohedoro');
  await go(page, `#/serie/${dor}`);
  await expect(page).toHaveURL(new RegExp(`#/serie/${dor}$`));
  // lo que hay en pantalla justo después de popstate (este oyente corre después del de Kai): tiene que ser ya el
  // inicio, no la serie que se deja. Si Kai esperara a hashchange, en ese instante seguiría la serie.
  await page.evaluate(() => {
    addEventListener('popstate', () => (window.__atPop = !!document.querySelector('.tv.is-home')), { once: true });
  });
  await page.evaluate(() => history.back());
  await expect(page.locator('.tv.is-home')).toBeVisible();
  expect(await page.evaluate(() => window.__atPop)).toBe(true);
  // y se dibuja una sola vez: ir y volver otra vez sigue funcionando igual
  await go(page, `#/serie/${dor}`);
  await expect(page).toHaveURL(new RegExp(`#/serie/${dor}$`));
  await page.evaluate(() => history.back());
  await expect(page.locator('.tv.is-home')).toBeVisible();
  expect(k.errors).toEqual([]);
});

test('volver a una página que no cambió reusa lo que ya estaba dibujado (no parpadea nada)', async ({ page }) => {
  const k = await openKai(page, '#/');
  await page.evaluate(() => { window.__tile = document.querySelector('.tv-row a'); });
  await go(page, `#/serie/${k.si('Dorohedoro')}`);
  await page.evaluate(() => history.back());
  await expect(page.locator('.tv.is-home')).toBeVisible();
  // la portada cambió (muestra la serie que acabas de ver), pero las filas de pósters son los mismos elementos de antes
  expect(await page.evaluate(() => !!window.__tile && window.__tile.isConnected)).toBe(true);
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
  // los tonos, las animaciones y lo avanzado van plegados: se abren al tocar su título
  await expect(page.locator('#fold-adv')).not.toHaveAttribute('open', '');
  await page.locator('#fold-look > summary').click();
  expect(await page.locator('#app').innerText()).toContain('Gris Culero');
  await page.locator('#fold-adv > summary').click();
  await expect(page.locator('#cine-key')).toBeVisible();
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

test('catálogo: lo que ya viste completo va al final', async ({ page }) => {
  const { buildFixture, NOW } = await import('./fixture.js');
  const { ls } = buildFixture();
  const dor = ls.library.series.find((s) => s.name === 'Dorohedoro');
  const progress = { ...ls['p.pA.progress'] };
  for (const e of dor.seasons.flatMap((x) => x.episodes)) progress[e.path] = { t: 1400, d: 1440, u: NOW - 3600e3, w: 1 };
  const k = await openKai(page, '#/', { extraLS: { 'p.pA.progress': progress } });
  await go(page, '#/catalogo?t=series');
  const titles = page.locator('#cat-results .shelf-title');
  await expect(titles.last()).toHaveText('Dorohedoro'); // en A–Z iría primero
  await expect(titles.first()).not.toHaveText('Dorohedoro');
  expect(k.errors).toEqual([]);
});

test('seguir aquí lo que quedó a medias en otro dispositivo', async ({ page }, info) => {
  const { buildFixture, NOW } = await import('./fixture.js');
  const { ls } = buildFixture();
  const dor = ls.library.series.find((s) => s.name === 'Dorohedoro').seasons[0].episodes[4];
  const progress = { ...ls['p.pA.progress'], '@now': { p: dor.path, t: 754, d: 1440, w: false, dev: 'otro', dn: 'iPhone', u: NOW - 20 * 60000 } };
  const k = await openKai(page, '#/', { extraLS: { 'p.pA.progress': progress } });
  // una burbuja arriba; al tocarla se abre con el detalle
  await expect(page.locator('.resume-pill')).toContainText('Seguir de tu iPhone · 12:34');
  await expect(page.locator('.resume-card [data-act="resume-here"]')).not.toBeInViewport();
  await page.locator('.resume-pill').click();
  await expect(page.locator('.resume-card')).toHaveClass(/is-open/);
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
  const hint = info.project.name === 'pc' ? 'Elige capítulos (Shift + clic: varios seguidos)' : 'Toca los capítulos que quieras';
  await expect(page.locator('#pick-count')).toHaveText(hint);
  const eps = page.locator('#season-eps .ep .ep-main');
  await eps.nth(0).click();
  await eps.nth(4).click();
  if (info.project.name === 'pc') {
    // Shift + clic elige del último tocado hasta ese (del 5 al 8), y se suelta igual
    await eps.nth(7).click({ modifiers: ['Shift'] });
    await expect(page.locator('#season-eps .ep.is-picked')).toHaveCount(5);
    await eps.nth(5).click(); // suelta el 6
    await eps.nth(7).click({ modifiers: ['Shift'] }); // y del 6 al 8 quedan sueltos
    await expect(page.locator('#season-eps .ep.is-picked')).toHaveCount(2);
  }
  await expect(page).toHaveURL(new RegExp(`#/serie/${k.si('Dorohedoro')}$`)); // no abrió el capítulo
  await expect(page.locator('#pick-count')).toHaveText('2 capítulos, 500 MB por descargar');
  // todos de una vez, y otra vez para soltarlos
  const total = await eps.count();
  await expect(page.locator('#pick-all')).toHaveText('Todos');
  await page.locator('#pick-all').click();
  await expect(page.locator('#season-eps .ep.is-picked')).toHaveCount(total);
  await expect(page.locator('#pick-all')).toHaveText('Ninguno');
  await page.locator('#pick-all').click();
  await expect(page.locator('#season-eps .ep.is-picked')).toHaveCount(0);
  await expect(page.locator('#pick-count')).toHaveText(hint);
  await eps.nth(0).click();
  await eps.nth(4).click();
  await expect(page.locator('[data-act="pick-seen"]')).toBeEnabled();
  await expect(page.locator('[data-act="pick-unseen"]')).toBeDisabled(); // ninguno de los dos está visto
  await shot(page, 'seleccionar', info);
  await page.locator('[data-act="pick-dl"]').click(); // sin conexión: avisa y no sale del modo
  await expect(page.locator('#pick-bar')).toBeVisible();
  await page.locator('[data-act="pick-mode"]').click();
  await expect(page.locator('#pick-bar')).toBeHidden();
  // marcar como vistos varios a la vez (y volver a marcarlos como no vistos)
  await page.locator('[data-act="pick-mode"]').click();
  await eps.nth(1).click();
  await eps.nth(2).click();
  await page.locator('[data-act="pick-seen"]').click();
  await expect(page.locator('#toast')).toHaveText('2 capítulos marcados como vistos.');
  await expect(page.locator('#pick-bar')).toBeHidden();
  await expect(page.locator('#season-eps .ep').nth(1)).toHaveClass(/is-seen/);
  await expect(page.locator('#season-eps .ep').nth(2)).toHaveClass(/is-seen/);
  await page.locator('[data-act="pick-mode"]').click();
  await eps.nth(1).click();
  await expect(page.locator('[data-act="pick-seen"]')).toBeDisabled(); // ya está visto
  await page.locator('[data-act="pick-unseen"]').click();
  await expect(page.locator('#toast')).toHaveText('1 capítulo marcado como no visto.');
  await expect(page.locator('#season-eps .ep').nth(1)).not.toHaveClass(/is-seen/);
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

test('crear un perfil y entrar con él', async ({ page }) => {
  const k = await openKai(page, '#/perfiles');
  await page.locator('[data-act="profile-add"]').click();
  await page.locator('#profile-new input[name="name"]').fill('Sofi');
  await page.locator('#profile-new button').click();
  await expect(page.locator('#tv-greet')).toHaveText(/, Sofi$/);
  await go(page, '#/perfiles');
  await expect(page.locator('.profile-name')).toHaveText(['Alex', 'Diego', 'Sofi', 'Agregar']);
  // con el mismo nombre no se crea otro: entra con el que ya existe
  await page.locator('[data-act="profile-add"]').click();
  await page.locator('#profile-new input[name="name"]').fill(' alex ');
  await page.locator('#profile-new button').click();
  await expect(page.locator('#tv-greet')).toHaveText(/, Alex$/);
  expect(k.errors).toEqual([]);
});

test('entrar a MEGA: sin conexión dice por qué y conserva el correo', async ({ page }) => {
  const k = await openKai(page, '#/', { extraLS: { session: null } });
  await expect(page.locator('#login')).toBeVisible();
  await page.locator('#login input[name="email"]').fill('yo@example.com');
  await page.locator('#login input[name="password"]').fill('secreta');
  await page.locator('#login button').click();
  await expect(page.locator('.form-error')).toBeVisible();
  await expect(page.locator('#login input[name="email"]')).toHaveValue('yo@example.com');
  await expect(page.locator('#login input[name="password"]')).toHaveValue('');
  expect(k.errors.filter((e) => !/Failed to load resource|ERR_FAILED/.test(e))).toEqual([]);
});

test('hoja de opciones de un capítulo: marcar como visto y deshacer', async ({ page }) => {
  const k = await openKai(page, '#/');
  await go(page, '#/serie/' + k.si('Dorohedoro'));
  const ep1 = page.locator('#season-eps .ep').nth(0);
  await expect(ep1.locator('.ep-sub')).toHaveText('Sin ver');
  await ep1.locator('[data-act="more"]').click();
  await expect(page.locator('#sheet .sheet-title')).toHaveText('Episodio 1');
  await page.locator('#sheet [data-act="toggle-seen"]').click();
  await expect(ep1.locator('.ep-sub')).toContainText('Visto');
  await ep1.locator('[data-act="more"]').click();
  await expect(page.locator('#sheet [data-act="toggle-seen"]')).toHaveText('Marcar como no visto');
  await page.locator('#sheet [data-act="toggle-seen"]').click();
  await expect(ep1.locator('.ep-sub')).toHaveText('A continuación'); // lo último que tocaste pasa a ser lo siguiente
  await ep1.locator('[data-act="more"]').click();
  await page.locator('#sheet [data-act="close"].sheet-btn').click();
  await expect(page.locator('#sheet')).toBeHidden();
  expect(k.errors).toEqual([]);
});

test('volver: Anterior/Siguiente no dejan entradas de más, y el menú lleva a las páginas', async ({ page }) => {
  const k = await openKai(page, '#/');
  const si = k.si(k.yah);
  await page.locator(`.shelf a[href="#/serie/${si}"]`).click();
  await page.locator(`.season-grid a[href="#/serie/${si}/0"]`).click();
  // las temporadas son pestañas: cambiar de una a otra no deja entradas de más en el historial
  await page.locator(`.season-tab[href="#/serie/${si}/1"]`).click();
  await page.locator(`.season-tab[href="#/serie/${si}/2"]`).click();
  await expect(page).toHaveURL(new RegExp(`#/serie/${si}/2$`));
  await page.locator('.bar [data-act="back"]').click();
  await expect(page).toHaveURL(new RegExp(`#/serie/${si}$`)); // directo al menú, sin pasar por la 1 y la 0
  await page.locator('.bar [data-act="back"]').click();
  await expect(page).toHaveURL(/#\/$/);
  // la barra flotante: lleva a Ajustes (y la marca), vuelve al inicio, y tu perfil abre el menú
  await page.locator('#dock .dock-tab[data-tab="ajustes"]').click();
  await expect(page).toHaveURL(/#\/ajustes$/);
  await expect(page.locator('#dock .dock-tab.is-on')).toHaveAttribute('data-tab', 'ajustes');
  await page.locator('#dock .dock-tab[data-tab="home"]').click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('#dock .dock-tab.is-on')).toHaveAttribute('data-tab', 'home');
  await page.locator('#dock .dock-btn').click();
  // el menú: cambiar de perfil, actualizar y el tema (el botón ofrece el otro tema después de usarlo)
  await expect(page.locator('#dock .dock-panel .dock-item')).toHaveText(['Actualizar', 'Tema claro']);
  await page.locator('#dock .dock-panel [data-act="theme"]').click();
  await expect(page.locator('#dock .dock-panel [data-act="theme"]')).toHaveText('Tema oscuro');
  await page.locator('#dock .dock-panel [data-act="theme"]').click();
  await page.locator('#dock .dock-btn').click();
  // en el inicio, Inicio lleva arriba
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.locator('#dock .dock-tab[data-tab="home"]').click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  // la hoja de opciones pone en cola con el nombre de la serie (sin conexión: avisa)
  await go(page, '#/serie/' + k.si('Dorohedoro'));
  await page.locator('#season-eps .ep').nth(0).locator('[data-act="more"]').click();
  await page.locator('#sheet [data-act="save"]').click();
  await expect(page.locator('#toast')).toHaveText('Necesitas conexión para descargar.');
  expect(k.errors).toEqual([]);
});

test('Inicio y Volver aciertan aunque se vuelva adelante a la página de antes', async ({ page }) => {
  const k = await openKai(page, '#/');
  for (const h of ['#/ajustes', '#/descargas', '#/ajustes']) {
    await page.evaluate((x) => { location.hash = x; }, h);
    await page.waitForTimeout(150);
  }
  // el botón atrás del navegador y luego el adelante
  await page.goBack();
  await expect(page).toHaveURL(/#\/descargas$/);
  await page.goForward();
  await expect(page).toHaveURL(/#\/ajustes$/);
  await page.locator('header [data-act="home"]').first().click();
  await expect(page).toHaveURL(/#\/$/);
  // de vuelta en la portada el atrás del navegador no se pierde
  await page.goForward();
  await expect(page).toHaveURL(/#\/ajustes$/);
  expect(k.errors).toEqual([]);
});

test('cerrar sesión pregunta con la hoja de Kai, sin ventanas del navegador', async ({ page }) => {
  const k = await openKai(page, '#/ajustes');
  page.on('dialog', (d) => { k.errors.push('ventana del navegador: ' + d.message()); d.dismiss(); });
  const logout = page.locator('[data-act="logout"]');
  await logout.scrollIntoViewIfNeeded();
  await logout.click();
  const sheet = page.locator('#sheet [role="alertdialog"]');
  await expect(sheet).toContainText('¿Cerrar sesión en este dispositivo?');
  await sheet.locator('text=Cancelar').click();
  await expect(page.locator('#sheet')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('kai.library'))).not.toBeNull();
  await logout.click();
  await page.locator('#sheet [data-act="confirm-ok"]').click();
  await expect(page.locator('main.login')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('kai.library'))).toBeNull();
  expect(k.errors).toEqual([]);
});

test('teléfono de gama media (4 GB): modo liviano sin desenfoques ni fondo en movimiento', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 4 }));
  const k = await openKai(page, '#/');
  await expect(page.locator('html.lite')).toHaveCount(1);
  const bar = await page.evaluate(() => getComputedStyle(document.querySelector('.dock-btn')).backdropFilter);
  expect(bar).toBe('none');
  const drift = await page.evaluate(() => getComputedStyle(document.querySelector('.ambient'), '::before').animationName);
  expect(drift).toBe('none');
  expect(k.errors).toEqual([]);
});

test('teléfono de gama alta: sin modo liviano', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 8 }));
  await openKai(page, '#/');
  await expect(page.locator('html.lite')).toHaveCount(0);
});

test('abrir Kai sin # (como la app instalada) deja el inicio en "#/", igual que las demás páginas', async ({ page }) => {
  const k = await openKai(page, '');
  await expect(page).toHaveURL(/\/#\/$/);
  await expect(page.locator('.tv.is-home')).toBeVisible();
  await page.evaluate((h) => { location.hash = h; }, `#/serie/${k.si('Dorohedoro')}`);
  await page.waitForTimeout(200);
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/#\/$/);
  await expect(page.locator('.tv.is-home')).toBeVisible();
  expect(k.errors).toEqual([]);
});

test('la barra flotante se achica al bajar en la casita, se queda así hasta tocarla y la burbuja sube', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone', 'solo en el teléfono');
  const k = await openKai(page, '#/');
  await page.waitForTimeout(600);
  const dock = page.locator('#dock');
  const up = page.locator('#dock .dock-up');
  const scrollY = () => page.evaluate(() => window.scrollY);
  // inicio: bajar la achica; subir (el rebote del final) ya no la agranda; no hay burbuja (la casita sube)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(dock).toHaveClass(/is-compact/);
  await expect(page.locator('#dock .dock-btn')).toHaveCSS('opacity', '0'); // sin tu perfil, solo la casita
  await page.evaluate(() => window.scrollBy(0, -200));
  await page.waitForTimeout(200);
  await expect(dock).toHaveClass(/is-compact/);
  await expect(up).toHaveCSS('opacity', '0');
  await page.locator('#dock .dock-tab[data-tab="home"]').click();
  await expect.poll(scrollY).toBe(0);
  await expect(dock).not.toHaveClass(/is-compact/);
  await expect(page).toHaveURL(/#\/$/);
  // en otra pestaña, achicada también queda la casita: tocarla solo la agranda
  await go(page, '#/ajustes');
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(dock).toHaveClass(/is-compact/);
  // la casita queda al centro de la pantalla (la barra se corre, no se reacomoda)
  await page.waitForTimeout(400);
  const home = await page.locator('#dock .dock-tab[data-tab="home"]').boundingBox();
  const vw = page.viewportSize()?.width || 0;
  expect(Math.abs((home?.x || 0) + (home?.width || 0) / 2 - vw / 2)).toBeLessThan(2);
  await expect(page.locator('#dock .dock-tab[data-tab="ajustes"]')).toHaveCSS('opacity', '0');
  // y lejos del principio, al lado, la burbuja de subir
  await expect(up).toHaveCSS('opacity', '1');
  const y = await scrollY();
  await page.locator('#dock .dock-tab[data-tab="home"]').click();
  await expect(dock).not.toHaveClass(/is-compact/);
  await expect(page).toHaveURL(/#\/ajustes$/);
  expect(await scrollY()).toBe(y);
  await page.waitForTimeout(1300);
  await page.evaluate(() => window.scrollBy(0, -300));
  await page.waitForTimeout(100);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(dock).toHaveClass(/is-compact/);
  await up.click();
  await expect.poll(scrollY).toBe(0);
  await expect(dock).not.toHaveClass(/is-compact/);
  await expect(up).toHaveCSS('opacity', '0');
  expect(k.errors).toEqual([]);
});

test('tema claro: el inicio y una serie se ven con fondo claro y sin errores', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const k = await openKai(page, '#/', { extraLS: { settings: { root: 'Anime', autoplay: true, autoSkip: true, theme: 'light', cat: false } } });
  const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  const light = (c) => (c.match(/\d+/g) || []).slice(0, 3).every((n) => Number(n) > 180);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  expect(light(await bg())).toBe(true);
  await expect(page.locator('.tv-hero .tv-title')).toContainText('Yahari');
  await go(page, '#/serie/' + k.si('Dorohedoro'));
  await expect(page.locator('#app')).toContainText('Dorohedoro');
  expect(light(await bg())).toBe(true);
  expect(k.errors).toEqual([]);
});

test('Studio: su botón al final del inicio, sus videos con quién canta, y no sale en el catálogo', async ({ page }) => {
  const k = await openKai(page, '#/', { extraLS: { 'note.txt1': 'Concierto en el Palacio de Bellas Artes.' } });
  const studio = page.locator('.home-links a', { hasText: 'Studio' });
  await expect(studio).toContainText('Música en vivo');
  await studio.click();
  await expect(page).toHaveURL(new RegExp(`#/serie/${k.si('Studio')}$`));
  await expect(page.locator('.shelf-count')).toHaveText('2 canciones en vivo');
  await expect(page.locator('.studio-tile .tile-title')).toHaveText(['Querida', 'Amor eterno']);
  await expect(page.locator('.studio-tile .tile-sub').first()).toHaveText('Juan Gabriel · Bellas Artes, 1990');
  // reproducir todo: empieza por la primera y la lista del reproductor va en el orden de la página
  await page.locator('[data-act="studio-play"]').click();
  await expect(page.locator('.watch-title')).toHaveText('Querida');
  await expect(page.locator('#watch-list .ep')).toHaveCount(2);
  // aleatorio: suenan todas, en algún orden
  await go(page, '#/serie/' + k.si('Studio'));
  await page.locator('[data-act="studio-shuffle"]').click();
  await expect(page).toHaveURL(/#\/play\//);
  await expect(page.locator('#watch-list .ep')).toHaveCount(2);
  await go(page, '#/serie/' + k.si('Studio'));
  await page.locator('.studio-tile').first().click();
  await expect(page).toHaveURL(/#\/play\//);
  await expect(page.locator('.watch-title')).toHaveText('Querida');
  await expect(page.locator('#watch-info')).toContainText('Juan Gabriel · Bellas Artes, 1990');
  await expect(page.locator('.watch-note')).toHaveText('Concierto en el Palacio de Bellas Artes.');
  await expect(page.locator('.watch-series')).toHaveAttribute('href', `#/serie/${k.si('Studio')}`);
  // a medias no sale en "Continuar viendo"
  await page.evaluate(async () => {
    const { setProgress } = await import('/models/progress.js');
    const { epById } = await import('/models/library.js');
    setProgress(epById(decodeURIComponent(location.hash.split('/').pop())), 60, 240, false);
  });
  await go(page, '#/');
  await expect(page.locator('.tv-main')).toContainText('Continuar viendo');
  await expect(page.locator('.tv-main')).not.toContainText('Querida');
  // ni en el catálogo ni en la fila de Películas
  await go(page, '#/catalogo');
  await expect(page.locator('.catalog')).not.toContainText('Querida');
  await expect(page.locator('.catalog')).not.toContainText('Studio');
  expect(k.errors).toEqual([]);
});

test('Ajustes: tu resumen; y la burbuja de versión nueva se abre con lo que cambió', async ({ page }, info) => {
  const k = await openKai(page, '#/ajustes');
  const stats = page.locator('#profile-stats');
  await expect(stats).toContainText('Tu resumen');
  await expect(stats.locator('.stat')).toHaveCount(3);
  // la burbuja de versión nueva: cabe en el teléfono y al tocarla dice qué cambió
  await page.evaluate(async () => (await import('/controllers/updates.js')).showUpdateNotice());
  const notice = page.locator('#update-notice');
  await expect(notice).toBeVisible();
  const box = await notice.boundingBox();
  expect((box?.x || 0) >= 0 && (box?.x || 0) + (box?.width || 0) <= (page.viewportSize()?.width || 0)).toBe(true);
  expect(box?.height || 0).toBeLessThan(60); // en una sola línea
  await expect(notice.locator('[data-act="apply-update"]')).toHaveCount(0); // para actualizar hay que abrirla
  await notice.locator('[data-act="update-news"]').click();
  await expect(notice).toHaveClass(/is-open/);
  await expect(notice.locator('.update-list').first()).toBeVisible();
  // lo que cambió va por secciones (todo lo de una, junto) y se desliza; el botón queda fuera de lo que se desliza
  const html = await page.evaluate(async () =>
    (await import('/controllers/updates.js')).changesHTML(['Catálogo: uno.', 'Reproductor: dos.', 'Catálogo: tres.', 'Sin sección']),
  );
  expect(html.match(/update-sec-title/g)).toHaveLength(3);
  expect(html).toMatch(/Catálogo<\/h4><ul class="update-list"><li>Uno\.<\/li><li>Tres\.<\/li>/);
  expect(html).toContain('Otros');
  await expect(notice.locator('.update-scroll')).toHaveCSS('overflow-y', 'auto');
  await expect(notice.locator('.update-scroll [data-act="apply-update"]')).toHaveCount(0);
  await expect(notice.locator('[data-act="apply-update"]')).toBeVisible();
  const open = await notice.boundingBox();
  expect((open?.x || 0) >= 0 && (open?.x || 0) + (open?.width || 0) <= (page.viewportSize()?.width || 0)).toBe(true);
  await expect(page.locator('#app-changes')).toHaveCount(0); // en Ajustes no sale
  await expect(notice.locator('.update-x')).toHaveCount(0); // no se puede cerrar: se queda hasta actualizar
  expect(k.errors).toEqual([]);
});

test('pósters: tarjeta al pasar el ratón (PC) y menú al mantener presionado (teléfono)', async ({ page }, info) => {
  const k = await openKai(page, '#/');
  const poster = page.locator(`.home-shelf, .tv-main`).locator(`a.shelf-item[href="#/serie/${k.si('Dorohedoro')}"]`).first();
  await poster.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300); // que termine de desplazarse (desplazarse cancela el mantener presionado)
  const card = page.locator('.poster-card');
  if (info.project.name === 'pc') {
    await poster.hover();
    await expect(card).toBeVisible();
    await expect(card.locator('.pc-title')).toHaveText('Dorohedoro');
    await expect(card.locator('.tv-btn')).toContainText('Episodio 3');
    await page.mouse.move(5, 5);
    await expect(card).toBeHidden();
  } else {
    // mantener presionado: abre el menú rápido y no entra a la serie
    const box = await poster.boundingBox();
    const at = { x: (box?.x || 0) + 30, y: (box?.y || 0) + 30 };
    await poster.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: at.x, clientY: at.y, isPrimary: true });
    await page.waitForTimeout(650);
    await poster.dispatchEvent('pointerup', { pointerType: 'touch', clientX: at.x, clientY: at.y, isPrimary: true });
    await poster.dispatchEvent('click');
    await expect(page.locator('.sheet-title')).toHaveText('Dorohedoro');
    await expect(page.locator('.sheet-panel')).toContainText('Ir a la serie');
    await expect(page).toHaveURL(/#\/$/);
    await page.locator('.sheet-panel [data-act="later"]').click();
    await expect(page.locator('.sheet-panel')).toHaveCount(0, { timeout: 2000 }).catch(() => {});
  }
  // tocar el póster entra a la serie
  await poster.click();
  await expect(page).toHaveURL(new RegExp(`#/serie/${k.si('Dorohedoro')}$`));
  await expect(page.locator('.series-hero .tv-title')).toHaveText('Dorohedoro');
  expect(k.errors).toEqual([]);

  // las películas también: su tarjeta con "Más tarde" (PC) y su menú con "Marcar como vista" (teléfono)
  await page.goto('/#/');
  await expect(page.locator('.tv.is-home')).toBeVisible();
  const movie = page.locator('a.shelf-item[href^="#/pelicula/"]').first();
  await movie.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const laterKeys = () =>
    page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('kai.p.pA.progress') || '{}')).filter(([key, v]) => key.startsWith('@later/Peliculas/') && v.on).length);
  if (info.project.name === 'pc') {
    await movie.hover();
    await expect(card).toBeVisible();
    await expect(card.locator('.pc-title')).toHaveText('Kimi no Na wa');
    await expect(card.locator('.pc-syn')).toContainText('Sinopsis de Your Name.');
    await expect(card.locator('.tv-btn')).toContainText('Ver');
    await card.locator('[data-act="later-item"]').click();
    await expect.poll(laterKeys).toBe(1);
    await expect(card.locator('[data-act="later-item"]')).toHaveAttribute('aria-pressed', 'true');
  } else {
    const box = await movie.boundingBox();
    const at = { x: (box?.x || 0) + 30, y: (box?.y || 0) + 30 };
    await movie.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: at.x, clientY: at.y, isPrimary: true });
    await page.waitForTimeout(650);
    await movie.dispatchEvent('pointerup', { pointerType: 'touch', clientX: at.x, clientY: at.y, isPrimary: true });
    await movie.dispatchEvent('click');
    await expect(page.locator('.sheet-title')).toHaveText('Kimi no Na wa');
    await expect(page.locator('.sheet-panel')).toContainText('Ir a la película');
    await expect(page).toHaveURL(/#\/$/);
    await page.locator('.sheet-panel [data-act="qs-seen"]').click();
    await expect(movie.locator('.shelf-sub')).toContainText('Vista');
  }
  expect(k.errors).toEqual([]);
});

// El estilo Bloques (Laboratorio) en sus cuatro tonos: tiene que verse igual en todas las pantallas, no solo en el inicio.
for (const [theme, tone] of [['dark', 'bosque'], ['dark', 'brasa'], ['light', 'piedra'], ['light', 'papel']]) {
  test(`Bloques ${tone}: las capas flotantes y la portada siguen el estilo, sin pedir nada a internet`, async ({ page }, info) => {
    const { ls } = buildFixture();
    const settings = { ...ls.settings, theme, lab: true, style: 'bloques', blockTone: tone, blockDark: tone };
    const outside = [];
    page.on('request', (r) => {
      if (!/^(http:\/\/127\.0\.0\.1:8123\/|data:|blob:)/.test(r.url())) outside.push(r.url());
    });
    const k = await openKai(page, '#/', { extraLS: { settings } });
    await expect(page.locator('html')).toHaveAttribute('data-style', 'bloques');
    // el tablero de la semana junto a la portada (solo en Bloques)
    await expect(page.locator('.home-top .home-side .side-week')).toBeVisible();
    await expect(page.locator('.home-side .side-bars i')).toHaveCount(7);
    await shot(page, `bloques-${tone}-inicio`, info);
    // el color de superficie de este tono, tal como lo resuelve el navegador
    const surface = await page.evaluate(() => {
      const d = document.createElement('div');
      d.style.background = 'var(--surface)';
      document.body.appendChild(d);
      const c = getComputedStyle(d).backgroundColor;
      d.remove();
      return c;
    });
    await go(page, `#/serie/${k.si('Dorohedoro')}`);
    // sobre la portada (oscura en todos los tonos) los botones secundarios llevan el ícono blanco
    const second = page.locator('.hero-card .tv-btn:not(.is-primary)').first();
    await expect(second).toHaveCSS('color', 'rgb(255, 255, 255)');
    // el menú de un capítulo usa la superficie del tono (antes: carbón en Bosque, blanco puro en Piedra)
    await page.locator('.ep [data-act="more"]').first().click();
    await expect(page.locator('.sheet-panel')).toHaveCSS('background-color', surface);
    await shot(page, `bloques-${tone}-menu`, info);
    await page.locator('.sheet-panel [data-act="close"]').last().click();
    await go(page, '#/ajustes');
    await expect(page.locator('.settings-group').first()).toHaveCSS('background-color', surface);
    // cambiar un tono no vuelve a dibujar Ajustes: el plegable abierto sigue siendo el mismo elemento
    await page.locator('#fold-look > summary').click();
    await page.evaluate(() => (document.querySelector('#fold-look').dataset.mark = '1'));
    await page.locator('[data-act="set-motion"][data-v="reduced"]').click();
    await expect(page.locator('#fold-look')).toHaveAttribute('data-mark', '1');
    await expect(page.locator('[data-act="set-motion"][data-v="reduced"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveClass(/calm/);
    await shot(page, `bloques-${tone}-ajustes`, info);
    // las letras del estilo van dentro de Kai
    expect(await page.evaluate(() => document.fonts.ready.then(() => document.fonts.check("500 20px 'Space Grotesk'")))).toBe(true);
    expect(outside).toEqual([]);
    expect(k.errors).toEqual([]);
  });
}

test('catálogo: filtrar y ordenar por la nota de AniList; Ajustes: elegir un dibujo de avatar', async ({ page }) => {
  const k = await openKai(page, '#/');
  await expect(page.locator('.home-side')).toHaveCount(0); // en Vidrio el inicio no lleva el tablero de la semana
  await go(page, '#/catalogo');
  const titles = () => page.locator('#cat-results .shelf-title').allInnerTexts();
  await page.selectOption('select[name="s"]', '80');
  await expect(page.locator('#cat-count')).toHaveText('4 títulos');
  await expect(page).toHaveURL(/s=80/);
  await page.selectOption('select[name="s"]', '90');
  await expect(page.locator('#cat-count')).toContainText('Nada coincide');
  await page.locator('[data-act="cat-clear"]').click();
  await page.selectOption('select[name="s"]', '80');
  await page.selectOption('select[name="o"]', 'score');
  // la mejor nota primero: Koe no Katachi (88), Kimi no Na wa (85), Dorohedoro (82)
  expect((await titles()).slice(0, 3)).toEqual(['Koe no Katachi', 'Kimi no Na wa', 'Dorohedoro']);

  await go(page, '#/ajustes');
  await page.locator('[data-act="set-avatar"][data-v="gato"]').click();
  await expect(page.locator('[data-act="set-avatar"][data-v="gato"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dock-btn .dock-avatar svg')).toHaveCount(1); // también en la barra
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kai.shared')).profiles.find((p) => p.id === 'pA').avatar)).toBe('gato');
  await page.locator('[data-act="set-avatar"][data-v=""]').click();
  await expect(page.locator('.dock-btn .dock-avatar')).toHaveText('A');
  // subir una imagen: queda chica dentro del perfil (una sola), y elegir otra cosa la borra
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 400;
    const g = c.getContext('2d');
    g.fillStyle = '#c33';
    g.fillRect(0, 0, 600, 400);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#avatar-file').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.locator('[data-act="avatar-upload"]').click();
  await page.locator('#avatar-file').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('.dock-btn .dock-avatar img')).toHaveCount(1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('kai.shared')).profiles.find((p) => p.id === 'pA'));
  expect(saved.img).toMatch(/^data:image\/jpeg;base64,/);
  expect(saved.img.length).toBeLessThan(60000);
  expect(await page.locator('.dock-btn .dock-avatar img').evaluate((i) => i.naturalWidth)).toBe(192);
  await page.locator('[data-act="set-avatar"][data-v="luna"]').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kai.shared')).profiles.find((p) => p.id === 'pA').img)).toBeUndefined();
  expect(k.errors).toEqual([]);
});

test('PC: al pasar de un póster al de al lado, la tarjeta del nuevo sale (antes se cancelaba)', async ({ page }, info) => {
  test.skip(info.project.name !== 'pc', 'la tarjeta es de la computadora');
  const k = await openKai(page, '#/');
  const posters = page.locator('a.shelf-item');
  await posters.nth(0).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const a = await posters.nth(0).boundingBox();
  const b = await posters.nth(1).boundingBox();
  await page.mouse.move(a.x + 40, a.y + 80, { steps: 4 });
  await page.waitForTimeout(150);
  await page.mouse.move(b.x + 40, b.y + 80, { steps: 4 });
  await expect(page.locator('.poster-card')).toBeVisible();
  expect(k.errors).toEqual([]);
});
