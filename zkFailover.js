require('dotenv').config();

process.on('unhandledRejection', (reason) => {
  console.error('🚨 Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception:', err);
});

const moment = require('moment');
const path = require("path");
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const DeviceManager = require('./deviceManager');
const app = express();
const server = http.createServer(app);

// 🧹 --- CLEANUP OLD LISTENERS ---
process.removeAllListeners('SIGINT');
process.removeAllListeners('SIGTERM');
server.removeAllListeners('close');

// 🧠 Create fresh socket.io instance
const io = new Server(server, {
  cors: { origin: '*', credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
});
let global = {};
// Make io globally accessible (optional)
global.io = io;

// 🧩 Env vars
const ATTIP = process.env.ZK_IP ?? '0.0.0.0';
const ATTPORT = process.env.ZK_PORT ?? '3421';

// Static + routes
app.use(express.static('public'));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

let deviceManager = null;

// 🧩 Start server cleanly
server.listen(ATTPORT, ATTIP, async () => {
  console.log(`[Server] Listening on ${ATTIP}:${ATTPORT}`);

  try {
    deviceManager = new DeviceManager(io);

    // Timeout safeguard (prevents infinite hang)
    await Promise.race([
      deviceManager.init(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Init timeout')), 10000))
    ]);

    global.zkManager = deviceManager;
  } catch (err) {
    console.error('[Server] ❌ DeviceManager init failed:', err.message);
  }

  io.on('connection', (socket) => {
    console.log('[Socket] Frontend connected:', socket.id);

    if (!deviceManager) {
      socket.emit('initError', { message: 'DeviceManager not initialized' });
      return;
    }

    // 1️⃣ Send historical attendance asynchronously
    (async () => {
      try {
        const logs = await deviceManager.getDeviceAttendanceRecords();
        //logs.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
        console.log(`[Socket] Sending ${logs.length} historical attendance logs...`);
        socket.emit('attendanceLogs', logs);
      } catch (err) {
        socket.emit('attendanceError', { message: err.message });
      }
    })();

    // 2️⃣ Realtime attendance
    const realtimeHandler = (log) => {
      socket.emit('realtimeAttendance', log);
    };
    deviceManager.on('attendance:realtime', realtimeHandler);

    // 3️⃣ Frontend requested attendance (optional, can duplicate)
    socket.on('getAttendanceLogs', async () => {
      try {
        const logs = await deviceManager.getDeviceAttendanceRecords();
        //logs.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
        console.log(`[Socket] Sending ${logs.length} realtime attendance logs...`);
        socket.emit('attendanceLogs', logs);
      } catch (err) {
        socket.emit('attendanceError', { message: err.message });
      }
    });

    // 4️⃣ Cleanup
    socket.on('disconnect', () => {
      console.log('[Socket] Frontend disconnected:', socket.id);
      deviceManager.off('attendance:realtime', realtimeHandler);
    });
  });

});

// 🧹 Graceful shutdown for PM2 restarts
const gracefulShutdown = () => {
  console.log('[Server] Gracefully shutting down...');
  io.close(() => console.log('[Socket.IO] Closed.'));
  server.close(() => {
    console.log('[HTTP] Server closed.');
    process.exit(0);
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
