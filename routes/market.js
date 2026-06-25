const express = require("express");
const router = express.Router();
const Player = require("../models/Player");
const CardSkin = require("../models/CardSkin");
const Notification = require("../models/Notification");
const { authMiddleware } = require("../middleware/auth");

// ===================== عناصر السوق الثابتة (إطارات الأسماء) =====================
const NAME_FRAMES = [
  {
    id: "fire",
    name: "ناري",
    price: 2000,
    rarity: "rare",
    rarityAr: "نادر",
    css: "border: 2px solid #ff6b00; box-shadow: 0 0 15px rgba(255,107,0,0.5);",
  },
  {
    id: "ice",
    name: "جليدي",
    price: 3000,
    rarity: "epic",
    rarityAr: "فائق",
    css: "border: 2px solid #00bfff; box-shadow: 0 0 15px rgba(0,191,255,0.5);",
  },
  {
    id: "diamond",
    name: "ماسي",
    price: 4500,
    rarity: "legendary",
    rarityAr: "أسطوري",
    css: "border: 2px solid #b9f2ff; box-shadow: 0 0 25px rgba(185,242,255,0.6);",
  },
  {
    id: "crystal",
    name: "كريستالي",
    price: 6000,
    rarity: "mythic",
    rarityAr: "خارق",
    css: "border: 2px solid #ff6bff; box-shadow: 0 0 30px rgba(255,107,255,0.6);",
  },
];

// ===================== عناصر السوق الثابتة (الأفاتارات) =====================
const AVATAR_ITEMS = [
  {
    id: "spy_gold",
    name: "جاسوس ذهبي",
    price: 5000,
    rarity: "legendary",
    rarityAr: "أسطوري",
    avatarType: "spy",
    css: "filter: drop-shadow(0 0 15px gold);",
  },
  {
    id: "ninja_shadow",
    name: "نينجا الظل",
    price: 4000,
    rarity: "epic",
    rarityAr: "فائق",
    avatarType: "ninja",
    css: "filter: drop-shadow(0 0 10px #444);",
  },
  {
    id: "samurai_red",
    name: "سامورائي أحمر",
    price: 3500,
    rarity: "rare",
    rarityAr: "نادر",
    avatarType: "samurai",
    css: "filter: drop-shadow(0 0 10px #ff3333);",
  },
  {
    id: "alien_glow",
    name: "فضائي متوهج",
    price: 6000,
    rarity: "mythic",
    rarityAr: "خارق",
    avatarType: "alien",
    css: "filter: drop-shadow(0 0 20px #00ff88);",
  },
];

// ===================== جلب عناصر السوق =====================
// GET /api/market
router.get("/", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    // التحقق من مستوى فتح السوق (المستوى 8)
    if (player.level < 8) {
      return res.status(403).json({
        error: "السوق يُفتح عند المستوى 8",
        requiredLevel: 8,
        currentLevel: player.level,
      });
    }

    // جلب حزم البطاقات من قاعدة البيانات + الافتراضية (للتأكد من وجودها)
    const dbSkins = await CardSkin.find({ isActive: true }).sort({ rarityOrder: 1, price: 1 });

    // إذا لم توجد حزم في قاعدة البيانات، نستخدم الحزم الافتراضية
    const defaultSkins = [
      {
        id: "emerald",
        name: "الزمرد السائل",
        price: 2500,
        rarity: "rare",
        rarityAr: "نادر",
        css: "background: linear-gradient(135deg, #1a5c2a, #2ecc71); border: 2px solid #2ecc71;",
      },
      {
        id: "blue-flame",
        name: "اللهب الأزرق",
        price: 3500,
        rarity: "epic",
        rarityAr: "فائق",
        css: "background: linear-gradient(135deg, #0a1628, #00d4ff); border: 2px solid #00d4ff;",
      },
      {
        id: "black-marble",
        name: "الرخام الأسود",
        price: 5000,
        rarity: "legendary",
        rarityAr: "أسطوري",
        css: "background: linear-gradient(135deg, #1a1a1a, #444); border: 2px solid #888;",
      },
      {
        id: "crystal-pack",
        name: "الكريستال",
        price: 8000,
        rarity: "mythic",
        rarityAr: "خارق",
        css: "background: linear-gradient(135deg, #1a0a2e, #b829dd); border: 2px solid #b829dd; box-shadow: 0 0 20px rgba(184,41,221,0.4);",
      },
    ];

    const cardSkins = dbSkins.length > 0 ? dbSkins : defaultSkins;

    // إضافة حالة الملكية لكل عنصر
    const ownedSkinIds = player.inventory.cardSkins.map((s) => s.skinId);
    const ownedFrameIds = player.inventory.nameFrames.map((f) => f.frameId);
    const ownedAvatarIds = player.inventory.customAvatarItems || [];

    const cardSkinsWithStatus = cardSkins.map((skin) => ({
      ...skin.toObject ? skin.toObject() : skin,
      owned: ownedSkinIds.includes(skin.id),
    }));

    const nameFramesWithStatus = NAME_FRAMES.map((frame) => ({
      ...frame,
      owned: ownedFrameIds.includes(frame.id),
    }));

    const avatarsWithStatus = AVATAR_ITEMS.map((avatar) => ({
      ...avatar,
      owned: ownedAvatarIds.includes(avatar.id),
    }));

    return res.json({
      cardSkins: cardSkinsWithStatus,
      nameFrames: nameFramesWithStatus,
      avatars: avatarsWithStatus,
      playerCoins: player.coins,
      playerLevel: player.level,
    });
  } catch (err) {
    console.error("خطأ في جلب السوق:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== شراء عنصر =====================
// POST /api/market/buy
router.post("/buy", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const { itemType, itemId } = req.body;

    if (!itemType || !itemId) {
      return res.status(400).json({ error: "نوع العنصر ومعرفه مطلوبان" });
    }

    // التحقق من مستوى فتح السوق
    if (player.level < 8) {
      return res.status(403).json({
        error: "السوق يُفتح عند المستوى 8",
        requiredLevel: 8,
        currentLevel: player.level,
      });
    }

    let item = null;
    let ownedCheck = false;

    // ===== تحديد العنصر والتحقق من الملكية =====
    if (itemType === "cardSkin") {
      // البحث في قاعدة البيانات أولاً
      let skin = await CardSkin.findOne({ id: itemId, isActive: true });

      // إذا لم يوجد، نبحث في القائمة الافتراضية
      if (!skin) {
        const defaultSkins = [
          { id: "emerald", name: "الزمرد السائل", price: 2500, rarity: "rare", rarityAr: "نادر" },
          { id: "blue-flame", name: "اللهب الأزرق", price: 3500, rarity: "epic", rarityAr: "فائق" },
          { id: "black-marble", name: "الرخام الأسود", price: 5000, rarity: "legendary", rarityAr: "أسطوري" },
          { id: "crystal-pack", name: "الكريستال", price: 8000, rarity: "mythic", rarityAr: "خارق" },
        ];
        skin = defaultSkins.find((s) => s.id === itemId);
      }

      if (!skin) {
        return res.status(404).json({ error: "الحزمة غير موجودة" });
      }

      item = skin;
      ownedCheck = player.inventory.cardSkins.some((s) => s.skinId === itemId);

    } else if (itemType === "nameFrame") {
      const frame = NAME_FRAMES.find((f) => f.id === itemId);
      if (!frame) {
        return res.status(404).json({ error: "الإطار غير موجود" });
      }
      item = frame;
      ownedCheck = player.inventory.nameFrames.some((f) => f.frameId === itemId);

    } else if (itemType === "avatar") {
      const avatar = AVATAR_ITEMS.find((a) => a.id === itemId);
      if (!avatar) {
        return res.status(404).json({ error: "الأفاتار غير موجود" });
      }
      item = avatar;
      ownedCheck = (player.inventory.customAvatarItems || []).includes(itemId);

    } else {
      return res.status(400).json({ error: "نوع عنصر غير صالح" });
    }

    // التحقق من الملكية
    if (ownedCheck) {
      return res.status(409).json({ error: "تمتلك هذا العنصر بالفعل" });
    }

    // التحقق من العملات
    if (player.coins < item.price) {
      return res.status(400).json({
        error: `تحتاج إلى ${item.price.toLocaleString()} عملة`,
        required: item.price,
        current: player.coins,
      });
    }

    // ===== خصم العملات وإضافة العنصر =====
    player.coins -= item.price;

    if (itemType === "cardSkin") {
      player.inventory.cardSkins.push({
        skinId: item.id,
        equipped: false,
      });
    } else if (itemType === "nameFrame") {
      player.inventory.nameFrames.push({
        frameId: item.id,
        equipped: false,
      });
    } else if (itemType === "avatar") {
      if (!player.inventory.customAvatarItems) {
        player.inventory.customAvatarItems = [];
      }
      player.inventory.customAvatarItems.push(item.id);

      // إذا كان الأفاتار له نوع محدد، نضيفه كأفاتار متاح
      if (item.avatarType) {
        if (!player.inventory.availableAvatars) {
          player.inventory.availableAvatars = [];
        }
        if (!player.inventory.availableAvatars.includes(item.avatarType)) {
          player.inventory.availableAvatars.push(item.avatarType);
        }
      }
    }

    await player.save();

    // ===== إنشاء إشعار =====
    const notification = new Notification({
      toPlayerId: player.playerId,
      type: "purchase_confirmed",
      message: `تم شراء ${item.name} بنجاح`,
      from: "system",
      fromNickname: "النظام",
      priority: "medium",
      data: {
        itemType,
        itemId,
        itemName: item.name,
        price: item.price,
        newCoins: player.coins,
      },
    });
    await notification.save();

    // ===== إشعار عبر Socket =====
    const io = req.app.get("io");
    if (player.socketId) {
      io.to(player.socketId).emit("notification", {
        type: "purchase_confirmed",
        message: `تم شراء ${item.name} بنجاح`,
        priority: "medium",
        data: {
          itemType,
          itemId,
          itemName: item.name,
          price: item.price,
          newCoins: player.coins,
        },
      });

      io.to(player.socketId).emit("market_purchase", {
        success: true,
        itemType,
        itemId,
        itemName: item.name,
        newCoins: player.coins,
      });
    }

    return res.json({
      success: true,
      message: `تم شراء ${item.name} بنجاح`,
      itemName: item.name,
      itemType,
      itemId,
      newCoins: player.coins,
      price: item.price,
    });
  } catch (err) {
    console.error("خطأ في شراء العنصر:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== شراء مجموعة (للمطور) =====================
// POST /api/market/gift
router.post("/gift", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    if (!player.isDev) {
      return res.status(403).json({ error: "صلاحيات المطور مطلوبة" });
    }

    const { targetPlayerId, itemType, itemId } = req.body;

    if (!targetPlayerId || !itemType || !itemId) {
      return res.status(400).json({ error: "البيانات ناقصة" });
    }

    const target = await Player.findOne({ playerId: targetPlayerId });
    if (!target) {
      return res.status(404).json({ error: "اللاعب المستهدف غير موجود" });
    }

    // تنفيذ نفس منطق الشراء ولكن بدون خصم عملات
    let item = null;
    let ownedCheck = false;

    if (itemType === "cardSkin") {
      let skin = await CardSkin.findOne({ id: itemId, isActive: true });
      if (!skin) {
        const defaultSkins = [
          { id: "emerald", name: "الزمرد السائل", price: 2500 },
          { id: "blue-flame", name: "اللهب الأزرق", price: 3500 },
          { id: "black-marble", name: "الرخام الأسود", price: 5000 },
          { id: "crystal-pack", name: "الكريستال", price: 8000 },
        ];
        skin = defaultSkins.find((s) => s.id === itemId);
      }
      if (!skin) return res.status(404).json({ error: "الحزمة غير موجودة" });
      item = skin;
      ownedCheck = target.inventory.cardSkins.some((s) => s.skinId === itemId);
    } else if (itemType === "nameFrame") {
      const frame = NAME_FRAMES.find((f) => f.id === itemId);
      if (!frame) return res.status(404).json({ error: "الإطار غير موجود" });
      item = frame;
      ownedCheck = target.inventory.nameFrames.some((f) => f.frameId === itemId);
    } else {
      return res.status(400).json({ error: "نوع عنصر غير صالح" });
    }

    if (ownedCheck) {
      return res.status(409).json({ error: "اللاعب يمتلك هذا العنصر بالفعل" });
    }

    // إضافة العنصر للمستهدف
    if (itemType === "cardSkin") {
      target.inventory.cardSkins.push({ skinId: item.id, equipped: false });
    } else if (itemType === "nameFrame") {
      target.inventory.nameFrames.push({ frameId: item.id, equipped: false });
    }

    await target.save();

    // إشعار للمستلم
    const notification = new Notification({
      toPlayerId: target.playerId,
      type: "purchase_confirmed",
      message: `تم إهداؤك ${item.name} من المطور`,
      from: player.playerId,
      fromNickname: player.nickname,
      priority: "high",
      data: {
        itemType,
        itemId,
        itemName: item.name,
        giftedBy: player.nickname,
      },
    });
    await notification.save();

    const io = req.app.get("io");
    if (target.socketId) {
      io.to(target.socketId).emit("notification", {
        type: "purchase_confirmed",
        message: `تم إهداؤك ${item.name} من المطور`,
        priority: "high",
        data: { itemName: item.name, giftedBy: player.nickname },
      });
    }

    return res.json({
      success: true,
      message: `تم إهداء ${item.name} للاعب ${target.nickname}`,
    });
  } catch (err) {
    console.error("خطأ في الإهداء:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إعادة تعيين عناصر السوق (للمطور) =====================
// POST /api/market/reset
router.post("/reset", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    if (!player.isDev) {
      return res.status(403).json({ error: "صلاحيات المطور مطلوبة" });
    }

    // حذف جميع حزم البطاقات وإعادة إنشاء الحزم الافتراضية
    await CardSkin.deleteMany({});

    const defaultSkins = [
      { id: "emerald", name: "الزمرد السائل", price: 2500, rarity: "rare", rarityAr: "نادر", css: "background: linear-gradient(135deg, #1a5c2a, #2ecc71); border: 2px solid #2ecc71;" },
      { id: "blue-flame", name: "اللهب الأزرق", price: 3500, rarity: "epic", rarityAr: "فائق", css: "background: linear-gradient(135deg, #0a1628, #00d4ff); border: 2px solid #00d4ff;" },
      { id: "black-marble", name: "الرخام الأسود", price: 5000, rarity: "legendary", rarityAr: "أسطوري", css: "background: linear-gradient(135deg, #1a1a1a, #444); border: 2px solid #888;" },
      { id: "crystal-pack", name: "الكريستال", price: 8000, rarity: "mythic", rarityAr: "خارق", css: "background: linear-gradient(135deg, #1a0a2e, #b829dd); border: 2px solid #b829dd; box-shadow: 0 0 20px rgba(184,41,221,0.4);" },
    ];

    const created = await CardSkin.insertMany(defaultSkins);

    return res.json({
      success: true,
      message: `تم إعادة تعيين السوق، تم إنشاء ${created.length} حزمة`,
    });
  } catch (err) {
    console.error("خطأ في إعادة تعيين السوق:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
