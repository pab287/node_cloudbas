const cron = require('node-cron');
const syncRemoteEmployeeRecords = require('./syncEmployeeRecords');

const startEmployeeSyncCron = () => {
console.log('[CRON] Employee sync cron job initialized');   
  // runs every 8 hours (change as needed)
  cron.schedule('0 */8 * * *', async () => {
    console.log('[CRON] Starting employee sync every 8 hours...');

    try {
      await syncRemoteEmployeeRecords();
      console.log('[CRON] Employee sync completed');
    } catch (err) {
      console.error('[CRON] Employee sync failed:', err);
    }
  });
};

module.exports = { startEmployeeSyncCron };