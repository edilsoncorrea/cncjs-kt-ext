'use strict';

/**
 * ArcLinearizer - Converts G2/G3 arc commands into sequences of linear G1 segments.
 * 
 * Supports both I/J (incremental offset to center) and R (radius) arc definitions.
 * Generates points with spacing <= maxSegmentLength along the arc path.
 */
class ArcLinearizer {
  /**
   * @param {number} maxSegmentLength - Maximum length of each linear segment (typically delta/2)
   */
  constructor(maxSegmentLength) {
    this.maxSegmentLength = maxSegmentLength;
  }

  /**
   * Calculate arc center from I, J offsets (incremental from start point).
   * @param {{x: number, y: number}} start - Start point
   * @param {number} i - X offset from start to center
   * @param {number} j - Y offset from start to center
   * @returns {{x: number, y: number}} Center point
   */
  calculateCenterIJ(start, i, j) {
    return { x: start.x + i, y: start.y + j };
  }

  /**
   * Calculate arc center from radius R.
   * R > 0 means shorter arc (< 180°), R < 0 means longer arc (> 180°).
   * Uses geometric formula to find the two possible centers and selects based on R sign and direction.
   * 
   * @param {{x: number, y: number}} start - Start point
   * @param {{x: number, y: number}} end - End point
   * @param {number} r - Radius (positive = short arc, negative = long arc)
   * @param {boolean} clockwise - True for G2 (CW), false for G3 (CCW)
   * @returns {{x: number, y: number}} Center point
   */
  calculateCenterR(start, end, r, clockwise) {
    const absR = Math.abs(r);

    // Midpoint between start and end
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    // Distance from start to end
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Half-distance
    const halfDist = dist / 2;

    // Distance from midpoint to center (perpendicular)
    // h² + halfDist² = r²  =>  h = sqrt(r² - halfDist²)
    const hSquared = absR * absR - halfDist * halfDist;
    const h = Math.sqrt(Math.max(0, hSquared));

    // Unit perpendicular vector (rotated 90° from start->end direction)
    const perpX = -dy / dist;
    const perpY = dx / dist;

    // Determine which side the center is on:
    // For R > 0 (short arc): 
    //   CW (G2): center is to the right of start->end vector
    //   CCW (G3): center is to the left of start->end vector
    // For R < 0 (long arc): opposite side
    let side;
    if (r > 0) {
      side = clockwise ? 1 : -1;
    } else {
      side = clockwise ? -1 : 1;
    }

    return {
      x: midX + side * h * perpX,
      y: midY + side * h * perpY
    };
  }

  /**
   * Validate arc consistency: |dist(center, start) - dist(center, end)| < 0.001mm
   * @param {{x: number, y: number}} center - Arc center
   * @param {{x: number, y: number}} start - Start point
   * @param {{x: number, y: number}} end - End point
   * @returns {boolean} True if arc is valid
   */
  validateArc(center, start, end) {
    const distStart = Math.sqrt(
      (center.x - start.x) * (center.x - start.x) +
      (center.y - start.y) * (center.y - start.y)
    );
    const distEnd = Math.sqrt(
      (center.x - end.x) * (center.x - end.x) +
      (center.y - end.y) * (center.y - end.y)
    );
    return Math.abs(distStart - distEnd) < 0.001;
  }

  /**
   * Generate points along the arc with spacing <= maxSegmentLength.
   * Interpolates Z linearly between startZ and endZ.
   * 
   * @param {{x: number, y: number}} center - Arc center
   * @param {number} radius - Arc radius
   * @param {number} startAngle - Start angle in radians
   * @param {number} endAngle - End angle in radians
   * @param {boolean} clockwise - True for CW, false for CCW
   * @param {number} startZ - Z at start of arc
   * @param {number} endZ - Z at end of arc
   * @returns {Array<{x: number, y: number, z: number}>} Array of points along the arc
   */
  generatePoints(center, radius, startAngle, endAngle, clockwise, startZ, endZ) {
    // Calculate total angular sweep
    let totalAngle;
    if (clockwise) {
      // CW: angles decrease (or wrap around)
      totalAngle = startAngle - endAngle;
      if (totalAngle <= 0) {
        totalAngle += 2 * Math.PI;
      }
    } else {
      // CCW: angles increase (or wrap around)
      totalAngle = endAngle - startAngle;
      if (totalAngle <= 0) {
        totalAngle += 2 * Math.PI;
      }
    }

    // Arc length
    const arcLength = radius * totalAngle;

    // Number of segments: ensure each segment <= maxSegmentLength
    const numSegments = Math.max(1, Math.ceil(arcLength / this.maxSegmentLength));

    const points = [];
    for (let i = 1; i <= numSegments; i++) {
      const t = i / numSegments;

      // Calculate angle for this point
      let angle;
      if (clockwise) {
        angle = startAngle - t * totalAngle;
      } else {
        angle = startAngle + t * totalAngle;
      }

      // Calculate XY position
      const x = center.x + radius * Math.cos(angle);
      const y = center.y + radius * Math.sin(angle);

      // Linear interpolation of Z
      const z = startZ + t * (endZ - startZ);

      points.push({ x, y, z });
    }

    return points;
  }

  /**
   * Main linearization method. Orchestrates center calculation, validation, and point generation.
   * 
   * @param {{x: number, y: number, z: number}} startPoint - Current position (arc start)
   * @param {{x: number, y: number, z: number}} endPoint - Arc endpoint
   * @param {{i?: number, j?: number, r?: number}} params - Arc parameters (I/J or R)
   * @param {boolean} clockwise - True for G2 (CW), false for G3 (CCW)
   * @returns {Array<{x: number, y: number, z: number}>|null} Array of points, or null if arc is invalid
   */
  linearize(startPoint, endPoint, params, clockwise) {
    // Calculate center
    let center;
    if (params.i !== undefined || params.j !== undefined) {
      const i = params.i || 0;
      const j = params.j || 0;
      center = this.calculateCenterIJ(startPoint, i, j);
    } else if (params.r !== undefined && params.r !== 0) {
      center = this.calculateCenterR(startPoint, endPoint, params.r, clockwise);
    } else {
      // No valid parameters
      return null;
    }

    // Validate arc
    if (!this.validateArc(center, startPoint, endPoint)) {
      return null;
    }

    // Calculate radius
    const radius = Math.sqrt(
      (center.x - startPoint.x) * (center.x - startPoint.x) +
      (center.y - startPoint.y) * (center.y - startPoint.y)
    );

    if (radius < 0.0001) {
      return null;
    }

    // Calculate start and end angles
    const startAngle = Math.atan2(startPoint.y - center.y, startPoint.x - center.x);
    let endAngle = Math.atan2(endPoint.y - center.y, endPoint.x - center.x);

    // Check for full circle: end point == start point (within 0.001mm tolerance)
    const distStartEnd = Math.sqrt(
      (endPoint.x - startPoint.x) * (endPoint.x - startPoint.x) +
      (endPoint.y - startPoint.y) * (endPoint.y - startPoint.y)
    );

    if (distStartEnd < 0.001) {
      // Full circle (360°)
      // For a full circle, endAngle should wrap all the way around
      if (clockwise) {
        endAngle = startAngle - 2 * Math.PI;
      } else {
        endAngle = startAngle + 2 * Math.PI;
      }
      // Use special generation for full circle
      return this._generateFullCirclePoints(center, radius, startAngle, clockwise, startPoint.z, endPoint.z);
    }

    // Generate points along the arc
    return this.generatePoints(center, radius, startAngle, endAngle, clockwise, startPoint.z, endPoint.z);
  }

  /**
   * Generate points for a full circle (360°).
   * @private
   */
  _generateFullCirclePoints(center, radius, startAngle, clockwise, startZ, endZ) {
    const totalAngle = 2 * Math.PI;
    const arcLength = radius * totalAngle;
    const numSegments = Math.max(1, Math.ceil(arcLength / this.maxSegmentLength));

    const points = [];
    for (let i = 1; i <= numSegments; i++) {
      const t = i / numSegments;

      let angle;
      if (clockwise) {
        angle = startAngle - t * totalAngle;
      } else {
        angle = startAngle + t * totalAngle;
      }

      const x = center.x + radius * Math.cos(angle);
      const y = center.y + radius * Math.sin(angle);
      const z = startZ + t * (endZ - startZ);

      points.push({ x, y, z });
    }

    return points;
  }
}

module.exports = ArcLinearizer;
