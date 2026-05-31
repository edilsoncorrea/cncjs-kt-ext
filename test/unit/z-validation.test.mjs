import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

// We need to mock fs before loading autolevel
vi.mock('fs', () => ({
  readFile: vi.fn((path, encoding, cb) => cb(new Error('no file'))),
  openSync: vi.fn(() => 1),
  writeSync: vi.fn(),
  closeSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const require = createRequire(import.meta.url);
const Autolevel = require('../../autolevel.js');

function createMockSocket() {
  const handlers = {};
  return {
    on: vi.fn((event, handler) => {
      handlers[event] = handler;
    }),
    emit: vi.fn(),
    _handlers: handlers,
  };
}

function createAutolevel() {
  const socket = createMockSocket();
  const options = { port: '/dev/ttyACM0' };
  const al = new Autolevel(socket, options);
  return { al, socket };
}

describe('Z position validation in start()', () => {
  let al, socket, sentMessages;

  beforeEach(() => {
    const result = createAutolevel();
    al = result.al;
    socket = result.socket;
    sentMessages = [];
    // Capture messages sent via sendGcode
    al.sckw.sendGcode = vi.fn((msg) => sentMessages.push(msg));
    al.sckw.loadGcode = vi.fn();
    // Load some gcode so it doesn't abort early
    al.gcode = 'G0 X0 Y0';
    al.gcodeFileName = 'test.gcode';
  });

  it('should abort when context is undefined', () => {
    al.start('#autolevel', undefined);

    expect(sentMessages).toContain('(AL: ERROR - Cannot verify Z position, aborting)');
  });

  it('should abort when context is null', () => {
    al.start('#autolevel', null);

    expect(sentMessages).toContain('(AL: ERROR - Cannot verify Z position, aborting)');
  });

  it('should abort when context.posz is undefined', () => {
    const context = { mposx: 0, mposy: 0, mposz: 10, posx: 0, posy: 0 };
    al.start('#autolevel', context);

    expect(sentMessages).toContain('(AL: ERROR - Cannot verify Z position, aborting)');
  });

  it('should abort when Z position is below travel height', () => {
    const context = {
      mposx: 0, mposy: 0, mposz: 1,
      posx: 0, posy: 0, posz: 1,
      xmin: 0, xmax: 50, ymin: 0, ymax: 50,
    };
    // Default height is 2, posz is 1 which is below
    al.start('#autolevel', context);

    expect(sentMessages.some(msg => msg.includes('Current Z position (1.000) is below travel height (2.000)'))).toBe(true);
  });

  it('should abort with custom H parameter when Z is below', () => {
    const context = {
      mposx: 0, mposy: 0, mposz: 4,
      posx: 0, posy: 0, posz: 4,
      xmin: 0, xmax: 50, ymin: 0, ymax: 50,
    };
    // H5 means travel height is 5, posz is 4 which is below
    al.start('#autolevel H5', context);

    expect(sentMessages.some(msg => msg.includes('Current Z position (4.000) is below travel height (5.000)'))).toBe(true);
  });

  it('should proceed when Z position equals travel height', () => {
    const context = {
      mposx: 0, mposy: 0, mposz: 2,
      posx: 0, posy: 0, posz: 2,
      xmin: 0, xmax: 50, ymin: 0, ymax: 50,
    };
    al.start('#autolevel', context);

    // Should NOT contain the error message
    expect(sentMessages.some(msg => msg.includes('ERROR'))).toBe(false);
    // Should contain the probing started message and proceed
    expect(sentMessages.some(msg => msg.includes('auto-leveling started'))).toBe(true);
  });

  it('should proceed when Z position is above travel height', () => {
    const context = {
      mposx: 0, mposy: 0, mposz: 10,
      posx: 0, posy: 0, posz: 10,
      xmin: 0, xmax: 50, ymin: 0, ymax: 50,
    };
    al.start('#autolevel', context);

    // Should NOT contain the error message
    expect(sentMessages.some(msg => msg.includes('ERROR'))).toBe(false);
    // Should contain the probing started message
    expect(sentMessages.some(msg => msg.includes('auto-leveling started'))).toBe(true);
  });

  it('should ensure first movement command is G0 Z{height} before any XY', () => {
    const context = {
      mposx: 0, mposy: 0, mposz: 5,
      posx: 0, posy: 0, posz: 5,
      xmin: 0, xmax: 50, ymin: 0, ymax: 50,
    };
    al.start('#autolevel', context);

    // The sendGcode call with the probing code should have G0 Z2 before any XY movement
    const codeBlock = sentMessages.find(msg => msg.includes('G0 X'));
    expect(codeBlock).toBeDefined();

    if (codeBlock) {
      const lines = codeBlock.split('\n');
      // Find first line with only Z movement (no X or Y)
      const firstZOnlyMove = lines.findIndex(l => /G0\s+Z\d/.test(l) && !/X/.test(l) && !/Y/.test(l));
      // Find first line with X or Y movement
      const firstXYMove = lines.findIndex(l => /[XY]/.test(l) && !/^\(/.test(l.trim()));
      // Z-only move should come before any XY move
      expect(firstZOnlyMove).toBeGreaterThanOrEqual(0);
      expect(firstZOnlyMove).toBeLessThan(firstXYMove);
    }
  });
});
