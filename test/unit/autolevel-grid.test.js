import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs', () => ({
  default: {
    readFile: vi.fn((path, encoding, cb) => cb(new Error('no file'))),
    openSync: vi.fn(() => 1),
    writeSync: vi.fn(),
    closeSync: vi.fn(),
    writeFileSync: vi.fn()
  },
  readFile: vi.fn((path, encoding, cb) => cb(new Error('no file'))),
  openSync: vi.fn(() => 1),
  writeSync: vi.fn(),
  closeSync: vi.fn(),
  writeFileSync: vi.fn()
}));

vi.mock('../../socketwrap', () => ({
  default: class MockSocketWrap {
    constructor() {
      this.sendGcode = vi.fn();
      this.loadGcode = vi.fn();
    }
  }
}));

describe('Autolevel start() - Division by zero guard', () => {
  let Autolevel;
  let al;
  let mockSocket;
  let sentGcode;

  beforeEach(async () => {
    vi.resetModules();
    
    // Re-mock after reset
    vi.doMock('fs', () => ({
      default: {
        readFile: vi.fn((path, encoding, cb) => cb(new Error('no file'))),
        openSync: vi.fn(() => 1),
        writeSync: vi.fn(),
        closeSync: vi.fn(),
        writeFileSync: vi.fn()
      },
      readFile: vi.fn((path, encoding, cb) => cb(new Error('no file'))),
      openSync: vi.fn(() => 1),
      writeSync: vi.fn(),
      closeSync: vi.fn(),
      writeFileSync: vi.fn()
    }));

    vi.doMock('../../socketwrap', () => ({
      default: class MockSocketWrap {
        constructor() {
          this.sendGcode = vi.fn();
          this.loadGcode = vi.fn();
        }
      }
    }));

    const mod = await import('../../autolevel.js');
    Autolevel = mod.default;

    mockSocket = {
      on: vi.fn(),
      emit: vi.fn()
    };
    al = new Autolevel(mockSocket, { port: 'COM3' });
    al.gcode = 'G0 X0 Y0\nG1 X10 Y10 Z-0.1'; // Set gcode so start() doesn't return early
    sentGcode = [];
    al.sckw.sendGcode = vi.fn((code) => sentGcode.push(code));
  });

  function createContext(overrides = {}) {
    return {
      mposx: 0, mposy: 0, mposz: 10,
      posx: 0, posy: 0, posz: 10,
      xmin: 0, xmax: 100, ymin: 0, ymax: 100,
      ...overrides
    };
  }

  it('should handle normal case where area > delta', () => {
    const context = createContext({ xmin: 0, xmax: 50, ymin: 0, ymax: 50 });
    al.delta = 10;
    al.start('#autolevel', context);

    const allCode = sentGcode.join('\n');
    expect(allCode).not.toContain('error');
    expect(al.planedPointCount).toBeGreaterThan(0);
  });

  it('should use single midpoint when X range < delta', () => {
    const context = createContext({ xmin: 0, xmax: 5, ymin: 0, ymax: 50 });
    al.delta = 10;
    al.start('#autolevel', context);

    const allCode = sentGcode.join('\n');
    expect(allCode).not.toContain('error');
    expect(allCode).not.toContain('NaN');
    expect(allCode).not.toContain('Infinity');
    const coordMatches = [...allCode.matchAll(/X([\.\+\-\d]+)/g)];
    for (const match of coordMatches) {
      expect(Number.isFinite(parseFloat(match[1]))).toBe(true);
    }
  });

  it('should use single midpoint when Y range < delta', () => {
    const context = createContext({ xmin: 0, xmax: 50, ymin: 10, ymax: 13 });
    al.delta = 10;
    al.start('#autolevel', context);

    const allCode = sentGcode.join('\n');
    expect(allCode).not.toContain('error');
    expect(allCode).not.toContain('NaN');
    expect(allCode).not.toContain('Infinity');
    const coordMatches = [...allCode.matchAll(/Y([\.\+\-\d]+)/g)];
    for (const match of coordMatches) {
      expect(Number.isFinite(parseFloat(match[1]))).toBe(true);
    }
  });

  it('should use single midpoint when both X and Y range < delta', () => {
    const context = createContext({ xmin: 5, xmax: 8, ymin: 10, ymax: 12 });
    al.delta = 10;
    al.start('#autolevel', context);

    const allCode = sentGcode.join('\n');
    expect(allCode).not.toContain('error');
    expect(allCode).not.toContain('NaN');
    expect(allCode).not.toContain('Infinity');
    expect(al.planedPointCount).toBeGreaterThanOrEqual(1);
  });

  it('should use single midpoint when X range equals delta exactly', () => {
    const context = createContext({ xmin: 0, xmax: 10, ymin: 0, ymax: 50 });
    al.delta = 10;
    al.start('#autolevel', context);

    const allCode = sentGcode.join('\n');
    expect(allCode).not.toContain('error');
    expect(allCode).not.toContain('NaN');
  });

  it('should reject operation when delta is zero (causes NaN/Infinity)', () => {
    const context = createContext({ xmin: 0, xmax: 50, ymin: 0, ymax: 50 });
    al.delta = 0;
    al.start('#autolevel', context);

    const allCode = sentGcode.join('\n');
    // Should contain error message about invalid value (case-insensitive check)
    expect(allCode.toLowerCase()).toContain('error');
  });

  it('should generate only finite coordinates for all probe points', () => {
    const context = createContext({ xmin: 10, xmax: 10.5, ymin: 20, ymax: 20.3 });
    al.delta = 10;
    al.start('#autolevel', context);

    const allCode = sentGcode.join('\n');
    expect(allCode).not.toContain('NaN');
    expect(allCode).not.toContain('Infinity');

    const xMatches = [...allCode.matchAll(/X([\.\+\-\d]+)/g)];
    for (const match of xMatches) {
      expect(Number.isFinite(parseFloat(match[1]))).toBe(true);
    }
    const yMatches = [...allCode.matchAll(/Y([\.\+\-\d]+)/g)];
    for (const match of yMatches) {
      expect(Number.isFinite(parseFloat(match[1]))).toBe(true);
    }
  });

  it('should handle margin reducing range below delta', () => {
    const context = createContext({ xmin: 0, xmax: 12, ymin: 0, ymax: 50 });
    al.delta = 10;
    al.start('#autolevel', context);

    const allCode = sentGcode.join('\n');
    expect(allCode).not.toContain('NaN');
    expect(allCode).not.toContain('Infinity');
    expect(allCode).not.toContain('error');
  });
});
