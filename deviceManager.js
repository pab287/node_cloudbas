// deviceManager.js
const EventEmitter = require('node:events');
const ZKLib = require('node-zklib/zklib');
const moment = require('moment');
const { checkPortReachable } = require('./ipreachable');
const { getActiveDevices, getCurrentUsers, getCurrentAttendanceLogs } = require('./dbrecord');
const { handleRealtimeLog, handleDeviceLogs } = require('./helpers/attendanceLogsHandler');
const { startReconnectWatcher } = require('./helpers/reconnectWatcher');
const { sendTelegramMessage } = require('./helpers/sendTelegramHelper');
const { enqueueRemoteAttendanceSync } = require('./helpers/remoteSyncQueue');

const TelegramQueue = require('./helpers/telegramQueue');
const SmsQueue = require('./helpers/smsQueue');
const { sendSms } = require('./helpers/smsSender');

const zkTimeoutDuration = Number.parseInt(process.env.ZKTIMEOUT_DURATION, 10) || 20000;
const zkImportDuration = Number.parseInt(process.env.ZKINPORT_DURATION, 10) || 30000;

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
//const telegramChatId = process.env.TELEGRAM_CHAT_ID;

const COMMANDS = require('node-zklib/constants');

class DeviceManager extends EventEmitter {
  constructor(io) {
    super();
    this.io = io;
    this.devices = new Map(); // Map<ip, { device, zk, connected, lastStatus }>
    this.commandQueues = new Map();
    this.heartbeatInterval = 30000;

    this.minHeartbeatInterval = 30000; // 30 sec
    this.maxHeartbeatInterval = 60000; // 60 sec

    this.smsQueue = new SmsQueue(sendSms);

    this.telegramQueue = new TelegramQueue(
      this.sendTelegramNotification.bind(this)
    );

    this.currentUsers = {};
    this.currentUsersImage = {};
    this.currentUsersMobileNo = {};
    this.currentUsersChatId = {};
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
    //await this.realTimeLogs();
    for (const [ip, rec] of this.devices.entries()) {
      await this.startRealtime(rec, ip);
    }

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

      this.currentUsersChatId = users.reduce((acc, user) => {
        acc[user.biometricno] = user.telegram_chat_id;
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
        tcpSmsSent: false,
        realtimeListenerBound: false
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
      rec.tcpSmsSent = false; // reset SMS lock

      this.emitDeviceStatus(ip, 'online');
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

      // 🚨 SEND SMS ONLY ON TCP CONNECT (ONE TIME)
      if (command === 'TCP CONNECT' && !rec.tcpSmsSent) {
        rec.tcpSmsSent = true;

        const adminNumbers = (process.env.SMS_ADMIN_MOBILE_NO || '')
          .split(',')
          .map(n => n.trim())
          .filter(Boolean);

        for (const number of adminNumbers) {
          const { device_name } = rec.device;
          const timeStamp = moment().format('dddd, hh:mm A');
          const dateStamp = moment().format('LL');
          this.smsQueue.enqueue({
            to: number, // or hardcode admin number
            message: `ZKTeco Device ${device_name} failed to connect, [TCP CONNECT - ERROR].\nError: ${message}\nManual check required.\nDATE: ${dateStamp}\nTIME: ${timeStamp}`,
          });
        }
        console.log(`[${ip}] 📩 TCP CONNECT SMS sent (one-time)`);
      }

      this.emitDeviceStatus(ip, 'error', {
        command,
        message
      });
    }
  }

  async __getDeviceAttendanceRecords() {
    const today = moment().format('YYYY-MM-DD');
    const allRecords = [];

    for (const [ip, rec] of this.devices.entries()) {
      if (!rec.connected || !rec.zk) continue;
      try {
        const { id: device_id, device_name } = rec.device;
        const logs = await this.enqueueCommand(ip, async () => rec.zk.getAttendances());
        const formatted = logs.data
          .map(log => {
            handleDeviceLogs(log, device_id);
            const dt = new Date(log.recordTime);
            return {
              datetime: dt,
              deviceUserId: log.deviceUserId,
              deviceName: device_name,
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
    //allRecords.sort((a, b) => b._ts - a._ts);

    allRecords.sort((a, b) => a._ts - b._ts);
    
    console.log(`[DeviceManager] Fetched ${allRecords.length} attendance records`);

    // Return with formatted datetime string
    return allRecords.map(({ _ts, datetime, ...rest }) => ({
      ...rest,
      datetime: moment(datetime).format('YYYY-MM-DD HH:mm:ss')
    }));
  }

  async getDeviceAttendanceRecords() {
    const today = moment().format('YYYY-MM-DD');

    const startOfToday = moment(today).startOf('day').valueOf();
    const endOfToday = moment(today).endOf('day').valueOf();

    const allRecords = [];

    const deviceEntries = Array.from(this.devices.entries());

    const results = await Promise.all(
        deviceEntries.map(([ip, rec]) =>
            this.fetchAttendanceFromDevice(ip, rec, startOfToday, endOfToday)
        )
    );

    for (const logs of results) {
        if (logs?.length) allRecords.push(...logs);
    }

    allRecords.sort((a, b) => a._ts - b._ts);

    console.log(`[DeviceManager] Fetched ${allRecords.length} attendance records`);

    return allRecords.map(({ _ts, datetime, ...rest }) => ({
        ...rest,
        datetime: moment(datetime).format('YYYY-MM-DD HH:mm:ss')
    }));
}

async fetchAttendanceFromDevice(ip, rec, startOfToday, endOfToday) {
  if (!rec.connected || !rec.zk) return [];
  const logsResult = [];
  try {
    const { id: device_id, device_name } = rec.device;
    const logs = await this.enqueueCommand(ip, () => rec.zk.getAttendances());
    if (!logs?.data) return [];
    for (const log of logs.data) {
      await handleDeviceLogs(log, device_id);

      const dt = new Date(log.recordTime);
      const ts = dt.getTime();

      if (ts < startOfToday || ts > endOfToday) continue;

      logsResult.push({
        datetime: dt,
        deviceUserId: log.deviceUserId,
        deviceName: device_name,
        ip,
        userName: this.currentUsers[log.deviceUserId] || log.deviceUserId,
        userImage:
          this.currentUsersImage[log.deviceUserId] ||
          'assets/media/avatars/blank.png',
        _ts: ts
      });
    }

    return logsResult;
  } catch (err) {
    console.error(`[${ip}] ⚠ Attendance fetch failed: ${err.message}`);
    try {
      return await this.fetchFallbackDeviceLogs(rec);
    } catch (fallbackErr) {
      console.error(`[${ip}] ❌ Fallback failed: ${fallbackErr.message}`);
      return [];
    }
  }
}

async __next_fetchAttendanceFromDevice(ip, rec, startOfToday, endOfToday) {
  if (!rec.connected || !rec.zk) return [];
  const logsResult = [];
  try {
    const { id: device_id, device_name } = rec.device;

    let logs = await this.enqueueCommand(ip, async () => {
      try {
        return await rec.zk.getAttendances();
      } catch (err) {
        console.error(`[${ip}] ❌ getAttendances failed: ${err.message}`);
        throw err; // important
      }
    });
    if (!logs?.data) return [];
    for (const log of logs.data) {
      await handleDeviceLogs(log, device_id);
      const dt = new Date(log.recordTime);
      const ts = dt.getTime();

      if (ts < startOfToday || ts > endOfToday) continue;

      logsResult.push({
        datetime: dt,
        deviceUserId: log.deviceUserId,
        deviceName: device_name,
        ip,
        userName: this.currentUsers[log.deviceUserId] || log.deviceUserId,
        userImage:
          this.currentUsersImage[log.deviceUserId] ||
          'assets/media/avatars/blank.png',
        _ts: ts
      });
    }

    return logsResult;
  } catch (err) {
    console.error(`[${ip}] ⚠ Attendance fetch failed: ${err.message}`);

    try {
      console.log(`[${ip}] 🔁 Retrying getAttendances...`);
      const retryLogs = await this.enqueueCommand(ip, () =>
        rec.zk.getAttendances()
      );

      if (!retryLogs?.data) return [];

      const { id: device_id, device_name } = rec.device;
      const retryResult = [];

      for (const log of retryLogs.data) {
        await handleDeviceLogs(log, device_id);

        const dt = new Date(log.recordTime);
        const ts = dt.getTime();

        if (ts < startOfToday || ts > endOfToday) continue;

        retryResult.push({
          datetime: dt,
          deviceUserId: log.deviceUserId,
          deviceName: device_name,
          ip,
          userName: this.currentUsers[log.deviceUserId] || log.deviceUserId,
          userImage:
            this.currentUsersImage[log.deviceUserId] ||
            'assets/media/avatars/blank.png',
          _ts: ts
        });
      }

      return retryResult;
    } catch (_) {
      return await this.fetchFallbackDeviceLogs(rec);
    }
  }
}

async ___fetchAttendanceFromDevice(ip, rec, startOfToday, endOfToday) {
    if (!rec.connected || !rec.zk) return [];

    const logsResult = [];

    try {
        const { id: device_id, device_name } = rec.device;

        /*** let logs = await this.enqueueCommand(ip, () =>
            rec.zk.getAttendances()
        ); ***/
        let logs = await this.enqueueCommand(ip, async () => {
          try {
            return await rec.zk.getAttendances();
          } catch (err) {
            console.error(`[${ip}] ❌ Trapped inside queue:`, err.message);
            return { data: [] }; // 👈 safe fallback
          }
        });

        if (!logs?.data) return [];

        for (const log of logs.data) {
            await handleDeviceLogs(log, device_id);

            const dt = new Date(log.recordTime);
            const ts = dt.getTime();

            if (ts < startOfToday || ts > endOfToday) continue;

            logsResult.push({
                datetime: dt,
                deviceUserId: log.deviceUserId,
                deviceName: device_name,
                ip,
                userName: this.currentUsers[log.deviceUserId] || log.deviceUserId,
                userImage:
                    this.currentUsersImage[log.deviceUserId] ||
                    'assets/media/avatars/blank.png',
                _ts: ts
            });
        }

        return logsResult;
    } catch (err) {
        console.error(`[${ip}] ⚠ Attendance fetch failed: ${err.message}`);

        // optional retry before fallback
        try {
          console.log(`[${ip}] 🔁 Retrying getAttendances...`);
          const retryLogs = await this.enqueueCommand(ip, () =>
            rec.zk.getAttendances()
          );
          return retryLogs?.data || [];
        } catch (_) {}

        return await this.fetchFallbackDeviceLogs(rec);
    }
}

async fetchFallbackDeviceLogs(rec) {
    try {
        const { id, device_name } = rec.device;
        const today = moment().format('YYYY-MM-DD');
        const deviceLogs = await getCurrentAttendanceLogs(today, id);
        console.log("device logs fetched:", deviceLogs);
        if (!deviceLogs?.length) return [];

        return deviceLogs.map(log => {
            const dt = new Date(log.recordTime);
            return {
                datetime: dt,
                deviceUserId: log.deviceUserId,
                deviceName: device_name,
                ip: rec.device.ip,
                userName:
                    this.currentUsers[log.deviceUserId] ||
                    log.deviceUserId,
                userImage:
                    this.currentUsersImage[log.deviceUserId] ||
                    'assets/media/avatars/blank.png',
                _ts: dt.getTime()
            };
        });

    } catch (err) {
        console.error(`Fallback log fetch failed: ${err.message}`);
        return [];
    }
}

  async __oldCode_getDeviceAttendanceRecords() {
    const today = moment().format('YYYY-MM-DD');
    const allRecords = [];

    const startOfToday = moment(today).startOf('day').valueOf();
    const endOfToday = moment(today).endOf('day').valueOf();
    for (const [ip, rec] of this.devices.entries()) {
        if (!rec.connected || !rec.zk) continue;
        try {
            const { id: device_id, device_name } = rec.device;
            const logs = await this.enqueueCommand(ip, async () => rec.zk.getAttendances());
            if (!logs?.data) continue;
            for (const log of logs.data) {
                await handleDeviceLogs(log, device_id);
                const dt = new Date(log.recordTime);
                const ts = dt.getTime();

                // ✅ Filter today attendance using timestamp boundary
                if (ts < startOfToday || ts > endOfToday) continue;

                allRecords.push({
                    datetime: dt,
                    deviceUserId: log.deviceUserId,
                    deviceName: device_name,
                    ip,
                    userName: this.currentUsers[log.deviceUserId] || log.deviceUserId,
                    userImage: this.currentUsersImage[log.deviceUserId] || 'assets/media/avatars/blank.png',
                    _ts: ts
                });
            }

        } catch (err) {
            console.error(`[${ip}] ⚠ Attendance fetch failed: ${err.message}`);
        }
    }

    // Sort oldest → newest (optional)
    allRecords.sort((a, b) => a._ts - b._ts);
    console.log(`[DeviceManager] Fetched ${allRecords.length} attendance records`);
    return allRecords.map(({ _ts, datetime, ...rest }) => ({
        ...rest,
        datetime: moment(datetime).format('YYYY-MM-DD HH:mm:ss')
    }));
}

async startRealtime(rec, ip) {
  if (!rec.connected || rec.realtimeListenerBound) return;

  const zk = rec.zk;
  if (!zk) return;

  console.log(`[${ip}] ▶ Starting realtime stream`);

  try {
    rec.realtimeListenerBound = true;
    rec.realtimeListening = true;

    zk.getRealTimeLogs(data => {
      if (!data) return;

      setImmediate(() => {
        this.processRealtimeLog(data, rec, ip).catch(err =>
          console.error(`[${ip}] realtime handler error`, err.message)
        );
      });
    });

  } catch (err) {
    console.error(`[${ip}] realtime start failed: ${err.message}`);

    rec.realtimeListenerBound = false;
    rec.realtimeListening = false;
  }
}

async ___notWorking_startRealtime(rec, ip) {
  if (!rec.connected || rec.realtimeListening) return;
  rec.realtimeListening = true;
  if (rec.realtimeListenerBound) return;
  rec.realtimeListenerBound = true;

  console.log(`[${ip}] Starting realtime logs...`);

  const zk = rec.zk;
  if (!zk) return;

  // Remove previous listener first (VERY IMPORTANT)
  try {
    zk.getRealTimeLogs?.(() => {});
  } catch {}

  zk.getRealTimeLogs?.(data => {
    if (!data) return;

    setImmediate(() => {
      this.processRealtimeLog(data, rec, ip).catch(err =>
        console.error(`[${ip}] realtime handler error`, err.message)
      );
    });
  });
}

  async __startRealtime(rec, ip) {
    if (rec.realtimeListening || !rec.connected) return;

    rec.realtimeListening = true;
    console.log(`[${ip}] Starting realtime logs...`);
    rec.zk?.getRealTimeLogs?.(data => {
      if (!data) return;
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
      if (!rec.connected || !rec.zk || rec.realtimeListening) continue;
      await this.startRealtime(rec, ip);
    }
  }

  async processRealtimeLog(data, rec, ip) {
    try {
      const response = await handleRealtimeLog(data, rec.device.id);
      if (!response?.success) {
        console.warn(
          `[${ip}] ⚠️ Failed to insert attendance log: ${response?.message}`
        );
        return;
      }

      const dt = new Date(data.attTime);
      const payload = {
        ip,
        deviceName: rec.device.device_name,
        deviceUserId: data.userId,
        datetime: dt,
        userName: this.currentUsers[data.userId] || data.userId,
        userImage: this.currentUsersImage[data.userId] || 'assets/media/avatars/blank.png',
        _ts: dt.getTime()
      };

      this.realtimeBuffer.push(payload);

      const smsMobileNo = this.currentUsersMobileNo[data.userId] || null;
      const chatId = this.currentUsersChatId[data.userId] || null;

      if (chatId) {
        this.telegramQueue.enqueue({ chatId, data: payload })
          .then((telegramSent) => {
            if (telegramSent === false) {
              if (smsMobileNo) {
                this.sendSmsQueueNotification(smsMobileNo, payload);
              } else {
                console.warn(
                  `[${ip}] Telegram failed and no SMS number found for user ${payload.userName}`
                );
              }
            } else {
              console.log(
                `[${ip}] Telegram notification sent successfully for user ${payload.userName}`
              );
            }
          })
          .catch((err) => {
            console.error(`[${ip}] Telegram queue error: ${err.message}`);
            if (smsMobileNo) {
              this.sendSmsQueueNotification(smsMobileNo, payload);
            }
          });
      } else if (smsMobileNo) {
        this.sendSmsQueueNotification(smsMobileNo, payload);
      }

      enqueueRemoteAttendanceSync(data, rec.device.id)
        .then((remoteResponse) => {
          const { success, data:responseData } = remoteResponse;
          if(success && responseData.response){
            const { response: telegramResponse, message:telegramMessage } = responseData.telegram_response;
            console.log(`[${ip}] telegram remote response: ${telegramResponse}, message: ${telegramMessage}`);
          }
          //console.log(`[${ip}] remote response:`, remoteResponse);
        })
        .catch((err) => {
          console.error(`[${ip}] Remote sync queue error: ${err.message}`);
        });

    } catch (err) {
      console.error(`[${ip}] ⚠️ Failed to insert attendance log: ${err.message}`);
    }
  }

  async __processRealtimeLog(data, rec, ip) {
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
        const chatId = this.currentUsersChatId[data.userId] || null;

        if (chatId) {
          this.telegramQueue.enqueue({ chatId, data: payload })
            .then((telegramSent) => {
              if (telegramSent === false) {
                if (smsMobileNo) {
                  this.sendSmsQueueNotification(smsMobileNo, payload);
                } else {
                  console.warn(
                    `[${ip}] Telegram failed and no SMS number found for user ${payload.userName}`
                  );
                }
              } else {
                console.log(
                  `[${ip}] Telegram notification sent successfully for user ${payload.userName}`
                );
              }
            })
            .catch((err) => {
              console.error(`[${ip}] Telegram queue error: ${err.message}`);
              if (smsMobileNo) {
                this.sendSmsQueueNotification(smsMobileNo, payload);
              }
            });
        } else if (smsMobileNo) {
          // No Telegram chat ID, go straight to SMS
          this.sendSmsQueueNotification(smsMobileNo, payload);
        }
        
        /*** const telegramSent = await this.sendTelegramNotification(chatId, payload);
        if(telegramSent == false && smsMobileNo){
          this.sendSmsQueueNotification(smsMobileNo, payload);
        }else{
          console.log(`[${ip}] Telegram notification sent successfully for user ${payload.userName}`);
        } ***/

        enqueueRemoteAttendanceSync(data, rec.device.id)
          .then((remoteResponse) => {
            console.log('remote response:', remoteResponse);
          })
          .catch((err) => {
            console.error(`[${ip}] Remote sync queue error: ${err.message}`);
          });
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
      const formattedDate = moment(data.datetime).format('LLLL');
      const smsPayload = {
        to: mobileno,
        message: `Good Day! Hello ${data.userName}, you have an attendance record on ${formattedDate}. This is an automated message. Please disregard. GC&C Cares`,
      };
      this.smsQueue.enqueue(smsPayload);
    }else{
      return false;
    }
  }

  async sendTelegramNotification(chatId, data) {
    if (!chatId) return false;
    const formattedDate = moment(data.datetime).format('LLLL');
    const message = `<b>Good Day!</b>\n\nHello ${data.userName}, you have an attendance record on ${formattedDate}. This is an automated message. Please disregard.\nGC&C Cares`;
    const response = await sendTelegramMessage(telegramBotToken, chatId, message);
    if (!response.ok) {
      console.warn('[Telegram] Failed:', response.message, response.error);
    }

    return response.ok;
  }

  async ___sendTelegramNotification(chatId, data) {
    if(chatId){
      const formattedDate = moment(data.datetime).format('LLLL');
      const message = `<b>This is a test message!</b>\n\nHello ${data.userName}, you have an attendance record on ${formattedDate}. This is an automated message. Please disregard.\nGC&C Cares`;
      const response = await sendTelegramMessage(telegramBotToken, chatId, message);
      return response.ok;
    }else{
      return false;
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

  getRandomHeartbeatInterval() {
    return Math.floor(
      Math.random() * (this.maxHeartbeatInterval - this.minHeartbeatInterval + 1)
    ) + this.minHeartbeatInterval;
  }

  startHeartbeat() {
    for (const [ip, rec] of this.devices.entries()) {
      this.scheduleHeartbeat(ip, rec);
    }
  }

  scheduleHeartbeat(ip, rec) {
    const delay = this.getRandomHeartbeatInterval();
    rec.heartbeatInterval = delay;

    rec.heartbeatTimer = setTimeout(async () => {
      try {
        if (rec.connected && rec.zk) {
          await this.runHeartbeat(ip, rec);
        }
      } finally {
        if (this.devices.has(ip)) {
          this.scheduleHeartbeat(ip, rec);
        }
      }
    }, delay);
  }

  __oldCode_startHeartbeat() {
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
      const expectedInterval = rec.heartbeatInterval || this.minHeartbeatInterval;

      // Silent death detection
      if (rec.lastSeen && now - rec.lastSeen > expectedInterval * 2) {
        throw new Error('Device unresponsive (silent)');
      }

      if (!rec.zk) return false;

      await new Promise(resolve => setTimeout(resolve, 300));

      if (typeof rec.zk.getInfo === 'function') {
        const info = await rec.zk.getInfo().catch(() => null);
        if (info) {
          rec.lastSeen = Date.now();
        }
      }
    } catch (err) {
      console.warn(`[${ip}] 💔 Heartbeat failed: ${err.message}`);
      this.emitDeviceStatus(ip, 'offline', {
        reason: 'heartbeat_failed'
      });
      await this.healDevice(ip).catch(() => {});
      return false;
    }

    return true;
  }

  async __oldCode__runHeartbeat(ip, rec) {
    try {
      const now = Date.now();
      // Silent death detection
      if (rec.lastSeen && now - rec.lastSeen > this.heartbeatInterval * 2) {
        throw new Error('Device unresponsive (silent)');
      }
      if (!rec.zk) return false;
      // ⭐ IMPORTANT — prevent packet race condition
      await new Promise(resolve => setTimeout(resolve, 300));
      if (typeof rec.zk.getInfo === 'function') {
        const info = await rec.zk.getInfo().catch(() => null);
        if (info) {
          rec.lastSeen = Date.now();
        }
      }
    } catch (err) {
      console.warn(`[${ip}] 💔 Heartbeat failed: ${err.message}`);
      this.emitDeviceStatus(ip, 'offline', {
        reason: 'heartbeat_failed'
      });
      await this.healDevice(ip).catch(() => {});
      return false;
    }
    return true;
  }

  async __runHeartbeat(ip, rec) {
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
    this.emitDeviceStatus(ip, 'reconnecting'); // 👍 emit here instead
  
    try {
      const socket = rec.zk?.zklibTcp?.socket;
      if (socket && !socket.destroyed) {
        socket.removeAllListeners();
        socket.end();
        socket.destroy();
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
  
      if (rec.connected) {
        rec.realtimeListenerBound = false;
        await this.startRealtime(rec, ip);
  
        console.log(`[${ip}] ✅ Device reconnected`);
        rec.lastSeen = Date.now();
  
        this.emitDeviceStatus(ip, 'online'); // ✅ only here
      }
  
    } catch (err) {
      console.error(`[${ip}] ❌ Device reconnection failed: ${err.message}`);
      this.emitDeviceStatus(ip, 'offline'); // optional but clearer
    } finally {
      rec.reconnecting = false; // 🔑 always reset
    }
  }
  
  async __oldCode_healDevice(ip) {
    const rec = this.devices.get(ip);
    if (!rec || rec.reconnecting) return;
    rec.reconnecting = true;

    try {
      const socket = rec.zk?.zklibTcp?.socket;
      if (socket && !socket.destroyed) {
        socket.removeAllListeners();
        socket.end();
        socket.destroy();
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
        //await this.startRealtime(rec, ip);
        rec.realtimeListenerBound = false;
        await this.startRealtime(rec, ip);
        
        console.log(`[${ip}] ✅ Device reconnected`);
        rec.lastSeen = Date.now();
        this.emitDeviceStatus(ip, 'online');
      }
    } catch (err) {
      console.error(`[${ip}] ❌ Device reconnection failed: ${err.message}`);
    }

    rec.reconnecting = false;
    this.emitDeviceStatus(ip, 'reconnecting');
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
    socket.removeAllListeners('close');
    socket.removeAllListeners('error');
    socket.removeAllListeners('timeout');

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

  emitDeviceStatus(ip, status, extra = {}) {
    const rec = this.devices.get(ip);
    if (!rec) return;

    // ⭐ update stored status
    rec.lastStatus = status;

    const payload = {
      ip,
      deviceName: rec.device?.device_name ?? ip,
      status, // online | offline | reconnecting | error
      lastSeen: rec.lastSeen ? moment(rec.lastSeen).format('YYYY-MM-DD HH:mm:ss') : null,
      timestamp: moment().format('YYYY-MM-DD HH:mm:ss'),
      ...extra
    };

    console.log("[DeviceStatus Emit]", payload); // DEBUG
    this.emit('device:status', payload);
    this.io.emit('deviceStatus', payload);
  }

}

module.exports = DeviceManager;