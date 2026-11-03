// Subtítulos sueltos y la intro dentro del MP4 (models/subs.js).
import { describe, it, expect } from 'vitest';
import { parseSrtVtt, parseAss, parseSubtitleFile, isSubtitleName, pickIntro } from '../../models/subs.js';

describe('archivos de subtítulos', () => {
  it('reconoce los tipos', () => {
    expect(['a.srt', 'a.vtt', 'a.ass', 'a.ssa', 'a.mp4', null].map(isSubtitleName)).toEqual([true, true, true, true, false, false]);
  });
  it('SRT (con BOM y CRLF; las cursivas se quedan, el reproductor las muestra)', () => {
    const srt = '﻿1\r\n00:00:01,500 --> 00:00:03,000\r\n<i>Hola</i>\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,250\r\nDos\r\nlíneas\r\n';
    expect(parseSrtVtt(srt)).toEqual([[1.5, 3, '<i>Hola</i>'], [60, 62.25, 'Dos\nlíneas']]);
  });
  it('WebVTT sin horas', () => {
    expect(parseSrtVtt('WEBVTT\n\n00:05.000 --> 00:06.000\nCorto\n')).toEqual([[5, 6, 'Corto']]);
  });
  it('ASS: sin estilos y en orden', () => {
    const ass = [
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,{\\i1}Segundo{\\i0}, con coma',
      'Dialogue: 0,0:00:01.50,0:00:02.00,Default,,0,0,0,,Primero\\NLínea',
    ].join('\n');
    expect(parseAss(ass)).toEqual([[1.5, 2, 'Primero\nLínea'], [10, 12, 'Segundo, con coma']]);
  });
  it('elige el lector por la extensión', () => {
    expect(parseSubtitleFile('x.srt', '1\n00:00:01,000 --> 00:00:02,000\nA\n')).toEqual([[1, 2, 'A']]);
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
