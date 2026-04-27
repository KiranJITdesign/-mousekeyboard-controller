 const socket = io();
const statusEl = document.getElementById('status');
const trackpad = document.getElementById('trackpad');
const cursorHint = document.getElementById('cursor-hint');
const btnLeft = document.getElementById('btn-left');
const btnRight = document.getElementById('btn-right');
const btnScroll = document.getElementById('btn-scroll');
const btnMode = document.getElementById('btn-mode');
const keyboard = document.getElementById('keyboard');
const kbInput = document.getElementById('kb-input');
const specialKeys = document.getElementById('special-keys');
const modifierKeys = document.getElementById('modifier-keys');

let lastX = 0;
let lastY = 0;
let isTouching = false;
let twoFingerTap = false;
let lastTapTime = 0;
let tapCount = 0;
let isKeyboardMode = false;
let activeModifiers = new Set();
let isScrollMode = false;

// Batched movement for lower latency
let batchedDx = 0;
let batchedDy = 0;
let lastSendTime = 0;
const SEND_INTERVAL = 16; // ~60fps

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
    if (isScrollMode) {
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
  }

  lastX = touch.clientX;
  lastY = touch.clientY;
}, { passive: false });

trackpad.addEventListener('touchend', (e) => {
  e.preventDefault();

  // flush any remaining batched movement immediately
  if (batchedDx !== 0 || batchedDy !== 0) {
    if (isScrollMode) {
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

  if (!twoFingerTap && !isScrollMode && tapCount === 1 && Date.now() - lastTapTime < 300) {
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
    btnScroll.style.background = '#e94560';
    btnScroll.style.color = '#fff';
    cursorHint.textContent = 'Scroll mode - drag up/down to scroll';
    cursorHint.style.display = 'block';
  } else {
    btnScroll.classList.remove('active');
    btnScroll.style.background = '';
    btnScroll.style.color = '';
    cursorHint.textContent = 'Touch & drag to move cursor';
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

