const cron = require('node-cron');
const { syncRemoteEmployeeRecords } = require('./syncEmployeeRecords');
const { getDeviceAttendanceLogs } = require('./attendanceLogsHandler');

let isRunning = false;
const CRON_CONFIG = { timezone: 'Asia/Manila' };

const startAttendanceSyncCron = () => {
  console.log('[CRON] Attendance sync cron initialized');

  // 🔹 MORNING: 8:25–8:55 every 10 mins
  cron.schedule('25,35,45,55 8 * * *', runAttendanceSync, CRON_CONFIG);

  // 🔹 MORNING: 9:05
  cron.schedule('5 9 * * *', runAttendanceSync, CRON_CONFIG);

  // 🔹 AFTERNOON: 1:15–1:35 every 5 mins
  cron.schedule('15,25,35 13 * * *', runAttendanceSync, CRON_CONFIG);
};

const runAttendanceSync = async () => {
  if (isRunning) {
    console.log('[CRON] Skipping, previous job still running');
    return;
  }
  console.log('[CRON] Running attendance sync...',
    new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
  );

  isRunning = true;

  try {
    await getDeviceAttendanceLogs();
    console.log('[CRON] Attendance sync completed');
  } catch (err) {
    console.error('[CRON] Attendance sync failed:', err);
  } finally {
    isRunning = false;
  }
};

const startAllCrons = () => {
  console.log('[CRON] All cron jobs initialized');

  // 🔹 Employee sync (every 8 hours)
  cron.schedule('0 */8 * * *', async () => {
    console.log('[CRON] Starting employee sync...');

    try {
      await syncRemoteEmployeeRecords();
      console.log('[CRON] Employee sync completed');
    } catch (err) {
      console.error('[CRON] Employee sync failed:', err);
    }
  }, CRON_CONFIG);

  // 🔹 Attendance sync
  startAttendanceSyncCron();
};


module.exports = { startAllCrons };