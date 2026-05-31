/* eslint-env browser */
'use strict';

/**
 * Incremental probe statistics calculator.
 */
class ProbeStats {
  constructor() {
    this.reset();
  }

  reset() {
    this.count = 0;
    this.minZ = Infinity;
    this.maxZ = -Infinity;
    this.sum = 0;
    this.sumSq = 0;
  }

  /**
   * Add a single Z value incrementally.
   * @param {number} z
   */
  addPoint(z) {
    this.count++;
    if (z < this.minZ) this.minZ = z;
    if (z > this.maxZ) this.maxZ = z;
    this.sum += z;
    this.sumSq += z * z;
  }

  /**
   * Batch calculation from array.
   * @param {number[]} zValues
   */
  fromArray(zValues) {
    this.reset();
    for (const z of zValues) {
      this.addPoint(z);
    }
  }

  /**
   * Returns current statistics.
   * @returns {{ minZ: number, maxZ: number, avgZ: number, stddev: number, count: number }}
   */
  getStats() {
    if (this.count === 0) {
      return { minZ: 0, maxZ: 0, avgZ: 0, stddev: 0, count: 0 };
    }

    const avgZ = this.sum / this.count;
    // stddev = sqrt(E[X^2] - (E[X])^2)
    const variance = (this.sumSq / this.count) - (avgZ * avgZ);
    // Guard against floating point producing tiny negative variance
    const stddev = Math.sqrt(Math.max(0, variance));

    return {
      minZ: parseFloat(this.minZ.toFixed(3)),
      maxZ: parseFloat(this.maxZ.toFixed(3)),
      avgZ: parseFloat(avgZ.toFixed(3)),
      stddev: parseFloat(stddev.toFixed(3)),
      count: this.count
    };
  }

  /**
   * Classifies amplitude into color category.
   * @param {number} amplitude - max_z - min_z
   * @returns {'green'|'yellow'|'red'}
   */
  static amplitudeColor(amplitude) {
    if (amplitude < 0.1) return 'green';
    if (amplitude <= 0.3) return 'yellow';
    return 'red';
  }
}

// Export for Node.js (tests) or attach to window for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ProbeStats };
}
