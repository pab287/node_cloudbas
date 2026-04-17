// helpers/smsQueue.js
class SmsQueue {
  constructor(sendSmsFn, maxRetries = 3) {
    this.queue = [];
    this.sending = false;
    this.sendSmsFn = sendSmsFn; // your sendSms function
    this.maxRetries = maxRetries;
  }

  enqueue(smsPayload) {
    // Initialize retries count
    this.queue.push({ ...smsPayload, retries: 0 });
    this.processQueue();
    return this.sending; // Return whether the queue is currently processing
  }

  async processQueue() {
    if (this.sending) return;
    this.sending = true;

    while (this.queue.length > 0) {
      const payload = this.queue.shift();
      const { to, message, retries } = payload;

      try {
        const result = await this.sendSmsFn(to, message);
        const { response, success, message: responseMessage } = result;
        console.log(`[SMS Queue] Attempt to send SMS to ${to}, attempt ${retries + 1}:`, responseMessage ?? 'No response message');
        console.log(`[SMS Queue] Response Status:`, response.status);
        if (result.success) {
          console.log(`[SMS Queue] ✅ Sent SMS to ${to}`);
          console.log(`[SMS Queue] Message: ${message}`);
        } else {
          console.warn(`[SMS Queue] ⚠ Failed to send SMS to ${to}: ${result.message}`);
          if (retries < this.maxRetries) {
            console.log(`[SMS Queue] 🔄 Requeue SMS to ${to}, attempt ${retries + 1}`);
            this.queue.push({ to, message, retries: retries + 1 });
          } else {
            console.error(`[SMS Queue] ❌ SMS to ${to} failed after ${retries + 1} attempts`);
          }
        }
      } catch (err) {
        console.error(`[SMS Queue] ❌ Error sending SMS to ${to}:`, err.message);
        if (retries < this.maxRetries) {
          console.log(`[SMS Queue] 🔄 Requeue SMS to ${to}, attempt ${retries + 1}`);
          this.queue.push({ to, message, retries: retries + 1 });
        } else {
          console.error(`[SMS Queue] ❌ SMS to ${to} failed after ${retries + 1} attempts`);
        }
      }

      // Small delay between SMS to prevent flooding
      await new Promise(res => setTimeout(res, 500));
    }

    this.sending = false;
  }
}

module.exports = SmsQueue;
