/* eslint-env browser */
'use strict';

/**
 * Calculates the probing grid (client-side replica of autolevel.start() logic).
 * @param {object} params
 * @param {number} params.delta - Step size (mm)
 * @param {number} params.margin - Margin from edges (mm)
 * @param {number} [params.xMin] - G-code X min bound
 * @param {number} [params.xMax] - G-code X max bound
 * @param {number} [params.yMin] - G-code Y min bound
 * @param {number} [params.yMax] - G-code Y max bound
 * @param {number} [params.xSize] - Manual X size (overrides bounds)
 * @param {number} [params.ySize] - Manual Y size (overrides bounds)
 * @returns {{ points: Array<{x: number, y: number}>, count: number, estimatedTime: number }}
 */
function calculateGrid(params) {
  const { delta, margin } = params;

  if (!delta || delta <= 0) {
    return { points: [], count: 0, estimatedTime: 0 };
  }

  let xmin, xmax, ymin, ymax;

  if (params.xSize && params.xSize > 0) {
    xmin = margin;
    xmax = params.xSize - margin;
  } else if (params.xMin !== undefined && params.xMax !== undefined) {
    xmin = params.xMin + margin;
    xmax = params.xMax - margin;
  } else {
    return { points: [], count: 0, estimatedTime: 0 };
  }

  if (params.ySize && params.ySize > 0) {
    ymin = margin;
    ymax = params.ySize - margin;
  } else if (params.yMin !== undefined && params.yMax !== undefined) {
    ymin = params.yMin + margin;
    ymax = params.yMax - margin;
  } else {
    return { points: [], count: 0, estimatedTime: 0 };
  }

  // Guard: if effective area is zero or negative
  if (xmax <= xmin || ymax <= ymin) {
    // Single point at midpoint
    const mx = (xmin + xmax) / 2;
    const my = (ymin + ymax) / 2;
    return { points: [{ x: mx, y: my }], count: 1, estimatedTime: 0 };
  }

  // Calculate step sizes (same logic as autolevel.start)
  let dx, dy;

  if ((xmax - xmin) <= delta) {
    dx = xmax - xmin;
    const midX = (xmin + xmax) / 2;
    xmin = midX;
    xmax = midX;
  } else {
    const nx = parseInt((xmax - xmin) / delta);
    dx = (xmax - xmin) / nx;
  }

  if ((ymax - ymin) <= delta) {
    dy = ymax - ymin;
    const midY = (ymin + ymax) / 2;
    ymin = midY;
    ymax = midY;
  } else {
    const ny = parseInt((ymax - ymin) / delta);
    dy = (ymax - ymin) / ny;
  }

  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return { points: [], count: 0, estimatedTime: 0 };
  }

  const points = [];

  // First point (origin)
  points.push({ x: parseFloat(xmin.toFixed(3)), y: parseFloat(ymin.toFixed(3)) });

  let y = ymin - dy;
  while (y < ymax - 0.01) {
    y += dy;
    if (y > ymax) y = ymax;
    let x = xmin - dx;
    if (y <= ymin + 0.01) x = xmin; // don't add first point twice

    while (x < xmax - 0.01) {
      x += dx;
      if (x > xmax) x = xmax;
      points.push({ x: parseFloat(x.toFixed(3)), y: parseFloat(y.toFixed(3)) });
    }
  }

  const height = params.height || 2;
  const feed = params.feed || 50;
  const nProbes = params.nProbes || 1;
  const avgSpacing = (dx + dy) / 2;
  const estimatedTime = estimateTime(points.length, height, feed, nProbes, avgSpacing);

  return { points, count: points.length, estimatedTime };
}

/**
 * Estimates probing time in minutes.
 * @param {number} pointCount
 * @param {number} height - Travel height (mm)
 * @param {number} feed - Probe feedrate (mm/min)
 * @param {number} probesPerPoint
 * @param {number} avgSpacing - Average spacing between points (mm)
 * @returns {number} Estimated time in minutes
 */
function estimateTime(pointCount, height, feed, probesPerPoint, avgSpacing) {
  if (pointCount === 0 || feed <= 0) return 0;

  // Time per point: descend + ascend at probe feed + travel to next point at rapid
  const probeTime = (height + 1) / feed; // minutes to probe down
  const retractTime = height / 1000; // rapid retract (assume 1000 mm/min)
  const travelTime = avgSpacing / 1000; // rapid travel between points

  const timePerPoint = (probeTime + retractTime + travelTime) * probesPerPoint;
  return pointCount * timePerPoint;
}

// Export for Node.js (tests) or attach to window for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calculateGrid, estimateTime };
}
