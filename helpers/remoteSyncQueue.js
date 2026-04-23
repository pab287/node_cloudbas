require('dotenv').config();
const moment = require('moment');
const axios = require('axios');
const qs = require('querystring');
const { updateAttendanceLogSent } = require('../dbrecord');

const REMOTE_ATT_SYNC = process.env.REMOTE_ATT_SYNC ?? null;

let queue = [];
let activeCount = 0;

const MAX_CONCURRENT = 3;      // how many remote requests run at once
const MAX_RETRIES = 5;         // retry failed syncs
const RETRY_DELAY = 3000;      // 3 seconds
const REQUEST_TIMEOUT = 30000; // 30 seconds

const buildSyncPayload = (data, deviceId) => {
  const { userId, attState, verifyMethod, attTime, datetime } = data;

  const _attState = parseInt(attState, 10);
  const _verifyMethod = parseInt(verifyMethod, 10);
  const dbDateTime = moment(attTime).format('YYYY-MM-DD HH:mm:ss');

  const timeLog = JSON.stringify({
    enrollNumber: userId,
    attState: _attState,
    verifyMethod: _verifyMethod,
    year: datetime.year,
    month: datetime.month,
    day: datetime.date,
    hours: datetime.hour,
    minutes: datetime.minute,
    seconds: datetime.second
  });

  return {
    localLog: {
      log: timeLog,
      datetime: dbDateTime,
      biometricno: userId,
      verify_method: _verifyMethod,
      device_state: _attState,
      device_id: deviceId
    },
    remotePayload: {
      log: timeLog,
      date: dbDateTime,
      biometricno: userId,
      verify_method: _verifyMethod,
      device_state: _attState,
      device_id: deviceId,
      is_send: 1
    }
  };
};

const sendRemoteAttendance = async (data, deviceId) => {
  if (!REMOTE_ATT_SYNC) {
    throw new Error('REMOTE_ATT_SYNC is not defined');
  }

  const { localLog, remotePayload } = buildSyncPayload(data, deviceId);

  try {
    const response = await axios.post(
      REMOTE_ATT_SYNC,
      new URLSearchParams(remotePayload),
      {
        timeout: REQUEST_TIMEOUT,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    if (!response || response.status < 200 || response.status >= 300) {
      throw new Error('Remote server returned invalid response');
    }

    const updateResult = await updateAttendanceLogSent(localLog);

    if (!updateResult.success) {
      console.warn(
        '[remoteSyncQueue] Remote sent, but local is_sent update failed:',
        updateResult.message
      );
    }

    return response.data;

  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      throw new Error('Remote server is unreachable');
    }
    if (err.code === 'ECONNABORTED') {
      throw new Error('Request timed out');
    }
    throw err;
  }
};

const processQueue = async () => {
  if (activeCount >= MAX_CONCURRENT) return;
  if (queue.length === 0) return;

  const job = queue.shift();
  activeCount++;

  try {
    const result = await sendRemoteAttendance(job.data, job.deviceId);
    job.resolve({ success: true, data: result });
  } catch (error) {
    const message = error.response
      ? JSON.stringify(error.response.data)
      : error.message;

    console.error(`[remoteSyncQueue] Sync failed (attempt ${job.attempt + 1}):`, message);

    if (job.attempt + 1 < MAX_RETRIES) {
      setTimeout(() => {
        queue.push({
          ...job,
          attempt: job.attempt + 1
        });
        processQueue();
      }, RETRY_DELAY);
    } else {
      job.resolve({
        success: false,
        message: 'Remote attendance sync failed after max retries'
      });
    }
  } finally {
    activeCount--;
    processQueue();
  }
};

const makeJobKey = (data, deviceId) => {
  const dbDateTime = moment(data.attTime).format('YYYY-MM-DD HH:mm:ss');
  return `${data.userId}|${deviceId}|${dbDateTime}`;
};

const enqueueRemoteAttendanceSync = (data, deviceId) => {
  return new Promise((resolve) => {
    const key = makeJobKey(data, deviceId);

    const exists = queue.some(
      (job) => makeJobKey(job.data, job.deviceId) === key
    );

    if (exists) {
      return resolve({
        success: true,
        message: 'Already queued'
      });
    }

    queue.push({
      data,
      deviceId,
      attempt: 0,
      resolve
    });

    processQueue();
  });
};

const getRemoteSyncQueueStats = () => ({
  pending: queue.length,
  active: activeCount,
  maxConcurrent: MAX_CONCURRENT
});

module.exports = {
  enqueueRemoteAttendanceSync,
  getRemoteSyncQueueStats
};