'use strict';

/**
 * ProbeStateMachine - Manages multi-probe measurements per point.
 * 
 * Handles multiple measurements per probe point, calculates averages
 * with outlier rejection (2σ for N≥4), and generates re-probe G-code commands.
 */

const STATE = {
  IDLE: 'IDLE',
  PROBING: 'PROBING',
  COMPLETE: 'COMPLETE'
};

class ProbeStateMachine {
  /**
   * @param {number} probesPerPoint - Number of probes per point (1-10, default 1)
   * @param {number} totalPoints - Total number of points to probe
   */
  constructor(probesPerPoint, totalPoints) {
    if (probesPerPoint === undefined || probesPerPoint === null) {
      probesPerPoint = 1;
    }
    this.probesPerPoint = Math.max(1, Math.min(10, Math.round(probesPerPoint)));
    this.totalPoints = totalPoints;
    this.reset();
  }

  /**
   * Reset all state to initial values for a new probing session.
   */
  reset() {
    this.currentPointIndex = 0;
    this.currentMeasurements = [];
    this.completedPoints = [];
    this.state = STATE.IDLE;
  }

  /**
   * Register a probe measurement.
   * 
   * @param {number} x - X coordinate from PRB response
   * @param {number} y - Y coordinate from PRB response
   * @param {number} z - Z coordinate from PRB response
   * @returns {{ pointComplete: boolean, allComplete: boolean, point?: {x: number, y: number, z: number} }}
   */
  addMeasurement(x, y, z) {
    if (this.state === STATE.COMPLETE) {
      return { pointComplete: false, allComplete: true };
    }

    if (this.state === STATE.IDLE) {
      this.state = STATE.PROBING;
    }

    this.currentMeasurements.push({ x, y, z });

    if (this.currentMeasurements.length < this.probesPerPoint) {
      return { pointComplete: false, allComplete: false };
    }

    // All measurements for this point collected — calculate average Z
    const avgZ = this.calculateAverage(this.currentMeasurements.map(m => m.z));

    // Use x, y from the first measurement (same point, should be identical)
    const point = {
      x: this.currentMeasurements[0].x,
      y: this.currentMeasurements[0].y,
      z: avgZ
    };

    this.completedPoints.push(point);
    this.currentPointIndex++;
    this.currentMeasurements = [];

    const allComplete = this.currentPointIndex >= this.totalPoints;
    if (allComplete) {
      this.state = STATE.COMPLETE;
    }

    return { pointComplete: true, allComplete, point };
  }

  /**
   * Calculate average Z with outlier rejection.
   * 
   * - If N < 4: simple arithmetic mean
   * - If N >= 4: exclude values > 2σ from mean, recalculate
   * - If all values excluded after outlier rejection: return median
   * 
   * @param {number[]} measurements - Array of Z values
   * @returns {number} The calculated average Z
   */
  calculateAverage(measurements) {
    if (measurements.length === 0) {
      return 0;
    }

    if (measurements.length === 1) {
      return measurements[0];
    }

    // For N < 4: simple arithmetic mean
    if (measurements.length < 4) {
      const sum = measurements.reduce((acc, val) => acc + val, 0);
      return sum / measurements.length;
    }

    // For N >= 4: outlier rejection with 2σ
    const mean = measurements.reduce((acc, val) => acc + val, 0) / measurements.length;
    const variance = measurements.reduce((acc, val) => acc + (val - mean) ** 2, 0) / measurements.length;
    const stddev = Math.sqrt(variance);

    const filtered = measurements.filter(val => Math.abs(val - mean) <= 2 * stddev);

    // If all values excluded, use median of original measurements
    if (filtered.length === 0) {
      return this._median(measurements);
    }

    // Recalculate mean of remaining values
    const filteredSum = filtered.reduce((acc, val) => acc + val, 0);
    return filteredSum / filtered.length;
  }

  /**
   * Calculate median of an array of numbers.
   * @param {number[]} values
   * @returns {number}
   */
  _median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  /**
   * Generate G-code commands to re-probe the same point.
   * Raises Z to travel height, then probes down.
   * 
   * @param {number} x - X coordinate of the point
   * @param {number} y - Y coordinate of the point
   * @param {number} height - Travel height (Z clearance)
   * @param {number} feed - Probe feedrate (mm/min)
   * @returns {string} G-code commands separated by newline
   */
  getRepeatProbeCommands(x, y, height, feed) {
    return `G0 Z${height}\nG38.2 Z-${height + 1} F${feed}`;
  }
}

ProbeStateMachine.STATE = STATE;

module.exports = ProbeStateMachine;
