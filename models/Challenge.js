const mongoose = require("mongoose");

const challengeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    condition: { type: String, required: true }, // wins/hints/correct/chat
    conditionValue: { type: Number, required: true },
    rewardType: { type: String, enum: ["xp", "coins", "cardPack", "nameFrame"], required: true },
    rewardValue: { type: Number, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, default: "DOoOla-Dev" },
    completedBy: [{ playerId: String, completedAt: Date }],
    claimedBy: [{ type: String }], // playerIds
  },
  { timestamps: true }
);

module.exports = mongoose.model("Challenge", challengeSchema);
