const socket = io();
const statusEl = document.getElementById('status');
const trackpad = document.getElementById('trackpad');
const cursorDot = document.getElementById('cursor-dot');
const cursorHint = document.getElementById('cursor-hint');
const gyroHint = document.getElementById('gyro-hint');
const gyroDebug = document.getElementById('gyro-debug');
const btnLeft = document.getElementById('btn-left');
const btnRight = document.getElementById('btn-right');
const btnScroll = document.getElementById('btn-scroll');
const btnMode = document.getElementById('btn-mode');
const btnGyro = document.getElementById('btn-gyro');
const keyboard = document.getElementById('keyboard');
const kbInput = document.getElementById('kb-input');
const specialKeys = document.getElementById('special-keys');
const modifierKeys = document.getElementById('modifier-keys');

// Show HTTPS URL hint if on HTTP (gyro needs HTTPS)
const isHttps = window.location.protocol === 'https:';
if (!isHttps && gyroHint) {
  gyroHint.textContent = 'Gyro requires HTTPS. Use port 3443.';
}


let lastX = 0;
let lastY = 0;
let isTouching = false;
let twoFingerTap = false;
let lastTapTime = 0;
let tapCount = 0;
let isKeyboardMode = false;
let activeModifiers = new Set();
let isScrollMode = false;

// Batched movement
let batchedDx = 0;
let batchedDy = 0;

// Visual cursor position on trackpad (percentage 0-100)
let visualCursorX = 50;
let visualCursorY = 50;

// Gyroscope state
let isGyroMode = false;
let gyroBaseBeta = 0;
let gyroBaseGamma = 0;
let gyroCalibrated = false;
let gyroSampleCount = 0;
let gyroLastOrientationTime = 0;
let gyroTargetDx = 0;
let gyroTargetDy = 0;
let gyroVelocityDx = 0;
let gyroVelocityDy = 0;
let gyroLastFrameTime = 0;
let gyroFrameHandle = 0;
const GYRO_DEADZONE = 1.5;
const GYRO_TILT_SENSITIVITY = 2.2;
const GYRO_MOTION_SENSITIVITY = 0.75;
const GYRO_EMA = 0.22;
const GYRO_DAMPING = 0.88;
const GYRO_MAX_SPEED = 24;
const GYRO_MAX_STEP = 14;
const GYRO_CALIBRATION_SAMPLES = 10;
const GYRO_MOTION_STALE_MS = 250;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updateStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type || '';
}

socket.on('connect', () => {
  updateStatus('Connected - Ready to control', 'connected');
});

socket.on('disconnect', () => {
  updateStatus('Disconnected', 'disconnected');
});

socket.on('connect_error', () => {
  updateStatus('Connection error', 'disconnected');
});

function sendMove(dx, dy) {
  socket.emit('mouse-move', { dx, dy });
}

function sendClick(button, double = false) {
  socket.emit('mouse-click', { button, double });
}

function sendMouseDown(button) {
  socket.emit('mouse-down', { button });
}

function sendMouseUp(button) {
  socket.emit('mouse-up', { button });
}

function sendScroll(dx, dy) {
  socket.emit('scroll', { dx, dy });
}

function sendType(text) {
  socket.emit('type-text', { text });
}

function sendSpecialKey(key) {
  socket.emit('special-key', { key, modifiers: Array.from(activeModifiers) });
}

function updateVisualCursor() {
  if (!cursorDot) return;
  cursorDot.style.left = visualCursorX + '%';
  cursorDot.style.top = visualCursorY + '%';
}

function moveVisualCursor(dx, dy) {
  // Scale movement to percentage
  const trackpadW = trackpad.clientWidth || 300;
  const trackpadH = trackpad.clientHeight || 400;
  visualCursorX += (dx / trackpadW) * 100;
  visualCursorY += (dy / trackpadH) * 100;
  // Clamp
  visualCursorX = Math.max(2, Math.min(98, visualCursorX));
  visualCursorY = Math.max(2, Math.min(98, visualCursorY));
  updateVisualCursor();
}

function setMode(keyboardMode) {
  isKeyboardMode = keyboardMode;
  if (keyboardMode) {
    trackpad.classList.remove('active');
    keyboard.classList.add('active');
    btnMode.textContent = 'Trackpad';
    setTimeout(() => kbInput.focus(), 100);
  } else {
    keyboard.classList.remove('active');
    trackpad.classList.add('active');
    btnMode.textContent = 'Keyboard';
    kbInput.blur();
  }
}

btnMode.addEventListener('click', () => setMode(!isKeyboardMode));
btnMode.addEventListener('touchstart', (e) => { e.preventDefault(); setMode(!isKeyboardMode); }, { passive: false });

// ─── Gyroscope ───

function updateGyroDebug(beta, gamma, dx, dy) {
  if (!gyroDebug) return;
  gyroDebug.textContent = `B:${beta.toFixed(1)} G:${gamma.toFixed(1)} | dx:${Math.round(dx)} dy:${Math.round(dy)}`;
}

function setGyroTarget(dx, dy) {
  gyroTargetDx = clamp(dx, -GYRO_MAX_SPEED, GYRO_MAX_SPEED);
  gyroTargetDy = clamp(dy, -GYRO_MAX_SPEED, GYRO_MAX_SPEED);
}

function processGyroData(beta, gamma) {
  if (!isGyroMode) return;

  // Calibration phase: average first few samples
  if (gyroSampleCount < GYRO_CALIBRATION_SAMPLES) {
    gyroBaseBeta += beta;
    gyroBaseGamma += gamma;
    gyroSampleCount++;
    if (gyroSampleCount === GYRO_CALIBRATION_SAMPLES) {
      gyroBaseBeta /= GYRO_CALIBRATION_SAMPLES;
      gyroBaseGamma /= GYRO_CALIBRATION_SAMPLES;
      gyroCalibrated = true;
      updateStatus('Gyro ready! Tilt phone to move cursor', 'connected');
    }
    updateGyroDebug(beta, gamma, 0, 0);
    return;
  }

  // Delta from calibrated center
  let deltaBeta = beta - gyroBaseBeta;
  let deltaGamma = gamma - gyroBaseGamma;

  // Apply deadzone
  if (Math.abs(deltaBeta) < GYRO_DEADZONE) deltaBeta = 0;
  if (Math.abs(deltaGamma) < GYRO_DEADZONE) deltaGamma = 0;

  // Tilt becomes a target velocity. Left/right and up/down combine naturally into diagonals.
  const dx = deltaGamma * GYRO_TILT_SENSITIVITY * -1;
  const dy = deltaBeta * GYRO_TILT_SENSITIVITY;
  setGyroTarget(dx, dy);
  updateGyroDebug(beta, gamma, dx, dy);
}

function handleOrientation(e) {
  gyroLastOrientationTime = Date.now();
  const beta = e.beta || 0;
  const gamma = e.gamma || 0;
  processGyroData(beta, gamma);
}

// Fallback using devicemotion
function handleMotion(e) {
  if (!isGyroMode) return;
  const rr = e.rotationRate;
  if (!rr) return;

  // If deviceorientation is actively feeding data, keep using that.
  if (gyroLastOrientationTime && Date.now() - gyroLastOrientationTime < GYRO_MOTION_STALE_MS) return;

  const betaRate = rr.beta || 0;
  const gammaRate = rr.gamma || 0;

  let dx = gammaRate * GYRO_MOTION_SENSITIVITY * -1;
  let dy = betaRate * GYRO_MOTION_SENSITIVITY;

  if (Math.abs(dx) < GYRO_DEADZONE) dx = 0;
  if (Math.abs(dy) < GYRO_DEADZONE) dy = 0;

  dx = clamp(dx, -GYRO_MAX_SPEED, GYRO_MAX_SPEED);
  dy = clamp(dy, -GYRO_MAX_SPEED, GYRO_MAX_SPEED);

  setGyroTarget(dx, dy);
  updateGyroDebug(betaRate, gammaRate, dx, dy);
}

async function requestGyroPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const state = await DeviceOrientationEvent.requestPermission();
      return state === 'granted';
    } catch (err) {
      console.error('Gyro permission error:', err);
      return false;
    }
  }
  return true;
}

function enableGyro() {
  window.addEventListener('deviceorientation', handleOrientation);
  window.addEventListener('devicemotion', handleMotion);
  gyroLastFrameTime = performance.now();
  if (!gyroFrameHandle) {
    gyroFrameHandle = requestAnimationFrame(stepGyro);
  }
}

function disableGyro() {
  window.removeEventListener('deviceorientation', handleOrientation);
  window.removeEventListener('devicemotion', handleMotion);
  gyroCalibrated = false;
  gyroSampleCount = 0;
  gyroBaseBeta = 0;
  gyroBaseGamma = 0;
  gyroLastOrientationTime = 0;
  gyroTargetDx = 0;
  gyroTargetDy = 0;
  gyroVelocityDx = 0;
  gyroVelocityDy = 0;
  gyroLastFrameTime = 0;
  if (gyroFrameHandle) {
    cancelAnimationFrame(gyroFrameHandle);
    gyroFrameHandle = 0;
  }
  if (gyroDebug) gyroDebug.textContent = '';
}

function stepGyro(now) {
  if (!isGyroMode) {
    gyroFrameHandle = 0;
    return;
  }

  const elapsed = gyroLastFrameTime ? now - gyroLastFrameTime : 16;
  const dt = Math.max(8, Math.min(32, elapsed));
  gyroLastFrameTime = now;

  gyroVelocityDx += (gyroTargetDx - gyroVelocityDx) * GYRO_EMA;
  gyroVelocityDy += (gyroTargetDy - gyroVelocityDy) * GYRO_EMA;

  if (Math.abs(gyroTargetDx) < 0.01) gyroVelocityDx *= GYRO_DAMPING;
  if (Math.abs(gyroTargetDy) < 0.01) gyroVelocityDy *= GYRO_DAMPING;

  const frameScale = dt / 16.67;
  let dx = clamp(gyroVelocityDx * frameScale, -GYRO_MAX_STEP, GYRO_MAX_STEP);
  let dy = clamp(gyroVelocityDy * frameScale, -GYRO_MAX_STEP, GYRO_MAX_STEP);

  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
    batchedDx += dx;
    batchedDy += dy;
    moveVisualCursor(dx, dy);
  }

  gyroFrameHandle = requestAnimationFrame(stepGyro);
}

async function toggleGyroMode() {
  if (isGyroMode) {
    isGyroMode = false;
    disableGyro();
    trackpad.classList.remove('gyro-active');
    btnGyro.classList.remove('active');
    cursorHint.textContent = isScrollMode ? 'Scroll mode - drag up/down' : 'Touch & drag to move cursor';
    updateStatus('Gyro off', 'connected');
    return;
  }

  if (typeof DeviceOrientationEvent === 'undefined' && typeof DeviceMotionEvent === 'undefined') {
    updateStatus('Gyro not supported on this device', 'disconnected');
    setTimeout(() => updateStatus('Connected - Ready to control', 'connected'), 3000);
    return;
  }

  updateStatus('Requesting gyro permission...', 'connected');

  const permitted = await requestGyroPermission();
  if (!permitted) {
    updateStatus('Gyro permission denied. Tap Gyro again.', 'disconnected');
    return;
  }

  isGyroMode = true;
  enableGyro();
  trackpad.classList.add('gyro-active');
  btnGyro.classList.add('active');
  updateStatus('Hold phone still... calibrating', 'connected');

  // Safety: if no events after 4 seconds, warn user
  setTimeout(() => {
    if (isGyroMode && !gyroCalibrated) {
      updateStatus('No gyro data. Try: 1) HTTPS 2) Refresh', 'disconnected');
    }
  }, 4000);
}

btnGyro.addEventListener('click', toggleGyroMode);
btnGyro.addEventListener('touchstart', (e) => { e.preventDefault(); toggleGyroMode(); }, { passive: false });

// ─── Touch Trackpad ───

trackpad.addEventListener('touchstart', (e) => {
  e.preventDefault();

  if (e.touches.length === 2) {
    twoFingerTap = true;
    sendClick('right');
    return;
  }

  const touch = e.touches[0];
  lastX = touch.clientX;
  lastY = touch.clientY;
  isTouching = true;
  twoFingerTap = false;
  cursorHint.style.display = 'none';

  const now = Date.now();
  if (now - lastTapTime < 300) {
    tapCount++;
    if (tapCount === 2) {
      sendClick('left', true);
      tapCount = 0;
    }
  } else {
    tapCount = 1;
  }
  lastTapTime = now;
}, { passive: false });

function flushMovement() {
  if (batchedDx !== 0 || batchedDy !== 0) {
    if (isScrollMode && !isGyroMode) {
      sendScroll(0, Math.round(batchedDy));
    } else {
      sendMove(Math.round(batchedDx), Math.round(batchedDy));
    }
    batchedDx = 0;
    batchedDy = 0;
  }
  requestAnimationFrame(flushMovement);
}
requestAnimationFrame(flushMovement);

trackpad.addEventListener('touchmove', (e) => {
  e.preventDefault();

  if (isGyroMode) return;

  if (e.touches.length === 2) {
    const touch1 = e.touches[0];
    const touch2 = e.touches[1];
    const dy = ((touch1.clientY - lastY) + (touch2.clientY - lastY)) / 2;
    if (Math.abs(dy) > 5) {
      sendScroll(0, dy * 0.5);
    }
    lastY = (touch1.clientY + touch2.clientY) / 2;
    return;
  }

  if (!isTouching || twoFingerTap) return;

  const touch = e.touches[0];
  const dx = touch.clientX - lastX;
  const dy = touch.clientY - lastY;

  if (isScrollMode) {
    batchedDy += dy * -0.8;
  } else {
    const sensitivity = 1.8;
    batchedDx += dx * sensitivity;
    batchedDy += dy * sensitivity;
    moveVisualCursor(dx * sensitivity, dy * sensitivity);
  }

  lastX = touch.clientX;
  lastY = touch.clientY;
}, { passive: false });

trackpad.addEventListener('touchend', (e) => {
  e.preventDefault();

  if (batchedDx !== 0 || batchedDy !== 0) {
    if (isScrollMode && !isGyroMode) {
      sendScroll(0, Math.round(batchedDy));
    } else {
      sendMove(Math.round(batchedDx), Math.round(batchedDy));
    }
    batchedDx = 0;
    batchedDy = 0;
  }

  if (e.touches.length === 0) {
    isTouching = false;
    twoFingerTap = false;
  }

  if (!twoFingerTap && !isScrollMode && !isGyroMode && tapCount === 1 && Date.now() - lastTapTime < 300) {
    setTimeout(() => {
      if (tapCount === 1) {
        sendClick('left');
        tapCount = 0;
      }
    }, 300);
  }
});

function setupButton(btn, button) {
  const start = (e) => {
    e.preventDefault();
    btn.classList.add('active');
    sendMouseDown(button);
  };

  const end = (e) => {
    e.preventDefault();
    btn.classList.remove('active');
    sendMouseUp(button);
  };

  btn.addEventListener('mousedown', start);
  btn.addEventListener('mouseup', end);
  btn.addEventListener('mouseleave', end);
  btn.addEventListener('touchstart', start, { passive: false });
  btn.addEventListener('touchend', end, { passive: false });
}

setupButton(btnLeft, 'left');
setupButton(btnRight, 'right');

// Scroll mode toggle
function toggleScrollMode() {
  isScrollMode = !isScrollMode;
  if (isScrollMode) {
    btnScroll.classList.add('active');
    btnScroll.style.background = '#fff';
    btnScroll.style.color = '#000';
    cursorHint.textContent = 'Scroll mode - drag up/down to scroll';
    cursorHint.style.display = 'block';
  } else {
    btnScroll.classList.remove('active');
    btnScroll.style.background = '';
    btnScroll.style.color = '';
    cursorHint.textContent = isGyroMode ? 'Tilt phone to move cursor' : 'Touch & drag to move cursor';
  }
}

btnScroll.addEventListener('click', toggleScrollMode);
btnScroll.addEventListener('touchstart', (e) => { e.preventDefault(); toggleScrollMode(); }, { passive: false });

// Keyboard handling
let lastInputValue = '';
kbInput.addEventListener('input', (e) => {
  const val = kbInput.value;
  if (val.length > lastInputValue.length) {
    const added = val.slice(lastInputValue.length);
    sendType(added);
  } else if (val.length < lastInputValue.length) {
    const diff = lastInputValue.length - val.length;
    for (let i = 0; i < diff; i++) {
      sendSpecialKey('BACKSPACE');
    }
  }
  lastInputValue = val;
});

kbInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendSpecialKey('ENTER');
    kbInput.value = '';
    lastInputValue = '';
  }
});

specialKeys.querySelectorAll('.key-btn').forEach((btn) => {
  const handler = (e) => {
    e.preventDefault();
    const key = btn.dataset.key;
    if (key === 'SPACE') {
      sendType(' ');
    } else {
      sendSpecialKey(key);
    }
  };
  btn.addEventListener('click', handler);
  btn.addEventListener('touchstart', handler, { passive: false });
});

modifierKeys.querySelectorAll('.mod-btn').forEach((btn) => {
  const handler = (e) => {
    e.preventDefault();
    const mod = btn.dataset.mod;
    if (activeModifiers.has(mod)) {
      activeModifiers.delete(mod);
      btn.classList.remove('active');
    } else {
      activeModifiers.add(mod);
      btn.classList.add('active');
    }
  };
  btn.addEventListener('click', handler);
  btn.addEventListener('touchstart', handler, { passive: false });
});

// Initialize visual cursor position
updateVisualCursor();

