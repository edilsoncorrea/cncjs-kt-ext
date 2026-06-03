/* eslint-env browser */
'use strict';

/**
 * WebSocket client wrapper for the widget server.
 */
class SocketClient {
  constructor(callbacks = {}) {
    this.socket = null;
    this.callbacks = callbacks;
    this.connected = false;
    this.reconnectInterval = 3000;
    this.reconnectTimer = null;
  }

  /**
   * Connect to the widget server socket.io.
   */
  connect() {
    if (typeof io === 'undefined') {
      console.error('socket.io client not loaded');
      return;
    }

    this.socket = io({
      reconnection: true,
      reconnectionDelay: this.reconnectInterval,
      reconnectionAttempts: Infinity,
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      this.connected = true;
      if (this.callbacks.onConnect) this.callbacks.onConnect();
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
    });

    this.socket.on('initial-state', (data) => {
      if (this.callbacks.onInitialState) this.callbacks.onInitialState(data);
    });

    this.socket.on('probe-start', (data) => {
      if (this.callbacks.onProbeStart) this.callbacks.onProbeStart(data);
    });

    this.socket.on('probe-progress', (data) => {
      if (this.callbacks.onProbeProgress) this.callbacks.onProbeProgress(data);
    });

    this.socket.on('probe-complete', (data) => {
      if (this.callbacks.onProbeComplete) this.callbacks.onProbeComplete(data);
    });

    this.socket.on('probe-error', (data) => {
      if (this.callbacks.onProbeError) this.callbacks.onProbeError(data);
    });

    this.socket.on('gcode-changed', (data) => {
      if (this.callbacks.onGcodeChanged) this.callbacks.onGcodeChanged(data);
    });

    this.socket.on('state-changed', (data) => {
      if (this.callbacks.onStateChanged) this.callbacks.onStateChanged(data);
    });
  }

  /**
   * Start probing with given parameters.
   * @param {object} params
   */
  startProbe(params) {
    if (this.socket) {
      this.socket.emit('start-probe', params);
    }
  }

  /**
   * Stop current probing.
   */
  stopProbe() {
    if (this.socket) {
      this.socket.emit('stop-probe');
    }
  }

  /**
   * Re-apply compensation.
   */
  reapply() {
    if (this.socket) {
      this.socket.emit('reapply');
    }
  }

  /**
   * Start simulation with given parameters.
   * @param {object} params
   */
  simulate(params) {
    if (this.socket) {
      this.socket.emit('simulate-probe', params);
    }
  }

  /**
   * Save configuration to server.
   * @param {object} config
   */
  saveConfig(config) {
    if (this.socket) {
      this.socket.emit('save-config', config);
    }
  }

  /**
   * Request current state from server.
   */
  getState() {
    if (this.socket) {
      this.socket.emit('get-state');
    }
  }

  /**
   * Disconnect from server.
   */
  disconnect() {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
  }
}

// Export for Node.js (tests) or attach to window for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SocketClient };
}
