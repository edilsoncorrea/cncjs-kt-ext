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
    this._drawBackground();
    this._drawPoints();
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
    this._drawBackground();
    this._drawPoints();
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

    const drawWidth = this.canvas.width - this.padding * 2 - this.legendWidth - 20;
    const drawHeight = this.canvas.height - this.padding * 2;

    const rangeX = this.bounds.xMax - this.bounds.xMin || 1;
    const rangeY = this.bounds.yMax - this.bounds.yMin || 1;

    const x = this.padding + ((wx - this.bounds.xMin) / rangeX) * drawWidth;
    // Flip Y so that Y increases upward
    const y = this.padding + drawHeight - ((wy - this.bounds.yMin) / rangeY) * drawHeight;

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
}

// Export for Node.js (tests) or attach to window for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HeatmapRenderer };
}
