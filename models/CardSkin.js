const mongoose = require("mongoose");

const cardSkinSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    css: { type: String, required: true }, // CSS مخصص للبطاقة
    price: { type: Number, required: true },
    rarity: {
      type: String,
      enum: ["common", "rare", "epic", "legendary", "divine"],
      default: "rare",
    },
    rarityAr: { type: String, default: "نادر" },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, default: "system" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CardSkin", cardSkinSchema);
