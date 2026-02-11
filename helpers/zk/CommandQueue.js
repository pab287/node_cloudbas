module.exports = class CommandQueue {
  constructor(zk, tracer) {
    this.zk = zk;
    this.tracer = tracer;
    this.queue = [];
    this.busy = false;
  }

  enqueue(fn, label = 'CMD') {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject, label });
      this.process();
    });
  }

  async process() {
    if (this.busy || this.queue.length === 0) return;

    const job = this.queue.shift();
    this.busy = true;

    try {
      this.tracer.mark(job.label, 'START');
      const res = await job.fn();
      this.tracer.mark(job.label, 'END');
      job.resolve(res);
    } catch (e) {
      this.tracer.mark(job.label, 'ERR', e.message);
      job.reject(e);
    } finally {
      this.busy = false;
      setImmediate(() => this.process());
    }
  }
}