class RealtimeManager {
  constructor(zk, ip, tracer) {
    this.zk = zk;
    this.ip = ip;
    this.tracer = tracer;
    this.active = false;
    this.handler = this.onRealtime.bind(this);
  }

  start() {
    if (this.active) return;
    this.active = true;

    this.zk.getRealTimeLogs(this.handler);
  }

  stop() {
    this.active = false;

    // ZKLib does NOT expose removeListener,
    // so force socket reset safely
    try {
      this.zk.socket?.removeAllListeners('data');
    } catch {}
  }

  onRealtime(data) {
    if (!this.active) return;

    this.tracer.trace(this.ip, 'RT', data);
    // emit event instead of processing inline
    this.onLog?.(data);
  }
}

module.exports = RealtimeManager;