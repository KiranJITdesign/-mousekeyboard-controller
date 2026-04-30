# Fix Cursor & Gyro - TODO

- [x] 1. Fix `server.js`: Replace absolute `Move-Mouse` with Win32 relative `mouse_event(0x0001, dx, dy, 0, 0)`
- [x] 2. Fix `public/script.js`: Rewrite gyro engine using `devicemotion.rotationRate` with velocity physics, damping, and EMA smoothing
- [x] 3. Fix `public/script.js`: Make visual cursor dot behave correctly in gyro mode (velocity indicator)
- [x] 4. Fix `public/style.css`: Add smooth transition for gyro cursor dot
- [ ] 5. Test server startup

