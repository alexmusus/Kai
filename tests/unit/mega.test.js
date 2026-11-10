// Avisos, cuota y lectura de archivos de MEGA (lib/events.js, models/quota.js, models/mega.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { on, emit } from '../../lib/events.js';
import { countBytes, noteQuota, quotaUntil, xferUsed, refreshAccountInfo, proQuota } from '../../models/quota.js';
import { state } from '../../models/store.js';
import { quotaText } from '../../views/quota.js';
import { readJson, megaMessage, filesNamed, goneNodes } from '../../models/mega.js';

beforeEach(() => {
  localStorage.clear();
  goneNodes.clear();
  vi.useRealTimers();
});

describe('avisos', () => {
  it('llegan en orden y se pueden dejar de escuchar', () => {
    const got = [];
    const off = on('x', (p) => got.push('a' + p));
    on('x', (p) => got.push('b' + p));
    emit('x', 1);
    off();
    emit('x', 2);
    expect(got).toEqual(['a1', 'b1', 'b2']);
  });
  it('si un oyente falla, los demás igual se enteran', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const got = [];
    on('y', () => { throw new Error('falla'); });
    on('y', () => got.push(1));
    emit('y');
    expect(got).toEqual([1]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('cuota', () => {
  it('suma lo bajado por minuto y olvida lo de hace más de 6 horas', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T10:00:10Z'));
    const seen = [];
    const off = on('quota', () => seen.push(1));
    countBytes(100);
    countBytes(50);
    expect(xferUsed()).toBe(150);
    expect(JSON.parse(localStorage.getItem('kai.xfer'))).toHaveLength(1); // el mismo minuto
    vi.setSystemTime(new Date('2026-11-01T16:00:20Z'));
    expect(xferUsed()).toBe(0);
    expect(seen).toHaveLength(2);
    off();
  });
  it('el límite dura lo que dijo MEGA', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    noteQuota(600);
    expect(quotaUntil()).toBe(1_000_000 + 600_000);
    vi.setSystemTime(1_000_000 + 600_001);
    expect(quotaUntil()).toBe(0);
    noteQuota(0); // sin segundos no se anota nada
    expect(quotaUntil()).toBe(0);
  });
  it('cuenta Pro: lo usado es lo bajado más lo que se bajó de tus enlaces, y dice cuándo se revisó', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    const request = vi.fn(async () => ({ utype: 1, mxfer: 4e12, caxfer: 1e9, csxfer: 5e8 }));
    const before = state.storage;
    state.storage = /** @type {any} */ ({ api: { request } });
    await refreshAccountInfo(true);
    expect(proQuota()).toEqual({ used: 1.5e9, total: 4e12, at: 5_000_000 });
    expect(quotaText(true)).toContain('Al día.');
    vi.setSystemTime(5_000_000 + 12 * 60000);
    expect(quotaText(true)).toContain('Revisado hace 12 min.');
    expect(quotaText()).not.toContain('Revisado');
    state.storage = before;
  });
  it('el mensaje del límite dice cuánto falta', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    expect(megaMessage({ code: 'QUOTA', timeLeft: 3900 })).toBe('Llegaste al límite de transferencia gratuita de MEGA. Se renueva en 1 h 5 min.');
    expect(megaMessage(new Error('ESID'))).toBe('Tu sesión de MEGA venció. Vuelve a entrar.');
    expect(megaMessage(new Error('EMFAREQUIRED'))).toBe('MFA');
  });
});

describe('leer un JSON de MEGA', () => {
  const node = { nodeId: 'n1', name: '.kai-compartido.json', key: Array(32).fill(1), size: 10 };
  const noWait = () => Promise.resolve();

  it('lee y entiende el JSON', async () => {
    expect(await readJson(node, { read: async () => '{"a":1}', wait: noWait, online: () => true })).toEqual({ a: 1 });
  });
  it('dañado: null (se puede reemplazar)', async () => {
    expect(await readJson(node, { read: async () => '{roto', wait: noWait, online: () => true })).toBe(null);
  });
  it('un fallo pasajero se reintenta', async () => {
    let n = 0;
    const read = async () => { if (n++ < 2) throw new Error('red'); return '{"ok":true}'; };
    expect(await readJson(node, { read, wait: noWait, online: () => true })).toEqual({ ok: true });
    expect(n).toBe(3);
  });
  it('si no se puede leer, FALLA: nunca se trata como vacío', async () => {
    let n = 0;
    const read = async () => { n++; throw new Error('red'); };
    await expect(readJson(node, { read, wait: noWait, online: () => true })).rejects.toThrow('No se pudo leer .kai-compartido.json');
    expect(n).toBe(3);
  });
  it('sin cuota no se reintenta (no gastar más)', async () => {
    let n = 0;
    const read = async () => { n++; throw Object.assign(new Error('cuota'), { code: 'QUOTA' }); };
    await expect(readJson(node, { read, wait: noWait, online: () => true })).rejects.toThrow();
    expect(n).toBe(1);
  });
});

describe('archivos por nombre', () => {
  it('encuentra las copias repetidas y no ve lo borrado', () => {
    const folder = { children: [
      { name: '.kai-compartido.json', nodeId: 'a' },
      { name: '.kai-compartido.json', nodeId: 'b' },
      { name: '.kai-compartido.json', nodeId: 'c', directory: true },
      { name: 'otro.json', nodeId: 'd' },
    ] };
    goneNodes.add('b');
    expect(filesNamed(folder, '.kai-compartido.json').map((n) => n.nodeId)).toEqual(['a']);
  });
});
