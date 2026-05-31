import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('Autolevel multi-probe integration (N parameter)', () => {
  let Autolevel;
  let al;
  let mockSocket;
  let sentGcode;
  let serialportReadHandler;

  beforeEach(async () => {
    vi.resetModules();

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
    al.gcode = 'G0 X0 Y0\nG1 X10 Y10 Z-0.1';
    sentGcode = [];
    al.sckw.sendGcode = vi.fn((code) => sentGcode.push(code));

    // Capture the serialport:read handler
    serialportReadHandler = mockSocket.on.mock.calls.find(
      call => call[0] === 'serialport:read'
    )[1];
  });

  function createContext(overrides = {}) {
    return {
      mposx: 0, mposy: 0, mposz: 10,
      posx: 0, posy: 0, posz: 10,
      xmin: 0, xmax: 50, ymin: 0, ymax: 50,
      ...overrides
    };
  }

  function simulatePRB(x, y, z) {
    serialportReadHandler(`[PRB:${x},${y},${z}:1]`);
  }

  describe('N parameter parsing', () => {
    it('should default to probesPerPoint=1 when N not specified', () => {
      al.start('#autolevel', createContext());
      expect(al.probesPerPoint).toBe(1);
    });

    it('should parse N parameter correctly', () => {
      al.start('#autolevel N3', createContext());
      expect(al.probesPerPoint).toBe(3);
    });

    it('should clamp N to minimum of 1', () => {
      al.start('#autolevel N0', createContext());
      expect(al.probesPerPoint).toBe(1);
    });

    it('should clamp N to maximum of 10', () => {
      al.start('#autolevel N15', createContext());
      expect(al.probesPerPoint).toBe(10);
    });

    it('should parse N alongside other parameters', () => {
      al.start('#autolevel D5 H3 F100 N4', createContext());
      expect(al.probesPerPoint).toBe(4);
      expect(al.delta).toBe(5);
      expect(al.height).toBe(3);
      expect(al.feed).toBe(100);
    });
  });

  describe('Single-probe mode (N=1, default behavior)', () => {
    it('should accumulate points directly without state machine', () => {
      al.start('#autolevel', createContext());
      expect(al.probesPerPoint).toBe(1);

      // Simulate PRB responses for all planned points
      const totalPoints = al.planedPointCount;
      for (let i = 0; i < totalPoints; i++) {
        simulatePRB(i * 5, 0, -0.1 * i);
      }

      expect(al.probedPoints.length).toBe(totalPoints);
    });

    it('should track min/max/sum stats correctly in single-probe mode', () => {
      al.start('#autolevel', createContext());
      const totalPoints = al.planedPointCount;

      simulatePRB(0, 0, -0.1);
      simulatePRB(5, 0, -0.3);
      simulatePRB(10, 0, -0.05);

      expect(al.min_dz).toBeCloseTo(-0.3, 5);
      expect(al.max_dz).toBeCloseTo(-0.05, 5);
      expect(al.sum_dz).toBeCloseTo(-0.45, 5);
    });
  });

  describe('Multi-probe mode (N > 1)', () => {
    it('should create ProbeStateMachine when N > 1', () => {
      al.start('#autolevel N3', createContext());
      expect(al.probeStateMachine).not.toBeNull();
      expect(al.probeStateMachine.probesPerPoint).toBe(3);
    });

    it('should emit re-probe commands between measurements of same point', () => {
      al.start('#autolevel N3', createContext());
      sentGcode = []; // Clear initial gcode

      // First measurement for point 1 — should trigger re-probe
      simulatePRB(0, 0, -0.1);
      expect(sentGcode.length).toBe(1);
      expect(sentGcode[0]).toContain('G0 Z');
      expect(sentGcode[0]).toContain('G38.2');
    });

    it('should complete a point after N measurements and push averaged result', () => {
      al.start('#autolevel N3', createContext());
      sentGcode = [];

      // 3 measurements for point 1
      simulatePRB(0, 0, -0.10);
      simulatePRB(0, 0, -0.12);
      simulatePRB(0, 0, -0.11);

      // After 3 measurements, point should be complete
      expect(al.probedPoints.length).toBe(1);
      // Average of -0.10, -0.12, -0.11 = -0.11
      expect(al.probedPoints[0].z).toBeCloseTo(-0.11, 5);
    });

    it('should track min/max/sum stats from averaged points', () => {
      al.start('#autolevel N2', createContext());
      sentGcode = [];

      // Point 1: average of -0.1 and -0.2 = -0.15
      simulatePRB(0, 0, -0.1);
      simulatePRB(0, 0, -0.2);

      // Point 2: average of -0.3 and -0.4 = -0.35
      simulatePRB(5, 0, -0.3);
      simulatePRB(5, 0, -0.4);

      expect(al.probedPoints.length).toBe(2);
      expect(al.min_dz).toBeCloseTo(-0.35, 5);
      expect(al.max_dz).toBeCloseTo(-0.15, 5);
      expect(al.sum_dz).toBeCloseTo(-0.50, 5);
    });

    it('should call applyCompensation when all points are complete', () => {
      al.start('#autolevel N2', createContext());
      const totalPoints = al.planedPointCount;
      sentGcode = [];

      // Mock applyCompensation to avoid actual processing
      al.applyCompensation = vi.fn();

      // Complete all points with N=2 measurements each
      for (let i = 0; i < totalPoints; i++) {
        simulatePRB(i * 5, 0, -0.1);
        simulatePRB(i * 5, 0, -0.12);
      }

      expect(al.probedPoints.length).toBe(totalPoints);
      expect(al.applyCompensation).toHaveBeenCalled();
    });

    it('should reset planedPointCount to 0 after all probing is complete', () => {
      al.start('#autolevel N2', createContext());
      const totalPoints = al.planedPointCount;
      al.applyCompensation = vi.fn();

      for (let i = 0; i < totalPoints; i++) {
        simulatePRB(i * 5, 0, -0.1);
        simulatePRB(i * 5, 0, -0.12);
      }

      expect(al.planedPointCount).toBe(0);
    });

    it('should not call applyCompensation when probeOnly is set', () => {
      al.start('#autolevel N2 P1', createContext());
      const totalPoints = al.planedPointCount;
      al.applyCompensation = vi.fn();

      for (let i = 0; i < totalPoints; i++) {
        simulatePRB(i * 5, 0, -0.1);
        simulatePRB(i * 5, 0, -0.12);
      }

      expect(al.applyCompensation).not.toHaveBeenCalled();
    });
  });

  describe('ProbeStateMachine initialization', () => {
    it('should initialize state machine with correct totalPoints', () => {
      al.start('#autolevel N3', createContext());
      expect(al.probeStateMachine.totalPoints).toBe(al.planedPointCount);
    });

    it('should initialize state machine even when N=1', () => {
      al.start('#autolevel', createContext());
      // State machine is created but single-probe path is used
      expect(al.probeStateMachine).not.toBeNull();
      expect(al.probeStateMachine.probesPerPoint).toBe(1);
    });
  });
});
