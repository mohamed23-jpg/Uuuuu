const express = require("express");
const router = express.Router();
const ChatMessage = require("../models/ChatMessage");
const Player = require("../models/Player");
const Clan = require("../models/Clan");
const Notification = require("../models/Notification");
const { authMiddleware } = require("../middleware/auth");
const { chatLimiter } = require("../middleware/rateLimit");

// ===================== قائمة الكلمات المحظورة (موسعة) =====================
const BAD_WORDS = [
  // العربية
  "كلمة1", "كلمة2", "وسخ", "قذر", "زبالة",
  "عيب", "حرام", "سفالة", "نذالة", "خنزير",
  "كلب", "حمار", "بعبع", "معرص", "قحبة",
  "منيك", "شرموطة", "متناكة", "خول", "عرص",

  // الإنجليزية
  "shit", "fuck", "bitch", "asshole", "bastard",
  "damn", "hell", "cunt", "pussy", "dick",
  "cock", "suck", "whore", "slut", "fag",

  // إضافات
  "نيك", "كس", "زبر", "بزاز", "طيز",
];

// دالة فلترة الرسائل
const filterMessage = (text) => {
  let filtered = text;
  BAD_WORDS.forEach((word) => {
    const regex = new RegExp(word, "gi");
    filtered = filtered.replace(regex, "***");
  });
  return filtered;
};

// ===================== 1. الدردشة العامة =====================

// جلب سجل الدردشة العامة (آخر 100 رسالة)
// GET /api/chat/global
router.get("/global", authMiddleware, async (req, res) => {
  try {
    const messages = await ChatMessage.find({ channel: "global" })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json(messages.reverse());
  } catch (err) {
    console.error("خطأ في جلب الدردشة العامة:", err);
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
      channelId: null,
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
  } catch (err) {
    console.error("خطأ في إرسال رسالة عامة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== 2. شات الكلان =====================

// جلب رسائل شات الكلان (آخر 50 رسالة)
// GET /api/chat/clan/:clanId
router.get("/clan/:clanId", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const { clanId } = req.params;

    // التحقق من أن اللاعب عضو في الكلان
    const clan = await Clan.findById(clanId);
    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    const isMember = clan.members.some((m) => m.playerId === player.playerId);
    if (!isMember) {
      return res.status(403).json({ error: "أنت لست عضواً في هذا الكلان" });
    }

    const messages = await ChatMessage.find({
      channel: "clan",
      channelId: clanId,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json(messages.reverse());
  } catch (err) {
    console.error("خطأ في جلب رسائل شات الكلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// إرسال رسالة في شات الكلان
// POST /api/chat/clan/:clanId
router.post("/clan/:clanId", authMiddleware, chatLimiter, async (req, res) => {
  try {
    const player = req.player;
    const { clanId } = req.params;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "الرسالة فارغة" });
    }
    if (message.length > 500) {
      return res.status(400).json({ error: "الرسالة طويلة جداً (500 حرف كحد أقصى)" });
    }

    // التحقق من أن اللاعب عضو في الكلان
    const clan = await Clan.findById(clanId);
    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    const isMember = clan.members.some((m) => m.playerId === player.playerId);
    if (!isMember) {
      return res.status(403).json({ error: "أنت لست عضواً في هذا الكلان" });
    }

    const filteredMsg = filterMessage(message.trim());

    const chatMsg = new ChatMessage({
      channel: "clan",
      channelId: clanId,
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
    await player.save();

    // بث الرسالة لأعضاء الكلان فقط عبر Socket.io
    const io = req.app.get("io");
    const memberIds = clan.members.map((m) => m.playerId);
    const members = await Player.find(
      { playerId: { $in: memberIds }, isOnline: true },
      "socketId"
    );

    for (const member of members) {
      if (member.socketId) {
        io.to(member.socketId).emit("clan_chat", {
          ...chatMsg.toObject(),
          clanName: clan.name,
          clanIcon: clan.icon,
        });
      }
    }

    // إشعار لأعضاء الكلان (باستثناء المرسل)
    if (members.length > 1) {
      const notification = new Notification({
        toPlayerId: player.playerId,
        type: "clan_message",
        message: `${player.nickname} أرسل رسالة في شات الكلان`,
        from: player.playerId,
        fromNickname: player.nickname,
        priority: "low",
        data: { clanId, clanName: clan.name },
      });
      // نحفظ لكل عضو باستثناء المرسل
      const notifications = clan.members
        .filter((m) => m.playerId !== player.playerId)
        .map((m) => ({
          toPlayerId: m.playerId,
          type: "clan_message",
          message: `${player.nickname} أرسل رسالة في شات الكلان`,
          from: player.playerId,
          fromNickname: player.nickname,
          priority: "low",
          data: { clanId, clanName: clan.name },
        }));

      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
      }
    }

    return res.status(201).json(chatMsg);
  } catch (err) {
    console.error("خطأ في إرسال رسالة شات الكلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== 3. شات الأصدقاء الخاص =====================

// جلب الرسائل الخاصة بين صديقين
// GET /api/chat/friend/:friendId
router.get("/friend/:friendId", authMiddleware, async (req, res) => {
  try {
    const me = req.player;
    const friendId = req.params.friendId;

    // التحقق من الصداقة
    if (!me.friends.includes(friendId)) {
      return res.status(403).json({ error: "يجب أن تكونا أصدقاء للرسائل الخاصة" });
    }

    const messages = await ChatMessage.find({
      channel: "friend",
      $or: [
        { fromPlayerId: me.playerId, toPlayerId: friendId },
        { fromPlayerId: friendId, toPlayerId: me.playerId },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json(messages.reverse());
  } catch (err) {
    console.error("خطأ في جلب رسائل الأصدقاء:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// إرسال رسالة خاصة لصديق
// POST /api/chat/friend/:friendId
router.post("/friend/:friendId", authMiddleware, chatLimiter, async (req, res) => {
  try {
    const me = req.player;
    const friendId = req.params.friendId;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "الرسالة فارغة" });
    }
    if (message.length > 500) {
      return res.status(400).json({ error: "الرسالة طويلة جداً (500 حرف كحد أقصى)" });
    }

    // التحقق من الصداقة
    if (!me.friends.includes(friendId)) {
      return res.status(403).json({ error: "يجب أن تكونا أصدقاء للرسائل الخاصة" });
    }

    // التحقق من أن المستلم موجود
    const friend = await Player.findOne({ playerId: friendId });
    if (!friend) {
      return res.status(404).json({ error: "اللاعب غير موجود" });
    }

    // التحقق من الحظر (إذا كان الصديق قد حظرنا)
    if (friend.blockedPlayers.includes(me.playerId)) {
      return res.status(403).json({ error: "تم حظرك من قبل هذا اللاعب" });
    }

    const filteredMsg = filterMessage(message.trim());

    const chatMsg = new ChatMessage({
      channel: "friend",
      channelId: null,
      fromPlayerId: me.playerId,
      fromNickname: me.nickname,
      fromAvatar: me.avatar,
      fromLevel: me.level,
      fromTitle: me.activeTitle,
      toPlayerId: friendId,
      message: filteredMsg,
      isFiltered: filteredMsg !== message.trim(),
      isDev: me.isDev,
    });

    await chatMsg.save();

    // تحديث إحصائية الدردشة
    me.stats.chatMessages += 1;
    await me.save();

    // إرسال للمستلم عبر Socket.io (إذا كان متصلاً)
    const io = req.app.get("io");
    if (friend.socketId) {
      io.to(friend.socketId).emit("private_message", {
        ...chatMsg.toObject(),
        from: {
          playerId: me.playerId,
          nickname: me.nickname,
          avatar: me.avatar,
          level: me.level,
          title: me.activeTitle,
        },
      });

      // إشعار منبثق للمستلم
      io.to(friend.socketId).emit("notification", {
        type: "private_message",
        message: `رسالة خاصة من ${me.nickname}`,
        from: me.playerId,
        fromNickname: me.nickname,
        priority: "medium",
        data: { message: filteredMsg },
      });
    }

    // حفظ إشعار للمستلم
    const notification = new Notification({
      toPlayerId: friendId,
      type: "private_message",
      message: `رسالة خاصة من ${me.nickname}`,
      from: me.playerId,
      fromNickname: me.nickname,
      priority: "medium",
      data: { message: filteredMsg },
    });
    await notification.save();

    return res.status(201).json(chatMsg);
  } catch (err) {
    console.error("خطأ في إرسال رسالة خاصة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== 4. مساعدة: تعليم الرسائل كمقروءة =====================

// تعليم جميع الرسائل الخاصة كمقروءة
// PUT /api/chat/friend/:friendId/read
router.put("/friend/:friendId/read", authMiddleware, async (req, res) => {
  try {
    const me = req.player;
    const friendId = req.params.friendId;

    if (!me.friends.includes(friendId)) {
      return res.status(403).json({ error: "يجب أن تكونا أصدقاء" });
    }

    await ChatMessage.updateMany(
      {
        channel: "friend",
        fromPlayerId: friendId,
        toPlayerId: me.playerId,
        isRead: false,
      },
      { isRead: true }
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("خطأ في تعليم الرسائل كمقروءة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== 5. حذف رسالة (للمطور فقط) =====================

// DELETE /api/chat/messages/:messageId
router.delete("/messages/:messageId", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    if (!player.isDev) {
      return res.status(403).json({ error: "صلاحيات المطور مطلوبة" });
    }

    const message = await ChatMessage.findById(req.params.messageId);
    if (!message) {
      return res.status(404).json({ error: "الرسالة غير موجودة" });
    }

    await ChatMessage.findByIdAndDelete(req.params.messageId);

    return res.json({ success: true });
  } catch (err) {
    console.error("خطأ في حذف الرسالة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
