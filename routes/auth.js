const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Player = require("../models/Player");
const { authLimiter } = require("../middleware/rateLimit");

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// POST /api/auth/register
router.post("/register", authLimiter, async (req, res) => {
  try {
    const { nickname, password, avatar, customAvatar } = req.body;

    if (!nickname || nickname.length < 3 || nickname.length > 20) {
      return res.status(400).json({ error: "الاسم يجب أن يكون بين 3 و20 حرف" });
    }
    const nicknameRegex = /^[\u0600-\u06FFa-zA-Z0-9\-_]+$/;
    if (!nicknameRegex.test(nickname)) {
      return res.status(400).json({ error: "الاسم يحتوي على أحرف غير مسموح بها" });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
    }

    const existing = await Player.findOne({
      nickname: { $regex: new RegExp(`^${nickname}$`, "i") },
    });
    if (existing) {
      return res.status(409).json({ error: "هذا الاسم مستخدم بالفعل" });
    }

    const isDev = nickname.toLowerCase() === "dooola-dev";
    let playerId;
    if (isDev) {
      playerId = "00000000";
      await Player.deleteOne({ playerId: "00000000" });
    } else {
      playerId = await Player.generatePlayerId();
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const player = new Player({
      playerId,
      nickname,
      passwordHash,
      avatar: avatar || "spy",
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
        activeTitle: player.activeTitle,
        isDev: player.isDev,
      },
    });
  } catch (err) {
    console.error("خطأ في التسجيل:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/auth/login
router.post("/login", authLimiter, async (req, res) => {
  try {
    const { playerId, nickname, password } = req.body;

    let player;
    if (playerId) {
      player = await Player.findOne({ playerId });
    } else if (nickname) {
      player = await Player.findOne({ nickname: { $regex: new RegExp(`^${nickname}$`, "i") } });
    }

    if (!player) {
      return res.status(404).json({ error: "اللاعب غير موجود" });
    }

    // التحقق من كلمة المرور — الحسابات القديمة بدون كلمة مرور تُقبل بدونها
    if (player.passwordHash) {
      if (!password) {
        return res.status(401).json({ error: "كلمة المرور مطلوبة" });
      }
      const valid = await bcrypt.compare(password, player.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "كلمة المرور غير صحيحة" });
      }
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
        activeTitle: player.activeTitle,
        isDev: player.isDev,
        clanId: player.clanId,
        stats: player.stats,
      },
    });
  } catch (err) {
    console.error("خطأ في تسجيل الدخول:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

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
    xpNeeded: p.xpNeeded ? p.xpNeeded() : 0,
    coins: p.coins,
    activeTitle: p.activeTitle,
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
