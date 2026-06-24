const express = require("express");
const router = express.Router();
const Player = require("../models/Player");
const Notification = require("../models/Notification");
const { authMiddleware } = require("../middleware/auth");

// البحث عن لاعب بـ ID
// GET /api/players/:playerId
router.get("/:playerId", authMiddleware, async (req, res) => {
  try {
    const player = await Player.findOne({ playerId: req.params.playerId }).select(
      "playerId nickname avatar customAvatar level title activeTitle isDev clanId isOnline lastSeen stats"
    );
    if (!player) return res.status(404).json({ error: "اللاعب غير موجود" });

    // التحقق من الحظر
    if (req.player.blockedPlayers.includes(req.params.playerId)) {
      return res.status(403).json({ error: "هذا اللاعب في قائمة الحظر" });
    }

    return res.json(player);
  } catch (err) {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// إرسال طلب صداقة
// POST /api/players/:playerId/friend-request
router.post("/:playerId/friend-request", authMiddleware, async (req, res) => {
  try {
    const me = req.player;
    const targetId = req.params.playerId;

    if (me.playerId === targetId) {
      return res.status(400).json({ error: "لا يمكنك إضافة نفسك" });
    }

    const target = await Player.findOne({ playerId: targetId });
    if (!target) return res.status(404).json({ error: "اللاعب غير موجود" });

    // التحقق من الحظر
    if (target.blockedPlayers.includes(me.playerId)) {
      return res.status(403).json({ error: "لا يمكنك إرسال طلب لهذا اللاعب" });
    }

    if (me.friends.includes(targetId)) {
      return res.status(409).json({ error: "أنتم أصدقاء بالفعل" });
    }

    // التحقق من وجود طلب مسبق
    const alreadySent = target.friendRequests.some((r) => r.from === me.playerId);
    if (alreadySent) {
      return res.status(409).json({ error: "تم إرسال الطلب مسبقاً" });
    }

    // إضافة الطلب
    target.friendRequests.push({
      from: me.playerId,
      nickname: me.nickname,
      avatar: me.avatar,
    });
    await target.save();

    // إشعار
    const notification = new Notification({
      toPlayerId: targetId,
      type: "friend_request",
      message: `${me.nickname} أرسل لك طلب صداقة`,
      from: me.playerId,
      fromNickname: me.nickname,
      priority: "high",
      data: { fromPlayerId: me.playerId, fromNickname: me.nickname, fromAvatar: me.avatar },
    });
    await notification.save();

    // إرسال إشعار Socket.io للاعب المستهدف
    const io = req.app.get("io");
    if (target.socketId) {
      io.to(target.socketId).emit("notification", {
        type: "friend_request",
        message: `${me.nickname} أرسل لك طلب صداقة`,
        data: notification,
      });
    }

    return res.json({ success: true, message: "تم إرسال طلب الصداقة" });
  } catch (err) {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// قبول/رفض طلب صداقة
// POST /api/players/friend-request/:fromId/respond
router.post("/friend-request/:fromId/respond", authMiddleware, async (req, res) => {
  try {
    const me = req.player;
    const { action } = req.body; // "accept" | "reject"
    const fromId = req.params.fromId;

    const reqIndex = me.friendRequests.findIndex((r) => r.from === fromId);
    if (reqIndex === -1) return res.status(404).json({ error: "الطلب غير موجود" });

    const requester = await Player.findOne({ playerId: fromId });

    if (action === "accept") {
      if (me.friends.length >= me.maxFriends) {
        return res.status(400).json({ error: `قائمة الأصدقاء ممتلئة (${me.maxFriends})` });
      }

      me.friends.push(fromId);
      if (requester && !requester.friends.includes(me.playerId)) {
        requester.friends.push(me.playerId);
        await requester.save();
      }

      // إشعار للطارف
      if (requester) {
        const notification = new Notification({
          toPlayerId: fromId,
          type: "friend_accepted",
          message: `${me.nickname} قبل طلب صداقتك`,
          from: me.playerId,
          fromNickname: me.nickname,
          priority: "medium",
        });
        await notification.save();

        const io = req.app.get("io");
        if (requester.socketId) {
          io.to(requester.socketId).emit("notification", {
            type: "friend_accepted",
            message: `${me.nickname} قبل طلب صداقتك`,
          });
        }
      }
    }

    me.friendRequests.splice(reqIndex, 1);
    await me.save();

    return res.json({ success: true, action });
  } catch (err) {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// حذف صديق
// DELETE /api/players/:playerId/friend
router.delete("/:playerId/friend", authMiddleware, async (req, res) => {
  try {
    const me = req.player;
    const targetId = req.params.playerId;

    me.friends = me.friends.filter((f) => f !== targetId);
    await me.save();

    const target = await Player.findOne({ playerId: targetId });
    if (target) {
      target.friends = target.friends.filter((f) => f !== me.playerId);
      await target.save();
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// حظر لاعب
// POST /api/players/:playerId/block
router.post("/:playerId/block", authMiddleware, async (req, res) => {
  try {
    const me = req.player;
    const targetId = req.params.playerId;

    if (!me.blockedPlayers.includes(targetId)) {
      me.blockedPlayers.push(targetId);
    }
    me.friends = me.friends.filter((f) => f !== targetId);
    await me.save();

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// تثبيت/إلغاء تثبيت صديق
// POST /api/players/:playerId/pin
router.post("/:playerId/pin", authMiddleware, async (req, res) => {
  try {
    const me = req.player;
    const targetId = req.params.playerId;

    if (me.pinnedFriends.includes(targetId)) {
      me.pinnedFriends = me.pinnedFriends.filter((f) => f !== targetId);
    } else {
      if (me.pinnedFriends.length >= me.maxPins) {
        return res.status(400).json({ error: `الحد الأقصى للتثبيت: ${me.maxPins}` });
      }
      me.pinnedFriends.push(targetId);
    }
    await me.save();

    return res.json({ success: true, pinnedFriends: me.pinnedFriends });
  } catch (err) {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// جلب قائمة الأصدقاء مع حالة الاتصال
// GET /api/players/me/friends
router.get("/me/friends", authMiddleware, async (req, res) => {
  try {
    const me = req.player;
    const friends = await Player.find({ playerId: { $in: me.friends } }).select(
      "playerId nickname avatar customAvatar level activeTitle isOnline lastSeen currentRoom isDev"
    );

    // ترتيب: المثبتون أولاً ثم المتصلون
    const sorted = friends.sort((a, b) => {
      const aPinned = me.pinnedFriends.includes(a.playerId);
      const bPinned = me.pinnedFriends.includes(b.playerId);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      if (a.isOnline && !b.isOnline) return -1;
      if (!a.isOnline && b.isOnline) return 1;
      return 0;
    });

    return res.json({
      friends: sorted,
      requests: me.friendRequests,
      pinned: me.pinnedFriends,
    });
  } catch (err) {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// تحديث الإعدادات
// PUT /api/players/me/settings
router.put("/me/settings", authMiddleware, async (req, res) => {
  try {
    const { settings } = req.body;
    Object.assign(req.player.settings, settings);
    await req.player.save();
    return res.json({ success: true, settings: req.player.settings });
  } catch (err) {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// تجهيز حزمة بطاقات أو إطار
// PUT /api/players/me/equip
router.put("/me/equip", authMiddleware, async (req, res) => {
  try {
    const { type, id } = req.body; // type: "cardSkin" | "nameFrame" | "title"
    const player = req.player;

    if (type === "title") {
      if (!player.inventory.unlockedTitles.includes(id)) {
        return res.status(403).json({ error: "هذا اللقب غير مفتوح" });
      }
      player.activeTitle = id;
    } else if (type === "cardSkin") {
      player.inventory.cardSkins = player.inventory.cardSkins.map((s) => ({
        ...s,
        equipped: s.skinId === id,
      }));
    } else if (type === "nameFrame") {
      player.inventory.nameFrames = player.inventory.nameFrames.map((f) => ({
        ...f,
        equipped: f.frameId === id,
      }));
    }

    await player.save();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
