'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const compression = require('compression');
const path = require('path');
const RateLimiter = require('./rate-limiter.js');
const { registerWidgetAPI } = require('./widget-api.js');

class WidgetServer {
  constructor(autolevel, options = {}) {
    this.autolevel = autolevel;
    this.port = options.port || 8190;
    this.app = null;
    this.server = null;
    this.io = null;
    this.rateLimiter = new RateLimiter(10); // max 10 msgs/sec
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
      }
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
        let cmd = '#autolevel';
        if (params.delta) cmd += ` D${params.delta}`;
        if (params.height) cmd += ` H${params.height}`;
        if (params.feed) cmd += ` F${params.feed}`;
        if (params.margin !== undefined) cmd += ` M${params.margin}`;
        if (params.N && params.N > 1) cmd += ` N${params.N}`;
        if (params.xSize) cmd += ` X${params.xSize}`;
        if (params.ySize) cmd += ` Y${params.ySize}`;
        if (params.probeOnly) cmd += ' P1';
        // Execute through the existing macro path
        this.autolevel.sckw.sendGcode(`(${cmd})`);
      });

      socket.on('stop-probe', () => {
        this.autolevel.sckw.stopGcode();
      });

      socket.on('reapply', () => {
        this.autolevel.reapply('#autolevel_reapply', {});
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
}

module.exports = WidgetServer;
