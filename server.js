const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    } 
  }
  return 'localhost';
}

// Persistent PowerShell for fast mouse control without native modules
const ps = spawn('powershell.exe', ['-NoProfile', '-Command', '-']);

ps.stderr.on('data', (data) => {
  console.error('PS Error:', data.toString());
});

ps.on('exit', (code) => {
  console.log('PowerShell exited with code', code);
});

// Initialize PowerShell helper functions
const initScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int buttons, int extraInfo);' -Name Win32Mouse -Namespace Win32Functions
function Move-Mouse($x, $y) { [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y) }
function Click-LeftDown() { [Win32Functions.Win32Mouse]::mouse_event(0x0002, 0, 0, 0, 0) }
function Click-LeftUp() { [Win32Functions.Win32Mouse]::mouse_event(0x0004, 0, 0, 0, 0) }
function Click-RightDown() { [Win32Functions.Win32Mouse]::mouse_event(0x0008, 0, 0, 0, 0) }
function Click-RightUp() { [Win32Functions.Win32Mouse]::mouse_event(0x0010, 0, 0, 0, 0) }
function Scroll-Vertical($delta) { [Win32Functions.Win32Mouse]::mouse_event(0x0800, 0, 0, $delta, 0) }
function Send-Text($text) { [System.Windows.Forms.SendKeys]::SendWait($text) }
function Send-Special($key) { [System.Windows.Forms.SendKeys]::SendWait($key) }
`;

ps.stdin.write(initScript + '\n');

let currentX = 0;
let currentY = 0;

function runPs(cmd) {
  if (ps.stdin.writable) {
    ps.stdin.write(cmd + '\n');
  }
}

let serverBatchedDx = 0;
let serverBatchedDy = 0;
let serverMoveTimeout = null;

function flushServerMove() {
  if (serverBatchedDx !== 0 || serverBatchedDy !== 0) {
    currentX += serverBatchedDx;
    currentY += serverBatchedDy;
    runPs(`Move-Mouse ${currentX} ${currentY}`);
    serverBatchedDx = 0;
    serverBatchedDy = 0;
  }
  serverMoveTimeout = null;
}

function moveMouse(dx, dy) {
  serverBatchedDx += dx;
  serverBatchedDy += dy;
  if (!serverMoveTimeout) {
    serverMoveTimeout = setTimeout(flushServerMove, 8);
  }
}

function mouseClick(button, double = false) {
  const b = button || 'left';
  if (b === 'left') {
    runPs('Click-LeftDown');
    setTimeout(() => runPs('Click-LeftUp'), 50);
    if (double) {
      setTimeout(() => {
        runPs('Click-LeftDown');
        setTimeout(() => runPs('Click-LeftUp'), 50);
      }, 100);
    }
  } else if (b === 'right') {
    runPs('Click-RightDown');
    setTimeout(() => runPs('Click-RightUp'), 50);
  }
}

function mouseToggle(direction, button) {
  const b = button || 'left';
  if (b === 'left') {
    if (direction === 'down') runPs('Click-LeftDown');
    else runPs('Click-LeftUp');
  } else if (b === 'right') {
    if (direction === 'down') runPs('Click-RightDown');
    else runPs('Click-RightUp');
  }
}

function scrollMouse(delta) {
  runPs(`Scroll-Vertical ${Math.round(delta)}`);
}

const specialKeyMap = {
  'ESC': '{ESC}',
  'TAB': '{TAB}',
  'ENTER': '{ENTER}',
  'BACKSPACE': '{BACKSPACE}',
  'DELETE': '{DELETE}',
  'UP': '{UP}',
  'DOWN': '{DOWN}',
  'LEFT': '{LEFT}',
  'RIGHT': '{RIGHT}',
  'HOME': '{HOME}',
  'END': '{END}',
  'PGUP': '{PGUP}',
  'PGDN': '{PGDN}',
  'F5': '{F5}',
  'WIN': '#'
};

const modifierMap = {
  'ctrl': '^',
  'shift': '+',
  'alt': '%'
};

function sendText(text) {
  const escaped = text.replace(/([+^%~(){}\[\]])/g, '{$1}');
  runPs(`Send-Text "${escaped.replace(/"/g, '`"')}"`);
}

function sendSpecialKey(key, modifiers = []) {
  const mapped = specialKeyMap[key] || key;
  const prefix = modifiers.map(m => modifierMap[m] || '').join('');
  runPs(`Send-Special "${prefix}${mapped.replace(/"/g, '`"')}"`);
}

io.on('connection', (socket) => {
  console.log('Phone connected:', socket.id);

  socket.on('mouse-move', (data) => {
    const { dx, dy } = data;
    moveMouse(dx, dy);
  });

  socket.on('mouse-click', (data) => {
    const { button, double } = data || {};
    mouseClick(button, double);
  });

  socket.on('mouse-down', (data) => {
    const { button } = data || {};
    mouseToggle('down', button);
  });

  socket.on('mouse-up', (data) => {
    const { button } = data || {};
    mouseToggle('up', button);
  });

  socket.on('scroll', (data) => {
    const { dy } = data;
    if (dy !== 0) {
      scrollMouse(dy * -3);
    }
  });

  socket.on('type-text', (data) => {
    const { text } = data || {};
    if (text) sendText(text);
  });

  socket.on('special-key', (data) => {
    const { key, modifiers } = data || {};
    if (key) sendSpecialKey(key, modifiers || []);
  });

  socket.on('disconnect', () => {
    console.log('Phone disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  const ip = getLocalIp();
  console.log(`\n========================================`);
  console.log(`Remote Trackpad Server running!`);
  console.log(`Open on your phone: http://${ip}:${PORT}`);
  console.log(`========================================\n`);
});

