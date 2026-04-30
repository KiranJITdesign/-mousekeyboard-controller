const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const BASE_PORT_HTTP = parseInt(process.env.PORT) || 3000;
const BASE_PORT_HTTPS = 3443;

function findAvailablePort(startPort, callback) {
  const net = require('net');
  const server = net.createServer();
  server.listen(startPort, () => {
    const port = server.address().port;
    server.close(() => callback(null, port));
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      findAvailablePort(startPort + 1, callback);
    } else {
      callback(err);
    }
  });
}

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
function Move-MouseRelative($dx, $dy) { [Win32Functions.Win32Mouse]::mouse_event(0x0001, $dx, $dy, 0, 0) }
function Click-LeftDown() { [Win32Functions.Win32Mouse]::mouse_event(0x0002, 0, 0, 0, 0) }
function Click-LeftUp() { [Win32Functions.Win32Mouse]::mouse_event(0x0004, 0, 0, 0, 0) }
function Click-RightDown() { [Win32Functions.Win32Mouse]::mouse_event(0x0008, 0, 0, 0, 0) }
function Click-RightUp() { [Win32Functions.Win32Mouse]::mouse_event(0x0010, 0, 0, 0, 0) }
function Scroll-Vertical($delta) { [Win32Functions.Win32Mouse]::mouse_event(0x0800, 0, 0, $delta, 0) }
function Send-Text($text) { [System.Windows.Forms.SendKeys]::SendWait($text) }
function Send-Special($key) { [System.Windows.Forms.SendKeys]::SendWait($key) }
`;

ps.stdin.write(initScript + '\n');

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
    runPs(`Move-MouseRelative ${Math.round(serverBatchedDx)} ${Math.round(serverBatchedDy)}`);
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
  const escaped = text.replace(/([+^%~(){}[]])/g, '{$1}');
  runPs(`Send-Text "${escaped.replace(/"/g, '\`"')}"`);
}

function sendSpecialKey(key, modifiers = []) {
  const mapped = specialKeyMap[key] || key;
  const prefix = modifiers.map(m => modifierMap[m] || '').join('');
  runPs(`Send-Special "${prefix}${mapped.replace(/"/g, '\`"')}"`);
}

function setupSocketIO(serverInstance) {
  const io = new Server(serverInstance);
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
}

const ip = getLocalIp();

// Start HTTP server on an available port
findAvailablePort(BASE_PORT_HTTP, (err, PORT_HTTP) => {
  if (err) {
    console.error('Failed to find available port:', err);
    process.exit(1);
  }

  const httpServer = http.createServer(app);
  setupSocketIO(httpServer);
  httpServer.listen(PORT_HTTP, () => {
    console.log(`\n========================================`);
    console.log(`Remote Trackpad Server running!`);
    console.log(`HTTP:  http://${ip}:${PORT_HTTP}`);

    // Start HTTPS server if certs exist
    let hasHttps = false;
    try {
      const key = fs.readFileSync('key.pem');
      const cert = fs.readFileSync('cert.pem');
      findAvailablePort(BASE_PORT_HTTPS, (errHttps, PORT_HTTPS) => {
        if (errHttps) {
          console.log('HTTPS: Could not find available port');
          return;
        }
        const httpsServer = https.createServer({ key, cert }, app);
        setupSocketIO(httpsServer);
        httpsServer.listen(PORT_HTTPS, () => {
          hasHttps = true;
          console.log(`HTTPS: https://${ip}:${PORT_HTTPS}  <-- Use this for GYRO`);
          console.log(`========================================\n`);
          console.log(`For gyro to work on your phone:`);
          console.log(`1. Open the HTTPS URL above on your phone`);
          console.log(`2. Tap "Advanced" -> "Proceed" to accept the self-signed cert`);
          console.log(`3. Then tap the Gyro button\n`);
        });
      });
    } catch (err) {
      console.log(`HTTPS: NOT AVAILABLE (cert files missing)`);
      console.log(`========================================\n`);
      console.log(`To enable HTTPS for gyro support:`);
      console.log(`  cd c:\\Users\\soudr\\OneDrive\\Desktop\\mtm`);
      console.log(`  node setup-cert.js`);
      console.log(`\n`);
    }

    if (!hasHttps) {
      console.log(`For gyroscope (phone tilt) to work, you need HTTPS.`);
      console.log(`Touch trackpad still works fine over HTTP.\n`);
    }
  });
});

