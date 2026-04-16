const { checkPortReachable } = require('../ipreachable');

function getDelay() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  const current = hours * 60 + minutes;

  const isPeak =
    (current >= 7 * 60 && current <= 10 * 60) ||          // 7:00 AM - 10:00 AM
    (current >= 12 * 60 && current <= 13 * 60 + 30) ||    // 12:00 PM - 1:30 PM
    (current >= 17 * 60 && current <= 18 * 60 + 30);      // 5:00 PM - 6:30 PM

  if (isPeak) {
    return 10000; // 10 seconds
  }

  // Off-peak: random between 30s - 60s
  return Math.floor(Math.random() * (60000 - 30000 + 1)) + 30000;
}

function startReconnectWatcher(deviceManager) {
  if (!deviceManager) {
    throw new Error('DeviceManager instance is required');
  }

  console.log('[ReconnectWatcher] Starting...');

  const run = async () => {
    for (const [ip, rec] of deviceManager.devices.entries()) {

      if (rec.connected) continue;
      if (rec.reconnecting) continue;

      // 🛑 STOP reconnect if last error was TCP CONNECT
      if (rec.lastError?.command === 'TCP CONNECT') {
        console.log(`[${ip}] ⛔ Skipping reconnect (TCP CONNECT ERROR)`);
        continue;
      }

      try {
        const { reachable } = await checkPortReachable(
          rec.device.ip,
          rec.device.port
        );

        if (!reachable) continue;

        console.log(`[${ip}] 🔄 Device reachable. Attempting reconnect...`);
        await deviceManager.healDevice(ip);

      } catch (err) {
        // optional: log error
      }
    }

    // schedule next run dynamically
    const delay = getDelay();
    console.log(`[ReconnectWatcher] Next run in ${delay / 1000}s`);
    setTimeout(run, delay);
  };

  run(); // start loop
}

function ___oldCode_startReconnectWatcher(deviceManager, interval = 10000) {
  if (!deviceManager) {
    throw new Error('DeviceManager instance is required');
  }

  console.log('[ReconnectWatcher] Starting...');

  setInterval(async () => {
    for (const [ip, rec] of deviceManager.devices.entries()) {

      if (rec.connected) continue;
      if (rec.reconnecting) continue;

      // 🛑 STOP reconnect if last error was TCP CONNECT
      if (rec.lastError?.command === 'TCP CONNECT') {
        console.log(`[${ip}] ⛔ Skipping reconnect (TCP CONNECT ERROR)`);
        continue;
      }

      try {
        const { reachable } = await checkPortReachable(
          rec.device.ip,
          rec.device.port
        );

        if (!reachable) continue;

        console.log(`[${ip}] 🔄 Device reachable. Attempting reconnect...`);
        await deviceManager.healDevice(ip);

      } catch (err) {}
    }
  }, interval);
}

module.exports = { startReconnectWatcher };