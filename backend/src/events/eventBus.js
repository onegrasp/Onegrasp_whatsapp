const EventEmitter = require("events");
const logger = require("../utils/logger");

class EventBus extends EventEmitter {
  // Runs every handler and resolves once they have all finished, so a webhook
  // can reply only after its work is saved (a serverless host may stop as soon
  // as the response is sent). Handler errors are logged, never thrown.
  publish(event, data) {
    logger.debug(`[EventBus] Publishing ${event}`);
    return Promise.all(this.listeners(event).map((listener) => listener(data)));
  }

  subscribe(event, callback) {
    this.on(event, async (data) => {
      try {
        await callback(data);
      } catch (err) {
        logger.error(`[EventBus] Error in subscription handler for event ${event}:`, { error: err });
      }
    });
  }
}

const eventBus = new EventBus();
module.exports = eventBus;
