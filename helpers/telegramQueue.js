class TelegramQueue {
  constructor(sendTelegramFn, maxRetries = 3) {
    this.queue = [];
    this.sending = false;
    this.sendTelegramFn = sendTelegramFn;
    this.maxRetries = maxRetries;
  }

  enqueue(payload) {
    return new Promise((resolve) => {
      this.queue.push({ ...payload, retries: 0, resolve });
      this.processQueue().catch((err) => {
        console.error('[TelegramQueue] processQueue fatal error:', err.message);
        this.sending = false;
      });
    });
  }

  async processQueue() {
    if (this.sending) return;
    this.sending = true;

    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        const { chatId, data, retries, resolve } = job;

        try {
          const result = await this.sendTelegramFn(chatId, data);

          if (result === true) {
            console.log(`[TelegramQueue] ✅ Sent to ${chatId}`);
            resolve(true);
          } else {
            console.warn(`[TelegramQueue] ⚠ Failed to send to ${chatId}`);

            if (retries < this.maxRetries) {
              this.queue.push({ chatId, data, retries: retries + 1, resolve });
            } else {
              console.error(`[TelegramQueue] ❌ Failed after ${retries + 1} attempts`);
              resolve(false);
            }
          }
        } catch (err) {
          console.error(`[TelegramQueue] ❌ Error sending to ${chatId}:`, err.message);

          if (retries < this.maxRetries) {
            this.queue.push({ chatId, data, retries: retries + 1, resolve });
          } else {
            console.error(`[TelegramQueue] ❌ Failed after ${retries + 1} attempts`);
            resolve(false);
          }
        }

        await new Promise(res => setTimeout(res, 500));
      }
    } finally {
      this.sending = false;
    }
  }
}

module.exports = TelegramQueue;