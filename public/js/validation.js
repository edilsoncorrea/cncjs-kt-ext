/* eslint-env browser */
'use strict';

/**
 * Validates a probing parameter.
 * @param {string} name - Parameter name ('delta', 'height', 'feed', 'margin', 'nProbes')
 * @param {*} value - Value to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateParam(name, value) {
  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (value === '' || value === null || value === undefined) {
    return { valid: false, error: `${name} is required` };
  }

  if (!Number.isFinite(num)) {
    return { valid: false, error: `${name} must be a finite number` };
  }

  switch (name) {
    case 'delta':
      if (num <= 0) return { valid: false, error: 'Delta must be greater than 0' };
      return { valid: true };

    case 'height':
      if (num <= 0) return { valid: false, error: 'Height must be greater than 0' };
      return { valid: true };

    case 'feed':
      if (num <= 0) return { valid: false, error: 'Feed must be greater than 0' };
      return { valid: true };

    case 'margin':
      if (num < 0) return { valid: false, error: 'Margin must be >= 0' };
      return { valid: true };

    case 'nProbes':
      if (!Number.isInteger(num)) return { valid: false, error: 'N Probes must be an integer' };
      if (num < 1 || num > 10) return { valid: false, error: 'N Probes must be between 1 and 10' };
      return { valid: true };

    default:
      return { valid: true };
  }
}

// Export for Node.js (tests) or attach to window for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateParam };
}
