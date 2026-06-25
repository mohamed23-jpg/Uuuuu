const express = require("express");
const router = express.Router();
const Player = require("../models/Player");
const Clan = require("../models/Clan");
const Challenge = require("../models/Challenge");
const CardSkin = require("../models/CardSkin");
const Notification = require("../models/Notification");
const ChatMessage = require("../models/ChatMessage");
const { authMiddleware, devMiddleware } = require("../middleware/auth");

// جميع مسارات لوحة القائد تتطلب صلاحيات المطور
router.use(authMiddleware, devMiddleware);

// ===================== إحصائيات عامة =====================
// GET /api/admin/stats
router.get("/stats", async (req, res) => {
  try {
    const [totalPlayers, onlinePlayers, totalClans, totalChallenges] = await Promise.all([
      Player.countDocuments(),
      Player.countDocuments({ isOnline: true }),
      Clan.countDocuments(),
      Challenge.countDocuments({ isActive: true }),
    ]);

    const io = req.app.get("io");
    const rooms = req.app.get("rooms") || {};
    const activeRooms = Object.keys(rooms).length;

    return res.json({
      totalPlayers,
      onlinePlayers,
      totalClans,
      totalChallenges,
      activeRooms,
    });
  } catch (err) {
    console.error("خطأ في جلب الإحصائيات:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إدارة اللاعبين - بحث =====================
// GET /api/admin/players?q=nickname
router.get("/players", async (req, res) => {
  try {
    const { q } = req.query;
    const query = q
      ? {
          $or: [
            { nickname: { $regex: q, $options: "i" } },
            { playerId: { $regex: q } },
          ],
        }
      : {};

    const players = await Player.find(query)
      .select("playerId nickname avatar level coins xp isDev isOnline clanId stats isBanned")
      .limit(20);

    return res.json(players);
  } catch (err) {
    console.error("خطأ في البحث عن اللاعبين:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== عرض ملف لاعب بالـ ID =====================
// GET /api/admin/player/:playerId
router.get("/player/:playerId", async (req, res) => {
  try {
    const player = await Player.findOne({ playerId: req.params.playerId })
      .select("-passwordHash -__v -token");

    if (!player) {
      return res.status(404).json({ error: "اللاعب غير موجود" });
    }

    // إضافة معلومات إضافية للعرض
    const playerData = player.toObject();
    playerData.xpNeeded = player.xpNeeded ? player.xpNeeded() : 0;
    playerData.totalXp = 0;
    for (let i = 2; i <= player.level; i++) {
      playerData.totalXp += Math.floor(100 * (i - 1) * (1 + (i - 1) / 20));
    }

    return res.json(playerData);
  } catch (err) {
    console.error("خطأ في جلب ملف اللاعب:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== منح عملات/XP/لقب للاعب =====================
// POST /api/admin/players/:playerId/grant
router.post("/players/:playerId/grant", async (req, res) => {
  try {
    const { coins, xp, title } = req.body;
    const player = await Player.findOne({ playerId: req.params.playerId });

    if (!player) {
      return res.status(404).json({ error: "اللاعب غير موجود" });
    }

    const response = { success: true };

    if (coins !== undefined && !isNaN(coins)) {
      player.coins += parseInt(coins);
      response.coinsAdded = parseInt(coins);
      response.newCoins = player.coins;
    }

    if (xp !== undefined && !isNaN(xp)) {
      const rewards = await player.addXP(parseInt(xp));
      await player.save();
      response.xpAdded = parseInt(xp);
      response.newLevel = player.level;
      response.newXp = player.xp;
      response.rewards = rewards;
    }

    if (title && typeof title === "string") {
      if (!player.inventory.unlockedTitles.includes(title)) {
        player.inventory.unlockedTitles.push(title);
      }
      player.activeTitle = title;
      response.titleSet = title;
    }

    await player.save();
    return res.json(response);
  } catch (err) {
    console.error("خطأ في منح المكافآت:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== حظر/إلغاء حظر لاعب =====================
// POST /api/admin/players/:playerId/ban
router.post("/players/:playerId/ban", async (req, res) => {
  try {
    const { banned, reason } = req.body;
    const player = await Player.findOne({ playerId: req.params.playerId });

    if (!player) {
      return res.status(404).json({ error: "اللاعب غير موجود" });
    }

    if (player.isDev) {
      return res.status(403).json({ error: "لا يمكن حظر المطور" });
    }

    player.isBanned = banned === true;
    player.banReason = reason || "";

    if (banned && player.socketId) {
      const io = req.app.get("io");
      io.to(player.socketId).emit("banned", {
        reason: player.banReason || "مخالفة قواعد اللعب",
      });
    }

    await player.save();

    return res.json({
      success: true,
      isBanned: player.isBanned,
      reason: player.banReason,
    });
  } catch (err) {
    console.error("خطأ في حظر اللاعب:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إرسال إشعار لمستخدم محدد (منبثق) =====================
// POST /api/admin/notify/:playerId
router.post("/notify/:playerId", async (req, res) => {
  try {
    const { message, type } = req.body;
    const targetId = req.params.playerId;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "نص الإشعار مطلوب" });
    }

    const target = await Player.findOne({ playerId: targetId });
    if (!target) {
      return res.status(404).json({ error: "اللاعب غير موجود" });
    }

    // حفظ الإشعار في قاعدة البيانات
    const notification = new Notification({
      toPlayerId: targetId,
      type: "dev_announcement",
      message: message.trim(),
      from: req.player.playerId,
      fromNickname: req.player.nickname,
      priority: "high",
      data: { fromDev: true },
    });
    await notification.save();

    // إرسال إشعار منبثق عبر Socket.io
    const io = req.app.get("io");
    if (target.socketId) {
      io.to(target.socketId).emit("notification", {
        type: "dev_announcement",
        message: message.trim(),
        from: req.player.nickname,
        priority: "high",
        data: notification,
      });

      // إرسال إشعار منبثق إضافي (popup)
      io.to(target.socketId).emit("dev_popup", {
        message: message.trim(),
        from: req.player.nickname,
        timestamp: new Date(),
      });
    }

    return res.json({
      success: true,
      message: "تم إرسال الإشعار للمستخدم",
    });
  } catch (err) {
    console.error("خطأ في إرسال الإشعار للمستخدم:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== بث إشعار عام لكل اللاعبين =====================
// POST /api/admin/broadcast
router.post("/broadcast", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "نص الإشعار مطلوب" });
    }

    const io = req.app.get("io");
    io.emit("dev_announcement", {
      message: message.trim(),
      from: req.player.nickname || "المطور",
      timestamp: new Date(),
    });

    // حفظ الإشعار لكل اللاعبين المتصلين
    const onlinePlayers = await Player.find({ isOnline: true }).select("playerId");
    const notifications = onlinePlayers.map((p) => ({
      toPlayerId: p.playerId,
      type: "dev_announcement",
      message: message.trim(),
      from: req.player.playerId,
      fromNickname: req.player.nickname,
      priority: "medium",
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }

    return res.json({
      success: true,
      message: "تم إرسال الإشعار لكل اللاعبين المتصلين",
    });
  } catch (err) {
    console.error("خطأ في البث العام:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إدارة التحديات =====================

// GET /api/admin/challenges
router.get("/challenges", async (req, res) => {
  try {
    const challenges = await Challenge.find().sort({ createdAt: -1 });
    return res.json(challenges);
  } catch (err) {
    console.error("خطأ في جلب التحديات:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/challenges
router.post("/challenges", async (req, res) => {
  try {
    const {
      name,
      description,
      condition,
      conditionValue,
      rewardType,
      rewardValue,
      startDate,
      endDate,
      isActive,
    } = req.body;

    // التحقق من البيانات المطلوبة
    if (!name || !description || !condition || !conditionValue || !rewardType || !rewardValue) {
      return res.status(400).json({ error: "جميع الحقول مطلوبة" });
    }

    const challenge = new Challenge({
      name: name.trim(),
      description: description.trim(),
      condition,
      conditionValue: parseInt(conditionValue),
      rewardType,
      rewardValue: parseInt(rewardValue),
      startDate: startDate || new Date(),
      endDate: endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      isActive: isActive !== undefined ? isActive : true,
      createdBy: req.player.playerId,
    });

    await challenge.save();
    return res.status(201).json(challenge);
  } catch (err) {
    console.error("خطأ في إنشاء التحدي:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/challenges/:id
router.put("/challenges/:id", async (req, res) => {
  try {
    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ error: "التحدي غير موجود" });
    }

    const updates = req.body;
    Object.keys(updates).forEach((key) => {
      if (key !== "_id" && key !== "__v" && key !== "createdBy") {
        challenge[key] = updates[key];
      }
    });

    await challenge.save();
    return res.json(challenge);
  } catch (err) {
    console.error("خطأ في تحديث التحدي:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/challenges/:id
router.delete("/challenges/:id", async (req, res) => {
  try {
    const challenge = await Challenge.findByIdAndDelete(req.params.id);
    if (!challenge) {
      return res.status(404).json({ error: "التحدي غير موجود" });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("خطأ في حذف التحدي:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إدارة المهام (مهام اليومية/الأسبوعية) =====================

// GET /api/admin/missions
router.get("/missions", async (req, res) => {
  try {
    const { type } = req.query;
    const missions = await Mission.find(type ? { type } : {}).sort({ createdAt: -1 });
    return res.json(missions);
  } catch (err) {
    console.error("خطأ في جلب المهام:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/missions
router.post("/missions", async (req, res) => {
  try {
    const {
      name,
      description,
      type,
      condition,
      conditionValue,
      rewardXp,
      rewardCoins,
    } = req.body;

    if (!name || !description || !type || !condition || !conditionValue) {
      return res.status(400).json({ error: "جميع الحقول مطلوبة" });
    }

    const mission = new Mission({
      name: name.trim(),
      description: description.trim(),
      type,
      condition,
      conditionValue: parseInt(conditionValue),
      rewardXp: parseInt(rewardXp) || 0,
      rewardCoins: parseInt(rewardCoins) || 0,
      createdBy: req.player.playerId,
    });

    await mission.save();
    return res.status(201).json(mission);
  } catch (err) {
    console.error("خطأ في إنشاء المهمة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/missions/:id
router.put("/missions/:id", async (req, res) => {
  try {
    const mission = await Mission.findById(req.params.id);
    if (!mission) {
      return res.status(404).json({ error: "المهمة غير موجودة" });
    }

    const updates = req.body;
    Object.keys(updates).forEach((key) => {
      if (key !== "_id" && key !== "__v" && key !== "createdBy") {
        mission[key] = updates[key];
      }
    });

    await mission.save();
    return res.json(mission);
  } catch (err) {
    console.error("خطأ في تحديث المهمة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/missions/:id
router.delete("/missions/:id", async (req, res) => {
  try {
    const mission = await Mission.findByIdAndDelete(req.params.id);
    if (!mission) {
      return res.status(404).json({ error: "المهمة غير موجودة" });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("خطأ في حذف المهمة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إدارة حزم البطاقات =====================

// GET /api/admin/card-skins
router.get("/card-skins", async (req, res) => {
  try {
    const skins = await CardSkin.find().sort({ createdAt: -1 });
    return res.json(skins);
  } catch (err) {
    console.error("خطأ في جلب حزم البطاقات:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/card-skins
router.post("/card-skins", async (req, res) => {
  try {
    const { id, name, css, price, rarity, rarityAr, isActive } = req.body;

    if (!id || !name || !css || !price) {
      return res.status(400).json({ error: "المعرف، الاسم، CSS، والسعر مطلوبة" });
    }

    const existing = await CardSkin.findOne({ id });
    if (existing) {
      return res.status(409).json({ error: "هذا المعرف مستخدم بالفعل" });
    }

    const skin = new CardSkin({
      id: id.trim(),
      name: name.trim(),
      css: css.trim(),
      price: parseInt(price),
      rarity: rarity || "rare",
      rarityAr: rarityAr || "نادر",
      isActive: isActive !== undefined ? isActive : true,
      createdBy: req.player.playerId,
    });

    await skin.save();
    return res.status(201).json(skin);
  } catch (err) {
    console.error("خطأ في إنشاء حزمة البطاقات:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/card-skins/:id
router.put("/card-skins/:id", async (req, res) => {
  try {
    const skin = await CardSkin.findOne({ id: req.params.id });
    if (!skin) {
      return res.status(404).json({ error: "الحزمة غير موجودة" });
    }

    const updates = req.body;
    Object.keys(updates).forEach((key) => {
      if (key !== "_id" && key !== "__v" && key !== "createdBy" && key !== "id") {
        skin[key] = updates[key];
      }
    });

    await skin.save();
    return res.json(skin);
  } catch (err) {
    console.error("خطأ في تحديث حزمة البطاقات:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/card-skins/:id
router.delete("/card-skins/:id", async (req, res) => {
  try {
    const skin = await CardSkin.findOneAndDelete({ id: req.params.id });
    if (!skin) {
      return res.status(404).json({ error: "الحزمة غير موجودة" });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("خطأ في حذف حزمة البطاقات:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إدارة الكلانات (للمطور) =====================

// GET /api/admin/clans
router.get("/clans", async (req, res) => {
  try {
    const clans = await Clan.find()
      .select("name icon description leaderId members joinType maxMembers stats")
      .sort({ createdAt: -1 })
      .limit(50);

    // جلب أسماء القادة
    const leaderIds = clans.map((c) => c.leaderId);
    const leaders = await Player.find(
      { playerId: { $in: leaderIds } },
      "playerId nickname"
    );
    const leaderMap = {};
    leaders.forEach((l) => { leaderMap[l.playerId] = l.nickname; });

    const result = clans.map((c) => ({
      ...c.toObject(),
      leaderNickname: leaderMap[c.leaderId] || "غير معروف",
    }));

    return res.json(result);
  } catch (err) {
    console.error("خطأ في جلب الكلانات:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/clans/:id
router.delete("/clans/:id", async (req, res) => {
  try {
    const clan = await Clan.findById(req.params.id);
    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    // تحرير جميع الأعضاء
    const memberIds = clan.members.map((m) => m.playerId);
    await Player.updateMany(
      { playerId: { $in: memberIds } },
      { $set: { clanId: null, clanRole: "member" } }
    );

    await Clan.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    console.error("خطأ في حذف الكلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إحصائيات المطور =====================

// GET /api/admin/dev-stats
router.get("/dev-stats", async (req, res) => {
  try {
    const [totalPlayers, bannedPlayers, totalMessages, totalNotifications] = await Promise.all([
      Player.countDocuments(),
      Player.countDocuments({ isBanned: true }),
      ChatMessage.countDocuments(),
      Notification.countDocuments(),
    ]);

    const recentPlayers = await Player.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select("playerId nickname level isOnline createdAt");

    return res.json({
      totalPlayers,
      bannedPlayers,
      totalMessages,
      totalNotifications,
      recentPlayers,
    });
  } catch (err) {
    console.error("خطأ في جلب إحصائيات المطور:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== مسار اختبار الصلاحيات =====================
// GET /api/admin/test
router.get("/test", (req, res) => {
  return res.json({
    success: true,
    message: "صلاحيات المطور مفعلة",
    developer: req.player.nickname,
    playerId: req.player.playerId,
  });
});

module.exports = router;
