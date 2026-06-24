const express = require("express");
const router = express.Router();
const Clan = require("../models/Clan");
const Player = require("../models/Player");
const Notification = require("../models/Notification");
const { authMiddleware } = require("../middleware/auth");

// جلب قائمة الكلانات
// GET /api/clans
router.get("/", async (req, res) => {
  try {
    const clans = await Clan.find().select(
      "name icon description leaderId joinType members maxMembers stats"
    );
    return res.json(clans);
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// إنشاء كلان
// POST /api/clans
router.post("/", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    if (player.level < 12) {
      return res.status(403).json({ error: "تحتاج إلى المستوى 12 على الأقل" });
    }
    if (player.coins < 5000) {
      return res.status(403).json({ error: "تحتاج إلى 5000 عملة" });
    }
    if (player.clanId) {
      return res.status(400).json({ error: "أنت بالفعل في كلان" });
    }

    const { name, icon, description, joinType } = req.body;

    const existing = await Clan.findOne({ name: { $regex: new RegExp(`^${name}$`, "i") } });
    if (existing) return res.status(409).json({ error: "اسم الكلان مستخدم بالفعل" });

    const clan = new Clan({
      name,
      icon: icon || "shield",
      description: description || "",
      leaderId: player.playerId,
      joinType: joinType || "open",
      members: [
        {
          playerId: player.playerId,
          nickname: player.nickname,
          avatar: player.avatar,
          level: player.level,
          role: "leader",
        },
      ],
    });

    await clan.save();

    player.coins -= 5000;
    player.clanId = clan._id;
    player.clanRole = "leader";
    await player.save();

    return res.status(201).json({ success: true, clan });
  } catch (err) {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// الانضمام لكلان
// POST /api/clans/:id/join
router.post("/:id/join", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    if (player.level < 5) {
      return res.status(403).json({ error: "تحتاج إلى المستوى 5 على الأقل" });
    }
    if (player.clanId) {
      return res.status(400).json({ error: "أنت بالفعل في كلان" });
    }

    const clan = await Clan.findById(req.params.id);
    if (!clan) return res.status(404).json({ error: "الكلان غير موجود" });

    if (clan.members.length >= clan.maxMembers) {
      return res.status(400).json({ error: "الكلان ممتلئ" });
    }

    if (clan.joinType === "open") {
      clan.members.push({
        playerId: player.playerId,
        nickname: player.nickname,
        avatar: player.avatar,
        level: player.level,
        role: "member",
      });
      player.clanId = clan._id;
      player.clanRole = "member";
      await Promise.all([clan.save(), player.save()]);
      return res.json({ success: true, message: "انضممت للكلان" });
    } else {
      // طلب انضمام
      const alreadyRequested = clan.joinRequests.some((r) => r.playerId === player.playerId);
      if (alreadyRequested) return res.status(409).json({ error: "طلبك قيد الانتظار" });

      clan.joinRequests.push({
        playerId: player.playerId,
        nickname: player.nickname,
        avatar: player.avatar,
        level: player.level,
      });
      await clan.save();
      return res.json({ success: true, message: "تم إرسال طلب الانضمام" });
    }
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// مغادرة الكلان
// POST /api/clans/:id/leave
router.post("/:id/leave", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const clan = await Clan.findById(req.params.id);
    if (!clan) return res.status(404).json({ error: "الكلان غير موجود" });

    if (clan.leaderId === player.playerId) {
      return res.status(400).json({ error: "القائد لا يمكنه المغادرة - انقل الملكية أولاً" });
    }

    clan.members = clan.members.filter((m) => m.playerId !== player.playerId);
    player.clanId = null;
    player.clanRole = "member";

    await Promise.all([clan.save(), player.save()]);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// إدارة الكلان (للقائد والضباط)
// PUT /api/clans/:id/manage
router.put("/:id/manage", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const clan = await Clan.findById(req.params.id);
    if (!clan) return res.status(404).json({ error: "الكلان غير موجود" });

    const isLeader = clan.leaderId === player.playerId;
    const myRole = clan.members.find((m) => m.playerId === player.playerId)?.role;

    if (!isLeader && myRole !== "officer") {
      return res.status(403).json({ error: "صلاحيات غير كافية" });
    }

    const { action, targetPlayerId } = req.body;

    if (action === "kick") {
      clan.members = clan.members.filter((m) => m.playerId !== targetPlayerId);
      const target = await Player.findOne({ playerId: targetPlayerId });
      if (target) {
        target.clanId = null;
        target.clanRole = "member";
        await target.save();
      }
    } else if (action === "promote" && isLeader) {
      const member = clan.members.find((m) => m.playerId === targetPlayerId);
      if (member) member.role = "officer";
    } else if (action === "demote" && isLeader) {
      const member = clan.members.find((m) => m.playerId === targetPlayerId);
      if (member) member.role = "member";
    } else if (action === "transfer" && isLeader) {
      clan.leaderId = targetPlayerId;
      const oldLeader = clan.members.find((m) => m.playerId === player.playerId);
      const newLeader = clan.members.find((m) => m.playerId === targetPlayerId);
      if (oldLeader) oldLeader.role = "member";
      if (newLeader) newLeader.role = "leader";
      player.clanRole = "member";
      await player.save();
    } else if (action === "accept_request" && isLeader) {
      const reqIdx = clan.joinRequests.findIndex((r) => r.playerId === targetPlayerId);
      if (reqIdx !== -1) {
        const reqData = clan.joinRequests[reqIdx];
        clan.members.push({ ...reqData, role: "member" });
        clan.joinRequests.splice(reqIdx, 1);
        const target = await Player.findOne({ playerId: targetPlayerId });
        if (target) {
          target.clanId = clan._id;
          target.clanRole = "member";
          await target.save();
        }
      }
    } else if (action === "reject_request" && isLeader) {
      clan.joinRequests = clan.joinRequests.filter((r) => r.playerId !== targetPlayerId);
    }

    await clan.save();
    return res.json({ success: true, clan });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// حل الكلان (للقائد فقط)
// DELETE /api/clans/:id
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const clan = await Clan.findById(req.params.id);
    if (!clan) return res.status(404).json({ error: "الكلان غير موجود" });

    if (clan.leaderId !== player.playerId) {
      return res.status(403).json({ error: "القائد فقط يمكنه حل الكلان" });
    }

    // تحرير كل الأعضاء
    const memberIds = clan.members.map((m) => m.playerId);
    await Player.updateMany(
      { playerId: { $in: memberIds } },
      { $set: { clanId: null, clanRole: "member" } }
    );

    await Clan.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
