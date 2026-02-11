// C:\laragon\www\nodezklogger\helpers\attendanceQueue.js
const { insertAttendanceLogs } = require('../dbrecord'); // ✅ fixed path

let queue = [];
let isFlushing = false;

const FLUSH_INTERVAL = 1000; // 1 second
const BATCH_SIZE = 100;

const enqueueLog = (log) => {
  queue.push(log);
};

const flushQueue = async () => {
  if (isFlushing || queue.length === 0) return;

  isFlushing = true;

  const batch = queue.splice(0, BATCH_SIZE);
  try {
    const result = await insertAttendanceLogs(batch);
    if (!result.success) {
      console.warn(`⚠️ Batch insert failed: ${result.message}`);
      queue.unshift(...batch); // requeue failed logs
    }
  } catch (err) {
    console.error('❌ Error flushing attendance queue:', err);
    queue.unshift(...batch);
  } finally {
    isFlushing = false;
  }
};

setInterval(flushQueue, FLUSH_INTERVAL);

module.exports = { enqueueLog };
