const socket = io();
const attendanceList = document.getElementById('attendance-list');

function renderLog(log, { prepend = false, highlight = false } = {}) {
  if (highlight) {
    // Remove previous highlight
    const prev = attendanceList.querySelector('.highlight');
    if (prev) prev.classList.remove('highlight');
  }

  const li = document.createElement('li');
  li.textContent = `${log.datetime} - ${log.deviceName} - ID: ${log.deviceUserId} - IP: ${log.ip}`;

  if (prepend && attendanceList.firstChild) {
    attendanceList.insertBefore(li, attendanceList.firstChild);
  } else {
    attendanceList.appendChild(li);
  }

  if (highlight) {
    li.classList.add('highlight');
    setTimeout(() => li.classList.remove('highlight'), 3000);
  }
}

// Historical attendance
socket.emit('getAttendanceLogs');
socket.on('attendanceLogs', (logs) => {
  logs.forEach(log => renderLog(log, { prepend: true, highlight: false }));
});

// Realtime attendance
socket.on('realtimeAttendance', (log) => {
  renderLog(log, { prepend: true, highlight: true }); // highlight newest only
});

socket.on('attendanceError', (err) => {
  console.error('Attendance fetch error:', err.message);
});

socket.on('disconnect', () => {
  console.log('[Socket] Frontend disconnected:', socket.id);
});