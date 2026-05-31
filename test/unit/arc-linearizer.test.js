import { describe, it, expect, beforeEach } from 'vitest';
import ArcLinearizer from '../../arc-linearizer.js';

describe('ArcLinearizer', () => {
  let linearizer;

  beforeEach(() => {
    linearizer = new ArcLinearizer(1.0); // maxSegmentLength = 1mm
  });

  describe('constructor', () => {
    it('should store maxSegmentLength', () => {
      const lin = new ArcLinearizer(2.5);
      expect(lin.maxSegmentLength).toBe(2.5);
    });
  });

  describe('calculateCenterIJ', () => {
    it('should return center = start + offset', () => {
      const start = { x: 10, y: 20 };
      const center = linearizer.calculateCenterIJ(start, 5, -3);
      expect(center.x).toBe(15);
      expect(center.y).toBe(17);
    });

    it('should handle zero offsets', () => {
      const start = { x: 5, y: 5 };
      const center = linearizer.calculateCenterIJ(start, 0, 0);
      expect(center.x).toBe(5);
      expect(center.y).toBe(5);
    });

    it('should handle negative start coordinates', () => {
      const start = { x: -10, y: -20 };
      const center = linearizer.calculateCenterIJ(start, 3, 7);
      expect(center.x).toBe(-7);
      expect(center.y).toBe(-13);
    });
  });

  describe('calculateCenterR', () => {
    it('should calculate center for a simple quarter circle (R > 0, CW)', () => {
      // Quarter circle from (10, 0) to (0, 10) with radius 10, CW
      const start = { x: 10, y: 0 };
      const end = { x: 0, y: 10 };
      const center = linearizer.calculateCenterR(start, end, 10, true);
      // Center should be at (0, 0) for this arc
      expect(center.x).toBeCloseTo(0, 2);
      expect(center.y).toBeCloseTo(0, 2);
    });

    it('should calculate center for R > 0 (short arc), CCW', () => {
      // Quarter circle from (10, 0) to (0, 10) with radius 10, CCW
      const start = { x: 10, y: 0 };
      const end = { x: 0, y: 10 };
      const center = linearizer.calculateCenterR(start, end, 10, false);
      // For CCW with R>0, center should be at (10, 10)
      expect(center.x).toBeCloseTo(10, 2);
      expect(center.y).toBeCloseTo(10, 2);
    });

    it('should calculate center for R < 0 (long arc)', () => {
      const start = { x: 10, y: 0 };
      const end = { x: 0, y: 10 };
      const center = linearizer.calculateCenterR(start, end, -10, true);
      // R < 0 means long arc, center on opposite side
      expect(center.x).toBeCloseTo(10, 2);
      expect(center.y).toBeCloseTo(10, 2);
    });

    it('should produce center equidistant from start and end', () => {
      const start = { x: 5, y: 0 };
      const end = { x: 0, y: 5 };
      const r = 6;
      const center = linearizer.calculateCenterR(start, end, r, true);
      const distStart = Math.sqrt((center.x - start.x) ** 2 + (center.y - start.y) ** 2);
      const distEnd = Math.sqrt((center.x - end.x) ** 2 + (center.y - end.y) ** 2);
      expect(Math.abs(distStart - distEnd)).toBeLessThan(0.001);
      expect(distStart).toBeCloseTo(r, 2);
    });
  });

  describe('validateArc', () => {
    it('should return true for valid arc (center equidistant from start and end)', () => {
      const center = { x: 0, y: 0 };
      const start = { x: 10, y: 0 };
      const end = { x: 0, y: 10 };
      expect(linearizer.validateArc(center, start, end)).toBe(true);
    });

    it('should return false when radii differ by more than 0.001mm', () => {
      const center = { x: 0, y: 0 };
      const start = { x: 10, y: 0 };
      const end = { x: 0, y: 10.01 }; // radius to end = 10.01, to start = 10
      expect(linearizer.validateArc(center, start, end)).toBe(false);
    });

    it('should return true when radii differ by less than 0.001mm', () => {
      const center = { x: 0, y: 0 };
      const start = { x: 10, y: 0 };
      const end = { x: 0, y: 10.0005 }; // within tolerance
      expect(linearizer.validateArc(center, start, end)).toBe(true);
    });
  });

  describe('generatePoints', () => {
    it('should generate points along a quarter circle', () => {
      const center = { x: 0, y: 0 };
      const radius = 10;
      const startAngle = 0; // 0° (point at (10, 0))
      const endAngle = Math.PI / 2; // 90° (point at (0, 10))
      const points = linearizer.generatePoints(center, radius, startAngle, endAngle, false, 0, 0);

      // Arc length = 10 * PI/2 ≈ 15.7mm, with maxSegment=1, expect ~16 segments
      expect(points.length).toBeGreaterThanOrEqual(15);

      // Last point should be close to (0, 10)
      const last = points[points.length - 1];
      expect(last.x).toBeCloseTo(0, 2);
      expect(last.y).toBeCloseTo(10, 2);
    });

    it('should ensure all segments are <= maxSegmentLength', () => {
      const center = { x: 0, y: 0 };
      const radius = 5;
      const startAngle = 0;
      const endAngle = Math.PI; // 180°
      const points = linearizer.generatePoints(center, radius, startAngle, endAngle, false, 0, -1);

      // Check segment lengths (from start point to first, then between consecutive)
      let prevPoint = { x: radius * Math.cos(startAngle), y: radius * Math.sin(startAngle) };
      for (const point of points) {
        const segLen = Math.sqrt((point.x - prevPoint.x) ** 2 + (point.y - prevPoint.y) ** 2);
        expect(segLen).toBeLessThanOrEqual(linearizer.maxSegmentLength + 0.001); // small tolerance for floating point
        prevPoint = point;
      }
    });

    it('should interpolate Z linearly', () => {
      const center = { x: 0, y: 0 };
      const radius = 10;
      const startAngle = 0;
      const endAngle = Math.PI;
      const startZ = 0;
      const endZ = -2;
      const points = linearizer.generatePoints(center, radius, startAngle, endAngle, false, startZ, endZ);

      // Z should progress linearly from 0 to -2
      for (let i = 0; i < points.length; i++) {
        const t = (i + 1) / points.length;
        const expectedZ = startZ + t * (endZ - startZ);
        expect(points[i].z).toBeCloseTo(expectedZ, 5);
      }
    });

    it('should handle clockwise arcs', () => {
      const center = { x: 0, y: 0 };
      const radius = 10;
      const startAngle = Math.PI / 2; // (0, 10)
      const endAngle = 0; // (10, 0)
      const points = linearizer.generatePoints(center, radius, startAngle, endAngle, true, 0, 0);

      // CW from 90° to 0° should go through positive quadrant
      expect(points.length).toBeGreaterThan(0);
      const last = points[points.length - 1];
      expect(last.x).toBeCloseTo(10, 2);
      expect(last.y).toBeCloseTo(0, 2);
    });
  });

  describe('linearize', () => {
    it('should linearize an arc using I/J parameters', () => {
      const start = { x: 10, y: 0, z: 0 };
      const end = { x: 0, y: 10, z: -0.5 };
      const params = { i: -10, j: 0 }; // center at (0, 0)
      const points = linearizer.linearize(start, end, params, false);

      expect(points).not.toBeNull();
      expect(points.length).toBeGreaterThan(0);

      // Last point should be close to end
      const last = points[points.length - 1];
      expect(last.x).toBeCloseTo(end.x, 2);
      expect(last.y).toBeCloseTo(end.y, 2);
      expect(last.z).toBeCloseTo(end.z, 2);
    });

    it('should linearize an arc using R parameter', () => {
      const start = { x: 10, y: 0, z: 0 };
      const end = { x: 0, y: 10, z: 0 };
      const params = { r: 10 };
      const points = linearizer.linearize(start, end, params, true);

      expect(points).not.toBeNull();
      expect(points.length).toBeGreaterThan(0);

      const last = points[points.length - 1];
      expect(last.x).toBeCloseTo(end.x, 2);
      expect(last.y).toBeCloseTo(end.y, 2);
    });

    it('should return null for invalid arc (inconsistent radii)', () => {
      const start = { x: 10, y: 0, z: 0 };
      const end = { x: 5, y: 5, z: 0 };
      // I/J that don't form a valid arc with the endpoint
      const params = { i: -10, j: 0 }; // center at (0,0), radius=10, but dist(center,end)=7.07
      const points = linearizer.linearize(start, end, params, true);

      expect(points).toBeNull();
    });

    it('should return null when no valid parameters provided', () => {
      const start = { x: 0, y: 0, z: 0 };
      const end = { x: 10, y: 10, z: 0 };
      const params = {};
      const points = linearizer.linearize(start, end, params, true);

      expect(points).toBeNull();
    });

    it('should handle full circle (end == start)', () => {
      const start = { x: 10, y: 0, z: 0 };
      const end = { x: 10, y: 0, z: 0 }; // same as start
      const params = { i: -10, j: 0 }; // center at (0, 0), radius 10
      const points = linearizer.linearize(start, end, params, true);

      expect(points).not.toBeNull();
      expect(points.length).toBeGreaterThan(0);

      // Should cover full 360° - arc length = 2*PI*10 ≈ 62.8mm
      // With maxSegment=1, expect ~63 segments
      expect(points.length).toBeGreaterThanOrEqual(62);

      // Last point should be back at start
      const last = points[points.length - 1];
      expect(last.x).toBeCloseTo(start.x, 2);
      expect(last.y).toBeCloseTo(start.y, 2);
    });

    it('should handle full circle within 0.001mm tolerance', () => {
      const start = { x: 10, y: 0, z: 0 };
      const end = { x: 10.0005, y: 0.0003, z: 0 }; // within 0.001mm of start
      const params = { i: -10, j: 0 }; // center at (0, 0)
      const points = linearizer.linearize(start, end, params, true);

      expect(points).not.toBeNull();
      // Should be treated as full circle
      expect(points.length).toBeGreaterThanOrEqual(62);
    });

    it('should produce segments with length <= maxSegmentLength', () => {
      const lin = new ArcLinearizer(2.0);
      const start = { x: 20, y: 0, z: 0 };
      const end = { x: 0, y: 20, z: -1 };
      const params = { i: -20, j: 0 }; // center at (0,0), radius 20
      const points = lin.linearize(start, end, params, false);

      expect(points).not.toBeNull();

      let prev = { x: start.x, y: start.y };
      for (const pt of points) {
        const segLen = Math.sqrt((pt.x - prev.x) ** 2 + (pt.y - prev.y) ** 2);
        expect(segLen).toBeLessThanOrEqual(2.0 + 0.001);
        prev = { x: pt.x, y: pt.y };
      }
    });

    it('should handle I=0 with only J provided', () => {
      // Arc from (0, 0) to (0, 10) with center at (0, 5) - semicircle
      const start = { x: 0, y: 0, z: 0 };
      const end = { x: 0, y: 10, z: 0 };
      const params = { i: 0, j: 5 }; // center at (0, 5), radius 5
      // This is a semicircle (180°) going CW (right side)
      const points = linearizer.linearize(start, end, params, true);

      expect(points).not.toBeNull();
      expect(points.length).toBeGreaterThan(0);

      const last = points[points.length - 1];
      expect(last.x).toBeCloseTo(0, 2);
      expect(last.y).toBeCloseTo(10, 2);
    });

    it('should return null for R=0', () => {
      const start = { x: 0, y: 0, z: 0 };
      const end = { x: 10, y: 0, z: 0 };
      const params = { r: 0 };
      const points = linearizer.linearize(start, end, params, true);
      expect(points).toBeNull();
    });
  });
});
