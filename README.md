# Remote Trackpad & Gesture Control

A real-time phone-to-PC remote trackpad system built using Node.js, Express, and Socket.IO.
This project transforms a smartphone into a wireless touchpad, keyboard, and motion controller for a Windows computer.

## Features

* Real-time wireless mouse control
* Multi-touch trackpad support
* Left & right click controls
* Keyboard input mode
* Gyroscope-based cursor movement
* Socket.IO low-latency communication
* HTTPS support using self-signed certificates
* Windows automation through PowerShell

## Tech Stack

### Backend

* Node.js
* Express.js
* Socket.IO
* PowerShell Automation

### Frontend

* HTML5
* CSS3
* Vanilla JavaScript

## Project Structure

```bash
├── package.json
├── server.js
├── setup-cert.js
├── key.pem
├── cert.pem
├── cert.pfx
├── TODO.md
└── public
    ├── index.html
    ├── script.js
    └── style.css
```

## Working

1. The Node.js server hosts the web application.
2. A smartphone connects to the server through a browser.
3. Touch gestures and keyboard inputs are sent via Socket.IO.
4. The backend converts these actions into Windows mouse and keyboard events using PowerShell.
5. Optional HTTPS support improves secure local-network communication.

## Setup

```bash
npm install
node server.js
```

Open:

```bash
http://<your-ip>:3000
```

For HTTPS:

```bash
node setup-cert.js
```

Then access:

```bash
https://<your-ip>:3443
```

## Future Improvements

* Multi-device support
* Custom gesture mapping
* File transfer support
* Media control shortcuts
* Cross-platform compatibility
* Mobile app version

## Use Cases

* Remote presentations
* Smart TV/media control
* Wireless PC interaction
* Accessibility assistance
* DIY IoT & automation projects

  # demo
<img width="500" alt="Remote Trackpad UI" src="https://github.com/user-attachments/assets/3ef4c214-f3c8-4fa8-b0e1-ac97c59befb9" />

<img width="1080" height="2400" alt="631898cf-9520-4148-8cf9-4bcee173c287" src="https://github.com/user-attachments/assets/19f0c319-ccf7-4deb-9e36-3c25ce8363a8" />
  
