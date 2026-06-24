const mongoose = require("mongoose");

const clanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, minlength: 3, maxlength: 20 },
    icon: { type: String, default: "shield" }, // اختيار من 10 أيقونات
    description: { type: String, maxlength: 200, default: "" },
    leaderId: { type: String, required: true }, // playerId
    joinType: { type: String, enum: ["open", "request"], default: "open" },

    members: [
      {
        playerId: String,
        nickname: String,
        avatar: String,
        level: Number,
        role: { type: String, enum: ["member", "officer", "leader"], default: "member" },
        joinedAt: { type: Date, default: Date.now },
      },
    ],

    joinRequests: [
      {
        playerId: String,
        nickname: String,
        avatar: String,
        level: Number,
        sentAt: { type: Date, default: Date.now },
      },
    ],

    maxMembers: { type: Number, default: 50 },

    stats: {
      totalWins: { type: Number, default: 0 },
      totalGames: { type: Number, default: 0 },
    },

    // لوحة الكلان
    announcements: [
      {
        message: String,
        from: String,
        sentAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Clan", clanSchema);
