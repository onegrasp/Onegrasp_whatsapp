const statusMap = {
  queued: "queued",
  accepted: "accepted",
  sending: "sending",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  undelivered: "undelivered",
};

const statusService = {
  mapStatus(twilioStatus) {
    return statusMap[twilioStatus] || twilioStatus;
  }
};

module.exports = statusService;
