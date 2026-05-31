import { describe, it, expect, beforeEach, vi } from 'vitest';
import GCodeCompensator from '../../gcode-compensator.js';

// Create a simple set of probed points forming a tilted plane
// Points at z=0 except slight tilt: z increases with x
function makeProbedPoints() {
  return [
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0.1 },
    { x: 0, y: 10, z: 0 },
    { x: 10, y: 10, z: 0.1 },
  ];
}

describe('GCodeCompensator', () => {
  let compensator;

  beforeEach(() => {
    compensator = new GCodeCompensator(makeProbedPoints(), 10, null);
  });

  describe('constructor', () => {
    it('should store probedPoints, delta, and arcLinearizer', () => {
      const pts = makeProbedPoints();
      const comp = new GCodeCompensator(pts, 5, null);
      expect(comp.probedPoints).toBe(pts);
      expect(comp.delta).toBe(5);
      expect(comp.arcLinearizer).toBeNull();
    });

    it('should initialize parsing state', () => {
      expect(compensator.abs).toBe(true);
      expect(compensator.units).toBe(1); // MILLIMETERS
      expect(compensator.currentPos).toEqual({ x: 0, y: 0, z: 0 });
    });
  });

  describe('countLines', () => {
    it('should count single line (no newlines)', () => {
      expect(compensator.countLines('G1 X10 Y10')).toBe(1);
    });

    it('should count multiple lines', () => {
      expect(compensator.countLines('line1\nline2\nline3')).toBe(3);
    });

    it('should count empty string as 1 line', () => {
      expect(compensator.countLines('')).toBe(1);
    });

    it('should handle trailing newline', () => {
      expect(compensator.countLines('line1\nline2\n')).toBe(3);
    });
  });

  describe('stripComments', () => {
    it('should remove parenthesized comments', () => {
      expect(compensator.stripComments('G1 X10 (move to 10)')).toBe('G1X10');
    });

    it('should remove semicolon comments', () => {
      expect(compensator.stripComments('G1 X10 ; move to 10')).toBe('G1X10');
    });

    it('should remove whitespace', () => {
      expect(compensator.stripComments('G1 X10 Y20')).toBe('G1X10Y20');
    });

    it('should handle line with only comment', () => {
      expect(compensator.stripComments('(this is a comment)')).toBe('');
    });
  });

  describe('processLine - comment pass-through', () => {
    it('should pass through full-line comments unchanged (trimmed)', () => {
      const result = compensator.processLine('  (this is a comment)  ');
      expect(result).toBe('(this is a comment)');
    });
  });

  describe('processLine - G90/G91 mode tracking', () => {
    it('should track G90 (absolute mode)', () => {
      compensator.abs = false;
      compensator.processLine('G90');
      expect(compensator.abs).toBe(true);
    });

    it('should track G91 (relative mode)', () => {
      compensator.abs = true;
      compensator.processLine('G91');
      expect(compensator.abs).toBe(false);
    });

    it('should track G20 (inches)', () => {
      compensator.processLine('G20');
      expect(compensator.units).toBe(2); // INCHES
    });

    it('should track G21 (millimeters)', () => {
      compensator.units = 2;
      compensator.processLine('G21');
      expect(compensator.units).toBe(1); // MILLIMETERS
    });
  });

  describe('processLine - lines without coordinates pass through', () => {
    it('should pass through G90 without modification', () => {
      expect(compensator.processLine('G90')).toBe('G90');
    });

    it('should pass through G21 without modification', () => {
      expect(compensator.processLine('G21')).toBe('G21');
    });

    it('should pass through M3 S1000 without modification', () => {
      expect(compensator.processLine('M3 S1000')).toBe('M3S1000');
    });

    it('should pass through G38.2 commands without compensation', () => {
      expect(compensator.processLine('G38.2 Z-5 F50')).toBe('G38.2Z-5F50');
    });

    it('should pass through G92 commands without compensation', () => {
      expect(compensator.processLine('G92 X0 Y0 Z0')).toBe('G92X0Y0Z0');
    });
  });

  describe('processLine - simple G1 line compensation', () => {
    it('should compensate Z for a G1 move with coordinates', () => {
      // First move initializes position
      const result = compensator.processLine('G1 X5 Y5 Z0 F100');
      // Should have X, Y, Z coordinates with compensation applied
      expect(result).toMatch(/X[\d.]+/);
      expect(result).toMatch(/Y[\d.]+/);
      expect(result).toMatch(/Z[\d.]+/);
    });

    it('should apply Z compensation based on probed surface', () => {
      // At x=5, the tilted plane has z ≈ 0.05 (linear interpolation)
      const result = compensator.processLine('G1 X5 Y0 Z0 F100');
      // Z should be compensated (non-zero due to surface tilt)
      const zMatch = /Z([\.\+\-\d]+)/.exec(result);
      expect(zMatch).not.toBeNull();
      const zVal = parseFloat(zMatch[1]);
      // The compensation should add the surface height to the commanded Z
      expect(zVal).toBeCloseTo(0.05, 2);
    });

    it('should split long segments and compensate each', () => {
      // First initialize position
      compensator.processLine('G1 X0 Y0 Z0 F100');
      // Now move a long distance (> delta/2 = 5mm)
      const result = compensator.processLine('G1 X10 Y0 Z0 F100');
      // Should produce multiple lines (split into segments)
      const lines = result.split('\n');
      expect(lines.length).toBeGreaterThan(1);
    });
  });

  describe('processLine - relative mode', () => {
    it('should pass through lines in relative mode without compensation', () => {
      compensator.processLine('G91');
      const result = compensator.processLine('G1 X5 Y5 Z-0.1');
      expect(result).toBe('G1X5Y5Z-0.1');
    });
  });

  describe('process - progress callback', () => {
    it('should call progressCallback every 5000 lines', () => {
      // Create a gcode string with 10001 lines
      const lines = [];
      for (let i = 0; i < 10001; i++) {
        lines.push('G1 X1 Y1 Z0');
      }
      const gcode = lines.join('\n');

      const callback = vi.fn();
      compensator.process(gcode, callback);

      // Should be called at line 5000 and 10000
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith(5000, 10001);
      expect(callback).toHaveBeenCalledWith(10000, 10001);
    });

    it('should not call progressCallback for small files', () => {
      const gcode = 'G1 X1 Y1 Z0\nG1 X2 Y2 Z0';
      const callback = vi.fn();
      compensator.process(gcode, callback);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should work without progressCallback (null)', () => {
      const gcode = 'G1 X1 Y1 Z0\nG1 X2 Y2 Z0';
      // Should not throw
      expect(() => compensator.process(gcode, null)).not.toThrow();
    });
  });

  describe('process - full integration', () => {
    it('should process multi-line gcode and return compensated result', () => {
      const gcode = 'G90\nG21\nG1 X5 Y5 Z0 F100\nG1 X10 Y10 Z0 F100';
      const result = compensator.process(gcode, null);

      // Should contain multiple lines
      const lines = result.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(4);

      // First two lines should pass through (no coordinates)
      expect(lines[0]).toBe('G90');
      expect(lines[1]).toBe('G21');
    });

    it('should reset state between process calls', () => {
      const gcode = 'G91\nG1 X5 Y5 Z0';
      compensator.process(gcode, null);

      // After processing, state was G91 (relative)
      // A new process call should reset to G90 (absolute)
      const gcode2 = 'G1 X5 Y5 Z0 F100';
      const result = compensator.process(gcode2, null);
      // Should be compensated (absolute mode after reset)
      expect(result).toMatch(/Z[\d.]+/);
      expect(result).not.toBe('G1X5Y5Z0F100');
    });
  });
});
