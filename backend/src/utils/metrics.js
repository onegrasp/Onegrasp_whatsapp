const logger = require("./logger");

const metrics = {
  dbLatency: 0,
  twilioLatency: 0,
  queueDuration: 0,
  apiDurations: [],

  recordApiDuration(route, duration) {
    this.apiDurations.push({ route, duration, timestamp: Date.now() });
    if (this.apiDurations.length > 500) {
      this.apiDurations.shift();
    }
    logger.debug(`API Latency: ${route} completed in ${duration}ms`);
  },

  recordDbLatency(duration) {
    this.dbLatency = duration;
    logger.debug(`DB Latency: query execution took ${duration}ms`);
  },

  recordTwilioLatency(duration) {
    this.twilioLatency = duration;
    logger.debug(`Twilio API Latency: request took ${duration}ms`);
  },

  recordQueueDuration(duration) {
    this.queueDuration = duration;
    logger.debug(`Queue execution latency: job processed in ${duration}ms`);
  },

  getStats() {
    const memory = process.memoryUsage();
    return {
      memory: {
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + "MB",
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + "MB",
        rss: Math.round(memory.rss / 1024 / 1024) + "MB",
      },
      cpu: process.cpuUsage(),
      dbLatencyMs: this.dbLatency,
      twilioLatencyMs: this.twilioLatency,
      queueDurationMs: this.queueDuration,
    };
  }
};

module.exports = metrics;
