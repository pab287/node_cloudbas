require('dotenv').config();
const axios = require("axios");
const moment = require('moment');
const qs = require("querystring");

const { enqueueLog } = require('./attendanceQueue'); // adjust path if needed

const ZKLib = require('node-zklib/zklib');
const { getActiveDevices } = require('../dbrecord');
const { checkPortReachable } = require('../ipreachable');

const zkTimeoutDuration = Number.parseInt(process.env.ZKTIMEOUT_DURATION, 10) || 20000;
const zkImportDuration = Number.parseInt(process.env.ZKINPORT_DURATION, 10) || 30000;
const REMPREC_URL = process.env.REMOTE_ATT_FILE_SYNC ?? null;

const handleRealtimeLog = async (data, deviceId) => {
  try {
    const { datetime, userId, attState, verifyMethod, attTime } = data;
    const dbDateTime = moment(attTime).format("YYYY-MM-DD HH:mm:ss");

    const logData = {
      log: JSON.stringify({
        enrollNumber: userId,
        attState,
        verifyMethod,
        year: datetime.year,
        month: datetime.month,
        day: datetime.date,
        hours: datetime.hour,
        minutes: datetime.minute,
        seconds: datetime.second,
      }),
      device_id: deviceId,
      datetime: dbDateTime,
      biometricno: userId,
      device_state: attState,
      verify_method: verifyMethod,
    };

    enqueueLog(logData);
    return { success: true, message: 'Queued for insert' };
  } catch (err) {
    console.error('Error in handle realtime log:', err);
    return { success: false, message: err.message };
  }
};

const handleDeviceLogs = async (data, deviceId) => {
  try {
    const { deviceUserId, isState: attState, verifyMethod, recordTime } = data;
    const m = moment(recordTime);
    const dbDateTime = m.format("YYYY-MM-DD HH:mm:ss");

    const logData = {
      log: JSON.stringify({
        enrollNumber: deviceUserId,
        attState,
        verifyMethod,
        year: m.format('YY'),
        month: m.month() + 1,
        day: m.date(),
        hours: m.hour(),
        minutes: m.minute(),
        seconds: m.second(),
      }),
      device_id: deviceId,
      datetime: dbDateTime,
      biometricno: deviceUserId,
      device_state: attState,
      verify_method: verifyMethod,
    };
    enqueueLog(logData);
    return { success: true, message: 'Queued for insert' };
  } catch (err) {
    console.error('Error in handling device logs:', err);
    return { success: false, message: err.message };
  }
};

const sendDeviceLogs = async ({ deviceName, payload, remoteUrl }) => {
  if (!remoteUrl) {
    console.log("Remote attendance URL is not defined");
    return null;
  }

  try {
    const response = await axios.post(
      remoteUrl,
      new URLSearchParams({
        devicename: deviceName,
        data: JSON.stringify(payload)
      }),
      {
        timeout: 30000,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    console.log(`Logs sent successfully for ${deviceName}`);
    return response.data;
  } catch (error) {
    console.error(
      `Failed to send logs for ${deviceName}:`,
      error.response?.data || error.message
    );
    return null;
  }
};

const formatDeviceLogs = (data = [], deviceId = null, uuId = null) => {
  const structuredRecord = data.map(record => {
    const { userSn, deviceUserId, recordTime, isState, verifyMethod } = record;

    return [
      userSn,
      deviceUserId,
      parseInt(isState, 10),
      moment(recordTime).format("YYYY-MM-DD HH:mm:ss"),
      parseInt(verifyMethod, 10)
    ];
  });

  return {
    attendance_log: structuredRecord,
    device_id: deviceId,
    uu_id: uuId
  };
};

const connect = async (device) => {
  const { ip, port, id, uuid, name } = device;
  const { reachable } = await checkPortReachable(ip, port);

  if (!reachable) {
    console.log(`Device ${ip}:${port} is unreachable`);
    return null;
  }

  const zkLib = new ZKLib(ip, port, zkTimeoutDuration, zkImportDuration);
  let logs;

  try {
    await zkLib.createSocket();
    logs = await zkLib.getAttendances();

    await zkLib.disconnect();
    console.log(`Disconnected early from ${ip}:${port}`);
  } catch (zkError) {
    console.error(`Error on ${ip}:${port}:`, zkError);

    try {
      await zkLib.disconnect();
    } catch (_) {}

    return null;
  }

  const now = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(now.getDate() - 7);

  const rawLogs = logs.data || logs || [];

  const filteredLogs = rawLogs.filter(log => {
    const logDate = new Date(log.recordTime);
    return logDate >= sevenDaysAgo && logDate <= now;
  });

  console.log(`${name || ip} last 7 days logs count: ${filteredLogs.length}`);

  if (!filteredLogs.length) {
    return {
      device,
      filteredLogs: []
    };
  }

  return {
    device,
    filteredLogs
  };
};

const getDeviceAttendanceLogs = async () => {
  const devices = await getActiveDevices();
  const batchSize = 5;

  for (let i = 0; i < devices.length; i += batchSize) {
    const batch = devices.slice(i, i + batchSize);

    const results = await Promise.all(batch.map(device => connect(device)));

    for (const result of results) {
      if (!result || !result.filteredLogs.length) continue;

      const { device, filteredLogs } = result;

      const payload = formatDeviceLogs(
        filteredLogs,
        device.id ?? null,
        device.uuid ?? null
      );
      
      await sendDeviceLogs({
        deviceName: device.device_name,
        payload,
        remoteUrl: REMPREC_URL
      });
    }
  }
};

module.exports = { handleRealtimeLog, handleDeviceLogs, getDeviceAttendanceLogs };
