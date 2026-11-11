// El resumen de un perfil (Ajustes → Tu resumen) y el orden de Studio (en orden o aleatorio).
import { describe, it, expect } from 'vitest';
import { weekStats, profileStats, fmtWatched } from '../../models/stats.js';
import { studioQueue, studioSorted, setStudioShuffle } from '../../models/collections.js';

const ep = (path) => ({ path, id: path, name: path });

describe('resumen del perfil', () => {
  const now = new Date(2026, 10, 20).getTime();
  const lastMonth = new Date(2026, 9, 5).getTime();
  const series = [
    { name: 'Dorohedoro', all: [ep('d1'), ep('d2')] },
    { name: 'Frieren', all: [ep('f1'), ep('f2'), ep('f3')] },
    { name: 'Películas', all: [ep('p1')] },
  ];
  const progress = {
    d1: { t: 1440, d: 1440, w: true, u: lastMonth },
    d2: { t: 1440, d: 1440, w: true, u: now - 1000 },
    f1: { t: 1400, d: 1400, w: true, u: now - 2000 },
    f2: { t: 600, d: 1400, w: false, u: now },
    p1: { t: 6000, d: 6000, w: true, u: now - 3000 },
  };
  const st = profileStats(series, (e) => progress[e.path], now);
  it('suma lo terminado y lo que va de lo que está a medias', () => {
    expect(st.eps).toBe(4);
    expect(st.seconds).toBe(1440 + 1440 + 1400 + 600 + 6000);
  });
  it('una serie está terminada si viste todos sus capítulos (las colecciones de películas no cuentan)', () => {
    expect(st.done).toEqual(['Dorohedoro']);
  });
  it('lo más visto del mes cuenta solo lo terminado este mes', () => {
    expect(st.monthTop).toEqual([
      { name: 'Dorohedoro', eps: 1 },
      { name: 'Frieren', eps: 1 },
      { name: 'Películas', eps: 1 },
    ]);
    expect(st.monthSeconds).toBe(1440 + 1400 + 6000);
  });
  it('el tiempo se dice corto', () => {
    expect(fmtWatched(45 * 60)).toBe('45 min');
    expect(fmtWatched(3 * 3600 + 20 * 60)).toBe('3 h 20 min');
    expect(fmtWatched(12 * 3600 + 5 * 60)).toBe('12 h');
    expect(fmtWatched(2 * 3600 + 40 * 60, true)).toBe('3 h');
  });
});

describe('Studio: el orden en que suenan', () => {
  const eps = [ep('Vicente Fernández - Volver.mp4'), ep('Juan Gabriel - Querida.mp4'), ep('Juan Gabriel - Amor eterno.mp4')];
  it('en orden, por quién canta y luego por canción', () => {
    expect(studioSorted(eps).map((e) => e.name)).toEqual(['Juan Gabriel - Amor eterno.mp4', 'Juan Gabriel - Querida.mp4', 'Vicente Fernández - Volver.mp4']);
  });
  it('en aleatorio, en el orden que salió (y vuelve al orden al quitarlo)', () => {
    const order = ['Vicente Fernández - Volver.mp4', 'Juan Gabriel - Amor eterno.mp4', 'Juan Gabriel - Querida.mp4'];
    setStudioShuffle(order);
    expect(studioQueue(eps, 'Juan Gabriel - Querida.mp4').map((e) => e.id)).toEqual(order);
    setStudioShuffle(null);
    expect(studioQueue(eps, 'Juan Gabriel - Querida.mp4')[0].id).toBe('Juan Gabriel - Amor eterno.mp4');
  });
});

describe('lo visto esta semana (inicio, estilo Bloques)', () => {
  const DAY = 86400000;
  const now = new Date(2026, 10, 11, 20, 0, 0).getTime(); // miércoles 11 nov 2026, 8 pm
  const series = [{ name: 'S', all: [ep('a'), ep('b'), ep('c'), ep('d')] }];
  const prog = {
    a: { t: 1400, d: 1400, w: true, u: now - 3600e3 }, // hoy, terminado
    b: { t: 600, d: 1400, w: false, u: now - 2 * DAY }, // anteayer, a medias
    c: { t: 1400, d: 1400, w: true, u: now - 9 * DAY }, // hace más de una semana: no cuenta
    d: { t: 1400, d: 1400, w: true, u: now + DAY }, // fecha imposible: no cuenta
  };
  const w = weekStats(series, (e) => prog[e.path], now);
  it('suma el tiempo y los capítulos terminados de los últimos 7 días', () => {
    expect(w.seconds).toBe(2000);
    expect(w.eps).toBe(1);
  });
  it('lo reparte por día, con hoy al final', () => {
    expect(w.days).toEqual([0, 0, 0, 0, 600, 0, 1400]);
    expect(w.labels).toEqual(['J', 'V', 'S', 'D', 'L', 'M', 'X']);
  });
  it('sin nada visto, todo en cero', () => {
    expect(weekStats(series, () => undefined, now)).toMatchObject({ seconds: 0, eps: 0, days: [0, 0, 0, 0, 0, 0, 0] });
  });
});
