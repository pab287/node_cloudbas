const moment = require('moment');
const { handleRealtimeLog } = require('./attendanceLogsHandler');

/**
 * Establishes and listens for realtime logs from a ZKTeco device.
 * Automatically handles "TCP CONNECT" and similar socket errors gracefully.
 * Logs socket listener counts to help trace memory leaks.
 */
async function listenRealtimeHelper(manager, device) {
  const { ip, port, device_name } = device;
  const rec = manager.devices.get(ip);
  if (!rec) {
    console.log(`[${ip}] ⚠️ No device record found in manager.`);
    return;
  }

  let zk = rec.zk;
  if (!zk) throw new Error('ZK instance not available');

  const activeSocket = zk?.zklibTcp?.socket;
  if(!activeSocket) throw new Error('Active socket missing');
  
  // Prevent duplicate realtime sessions
  if (zk?.isRealtimeActive) return;

  console.log(zk.zklibTcp?.socket);
  console.log("isRealtimeActive", zk?.isRealtimeActive);

  // 🟢 Prioritize estimated record count for timing adjustments
  const estimatedRecords = rec.lastStatus?.recordCount ?? 0;
  const hasRecordData = estimatedRecords > 0;

  // 🕒 Compute adaptive timeouts (prioritize estimatedRecords, fallback to manager values)
  const timeoutMs = hasRecordData
    ? Math.min(120000, 10000 + estimatedRecords * 10) // 10ms per record, max 2 min
    : (manager.zkTimeoutDuration ?? 10000);

  const importMs = hasRecordData
    ? Math.min(120000, 5000 + estimatedRecords * 10)
    : (manager.zkImportDuration ?? 5000);

  try {
    console.log("zk realtime", zk.zklibTcpRealtime);

    if (!zk.zklibTcpRealtime) {
      zk.zklibTcpRealtime = new manager.ZKLib(ip, port, timeoutMs, importMs);
      await zk.zklibTcpRealtime.createSocket();
      await zk.zklibTcpRealtime.enableDevice();
      console.log(`[${ip}] 🟢 Realtime socket established`);
    }

    const realtimeSocket = zk.zklibTcpRealtime?.zklibTcp?.socket;
    if (!realtimeSocket) throw new Error('Realtime socket missing after initialization');

    // 🧩 Log listener counts before cleanup
    manager.logSocketListeners(ip, realtimeSocket, 'Realtime Helper, before-cleanup');

    realtimeSocket.removeAllListeners('close');
    realtimeSocket.removeAllListeners('error');
    realtimeSocket.setMaxListeners(100);

    // 🧩 Log listener counts after cleanup
    manager.logSocketListeners(ip, realtimeSocket, 'Realtime Helper, after-cleanup');

    realtimeSocket.on('close', () => {
      console.log(`[${ip}] 🔁 Realtime socket closed`);
    });

    realtimeSocket.on('error', (err) => {
      const msg = err?.message || JSON.stringify(err) || 'Unknown socket error';
      console.error(`[${ip}] ❌ Realtime socket error: ${msg}`);

      if (/TCP CONNECT|ECONNREFUSED|ETIMEDOUT/i.test(msg)) {
        console.error(`[${ip}] 🔁 Scheduling reconnect due to connection failure`);
      }
    });

    // 🧩 Log listener counts after adding new listeners
    manager.logSocketListeners(ip, realtimeSocket, 'Realtime Helper, after-attach');

    if (!zk._realtimeAttached) {
      zk._realtimeAttached = true;

      zk.zklibTcpRealtime.getRealTimeLogs(async (data) => {
        console.log(data);
        try {
          const response = await handleRealtimeLog(data, device.id);
          if (!response?.success) {
            console.warn(`[${ip}] ⚠️ Failed to insert attendance log: ${response.message}`);
          }
        } catch (err) {
          console.error(`[${ip}] ❌ Error in handleRealtimeLog:`, err);
        }

      });
    }

    zk.isRealtimeActive = true;

    const rec = manager.devices.get(ip);
    if (rec) {
      rec.zk = zk;
      manager.devices.set(ip, rec);
    }
    
  } catch (err) {
    const msg = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
    manager.emitDeviceLogs?.(`[${ip}] ❌ Realtime socket failed: ${msg}`, 'error');
    manager.emitStatus(device, 'offline', msg, 0);

    if (/TCP CONNECT|ECONNREFUSED|ETIMEDOUT/i.test(msg)) {
      manager.emitDeviceLogs?.(`[${ip}] 🔁 Detected connection failure — scheduling reconnect`, 'warning');
      manager.emitStatus(device, 'offline', 'Connection failure - TCP CONNECT ERROR', 0);
      // manager.scheduleReconnect(device, msg, 0);
    }
  }
}

module.exports = { listenRealtimeHelper };
