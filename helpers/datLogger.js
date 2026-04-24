const fs = require('fs');
const path = require('path');
const moment = require('moment');
const { log } = require('../logs');

/**
 * Generate a short random uppercase alphanumeric string (fallback)
 */
function randomCode(length = 4) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Saves attendance logs to a DAT file.
 * Creates a subfolder by date (YYYY-MM-DD) and locks the file as read-only.
 * @param {string} ip - Device IP address
 * @param {Array} logs - Attendance log objects
 * @param {string} [serialNumber] - Optional device serial number
 * @returns {string} - Full file path of saved DAT
 */
function saveDATLogs(ip, logs, serialNumber = '') {
  const cleanIp = ip.replace(/\./g, '');
  const dateTime = moment().format('YYYYMMDD_HHmmss');
  const dateFolder = moment().format('YYYYMMDD');

  // Keep serial exactly as provided (only uppercase)
  const cleanSerial = serialNumber ? serialNumber.toUpperCase() : '';

  // If serial exists, use it directly; otherwise, fallback to IP + random code
  const filenameBase = cleanSerial
    ? cleanSerial
    : `${cleanIp}${randomCode()}`;

  const filename = `${filenameBase}-${dateTime}.DAT`;

  // Create base backups folder + date subfolder
  const dir = path.join(__dirname, '../backups', dateFolder);
  log(`Folder and sub-folder ${dir}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, filename);

  // Convert logs to DAT format
  const datContent = logs
    .map(log => {
      // Format: userId  timestamp  verified  status  workcode  reserved
      return [
        log.deviceUserId || log.uid || 0,
        moment(log.recordTime || log.timestamp).format('YYYY-MM-DD HH:mm:ss'),
        log.isState || log.status || 1,
        log.verifyMethod || 1,
        1,
        0,
      ].join('\t');
    })
    .join('\n');

  // Write DAT file
  fs.writeFileSync(filePath, datContent, 'utf8');

  // Lock file as read-only (r--r--r--)
  try {
    fs.chmodSync(filePath, 0o444);
    console.log(`[DAT] 🔒 File locked as read-only: ${filePath}`);
  } catch (permErr) {
    console.warn(`[DAT] ⚠️ Unable to lock file permissions: ${permErr.message}`);
  }

  return filePath;
}

module.exports = { saveDATLogs };
