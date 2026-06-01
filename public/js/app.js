/* eslint-env browser */
'use strict';

/**
 * Main application entry point.
 * Initializes all modules and binds UI events.
 */
(function () {
  // --- Module instances ---
  let heatmap;
  let stats;
  let socketClient;
  let probing = false;
  let gcodeLoaded = false;
  let gcodeFileName = '';

  // --- DOM Elements ---
  const elements = {};

  function initElements() {
    elements.canvas = document.getElementById('heatmap-canvas');
    elements.statusDot = document.getElementById('status-dot');
    elements.connectionText = document.getElementById('connection-text');
    elements.btnStart = document.getElementById('btn-start');
    elements.btnStop = document.getElementById('btn-stop');
    elements.btnReapply = document.getElementById('btn-reapply');
    elements.btnSave = document.getElementById('btn-save');
    elements.btnLoadList = document.getElementById('btn-load-list');
    elements.fileNameInput = document.getElementById('file-name-input');
    elements.fileList = document.getElementById('file-list');
    elements.progressSection = document.getElementById('progress-section');
    elements.progressBar = document.getElementById('progress-bar');
    elements.progressText = document.getElementById('progress-text');
    elements.gridPoints = document.getElementById('grid-points');
    elements.gridTime = document.getElementById('grid-time');
    elements.toast = document.getElementById('toast');
    elements.paramsForm = document.getElementById('params-form');
  }

  // --- Initialization ---
  function init() {
    initElements();

    // Initialize heatmap
    heatmap = new HeatmapRenderer(elements.canvas);
    heatmap.render([]);

    // Initialize stats
    stats = new ProbeStats();

    // Initialize socket client
    socketClient = new SocketClient({
      onConnect: handleConnect,
      onDisconnect: handleDisconnect,
      onInitialState: handleInitialState,
      onProbeStart: handleProbeStart,
      onProbeProgress: handleProbeProgress,
      onProbeComplete: handleProbeComplete,
      onProbeError: handleProbeError,
      onGcodeChanged: handleGcodeChanged,
    });
    socketClient.connect();

    // Bind UI events
    bindEvents();

    // Initial grid calculation
    recalculateGrid();
  }

  // --- Event Binding ---
  function bindEvents() {
    elements.btnStart.addEventListener('click', handleStartClick);
    elements.btnStop.addEventListener('click', handleStopClick);
    elements.btnReapply.addEventListener('click', handleReapplyClick);
    elements.btnSave.addEventListener('click', handleSaveClick);
    elements.btnLoadList.addEventListener('click', handleLoadListClick);
    document.getElementById('btn-simulate').addEventListener('click', handleSimulateClick);

    // Bind form inputs to grid recalculation
    const inputs = elements.paramsForm.querySelectorAll('input[type="number"]');
    inputs.forEach(input => {
      input.addEventListener('input', () => {
        validateField(input);
        recalculateGrid();
        updateButtonStates();
      });
    });

    // Bind probe-only checkbox to button state update
    document.getElementById('param-probeonly').addEventListener('change', () => {
      updateButtonStates();
    });

    // Canvas tooltip
    elements.canvas.addEventListener('mousemove', handleCanvasHover);
    elements.canvas.addEventListener('mouseleave', () => {
      document.getElementById('tooltip').style.display = 'none';
    });
  }

  // --- Validation ---
  function validateField(input) {
    const name = input.name;
    const value = input.value;
    const errorEl = document.getElementById(`error-${name}`);

    if (!value && (name === 'xSize' || name === 'ySize')) {
      // Optional fields
      input.classList.remove('invalid');
      if (errorEl) errorEl.textContent = '';
      return true;
    }

    const result = validateParam(name, value);
    if (!result.valid) {
      input.classList.add('invalid');
      if (errorEl) errorEl.textContent = result.error;
      return false;
    } else {
      input.classList.remove('invalid');
      if (errorEl) errorEl.textContent = '';
      return true;
    }
  }

  function isFormValid() {
    const inputs = elements.paramsForm.querySelectorAll('input[type="number"]');
    let valid = true;
    inputs.forEach(input => {
      if (input.name === 'xSize' || input.name === 'ySize') {
        if (input.value && !validateField(input)) valid = false;
      } else {
        if (!validateField(input)) valid = false;
      }
    });
    return valid;
  }

  // --- Grid Calculation ---
  function recalculateGrid() {
    const params = getFormParams();
    const grid = calculateGrid({
      delta: params.delta,
      margin: params.margin,
      xSize: params.xSize || undefined,
      ySize: params.ySize || undefined,
      height: params.height,
      feed: params.feed,
      nProbes: params.nProbes,
    });

    elements.gridPoints.textContent = `Points: ${grid.count}`;
    elements.gridTime.textContent = `Est. time: ${grid.estimatedTime.toFixed(1)} min`;

    // Draw grid overlay on heatmap if we have bounds
    if (grid.points.length > 0) {
      heatmap.render(heatmap.points);
      heatmap.drawGrid(grid.points, null);
    }
  }

  function getFormParams() {
    return {
      delta: parseFloat(document.getElementById('param-delta').value) || 10,
      height: parseFloat(document.getElementById('param-height').value) || 2,
      feed: parseFloat(document.getElementById('param-feed').value) || 50,
      margin: parseFloat(document.getElementById('param-margin').value) || 0,
      nProbes: parseInt(document.getElementById('param-nprobes').value) || 1,
      xSize: parseFloat(document.getElementById('param-xsize').value) || 0,
      ySize: parseFloat(document.getElementById('param-ysize').value) || 0,
      probeOnly: document.getElementById('param-probeonly').checked,
    };
  }

  // --- Socket Event Handlers ---
  function handleConnect() {
    elements.statusDot.classList.add('connected');
    elements.connectionText.textContent = 'Connected';
  }

  function handleDisconnect() {
    elements.statusDot.classList.remove('connected');
    elements.connectionText.textContent = 'Disconnected';
  }

  function handleInitialState(data) {
    // Fill form with server params
    if (data.params) {
      if (data.params.delta) document.getElementById('param-delta').value = data.params.delta;
      if (data.params.height) document.getElementById('param-height').value = data.params.height;
      if (data.params.feed) document.getElementById('param-feed').value = data.params.feed;
      if (data.params.nProbes) document.getElementById('param-nprobes').value = data.params.nProbes;
    }

    // Load existing probe data
    if (data.probeData && data.probeData.points && data.probeData.points.length > 0) {
      heatmap.render(data.probeData.points);
      stats.fromArray(data.probeData.points.map(p => p.z));
      updateStatsUI();
    }

    // Update gcode info
    if (data.gcodeInfo) {
      gcodeLoaded = data.gcodeInfo.loaded;
      gcodeFileName = data.gcodeInfo.fileName || '';
    }

    // Update probing state
    if (data.probing && data.probing.active) {
      setProbingState(true);
    }

    updateButtonStates();
    recalculateGrid();
  }

  function handleProbeStart(data) {
    setProbingState(true);
    stats.reset();
    heatmap.render([]);
    elements.progressBar.style.width = '0%';
    elements.progressText.textContent = `0 / ${data.totalPoints}`;
  }

  function handleProbeProgress(data) {
    // Add point to heatmap
    heatmap.addPoint({ x: data.x, y: data.y, z: data.z });

    // Update stats
    stats.addPoint(data.z);
    updateStatsUI();

    // Update progress
    const pct = (data.index / data.total * 100).toFixed(0);
    elements.progressBar.style.width = `${pct}%`;
    elements.progressText.textContent = `${data.index} / ${data.total}`;
  }

  function handleProbeComplete(data) {
    setProbingState(false);

    // Update stats from final data
    if (data.minZ !== undefined) {
      document.getElementById('stat-minz').textContent = data.minZ.toFixed(3);
      document.getElementById('stat-maxz').textContent = data.maxZ.toFixed(3);
      document.getElementById('stat-avgz').textContent = data.avgZ.toFixed(3);
      document.getElementById('stat-count').textContent = data.count;
    }

    showToast('Probing complete!', 'success');
  }

  function handleProbeError(data) {
    setProbingState(false);
    showToast(`Probe error: ${data.message}`, 'error');
  }

  function handleGcodeChanged(data) {
    gcodeLoaded = data.loaded;
    gcodeFileName = data.fileName || '';
    updateButtonStates();
  }

  // --- UI State ---
  function setProbingState(active) {
    probing = active;
    elements.progressSection.style.display = active ? 'block' : 'none';
    updateButtonStates();
  }

  function updateButtonStates() {
    const probeOnly = document.getElementById('param-probeonly').checked;
    const canStart = !probing && (gcodeLoaded || probeOnly) && isFormValid();

    elements.btnStart.disabled = !canStart;
    elements.btnStop.disabled = !probing;
    elements.btnReapply.disabled = probing;
  }

  // --- Button Handlers ---
  function handleStartClick() {
    if (!isFormValid()) return;

    const params = getFormParams();
    socketClient.startProbe({
      delta: params.delta,
      height: params.height,
      feed: params.feed,
      margin: params.margin,
      N: params.nProbes,
      xSize: params.xSize || undefined,
      ySize: params.ySize || undefined,
      probeOnly: params.probeOnly,
    });
  }

  function handleStopClick() {
    socketClient.stopProbe();
    setProbingState(false);
  }

  function handleReapplyClick() {
    socketClient.reapply();
    showToast('Re-applying compensation...', 'success');
  }

  function handleSimulateClick() {
    const params = getFormParams();
    socketClient.simulate({
      delta: params.delta,
      height: params.height,
      feed: params.feed,
      margin: params.margin,
      N: params.nProbes,
      xSize: params.xSize || 50,
      ySize: params.ySize || 50,
    });
    showToast('Starting simulation...', 'success');
  }

  async function handleSaveClick() {
    const filename = elements.fileNameInput.value.trim();
    if (!filename) {
      showToast('Please enter a filename', 'error');
      return;
    }

    // Ensure .txt extension
    const name = filename.endsWith('.txt') || filename.endsWith('.probe') ? filename : filename + '.txt';

    try {
      const res = await fetch(`/api/probes/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Saved ${data.pointCount} points to ${name}`, 'success');
        elements.fileNameInput.value = '';
      } else {
        showToast(data.error || 'Save failed', 'error');
      }
    } catch (err) {
      showToast(`Save error: ${err.message}`, 'error');
    }
  }

  async function handleLoadListClick() {
    try {
      const res = await fetch('/api/probes');
      const data = await res.json();
      renderFileList(data.files || []);
    } catch (err) {
      showToast(`Failed to list files: ${err.message}`, 'error');
    }
  }

  // --- File List ---
  function renderFileList(files) {
    elements.fileList.innerHTML = '';
    if (files.length === 0) {
      elements.fileList.innerHTML = '<li>No probe files found</li>';
      return;
    }

    for (const file of files) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="file-name">${file.filename}</span>
        <span class="file-actions">
          <button class="btn-load" data-file="${file.filename}">Load</button>
          <button class="btn-delete" data-file="${file.filename}">Del</button>
        </span>
      `;
      elements.fileList.appendChild(li);
    }

    // Bind load/delete buttons
    elements.fileList.querySelectorAll('.btn-load').forEach(btn => {
      btn.addEventListener('click', () => loadFile(btn.dataset.file));
    });
    elements.fileList.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteFile(btn.dataset.file));
    });
  }

  async function loadFile(filename) {
    try {
      const res = await fetch(`/api/probes/${encodeURIComponent(filename)}`);
      const data = await res.json();
      if (res.ok) {
        heatmap.render(data.points);
        stats.fromArray(data.points.map(p => p.z));
        updateStatsUI();
        showToast(`Loaded ${data.points.length} points from ${filename}`, 'success');
      } else {
        showToast(data.error || 'Load failed', 'error');
      }
    } catch (err) {
      showToast(`Load error: ${err.message}`, 'error');
    }
  }

  async function deleteFile(filename) {
    if (!confirm(`Delete ${filename}?`)) return;

    try {
      const res = await fetch(`/api/probes/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        showToast(`Deleted ${filename}`, 'success');
        handleLoadListClick(); // Refresh list
      } else {
        showToast(data.error || 'Delete failed', 'error');
      }
    } catch (err) {
      showToast(`Delete error: ${err.message}`, 'error');
    }
  }

  // --- Stats UI ---
  function updateStatsUI() {
    const s = stats.getStats();
    document.getElementById('stat-minz').textContent = s.minZ.toFixed(3);
    document.getElementById('stat-maxz').textContent = s.maxZ.toFixed(3);
    document.getElementById('stat-avgz').textContent = s.avgZ.toFixed(3);
    document.getElementById('stat-stddev').textContent = s.stddev.toFixed(3);
    document.getElementById('stat-count').textContent = s.count;

    const amplitude = s.maxZ - s.minZ;
    const ampEl = document.getElementById('stat-amplitude');
    ampEl.textContent = amplitude.toFixed(3);
    ampEl.className = 'stat-value color-' + ProbeStats.amplitudeColor(amplitude);
  }

  // --- Canvas Tooltip ---
  function handleCanvasHover(e) {
    const rect = elements.canvas.getBoundingClientRect();
    const scaleX = elements.canvas.width / rect.width;
    const scaleY = elements.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const point = heatmap.hitTest(x, y);
    const tooltip = document.getElementById('tooltip');

    if (point) {
      tooltip.textContent = `X: ${point.x.toFixed(3)}  Y: ${point.y.toFixed(3)}  Z: ${point.z.toFixed(3)}`;
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
      tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
    } else {
      tooltip.style.display = 'none';
    }
  }

  // --- Toast ---
  function showToast(message, type) {
    const toast = elements.toast;
    toast.textContent = message;
    toast.className = 'toast ' + (type || '');
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
  }

  // --- Start ---
  document.addEventListener('DOMContentLoaded', init);
})();
