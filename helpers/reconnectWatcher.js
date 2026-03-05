const { checkPortReachable } = require('../ipreachable');

function startReconnectWatcher(deviceManager, interval = 10000) {
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