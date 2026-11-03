// @ts-check
/*
 * views/images.js — que las imágenes ya vistas no parpadeen al volver a dibujar una página, y el fondo difuminado
 * de la página de una serie.
 */

/* Las imágenes aparecen con un fundido solo la primera vez que se cargan. Al redibujar una página (o volver a
 * ella) las que ya estaban cargadas se muestran de una vez: si no, todas parpadeaban en cada cambio. */
/** @type {Set<string>} */
const seenImgs = new Set();
/** @param {any} root */
function settleImages(root) {
  for (const img of root.querySelectorAll ? root.querySelectorAll('img') : []) {
    if (seenImgs.has(img.src) || (img.complete && img.naturalWidth)) {
      // ya cargada: sin fundido y dibujada en el mismo instante (sin el cuadro vacío de la carga diferida)
      img.classList.add('no-fade');
      img.decoding = 'sync';
      img.loading = 'eager';
      seenImgs.add(img.src);
    } else img.addEventListener('load', () => seenImgs.add(img.src), { once: true });
  }
}
/* ── fondo difuminado de la serie ──
 * Antes era la portada (unos 460 px) estirada a pantalla completa con un desenfoque de 70 px: de lo más caro de
 * pintar en el teléfono, y el desenfoque se recalculaba al deslizar por encima. Como el resultado es una mancha
 * de color, basta con la portada reducida a unos pocos píxeles: se achica una vez, se agranda suavizada en un
 * lienzo pequeño y el navegador la estira. Se ve igual de difuminada y no hay ningún filtro de desenfoque. */
const WASH_W = 5; // ancho de la versión diminuta: con 5 se ve como el desenfoque de 70 px de antes
const WASH_OUT = 16; // cuánto se agranda dentro del lienzo, suavizando (estirar 8 px directo deja rombos)
/** @type {Map<string, HTMLCanvasElement>} portada → fondo ya hecho, para no rehacerlo ni volver a fundirlo */
const washes = new Map();

/** @param {CanvasImageSource} src @param {number} w @param {number} h */
function scaled(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, w, h);
  return c;
}
/** @param {HTMLImageElement} img */
function makeWash(img) {
  const h = Math.max(1, Math.round((WASH_W * img.naturalHeight) / img.naturalWidth));
  // se achica en pasos (de golpe, el navegador toma píxeles sueltos en vez de promediar) y se agranda en pasos
  const small = scaled(scaled(img, WASH_W * 8, h * 8), WASH_W, h);
  return scaled(scaled(small, WASH_W * 4, h * 4), WASH_W * WASH_OUT, h * WASH_OUT);
}
/** Copia de un fondo ya hecho (un mismo lienzo no puede estar en dos páginas). @param {HTMLCanvasElement} c */
const copyWash = (c) => scaled(c, c.width, c.height);

/** @param {HTMLElement} box */
function fillWash(box) {
  const src = box.dataset.wash || '';
  if (!src || box.firstElementChild) return;
  const ready = washes.get(src);
  if (ready) {
    const c = copyWash(ready);
    c.classList.add('no-fade');
    box.prepend(c);
    return;
  }
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    if (!img.naturalWidth) return;
    const c = makeWash(img);
    washes.set(src, c);
    if (!box.firstElementChild) box.prepend(copyWash(c));
  };
  img.src = src;
}
/** @param {any} root */
function settleWashes(root) {
  if (root.matches && root.matches('.series-wash[data-wash]')) fillWash(root);
  for (const el of root.querySelectorAll ? root.querySelectorAll('.series-wash[data-wash]') : []) fillWash(el);
}

new MutationObserver((list) => {
  for (const m of list)
    for (const n of /** @type {any} */ (m.addedNodes)) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'IMG') settleImages(n.parentNode || n);
      else {
        settleImages(n);
        settleWashes(n);
      }
    }
}).observe(document.body, { childList: true, subtree: true });
