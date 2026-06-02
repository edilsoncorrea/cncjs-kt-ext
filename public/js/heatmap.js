/* eslint-env browser */
'use strict';

/**
 * Heatmap renderer using Canvas 2D.
 */
class HeatmapRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.points = [];
    this.minZ = 0;
    this.maxZ = 0;
    this.bounds = null; // { xMin, xMax, yMin, yMax }
    this.padding = options.padding || 50;
    this.pointRadius = options.pointRadius || 12;
    this.legendWidth = 40;
    this.mode = '3d'; // '2d' or '3d' - default to 3D
    this.zExaggeration = options.zExaggeration || 5; // Z multiplier for 3D view
    // 3D rotation (radians)
    this.rotationX = 0.6;  // tilt (pitch)
    this.rotationZ = 0.8;  // spin (yaw)
    // Zoom
    this.zoom = 1.0; // 1.0 = 100%
    this.ZOOM_MIN = 0.3;  // 30%
    this.ZOOM_MAX = 1.5;  // 150%
    // Mouse drag state
    this._dragging = false;
    this._lastMouseX = 0;
    this._lastMouseY = 0;
    this._initMouseHandlers();
  }

  /**
   * Initialize mouse handlers for 3D rotation (right-click drag).
   */
  _initMouseHandlers() {
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Zoom with scroll wheel (both 2D and 3D)
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      this.zoom = Math.max(this.ZOOM_MIN, Math.min(this.ZOOM_MAX, this.zoom + delta));
      this.render(this.points);
    }, { passive: false });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2 && this.mode === '3d') {
        this._dragging = true;
        this._lastMouseX = e.clientX;
        this._lastMouseY = e.clientY;
        e.preventDefault();
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this._dragging) {
        const dx = e.clientX - this._lastMouseX;
        const dy = e.clientY - this._lastMouseY;
        this.rotationZ += dx * 0.01;
        this.rotationX -= dy * 0.01;
        // Clamp rotationX to avoid flipping
        this.rotationX = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, this.rotationX));
        this._lastMouseX = e.clientX;
        this._lastMouseY = e.clientY;
        this.render(this.points);
      }
    });

    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 2) {
        this._dragging = false;
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this._dragging = false;
    });
  }

  /**
   * Renders all points on the canvas.
   * @param {Array<{x, y, z}>} points
   */
  render(points) {
    this.points = points || [];
    if (this.points.length === 0) {
      this._clear();
      this._drawEmpty();
      return;
    }

    this._computeBounds();
    this._clear();

    if (this.mode === '3d') {
      this._render3D();
    } else {
      this._drawBackground();
      this._drawPoints();
    }
    this.drawLegend();
  }

  /**
   * Adds a single point incrementally.
   * @param {{x, y, z}} point
   */
  addPoint(point) {
    this.points.push(point);
    this._computeBounds();
    this._clear();
    if (this.mode === '3d') {
      this._render3D();
    } else {
      this._drawBackground();
      this._drawPoints();
    }
    this.drawLegend();
  }

  /**
   * Maps Z value to RGB color (blue → green → red).
   * @param {number} z
   * @param {number} minZ
   * @param {number} maxZ
   * @returns {string} CSS color string
   */
  static zToColor(z, minZ, maxZ) {
    if (maxZ === minZ) return 'rgb(0, 255, 0)'; // all same = green

    // Normalize to 0..1
    let t = (z - minZ) / (maxZ - minZ);
    t = Math.max(0, Math.min(1, t));

    let r, g, b;
    if (t < 0.5) {
      // Blue (0) → Green (0.5)
      const s = t * 2; // 0..1
      r = 0;
      g = Math.round(255 * s);
      b = Math.round(255 * (1 - s));
    } else {
      // Green (0.5) → Red (1)
      const s = (t - 0.5) * 2; // 0..1
      r = Math.round(255 * s);
      g = Math.round(255 * (1 - s));
      b = 0;
    }

    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Hit test: returns point under cursor or null.
   * @param {number} canvasX
   * @param {number} canvasY
   * @returns {{x, y, z}|null}
   */
  hitTest(canvasX, canvasY) {
    if (!this.bounds || this.points.length === 0) return null;

    for (const point of this.points) {
      const pos = this._worldToCanvas(point.x, point.y);
      const dx = canvasX - pos.x;
      const dy = canvasY - pos.y;
      if (dx * dx + dy * dy <= this.pointRadius * this.pointRadius) {
        return point;
      }
    }
    return null;
  }

  /**
   * Draws planned grid overlay.
   * @param {Array<{x, y}>} gridPoints
   * @param {object} bounds - { xMin, xMax, yMin, yMax }
   */
  drawGrid(gridPoints, bounds) {
    if (!gridPoints || gridPoints.length === 0) return;

    // Use provided bounds or compute from grid
    const b = bounds || this.bounds;
    if (!b) return;

    const ctx = this.ctx;

    // Draw bounds rectangle
    const topLeft = this._worldToCanvas(b.xMin, b.yMax);
    const bottomRight = this._worldToCanvas(b.xMax, b.yMin);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    ctx.setLineDash([]);

    // Draw grid points as small circles
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    for (const gp of gridPoints) {
      const pos = this._worldToCanvas(gp.x, gp.y);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Draws color scale legend.
   */
  drawLegend() {
    const ctx = this.ctx;
    const x = this.canvas.width - this.legendWidth - 10;
    const y = this.padding;
    const h = this.canvas.height - this.padding * 2;
    const w = 15;

    // Draw gradient bar
    for (let i = 0; i < h; i++) {
      const t = 1 - (i / h); // top = max (red), bottom = min (blue)
      const color = HeatmapRenderer.zToColor(
        this.minZ + t * (this.maxZ - this.minZ),
        this.minZ,
        this.maxZ
      );
      ctx.fillStyle = color;
      ctx.fillRect(x, y + i, w, 1);
    }

    // Draw border
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    // Labels
    ctx.fillStyle = '#aaa';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(this.maxZ.toFixed(3), x + w + 4, y + 10);
    ctx.fillText(((this.minZ + this.maxZ) / 2).toFixed(3), x + w + 4, y + h / 2 + 4);
    ctx.fillText(this.minZ.toFixed(3), x + w + 4, y + h);
  }

  // --- Private methods ---

  _computeBounds() {
    if (this.points.length === 0) return;

    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    this.minZ = Infinity;
    this.maxZ = -Infinity;

    for (const p of this.points) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
      if (p.z < this.minZ) this.minZ = p.z;
      if (p.z > this.maxZ) this.maxZ = p.z;
    }

    this.bounds = { xMin, xMax, yMin, yMax };
  }

  _worldToCanvas(wx, wy) {
    if (!this.bounds) return { x: 0, y: 0 };

    const drawWidth = (this.canvas.width - this.padding * 2 - this.legendWidth - 20) * this.zoom;
    const drawHeight = (this.canvas.height - this.padding * 2) * this.zoom;

    const rangeX = this.bounds.xMax - this.bounds.xMin || 1;
    const rangeY = this.bounds.yMax - this.bounds.yMin || 1;

    const offsetX = (this.canvas.width - this.legendWidth - 20 - drawWidth) / 2;
    const offsetY = (this.canvas.height - drawHeight) / 2;

    const x = offsetX + ((wx - this.bounds.xMin) / rangeX) * drawWidth;
    // Flip Y so that Y increases upward
    const y = offsetY + drawHeight - ((wy - this.bounds.yMin) / rangeY) * drawHeight;

    return { x, y };
  }

  _clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _drawBackground() {
    this.ctx.fillStyle = '#0f0f23';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw axis labels
    if (!this.bounds) return;
    const ctx = this.ctx;
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';

    // X axis
    ctx.fillText(`X: ${this.bounds.xMin.toFixed(1)} — ${this.bounds.xMax.toFixed(1)}`, this.canvas.width / 2, this.canvas.height - 10);

    // Y axis
    ctx.save();
    ctx.translate(12, this.canvas.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`Y: ${this.bounds.yMin.toFixed(1)} — ${this.bounds.yMax.toFixed(1)}`, 0, 0);
    ctx.restore();
  }

  _drawPoints() {
    const ctx = this.ctx;
    for (const p of this.points) {
      const pos = this._worldToCanvas(p.x, p.y);
      const color = HeatmapRenderer.zToColor(p.z, this.minZ, this.maxZ);

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, this.pointRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  _drawEmpty() {
    this.ctx.fillStyle = '#0f0f23';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#555';
    this.ctx.font = '14px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('No probe data', this.canvas.width / 2, this.canvas.height / 2);
  }

  /**
   * Set the view mode ('2d' or '3d').
   * @param {string} mode
   */
  setMode(mode) {
    this.mode = mode;
    this.render(this.points);
  }

  /**
   * Set Z exaggeration factor.
   * @param {number} factor
   */
  setZExaggeration(factor) {
    this.zExaggeration = factor;
    if (this.mode === '3d') {
      this.render(this.points);
    }
  }

  /**
   * 3D isometric rendering of the probe surface.
   * Projects XY as isometric plane, Z as vertical height.
   */
  _render3D() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Background
    ctx.fillStyle = '#0f0f23';
    ctx.fillRect(0, 0, w, h);

    if (!this.bounds || this.points.length === 0) return;

    // Sort points for correct painter's algorithm (back to front)
    const sorted = [...this.points].sort((a, b) => {
      // Sort by Y descending (far points first), then X ascending
      if (a.y !== b.y) return b.y - a.y;
      return a.x - b.x;
    });

    // Build grid map for wireframe
    const gridMap = new Map();
    for (const p of this.points) {
      const key = `${p.x.toFixed(2)}_${p.y.toFixed(2)}`;
      gridMap.set(key, p);
    }

    // Get unique sorted X and Y values
    const xVals = [...new Set(this.points.map(p => p.x))].sort((a, b) => a - b);
    const yVals = [...new Set(this.points.map(p => p.y))].sort((a, b) => a - b);

    // Draw wireframe surface (lines connecting adjacent points)
    ctx.lineWidth = 1;

    // Draw in order from back to front for painter's algorithm
    for (let yi = yVals.length - 1; yi >= 0; yi--) {
      for (let xi = 0; xi < xVals.length; xi++) {
        const key = `${xVals[xi].toFixed(2)}_${yVals[yi].toFixed(2)}`;
        const p = gridMap.get(key);
        if (!p) continue;

        const pos = this._worldToCanvas3D(p.x, p.y, p.z);
        const color = HeatmapRenderer.zToColor(p.z, this.minZ, this.maxZ);

        // Draw lines to right neighbor
        if (xi < xVals.length - 1) {
          const rKey = `${xVals[xi + 1].toFixed(2)}_${yVals[yi].toFixed(2)}`;
          const rp = gridMap.get(rKey);
          if (rp) {
            const rPos = this._worldToCanvas3D(rp.x, rp.y, rp.z);
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(rPos.x, rPos.y);
            ctx.stroke();
          }
        }

        // Draw lines to front neighbor
        if (yi > 0) {
          const fKey = `${xVals[xi].toFixed(2)}_${yVals[yi - 1].toFixed(2)}`;
          const fp = gridMap.get(fKey);
          if (fp) {
            const fPos = this._worldToCanvas3D(fp.x, fp.y, fp.z);
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(fPos.x, fPos.y);
            ctx.stroke();
          }
        }

        // Draw filled quad (surface patch) if we have all 4 corners
        if (xi < xVals.length - 1 && yi > 0) {
          const trKey = `${xVals[xi + 1].toFixed(2)}_${yVals[yi].toFixed(2)}`;
          const blKey = `${xVals[xi].toFixed(2)}_${yVals[yi - 1].toFixed(2)}`;
          const brKey = `${xVals[xi + 1].toFixed(2)}_${yVals[yi - 1].toFixed(2)}`;
          const tr = gridMap.get(trKey);
          const bl = gridMap.get(blKey);
          const br = gridMap.get(brKey);

          if (tr && bl && br) {
            const trPos = this._worldToCanvas3D(tr.x, tr.y, tr.z);
            const blPos = this._worldToCanvas3D(bl.x, bl.y, bl.z);
            const brPos = this._worldToCanvas3D(br.x, br.y, br.z);

            const avgZ = (p.z + tr.z + bl.z + br.z) / 4;
            const fillColor = HeatmapRenderer.zToColor(avgZ, this.minZ, this.maxZ);

            ctx.globalAlpha = 0.4;
            ctx.fillStyle = fillColor;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(trPos.x, trPos.y);
            ctx.lineTo(brPos.x, brPos.y);
            ctx.lineTo(blPos.x, blPos.y);
            ctx.closePath();
            ctx.fill();
          }
        }

        ctx.globalAlpha = 1.0;
      }
    }

    // Draw points on top
    for (let yi = yVals.length - 1; yi >= 0; yi--) {
      for (let xi = 0; xi < xVals.length; xi++) {
        const key = `${xVals[xi].toFixed(2)}_${yVals[yi].toFixed(2)}`;
        const p = gridMap.get(key);
        if (!p) continue;

        const pos = this._worldToCanvas3D(p.x, p.y, p.z);
        const color = HeatmapRenderer.zToColor(p.z, this.minZ, this.maxZ);

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // Draw axes
    this._drawAxes3D();
  }

  /**
   * Projects world coordinates to canvas coordinates using rotatable 3D projection.
   * @param {number} wx - World X
   * @param {number} wy - World Y
   * @param {number} wz - World Z (will be exaggerated)
   * @returns {{x: number, y: number}}
   */
  _worldToCanvas3D(wx, wy, wz) {
    if (!this.bounds) return { x: 0, y: 0 };

    const rangeX = this.bounds.xMax - this.bounds.xMin || 1;
    const rangeY = this.bounds.yMax - this.bounds.yMin || 1;

    // Normalize and center around origin (-0.5 to 0.5)
    const nx = (wx - this.bounds.xMin) / rangeX - 0.5;
    const ny = (wy - this.bounds.yMin) / rangeY - 0.5;
    const nz = wz * this.zExaggeration / Math.max(rangeX, rangeY);

    // Rotate around Z axis (yaw/spin)
    const cosZ = Math.cos(this.rotationZ);
    const sinZ = Math.sin(this.rotationZ);
    const rx = nx * cosZ - ny * sinZ;
    const ry = nx * sinZ + ny * cosZ;
    const rz = nz;

    // Rotate around X axis (pitch/tilt) for top-down perspective
    const cosX = Math.cos(this.rotationX);
    const sinX = Math.sin(this.rotationX);
    const py = ry * cosX - rz * sinX;
    const pz = ry * sinX + rz * cosX;

    // Perspective projection
    const drawSize = Math.min(this.canvas.width - this.legendWidth - 80, this.canvas.height - 100) * 0.8 * this.zoom;
    const centerX = (this.canvas.width - this.legendWidth) / 2;
    const centerY = this.canvas.height / 2;

    // Camera distance for perspective (larger = less perspective, smaller = more)
    const cameraDistance = 2.5;
    const perspectiveFactor = cameraDistance / (cameraDistance - pz);

    return {
      x: centerX + rx * drawSize * perspectiveFactor,
      y: centerY - py * drawSize * perspectiveFactor
    };
  }

  /**
   * Draws 3D axes indicator and front edge highlight.
   */
  _drawAxes3D() {
    const ctx = this.ctx;
    const ox = 50;
    const oy = this.canvas.height - 50;
    const len = 30;

    // Transform axis directions using current rotation
    const axes = [
      { dir: [1, 0, 0], label: 'X', color: '#ff4444' },
      { dir: [0, 1, 0], label: 'Y', color: '#44ff44' },
      { dir: [0, 0, 1], label: 'Z', color: '#6666ff' }
    ];

    for (const axis of axes) {
      const [dx, dy, dz] = axis.dir;
      const cosZ = Math.cos(this.rotationZ);
      const sinZ = Math.sin(this.rotationZ);
      const rx = dx * cosZ - dy * sinZ;
      const ry = dx * sinZ + dy * cosZ;
      const rz = dz;
      const cosX = Math.cos(this.rotationX);
      const sinX = Math.sin(this.rotationX);
      const py = ry * cosX - rz * sinX;

      const endX = ox + rx * len;
      const endY = oy - py * len;

      ctx.strokeStyle = axis.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      ctx.fillStyle = axis.color;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(axis.label, endX + 3, endY - 3);
    }

    // Draw front edge of the bed (Y=Ymin line) highlighted in yellow
    if (this.bounds) {
      const xMin = this.bounds.xMin;
      const xMax = this.bounds.xMax;
      const yMin = this.bounds.yMin;

      const frontLeft = this._worldToCanvas3D(xMin, yMin, 0);
      const frontRight = this._worldToCanvas3D(xMax, yMin, 0);

      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(frontLeft.x, frontLeft.y);
      ctx.lineTo(frontRight.x, frontRight.y);
      ctx.stroke();

      // Draw other edges in dim white for reference
      const backLeft = this._worldToCanvas3D(xMin, this.bounds.yMax, 0);
      const backRight = this._worldToCanvas3D(xMax, this.bounds.yMax, 0);

      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      // Back edge
      ctx.beginPath();
      ctx.moveTo(backLeft.x, backLeft.y);
      ctx.lineTo(backRight.x, backRight.y);
      ctx.stroke();
      // Left edge
      ctx.beginPath();
      ctx.moveTo(frontLeft.x, frontLeft.y);
      ctx.lineTo(backLeft.x, backLeft.y);
      ctx.stroke();
      // Right edge
      ctx.beginPath();
      ctx.moveTo(frontRight.x, frontRight.y);
      ctx.lineTo(backRight.x, backRight.y);
      ctx.stroke();
    }
  }
}

// Export for Node.js (tests) or attach to window for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HeatmapRenderer };
}
