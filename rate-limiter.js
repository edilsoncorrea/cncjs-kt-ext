'use strict';

class RateLimiter {
  constructor(maxRate) {
    this.maxRate = maxRate; // max messages per second
    this.interval = 1000 / maxRate; // minimum ms between messages
    this.lastEmitTime = 0;
  }

  canEmit() {
    const now = Date.now();
    return (now - this.lastEmitTime) >= this.interval;
  }

  recordEmit() {
    this.lastEmitTime = Date.now();
  }
}

module.exports = RateLimiter;
