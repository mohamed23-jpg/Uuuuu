const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Player = require("../models/Player");
const { authLimiter } = require("../middleware/rateLimit");

// توليد التوكن
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// تسجيل لاعب جديد
// POST /api/auth/register
router.post("/register", authLimiter, async (req, res) => {
  try {
    const { nickname, avatar, customAvatar } = req.body;

    // التحقق من صحة الاسم
    if (!nickname || nickname.length < 3 || nickname.length > 20) {
      return res.status(400).json({ error: "الاسم يجب أن يكون بين 3 و20 حرف" });
    }

    const nicknameRegex = /^[\u0600-\u06FFa-zA-Z0-9\-]+$/;
    if (!nicknameRegex.test(nickname)) {
      return res.status(400).json({ error: "الاسم يحتوي على أحرف غير مسموح بها" });
    }

    // التحقق من الاسم المكرر
    const existing = await Player.findOne({
      nickname: { $regex: new RegExp(`^${nickname}$`, "i") },
    });
    if (existing) {
      return res.status(409).json({ error: "هذا الاسم مستخدم بالفعل" });
    }

    // الحالة الخاصة: DOoOla-Dev
    const isDev = nickname.toLowerCase() === "dooola-dev";
    let playerId;

    if (isDev) {
      playerId = "00000000";
      // حذف الحساب القديم إن وجد
      await Player.deleteOne({ playerId: "00000000" });
    } else {
      playerId = await Player.generatePlayerId();
    }

    // إنشاء اللاعب
    const player = new Player({
      playerId,
      nickname,
      avatar: avatar || "dino",
      customAvatar: customAvatar || null,
      isDev,
      level: 1,
      xp: 0,
      coins: 0,
      title: "مبتدئ",
      activeTitle: "مبتدئ",
      inventory: {
        unlockedTitles: ["مبتدئ"],
        cardSkins: [],
        nameFrames: [],
      },
    });

    const token = generateToken(player._id);
    player.token = token;
    await player.save();

    return res.status(201).json({
      success: true,
      token,
      player: {
        playerId: player.playerId,
        nickname: player.nickname,
        avatar: player.avatar,
        customAvatar: player.customAvatar,
        level: player.level,
        xp: player.xp,
        coins: player.coins,
        title: player.activeTitle,
        isDev: player.isDev,
      },
    });
  } catch (err) {
    console.error("خطأ في التسجيل:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// تسجيل دخول بالـ ID
// POST /api/auth/login
router.post("/login", authLimiter, async (req, res) => {
  try {
    const { playerId, nickname } = req.body;

    let player;
    if (playerId) {
      player = await Player.findOne({ playerId });
    } else if (nickname) {
      player = await Player.findOne({ nickname: { $regex: new RegExp(`^${nickname}$`, "i") } });
    }

    if (!player) {
      return res.status(404).json({ error: "اللاعب غير موجود" });
    }

    const token = generateToken(player._id);
    player.token = token;
    player.isOnline = true;
    player.lastSeen = new Date();
    await player.save();

    return res.json({
      success: true,
      token,
      player: {
        playerId: player.playerId,
        nickname: player.nickname,
        avatar: player.avatar,
        customAvatar: player.customAvatar,
        level: player.level,
        xp: player.xp,
        coins: player.coins,
        title: player.activeTitle,
        isDev: player.isDev,
        clanId: player.clanId,
      },
    });
  } catch (err) {
    console.error("خطأ في تسجيل الدخول:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// التحقق من صحة التوكن الحالي
// GET /api/auth/me
router.get("/me", require("../middleware/auth").authMiddleware, async (req, res) => {
  const p = req.player;
  return res.json({
    playerId: p.playerId,
    nickname: p.nickname,
    avatar: p.avatar,
    customAvatar: p.customAvatar,
    level: p.level,
    xp: p.xp,
    xpNeeded: p.xpNeeded(),
    coins: p.coins,
    title: p.activeTitle,
    isDev: p.isDev,
    clanId: p.clanId,
    stats: p.stats,
    settings: p.settings,
    inventory: p.inventory,
    maxFriends: p.maxFriends,
    maxPins: p.maxPins,
  });
});

module.exports = router;
