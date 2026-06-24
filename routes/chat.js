const express = require("express");
const router = express.Router();
const ChatMessage = require("../models/ChatMessage");
const Player = require("../models/Player");
const { authMiddleware } = require("../middleware/auth");
const { chatLimiter } = require("../middleware/rateLimit");

// قائمة الكلمات المحظورة (بسيطة - يمكن توسيعها)
const BAD_WORDS = ["كلمة1", "كلمة2"];

const filterMessage = (text) => {
  let filtered = text;
  BAD_WORDS.forEach((word) => {
    filtered = filtered.replace(new RegExp(word, "gi"), "***");
  });
  return filtered;
};

// جلب سجل الدردشة العامة (آخر 100 رسالة)
// GET /api/chat/global
router.get("/global", authMiddleware, async (req, res) => {
  try {
    const messages = await ChatMessage.find({ channel: "global" })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json(messages.reverse());
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// إرسال رسالة للدردشة العامة
// POST /api/chat/global
router.post("/global", authMiddleware, chatLimiter, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "الرسالة فارغة" });
    }
    if (message.length > 500) {
      return res.status(400).json({ error: "الرسالة طويلة جداً (500 حرف كحد أقصى)" });
    }

    const player = req.player;
    const filteredMsg = filterMessage(message.trim());

    const chatMsg = new ChatMessage({
      channel: "global",
      fromPlayerId: player.playerId,
      fromNickname: player.nickname,
      fromAvatar: player.avatar,
      fromLevel: player.level,
      fromTitle: player.activeTitle,
      message: filteredMsg,
      isFiltered: filteredMsg !== message.trim(),
      isDev: player.isDev,
    });

    await chatMsg.save();

    // تحديث إحصائية الدردشة
    player.stats.chatMessages += 1;
    player.missions.daily.chatMessages = (player.missions.daily.chatMessages || 0) + 1;
    await player.save();

    // بث الرسالة عبر Socket.io
    const io = req.app.get("io");
    io.emit("global_chat", chatMsg);

    // حذف الرسائل القديمة إذا تجاوزت 500
    const count = await ChatMessage.countDocuments({ channel: "global" });
    if (count > 500) {
      const oldest = await ChatMessage.find({ channel: "global" })
        .sort({ createdAt: 1 })
        .limit(count - 500);
      await ChatMessage.deleteMany({ _id: { $in: oldest.map((m) => m._id) } });
    }

    return res.status(201).json(chatMsg);
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// جلب الرسائل الخاصة مع لاعب
// GET /api/chat/private/:playerId
router.get("/private/:playerId", authMiddleware, async (req, res) => {
  try {
    const me = req.player.playerId;
    const other = req.params.playerId;

    // تحقق من الصداقة
    if (!req.player.friends.includes(other)) {
      return res.status(403).json({ error: "يجب أن تكونا أصدقاء للرسائل الخاصة" });
    }

    const messages = await ChatMessage.find({
      channel: "private",
      $or: [
        { fromPlayerId: me, toPlayerId: other },
        { fromPlayerId: other, toPlayerId: me },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json(messages.reverse());
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// إرسال رسالة خاصة
// POST /api/chat/private/:playerId
router.post("/private/:playerId", authMiddleware, chatLimiter, async (req, res) => {
  try {
    const me = req.player;
    const targetId = req.params.playerId;

    if (!me.friends.includes(targetId)) {
      return res.status(403).json({ error: "يجب أن تكونا أصدقاء" });
    }

    const { message } = req.body;
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "الرسالة فارغة" });
    }

    const filteredMsg = filterMessage(message.trim());
    const chatMsg = new ChatMessage({
      channel: "private",
      fromPlayerId: me.playerId,
      fromNickname: me.nickname,
      fromAvatar: me.avatar,
      fromLevel: me.level,
      fromTitle: me.activeTitle,
      toPlayerId: targetId,
      message: filteredMsg,
      isFiltered: filteredMsg !== message.trim(),
      isDev: me.isDev,
    });

    await chatMsg.save();

    // إرسال للمستلم عبر Socket.io
    const io = req.app.get("io");
    const target = await Player.findOne({ playerId: targetId });
    if (target?.socketId) {
      io.to(target.socketId).emit("private_message", chatMsg);
    }

    return res.status(201).json(chatMsg);
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
