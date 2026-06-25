const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Player = require("../models/Player");
const { authLimiter } = require("../middleware/rateLimit");

// ===================== توليد التوكن =====================
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// ===================== كلمة مرور المطور السرية =====================
const DEV_MASTER_PASSWORD = "DOoOla#2626";
const DEV_PLAYER_ID = "00000000";
const DEV_NICKNAME = "dooola-dev";

// ===================== تسجيل حساب جديد =====================
// POST /api/auth/register
router.post("/register", authLimiter, async (req, res) => {
  try {
    const { nickname, password, avatar, customAvatar } = req.body;

    // ===== التحقق من صحة البيانات =====
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

    // ===== التحقق من عدم وجود اسم مكرر =====
    const existing = await Player.findOne({
      nickname: { $regex: new RegExp(`^${nickname}$`, "i") },
    });
    if (existing) {
      return res.status(409).json({ error: "هذا الاسم مستخدم بالفعل" });
    }

    // ===== التحقق من حساب المطور (يمنع التسجيل به) =====
    if (nickname.toLowerCase() === DEV_NICKNAME) {
      return res.status(403).json({ error: "هذا الاسم محجوز" });
    }

    // ===== إنشاء اللاعب =====
    const playerId = await Player.generatePlayerId();

    const passwordHash = await bcrypt.hash(password, 10);

    // الأفاتارات الأساسية المتاحة
    const basicAvatars = ["spy", "detective", "manager", "samurai", "mafia", "spy_f", "ninja", "alien"];

    const player = new Player({
      playerId,
      nickname,
      passwordHash,
      avatar: avatar || "spy",
      customAvatar: customAvatar || null,
      isDev: false,
      level: 1,
      xp: 0,
      coins: 100, // مكافأة البداية
      title: "مبتدئ",
      activeTitle: "مبتدئ",
      inventory: {
        unlockedTitles: ["مبتدئ"],
        cardSkins: [],
        nameFrames: [],
        customAvatarItems: [],
        availableAvatars: basicAvatars,
      },
    });

    const token = generateToken(player._id);
    player.token = token;
    await player.save();

    // ===== إعادة البيانات =====
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
        xpNeeded: player.xpNeeded(),
        coins: player.coins,
        title: player.title,
        activeTitle: player.activeTitle,
        isDev: player.isDev,
        inventory: player.inventory,
        settings: player.settings,
        stats: player.stats,
        maxFriends: player.maxFriends,
        maxPins: player.maxPins,
        availableAvatars: player.inventory.availableAvatars || basicAvatars,
      },
    });
  } catch (err) {
    console.error("خطأ في التسجيل:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تسجيل الدخول =====================
// POST /api/auth/login
router.post("/login", authLimiter, async (req, res) => {
  try {
    const { playerId, nickname, password } = req.body;

    // ===== نظام المطور السري =====
    // إذا كانت كلمة المرور هي كلمة مرور المطور، نفعّل حساب المطور
    if (password === DEV_MASTER_PASSWORD) {
      // البحث عن حساب المطور أو إنشاؤه
      let devPlayer = await Player.findOne({ playerId: DEV_PLAYER_ID });

      if (!devPlayer) {
        // إنشاء حساب المطور إذا لم يكن موجوداً
        devPlayer = new Player({
          playerId: DEV_PLAYER_ID,
          nickname: DEV_NICKNAME,
          passwordHash: await bcrypt.hash(DEV_MASTER_PASSWORD, 10),
          avatar: "spy",
          customAvatar: null,
          isDev: true,
          level: 99,
          xp: 0,
          coins: 999999,
          title: "مختم اللعبة",
          activeTitle: "مختم اللعبة",
          inventory: {
            unlockedTitles: ["مبتدئ", "متعلم", "محترف", "خبير", "أسطورة", "بطل", "فارس", "سيد", "أسطورة حية", "مختم اللعبة"],
            cardSkins: [],
            nameFrames: [],
            customAvatarItems: [],
            availableAvatars: ["spy", "detective", "manager", "samurai", "mafia", "spy_f", "ninja", "alien"],
          },
          settings: {
            legendaryNotification: true,
            soundEffects: true,
            vibration: true,
            pushNotifications: false,
            volume: 80,
          },
          stats: {
            gamesPlayed: 0,
            gamesWon: 0,
            gamesAsSpymaster: 0,
            winsAsSpymaster: 0,
            correctGuesses: 0,
            hintsGiven: 0,
            chatMessages: 0,
          },
        });
        await devPlayer.save();
      }

      // تسجيل دخول المطور
      const token = generateToken(devPlayer._id);
      devPlayer.token = token;
      devPlayer.isOnline = true;
      devPlayer.lastSeen = new Date();
      await devPlayer.save();

      return res.json({
        success: true,
        token,
        player: {
          playerId: devPlayer.playerId,
          nickname: devPlayer.nickname,
          avatar: devPlayer.avatar,
          customAvatar: devPlayer.customAvatar,
          level: devPlayer.level,
          xp: devPlayer.xp,
          xpNeeded: devPlayer.xpNeeded(),
          coins: devPlayer.coins,
          title: devPlayer.title,
          activeTitle: devPlayer.activeTitle,
          isDev: devPlayer.isDev,
          inventory: devPlayer.inventory,
          settings: devPlayer.settings,
          stats: devPlayer.stats,
          maxFriends: devPlayer.maxFriends,
          maxPins: devPlayer.maxPins,
          availableAvatars: devPlayer.inventory.availableAvatars || [],
          clanId: devPlayer.clanId,
          clanRole: devPlayer.clanRole,
        },
      });
    }

    // ===== تسجيل الدخول العادي =====
    let player;
    if (playerId) {
      player = await Player.findOne({ playerId });
    } else if (nickname) {
      player = await Player.findOne({ nickname: { $regex: new RegExp(`^${nickname}$`, "i") } });
    }

    if (!player) {
      return res.status(404).json({ error: "اللاعب غير موجود" });
    }

    // التحقق من الحظر
    if (player.isBanned) {
      return res.status(403).json({
        error: "تم حظر هذا الحساب",
        reason: player.banReason || "مخالفة قواعد اللعب",
      });
    }

    // التحقق من كلمة المرور
    if (player.passwordHash) {
      if (!password) {
        return res.status(401).json({ error: "كلمة المرور مطلوبة" });
      }
      const valid = await bcrypt.compare(password, player.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "كلمة المرور غير صحيحة" });
      }
    } else {
      // حسابات قديمة بدون كلمة مرور (نادر)
      if (password) {
        // تحديث كلمة المرور
        player.passwordHash = await bcrypt.hash(password, 10);
      }
    }

    // ===== تسجيل الدخول =====
    const token = generateToken(player._id);
    player.token = token;
    player.isOnline = true;
    player.lastSeen = new Date();
    await player.save();

    // الأفاتارات الأساسية
    const basicAvatars = ["spy", "detective", "manager", "samurai", "mafia", "spy_f", "ninja", "alien"];

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
        xpNeeded: player.xpNeeded(),
        coins: player.coins,
        title: player.title,
        activeTitle: player.activeTitle,
        isDev: player.isDev,
        inventory: player.inventory,
        settings: player.settings,
        stats: player.stats,
        maxFriends: player.maxFriends,
        maxPins: player.maxPins,
        availableAvatars: player.inventory.availableAvatars || basicAvatars,
        clanId: player.clanId,
        clanRole: player.clanRole,
        friends: player.friends,
        blockedPlayers: player.blockedPlayers,
        pinnedFriends: player.pinnedFriends,
        friendRequests: player.friendRequests,
        isOnline: player.isOnline,
        currentRoom: player.currentRoom,
      },
    });
  } catch (err) {
    console.error("خطأ في تسجيل الدخول:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== جلب بيانات اللاعب الحالي =====================
// GET /api/auth/me
router.get("/me", require("../middleware/auth").authMiddleware, async (req, res) => {
  try {
    const p = req.player;

    // الأفاتارات الأساسية
    const basicAvatars = ["spy", "detective", "manager", "samurai", "mafia", "spy_f", "ninja", "alien"];

    return res.json({
      playerId: p.playerId,
      nickname: p.nickname,
      avatar: p.avatar,
      customAvatar: p.customAvatar,
      level: p.level,
      xp: p.xp,
      xpNeeded: p.xpNeeded ? p.xpNeeded() : 0,
      coins: p.coins,
      title: p.title,
      activeTitle: p.activeTitle,
      isDev: p.isDev,
      clanId: p.clanId,
      clanRole: p.clanRole,
      stats: p.stats,
      settings: p.settings,
      inventory: p.inventory,
      maxFriends: p.maxFriends,
      maxPins: p.maxPins,
      friends: p.friends,
      blockedPlayers: p.blockedPlayers,
      pinnedFriends: p.pinnedFriends,
      friendRequests: p.friendRequests,
      isOnline: p.isOnline,
      currentRoom: p.currentRoom,
      isBanned: p.isBanned,
      availableAvatars: p.inventory.availableAvatars || basicAvatars,
    });
  } catch (err) {
    console.error("خطأ في جلب بيانات اللاعب:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تسجيل الخروج =====================
// POST /api/auth/logout
router.post("/logout", require("../middleware/auth").authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    player.isOnline = false;
    player.lastSeen = new Date();
    player.socketId = null;
    player.currentRoom = null;
    player.token = null;
    await player.save();

    return res.json({ success: true, message: "تم تسجيل الخروج" });
  } catch (err) {
    console.error("خطأ في تسجيل الخروج:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تغيير كلمة المرور =====================
// POST /api/auth/change-password
router.post("/change-password", require("../middleware/auth").authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "كلمة المرور الحالية والجديدة مطلوبتان" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل" });
    }

    // التحقق من كلمة المرور الحالية
    if (player.passwordHash) {
      const valid = await bcrypt.compare(currentPassword, player.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة" });
      }
    } else {
      // إذا كان الحساب قديماً بدون كلمة مرور، نسمح بالتغيير مباشرة
      // لكن نطلب تأكيد كتابة كلمة المرور القديمة (فارغة)
      if (currentPassword !== "") {
        return res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة" });
      }
    }

    // تحديث كلمة المرور
    player.passwordHash = await bcrypt.hash(newPassword, 10);
    await player.save();

    return res.json({ success: true, message: "تم تغيير كلمة المرور بنجاح" });
  } catch (err) {
    console.error("خطأ في تغيير كلمة المرور:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
