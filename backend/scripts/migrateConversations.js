require("dotenv").config();
const mongoose = require("mongoose");
const Message = require("../../models/Message");
const Contact = require("../../models/Contact");
const Conversation = require("../../models/Conversation");

const runMigration = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set in environment.");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri);
  console.log("Connected.");

  console.log("Clearing existing conversations...");
  await Conversation.deleteMany({});

  console.log("Fetching message aggregation...");
  const pipeline = [
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: "$phone",
        lastMessage: { $first: "$text" },
        lastDirection: { $first: "$direction" },
        lastStatus: { $first: "$status" },
        lastTimestamp: { $first: "$timestamp" },
        contactName: { $first: "$contactName" },
        unreadCount: {
          $sum: {
            $cond: [{ $eq: ["$direction", "incoming"] }, 1, 0],
          },
        },
      },
    },
  ];

  const results = await Message.aggregate(pipeline);
  console.log(`Found ${results.length} conversation groups. Migrating...`);

  let count = 0;
  for (const conv of results) {
    const contact = await Contact.findOne({ phone: conv._id });
    await Conversation.create({
      phone: conv._id,
      contactName: contact?.name || conv.contactName || conv._id,
      lastMessage: conv.lastMessage || `[${conv.type || "text"}]`,
      lastDirection: conv.lastDirection,
      lastStatus: conv.lastStatus,
      lastTimestamp: conv.lastTimestamp,
      unreadCount: conv.unreadCount,
    });
    count++;
  }

  console.log(`Successfully migrated ${count} conversations.`);
  await mongoose.connection.close();
  console.log("Disconnected from MongoDB.");
};

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
