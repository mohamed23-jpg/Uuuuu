const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const { authMiddleware } = require("../middleware/auth");

// جلب الإشعارات
// GET /api/notifications
router.get("/", authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({ toPlayerId: req.player.playerId })
      .sort({ createdAt: -1 })
      .limit(50);

    const unread = notifications.filter((n) => !n.isRead).length;
    return res.json({ notifications, unread });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// تعليم إشعار كمقروء
// PUT /api/notifications/:id/read
router.put("/:id/read", authMiddleware, async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, toPlayerId: req.player.playerId },
      { isRead: true }
    );
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// تعليم كل الإشعارات كمقروءة
// PUT /api/notifications/read-all
router.put("/read-all", authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany(
      { toPlayerId: req.player.playerId, isRead: false },
      { isRead: true }
    );
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// حذف إشعار
// DELETE /api/notifications/:id
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    await Notification.findOneAndDelete({
      _id: req.params.id,
      toPlayerId: req.player.playerId,
    });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
