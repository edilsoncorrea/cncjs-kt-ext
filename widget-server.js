'use strict';
const express = require('express');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const compression = require('compression');
const path = require('path');
const RateLimiter = require('./rate-limiter.js');
const { registerWidgetAPI } = require('./widget-api.js');

const CONFIG_FILE = '__autolevel_config.json';

class WidgetServer {
  constructor(autolevel, options = {}) {
    this.autolevel = autolevel;
    this.port = options.port || 8190;
    this.app = null;
    this.server = null;
    this.io = null;
    this.rateLimiter = new RateLimiter(10); // max 10 msgs/sec
    this.savedConfig = this._loadConfig();
  }

  _loadConfig() {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const config = JSON.parse(data);
      console.log('Widget: loaded saved config from ' + CONFIG_FILE);
      return config;
    } catch (err) {
      return null;
    }
  }

  _saveConfig(config) {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
      console.log('Widget: config saved to ' + CONFIG_FILE);
    } catch (err) {
      console.log('Widget: failed to save config: ' + err.message);
    }
  }

  start() {
    this.app = express();
    this.app.use(compression());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Register REST API endpoints
    registerWidgetAPI(this.app, this.autolevel, process.cwd());

    this.server = http.createServer(this.app);
    this.io = new Server(this.server, { cors: { origin: '*' } });

    this._bindAutolevelEvents();
    this._setupSocketHandlers();

    try {
      this.server.listen(this.port, () => {
        console.log(`Widget server running on http://localhost:${this.port}`);
      });
      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`Widget server: port ${this.port} already in use. Widget disabled.`);
        } else {
          console.error(`Widget server error: ${err.message}`);
        }
      });
    } catch (err) {
      console.error(`Widget server failed to start: ${err.message}`);
    }
  }

  stop() {
    if (this.io) this.io.close();
    if (this.server) this.server.close();
  }

  _getState() {
    return {
      params: {
        delta: this.autolevel.delta,
        height: this.autolevel.height,
        feed: this.autolevel.feed,
        feedZ: this.autolevel.feedUp || null,
        feedXY: this.autolevel.feedXY || null,
        nProbes: this.autolevel.probesPerPoint,
      },
      probeData: {
        points: this.autolevel.probedPoints,
      },
      gcodeInfo: {
        loaded: !!this.autolevel.gcode,
        fileName: this.autolevel.gcodeFileName,
      },
      probing: {
        active: this.autolevel.planedPointCount > 0,
      },
      savedConfig: this.savedConfig
    };
  }

  _bindAutolevelEvents() {
    this.autolevel.events.on('probe:start', (data) => {
      this._broadcastToClients('probe-start', data);
    });
    this.autolevel.events.on('probe:point', (data) => {
      if (this.rateLimiter.canEmit()) {
        this.rateLimiter.recordEmit();
        this._broadcastToClients('probe-progress', { ...data, timestamp: Date.now() });
      }
    });
    this.autolevel.events.on('probe:complete', (data) => {
      this._broadcastToClients('probe-complete', data);
    });
    this.autolevel.events.on('probe:error', (data) => {
      this._broadcastToClients('probe-error', data);
    });
    this.autolevel.events.on('gcode:changed', (data) => {
      this._broadcastToClients('gcode-changed', data);
    });
  }

  _setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('Widget client connected');
      socket.emit('initial-state', this._getState());

      socket.on('start-probe', (params) => {
        let cmd = '(#autolevel';
        if (params.delta) cmd += ` D${params.delta}`;
        if (params.height) cmd += ` H${params.height}`;
        if (params.feed) cmd += ` F${params.feed}`;
        if (params.feedZ) cmd += ` FZ${params.feedZ}`;
        if (params.feedXY) cmd += ` FXY${params.feedXY}`;
        if (params.margin !== undefined) cmd += ` M${params.margin}`;
        if (params.N && params.N > 1) cmd += ` N${params.N}`;
        if (params.xSize) cmd += ` X${params.xSize}`;
        if (params.ySize) cmd += ` Y${params.ySize}`;
        if (params.probeOnly) cmd += ' P1';
        cmd += ')';
        console.log('Widget: starting probe with command:', cmd);
        // Call autolevel.start() directly with a synthetic context
        // The context needs position and gcode bounds
        const context = {
          source: 'feeder',
          mposx: 0, mposy: 0, mposz: this.autolevel.height || 2,
          posx: 0, posy: 0, posz: this.autolevel.height || 2,
          xmin: 0, xmax: params.xSize || 50,
          ymin: 0, ymax: params.ySize || 50
        };
        this.autolevel.start(cmd, context);
      });

      socket.on('stop-probe', () => {
        this.autolevel.sckw.stopGcode();
      });

      socket.on('reapply', () => {
        this.autolevel.reapply('#autolevel_reapply', {});
      });

      socket.on('simulate-probe', (params) => {
        console.log('Widget: starting SIMULATION with params:', params);
        this._runSimulation(params);
      });

      socket.on('save-config', (config) => {
        this.savedConfig = config;
        this._saveConfig(config);
      });

      socket.on('get-state', () => {
        socket.emit('initial-state', this._getState());
      });

      socket.on('disconnect', () => {
        console.log('Widget client disconnected');
      });
    });
  }

  _broadcastToClients(event, data) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  /**
   * Simulates a probing session with realistic Z data.
   * Generates a surface with slight curvature (like a real PCB).
   */
  _runSimulation(params) {
    const delta = params.delta || 10;
    const margin = params.margin || delta / 4;
    const xSize = params.xSize || 50;
    const ySize = params.ySize || 50;

    const xmin = margin;
    const xmax = xSize - margin;
    const ymin = margin;
    const ymax = ySize - margin;

    const nx = Math.max(1, Math.ceil((xmax - xmin) / delta));
    const ny = Math.max(1, Math.ceil((ymax - ymin) / delta));
    const dx = (xmax - xmin) / nx;
    const dy = (ymax - ymin) / ny;

    // Generate grid points
    const points = [];
    for (let iy = 0; iy <= ny; iy++) {
      for (let ix = 0; ix <= nx; ix++) {
        const x = xmin + ix * dx;
        const y = ymin + iy * dy;
        points.push({ x, y });
      }
    }

    const totalPoints = points.length;

    // Emit probe:start
    this._broadcastToClients('probe-start', { totalPoints, params });

    // Reset autolevel probe data for simulation
    this.autolevel.probedPoints = [];
    this.autolevel.min_dz = 0;
    this.autolevel.max_dz = 0;
    this.autolevel.sum_dz = 0;

    // Simulate points one by one with delay
    let index = 0;
    const interval = setInterval(() => {
      if (index >= totalPoints) {
        clearInterval(interval);
        // Emit completion
        const count = this.autolevel.probedPoints.length;
        const avgZ = count > 0 ? this.autolevel.sum_dz / count : 0;
        this._broadcastToClients('probe-complete', {
          minZ: this.autolevel.min_dz,
          maxZ: this.autolevel.max_dz,
          avgZ: avgZ,
          stddev: 0,
          count: count,
          success: true
        });
        console.log(`Simulation complete: ${count} points`);
        return;
      }

      const pt = points[index];
      // Generate realistic Z: slight bowl shape + random noise
      // z = a*(x-cx)^2 + b*(y-cy)^2 + noise
      const cx = (xmin + xmax) / 2;
      const cy = (ymin + ymax) / 2;
      const a = 0.0003; // curvature coefficient
      const b = 0.0002;
      const noise = (Math.random() - 0.5) * 0.02; // ±0.01mm noise
      const z = a * (pt.x - cx) * (pt.x - cx) + b * (pt.y - cy) * (pt.y - cy) + noise - 0.05;

      const probedPt = { x: pt.x, y: pt.y, z: parseFloat(z.toFixed(3)) };

      // Update autolevel state
      if (this.autolevel.probedPoints.length === 0) {
        this.autolevel.min_dz = probedPt.z;
        this.autolevel.max_dz = probedPt.z;
        this.autolevel.sum_dz = probedPt.z;
      } else {
        if (probedPt.z < this.autolevel.min_dz) this.autolevel.min_dz = probedPt.z;
        if (probedPt.z > this.autolevel.max_dz) this.autolevel.max_dz = probedPt.z;
        this.autolevel.sum_dz += probedPt.z;
      }
      this.autolevel.probedPoints.push(probedPt);

      index++;

      // Emit progress
      this._broadcastToClients('probe-progress', {
        index: index,
        total: totalPoints,
        x: probedPt.x,
        y: probedPt.y,
        z: probedPt.z,
        timestamp: Date.now()
      });

    }, 200); // 200ms between points (simulates ~5 points/sec)
  }
}

module.exports = WidgetServer;
