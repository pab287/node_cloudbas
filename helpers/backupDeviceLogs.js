const ZKLib = require('node-zklib/zklib');
const { saveDATLogs } = require('./datLogger');
const { log } = require('../logs');

const zkTimeoutDuration = parseInt(process.env.ZKTIMEOUT_DURATION, 10) || 15000;
const zkImportDuration = parseInt(process.env.ZKINPORT_DURATION, 10) || 10000;

/**
 * Backup logs from one device
 * Creates its own socket and closes after backup
 */
async function backupAttendance(device) {
  const { ip, port, sn } = device;
  let zk = null;

  console.log(`[${ip}] 🔄 Starting backup connection...`);
    log(`[${ip}] Starting backup connection...`);
  try {
    zk = new ZKLib(ip, port, zkTimeoutDuration, zkImportDuration);
    await zk.createSocket();
    console.log(`[${ip}] ✅ Backup socket connected`);

    // Get device info (includes serial number)
    let serial = '';
    try {
      const info = await zk.getInfo();
      serial = info?.serialNumber || info?.serialnumber || sn || '';
      console.log(`[${ip}] 📟 Serial number: ${serial}`);
      log(`[${ip}] Backup socket connected, Serial number: ${serial}`);
    } catch (infoErr) {
      console.warn(`[${ip}] ⚠️ Unable to get serial number: ${infoErr.message}`);
      log(`[${ip}] Unable to get serial number: ${infoErr.message}`);
    }

    await zk.disableDevice();
    console.log(`[${ip}] Device disabled for backup`);

    const logs = await zk.getAttendances();
    console.log(`[${ip}] Retrieved ${logs?.data?.length || 0} logs`);

    if (logs?.data?.length > 0) {
      // Save DAT logs with serial number (if available)
      const filePath = saveDATLogs(ip, logs.data, serial);
      console.log(`[${ip}] ✅ DAT backup saved: ${filePath}`);
      log(`[${ip}] DAT backup saved: ${filePath}`);
    } else {
      console.log(`[${ip}] No logs to backup`);
      log(`[${ip}] No logs to backup`);
    }

  } catch (err) {
    console.error(`[${ip}] ❌ Backup error: ${err.message}`);
    log(`[${ip}] Backup error: ${err.message}`);
  } finally {
    try {
      if (zk) {
        await zk.enableDevice();
        await zk.disconnect();
      }
      console.log(`[${ip}] 🔌 Backup socket closed`);
    } catch (closeErr) {
      console.error(`[${ip}] Error closing socket: ${closeErr.message}`);
    }
  }
}

module.exports = { backupAttendance };
