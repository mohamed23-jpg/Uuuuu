const express = require("express");
const router = express.Router();
const Player = require("../models/Player");
const Clan = require("../models/Clan");
const Challenge = require("../models/Challenge");
const CardSkin = require("../models/CardSkin");
const Notification = require("../models/Notification");
const { authMiddleware, devMiddleware } = require("../middleware/auth");

// جميع مسارات لوحة القائد تتطلب صلاحيات المطور
router.use(authMiddleware, devMiddleware);

// إحصائيات عامة
// GET /api/admin/stats
router.get("/stats", async (req, res) => {
  try {
    const [players, clans, onlinePlayers] = await Promise.all([
      Player.countDocuments(),
      Clan.countDocuments(),
      Player.countDocuments({ isOnline: true }),
    ]);

    const io = req.app.get("io");
    const rooms = req.app.get("rooms") || {};
    const activeRooms = Object.keys(rooms).length;

    return res.json({
      totalPlayers: players,
      onlinePlayers,
      totalClans: clans,
      activeRooms,
    });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// إدارة اللاعبين - بحث
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
      .select("playerId nickname avatar level coins xp isDev isOnline clanId stats")
      .limit(20);

    return res.json(players);
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// منح عملات/XP للاعب
// POST /api/admin/players/:playerId/grant
router.post("/players/:playerId/grant", async (req, res) => {
  try {
    const { coins, xp, title } = req.body;
    const player = await Player.findOne({ playerId: req.params.playerId });
    if (!player) return res.status(404).json({ error: "اللاعب غير موجود" });

    if (coins) player.coins += coins;
    if (xp) {
      const rewards = await player.addXP(xp);
      await player.save();
      return res.json({ success: true, newLevel: player.level, newCoins: player.coins, rewards });
    }
    if (title) {
      if (!player.inventory.unlockedTitles.includes(title)) {
        player.inventory.unlockedTitles.push(title);
      }
      player.activeTitle = title;
    }

    await player.save();
    return res.json({ success: true, newCoins: player.coins });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// حظر/إلغاء حظر لاعب
// POST /api/admin/players/:playerId/ban
router.post("/players/:playerId/ban", async (req, res) => {
  try {
    const { banned, reason } = req.body;
    const player = await Player.findOne({ playerId: req.params.playerId });
    if (!player) return res.status(404).json({ error: "اللاعب غير موجود" });
    if (player.isDev) return res.status(403).json({ error: "لا يمكن حظر المطور" });

    player.isBanned = banned;
    player.banReason = reason || "";
    await player.save();

    // طرد من الغرفة عند الحظر
    if (banned && player.socketId) {
      const io = req.app.get("io");
      io.to(player.socketId).emit("banned", { reason });
    }

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// إرسال إشعار عام لكل اللاعبين
// POST /api/admin/broadcast
router.post("/broadcast", async (req, res) => {
  try {
    const { message } = req.body;
    const io = req.app.get("io");
    io.emit("dev_announcement", {
      message,
      from: "DOoOla-Dev",
      timestamp: new Date(),
    });
    return res.json({ success: true, message: "تم إرسال الإشعار لكل اللاعبين" });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// إدارة التحديات الخاصة
// GET /api/admin/challenges
router.get("/challenges", async (req, res) => {
  try {
    const challenges = await Challenge.find().sort({ createdAt: -1 });
    return res.json(challenges);
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// POST /api/admin/challenges
router.post("/challenges", async (req, res) => {
  try {
    const challenge = new Challenge({ ...req.body, createdBy: req.player.playerId });
    await challenge.save();
    return res.status(201).json(challenge);
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// PUT /api/admin/challenges/:id
router.put("/challenges/:id", async (req, res) => {
  try {
    const challenge = await Challenge.findByIdAndUpdate(req.params.id, req.body, { new: true });
    return res.json(challenge);
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// DELETE /api/admin/challenges/:id
router.delete("/challenges/:id", async (req, res) => {
  try {
    await Challenge.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// إضافة حزمة بطاقات مخصصة
// POST /api/admin/card-skins
router.post("/card-skins", async (req, res) => {
  try {
    const skin = new CardSkin({ ...req.body, createdBy: req.player.playerId });
    await skin.save();
    return res.status(201).json(skin);
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// إدارة الكلانات
// GET /api/admin/clans
router.get("/clans", async (req, res) => {
  try {
    const clans = await Clan.find().sort({ createdAt: -1 }).limit(50);
    return res.json(clans);
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
