import { describe, it, expect } from 'vitest';
import { createNavHistory } from '../../lib/nav-history.js';

const page = (h) => h.split('?')[0];
const isHome = (h) => page(h) === '#/';

describe('historial de navegación', () => {
  it('volver adelante a la página de antes no se confunde con "atrás"', () => {
    const n = createNavHistory('#/');
    n.arrive('#/ajustes', null, false);
    n.arrive('#/descargas', null, false);
    const r = n.arrive('#/ajustes', null, false);
    expect(r).toEqual({ pos: 3, back: false });
    expect(n.stepsBackTo(isHome)).toBe(-3);
  });

  it('atrás y adelante del navegador llegan a entradas marcadas', () => {
    const n = createNavHistory('#/');
    n.arrive('#/serie/1', null, false);
    n.arrive('#/play/a', null, false);
    expect(n.arrive('#/serie/1', 1, false)).toEqual({ pos: 1, back: true });
    expect(n.arrive('#/play/a', 2, false)).toEqual({ pos: 2, back: false });
  });

  it('una página nueva borra lo que estaba adelante', () => {
    const n = createNavHistory('#/');
    n.arrive('#/a', null, false);
    n.arrive('#/b', null, false);
    n.arrive('#/', 0, false);
    n.arrive('#/c', null, false);
    expect(n.pos).toBe(1);
    expect(n.current).toBe('#/c');
    expect(n.stepsBackTo((h) => h === '#/b')).toBe(0);
  });

  it('reemplazar no agrega una entrada', () => {
    const n = createNavHistory('#/');
    n.arrive('#/catalogo', null, false);
    expect(n.arrive('#/catalogo?t=tv', null, true)).toEqual({ pos: 1, back: false });
    expect(n.stepsBackTo(isHome)).toBe(-1);
  });

  it('"volver" salta las entradas de la misma página', () => {
    const n = createNavHistory('#/');
    n.arrive('#/serie/1', null, false);
    n.arrive('#/serie/1?k=1', null, false);
    n.arrive('#/serie/1?k=2', null, false);
    const cur = page(n.current);
    expect(n.stepsBackTo((h) => page(h) !== cur)).toBe(-3);
  });

  it('tras recargar no conoce lo anterior: no salta', () => {
    const n = createNavHistory('#/ajustes', 4);
    expect(n.stepsBackTo(isHome)).toBe(0);
    n.arrive('#/descargas', null, false);
    expect(n.stepsBackTo((h) => h === '#/ajustes')).toBe(-1);
  });
});
