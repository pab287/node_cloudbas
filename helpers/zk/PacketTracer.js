class PacketTracer {
  trace(ip, type, buf) {
    console.log(
      `[${ip}] ${type} ${buf.length}B ::`,
      buf.toString('hex').slice(0, 80)
    );
  }

  mark(tag, stage, msg = '') {
    console.log(`[${tag}] ${stage}`, msg);
  }
}

module.exports = PacketTracer;