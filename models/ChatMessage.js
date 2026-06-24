const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema(
  {
    channel: {
      type: String,
      enum: ["global", "clan", "private"],
      required: true,
    },
    channelId: { type: String, default: null }, // clanId أو playerId للرسائل الخاصة
    fromPlayerId: { type: String, required: true },
    fromNickname: { type: String, required: true },
    fromAvatar: { type: String, default: "dino" },
    fromLevel: { type: Number, default: 1 },
    fromTitle: { type: String, default: "مبتدئ" },
    toPlayerId: { type: String, default: null }, // للرسائل الخاصة
    message: { type: String, required: true, maxlength: 500 },
    isFiltered: { type: Boolean, default: false },
    isDev: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// الاحتفاظ بآخر 500 رسالة فقط في القناة العامة
chatMessageSchema.index({ channel: 1, createdAt: -1 });

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
