const RealtimeManager = require('./helpers/zk/realtimeManager');
const CommandQueue = require('./helpers/zk/CommandQueue');
const PacketDemux = require('./helpers/zk/packetDemux');
const PacketTracer = require('./helpers/zk/packetTracer');

module.exports = class DeviceConnection {
  constructor(ip, zk) {
    this.ip = ip;
    this.zk = zk;

    this.tracer = new PacketTracer();
    this.cmdQueue = new CommandQueue(zk, this.tracer);
    this.realtime = new RealtimeManager(zk, ip, this.tracer);
  }

  attachSocket() {
    this.zk.socket.on('data', buf => {
      const type = PacketDemux.classify(buf);
      this.tracer.trace(this.ip, type, buf);

      if (type === 'REALTIME') {
        this.realtime.onRealtime(buf);
      }
    });
  }

  async startRealtime() {
    this.realtime.start();
  }

  async exec(cmd, label) {
    return this.cmdQueue.enqueue(cmd, label);
  }

  async disconnect() {
    this.realtime.stop();
    this.zk.disconnect();
  }
};
