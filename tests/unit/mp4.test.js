// Lo que Kai lee de adentro del MP4 (models/mp4.js) y los subtítulos sueltos en Explorar MEGA (models/naming.js).
import { describe, it, expect } from 'vitest';
import { pickIntro } from '../../models/mp4.js';
import { isSubtitleName } from '../../models/naming.js';

describe('archivos de subtítulos', () => {
  it('reconoce los tipos', () => {
    expect(['a.srt', 'a.vtt', 'a.ass', 'a.ssa', 'a.mp4', null].map(isSubtitleName)).toEqual([true, true, true, true, false, false]);
  });
});

describe('la intro dentro del MP4', () => {
  const ch = (title, start, end) => ({ title, start, end });
  it('el Opening que dura lo que un opening, aunque antes haya un "Intro" corto', () => {
    const list = [ch('Intro', 0, 20), ch('Opening', 20, 110), ch('Parte A', 110, 700)];
    expect(pickIntro(list).title).toBe('Opening');
  });
  it('"Intro" de 1:30 sirve si no hay Opening', () => {
    expect(pickIntro([ch('Intro', 30, 120), ch('Parte A', 120, 600)]).start).toBe(30);
  });
  it('sin capítulo de intro, o un "Intro" que no dura lo que un opening: nada', () => {
    expect(pickIntro([ch('Parte A', 0, 600)])).toBe(null);
    expect(pickIntro([ch('Intro', 0, 600)])).toBe(null);
    expect(pickIntro(null)).toBe(null);
  });
  it('un "OP" largo (pegado a otra parte) se usa igual, porque se llama así', () => {
    expect(pickIntro([ch('OP', 0, 400)]).title).toBe('OP');
  });
});
