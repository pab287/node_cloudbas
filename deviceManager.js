// deviceManager.js
const EventEmitter = require('events');
const ZKLib = require('node-zklib/zklib');
const moment = require('moment');
const { checkPortReachable } = require('./ipreachable');
const { getActiveDevices, getCurrentUsers } = require('./dbrecord');
const { handleRealtimeLog, handleDeviceLogs } = require('./helpers/attendanceLogsHandler');
const { startReconnectWatcher } = require('./helpers/reconnectWatcher');

const SmsQueue = require('./helpers/smsQueue');
const { sendSms } = require('./helpers/smsSender');

const zkTimeoutDuration = Number.parseInt(process.env.ZKTIMEOUT_DURATION, 10) || 20000;
const zkImportDuration = Number.parseInt(process.env.ZKINPORT_DURATION, 10) || 30000;
const COMMANDS = require('node-zklib/constants');

class DeviceManager extends EventEmitter {
  constructor(io) {
    super();
    this.io = io;
    this.devices = new Map(); // Map<ip, { device, zk, connected, lastStatus }>
    this.commandQueues = new Map();
    this.heartbeatInterval = 30000;

    this.smsQueue = new SmsQueue(sendSms);

    this.currentUsers = {};
    this.currentUsersImage = {};
    this.currentUsersMobileNo = {};

    // ZKLib class reference
    this.ZKLib = ZKLib;

    // Set default ZK timeout/import durations
    this.zkTimeoutDuration = zkTimeoutDuration;   // e.g., 5000ms socket timeout
    this.zkImportDuration = zkImportDuration;    // e.g., 5000ms for import operations

    this.realtimeBuffer = [];
    this.realtimeFlushInterval = 500; // ms
  }

  // Initialize devices
  async init() {
    console.log('[DeviceManager] ZK Failover Initializing...');
    await this.loadUsers();
    const devices = await getActiveDevices();
    const batchSize = 5;
    for (let i = 0; i < devices.length; i += batchSize) {
      const batch = devices.slice(i, i + batchSize);
      await Promise.all(batch.map(device => this.connect(device)));
    }
    await this.realTimeLogs();
    this.startRealtimeFlush();
    await this.getDeviceAttendanceRecords();
    this.startHeartbeat();

    startReconnectWatcher(this, 10000);
  }

  async loadUsers() {
    try {
      const users = await getCurrentUsers();
      this.currentUsers = users.reduce((acc, user) => {
        acc[user.biometricno] = user.employee_name;
        return acc;
      }, {});

      this.currentUsersImage = users.reduce((acc, user) => {
        acc[user.biometricno] = user.thumb_path;
        return acc;
      }, {});

      this.currentUsersMobileNo = users.reduce((acc, user) => {
        acc[user.biometricno] = user.mobileno;
        return acc;
      }, {});

      console.log('[DeviceManager] Loaded current users and images');
    } catch (err) {
      console.error('[DeviceManager] Failed to load users:', err.message);
      this.currentUsers = {};
      this.currentUsersImage = {};
      this.currentUsersMobileNo = {};
    }
  }

  async connect(device, reconnecting = false) {
    const { ip, port } = device;
    let rec = this.devices.get(ip);

    if (!rec) {
      rec = {
        device,
        zk: null,
        connected: false,
        realtimeListening: false,
        lastStatus: 'offline',
        lastSeen: Date.now(),
        socketBound: false,
        reconnecting: reconnecting ?? false,
        lastError: null,
      };
      this.devices.set(ip, rec);
    }

    if (rec.connected) return;

    const { reachable } = await checkPortReachable(ip, port);
    if (!reachable) return;

    rec.zk ??= new this.ZKLib(ip, port, this.zkTimeoutDuration, this.zkImportDuration);

    try {
      await rec.zk.createSocket();
      await rec.zk.enableDevice();
      rec.connected = true;
      rec.lastSeen = Date.now();

      this.bindSocketEvents(ip, rec);

      if(reconnecting) console.log(`[${ip}] ✅ Reconnected`);
      else console.log(`[${ip}] ✅ Connected`);

    } catch (err) {
      rec.connected = false;
      const command = err?.command || 'UNKNOWN_COMMAND';
      const message = err?.err?.message || err?.message || 'Unknown error';
      const ip = err?.ip || 'Unknown IP';
      
      rec.lastError = {
        command,
        message,
        timestamp: Date.now()
      };

      console.error(`[${ip}] ❌ Connection failed | Command: ${command} | Error: ${message}`);
    }
  }

  async getDeviceAttendanceRecords() {
    const today = moment().format('YYYY-MM-DD');
    const allRecords = [];

    for (const [ip, rec] of this.devices.entries()) {
      if (!rec.connected || !rec.zk) continue;
      try {
        const logs = await this.enqueueCommand(ip, async () => rec.zk.getAttendances());

        const formatted = logs.data
          .map(log => {
            handleDeviceLogs(log, rec.device.device_id);
            const dt = new Date(log.recordTime);
            return {
              datetime: dt,
              deviceUserId: log.deviceUserId,
              deviceName: rec.device.device_name,
              ip,
              userName: this.currentUsers[log.deviceUserId] || log.deviceUserId,
              userImage: this.currentUsersImage[log.deviceUserId] || 'assets/media/avatars/blank.png',
              _ts: dt.getTime()
            };
          })
          .filter(r => moment(r.datetime).format('YYYY-MM-DD') === today);

        allRecords.push(...formatted);
      } catch (err) {
        console.error(`[${ip}] ⚠ Attendance fetch failed: ${err.message}`);
      }
    }

    // Sort newest → oldest
    allRecords.sort((a, b) => a._ts - b._ts);
    
    // Return with formatted datetime string
    return allRecords.map(({ _ts, datetime, ...rest }) => ({
      ...rest,
      datetime: moment(datetime).format('YYYY-MM-DD HH:mm:ss')
    }));
  }

  async startRealtime(rec, ip) {
    if (rec.realtimeListening || !rec.connected) return;

    rec.realtimeListening = true;

    rec.zk.getRealTimeLogs(data => {
      setImmediate(() => {
        this.processRealtimeLog(data, rec, ip)
          .catch(err =>
            console.error(`[${ip}] realtime handler error`, err.message)
          );
      });
    });
  }

  async realTimeLogs() {
    for (const [ip, rec] of this.devices.entries()) {
      if (!rec.connected || !rec.zk) continue;
      await this.startRealtime(rec, ip);
    }
  }

  async processRealtimeLog(data, rec, ip) {
    try {
      const response = await handleRealtimeLog(data, rec.device.id);
      if (response?.success) {
        const dt = new Date(data.attTime); // ⚡ Use Date
        const payload = {
          ip,
          deviceName: rec.device.device_name,
          deviceUserId: data.userId,
          datetime: dt,
          userName: this.currentUsers[data.userId] || data.userId,
          userImage: this.currentUsersImage[data.userId] || 'assets/media/avatars/blank.png',
          _ts: dt.getTime()  // numeric timestamp for sorting
        };

        this.realtimeBuffer.push(payload);

        const smsMobileNo = this.currentUsersMobileNo[data.userId] || null;
        this.sendSmsQueueNotification(smsMobileNo, payload);
      } else {
        console.warn(
          `[${ip}] ⚠️ Failed to insert attendance log: ${response?.message}`
        );
      }
    } catch (err) {
      console.error(`[${ip}] ⚠️ Failed to insert attendance log: ${err.message}`);
    }
  }

  async sendSmsQueueNotification(mobileno, data) {
    if(mobileno){
      const smsPayload = {
        to: mobileno,
        message: `Hello ${data.userName}, you have an attendance record on ${moment(data.datetime).format('YYYY-MM-DD HH:mm:ss')}
        \n This is an automated message. Please disregard.`,
      };
      this.smsQueue.enqueue(smsPayload);
    }
  }

  logSocketListeners(ip, socket, label = 'status') {
    if (!socket) return;
    console.log(`[${ip}] 🔍 Socket listener counts (${label}):`);
    const counts = {};
    ['data','close','error','end','timeout'].forEach(ev => {
      counts[ev] = socket.listenerCount(ev);
    });
  }

  getConnectedDevices() {
    return Array.from(this.devices.values())
      .filter(r => r.connected)
      .map(r => r.device);
  }

  getInstance(ip) {
    return this.devices.get(ip)?.zk || null;
  }

  enqueueCommand(ip, fn) {
    const prev = this.commandQueues.get(ip) || Promise.resolve();

    const next = prev
      .then(() => fn())
      .catch(err => {
        console.error(`[${ip}] ❌ Command failed:`, err.message);
        console.error(err);
        console.error(`[${ip}] ❌ Command failed!!!`);
        throw err;
      });

    // Prevent unhandled rejection chain break
    this.commandQueues.set(ip, next.catch(() => {}));

    return next;
  }

  startHeartbeat() {
    setInterval(() => {
      for (const [ip, rec] of this.devices.entries()) {
        if (!rec.connected || !rec.zk) continue;
        this.runHeartbeat(ip, rec);
      }
    }, this.heartbeatInterval);
  }

  async runHeartbeat(ip, rec) {
    try {
      const now = Date.now();

      // 1️⃣ silent death detection
      if (rec.lastSeen && now - rec.lastSeen > this.heartbeatInterval * 2) {
        throw new Error('Device unresponsive (silent)');
      }

      // 2️⃣ guarded heartbeat command
      await this.enqueueCommand(ip, () =>
        this.withTimeout(
          (async () => {
            if (typeof rec.zk.getInfo === 'function') {
              const info = await rec.zk.getInfo();
              rec.lastSeen = Date.now();
              return info;
            }

            // optional fallback (remove if unused)
            return rec.zk.executeCmd(COMMANDS.CMD_GET_FREE_SIZES, '');
          })(),
          5000,
          'heartbeat'
        )
      );

    } catch (err) {
      console.warn(`[${ip}] 💔 Heartbeat failed: ${err.message}`);
      console.error(err);
      console.error(`[${ip}] 💔 Heartbeat failed!!!`);
      await this.healDevice(ip);
      return false;
    }

    return true;
  }


  async healDevice(ip) {
    const rec = this.devices.get(ip);
    if (!rec || rec.reconnecting) return;
    rec.reconnecting = true;

    try {
      if (rec.zk?.zklibTcp?.socket) {
        rec.zk.zklibTcp.socket.removeAllListeners();
        rec.zk.zklibTcp.socket.destroy();
      }
    } catch {}

    rec.socketBound = false;
    rec.connected = false;
    rec.realtimeListening = false;

    await new Promise(r => setTimeout(r, 3000));

    try {
      rec.zk = new this.ZKLib(
        rec.device.ip,
        rec.device.port,
        this.zkTimeoutDuration,
        this.zkImportDuration
      );
  
      await this.connect(rec.device, true);
      if(rec.connected){
        await this.startRealtime(rec, ip);
        console.log(`[${ip}] ✅ Device reconnected`);
        rec.lastSeen = Date.now();
      }
    } catch (err) {
      console.error(`[${ip}] ❌ Device reconnection failed: ${err.message}`);
    }

    rec.reconnecting = false;
  }

  withTimeout(promise, ms, label = 'operation') {
    let t;
    const timeout = new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    });

    return Promise.race([promise, timeout])
      .finally(() => clearTimeout(t));
  }

  bindSocketEvents(ip, rec) {
    const socket = rec.zk?.zklibTcp?.socket;
    if (!socket || rec.socketBound) return;

    rec.socketBound = true;

    socket.on('close', () => {
      console.warn(`[${ip}] 🔌 socket closed`);
      this.healDevice(ip);
    });

    socket.on('error', err => {
      console.warn(`[${ip}] 💥 socket error: ${err.message}`);
      this.healDevice(ip);
    });

    socket.on('timeout', () => {
      console.warn(`[${ip}] ⏱ socket idle timeout`);
    });
  }

  startRealtimeFlush() {
    setInterval(() => {
      if (!this.realtimeBuffer.length) return;

      // Sort newest → oldest
      this.realtimeBuffer.sort((a, b) => a._ts - b._ts);

      for (const item of this.realtimeBuffer) {
        const { _ts, datetime, ...payload } = item;
        this.emit('attendance:realtime', {
          ...payload,
          datetime: moment(datetime).format('YYYY-MM-DD HH:mm:ss')
        });
        this.io.emit('attendance:realtime', {
          ...payload,
          datetime: moment(datetime).format('YYYY-MM-DD HH:mm:ss')
        });
      }

      this.realtimeBuffer.length = 0;
    }, this.realtimeFlushInterval);
  }

}

module.exports = DeviceManager;