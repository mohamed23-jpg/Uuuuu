const express = require("express");
const router = express.Router();
const Player = require("../models/Player");
const CardSkin = require("../models/CardSkin");
const { authMiddleware } = require("../middleware/auth");

// عناصر السوق الثابتة (إطارات الاسم)
const NAME_FRAMES = [
  { id: "fire", name: "ناري", price: 2000, rarity: "rare", rarityAr: "نادر" },
  { id: "ice", name: "جليدي", price: 3000, rarity: "epic", rarityAr: "فائق" },
  { id: "diamond", name: "ماسي", price: 4500, rarity: "legendary", rarityAr: "أسطوري" },
  { id: "crystal", name: "كريستالي", price: 6000, rarity: "divine", rarityAr: "إلهي" },
];

// حزم البطاقات الافتراضية
const DEFAULT_CARD_SKINS = [
  { id: "emerald", name: "الزمرد السائل", price: 2500, rarity: "rare", rarityAr: "نادر" },
  { id: "blue-flame", name: "اللهب الأزرق", price: 3500, rarity: "epic", rarityAr: "فائق" },
  { id: "black-marble", name: "الرخام الأسود", price: 5000, rarity: "legendary", rarityAr: "أسطوري" },
  { id: "crystal-pack", name: "الكريستال", price: 8000, rarity: "divine", rarityAr: "إلهي" },
];

// جلب عناصر السوق
// GET /api/market
router.get("/", authMiddleware, async (req, res) => {
  try {
    if (req.player.level < 40) {
      return res.status(403).json({ error: "السوق يُفتح عند المستوى 40" });
    }

    // حزم البطاقات من قاعدة البيانات + الافتراضية
    const dbSkins = await CardSkin.find({ isActive: true });
    const cardSkins = dbSkins.length > 0 ? dbSkins : DEFAULT_CARD_SKINS;

    return res.json({ cardSkins, nameFrames: NAME_FRAMES });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// شراء عنصر
// POST /api/market/buy
router.post("/buy", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const { itemType, itemId } = req.body;

    if (player.level < 40) {
      return res.status(403).json({ error: "السوق يُفتح عند المستوى 40" });
    }

    let item;
    if (itemType === "cardSkin") {
      const dbSkin = await CardSkin.findOne({ id: itemId });
      item = dbSkin || DEFAULT_CARD_SKINS.find((s) => s.id === itemId);

      // التحقق من الامتلاك
      if (player.inventory.cardSkins.some((s) => s.skinId === itemId)) {
        return res.status(409).json({ error: "تمتلك هذه الحزمة بالفعل" });
      }
    } else if (itemType === "nameFrame") {
      item = NAME_FRAMES.find((f) => f.id === itemId);

      if (player.inventory.nameFrames.some((f) => f.frameId === itemId)) {
        return res.status(409).json({ error: "تمتلك هذا الإطار بالفعل" });
      }
    } else {
      return res.status(400).json({ error: "نوع عنصر غير صالح" });
    }

    if (!item) return res.status(404).json({ error: "العنصر غير موجود" });

    if (player.coins < item.price) {
      return res.status(400).json({ error: `تحتاج إلى ${item.price} عملة` });
    }

    player.coins -= item.price;

    if (itemType === "cardSkin") {
      player.inventory.cardSkins.push({ skinId: itemId, equipped: false });
    } else {
      player.inventory.nameFrames.push({ frameId: itemId, equipped: false });
    }

    await player.save();
    return res.json({
      success: true,
      newCoins: player.coins,
      message: `تم شراء ${item.name} بنجاح`,
    });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
