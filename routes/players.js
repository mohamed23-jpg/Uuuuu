const express = require("express");
const router = express.Router();
const Player = require("../models/Player");
const Notification = require("../models/Notification");
const { authMiddleware } = require("../middleware/auth");

// ===================== البحث عن لاعب بـ ID =====================
// GET /api/players/:playerId
router.get("/:playerId", authMiddleware, async (req, res) => {
  try {
    const player = await Player.findOne({ playerId: req.params.playerId }).select(
      "playerId nickname avatar customAvatar level title activeTitle isDev clanId isOnline lastSeen stats"
    );
    if (!player) return res.status(404).json({ error: "اللاعب غير موجود" });

    if (req.player.blockedPlayers.includes(req.params.playerId)) {
      return res.status(403).json({ error: "هذا اللاعب في قائمة الحظر" });
    }

    return res.json(player);
  } catch (err) {
    console.error("خطأ في جلب اللاعب:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== جلب لاعبين متعددين (دفعة واحدة) =====================
// POST /api/players/batch
router.post("/batch", authMiddleware, async (req, res) => {
  try {
    const { playerIds } = req.body;
    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      return res.status(400).json({ error: "قائمة معرفات غير صالحة" });
    }

    const players = await Player.find({ playerId: { $in: playerIds } }).select(
      "playerId nickname avatar customAvatar level title activeTitle isDev isOnline"
    );

    return res.json(players);
  } catch (err) {
    console.error("خطأ في جلب اللاعبين:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إرسال طلب صداقة =====================
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

    if (target.blockedPlayers.includes(me.playerId)) {
      return res.status(403).json({ error: "لا يمكنك إرسال طلب لهذا اللاعب" });
    }

    if (me.friends.includes(targetId)) {
      return res.status(409).json({ error: "أنتم أصدقاء بالفعل" });
    }

    const alreadySent = target.friendRequests.some((r) => r.from === me.playerId);
    if (alreadySent) {
      return res.status(409).json({ error: "تم إرسال الطلب مسبقاً" });
    }

    target.friendRequests.push({
      from: me.playerId,
      nickname: me.nickname,
      avatar: me.avatar,
    });
    await target.save();

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
    console.error("خطأ في إرسال طلب الصداقة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== قبول/رفض طلب صداقة =====================
// POST /api/players/friend-request/:fromId/respond
router.post("/friend-request/:fromId/respond", authMiddleware, async (req, res) => {
  try {
    const me = req.player;
    const { action } = req.body;
    const fromId = req.params.fromId;

    if (!action || !["accept", "reject"].includes(action)) {
      return res.status(400).json({ error: "إجراء غير صالح" });
    }

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
    console.error("خطأ في الرد على طلب الصداقة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== حذف صديق =====================
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
    console.error("خطأ في حذف الصديق:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== حظر لاعب =====================
// POST /api/players/:playerId/block
router.post("/:playerId/block", authMiddleware, async (req, res) => {
  try {
    const me = req.player;
    const targetId = req.params.playerId;

    if (me.playerId === targetId) {
      return res.status(400).json({ error: "لا يمكنك حظر نفسك" });
    }

    if (!me.blockedPlayers.includes(targetId)) {
      me.blockedPlayers.push(targetId);
    }
    me.friends = me.friends.filter((f) => f !== targetId);
    await me.save();

    // إشعار للطرف الآخر
    const target = await Player.findOne({ playerId: targetId });
    if (target) {
      const notification = new Notification({
        toPlayerId: targetId,
        type: "blocked",
        message: `${me.nickname} قام بحظرك`,
        from: me.playerId,
        fromNickname: me.nickname,
        priority: "high",
      });
      await notification.save();

      const io = req.app.get("io");
      if (target.socketId) {
        io.to(target.socketId).emit("notification", {
          type: "blocked",
          message: `${me.nickname} قام بحظرك`,
        });
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("خطأ في حظر اللاعب:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إلغاء حظر لاعب =====================
// DELETE /api/players/me/blocked/:playerId
router.delete("/me/blocked/:playerId", authMiddleware, async (req, res) => {
  try {
    const me = req.player;
    const targetId = req.params.playerId;

    me.blockedPlayers = me.blockedPlayers.filter((id) => id !== targetId);
    await me.save();

    return res.json({ success: true });
  } catch (err) {
    console.error("خطأ في إلغاء الحظر:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== جلب قائمة المحظورين =====================
// GET /api/players/me/blocked
router.get("/me/blocked", authMiddleware, async (req, res) => {
  try {
    const me = req.player;
    const blockedPlayers = await Player.find(
      { playerId: { $in: me.blockedPlayers } },
      "playerId nickname avatar level activeTitle isOnline"
    );

    return res.json(blockedPlayers);
  } catch (err) {
    console.error("خطأ في جلب المحظورين:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تثبيت/إلغاء تثبيت صديق =====================
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
      if (!me.friends.includes(targetId)) {
        return res.status(400).json({ error: "هذا اللاعب ليس صديقاً لك" });
      }
      me.pinnedFriends.push(targetId);
    }
    await me.save();

    return res.json({ success: true, pinnedFriends: me.pinnedFriends });
  } catch (err) {
    console.error("خطأ في تثبيت الصديق:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== جلب قائمة الأصدقاء مع حالة الاتصال =====================
// GET /api/players/me/friends
router.get("/me/friends", authMiddleware, async (req, res) => {
  try {
    const me = req.player;

    const friends = await Player.find({ playerId: { $in: me.friends } }).select(
      "playerId nickname avatar customAvatar level activeTitle isOnline lastSeen currentRoom isDev"
    );

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
    console.error("خطأ في جلب الأصدقاء:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تحديث الإعدادات =====================
// PUT /api/players/me/settings
router.put("/me/settings", authMiddleware, async (req, res) => {
  try {
    const { settings } = req.body;
    if (typeof settings !== "object") {
      return res.status(400).json({ error: "بيانات إعدادات غير صالحة" });
    }

    Object.assign(req.player.settings, settings);
    await req.player.save();

    return res.json({ success: true, settings: req.player.settings });
  } catch (err) {
    console.error("خطأ في تحديث الإعدادات:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تجهيز حزمة بطاقات أو إطار أو لقب =====================
// PUT /api/players/me/equip
router.put("/me/equip", authMiddleware, async (req, res) => {
  try {
    const { type, id } = req.body;
    const player = req.player;

    if (!type || !id) {
      return res.status(400).json({ error: "نوع ومعرف العنصر مطلوبان" });
    }

    if (type === "title") {
      if (!player.inventory.unlockedTitles.includes(id)) {
        return res.status(403).json({ error: "هذا اللقب غير مفتوح" });
      }
      player.activeTitle = id;
    } else if (type === "cardSkin") {
      const hasSkin = player.inventory.cardSkins.some((s) => s.skinId === id);
      if (!hasSkin) {
        return res.status(403).json({ error: "هذه الحزمة غير مملوكة" });
      }
      player.inventory.cardSkins = player.inventory.cardSkins.map((s) => ({
        ...s,
        equipped: s.skinId === id,
      }));
    } else if (type === "nameFrame") {
      const hasFrame = player.inventory.nameFrames.some((f) => f.frameId === id);
      if (!hasFrame) {
        return res.status(403).json({ error: "هذا الإطار غير مملوك" });
      }
      player.inventory.nameFrames = player.inventory.nameFrames.map((f) => ({
        ...f,
        equipped: f.frameId === id,
      }));
    } else {
      return res.status(400).json({ error: "نوع عنصر غير صالح" });
    }

    await player.save();
    return res.json({ success: true });
  } catch (err) {
    console.error("خطأ في تجهيز العنصر:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== جلب بيانات اللاعب الحالي =====================
// GET /api/players/me
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    return res.json({
      playerId: player.playerId,
      nickname: player.nickname,
      avatar: player.avatar,
      customAvatar: player.customAvatar,
      level: player.level,
      xp: player.xp,
      xpNeeded: player.xpNeeded ? player.xpNeeded() : 0,
      coins: player.coins,
      title: player.title,
      activeTitle: player.activeTitle,
      isDev: player.isDev,
      clanId: player.clanId,
      clanRole: player.clanRole,
      stats: player.stats,
      settings: player.settings,
      inventory: player.inventory,
      maxFriends: player.maxFriends,
      maxPins: player.maxPins,
      friends: player.friends,
      blockedPlayers: player.blockedPlayers,
      pinnedFriends: player.pinnedFriends,
      friendRequests: player.friendRequests,
      isOnline: player.isOnline,
      currentRoom: player.currentRoom,
    });
  } catch (err) {
    console.error("خطأ في جلب بيانات اللاعب:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تحديث الملف الشخصي =====================
// PUT /api/players/me/profile
router.put("/me/profile", authMiddleware, async (req, res) => {
  try {
    const { nickname, avatar, customAvatar } = req.body;
    const player = req.player;

    if (nickname) {
      if (nickname.length < 3 || nickname.length > 20) {
        return res.status(400).json({ error: "الاسم يجب أن يكون بين 3 و20 حرف" });
      }
      const existing = await Player.findOne({
        nickname: { $regex: new RegExp(`^${nickname}$`, "i") },
        playerId: { $ne: player.playerId },
      });
      if (existing) {
        return res.status(409).json({ error: "هذا الاسم مستخدم بالفعل" });
      }
      player.nickname = nickname;
    }

    if (avatar) player.avatar = avatar;
    if (customAvatar !== undefined) player.customAvatar = customAvatar;

    await player.save();
    return res.json({ success: true, player });
  } catch (err) {
    console.error("خطأ في تحديث الملف الشخصي:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إضافة/خصم عملات أو XP (للمطورين فقط) =====================
// POST /api/players/admin/grant
// ملاحظة: هذا المسار للتوافق مع واجهة المطور، ولكن المسار الأساسي موجود في admin.js
router.post("/admin/grant", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    if (!player.isDev) {
      return res.status(403).json({ error: "صلاحيات المطور مطلوبة" });
    }

    const { targetPlayerId, coins, xp } = req.body;
    const target = await Player.findOne({ playerId: targetPlayerId });
    if (!target) return res.status(404).json({ error: "اللاعب غير موجود" });

    if (coins !== undefined && !isNaN(coins)) {
      target.coins += parseInt(coins);
    }

    if (xp !== undefined && !isNaN(xp)) {
      const rewards = await target.addXP(parseInt(xp));
      await target.save();
      return res.json({ success: true, newLevel: target.level, newXp: target.xp, rewards });
    }

    await target.save();
    return res.json({ success: true, newCoins: target.coins });
  } catch (err) {
    console.error("خطأ في منح المكافآت:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
