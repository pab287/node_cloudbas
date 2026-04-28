// C:\laragon\www\nodezklogger\helpers\attendanceQueue.js
const { insertAttendanceLogs } = require('../dbrecord'); // ✅ fixed path

let queue = [];
let isFlushing = false;

const FLUSH_INTERVAL = 1000; // 1 second
const BATCH_SIZE = 100;

const enqueueLog = (log) => {
  return new Promise((resolve, reject) => {
    queue.push({
      data: log,
      resolve,
      reject
    });
  });
};

const flushQueue = async () => {
  if (isFlushing || queue.length === 0) return;

  isFlushing = true;

  const batchItems = queue.splice(0, BATCH_SIZE);
  const batch = batchItems.map(item => item.data);

  try {
    const result = await insertAttendanceLogs(batch);

    if (!result.success) {
      console.warn(`⚠️ Batch insert failed: ${result.message}`);

      // ❌ reject all
      batchItems.forEach(item => item.reject(result.message));

      // 🔄 requeue
      queue.unshift(...batchItems);
    } else {
      const insertedRows = result.data; // [{ id, log, device_id }]

      // ✅ Map results back
      batchItems.forEach((item) => {
        const match = insertedRows.find(r =>
          r.log === item.data.log &&
          r.device_id === item.data.device_id
        );

        if (match) {
          item.resolve(match.id); // ✅ return ID
        } else {
          item.reject('ID not found after insert');
        }
      });
    }

  } catch (err) {
    console.error('❌ Error flushing attendance queue:', err);

    batchItems.forEach(item => item.reject(err.message));
    queue.unshift(...batchItems);

  } finally {
    isFlushing = false;
  }
};

const __oldCode_enqueueLog = (log) => {
  queue.push(log);
};

const __oldCode_flushQueue = async () => {
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
