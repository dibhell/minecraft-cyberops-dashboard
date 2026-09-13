/**
 * GRZYBKOWO CYBER-OPS // CLIENT ENGINE
 * Real-time telemetry, RCON interactive terminal, File Matrix, Audio synth
 */

// Sound synthesizer using Web Audio API
let audioCtx = null;
let sfxEnabled = true;

function initAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
}

function playCyberSound(type = 'click') {
  if (!sfxEnabled) return;
  try {
    initAudio();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'click') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.04);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.04);
      osc.start(now);
      osc.stop(now + 0.04);
    } else if (type === 'success') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(659, now + 0.06);
      osc.frequency.setValueAtTime(880, now + 0.12);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === 'alert') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.setValueAtTime(180, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    } else if (type === 'chat') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.08); // A5
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (e) {
    // Ignore audio autoplay restrictions
  }
}

// State
let currentPath = '.';
let autoScrollEnabled = true;
let commandHistory = [];
let historyIndex = -1;
let lastLogLines = [];
let pendingConfirmAction = null;
let tacticalPlayers = [];
let tacticalMobs = [];
let tacticalCenter = { x: 0, z: 0 };
let tacticalRange = 512;
let tacticalPolling = false;
let terrainLayer = null;
let terrainKey = '';
let terrainPolling = false;
let terrainTimer = null;
let mapDrag = null;
let mapWasDragged = false;

// Clock
function updateClock() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${ms}`;
  const clockEl = document.getElementById('cyberClock');
  if (clockEl) clockEl.textContent = timeStr;
}
setInterval(updateClock, 30);

// Toast
function showToast(msg, duration = 3000) {
  const toast = document.getElementById('cyberToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// CRT & SFX Toggles
document.getElementById('toggleCrtBtn')?.addEventListener('click', function() {
  document.body.classList.toggle('crt-scanlines');
  const active = document.body.classList.contains('crt-scanlines');
  this.textContent = active ? 'CRT [ON]' : 'CRT [OFF]';
  this.classList.toggle('active', active);
  playCyberSound('click');
});

document.getElementById('toggleSfxBtn')?.addEventListener('click', function() {
  sfxEnabled = !sfxEnabled;
  this.textContent = sfxEnabled ? 'SFX [ON]' : 'SFX [OFF]';
  this.classList.toggle('active', sfxEnabled);
  if (sfxEnabled) playCyberSound('success');
});

// Tab Switcher
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    playCyberSound('click');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    
    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    document.getElementById(tabId)?.classList.add('active');

    if (tabId === 'tab-chat') {
      unreadChatCount = 0;
      updateUnreadChatBadge();
      pollChat();
    }
    if (tabId === 'tab-files') browsePath(currentPath);
    if (tabId === 'tab-mods') loadModsList();
    if (tabId === 'tab-tactical') pollTactical();
  });
});

// Tactical map and controlled mob spawning
async function pollTactical() {
  if (tacticalPolling || !document.getElementById('tab-tactical')?.classList.contains('active')) return;
  tacticalPolling = true;
  try {
    const dimension = document.getElementById('spawnDimension')?.value || 'minecraft:overworld';
    const res = await fetch(`/api/tactical?dimension=${encodeURIComponent(dimension)}`);
    const data = await res.json();
    tacticalPlayers = data.players || [];
    tacticalMobs = data.mobs || [];
    centerTacticalMap(false);
    renderTacticalPlayers();
    pollTerrain();
  } catch (err) {
    document.getElementById('mapStatus').textContent = `BŁĄD MAPY: ${err.message}`;
  } finally {
    tacticalPolling = false;
  }
}

function visibleTacticalPlayers() {
  const dimension = document.getElementById('spawnDimension')?.value || 'minecraft:overworld';
  return tacticalPlayers.filter(player => player.dimension === dimension);
}

function centerTacticalMap(force = true) {
  const players = visibleTacticalPlayers();
  if (players.length && (force || tacticalCenter.x === 0 && tacticalCenter.z === 0)) {
    tacticalCenter.x = players.reduce((sum, player) => sum + player.x, 0) / players.length;
    tacticalCenter.z = players.reduce((sum, player) => sum + player.z, 0) / players.length;
  }
  drawTacticalMap();
  if (force) scheduleTerrain();
}

function zoomTacticalMap(factor) {
  tacticalRange = Math.max(64, Math.min(60000000, tacticalRange * factor));
  drawTacticalMap();
  scheduleTerrain();
}

function fitTacticalMap() {
  const points = [...visibleTacticalPlayers(), ...tacticalMobs];
  if (!points.length) return;
  const canvas = document.getElementById('tacticalMap');
  const xs = points.map(point => point.x), zs = points.map(point => point.z);
  tacticalCenter = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
  const width = Math.max(...xs) - Math.min(...xs);
  const depth = (Math.max(...zs) - Math.min(...zs)) * canvas.width / canvas.height;
  tacticalRange = Math.max(64, Math.min(60000000, Math.max(width, depth) * 1.25 + 64));
  drawTacticalMap();
  scheduleTerrain();
}

function scheduleTerrain() {
  clearTimeout(terrainTimer);
  terrainTimer = setTimeout(() => pollTerrain(), 250);
}

async function pollTerrain(force = false) {
  if (terrainPolling || !document.getElementById('tab-tactical')?.classList.contains('active')) return;
  const dimension = document.getElementById('spawnDimension')?.value || 'minecraft:overworld';
  const span = Math.min(32768, Math.round(tacticalRange));
  const x = Math.round(tacticalCenter.x), z = Math.round(tacticalCenter.z);
  const key = `${dimension}:${x}:${z}:${span}`;
  if (!force && key === terrainKey) return;
  if (key !== terrainKey) terrainLayer = null;
  terrainPolling = true;
  drawTacticalMap();
  try {
    const res = await fetch(`/api/terrain?dimension=${encodeURIComponent(dimension)}&x=${x}&z=${z}&span=${span}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    terrainLayer = await res.json();
    terrainKey = key;
  } catch (err) {
    showToast(`Błąd renderowania terenu: ${err.message}`);
  } finally {
    terrainPolling = false;
    drawTacticalMap();
  }
}

function terrainColor(height, kind, shade) {
  if (kind === 'w') return `hsl(205 70% ${Math.max(20, 38 + shade)}%)`;
  if (kind === 'f') return `hsl(125 48% ${Math.max(17, 30 + shade)}%)`;
  if (height < 64) return `hsl(48 42% ${Math.max(24, 42 + shade)}%)`;
  if (height < 100) return `hsl(88 38% ${Math.max(20, 36 + shade)}%)`;
  if (height < 150) return `hsl(34 28% ${Math.max(24, 40 + shade)}%)`;
  return `hsl(0 0% ${Math.min(88, 58 + shade)}%)`;
}

function drawTacticalMap() {
  const canvas = document.getElementById('tacticalMap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const scale = canvas.width / tacticalRange;
  const toX = x => canvas.width / 2 + (x - tacticalCenter.x) * scale;
  const toY = z => canvas.height / 2 + (z - tacticalCenter.z) * scale;
  ctx.fillStyle = '#020507';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (terrainLayer) {
    const cell = terrainLayer.span / terrainLayer.size;
    const cellPixels = cell * scale + 1;
    for (let row = 0; row < terrainLayer.size; row++) {
      for (let column = 0; column < terrainLayer.size; column++) {
        const index = row * terrainLayer.size + column;
        const height = terrainLayer.heights[index];
        if (height === null) continue;
        const left = terrainLayer.heights[index - (column > 0 ? 1 : 0)] ?? height;
        const up = terrainLayer.heights[index - (row > 0 ? terrainLayer.size : 0)] ?? height;
        const shade = Math.max(-12, Math.min(12, (height - left + height - up) * 2));
        ctx.fillStyle = terrainColor(height, terrainLayer.kinds[index], shade);
        const worldX = terrainLayer.center_x - terrainLayer.span / 2 + column * cell;
        const worldZ = terrainLayer.center_z - terrainLayer.span / 2 + row * cell;
        ctx.fillRect(toX(worldX), toY(worldZ), cellPixels, cellPixels);
      }
    }
  }

  let step = 16;
  while (step * scale < 55) step *= 2;
  ctx.strokeStyle = 'rgba(0, 240, 255, .16)';
  ctx.fillStyle = '#7189a5';
  ctx.font = '12px Consolas';
  const left = tacticalCenter.x - canvas.width / 2 / scale;
  const top = tacticalCenter.z - canvas.height / 2 / scale;
  for (let x = Math.floor(left / step) * step; x <= left + tacticalRange; x += step) {
    const px = toX(x);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, canvas.height); ctx.stroke();
    ctx.fillText(`X ${x}`, px + 4, 14);
  }
  for (let z = Math.floor(top / step) * step; z <= top + canvas.height / scale; z += step) {
    const py = toY(z);
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(canvas.width, py); ctx.stroke();
    ctx.fillText(`Z ${z}`, 4, py - 4);
  }

  for (const player of visibleTacticalPlayers()) {
    const px = toX(player.x), py = toY(player.z);
    ctx.fillStyle = '#00ff88';
    ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${player.name}  Y:${Math.round(player.y)}`, px + 11, py + 4);
  }

  for (const mob of tacticalMobs) {
    const px = toX(mob.x), py = toY(mob.z);
    ctx.fillStyle = '#ff2a5f';
    ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(px, py, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${mob.name || 'MOB'} #${mob.id}  Y:${Math.round(mob.y)}`, px + 18, py + 4);
  }

  const x = Number(document.getElementById('spawnX')?.value);
  const z = Number(document.getElementById('spawnZ')?.value);
  if (Number.isFinite(x) && Number.isFinite(z)) {
    const px = toX(x), py = toY(z);
    ctx.strokeStyle = '#ffb800'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px - 10, py); ctx.lineTo(px + 10, py); ctx.moveTo(px, py - 10); ctx.lineTo(px, py + 10); ctx.stroke();
    ctx.lineWidth = 1;
  }
  const terrainStatus = terrainPolling ? 'TEREN: ŁADOWANIE' : (terrainLayer ? (terrainLayer.span < tacticalRange ? 'TEREN: CZĘŚCIOWY' : 'TEREN: OK') : 'TEREN: BRAK');
  document.getElementById('mapStatus').textContent = `${visibleTacticalPlayers().length} GRACZY // ${tacticalMobs.length} MOBÓW // ${terrainStatus} // X:${Math.round(tacticalCenter.x)} Z:${Math.round(tacticalCenter.z)} // ZASIĘG ${tacticalRange}`;
}

function tacticalPoint(event) {
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  return {
    px: (event.clientX - rect.left) * canvas.width / rect.width,
    py: (event.clientY - rect.top) * canvas.height / rect.height
  };
}

function terrainHeightAt(x, z) {
  if (!terrainLayer) return null;
  const cell = terrainLayer.span / terrainLayer.size;
  const column = Math.floor((x - (terrainLayer.center_x - terrainLayer.span / 2)) / cell);
  const row = Math.floor((z - (terrainLayer.center_z - terrainLayer.span / 2)) / cell);
  if (column < 0 || row < 0 || column >= terrainLayer.size || row >= terrainLayer.size) return null;
  return terrainLayer.heights[row * terrainLayer.size + column];
}

const tacticalMap = document.getElementById('tacticalMap');
tacticalMap?.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const point = tacticalPoint(event);
  mapDrag = { ...point, centerX: tacticalCenter.x, centerZ: tacticalCenter.z };
  mapWasDragged = false;
  tacticalMap.setPointerCapture(event.pointerId);
  tacticalMap.classList.add('dragging');
});

tacticalMap?.addEventListener('pointermove', event => {
  const point = tacticalPoint(event);
  const scale = tacticalMap.width / tacticalRange;
  const worldX = tacticalCenter.x + (point.px - tacticalMap.width / 2) / scale;
  const worldZ = tacticalCenter.z + (point.py - tacticalMap.height / 2) / scale;
  const height = terrainHeightAt(worldX, worldZ);
  document.getElementById('mapCursor').textContent = `X: ${Math.round(worldX)} // Y: ${height ?? '—'} // Z: ${Math.round(worldZ)}`;
  if (!mapDrag) return;
  const dx = point.px - mapDrag.px, dy = point.py - mapDrag.py;
  mapWasDragged ||= Math.abs(dx) + Math.abs(dy) > 4;
  tacticalCenter = { x: mapDrag.centerX - dx / scale, z: mapDrag.centerZ - dy / scale };
  drawTacticalMap();
});

tacticalMap?.addEventListener('pointerup', event => {
  if (!mapDrag) return;
  mapDrag = null;
  tacticalMap.releasePointerCapture(event.pointerId);
  tacticalMap.classList.remove('dragging');
  if (mapWasDragged) scheduleTerrain();
});

tacticalMap?.addEventListener('wheel', event => {
  event.preventDefault();
  const point = tacticalPoint(event);
  const oldScale = tacticalMap.width / tacticalRange;
  const worldX = tacticalCenter.x + (point.px - tacticalMap.width / 2) / oldScale;
  const worldZ = tacticalCenter.z + (point.py - tacticalMap.height / 2) / oldScale;
  tacticalRange = Math.max(64, Math.min(60000000, tacticalRange * (event.deltaY > 0 ? 1.35 : 0.74)));
  const newScale = tacticalMap.width / tacticalRange;
  tacticalCenter = { x: worldX - (point.px - tacticalMap.width / 2) / newScale, z: worldZ - (point.py - tacticalMap.height / 2) / newScale };
  drawTacticalMap();
  scheduleTerrain();
}, { passive: false });

tacticalMap?.addEventListener('click', event => {
  if (mapWasDragged) {
    mapWasDragged = false;
    return;
  }
  const { px, py } = tacticalPoint(event);
  document.getElementById('spawnX').value = Math.round(tacticalCenter.x + (px - tacticalMap.width / 2) * tacticalRange / tacticalMap.width);
  document.getElementById('spawnZ').value = Math.round(tacticalCenter.z + (py - tacticalMap.height / 2) * tacticalRange / tacticalMap.width);
  drawTacticalMap();
});

function renderTacticalPlayers() {
  const target = document.getElementById('tacticalPlayers');
  if (!target) return;
  target.innerHTML = '<span class="section-desc">GRACZE</span>' + (visibleTacticalPlayers().map(player =>
    `<button class="cyber-btn-mini tactical-player" type="button" onclick="selectPlayerPosition('${escapeHtml(player.name)}')">● ${escapeHtml(player.name)} — X:${Math.round(player.x)} Y:${Math.round(player.y)} Z:${Math.round(player.z)}</button>`
  ).join('') || '<span class="section-desc">Brak graczy w tym wymiarze.</span>');
  const mobs = document.getElementById('tacticalMobsList');
  if (mobs) {
    mobs.innerHTML = '<span class="section-desc">ŚLEDZONE MOBY</span>' + (tacticalMobs.map(mob =>
      `<button class="cyber-btn-mini tactical-player" type="button" onclick="selectMobPosition(${mob.id})">● ${escapeHtml(mob.name || 'MOB')} — X:${Math.round(mob.x)} Y:${Math.round(mob.y)} Z:${Math.round(mob.z)}</button>`
    ).join('') || '<span class="section-desc">Brak śledzonych mobów.</span>');
  }
}

function selectPlayerPosition(name) {
  const player = tacticalPlayers.find(item => item.name === name);
  if (!player) return;
  document.getElementById('spawnDimension').value = player.dimension;
  document.getElementById('spawnX').value = Math.round(player.x);
  document.getElementById('spawnZ').value = Math.round(player.z);
  tacticalCenter = { x: player.x, z: player.z };
  renderTacticalPlayers();
  drawTacticalMap();
}

function selectMobPosition(id) {
  const mob = tacticalMobs.find(item => item.id === id);
  if (!mob) return;
  tacticalCenter = { x: mob.x, z: mob.z };
  document.getElementById('spawnX').value = Math.round(mob.x);
  document.getElementById('spawnZ').value = Math.round(mob.z);
  drawTacticalMap();
  scheduleTerrain();
}

function spawnMob(event) {
  event.preventDefault();
  const payload = {
    entity: document.getElementById('spawnEntity').value.trim(),
    dimension: document.getElementById('spawnDimension').value,
    x: document.getElementById('spawnX').value,
    z: document.getElementById('spawnZ').value,
    y: document.getElementById('spawnY').value,
    count: document.getElementById('spawnCount').value
  };
  openConfirmModal('RESP MOBÓW', `Zrespić ${payload.count} × ${payload.entity} przy X:${payload.x} Z:${payload.z}?`, () => executeMobSpawn(payload));
}

async function executeMobSpawn(payload) {
  closeConfirmModal();
  try {
    const res = await fetch('/api/tactical/spawn', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await res.json();
    showToast(data.success ? `✔ Zrespiono ${payload.count} × ${payload.entity}` : `✖ ${data.error || data.responses?.[0] || 'Respawn nieudany'}`);
    playCyberSound(data.success ? 'success' : 'alert');
    if (data.success) {
      await pollTactical();
      fitTacticalMap();
    }
  } catch (err) {
    showToast(`✖ Błąd sieci: ${err.message}`);
  }
}

// Format bytes
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Telemetry Polling
async function pollTelemetry() {
  const start = performance.now();
  try {
    const res = await fetch('/api/status');
    const latency = Math.round(performance.now() - start);
    document.getElementById('connectionLatency').textContent = `LATENCY: ${latency} ms`;

    if (!res.ok) throw new Error('Status non-200');
    const data = await res.json();
    renderTelemetry(data);
  } catch (err) {
    document.getElementById('streamStatus').textContent = 'LIVE TELEMETRY: RECONNECTING...';
    document.getElementById('streamPulse').style.background = 'var(--neon-red)';
    document.getElementById('connectionLatency').textContent = 'OFFLINE / PING TIMEOUT';
  }
}

function renderTelemetry(data) {
  const sys = data.system || {};
  const mc = data.minecraft || {};

  // Hostname
  document.getElementById('hostTag').textContent = `HOST: ${sys.hostname || 'Grzybkowo'}`;

  // Stream status
  document.getElementById('streamStatus').textContent = 'LIVE TELEMETRY: CONNECTED';
  document.getElementById('streamPulse').style.background = 'var(--neon-green)';

  // Minecraft Core
  const mcBadge = document.getElementById('mcStatusBadge');
  const mcText = document.getElementById('mcStatusText');
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const playit = data.playit || {};
  const playitStatus = document.getElementById('playitStatus');
  const playitStatusText = document.getElementById('playitStatusText');

  if (playitStatus && playitStatusText) {
    const state = ['online', 'degraded', 'offline', 'unknown'].includes(playit.state) ? playit.state : 'checking';
    const label = playit.label || 'PLAYIT: SPRAWDZANIE...';
    playitStatus.className = `playit-status ${state}`;
    if (playitStatusText.textContent !== label) playitStatusText.textContent = label;
  }

  if (mc.active) {
    mcBadge.textContent = 'RUNNING';
    mcBadge.className = 'status-indicator highlight';
    mcText.textContent = 'ONLINE';
    mcText.className = 'big-metric highlight';
    if (btnStart) btnStart.disabled = true;
    if (btnStop) btnStop.disabled = false;
  } else {
    mcBadge.textContent = 'OFFLINE';
    mcBadge.className = 'status-indicator offline';
    mcText.textContent = 'STOPPED';
    mcText.className = 'big-metric highlight-red';
    if (btnStart) btnStart.disabled = false;
    if (btnStop) btnStop.disabled = true;
  }

  // Players
  const players = mc.players || { count: 0, max: 8, list: [] };
  document.getElementById('mcPlayersVal').textContent = `${players.count} / ${players.max}`;
  document.getElementById('mcPidVal').textContent = mc.java_pid || (mc.pid ? mc.pid : '--');
  document.getElementById('mcJvmRamVal').textContent = mc.jvm_memory_mb ? `${mc.jvm_memory_mb} MB` : '-- MB';

  renderOnlinePlayersInChat(players);

  const chipsContainer = document.getElementById('playerChipsContainer');
  if (chipsContainer) {
    if (players.list && players.list.length > 0) {
      chipsContainer.innerHTML = players.list.map(p => `<span class="player-chip">${escapeHtml(p)}</span>`).join('');
    } else {
      chipsContainer.innerHTML = `<span style="font-size: 0.72rem; color: var(--text-dim);">Brak graczy na serwerze</span>`;
    }
  }

  // CPU
  const cpuPct = sys.cpu_percent !== undefined ? sys.cpu_percent : 0;
  document.getElementById('cpuPercentVal').textContent = `${cpuPct}%`;
  document.getElementById('cpuBar').style.width = `${cpuPct}%`;
  const power = sys.power || {};
  document.getElementById('cpuPowerVal').textContent = power.watts !== null && power.watts !== undefined ? `${power.watts} W` : '-- W';
  document.getElementById('cpuEnergyVal').textContent = power.session_kwh !== null && power.session_kwh !== undefined ? `${power.session_kwh} kWh` : '-- kWh';
  document.getElementById('sysUptimeVal').textContent = sys.uptime || '--';

  // Thermals
  const temp = sys.temp || {};
  const pkgTemp = temp.package !== null && temp.package !== undefined ? temp.package : '--';
  document.getElementById('pkgTempVal').textContent = pkgTemp !== '--' ? `${pkgTemp} °C` : '-- °C';
  
  if (pkgTemp !== '--') {
    const tempBarWidth = Math.min(100, Math.max(0, (pkgTemp / 100) * 100));
    document.getElementById('tempBar').style.width = `${tempBarWidth}%`;
    const tempBadge = document.getElementById('tempStatusBadge');
    if (pkgTemp > 80) {
      tempBadge.textContent = 'CRITICAL';
      tempBadge.className = 'status-indicator offline';
    } else if (pkgTemp > 65) {
      tempBadge.textContent = 'ELEVATED';
      tempBadge.className = 'status-indicator warning';
    } else {
      tempBadge.textContent = 'OPTIMAL';
      tempBadge.className = 'status-indicator highlight';
    }
  }

  if (temp.cores && temp.cores.length >= 2) {
    document.getElementById('core0TempVal').textContent = `${temp.cores[0].temp} °C`;
    document.getElementById('core1TempVal').textContent = `${temp.cores[1].temp} °C`;
  } else if (temp.cores && temp.cores.length === 1) {
    document.getElementById('core0TempVal').textContent = `${temp.cores[0].temp} °C`;
    document.getElementById('core1TempVal').textContent = `${temp.cores[0].temp} °C`;
  }

  // RAM
  const mem = sys.memory || {};
  if (mem.total_bytes) {
    const usedGB = (mem.used_bytes / (1024**3)).toFixed(1);
    const totalGB = (mem.total_bytes / (1024**3)).toFixed(1);
    document.getElementById('ramTextVal').textContent = `${usedGB} / ${totalGB} GB (${mem.used_percent}%)`;
    document.getElementById('ramBar').style.width = `${mem.used_percent}%`;
  }

  // Disk
  const disk = sys.disk || {};
  if (disk.total_bytes) {
    const usedGB = (disk.used_bytes / (1024**3)).toFixed(1);
    const totalGB = (disk.total_bytes / (1024**3)).toFixed(1);
    document.getElementById('diskTextVal').textContent = `${usedGB} / ${totalGB} GB (${disk.used_percent}%)`;
    document.getElementById('diskBar').style.width = `${disk.used_percent}%`;
  }

  // Tab 4 details
  const sensorsView = document.getElementById('sensorsJsonView');
  if (sensorsView) {
    sensorsView.textContent = JSON.stringify(temp, null, 2);
  }
  const memView = document.getElementById('memDetailsView');
  if (memView) {
    memView.textContent = JSON.stringify(mem, null, 2);
  }
  const diskView = document.getElementById('diskDetailsView');
  if (diskView) {
    diskView.textContent = JSON.stringify(disk, null, 2);
  }
}

// Tactical Actions
function triggerServerAction(action) {
  playCyberSound('click');
  if (action === 'stop') {
    openConfirmModal(
      'ZATRZYMANIE SERWERA',
      'Czy na pewno chcesz zatrzymać serwer Minecraft? Gracze zostaną rozłączeni, a świat zapisany.',
      () => executeServerControl('stop')
    );
  } else if (action === 'kill') {
    openConfirmModal(
      'AWARYJNY FORCE KILL (SIGKILL)',
      'UWAGA: Wymuszone zabicie procesu (kill -9). Może spowodować utratę niezapisanych chunków świata. Kontynuować?',
      () => executeServerControl('kill')
    );
  } else if (action === 'restart') {
    openConfirmModal(
      'RESTART SERWERA',
      'Zrestartować serwer Minecraft Forge? Wszelkie zmiany w modach zostaną załadowane, a paczka AutoModpack zaktualizowana.',
      () => executeServerControl('restart')
    );
  } else if (action === 'restart_playit') {
    openConfirmModal(
      'RESTART TUNELU PLAYIT',
      'Zrestartować publiczny tunel Playit? Połączenia graczy z zewnątrz mogą zostać na chwilę przerwane.',
      () => executeServerControl('restart_playit')
    );
  } else {
    executeServerControl('start');
  }
}

async function executeServerControl(action) {
  closeConfirmModal();
  showToast(`[TRIGGER] Wysyłanie polecenia: ${action.toUpperCase()}...`);
  playCyberSound('alert');

  try {
    const res = await fetch('/api/server/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✔ ${data.message || 'Sukces operacji!'}`);
      playCyberSound('success');
    } else {
      showToast(`✖ Błąd: ${data.error || data.message || 'Niepowodzenie'}`);
      playCyberSound('alert');
    }
  } catch (err) {
    showToast(`✖ Błąd sieci: ${err.message}`);
    playCyberSound('alert');
  }
}

// Confirmation Modal
function openConfirmModal(title, msg, onConfirm) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = msg;
  pendingConfirmAction = onConfirm;
  document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
  document.getElementById('confirmModal').classList.remove('active');
  pendingConfirmAction = null;
}

document.getElementById('confirmBtnExecute')?.addEventListener('click', () => {
  if (pendingConfirmAction) pendingConfirmAction();
});

// Logs & Console
async function pollLogs() {
  const consolePanel = document.getElementById('tab-console');
  if (!consolePanel || !consolePanel.classList.contains('active')) return;

  try {
    const res = await fetch('/api/logs?lines=160');
    if (!res.ok) return;
    const data = await res.json();
    if (data.lines) {
      renderLogs(data.lines);
    }
  } catch (e) {}
}

function renderLogs(lines) {
  lastLogLines = lines;
  const filter = (document.getElementById('logFilter')?.value || '').toLowerCase();
  const consoleBody = document.getElementById('consoleBody');
  if (!consoleBody) return;

  const filtered = filter ? lines.filter(l => l.toLowerCase().includes(filter)) : lines;

  consoleBody.innerHTML = filtered.map(line => {
    let cls = 'log-line';
    if (line.includes('[WARN]')) cls += ' warn';
    else if (line.includes('[ERROR]') || line.includes('Exception') || line.includes('FATAL')) cls += ' error';
    else if (line.includes('AutoModpack') || line.includes('crazycow') || line.includes('joined the game')) cls += ' special';
    else if (line.includes('[INFO]')) cls += ' info';
    return `<div class="${cls}">${escapeHtml(line)}</div>`;
  }).join('');

  if (autoScrollEnabled) {
    consoleBody.scrollTop = consoleBody.scrollHeight;
  }
}

document.getElementById('logFilter')?.addEventListener('input', () => {
  if (lastLogLines.length > 0) renderLogs(lastLogLines);
});

function toggleAutoScroll() {
  autoScrollEnabled = !autoScrollEnabled;
  const btn = document.getElementById('btnAutoScroll');
  if (btn) {
    btn.textContent = autoScrollEnabled ? 'AUTO-SCROLL [ON]' : 'AUTO-SCROLL [OFF]';
    btn.classList.toggle('active', autoScrollEnabled);
  }
  playCyberSound('click');
}

function clearConsoleView() {
  const consoleBody = document.getElementById('consoleBody');
  if (consoleBody) consoleBody.innerHTML = '';
  playCyberSound('click');
}

// RCON Commands
async function handleRconSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('rconInput');
  if (!input) return;
  const cmd = input.value.trim();
  if (!cmd) return;

  commandHistory.push(cmd);
  historyIndex = commandHistory.length;
  input.value = '';

  await sendRcon(cmd);
}

async function sendRcon(cmd) {
  playCyberSound('click');
  appendConsoleDirect(`[ADMIN >>] ${cmd}`, 'special');

  try {
    const res = await fetch('/api/rcon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd })
    });
    const data = await res.json();
    if (data.response) {
      appendConsoleDirect(`[SERVER <<] ${data.response}`, 'info');
      showToast(data.response.slice(0, 60));
    }
  } catch (err) {
    appendConsoleDirect(`[BŁĄD] ${err.message}`, 'error');
  }
}

function appendConsoleDirect(text, cls = 'info') {
  const consoleBody = document.getElementById('consoleBody');
  if (!consoleBody) return;
  const div = document.createElement('div');
  div.className = `log-line ${cls}`;
  div.textContent = text;
  consoleBody.appendChild(div);
  if (autoScrollEnabled) consoleBody.scrollTop = consoleBody.scrollHeight;
}

// Keyboard history for RCON input
document.getElementById('rconInput')?.addEventListener('keydown', function(e) {
  if (e.key === 'ArrowUp') {
    if (commandHistory.length > 0 && historyIndex > 0) {
      historyIndex--;
      this.value = commandHistory[historyIndex];
    }
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      this.value = commandHistory[historyIndex];
    } else {
      historyIndex = commandHistory.length;
      this.value = '';
    }
    e.preventDefault();
  }
});

// File Explorer
async function browsePath(relPath) {
  playCyberSound('click');
  currentPath = relPath;
  const tbody = document.getElementById('filesTableBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="text-center">Skanowanie ścieżki /opt/minecraft/${relPath}...</td></tr>`;

  try {
    const res = await fetch(`/api/files?path=${encodeURIComponent(relPath)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Błąd odczytu katalogu');

    renderBreadcrumbs(data.current_path || relPath);
    renderFilesTable(data.items || []);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="text-center highlight-red">Błąd: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderBreadcrumbs(pathStr) {
  const bc = document.getElementById('filesBreadcrumbs');
  if (!bc) return;

  if (pathStr === '.' || !pathStr) {
    bc.innerHTML = `<span class="crumb-root" onclick="browsePath('.')">/opt/minecraft</span>`;
    return;
  }

  const parts = pathStr.split('/');
  let accum = '';
  let html = `<span class="crumb-root" onclick="browsePath('.')">/opt/minecraft</span>`;

  parts.forEach((p, idx) => {
    accum += (idx === 0 ? p : `/${p}`);
    html += ` <span class="crumb-sep">/</span> <span class="crumb-item" onclick="browsePath('${escapeHtml(accum)}')">${escapeHtml(p)}</span>`;
  });
  bc.innerHTML = html;
}

function renderFilesTable(items) {
  const tbody = document.getElementById('filesTableBody');
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center">Katalog jest pusty</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(item => {
    const icon = item.is_dir ? '📁' : (item.is_jar ? '📦' : (item.is_text ? '📄' : '📎'));
    const sizeStr = item.is_dir ? '--' : formatBytes(item.size);
    const dateStr = item.mtime ? new Date(item.mtime * 1000).toLocaleString('pl-PL') : '--';
    
    let clickAction = '';
    if (item.is_dir) {
      clickAction = `onclick="browsePath('${escapeHtml(item.rel_path)}')"` ;
    } else if (item.is_text) {
      clickAction = `onclick="viewFileContent('${escapeHtml(item.rel_path)}')"` ;
    }

    let actions = '';
    if (item.is_text) {
      actions += `<button class="cyber-btn-mini" onclick="viewFileContent('${escapeHtml(item.rel_path)}')">PODGLĄD</button>`;
    }
    if (item.is_jar || item.is_disabled_jar) {
      actions += `<button class="cyber-btn-mini" onclick="toggleModState('${escapeHtml(item.rel_path)}')">${item.is_disabled_jar ? 'WŁĄCZ' : 'WYŁĄCZ'}</button>`;
    }

    return `
      <tr>
        <td>
          <span class="item-link ${item.is_dir ? 'dir' : ''}" ${clickAction}>
            <span>${icon}</span>
            <span>${escapeHtml(item.name)}</span>
          </span>
        </td>
        <td>${sizeStr}</td>
        <td>${dateStr}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join('');
}

// File Viewer Modal
async function viewFileContent(relPath) {
  playCyberSound('click');
  document.getElementById('modalFileName').textContent = relPath;
  document.getElementById('modalFileContent').textContent = 'Pobieranie zawartości pliku...';
  document.getElementById('fileModal').classList.add('active');

  try {
    const res = await fetch(`/api/file/read?path=${encodeURIComponent(relPath)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Błąd odczytu');
    document.getElementById('modalFileContent').textContent = data.content || '(Pusty plik)';
  } catch (err) {
    document.getElementById('modalFileContent').textContent = `BŁĄD: ${err.message}`;
  }
}

function closeFileModal() {
  document.getElementById('fileModal').classList.remove('active');
}

function copyModalContent() {
  const text = document.getElementById('modalFileContent').textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Skopiowano treść pliku do schowka!');
    playCyberSound('success');
  });
}

// Mods Arsenal
function uploadMod(event) {
  event.preventDefault();
  const input = document.getElementById('modUploadFile');
  const progress = document.getElementById('modUploadProgress');
  const status = document.getElementById('modUploadStatus');
  const file = input.files[0];
  if (!file || !file.name.toLowerCase().endsWith('.jar')) {
    showToast('Wybierz plik .jar');
    return;
  }

  const request = new XMLHttpRequest();
  request.open('POST', `/api/mod/upload?filename=${encodeURIComponent(file.name)}`);
  request.setRequestHeader('Content-Type', 'application/java-archive');
  progress.hidden = false;
  progress.value = 0;
  status.textContent = `Wysyłanie ${file.name}...`;
  request.upload.onprogress = e => {
    if (e.lengthComputable) progress.value = Math.round(e.loaded * 100 / e.total);
  };
  request.onload = () => {
    let data = {};
    try { data = JSON.parse(request.responseText); } catch (_) {}
    if (request.status === 201) {
      status.textContent = `${file.name} wgrany. Uruchom ponownie serwer, aby go załadować.`;
      showToast('Mod wgrany poprawnie — wymagany restart');
      input.value = '';
      loadModsList();
    } else {
      status.textContent = `Błąd: ${data.error || request.statusText}`;
      showToast(status.textContent);
    }
  };
  request.onerror = () => {
    status.textContent = 'Błąd połączenia podczas wysyłania pliku.';
    showToast(status.textContent);
  };
  request.onloadend = () => { progress.hidden = true; };
  request.send(file);
}

async function loadModsList() {
  playCyberSound('click');
  const grid = document.getElementById('modsGrid');
  if (grid) grid.innerHTML = '<div class="text-center">Skanowanie /opt/minecraft/mods...</div>';

  try {
    const res = await fetch('/api/mods');
    const data = await res.json();
    renderModsGrid(data.mods || []);
  } catch (err) {
    if (grid) grid.innerHTML = `<div class="highlight-red">Błąd ładowania modów: ${err.message}</div>`;
  }
}

function renderModsGrid(mods) {
  const grid = document.getElementById('modsGrid');
  if (!grid) return;

  if (mods.length === 0) {
    grid.innerHTML = '<div>Brak modów w katalogu mods/</div>';
    return;
  }

  grid.innerHTML = mods.map(mod => {
    const isEnabled = mod.enabled;
    const badgeCls = isEnabled ? 'active' : 'disabled';
    const badgeText = isEnabled ? 'AKTYWNY' : 'WYŁĄCZONY (.disabled)';
    const cardCls = isEnabled ? 'mod-card' : 'mod-card disabled';

    return `
      <div class="${cardCls}">
        <div class="mod-card-top">
          <div class="mod-name">📦 ${escapeHtml(mod.name)}</div>
          <span class="mod-badge ${badgeCls}">${badgeText}</span>
        </div>
        <div class="mod-meta">
          <span>ROZMIAR: ${formatBytes(mod.size)}</span>
          <span>DATA: ${new Date(mod.mtime * 1000).toLocaleDateString('pl-PL')}</span>
        </div>
        <div class="mod-actions">
          <button class="cyber-btn-mini" onclick="toggleModState('${escapeHtml(mod.rel_path)}')">
            ${isEnabled ? 'DEZAKTYWUJ' : 'AKTYWUJ (.jar)'}
          </button>
          <button class="cyber-btn-mini btn-stop" onclick="backupModFile('${escapeHtml(mod.rel_path)}')">
            KOPIA (.backup)
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleModState(relPath) {
  playCyberSound('click');
  try {
    const res = await fetch('/api/mod/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Zmieniono status moda! ${data.enabled ? 'Włączony' : 'Wyłączony'}`);
      playCyberSound('success');
      loadModsList();
      if (document.getElementById('tab-files')?.classList.contains('active')) browsePath(currentPath);
    } else {
      showToast(`Błąd: ${data.error}`);
    }
  } catch (err) {
    showToast(`Błąd sieci: ${err.message}`);
  }
}

async function backupModFile(relPath) {
  playCyberSound('click');
  try {
    const res = await fetch('/api/mod/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message);
      playCyberSound('success');
      loadModsList();
    } else {
      showToast(`Błąd: ${data.error}`);
    }
  } catch (err) {
    showToast(`Błąd sieci: ${err.message}`);
  }
}

// Utility escape HTML
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Escape key to close modals
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeFileModal();
    closeConfirmModal();
  }
});

// =========================================
// CHAT SUBSYSTEM // LIVE PLAYER MESSENGER
// =========================================
let lastChatMsgIds = new Set();
let lastChatRenderKey = '';
let chatSoundEnabled = true;
let unreadChatCount = 0;
let selectedChatMode = 'chat';

// Mode selection chips listener
document.querySelectorAll('.mode-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.mode-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const mode = chip.getAttribute('data-mode');
    selectedChatMode = mode;
    const input = document.getElementById('chatTextInput');
    if (input) {
      if (mode === 'title') input.placeholder = 'Wpisz wielki napis na środku ekranu graczy...';
      else if (mode === 'actionbar') input.placeholder = 'Wpisz tekst paska nad ekwipunkiem...';
      else if (mode === 'whisper') input.placeholder = 'Wpisz treść prywatnej wiadomości (PW)...';
      else input.placeholder = 'Napisz wiadomość do graczy i wciśnij Enter...';
    }
    playCyberSound('click');
  });
});

async function pollChat() {
  try {
    const res = await fetch('/api/chat?limit=70');
    if (!res.ok) return;
    const data = await res.json();
    const messages = data.messages || [];
    renderChatFeed(messages);
  } catch (e) {}
}

function renderChatFeed(messages) {
  const stream = document.getElementById('chatStream');
  if (!stream) return;
  const renderKey = messages.map(message => message.id).join('|');
  if (renderKey === lastChatRenderKey) return;
  lastChatRenderKey = renderKey;

  if (messages.length === 0) {
    stream.innerHTML = '<div class="chat-system-event">Czat serwera jest czysty. Napisz pierwszą wiadomość!</div>';
    return;
  }

  let hasNewPlayerMsg = false;
  const isChatTabActive = document.getElementById('tab-chat')?.classList.contains('active');

  for (const m of messages) {
    if (!lastChatMsgIds.has(m.id)) {
      lastChatMsgIds.add(m.id);
      if (m.type === 'player') {
        hasNewPlayerMsg = true;
      }
    }
  }

  if (hasNewPlayerMsg && chatSoundEnabled) {
    playCyberSound('chat');
    if (!isChatTabActive) {
      unreadChatCount++;
      updateUnreadChatBadge();
    }
  }

  const isNearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100;

  stream.innerHTML = messages.map(m => {
    if (m.type === 'event') {
      const isJoin = m.text.includes('joined');
      const isLeave = m.text.includes('left') || m.text.includes('lost connection');
      const cls = isJoin ? 'join' : (isLeave ? 'leave' : '');
      const icon = isJoin ? '🟢' : (isLeave ? '🔴' : '⚡');
      return `<div class="chat-system-event ${cls}">${icon} <strong>${escapeHtml(m.sender)}</strong> ${escapeHtml(m.text)} (${m.time})</div>`;
    } else if (m.type === 'player') {
      return `
        <div class="chat-card player">
          <div class="chat-card-top">
            <span class="chat-sender">👤 ${escapeHtml(m.sender)}</span>
            <span class="chat-time">${m.time}</span>
          </div>
          <div class="chat-body">${escapeHtml(m.text)}</div>
        </div>
      `;
    } else if (m.type === 'admin') {
      let modeBadge = '';
      if (m.mode === 'title') modeBadge = '<span class="chat-mode-tag">TITLE</span>';
      else if (m.mode === 'actionbar') modeBadge = '<span class="chat-mode-tag">ACTIONBAR</span>';
      else if (m.mode === 'whisper') modeBadge = `<span class="chat-mode-tag">PW ➔ ${escapeHtml(m.target)}</span>`;

      return `
        <div class="chat-card admin">
          <div class="chat-card-top">
            <span class="chat-sender"><span class="admin-crown">👑</span> [ADMIN] ${modeBadge}</span>
            <span class="chat-time">${m.time}</span>
          </div>
          <div class="chat-body">${escapeHtml(m.text)}</div>
        </div>
      `;
    }
    return '';
  }).join('');

  if (isNearBottom) {
    stream.scrollTop = stream.scrollHeight;
  }
}

function updateUnreadChatBadge() {
  const badge = document.getElementById('chatUnreadBadge');
  if (!badge) return;
  if (unreadChatCount > 0) {
    badge.textContent = `${unreadChatCount} NOWE`;
    badge.classList.add('show');
  } else {
    badge.classList.remove('show');
  }
}

function toggleChatSound() {
  chatSoundEnabled = !chatSoundEnabled;
  const btn = document.getElementById('btnChatSound');
  if (btn) {
    btn.textContent = chatSoundEnabled ? 'DŹWIĘK CZATU [ON]' : 'DŹWIĘK CZATU [OFF]';
    btn.classList.toggle('active', chatSoundEnabled);
  }
  playCyberSound('click');
}

function clearChatView() {
  const stream = document.getElementById('chatStream');
  if (stream) stream.innerHTML = '<div class="chat-system-event">Ekran wyczyszczony.</div>';
  playCyberSound('click');
}

async function handleChatSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('chatTextInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  const targetSelect = document.getElementById('chatTargetSelect');
  const target = targetSelect ? targetSelect.value : '@a';

  input.value = '';
  playCyberSound('click');

  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        mode: selectedChatMode,
        target: target
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Wiadomość wysłana na serwer!');
      playCyberSound('success');
      pollChat();
    } else {
      showToast(`Błąd: ${data.error}`);
    }
  } catch (err) {
    showToast(`Błąd sieci: ${err.message}`);
  }
}

function quickSendChat(text) {
  const input = document.getElementById('chatTextInput');
  if (input) {
    input.value = text;
    const form = document.getElementById('chatComposerForm');
    if (form) form.dispatchEvent(new Event('submit'));
  }
}

function renderOnlinePlayersInChat(players) {
  const countBadge = document.getElementById('chatPlayerCount');
  if (countBadge) countBadge.textContent = `${players.count} / ${players.max}`;

  const targetSelect = document.getElementById('chatTargetSelect');
  if (targetSelect) {
    const currentVal = targetSelect.value;
    targetSelect.innerHTML = '<option value="@a">Wszyscy gracze (@a)</option>' +
      players.list.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    if (players.list.includes(currentVal)) {
      targetSelect.value = currentVal;
    }
  }

  const listEl = document.getElementById('chatPlayersList');
  if (!listEl) return;

  if (!players.list || players.list.length === 0) {
    listEl.innerHTML = '<div class="empty-players-msg">Brak graczy online</div>';
    return;
  }

  listEl.innerHTML = players.list.map(p => `
    <div class="player-item-card">
      <div class="player-item-header">
        <span class="player-nick">${escapeHtml(p)}</span>
      </div>
      <div class="player-actions-row">
        <button type="button" class="player-act-btn" onclick="startWhisperTo('${escapeHtml(p)}')">💬 PW</button>
        <button type="button" class="player-act-btn" onclick="sendRcon('tp ${escapeHtml(p)} ~ ~ ~')">⚡ TP</button>
        <button type="button" class="player-act-btn" onclick="sendRcon('give ${escapeHtml(p)} diamond 1')">💎 Diament</button>
        <button type="button" class="player-act-btn" onclick="quickWhitelistAdd('${escapeHtml(p)}')">🛡️ +WL</button>
        <button type="button" class="player-act-btn" onclick="sendRcon('op ${escapeHtml(p)}')">⭐ OP</button>
        <button type="button" class="player-act-btn btn-stop" onclick="sendRcon('kick ${escapeHtml(p)} Kick od Admina')">👢 Kick</button>
      </div>
    </div>
  `).join('');
}

// Whitelist management
async function handleWhitelistAdd(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('whitelistNickInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;

  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) {
    showToast('Nick musi mieć 1–16 znaków (litery, cyfry, _).');
    return;
  }

  await manageWhitelist('add', name);
  input.value = '';
}

async function quickWhitelistAdd(name) {
  if (!name) return;
  await manageWhitelist('add', name);
}

async function manageWhitelist(action, name = '') {
  playCyberSound('click');
  const input = document.getElementById('whitelistNickInput');
  if (action === 'remove' && !name && input) {
    name = input.value.trim();
    if (!name) {
      showToast('Wpisz nick gracza do usunięcia.');
      input.focus();
      return;
    }
  }

  const actionLabels = {
    add: `Dodawanie ${name} do białej listy...`,
    remove: `Usuwanie ${name} z białej listy...`,
    list: 'Pobieranie listy whitelisty...',
    on: 'Włączanie sprawdzania whitelisty...',
    off: 'Wyłączanie sprawdzania whitelisty...',
    reload: 'Przeładowywanie pliku whitelist.json...'
  };

  appendConsoleDirect(`[WHITELIST] ${actionLabels[action] || action}`, 'special');

  try {
    const res = await fetch('/api/whitelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, name })
    });
    const data = await res.json();
    if (data.response) {
      appendConsoleDirect(`[SERVER <<] ${data.response}`, data.success ? 'info' : 'error');
      showToast(data.response.slice(0, 80));
    } else if (data.error) {
      appendConsoleDirect(`[BŁĄD] ${data.error}`, 'error');
      showToast(`Błąd: ${data.error}`);
    }
  } catch (err) {
    appendConsoleDirect(`[BŁĄD SIECI] ${err.message}`, 'error');
    showToast(`Błąd sieci: ${err.message}`);
  }
}

// Weather actions
async function setWeather(type) {
  playCyberSound('click');
  const sel = document.getElementById('weatherDurationSelect');
  const duration = sel ? sel.value : '';

  const weatherLabels = {
    clear: '☀️ Bezchmurnie',
    rain: '🌧️ Deszcz',
    thunder: '⛈️ Burza z Piorunami'
  };

  appendConsoleDirect(`[POGODA] Ustawianie: ${weatherLabels[type] || type}${duration ? ` (czas: ${duration}s)` : ''}`, 'special');

  try {
    const res = await fetch('/api/weather', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, duration })
    });
    const data = await res.json();
    if (data.response) {
      appendConsoleDirect(`[SERVER <<] ${data.response}`, data.success ? 'info' : 'error');
      showToast(data.response.slice(0, 80));
    } else if (data.error) {
      appendConsoleDirect(`[BŁĄD] ${data.error}`, 'error');
      showToast(`Błąd: ${data.error}`);
    }
  } catch (err) {
    appendConsoleDirect(`[BŁĄD SIECI] ${err.message}`, 'error');
    showToast(`Błąd sieci: ${err.message}`);
  }
}

async function toggleWeatherCycle(enable) {
  playCyberSound('click');
  appendConsoleDirect(`[POGODA] ${enable ? 'Wznawianie naturalnego cyklu pogody' : 'Zatrzymywanie cyklu pogody (stała aura)'}`, 'special');

  try {
    const res = await fetch('/api/weather', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cycle: enable })
    });
    const data = await res.json();
    if (data.response) {
      appendConsoleDirect(`[SERVER <<] ${data.response}`, data.success ? 'info' : 'error');
      showToast(data.response.slice(0, 80));
    } else if (data.error) {
      appendConsoleDirect(`[BŁĄD] ${data.error}`, 'error');
      showToast(`Błąd: ${data.error}`);
    }
  } catch (err) {
    appendConsoleDirect(`[BŁĄD SIECI] ${err.message}`, 'error');
    showToast(`Błąd sieci: ${err.message}`);
  }
}

async function sendServerRules(target = '@a') {
  playCyberSound('click');
  appendConsoleDirect(`[REGULAMIN] Wysyłanie zasad do: ${target}...`, 'special');
  try {
    const res = await fetch('/api/rules/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target })
    });
    const data = await res.json();
    if (data.message) {
      showToast(data.message);
      appendConsoleDirect(`[SERVER <<] ${data.message}`, 'info');
    } else if (data.error) {
      showToast(`Błąd: ${data.error}`);
      appendConsoleDirect(`[BŁĄD] ${data.error}`, 'error');
    }
  } catch (err) {
    appendConsoleDirect(`[BŁĄD SIECI] ${err.message}`, 'error');
    showToast(`Błąd sieci: ${err.message}`);
  }
}

function startWhisperTo(player) {
  selectedChatMode = 'whisper';
  document.querySelectorAll('.mode-chip').forEach(c => {
    c.classList.toggle('active', c.getAttribute('data-mode') === 'whisper');
  });
  const targetSelect = document.getElementById('chatTargetSelect');
  if (targetSelect) targetSelect.value = player;

  const input = document.getElementById('chatTextInput');
  if (input) {
    input.placeholder = `Napisz prywatną wiadomość do ${player}...`;
    input.focus();
  }
  playCyberSound('click');
}

// Initialization & Loops
document.addEventListener('DOMContentLoaded', () => {
  pollTelemetry();
  pollChat();
  pollLogs();
  browsePath('.');
  loadModsList();

  // Fast loop for telemetry (1.8s)
  setInterval(pollTelemetry, 1800);

  // Fast loop for live chat feed (1.5s)
  setInterval(pollChat, 1500);

  // Loop for log streaming (2.5s)
  setInterval(pollLogs, 2500);

  setInterval(pollTactical, 3000);
});
