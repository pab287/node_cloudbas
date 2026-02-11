class PacketDemux {
  static classify(buf) {
    if (!Buffer.isBuffer(buf)) return 'UNKNOWN';

    // ZKLib realtime packets usually have event code
    if (buf.length > 8 && buf.readUInt16LE(4) === 0x01) {
      return 'REALTIME';
    }

    return 'COMMAND';
  }
}

module.exports = PacketDemux;