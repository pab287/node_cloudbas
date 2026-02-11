// fetchWithRetry.js
const fetchWithRetry = async function(manager, device, retries = 3, delayMs = 2000, timeoutMs = 5000) {
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const { ip, port } = device;

  // --- Ensure attendance socket is ready ---
  const ensureAttendanceSocket = async () => {
    const rec = manager.devices.get(ip);
    const zk = rec?.zk;
    if (!zk) throw new Error('ZK instance not available');
  
    const estimatedRecords = rec.lastStatus?.recordCount ?? 0;
    const hasRecordData = estimatedRecords > 0;
  
    const timeoutMs = hasRecordData
      ? Math.min(120000, 10000 + estimatedRecords * 10)
      : (manager.zkTimeoutDuration ?? 10000);
  
    const importMs = hasRecordData
      ? Math.min(120000, 5000 + estimatedRecords * 10)
      : (manager.zkImportDuration ?? 5000);
  
    // 🆕 Create socket only if none or previous was destroyed
    if (
      !zk.zklibTcpAttendance ||
      zk.zklibTcpAttendance?.zklibTcp?.socket?.destroyed
    ) {
      zk.zklibTcpAttendance = new manager.ZKLib(ip, port, timeoutMs, importMs);
      await zk.zklibTcpAttendance.createSocket();
  
      const socket = zk.zklibTcpAttendance.zklibTcp.socket;
      socket.setMaxListeners(50); // ✅ once per socket
  
      try {
        await zk.zklibTcpAttendance.enableDevice();
        console.log(`[${ip}] 🟢 Attendance socket established`);
      } catch (errDevice) {
        console.warn(
          `[${ip}] ⚠️ enableDevice failed (safe to ignore): ${errDevice.message}`
        );
      }
  
      const realtimeActive = zk?.isRealtimeActive === true;
      const reason = realtimeActive
        ? 'Connected (Realtime)'
        : 'Connected (Not Realtime)';
  
      console.log(`[${ip}] 🔔 Status emitted from fetchWithRetry: ${reason}`);
    }
  
    const socket = zk.zklibTcpAttendance?.zklibTcp?.socket;
  
    if (!socket || socket.destroyed) {
      zk.zklibTcpAttendance = null;
      throw new Error('No active attendance socket');
    }
  
    return { zk, socket };
  };

  
  const __oldCode__ensureAttendanceSocket = async () => {
    const rec = manager.devices.get(ip);
    const zk = rec?.zk;
    if (!zk) throw new Error('ZK instance not available');

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

    // ✅ Create a separate ZKLib instance for attendance
    if (!zk.zklibTcpAttendance) {
      zk.zklibTcpAttendance = new manager.ZKLib(ip, port, timeoutMs, importMs);
      await zk.zklibTcpAttendance.createSocket();

      //await zk.zklibTcpAttendance.enableDevice();

      try {
        await zk.zklibTcpAttendance.enableDevice();
        console.log(`[${ip}] 🟢 Attendance socket established`);
      } catch (errDevice) {
        console.error(`[${ip}] 🟢 Attendance socket error: ${errDevice}`);
      }

      // 🟢 Emit updated status to UI
      const realtimeActive = zk?.isRealtimeActive === true;
      const reason = realtimeActive ? 'Connected (Realtime)' : 'Connected (Not Realtime)';
      
      console.log(`[${ip}] 🔔 Status emitted from fetchWithRetry: ${reason}`);
    }

    const socket = zk.zklibTcpAttendance?.zklibTcp?.socket;

    /*** if (socket) {
      socket.setMaxListeners(50); // set once per socket
    } ***/

    if (!socket) throw new Error('No active attendance socket');
    return { zk, socket };
  };

  // --- Backup & restore listeners ---
  const backupDataListeners = (socket) => socket.listeners('data').slice();
  const restoreDataListeners = (socket, listeners) => {
    socket.removeAllListeners('data');
    listeners.forEach(fn => socket.on('data', fn));
  };

  // --- Cleanup excess listeners ---
  const cleanupExcessListeners = (socket, originalListeners) => {
    const current = socket.listeners('data');
    if (current.length > originalListeners.length) {
      const excess = current.length - originalListeners.length;
      console.warn(`[${ip}] Cleaning up ${excess} excess 'data' listeners`);
      restoreDataListeners(socket, originalListeners);
    }
  };

  // --- Destroy attendance socket on failure ---
  const destroyAttendanceSocket = (rec) => {
    try {
      const socket = rec?.zk?.zklibTcpAttendance?.zklibTcp?.socket;
      if (socket) {
        console.log(`[${ip}] 🔹 Destroying attendance socket before retry`);
        ['data','close','error','end','timeout'].forEach(ev => {
          console.log(`  ${ev}: ${socket.listenerCount(ev)}`);
        });

        // 🔥 CRITICAL: remove listeners first
        socket.removeAllListeners();
        // 🔥 CRITICAL: remove listeners first

        socket.destroy();
      }

      // ❌ DO NOT call disconnect() after destroy
      //if (rec?.zk?.zklibTcpAttendance) rec.zk.zklibTcpAttendance.disconnect();
      // ❌ DO NOT call disconnect() after destroy

      rec.zk.zklibTcpAttendance = null;
    } catch (cleanupErr) {
      console.warn(`[${ip}] ⚠️ Cleanup failed: ${cleanupErr.message}`);
    }
  };

  // --- Main retry loop ---
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await manager.connect(device);

      const rec = manager.devices.get(ip);
      if (!rec?.connected || !rec.zk) throw new Error('Device not connected');

      const { zk, socket } = await ensureAttendanceSocket();

      // Backup listeners & increase max
      const originalListeners = backupDataListeners(socket);
      
      // remove socket max listener 
      //socket.setMaxListeners(50);
      // remove socket max listener 

      // Fetch attendance with timeout
      const logs = await Promise.race([
        zk.zklibTcpAttendance.getAttendances().catch(err => {
          throw new Error(`ZKLib fetch error: ${err.message || err}`);
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
      ]);

      cleanupExcessListeners(socket, originalListeners);

      console.log(`[${ip}] ✅ Attendance logs fetched (${logs?.length ?? 0})`);
      return logs;

    } catch (err) {
      console.warn(`[${ip}] ⚠️ Attempt ${attempt}/${retries} failed: ${err.message}`);
      const rec = manager.devices.get(ip);
      destroyAttendanceSocket(rec);

      if (attempt < retries) {
        console.log(`[${ip}] 🔁 Retrying in ${delayMs / 1000}s...`);
        await delay(delayMs);
      } else {
        console.error(`[${ip}] ❌ All ${retries} attempts failed`);
        throw err;
      }
    }
  }
};

module.exports = fetchWithRetry;
