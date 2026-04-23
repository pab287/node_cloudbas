const socket = io();
const attendanceList = document.getElementById('attendance-list');
const renderedLogs = new Map(); 

function getLogKey(log) {
  const time = typeof log.datetime === 'string'
    ? log.datetime
    : new Date(log.datetime).getTime();

  return `${log.ip}_${log.deviceUserId}_${time}`;
}

function cleanupRenderedLogs() {
  const MAX_SIZE = 3000;

  if (renderedLogs.size <= MAX_SIZE) return;

  const entries = [...renderedLogs.entries()]
    .sort((a, b) => a[1] - b[1]); // oldest first

  const removeCount = entries.length - MAX_SIZE;

  for (let i = 0; i < removeCount; i++) {
    renderedLogs.delete(entries[i][0]);
  }
}


function renderCard(log, { prepend = false, highlight = false } = {}) {
  if (highlight) {
    const prev = attendanceList.querySelector('.highlight');
    if (prev) prev.classList.remove('highlight');
  }

    // ✅ Format datetime to AM/PM
  const formattedDateTime = new Date(log.datetime).toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  const card = document.createElement('div');
  card.className = 'card';

  card.innerHTML = `
    <div class="card-left">
      <img src="${log.userImage}" alt="User Image - ${log.userName}" />
    </div>

    <div class="card-right">
      <div class="card-main">
        <div class="username">${log.userName || 'Employee'}</div>
        <div class="userid">BIOMETRIC #: ${log.deviceUserId}</div>
        <div class="datetime">${formattedDateTime}</div>
      </div>

      <div class="card-footer">
        <span>${log.ip}</span>
        <span>${log.deviceName}</span>
      </div>
    </div>
  `;

  if (prepend && attendanceList.firstChild) {
    attendanceList.insertBefore(card, attendanceList.firstChild);
  } else {
    attendanceList.appendChild(card);
  }

  if (highlight) {
    card.classList.add('highlight');
    setTimeout(() => card.classList.remove('highlight'), 3000);
  }
}

// Historical attendance
socket.emit('getAttendanceLogs');
socket.on('attendanceLogs', (logs) => {
  logs.forEach(log => {
    const key = getLogKey(log);
    if (renderedLogs.has(key)) return;
    renderedLogs.set(key, Date.now());
    renderCard(log, { prepend: true })
  });
  cleanupRenderedLogs();
});

// Realtime attendance
socket.on('realtimeAttendance', (log) => {
  const key = getLogKey(log);
  if (renderedLogs.has(key)) return;
  renderedLogs.set(key, Date.now());
  renderCard(log, { prepend: true, highlight: true });
  cleanupRenderedLogs();
});

socket.on('attendanceError', (err) => {
  console.error('Attendance fetch error:', err.message);
});

socket.on('disconnect', () => {
  console.log('[Socket] Frontend disconnected');
});

const deviceStatusContainer = document.getElementById('device-status');
const devices = new Map();

socket.on("deviceStatus", (device) => {
  console.log(device);
  devices.set(device.ip, device);
  renderDeviceStatus();
});

socket.on('deviceStatusInit', (list) => {
  list.forEach(dev => {
    devices.set(dev.ip, dev);
  });
  renderDeviceStatus();
});

function renderDeviceStatus() {
  deviceStatusContainer.innerHTML = "";

  devices.forEach(dev => {

    const card = document.createElement("div");
    card.classList.add("device-card");

    let statusClass = "status-error";
    let statusText = dev.status;
    let iconColor = "text-secondary";
    let bgColor = "bg-secondary";

    if (dev.status === "online") {
      statusClass = "status-online";
      statusText = "Online";
      iconColor = "text-success";
      bgColor = "bg-success";
    } 
    else if (dev.status === "offline") {
      statusClass = "status-offline";
      statusText = "Offline";
      iconColor = "text-muted";
      bgColor = "bg-muted";
      card.classList.add("device-offline-card");
    } 
    else if (dev.status === "reconnecting") {
      statusClass = "status-reconnecting";
      statusText = "Reconnecting";
      iconColor = "text-warning";
      bgColor = "bg-warning";
    }

    card.innerHTML = `
      <div class="device-card-left ${bgColor}">
        <i class="bi bi-fingerprint fs-5 ${iconColor}"></i>
      </div>

      <div class="device-card-right">
        <div class="device-name">${dev.deviceName}</div>
        <div class="device-status ${statusClass}">
          ${statusText}
        </div>
      </div>
    `;

    deviceStatusContainer.appendChild(card);
  });
}