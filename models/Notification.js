const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    toPlayerId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: [
        "friend_request",
        "friend_accepted",
        "friend_removed",
        "blocked",
        "clan_message",
        "private_message",
        "new_mission",
        "mission_reset",
        "dev_announcement",
        "level_up",
        "clan_join_accepted",
        "clan_join_request",
      ],
      required: true,
    },
    message: { type: String, required: true },
    from: { type: String, default: null }, // playerId أو "system"
    fromNickname: { type: String, default: null },
    isRead: { type: Boolean, default: false },
    priority: { type: String, enum: ["high", "medium", "low"], default: "medium" },
    data: { type: mongoose.Schema.Types.Mixed, default: null }, // بيانات إضافية
  },
  { timestamps: true }
);

// حذف الإشعارات القديمة تلقائيًا (أكثر من 30 يوم)
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model("Notification", notificationSchema);
