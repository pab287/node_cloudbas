const { checkPortReachable } = require('../ipreachable');

function startReconnectWatcher(deviceManager, interval = 10000) {
  if (!deviceManager) {
    throw new Error('DeviceManager instance is required');
  }
  console.log('[ReconnectWatcher] Starting...');

  setInterval(async () => {
    for (const [ip, rec] of deviceManager.devices.entries()) {
      // Skip connected devices
      if (rec.connected) continue;
      // Skip if already reconnecting
      if (rec.reconnecting) continue;
      try {
        const { reachable } = await checkPortReachable(
          rec.device.ip,
          rec.device.port
        );

        if (!reachable) continue;

        // 🔎 Check if last error was TCP CONNECT
        const wasTcpConnectError = rec.lastError && rec.lastError.command === 'TCP CONNECT';
        if (!wasTcpConnectError && rec.lastError !== null) {
          // If there was an error but not TCP CONNECT, skip
          continue;
        }

        console.log(`[${ip}] 🔄 Device reachable. Attempting reconnect...`);

        await deviceManager.healDevice(ip);

      } catch (err) {
        // Silent failure to avoid log spam
      }
    }
  }, interval);
}

module.exports = { startReconnectWatcher };
