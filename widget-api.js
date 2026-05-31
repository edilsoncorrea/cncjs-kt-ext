'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Validates probe data: minimum 3 non-colinear points with finite coordinates.
 * @param {Array<{x,y,z}>} points
 * @returns {{ valid: boolean, error?: string }}
 */
function validateProbeData(points) {
  if (!Array.isArray(points) || points.length < 3) {
    return { valid: false, error: `Minimum 3 points required, got ${points ? points.length : 0}` };
  }

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      return { valid: false, error: `Point ${i + 1} has non-finite values: (${p.x}, ${p.y}, ${p.z})` };
    }
  }

  // Check non-colinearity
  let hasNonColinear = false;
  for (let i = 2; i < points.length; i++) {
    const v1x = points[1].x - points[0].x;
    const v1y = points[1].y - points[0].y;
    const v2x = points[i].x - points[0].x;
    const v2y = points[i].y - points[0].y;
    if (Math.abs(v1x * v2y - v1y * v2x) > 0.00001) {
      hasNonColinear = true;
      break;
    }
  }

  if (!hasNonColinear) {
    return { valid: false, error: 'All points are colinear — cannot form a surface' };
  }

  return { valid: true };
}

/**
 * Parses probe file content into array of points.
 * @param {string} content - File content
 * @returns {{ points: Array<{x,y,z}>, invalidLines: number }}
 */
function parseProbeFile(content) {
  const points = [];
  let invalidLines = 0;
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const vals = trimmed.split(/\s+/);
    if (vals.length >= 3) {
      const x = parseFloat(vals[0]);
      const y = parseFloat(vals[1]);
      const z = parseFloat(vals[2]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        points.push({ x, y, z });
      } else {
        invalidLines++;
      }
    } else if (trimmed.length > 0) {
      invalidLines++;
    }
  }

  return { points, invalidLines };
}

/**
 * Serializes probe points to text format.
 * @param {Array<{x,y,z}>} points
 * @returns {string}
 */
function serializeProbeData(points) {
  return points.map(p => `${p.x.toFixed(3)} ${p.y.toFixed(3)} ${p.z.toFixed(3)}`).join('\n') + '\n';
}

/**
 * Computes statistics from probe points.
 * @param {Array<{x,y,z}>} points
 * @returns {{ minZ: number, maxZ: number, avgZ: number, stddev: number, count: number }}
 */
function computeStats(points) {
  if (!points || points.length === 0) {
    return { minZ: 0, maxZ: 0, avgZ: 0, stddev: 0, count: 0 };
  }

  let minZ = points[0].z;
  let maxZ = points[0].z;
  let sum = 0;

  for (const p of points) {
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
    sum += p.z;
  }

  const avgZ = sum / points.length;
  let sumSqDiff = 0;
  for (const p of points) {
    sumSqDiff += (p.z - avgZ) * (p.z - avgZ);
  }
  const stddev = Math.sqrt(sumSqDiff / points.length);

  return {
    minZ: parseFloat(minZ.toFixed(3)),
    maxZ: parseFloat(maxZ.toFixed(3)),
    avgZ: parseFloat(avgZ.toFixed(3)),
    stddev: parseFloat(stddev.toFixed(3)),
    count: points.length
  };
}

/**
 * Registers REST API routes on the Express app.
 * @param {object} app - Express app
 * @param {object} autolevel - Autolevel instance
 * @param {string} workDir - Working directory for probe files
 */
function registerWidgetAPI(app, autolevel, workDir) {
  // GET /api/probes — list probe files
  app.get('/api/probes', (req, res) => {
    try {
      const files = fs.readdirSync(workDir)
        .filter(f => f.endsWith('.txt') || f.endsWith('.probe'))
        .map(f => {
          const stat = fs.statSync(path.join(workDir, f));
          return { filename: f, size: stat.size, modified: stat.mtime.toISOString() };
        });
      res.json({ files });
    } catch (err) {
      res.status(500).json({ error: `Failed to list files: ${err.message}` });
    }
  });

  // GET /api/probes/:filename — read and parse probe file
  app.get('/api/probes/:filename', (req, res) => {
    const filename = req.params.filename;

    // Sanitize filename
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filePath = path.join(workDir, filename);

    try {
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: `File not found: ${filename}` });
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const { points, invalidLines } = parseProbeFile(content);

      const validation = validateProbeData(points);
      if (!validation.valid) {
        return res.status(422).json({
          error: validation.error,
          pointsFound: points.length,
          invalidLines
        });
      }

      const stats = computeStats(points);
      res.json({ filename, points, stats, invalidLines });
    } catch (err) {
      res.status(500).json({ error: `Failed to read file: ${err.message}` });
    }
  });

  // POST /api/probes/:filename — save current probe data to file
  app.post('/api/probes/:filename', (req, res) => {
    const filename = req.params.filename;

    // Sanitize filename
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    // Use points from request body if provided, otherwise use autolevel's current data
    let points;
    if (req.body && req.body.points && Array.isArray(req.body.points)) {
      points = req.body.points;
    } else {
      points = autolevel.probedPoints;
    }

    if (!points || points.length === 0) {
      return res.status(400).json({ error: 'No probe data available to save' });
    }

    const filePath = path.join(workDir, filename);

    try {
      const content = serializeProbeData(points);
      fs.writeFileSync(filePath, content, 'utf8');
      res.json({ success: true, filename, pointCount: points.length });
    } catch (err) {
      res.status(500).json({ error: `Failed to save file: ${err.message}` });
    }
  });

  // DELETE /api/probes/:filename — delete probe file
  app.delete('/api/probes/:filename', (req, res) => {
    const filename = req.params.filename;

    // Sanitize filename
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filePath = path.join(workDir, filename);

    try {
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: `File not found: ${filename}` });
      }

      fs.unlinkSync(filePath);
      res.json({ success: true, filename });
    } catch (err) {
      res.status(500).json({ error: `Failed to delete file: ${err.message}` });
    }
  });

  // GET /api/state — return current state
  app.get('/api/state', (req, res) => {
    res.json({
      params: {
        delta: autolevel.delta,
        height: autolevel.height,
        feed: autolevel.feed,
        nProbes: autolevel.probesPerPoint,
      },
      probeData: {
        points: autolevel.probedPoints,
        stats: computeStats(autolevel.probedPoints)
      },
      gcodeInfo: {
        loaded: !!autolevel.gcode,
        fileName: autolevel.gcodeFileName,
      },
      probing: {
        active: autolevel.planedPointCount > 0,
      }
    });
  });
}

module.exports = { registerWidgetAPI, validateProbeData, parseProbeFile, serializeProbeData, computeStats };
