// helpers/monitorRealtimeConnection.js
const { listenRealtimeHelper } = require('./listenRealtimeHelper');

const monitorRealtimeConnection = async (manager, device) => {
  try {
    const { ip } = device;
    const rec = manager.devices.get(ip);
    if (!rec?.zk) return;

    const zk = rec.zk;
    const realtimeSocket = zk.zklibTcpRealtime?.zklibTcp?.socket;
    if (!realtimeSocket) {
      manager.emitDeviceLogs?.(`[${ip}] ⚠️ No realtime socket found — scheduling reconnect...`, 'warning');
      return attemptRealtimeReconnect(manager, device);
    }

    // 🧩 Log initial listener state before anything
    manager.logSocketListeners(ip, realtimeSocket, 'Monitor Realtime, before-monitor');

    // ✅ Avoid duplicate listeners by checking if already bound
    if (realtimeSocket.__isRealtimeMonitored) return;
    realtimeSocket.__isRealtimeMonitored = true;

    // 🧹 Cleanup stale or excess listeners
    cleanupExcessListeners(manager, ip, realtimeSocket);

    // 🧩 Log after cleanup
    manager.logSocketListeners(ip, realtimeSocket, 'Monitor Realtime, after-cleanup');

    // 🎧 Attach once only
    realtimeSocket.once('close', async () => {
      realtimeSocket.__isRealtimeMonitored = false;
      manager.emitDeviceLogs?.(`[${ip}] ⚠️ Realtime socket closed`, 'warning');
      await attemptRealtimeReconnect(manager, device);
    });

    realtimeSocket.once('error', async (err) => {
      realtimeSocket.__isRealtimeMonitored = false;
      manager.emitDeviceLogs?.(`[${ip}] ❌ Realtime socket error: ${err.message}`, 'error');
      await attemptRealtimeReconnect(manager, device);
    });

    // 🧩 Log after adding new listeners
    manager.logSocketListeners(ip, realtimeSocket, 'Monitor Realtime, after-attach');

  } catch (err) {
    console.error(`[${device.ip}] monitorRealtimeConnection internal error:`, err);
    manager.emitDeviceLogs?.(
      `[${device.ip}] monitorRealtimeConnection internal error: ${err.message || err}`,
      'error'
    );
  }
};

/** Reconnect logic */
async function attemptRealtimeReconnect(manager, device) {
  const { ip } = device;
  if (!device.realtimeRetryCount) device.realtimeRetryCount = 0;

  const MAX_RETRIES = manager.maxRealtimeRetries ?? 5;
  //const RECONNECT_DELAY = manager.reconnectDelay ?? 5000;
  const estimatedRecords = device.lastStatus?.recordCount ?? 0;
  const hasRecordData = estimatedRecords > 0;

  const RECONNECT_DELAY = hasRecordData
    ? Math.min(120000, 5000 + estimatedRecords * 10)
    : (manager.reconnectDelay ?? 5000);
    
  if (device.realtimeRetryCount >= MAX_RETRIES) {
    manager.emitDeviceLogs?.(`[${ip}] ❌ Max realtime reconnect attempts reached (${MAX_RETRIES})`, 'error');
    return;
  }

  device.realtimeRetryCount++;
  manager.emitDeviceLogs?.(
    `[${ip}] 🔁 Attempting realtime reconnect (${device.realtimeRetryCount}/${MAX_RETRIES}) in ${RECONNECT_DELAY / 1000}s...`,
    'warning'
  );

  await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY));

  try {
    await listenRealtimeHelper(manager, device);
    device.realtimeRetryCount = 0;
    manager.emitDeviceLogs?.(`[${ip}] ✅ Realtime connection restored`, 'success');
  } catch (err) {
    manager.emitDeviceLogs?.(`[${ip}] ⚠️ Reconnect attempt failed: ${err.message}`, 'error');
    await attemptRealtimeReconnect(manager, device);
  }
}

/** Listener cleanup with leak logging */
function cleanupExcessListeners(manager, ip, socket, maxListeners = 10) {
  const eventNames = ['close', 'error', 'end', 'timeout'];
  let emitted = false;

  for (const event of eventNames) {
    const count = socket.listenerCount(event);
    if (count > maxListeners) {
      socket.removeAllListeners(event);
      if (!emitted) {
        console.warn(`[${ip}] Cleaning up ${count} excess '${event}' listeners`);
        emitted = true;
      }
    }
  }

  socket.setMaxListeners(50);

  // 🧩 Log after cleanup pass
  manager.logSocketListeners(ip, socket, 'Monitor Realtime,  post-cleanup');
}

module.exports = { monitorRealtimeConnection };
