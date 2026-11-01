// Formato de los videos (models/media.js): si este navegador lo puede reproducir y qué hacer si no.
import { describe, it, expect, beforeAll } from 'vitest';
import { formatProblem, formatSummary, rangeReader, rememberCodec, knownCodec } from '../../models/media.js';

// un navegador de mentira que reproduce H.264 de 8 bits y AV1, pero no Hi10P, HEVC ni AC-3
const SUPPORTED = [/avc1\.640028/, /av01/, /mp4a/];
beforeAll(() => {
  const make = document.createElement;
  document.createElement = (tag) => (tag === 'video' ? { canPlayType: (t) => (SUPPORTED.some((r) => r.test(t)) ? 'probably' : '') } : make(tag));
});

describe('¿se puede reproducir?', () => {
  it('H.264 normal y AV1: sí', () => {
    expect(formatProblem({ video: { codec: 'avc1', profile: 100, bits: 8 }, audio: { codec: 'mp4a' } })).toBe(null);
    expect(formatProblem({ video: { codec: 'av01', bits: 8 } })).toBe(null);
  });
  it('H.264 de 10 bits: no, y dice cuál conviene', () => {
    const p = formatProblem({ video: { codec: 'avc1', profile: 110, bits: 10 } });
    expect(p.what).toBe('H.264 de 10 bits (Hi10P)');
    expect(p.fix).toMatch(/8 bits/);
  });
  it('HEVC y audio AC-3 que este navegador no tiene', () => {
    expect(formatProblem({ video: { codec: 'hvc1', bits: 10 } }).what).toBe('HEVC (H.265) de 10 bits');
    expect(formatProblem({ video: { codec: 'av01', bits: 8 }, audio: { codec: 'ac-3' } }).what).toBe('audio Dolby (AC-3)');
  });
  it('DTS nunca', () => {
    expect(formatProblem({ video: { codec: 'av01', bits: 8 }, audio: { codec: 'dtsc' } }).what).toBe('audio DTS');
  });
  it('sin video no hay nada que decir', () => {
    expect(formatProblem(null)).toBe(null);
    expect(formatSummary(null)).toBe('formato no leído');
    expect(formatSummary({ video: { codec: 'avc1', profile: 100, bits: 8 }, audio: { codec: 'mp4a' } })).toBe('video avc1 perfil 100, 8 bits; audio mp4a');
  });
});

describe('códec guardado y lectura por rangos', () => {
  it('se recuerda por id y tamaño (si el archivo cambia, se vuelve a leer)', () => {
    const ep = { id: 'x', size: 10 };
    rememberCodec(ep, { video: { codec: 'av01' }, audio: null, extra: 1 });
    expect(knownCodec(ep)).toEqual({ video: { codec: 'av01' }, audio: null });
    expect(knownCodec({ id: 'x', size: 11 })).toBeUndefined();
  });
  it('del archivo descargado, sin ir a MEGA', async () => {
    const read = await rangeReader({ id: 'y' }, new Blob([new Uint8Array([1, 2, 3, 4, 5])]));
    expect([...(await read(1, 3))]).toEqual([2, 3, 4]);
  });
});
