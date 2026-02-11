const moment = require('moment');
const pool = require('../config/db');

const { enqueueLog } = require('./attendanceQueue'); // adjust path if needed

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
module.exports = { handleRealtimeLog, handleDeviceLogs };
