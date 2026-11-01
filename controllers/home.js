/*
 * La portada estilo TV: el mosaico bajo el ratón o con el foco pasa al destacado, y las flechas del teclado
 * se mueven entre mosaicos como un control remoto.
 */
import { route } from '../lib/route.js';
import { app } from '../views/components.js';
import { setHero } from '../views/home.js';

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
let heroTimer;

function onHover(e) {
  const t = e.target.closest('.tile');
  if (!t || e.pointerType !== 'mouse' || route().view !== 'home') return;
  clearTimeout(heroTimer);
  heroTimer = setTimeout(() => setHero(Number(t.dataset.si)), 140);
}

function onFocus(e) {
  const t = e.target.closest('.tile');
  if (!t || route().view !== 'home') return;
  clearTimeout(heroTimer);
  setHero(Number(t.dataset.si));
}

/** El mosaico o botón más cercano en esa dirección: cuenta más lo que se desvía que lo que avanza. */
function nearest(from, dir) {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of app.querySelectorAll('.tile, .tv-hero .tv-btn')) {
    if (el === from || !el.offsetParent) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax;
    const dy = b.top + b.height / 2 - ay;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 4) continue;
    const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function onArrow(e) {
  const t = e.target.closest('.tile');
  const dir = ARROWS[e.key];
  if (!t || !dir) return;
  const best = nearest(t, dir);
  if (!best) return;
  e.preventDefault();
  best.focus();
  best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

export function initHomeNav() {
  app.addEventListener('pointerover', onHover);
  app.addEventListener('focusin', onFocus);
  app.addEventListener('keydown', onArrow);
}
