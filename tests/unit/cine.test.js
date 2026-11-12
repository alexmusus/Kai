import { describe, it, expect } from 'vitest';
import { CINE_KINDS, cineKind, ofCineKind, sagaName } from '../../models/collections.js';

const movies = {
  pollitos: { year: 2000, genres: ['Animación', 'Comedia'], stop: true, saga: 'Pollitos en fuga: Colección' },
  spider: { year: 2026, genres: ['Acción', 'Ciencia ficción'] },
  robot: { year: 2024, genres: ['Animación', 'Ciencia ficción'] },
  piratas: { year: 2003, genres: ['Aventura', 'Fantasía'], saga: 'Piratas del Caribe - Colección' },
  sinFicha: null,
};
const items = Object.entries(movies).map(([id, m]) => ({ id, m }));
const ids = (kind, year = 2026) => ofCineKind(items, cineKind(kind), year).map((x) => x.id);

describe('tipos de Cine', () => {
  it('una película puede estar en varios tipos', () => {
    expect(ids('animacion')).toEqual(['pollitos', 'robot']);
    expect(ids('stop-motion')).toEqual(['pollitos']);
    expect(ids('sagas')).toEqual(['pollitos', 'piratas']);
    expect(ids('clasicos')).toEqual(['pollitos', 'piratas']);
    expect(ids('con-actores')).toEqual(['spider', 'piratas']);
  });
  it('Estrenos: del año pasado para acá', () => {
    expect(ids('estrenos', 2026)).toEqual(['spider']);
    expect(ids('estrenos', 2025)).toEqual(['spider', 'robot']);
  });
  it('Todas incluye las que no tienen ficha; un tipo desconocido es Todas', () => {
    expect(ids('')).toHaveLength(5);
    expect(cineKind('nada')).toBe(CINE_KINDS[0]);
  });
  it('el nombre de la saga, sin "Colección"', () => {
    expect(sagaName('Pollitos en fuga: Colección')).toBe('Pollitos en fuga');
    expect(sagaName('Piratas del Caribe - Colección')).toBe('Piratas del Caribe');
    expect(sagaName('Madagascar Collection')).toBe('Madagascar');
  });
});
