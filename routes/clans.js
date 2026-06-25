const express = require("express");
const router = express.Router();
const Clan = require("../models/Clan");
const Player = require("../models/Player");
const Notification = require("../models/Notification");
const { authMiddleware } = require("../middleware/auth");

// ===================== جلب قائمة الكلانات =====================
// GET /api/clans
router.get("/", async (req, res) => {
  try {
    const { search, limit = 20 } = req.query;
    let query = { isActive: true };

    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    const clans = await Clan.find(query)
      .select("name icon description leaderId joinType members maxMembers stats level xp minLevel")
      .sort({ level: -1, createdAt: -1 })
      .limit(parseInt(limit));

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
      memberCount: c.members.length,
      xpProgress: c.xp > 0 ? Math.min(100, (c.xp / c.xpNeeded()) * 100) : 0,
    }));

    return res.json(result);
  } catch (err) {
    console.error("خطأ في جلب الكلانات:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== جلب تفاصيل كلان محدد =====================
// GET /api/clans/:id
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const clan = await Clan.findById(req.params.id);
    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    // التحقق من أن اللاعب عضو في الكلان
    const isMember = clan.members.some((m) => m.playerId === req.player.playerId);
    if (!isMember && req.player.playerId !== clan.leaderId) {
      // نرسل بيانات محدودة للغير أعضاء
      return res.json({
        _id: clan._id,
        name: clan.name,
        icon: clan.icon,
        description: clan.description,
        leaderId: clan.leaderId,
        joinType: clan.joinType,
        minLevel: clan.minLevel,
        maxMembers: clan.maxMembers,
        members: clan.members.map((m) => ({
          playerId: m.playerId,
          nickname: m.nickname,
          avatar: m.avatar,
          level: m.level,
          role: m.role,
        })),
        stats: clan.stats,
        level: clan.level,
        xp: clan.xp,
        xpNeeded: clan.xpNeeded(),
        announcements: clan.announcements.slice(0, 5),
        isMember: false,
      });
    }

    // بيانات كاملة للعضو
    const memberData = clan.members.find((m) => m.playerId === req.player.playerId);
    const isLeader = req.player.playerId === clan.leaderId;

    return res.json({
      ...clan.toObject(),
      xpNeeded: clan.xpNeeded(),
      xpProgress: clan.xp > 0 ? Math.min(100, (clan.xp / clan.xpNeeded()) * 100) : 0,
      isMember: true,
      isLeader,
      memberRole: memberData?.role || null,
      memberXpContributed: memberData?.xpContributed || 0,
    });
  } catch (err) {
    console.error("خطأ في جلب تفاصيل الكلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إنشاء كلان =====================
// POST /api/clans
router.post("/", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    // التحقق من الشروط
    if (player.level < 12) {
      return res.status(403).json({ error: "تحتاج إلى المستوى 12 على الأقل" });
    }
    if (player.coins < 3000) {
      return res.status(403).json({ error: "تحتاج إلى 3000 عملة" });
    }
    if (player.clanId) {
      return res.status(400).json({ error: "أنت بالفعل في كلان" });
    }

    const { name, icon, description, joinType, minLevel, maxMembers } = req.body;

    if (!name || name.length < 3 || name.length > 20) {
      return res.status(400).json({ error: "اسم الكلان يجب أن يكون بين 3 و20 حرف" });
    }

    const existing = await Clan.findByName(name);
    if (existing) {
      return res.status(409).json({ error: "اسم الكلان مستخدم بالفعل" });
    }

    const clan = new Clan({
      name: name.trim(),
      icon: icon || "shield",
      description: description || "",
      leaderId: player.playerId,
      joinType: joinType || "open",
      minLevel: minLevel || 1,
      maxMembers: maxMembers || 50,
      members: [
        {
          playerId: player.playerId,
          nickname: player.nickname,
          avatar: player.avatar,
          level: player.level,
          role: "leader",
          xpContributed: 0,
        },
      ],
    });

    await clan.save();

    // خصم العملات
    player.coins -= 3000;
    player.clanId = clan._id;
    player.clanRole = "leader";
    await player.save();

    return res.status(201).json({
      success: true,
      clan,
      message: "تم إنشاء الكلان بنجاح",
    });
  } catch (err) {
    console.error("خطأ في إنشاء الكلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== الانضمام لكلان =====================
// POST /api/clans/:id/join
router.post("/:id/join", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const clan = await Clan.findById(req.params.id);

    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    if (player.clanId) {
      return res.status(400).json({ error: "أنت بالفعل في كلان" });
    }

    const joinCheck = clan.canJoin(player.level);
    if (!joinCheck.canJoin) {
      return res.status(403).json({ error: joinCheck.reason });
    }

    // التحقق من عدم وجود طلب مسبق
    const existingRequest = clan.joinRequests.some((r) => r.playerId === player.playerId);
    if (existingRequest) {
      return res.status(409).json({ error: "لديك طلب انضمام معلق" });
    }

    if (clan.joinType === "open") {
      // انضمام فوري
      clan.members.push({
        playerId: player.playerId,
        nickname: player.nickname,
        avatar: player.avatar,
        level: player.level,
        role: "member",
        xpContributed: 0,
      });

      player.clanId = clan._id;
      player.clanRole = "member";

      await Promise.all([clan.save(), player.save()]);

      // إشعار للقائد
      const notification = new Notification({
        toPlayerId: clan.leaderId,
        type: "clan_join_accepted",
        message: `${player.nickname} انضم إلى الكلان`,
        from: player.playerId,
        fromNickname: player.nickname,
        priority: "medium",
        data: { clanId: clan._id, clanName: clan.name },
      });
      await notification.save();

      // إشعار Socket للقائد إذا كان متصلاً
      const io = req.app.get("io");
      const leader = await Player.findOne({ playerId: clan.leaderId });
      if (leader?.socketId) {
        io.to(leader.socketId).emit("notification", {
          type: "clan_join_accepted",
          message: `${player.nickname} انضم إلى الكلان`,
        });
      }

      return res.json({ success: true, message: "انضممت إلى الكلان بنجاح" });
    } else {
      // طلب انضمام (بطلب)
      clan.joinRequests.push({
        playerId: player.playerId,
        nickname: player.nickname,
        avatar: player.avatar,
        level: player.level,
      });

      await clan.save();

      // إشعار للقائد
      const notification = new Notification({
        toPlayerId: clan.leaderId,
        type: "clan_join_request",
        message: `${player.nickname} طلب الانضمام إلى الكلان`,
        from: player.playerId,
        fromNickname: player.nickname,
        priority: "high",
        data: { clanId: clan._id, clanName: clan.name },
      });
      await notification.save();

      // إشعار Socket للقائد
      const io = req.app.get("io");
      const leader = await Player.findOne({ playerId: clan.leaderId });
      if (leader?.socketId) {
        io.to(leader.socketId).emit("notification", {
          type: "clan_join_request",
          message: `${player.nickname} طلب الانضمام إلى الكلان`,
        });
        io.to(leader.socketId).emit("clan_request_update", {
          clanId: clan._id,
          requests: clan.joinRequests.length,
        });
      }

      return res.json({
        success: true,
        message: "تم إرسال طلب الانضمام، ينتظر موافقة القائد",
      });
    }
  } catch (err) {
    console.error("خطأ في الانضمام للكلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== مغادرة الكلان =====================
// POST /api/clans/:id/leave
router.post("/:id/leave", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const clan = await Clan.findById(req.params.id);

    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    if (!clan.members.some((m) => m.playerId === player.playerId)) {
      return res.status(400).json({ error: "أنت لست عضواً في هذا الكلان" });
    }

    if (clan.leaderId === player.playerId) {
      return res.status(400).json({ error: "القائد لا يمكنه المغادرة - انقل الملكية أولاً" });
    }

    clan.removeMember(player.playerId);
    player.clanId = null;
    player.clanRole = "member";

    await Promise.all([clan.save(), player.save()]);

    // إشعار للقائد
    const notification = new Notification({
      toPlayerId: clan.leaderId,
      type: "clan_message",
      message: `${player.nickname} غادر الكلان`,
      from: player.playerId,
      fromNickname: player.nickname,
      priority: "medium",
    });
    await notification.save();

    return res.json({ success: true, message: "غادرت الكلان بنجاح" });
  } catch (err) {
    console.error("خطأ في مغادرة الكلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إدارة الكلان (للقائد والضباط) =====================
// PUT /api/clans/:id/manage
router.put("/:id/manage", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const clan = await Clan.findById(req.params.id);

    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    const member = clan.members.find((m) => m.playerId === player.playerId);
    if (!member) {
      return res.status(403).json({ error: "أنت لست عضواً في هذا الكلان" });
    }

    const isLeader = player.playerId === clan.leaderId;
    const isOfficer = member.role === "officer";

    if (!isLeader && !isOfficer) {
      return res.status(403).json({ error: "صلاحيات غير كافية (قائد أو ضابط)" });
    }

    const { action, targetPlayerId, data } = req.body;

    if (!action || !targetPlayerId) {
      return res.status(400).json({ error: "الإجراء واللاعب المستهدف مطلوبان" });
    }

    const targetMember = clan.members.find((m) => m.playerId === targetPlayerId);
    if (!targetMember) {
      return res.status(404).json({ error: "اللاعب المستهدف ليس عضواً" });
    }

    if (targetMember.playerId === clan.leaderId && action !== "transfer") {
      return res.status(403).json({ error: "لا يمكن تنفيذ هذا الإجراء على القائد" });
    }

    const response = { success: true };

    switch (action) {
      case "kick":
        if (!isLeader) {
          return res.status(403).json({ error: "فقط القائد يمكنه طرد الأعضاء" });
        }
        // إزالة العضو
        clan.removeMember(targetPlayerId);
        const kickedPlayer = await Player.findOne({ playerId: targetPlayerId });
        if (kickedPlayer) {
          kickedPlayer.clanId = null;
          kickedPlayer.clanRole = "member";
          await kickedPlayer.save();
        }
        response.message = "تم طرد العضو";
        break;

      case "promote":
        if (!isLeader) {
          return res.status(403).json({ error: "فقط القائد يمكنه الترقية" });
        }
        if (targetMember.role === "leader") {
          return res.status(400).json({ error: "القائد لا يمكن ترقيته" });
        }
        targetMember.role = "officer";
        await clan.save();
        response.message = `تم ترقية ${targetMember.nickname} إلى ضابط`;
        break;

      case "demote":
        if (!isLeader) {
          return res.status(403).json({ error: "فقط القائد يمكنه التنزيل" });
        }
        if (targetMember.role === "leader") {
          return res.status(400).json({ error: "لا يمكن تنزيل القائد" });
        }
        if (targetMember.role === "member") {
          return res.status(400).json({ error: "العضو لا يمكن تنزيله أكثر" });
        }
        targetMember.role = "member";
        await clan.save();
        response.message = `تم تنزيل ${targetMember.nickname} إلى عضو`;
        break;

      case "transfer":
        if (!isLeader) {
          return res.status(403).json({ error: "فقط القائد يمكنه نقل الملكية" });
        }
        if (targetMember.role === "leader") {
          return res.status(400).json({ error: "هذا اللاعب قائد بالفعل" });
        }
        // نقل الملكية
        const oldLeader = clan.members.find((m) => m.playerId === clan.leaderId);
        if (oldLeader) oldLeader.role = "member";

        targetMember.role = "leader";
        clan.leaderId = targetPlayerId;

        // تحديث دور اللاعب في قاعدة البيانات
        const newLeader = await Player.findOne({ playerId: targetPlayerId });
        if (newLeader) {
          newLeader.clanRole = "leader";
          await newLeader.save();
        }
        const oldLeaderPlayer = await Player.findOne({ playerId: player.playerId });
        if (oldLeaderPlayer) {
          oldLeaderPlayer.clanRole = "member";
          await oldLeaderPlayer.save();
        }

        await clan.save();
        response.message = `تم نقل الملكية إلى ${targetMember.nickname}`;
        break;

      case "accept_request":
        if (!isLeader) {
          return res.status(403).json({ error: "فقط القائد يمكنه قبول الطلبات" });
        }
        const requestIndex = clan.joinRequests.findIndex((r) => r.playerId === targetPlayerId);
        if (requestIndex === -1) {
          return res.status(404).json({ error: "الطلب غير موجود" });
        }

        // التحقق من أن الكلان ليس ممتلئاً
        if (clan.members.length >= clan.maxMembers) {
          return res.status(400).json({ error: "الكلان ممتلئ" });
        }

        const requestData = clan.joinRequests[requestIndex];
        const newMember = await Player.findOne({ playerId: targetPlayerId });
        if (!newMember) {
          return res.status(404).json({ error: "اللاعب غير موجود" });
        }

        // إضافة العضو
        clan.members.push({
          playerId: newMember.playerId,
          nickname: newMember.nickname,
          avatar: newMember.avatar,
          level: newMember.level,
          role: "member",
          xpContributed: 0,
        });

        clan.joinRequests.splice(requestIndex, 1);

        newMember.clanId = clan._id;
        newMember.clanRole = "member";
        await newMember.save();
        await clan.save();

        // إشعار للعضو الجديد
        const joinNotification = new Notification({
          toPlayerId: targetPlayerId,
          type: "clan_join_accepted",
          message: `تم قبول طلب انضمامك إلى ${clan.name}`,
          from: clan.leaderId,
          fromNickname: player.nickname,
          priority: "high",
          data: { clanId: clan._id, clanName: clan.name },
        });
        await joinNotification.save();

        const io = req.app.get("io");
        if (newMember.socketId) {
          io.to(newMember.socketId).emit("notification", {
            type: "clan_join_accepted",
            message: `تم قبول طلب انضمامك إلى ${clan.name}`,
          });
        }

        response.message = `تم قبول طلب ${requestData.nickname}`;
        break;

      case "reject_request":
        if (!isLeader) {
          return res.status(403).json({ error: "فقط القائد يمكنه رفض الطلبات" });
        }
        const rejectIndex = clan.joinRequests.findIndex((r) => r.playerId === targetPlayerId);
        if (rejectIndex === -1) {
          return res.status(404).json({ error: "الطلب غير موجود" });
        }
        const rejectedData = clan.joinRequests[rejectIndex];
        clan.joinRequests.splice(rejectIndex, 1);
        await clan.save();

        // إشعار للاعب المرفوض
        const rejectNotification = new Notification({
          toPlayerId: targetPlayerId,
          type: "clan_message",
          message: `تم رفض طلب انضمامك إلى ${clan.name}`,
          from: clan.leaderId,
          fromNickname: player.nickname,
          priority: "medium",
        });
        await rejectNotification.save();

        const io2 = req.app.get("io");
        const rejectedPlayer = await Player.findOne({ playerId: targetPlayerId });
        if (rejectedPlayer?.socketId) {
          io2.to(rejectedPlayer.socketId).emit("notification", {
            type: "clan_message",
            message: `تم رفض طلب انضمامك إلى ${clan.name}`,
          });
        }

        response.message = `تم رفض طلب ${rejectedData.nickname}`;
        break;

      default:
        return res.status(400).json({ error: "إجراء غير صالح" });
    }

    return res.json(response);
  } catch (err) {
    console.error("خطأ في إدارة الكلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إعلان من القائد =====================
// POST /api/clans/:id/announce
router.post("/:id/announce", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const clan = await Clan.findById(req.params.id);

    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    if (clan.leaderId !== player.playerId) {
      return res.status(403).json({ error: "فقط القائد يمكنه إرسال إعلانات" });
    }

    const { message, isPinned } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "نص الإعلان مطلوب" });
    }

    const announcement = clan.addAnnouncement(
      message.trim(),
      player.playerId,
      player.nickname
    );

    if (isPinned) {
      announcement.isPinned = true;
    }

    await clan.save();

    // إرسال إعلان لكل الأعضاء عبر Socket.io
    const io = req.app.get("io");
    const memberIds = clan.members.map((m) => m.playerId);
    const members = await Player.find({ playerId: { $in: memberIds }, isOnline: true });

    for (const member of members) {
      if (member.socketId) {
        io.to(member.socketId).emit("clan_announcement", {
          clanId: clan._id,
          clanName: clan.name,
          message: message.trim(),
          from: player.nickname,
          timestamp: new Date(),
          isPinned: isPinned || false,
        });
        // إشعار منبثق
        io.to(member.socketId).emit("notification", {
          type: "clan_announcement",
          message: `📢 إعلان من ${player.nickname}: ${message.trim()}`,
          priority: "high",
        });
      }
    }

    // حفظ إشعارات لكل الأعضاء
    const notifications = clan.members.map((m) => ({
      toPlayerId: m.playerId,
      type: "clan_announcement",
      message: `إعلان من ${player.nickname}: ${message.trim()}`,
      from: player.playerId,
      fromNickname: player.nickname,
      priority: "high",
      data: { clanId: clan._id, clanName: clan.name, isPinned: isPinned || false },
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }

    return res.json({
      success: true,
      announcement,
      message: "تم إرسال الإعلان للأعضاء",
    });
  } catch (err) {
    console.error("خطأ في إرسال الإعلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تحديث إعدادات الكلان =====================
// PUT /api/clans/:id/settings
router.put("/:id/settings", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const clan = await Clan.findById(req.params.id);

    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    if (clan.leaderId !== player.playerId) {
      return res.status(403).json({ error: "فقط القائد يمكنه تغيير الإعدادات" });
    }

    const { description, joinType, minLevel, maxMembers, icon } = req.body;

    if (description !== undefined) clan.description = description.trim();
    if (joinType) clan.joinType = joinType;
    if (minLevel !== undefined) {
      if (minLevel < 1 || minLevel > 100) {
        return res.status(400).json({ error: "الحد الأدنى للمستوى بين 1 و100" });
      }
      clan.minLevel = parseInt(minLevel);
    }
    if (maxMembers !== undefined) {
      if (maxMembers < 5 || maxMembers > 100) {
        return res.status(400).json({ error: "الحد الأقصى للأعضاء بين 5 و100" });
      }
      clan.maxMembers = parseInt(maxMembers);
    }
    if (icon) clan.icon = icon;

    await clan.save();

    return res.json({
      success: true,
      clan: {
        description: clan.description,
        joinType: clan.joinType,
        minLevel: clan.minLevel,
        maxMembers: clan.maxMembers,
        icon: clan.icon,
      },
    });
  } catch (err) {
    console.error("خطأ في تحديث إعدادات الكلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== جلب طلبات الانضمام (للقائد) =====================
// GET /api/clans/:id/requests
router.get("/:id/requests", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const clan = await Clan.findById(req.params.id);

    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    if (clan.leaderId !== player.playerId) {
      return res.status(403).json({ error: "فقط القائد يمكنه رؤية الطلبات" });
    }

    return res.json({
      requests: clan.joinRequests,
      count: clan.joinRequests.length,
    });
  } catch (err) {
    console.error("خطأ في جلب طلبات الانضمام:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== حل الكلان (للقائد فقط) =====================
// DELETE /api/clans/:id
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const clan = await Clan.findById(req.params.id);

    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    if (clan.leaderId !== player.playerId) {
      return res.status(403).json({ error: "فقط القائد يمكنه حل الكلان" });
    }

    // تحرير جميع الأعضاء
    const memberIds = clan.members.map((m) => m.playerId);
    await Player.updateMany(
      { playerId: { $in: memberIds } },
      { $set: { clanId: null, clanRole: "member" } }
    );

    // إشعار لجميع الأعضاء
    const notifications = clan.members.map((m) => ({
      toPlayerId: m.playerId,
      type: "clan_message",
      message: `تم حل الكلان ${clan.name} بواسطة القائد`,
      from: player.playerId,
      fromNickname: player.nickname,
      priority: "high",
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }

    // إرسال إشعارات عبر Socket
    const io = req.app.get("io");
    const members = await Player.find({ playerId: { $in: memberIds }, isOnline: true });
    for (const member of members) {
      if (member.socketId) {
        io.to(member.socketId).emit("clan_disbanded", {
          clanId: clan._id,
          clanName: clan.name,
        });
        io.to(member.socketId).emit("notification", {
          type: "clan_message",
          message: `تم حل الكلان ${clan.name}`,
        });
      }
    }

    await Clan.findByIdAndDelete(req.params.id);

    return res.json({ success: true, message: "تم حل الكلان" });
  } catch (err) {
    console.error("خطأ في حل الكلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== جلب إحصائيات الكلان =====================
// GET /api/clans/:id/stats
router.get("/:id/stats", authMiddleware, async (req, res) => {
  try {
    const clan = await Clan.findById(req.params.id);
    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    const stats = clan.getStats();

    // جلب أسماء أفضل المساهمين
    const topMembers = clan.members
      .sort((a, b) => b.xpContributed - a.xpContributed)
      .slice(0, 5)
      .map((m) => ({
        playerId: m.playerId,
        nickname: m.nickname,
        xpContributed: m.xpContributed,
        role: m.role,
      }));

    return res.json({
      stats,
      topMembers,
      levelRewards: clan.getLevelReward(clan.level),
    });
  } catch (err) {
    console.error("خطأ في جلب إحصائيات الكلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
