// deviceManager.js
const ZKLib = require('node-zklib/zklib');
const moment = require('moment');
const { checkPortReachable } = require('./ipreachable');
const { getActiveDevices, getCurrentUsers } = require('./dbrecord');
const { handleRealtimeLog, handleDeviceLogs } = require('./helpers/attendanceLogsHandler');
const DeviceConnection = require('./DeviceConnection');

const zkTimeoutDuration = Number.parseInt(process.env.ZKTIMEOUT_DURATION, 10) || 20000;
const zkImportDuration = Number.parseInt(process.env.ZKINPORT_DURATION, 10) || 30000;

class DeviceManager {
  constructor(io) {
    this.io = io;
    this.devices = new Map(); // Map<ip, { device, zk, connected, lastStatus }>
    this.commandQueues = new Map();
    this.heartbeatInterval = 30000;

    this.currentUsers = {};
    // ZKLib class reference
    this.ZKLib = ZKLib;

    // Set default ZK timeout/import durations
    this.zkTimeoutDuration = zkTimeoutDuration;   // e.g., 5000ms socket timeout
    this.zkImportDuration = zkImportDuration;    // e.g., 5000ms for import operations

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

    await this.getDeviceAttendanceRecords();
    this.startHeartbeat();
  }

  async loadUsers() {
    try {
      const users = await getCurrentUsers();
      this.currentUsers = users.reduce((acc, user) => {
        acc[user.biometricno] = user.employee_name;
        return acc;
      }, {});
      console.log('[DeviceManager] Loaded current users and images');
    } catch (err) {
      console.error('[DeviceManager] Failed to load users:', err.message);
      this.currentUsers = {};
    }
  }

  async connect(device) {
    const { ip, port } = device;

    if (this.devices.has(ip)) {
      const conn = this.devices.get(ip);
      if (conn.isConnected()) return;
    }

    const { reachable } = await checkPortReachable(ip, port);
    if (!reachable) return;

    try {
      const zk = new this.ZKLib(
        ip,
        port,
        this.zkTimeoutDuration,
        this.zkImportDuration
      );

      await zk.createSocket();
      await zk.enableDevice();

      const conn = new DeviceConnection({
        ip,
        device,
        zk,
        io: this.io,
        onRealtimeLog: this.handleRealtime.bind(this),
      });

      conn.attachSocket();
      await conn.startRealtime();
      this.devices.set(ip, conn);

      console.log(`[${ip}] ✅ Connected via DeviceConnection`);
    } catch (err) {
      console.error(`[${ip}] ❌ Connect failed`, err.message);
    }
  }

  async getDeviceAttendanceRecords() {
    const today = moment().format('YYYY-MM-DD');
    const allRecords = [];

    for (const [ip, conn] of this.devices.entries()) {
      if (!conn.isConnected()) continue;

      try {
        const logs = await conn.exec(
          () => conn.zk.getAttendances(),
          'GET_ATTENDANCES'
        );

        const formatted = logs.data
          .map(log => {
            handleDeviceLogs(log, conn.device.device_id);
            return {
              datetime: moment(log.recordTime).format('YYYY-MM-DD HH:mm:ss'),
              deviceUserId: log.deviceUserId,
              deviceName: conn.device.device_name,
              ip,
            };
          })
          .filter(r => r.datetime.startsWith(today));

        allRecords.push(...formatted);
      } catch (err) {
        console.error(`[${ip}] ⚠ Attendance fetch failed:`, err.message);
      }
    }

    return allRecords.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  }

  async handleRealtime({ ip, device, data }) {
  try {
    const response = await handleRealtimeLog(data, device.id);

    if (response?.success) {
      this.io.emit('attendance:realtime', {
        ip,
        deviceName: device.device_name,
        deviceUserId: data.deviceUserId,
        datetime: moment(data.recordTime).format('YYYY-MM-DD HH:mm:ss'),
      });
    } else {
      console.warn(`[${ip}] ⚠ Realtime insert failed`);
    }
  } catch (err) {
    console.error(`[${ip}] ❌ Realtime error:`, err.message);
  }
}

  getConnectedDevices() {
    return Array.from(this.devices.values())
      .filter(r => r.connected)
      .map(r => r.device);
  }

  startHeartbeat() {
    setInterval(() => {
      for (const [ip, conn] of this.devices.entries()) {
        if (!conn.isConnected()) continue;
        this.runHeartbeat(ip, conn);
      }
    }, this.heartbeatInterval);
  }

  async runHeartbeat(ip, conn) {
    try {
      await conn.exec(async () => {
        if (typeof conn.zk.getInfo === 'function') {
          return conn.zk.getInfo();
        }
        if (typeof conn.zk.getTime === 'function') {
          return conn.zk.getTime();
        }
        throw new Error('No heartbeat command available');
      }, 'HEARTBEAT');
      return true;
    } catch (err) {
      console.warn(`[${ip}] 💔 Heartbeat failed: ${err.message}`);
      await this.healDevice(ip);
      return false;
    }
  }

  async healDevice(ip) {
    const conn = this.devices.get(ip);
    if (!conn) return;

    await conn.disconnect();
    this.devices.delete(ip);

    await this.connect(conn.device);
  }
}

module.exports = DeviceManager;