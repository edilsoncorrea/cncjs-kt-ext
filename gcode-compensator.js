'use strict';

/**
 * Units constant - shared with autolevel.js
 */
const Units = {
  MILLIMETERS: 1,
  INCHES: 2,

  convert: function (value, in_units, out_units) {
    if (in_units == out_units) {
      return value;
    }
    if (in_units == this.MILLIMETERS && out_units == this.INCHES) {
      return value / 25.4;
    }
    if (in_units == this.INCHES && out_units == this.MILLIMETERS) {
      return value * 25.4;
    }
    return value;
  }
};

Object.freeze(Units);

/**
 * GCodeCompensator - Processes G-code with streaming (line-by-line iteration),
 * applies Z compensation based on probed points, and optionally linearizes arcs.
 *
 * Key difference from the original applyCompensation():
 * - Instead of gcode.split('\n') creating a full array, iterates by index
 * - Instead of result = [] then result.join('\n'), builds string incrementally
 */
class GCodeCompensator {
  /**
   * @param {Array<{x: number, y: number, z: number}>} probedPoints - Array of probed surface points
   * @param {number} delta - Probing grid spacing in mm
   * @param {object|null} arcLinearizer - Optional ArcLinearizer instance for G2/G3 support
   */
  constructor(probedPoints, delta, arcLinearizer) {
    this.probedPoints = probedPoints;
    this.delta = delta;
    this.arcLinearizer = arcLinearizer || null;

    // Internal parsing state (maintained across lines)
    this.abs = true;          // true = G90 (absolute), false = G91 (relative)
    this.units = Units.MILLIMETERS;
    this.currentPos = { x: 0, y: 0, z: 0 };
    this.posInitialized = false;
  }

  /**
   * Process a G-code string via streaming (line-by-line iteration by index).
   * Instead of split('\n') creating a full array, iterates through the string
   * using indexOf to find line boundaries.
   *
   * @param {string} gcodeString - The full G-code string to process
   * @param {function} progressCallback - Called every 5000 lines: progressCallback(lineCount, totalLines)
   * @returns {string} The compensated G-code string
   */
  process(gcodeString, progressCallback) {
    let result = '';
    let lineStart = 0;
    let lineCount = 0;
    const totalLines = this.countLines(gcodeString);

    // Reset state for each process call
    this.abs = true;
    this.units = Units.MILLIMETERS;
    this.currentPos = { x: 0, y: 0, z: 0 };
    this.posInitialized = false;

    for (let i = 0; i <= gcodeString.length; i++) {
      if (i === gcodeString.length || gcodeString[i] === '\n') {
        const line = gcodeString.substring(lineStart, i);
        const processed = this.processLine(line);
        if (lineCount > 0) {
          result += '\n';
        }
        result += processed;
        lineStart = i + 1;
        lineCount++;
        if (progressCallback && lineCount % 5000 === 0) {
          progressCallback(lineCount, totalLines);
        }
      }
    }
    return result;
  }

  /**
   * Process a single line of G-code.
   * Maintains internal state (abs/rel, units, currentPos) between calls.
   *
   * @param {string} line - A single G-code line
   * @returns {string} The processed (compensated) line(s)
   */
  processLine(line) {
    // If whole line is a comment, pass through
    if (line.match(/^\s*\([^\)]*\)\s*$/g)) {
      return line.trim();
    }

    const lineStripped = this.stripComments(line);

    // Skip compensation for specific G-codes
    if (/(G38\.?\d*|G5\.?\d*|G10|G4\.?\d*|G92|G92\.1)/gi.test(lineStripped)) {
      return lineStripped;
    }

    // Track mode changes
    if (/G91/i.test(lineStripped)) this.abs = false;
    if (/G90/i.test(lineStripped)) this.abs = true;
    if (/G20/i.test(lineStripped)) this.units = Units.INCHES;
    if (/G21/i.test(lineStripped)) this.units = Units.MILLIMETERS;

    // Check for arc commands (G2/G3)
    if (this.arcLinearizer && /G[23]/i.test(lineStripped) && this.abs) {
      return this.processArc(lineStripped);
    }

    // No coordinate change → pass through
    if (!/(X|Y|Z)/gi.test(lineStripped)) {
      return lineStripped;
    }

    // Parse coordinates
    let pt = { x: this.currentPos.x, y: this.currentPos.y, z: this.currentPos.z };

    let xMatch = /X([\.\+\-\d]+)/gi.exec(lineStripped);
    if (xMatch) pt.x = parseFloat(xMatch[1]);

    let yMatch = /Y([\.\+\-\d]+)/gi.exec(lineStripped);
    if (yMatch) pt.y = parseFloat(yMatch[1]);

    let zMatch = /Z([\.\+\-\d]+)/gi.exec(lineStripped);
    if (zMatch) pt.z = parseFloat(zMatch[1]);

    if (this.abs) {
      // Strip coordinates from line
      let lineNoCoords = lineStripped.replace(/([XYZ])([\.\+\-\d]+)/gi, '');

      if (this.posInitialized) {
        let segs = this.splitToSegments(this.currentPos, pt, this.units);
        let resultLines = [];
        for (let seg of segs) {
          let cpt = this.compensateZCoord(seg, this.units);
          let newLine = lineNoCoords + ` X${cpt.x.toFixed(3)} Y${cpt.y.toFixed(3)} Z${cpt.z.toFixed(3)} ; Z${seg.z.toFixed(3)}`;
          resultLines.push(newLine.trim());
        }
        this.currentPos = { x: pt.x, y: pt.y, z: pt.z };
        if (resultLines.length === 0) {
          // No segments (zero distance) - just compensate the point
          let cpt = this.compensateZCoord(pt, this.units);
          return (lineNoCoords + ` X${cpt.x.toFixed(3)} Y${cpt.y.toFixed(3)} Z${cpt.z.toFixed(3)} ; Z${pt.z.toFixed(3)}`).trim();
        }
        return resultLines.join('\n');
      } else {
        let cpt = this.compensateZCoord(pt, this.units);
        let newLine = lineNoCoords + ` X${cpt.x.toFixed(3)} Y${cpt.y.toFixed(3)} Z${cpt.z.toFixed(3)} ; Z${pt.z.toFixed(3)}`;
        this.posInitialized = true;
        this.currentPos = { x: pt.x, y: pt.y, z: pt.z };
        return newLine.trim();
      }
    } else {
      // Relative mode: pass through with warning
      this.currentPos = { x: pt.x, y: pt.y, z: pt.z };
      return lineStripped;
    }
  }

  /**
   * Process an arc command (G2/G3). Linearizes and applies Z compensation.
   * @param {string} lineStripped - The stripped G-code line containing G2/G3
   * @returns {string} Compensated linear segments or original line if invalid
   */
  processArc(lineStripped) {
    // Parse arc command
    let cmdMatch = /G([23])/i.exec(lineStripped);
    if (!cmdMatch) return lineStripped;

    let clockwise = cmdMatch[1] === '2';

    // Parse endpoint
    let endPoint = { x: this.currentPos.x, y: this.currentPos.y, z: this.currentPos.z };
    let xMatch = /X([\.\+\-\d]+)/gi.exec(lineStripped);
    if (xMatch) endPoint.x = parseFloat(xMatch[1]);
    let yMatch = /Y([\.\+\-\d]+)/gi.exec(lineStripped);
    if (yMatch) endPoint.y = parseFloat(yMatch[1]);
    let zMatch = /Z([\.\+\-\d]+)/gi.exec(lineStripped);
    if (zMatch) endPoint.z = parseFloat(zMatch[1]);

    // Parse arc parameters
    let params = {};
    let iMatch = /I([\.\+\-\d]+)/gi.exec(lineStripped);
    if (iMatch) params.i = parseFloat(iMatch[1]);
    let jMatch = /J([\.\+\-\d]+)/gi.exec(lineStripped);
    if (jMatch) params.j = parseFloat(jMatch[1]);
    let rMatch = /R([\.\+\-\d]+)/gi.exec(lineStripped);
    if (rMatch) params.r = parseFloat(rMatch[1]);

    // Parse feedrate
    let feedrate = null;
    let fMatch = /F([\.\+\-\d]+)/gi.exec(lineStripped);
    if (fMatch) feedrate = parseFloat(fMatch[1]);

    // Linearize the arc
    let points = this.arcLinearizer.linearize(this.currentPos, endPoint, params, clockwise);

    if (!points || points.length === 0) {
      // Invalid arc: pass through without modification
      this.currentPos = { x: endPoint.x, y: endPoint.y, z: endPoint.z };
      return lineStripped;
    }

    // Apply Z compensation to each linearized point
    let resultLines = [];
    for (let pt of points) {
      let cpt = this.compensateZCoord(pt, this.units);
      let newLine = `G1 X${cpt.x.toFixed(3)} Y${cpt.y.toFixed(3)} Z${cpt.z.toFixed(3)}`;
      if (feedrate !== null) {
        newLine += ` F${feedrate}`;
      }
      newLine += ` ; Z${pt.z.toFixed(3)}`;
      resultLines.push(newLine);
    }

    this.currentPos = { x: endPoint.x, y: endPoint.y, z: endPoint.z };
    return resultLines.join('\n');
  }

  /**
   * Count lines in a string without creating an array.
   * Scans for '\n' characters and returns count + 1.
   *
   * @param {string} str - The string to count lines in
   * @returns {number} Number of lines
   */
  countLines(str) {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '\n') {
        count++;
      }
    }
    return count + 1;
  }

  // ─── Helper methods (extracted from autolevel.js) ───────────────────────────

  /**
   * Strip comments from a G-code line.
   * Removes parenthesized comments and semicolon comments.
   * @param {string} line
   * @returns {string}
   */
  stripComments(line) {
    const re1 = new RegExp(/\s*\([^\)]*\)/g);
    const re2 = new RegExp(/\s*;.*/g);
    const re3 = new RegExp(/\s+/g);
    return (line.replace(re1, '').replace(re2, '').replace(re3, ''));
  }

  /**
   * Find the three closest probed points to a given XY position.
   * Ensures the three points are not colinear.
   * @param {{x: number, y: number}} pt - Point in millimeters
   * @returns {Array<{x: number, y: number, z: number}>}
   */
  getThreeClosestPoints(pt) {
    let res = [];
    if (this.probedPoints.length < 3) {
      return res;
    }
    this.probedPoints.sort((a, b) => {
      return this.distanceSquared2(a, pt) < this.distanceSquared2(b, pt) ? -1 : 1;
    });
    let i = 0;
    while (res.length < 3 && i < this.probedPoints.length) {
      if (res.length === 2) {
        if (!this.isColinear(this.sub3(res[1], res[0]), this.sub3(this.probedPoints[i], res[0]))) {
          res.push(this.probedPoints[i]);
        }
      } else {
        res.push(this.probedPoints[i]);
      }
      i++;
    }
    return res;
  }

  /**
   * Apply Z compensation to a point using 3-point plane interpolation.
   * @param {{x: number, y: number, z: number}} pt_in_or_mm - Point in input units
   * @param {number} input_units - Units constant (MILLIMETERS or INCHES)
   * @returns {{x: number, y: number, z: number}} Compensated point in input units
   */
  compensateZCoord(pt_in_or_mm, input_units) {
    let pt_mm = {
      x: Units.convert(pt_in_or_mm.x, input_units, Units.MILLIMETERS),
      y: Units.convert(pt_in_or_mm.y, input_units, Units.MILLIMETERS),
      z: Units.convert(pt_in_or_mm.z, input_units, Units.MILLIMETERS)
    };

    let points = this.getThreeClosestPoints(pt_mm);
    if (points.length < 3) {
      return pt_in_or_mm;
    }
    let normal = this.crossProduct3(this.sub3(points[1], points[0]), this.sub3(points[2], points[0]));
    let pp = points[0];
    let dz = 0;
    if (normal.z !== 0) {
      dz = pp.z - (normal.x * (pt_mm.x - pp.x) + normal.y * (pt_mm.y - pp.y)) / normal.z;
    }
    return {
      x: Units.convert(pt_mm.x, Units.MILLIMETERS, input_units),
      y: Units.convert(pt_mm.y, Units.MILLIMETERS, input_units),
      z: Units.convert(pt_mm.z + dz, Units.MILLIMETERS, input_units)
    };
  }

  /**
   * Split a line segment into smaller segments no larger than delta/2.
   * @param {{x: number, y: number, z: number}} p1 - Start point
   * @param {{x: number, y: number, z: number}} p2 - End point
   * @param {number} units - Units constant
   * @returns {Array<{x: number, y: number, z: number}>}
   */
  splitToSegments(p1, p2, units) {
    let res = [];
    let v = this.sub3(p2, p1);
    let dist = Math.sqrt(this.distanceSquared3(p1, p2));

    if (dist < 1e-10) {
      return [];
    }

    let dir = {
      x: v.x / dist,
      y: v.y / dist,
      z: v.z / dist
    };
    let maxSegLength = Units.convert(this.delta, Units.MILLIMETERS, units) / 2;
    res.push({ x: p1.x, y: p1.y, z: p1.z });
    for (let d = maxSegLength; d < dist; d += maxSegLength) {
      this._appendPointSkipDuplicate(res, {
        x: p1.x + dir.x * d,
        y: p1.y + dir.y * d,
        z: p1.z + dir.z * d
      });
    }
    this._appendPointSkipDuplicate(res, { x: p2.x, y: p2.y, z: p2.z });
    return res;
  }

  /**
   * Append point to array only if significantly different from last point.
   * @private
   */
  _appendPointSkipDuplicate(resArray, pt) {
    if (resArray.length === 0) {
      resArray.push(pt);
      return;
    }
    const lastPt = resArray[resArray.length - 1];
    if (this.distanceSquared3(pt, lastPt) > 1e-10) {
      resArray.push(pt);
    }
  }

  distanceSquared3(p1, p2) {
    return (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y) + (p2.z - p1.z) * (p2.z - p1.z);
  }

  distanceSquared2(p1, p2) {
    return (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y);
  }

  crossProduct3(u, v) {
    return {
      x: (u.y * v.z - u.z * v.y),
      y: -(u.x * v.z - u.z * v.x),
      z: (u.x * v.y - u.y * v.x)
    };
  }

  isColinear(u, v) {
    return Math.abs(u.x * v.y - u.y * v.x) < 0.00001;
  }

  sub3(p1, p2) {
    return {
      x: p1.x - p2.x,
      y: p1.y - p2.y,
      z: p1.z - p2.z
    };
  }
}

module.exports = GCodeCompensator;
module.exports.Units = Units;
