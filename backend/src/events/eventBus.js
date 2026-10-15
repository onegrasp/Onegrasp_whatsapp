const EventEmitter = require("events");
const logger = require("../utils/logger");

class EventBus extends EventEmitter {
  publish(event, data) {
    logger.debug(`[EventBus] Publishing ${event}`);
    this.emit(event, data);
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
