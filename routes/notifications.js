const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const Player = require("../models/Player");
const { authMiddleware } = require("../middleware/auth");

// ===================== جلب الإشعارات =====================
// GET /api/notifications
router.get("/", authMiddleware, async (req, res) => {
  try {
    const playerId = req.player.playerId;
    const { limit = 50, type, priority, unreadOnly } = req.query;

    // بناء الاستعلام
    const query = { toPlayerId: playerId };

    if (type) {
      query.type = type;
    }

    if (priority) {
      query.priority = priority;
    }

    if (unreadOnly === "true") {
      query.isRead = false;
    }

    // جلب الإشعارات
    const notifications = await Notification.find(query)
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(parseInt(limit));

    // جلب الإشعارات المثبتة (جميعها)
    const pinned = await Notification.find({
      toPlayerId: playerId,
      isPinned: true,
    }).sort({ createdAt: -1 });

    // عدد الإشعارات غير المقروءة
    const unreadCount = await Notification.getUnreadCount(playerId);

    // عدد الإشعارات المثبتة غير المقروءة
    const pinnedUnread = await Notification.countDocuments({
      toPlayerId: playerId,
      isPinned: true,
      isRead: false,
    });

    // عدد الإشعارات حسب النوع (للإحصائيات)
    const typeStats = await Notification.aggregate([
      { $match: { toPlayerId: playerId } },
      { $group: { _id: "$type", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    return res.json({
      notifications,
      pinned,
      unreadCount,
      pinnedUnread,
      typeStats,
      total: await Notification.countDocuments({ toPlayerId: playerId }),
    });
  } catch (err) {
    console.error("خطأ في جلب الإشعارات:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== جلب الإشعارات غير المقروءة فقط =====================
// GET /api/notifications/unread
router.get("/unread", authMiddleware, async (req, res) => {
  try {
    const playerId = req.player.playerId;
    const notifications = await Notification.find({
      toPlayerId: playerId,
      isRead: false,
    })
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(50);

    const count = notifications.length;

    return res.json({ notifications, count });
  } catch (err) {
    console.error("خطأ في جلب الإشعارات غير المقروءة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== جلب الإشعارات المثبتة =====================
// GET /api/notifications/pinned
router.get("/pinned", authMiddleware, async (req, res) => {
  try {
    const playerId = req.player.playerId;
    const notifications = await Notification.find({
      toPlayerId: playerId,
      isPinned: true,
    })
      .sort({ createdAt: -1 });

    return res.json({ notifications, count: notifications.length });
  } catch (err) {
    console.error("خطأ في جلب الإشعارات المثبتة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== جلب الإشعارات حسب الأولوية =====================
// GET /api/notifications/priority/:priority
router.get("/priority/:priority", authMiddleware, async (req, res) => {
  try {
    const playerId = req.player.playerId;
    const { priority } = req.params;

    if (!["high", "medium", "low"].includes(priority)) {
      return res.status(400).json({ error: "أولوية غير صالحة" });
    }

    const notifications = await Notification.find({
      toPlayerId: playerId,
      priority,
    })
      .sort({ createdAt: -1 })
      .limit(50);

    return res.json({ notifications, count: notifications.length });
  } catch (err) {
    console.error("خطأ في جلب الإشعارات حسب الأولوية:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== جلب عدد الإشعارات غير المقروءة =====================
// GET /api/notifications/count
router.get("/count", authMiddleware, async (req, res) => {
  try {
    const playerId = req.player.playerId;
    const unreadCount = await Notification.getUnreadCount(playerId);

    // عدد الإشعارات غير المقروءة حسب النوع
    const unreadByType = await Notification.aggregate([
      { $match: { toPlayerId: playerId, isRead: false } },
      { $group: { _id: "$type", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    return res.json({
      unreadCount,
      unreadByType,
      hasUnread: unreadCount > 0,
    });
  } catch (err) {
    console.error("خطأ في جلب عدد الإشعارات غير المقروءة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تعليم إشعار كمقروء =====================
// PUT /api/notifications/:id/read
router.put("/:id/read", authMiddleware, async (req, res) => {
  try {
    const playerId = req.player.playerId;
    const notification = await Notification.findOne({
      _id: req.params.id,
      toPlayerId: playerId,
    });

    if (!notification) {
      return res.status(404).json({ error: "الإشعار غير موجود" });
    }

    await notification.markAsRead();

    return res.json({
      success: true,
      notification,
    });
  } catch (err) {
    console.error("خطأ في تعليم الإشعار كمقروء:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تعليم جميع الإشعارات كمقروءة =====================
// PUT /api/notifications/read-all
router.put("/read-all", authMiddleware, async (req, res) => {
  try {
    const playerId = req.player.playerId;
    const { type, priority } = req.body;

    const query = { toPlayerId: playerId, isRead: false };

    if (type) {
      query.type = type;
    }

    if (priority) {
      query.priority = priority;
    }

    const result = await Notification.updateMany(query, {
      $set: { isRead: true },
    });

    return res.json({
      success: true,
      updatedCount: result.modifiedCount,
      message: `تم تعليم ${result.modifiedCount} إشعارات كمقروءة`,
    });
  } catch (err) {
    console.error("خطأ في تعليم جميع الإشعارات كمقروءة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تعليم الإشعارات المثبتة كمقروءة =====================
// PUT /api/notifications/read-pinned
router.put("/read-pinned", authMiddleware, async (req, res) => {
  try {
    const playerId = req.player.playerId;
    const result = await Notification.updateMany(
      {
        toPlayerId: playerId,
        isPinned: true,
        isRead: false,
      },
      {
        $set: { isRead: true },
      }
    );

    return res.json({
      success: true,
      updatedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error("خطأ في تعليم الإشعارات المثبتة كمقروءة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== حذف إشعار =====================
// DELETE /api/notifications/:id
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const playerId = req.player.playerId;
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      toPlayerId: playerId,
    });

    if (!notification) {
      return res.status(404).json({ error: "الإشعار غير موجود" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("خطأ في حذف الإشعار:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== حذف جميع الإشعارات =====================
// DELETE /api/notifications/all
router.delete("/all", authMiddleware, async (req, res) => {
  try {
    const playerId = req.player.playerId;
    const { type, priority, readOnly } = req.body;

    const query = { toPlayerId: playerId };

    if (type) {
      query.type = type;
    }

    if (priority) {
      query.priority = priority;
    }

    if (readOnly === true) {
      query.isRead = true;
    }

    const result = await Notification.deleteMany(query);

    return res.json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("خطأ في حذف جميع الإشعارات:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== حذف الإشعارات القديمة (أكثر من 30 يوم) =====================
// DELETE /api/notifications/clean-old
router.delete("/clean-old", authMiddleware, async (req, res) => {
  try {
    const playerId = req.player.playerId;
    const { days = 30 } = req.query;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(days));

    const result = await Notification.deleteMany({
      toPlayerId: playerId,
      createdAt: { $lt: cutoff },
      isRead: true,
      isPinned: false,
    });

    return res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `تم حذف ${result.deletedCount} إشعار قديم`,
    });
  } catch (err) {
    console.error("خطأ في حذف الإشعارات القديمة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تثبيت/إلغاء تثبيت إشعار =====================
// PUT /api/notifications/:id/pin
router.put("/:id/pin", authMiddleware, async (req, res) => {
  try {
    const playerId = req.player.playerId;
    const { pinned } = req.body;

    const notification = await Notification.findOne({
      _id: req.params.id,
      toPlayerId: playerId,
    });

    if (!notification) {
      return res.status(404).json({ error: "الإشعار غير موجود" });
    }

    notification.isPinned = pinned === true;
    await notification.save();

    return res.json({
      success: true,
      notification,
    });
  } catch (err) {
    console.error("خطأ في تثبيت الإشعار:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إحصائيات الإشعارات (للمطور) =====================
// GET /api/notifications/stats
router.get("/stats", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    if (!player.isDev) {
      return res.status(403).json({ error: "صلاحيات المطور مطلوبة" });
    }

    // إجمالي الإشعارات
    const totalNotifications = await Notification.countDocuments();

    // الإشعارات غير المقروءة
    const unreadNotifications = await Notification.countDocuments({ isRead: false });

    // الإشعارات المثبتة
    const pinnedNotifications = await Notification.countDocuments({ isPinned: true });

    // الإشعارات حسب النوع
    const typeStats = await Notification.getTypeStats();

    // أكثر المستخدمين تلقيًا للإشعارات
    const topUsers = await Notification.getUnreadStats();

    // الإشعارات في آخر 7 أيام
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const lastWeek = await Notification.countDocuments({
      createdAt: { $gte: weekAgo },
    });

    return res.json({
      totalNotifications,
      unreadNotifications,
      pinnedNotifications,
      lastWeek,
      typeStats,
      topUsers,
    });
  } catch (err) {
    console.error("خطأ في جلب إحصائيات الإشعارات:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تنظيف الإشعارات المنتهية (للمطور) =====================
// POST /api/notifications/clean-expired
router.post("/clean-expired", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    if (!player.isDev) {
      return res.status(403).json({ error: "صلاحيات المطور مطلوبة" });
    }

    const result = await Notification.cleanExpired();

    return res.json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("خطأ في تنظيف الإشعارات المنتهية:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إرسال إشعار لجميع الأعضاء في الكلان =====================
// POST /api/notifications/clan/:clanId
router.post("/clan/:clanId", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const { clanId } = req.params;
    const { message, type, priority } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "نص الإشعار مطلوب" });
    }

    // جلب الكلان
    const Clan = require("../models/Clan");
    const clan = await Clan.findById(clanId);

    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    // التحقق من أن المرسل قائد أو ضابط
    const member = clan.members.find((m) => m.playerId === player.playerId);
    if (!member || (member.role !== "leader" && member.role !== "officer")) {
      return res.status(403).json({ error: "صلاحيات غير كافية (قائد أو ضابط)" });
    }

    // إنشاء إشعارات لكل الأعضاء
    const notifications = clan.members.map((m) => ({
      toPlayerId: m.playerId,
      type: type || "clan_announcement",
      message: message.trim(),
      from: player.playerId,
      fromNickname: player.nickname,
      priority: priority || "high",
      data: {
        clanId: clan._id,
        clanName: clan.name,
        fromRole: member.role,
      },
    }));

    await Notification.insertMany(notifications);

    // إرسال إشعارات عبر Socket.io للأعضاء المتصلين
    const io = req.app.get("io");
    const memberIds = clan.members.map((m) => m.playerId);
    const onlineMembers = await Player.find({
      playerId: { $in: memberIds },
      isOnline: true,
    });

    for (const onlineMember of onlineMembers) {
      if (onlineMember.socketId) {
        io.to(onlineMember.socketId).emit("notification", {
          type: type || "clan_announcement",
          message: message.trim(),
          from: player.nickname,
          priority: priority || "high",
          data: {
            clanId: clan._id,
            clanName: clan.name,
          },
        });
      }
    }

    return res.json({
      success: true,
      sentCount: notifications.length,
      message: `تم إرسال الإشعار لـ ${notifications.length} عضو`,
    });
  } catch (err) {
    console.error("خطأ في إرسال إشعار الكلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إرسال إشعار لجميع الأصدقاء المتصلين =====================
// POST /api/notifications/friends
router.post("/friends", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const { message, type, priority } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "نص الإشعار مطلوب" });
    }

    // جلب الأصدقاء المتصلين
    const friends = await Player.find({
      playerId: { $in: player.friends },
      isOnline: true,
    });

    if (friends.length === 0) {
      return res.json({
        success: true,
        sentCount: 0,
        message: "لا يوجد أصدقاء متصلون",
      });
    }

    // إنشاء إشعارات لكل صديق متصل
    const notifications = friends.map((friend) => ({
      toPlayerId: friend.playerId,
      type: type || "friend_message",
      message: message.trim(),
      from: player.playerId,
      fromNickname: player.nickname,
      priority: priority || "medium",
      data: {
        fromPlayerId: player.playerId,
        fromNickname: player.nickname,
      },
    }));

    await Notification.insertMany(notifications);

    // إرسال عبر Socket.io
    const io = req.app.get("io");
    for (const friend of friends) {
      if (friend.socketId) {
        io.to(friend.socketId).emit("notification", {
          type: type || "friend_message",
          message: message.trim(),
          from: player.nickname,
          priority: priority || "medium",
        });
      }
    }

    return res.json({
      success: true,
      sentCount: notifications.length,
      message: `تم إرسال الإشعار لـ ${notifications.length} صديق متصل`,
    });
  } catch (err) {
    console.error("خطأ في إرسال إشعار للأصدقاء:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
