// @ts-check
/*
 * views/images.js — que las imágenes ya vistas no parpadeen al volver a dibujar una página.
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
new MutationObserver((list) => {
  for (const m of list)
    for (const n of /** @type {any} */ (m.addedNodes)) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'IMG') settleImages(n.parentNode || n);
      else settleImages(n);
    }
}).observe(document.body, { childList: true, subtree: true });
