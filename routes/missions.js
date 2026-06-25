const express = require("express");
const router = express.Router();
const Player = require("../models/Player");
const Challenge = require("../models/Challenge");
const { authMiddleware } = require("../middleware/auth");

// ===================== المهام اليومية (ثابتة) =====================
const DAILY_MISSIONS = [
  {
    id: "wins",
    label: "انتصاران",
    target: 2,
    xp: 50,
    coins: 30,
    condition: "wins",
    description: "حقق انتصارين في المباريات",
  },
  {
    id: "hints",
    label: "ثلاثة تلميحات",
    target: 3,
    xp: 30,
    coins: 20,
    condition: "hints",
    description: "أرسل 3 تلميحات كبوص",
  },
  {
    id: "correctGuesses",
    label: "خمسة تخمينات صحيحة",
    target: 5,
    xp: 40,
    coins: 25,
    condition: "correctGuesses",
    description: "قم بـ 5 تخمينات صحيحة",
  },
  {
    id: "chatMessages",
    label: "عشر رسائل",
    target: 10,
    xp: 20,
    coins: 15,
    condition: "chatMessages",
    description: "أرسل 10 رسائل في الدردشة العامة",
  },
];

// ===================== المهام الأسبوعية (ثابتة) =====================
const WEEKLY_MISSIONS = [
  {
    id: "wins",
    label: "عشرة انتصارات",
    target: 10,
    xp: 200,
    coins: 150,
    condition: "wins",
    description: "حقق 10 انتصارات في الأسبوع",
  },
  {
    id: "spymasterWins",
    label: "ثلاثة انتصارات كبوص",
    target: 3,
    xp: 150,
    coins: 100,
    condition: "spymasterWins",
    description: "افز 3 مرات كبوص",
  },
  {
    id: "duoGames",
    label: "خمس مباريات زوجي",
    target: 5,
    xp: 100,
    coins: 80,
    condition: "duoGames",
    description: "العب 5 مباريات في الوضع الزوجي",
  },
  {
    id: "blackAvoided",
    label: "تجنب الأسود ثلاث مرات",
    target: 3,
    xp: 120,
    coins: 90,
    condition: "blackAvoided",
    description: "تجنب اختيار البطاقة السوداء 3 مرات",
  },
];

// ===================== دوال مساعدة لإعادة التعيين =====================

// التحقق من إعادة تعيين المهام اليومية
const shouldResetDaily = (resetAt) => {
  if (!resetAt) return true;
  const now = new Date();
  const last = new Date(resetAt);
  return now.toDateString() !== last.toDateString();
};

// التحقق من إعادة تعيين المهام الأسبوعية
const shouldResetWeekly = (resetAt) => {
  if (!resetAt) return true;
  const now = new Date();
  const last = new Date(resetAt);
  const dayOfWeek = now.getDay(); // 0 = الأحد
  const diffDays = Math.floor((now - last) / (1000 * 60 * 60 * 24));
  // إعادة التعيين كل يوم أحد
  return diffDays >= 7 || (dayOfWeek === 0 && diffDays > 0);
};

// ===================== جلب تقدم المهام =====================
// GET /api/missions
router.get("/", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    // إعادة تعيين المهام اليومية إذا لزم الأمر
    if (shouldResetDaily(player.missions.daily.resetAt)) {
      player.missions.daily = {
        resetAt: new Date(),
        wins: 0,
        hints: 0,
        correctGuesses: 0,
        chatMessages: 0,
        claimed: {
          wins: false,
          hints: false,
          correctGuesses: false,
          chatMessages: false,
        },
      };
      await player.save();
    }

    // إعادة تعيين المهام الأسبوعية إذا لزم الأمر
    if (shouldResetWeekly(player.missions.weekly.resetAt)) {
      player.missions.weekly = {
        resetAt: new Date(),
        wins: 0,
        spymasterWins: 0,
        duoGames: 0,
        blackAvoided: 0,
        claimed: {
          wins: false,
          spymasterWins: false,
          duoGames: false,
          blackAvoided: false,
        },
      };
      await player.save();
    }

    // التحديات الخاصة النشطة
    const now = new Date();
    const challenges = await Challenge.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    });

    // تجهيز المهام اليومية مع التقدم
    const daily = DAILY_MISSIONS.map((m) => ({
      ...m,
      progress: player.missions.daily[m.condition] || 0,
      claimed: player.missions.daily.claimed?.[m.id] || false,
      completed: (player.missions.daily[m.condition] || 0) >= m.target,
    }));

    // تجهيز المهام الأسبوعية مع التقدم
    const weekly = WEEKLY_MISSIONS.map((m) => ({
      ...m,
      progress: player.missions.weekly[m.condition] || 0,
      claimed: player.missions.weekly.claimed?.[m.id] || false,
      completed: (player.missions.weekly[m.condition] || 0) >= m.target,
    }));

    // حساب وقت إعادة التعيين التالي
    const nextDailyReset = new Date();
    nextDailyReset.setHours(24, 0, 0, 0);

    const nextWeeklyReset = new Date();
    const daysUntilSunday = 7 - nextWeeklyReset.getDay();
    nextWeeklyReset.setDate(nextWeeklyReset.getDate() + daysUntilSunday);
    nextWeeklyReset.setHours(0, 0, 0, 0);

    return res.json({
      daily,
      weekly,
      challenges,
      nextDailyReset,
      nextWeeklyReset,
      dailyResetIn: Math.floor((nextDailyReset - now) / 1000),
      weeklyResetIn: Math.floor((nextWeeklyReset - now) / 1000),
    });
  } catch (err) {
    console.error("خطأ في جلب المهام:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== المطالبة بمكافأة مهمة =====================
// POST /api/missions/claim
router.post("/claim", authMiddleware, async (req, res) => {
  try {
    const { missionType, missionId } = req.body;
    const player = req.player;

    if (!missionType || !missionId) {
      return res.status(400).json({ error: "نوع المهمة ومعرفها مطلوبان" });
    }

    let mission;
    let progress, claimed;

    // التحقق من نوع المهمة
    if (missionType === "daily") {
      mission = DAILY_MISSIONS.find((m) => m.id === missionId);
      if (!mission) {
        return res.status(404).json({ error: "المهمة اليومية غير موجودة" });
      }

      // التحقق من إعادة التعيين
      if (shouldResetDaily(player.missions.daily.resetAt)) {
        return res.status(400).json({ error: "تم إعادة تعيين المهام اليومية، قم بتحديث الصفحة" });
      }

      progress = player.missions.daily[mission.condition] || 0;
      claimed = player.missions.daily.claimed?.[missionId] || false;

      if (progress < mission.target) {
        return res.status(400).json({
          error: `المهمة لم تكتمل بعد (${progress}/${mission.target})`,
        });
      }

      if (claimed) {
        return res.status(409).json({ error: "المكافأة مستلمة بالفعل" });
      }

      // تحديث حالة المطالبة
      player.missions.daily.claimed = player.missions.daily.claimed || {};
      player.missions.daily.claimed[missionId] = true;

    } else if (missionType === "weekly") {
      mission = WEEKLY_MISSIONS.find((m) => m.id === missionId);
      if (!mission) {
        return res.status(404).json({ error: "المهمة الأسبوعية غير موجودة" });
      }

      // التحقق من إعادة التعيين
      if (shouldResetWeekly(player.missions.weekly.resetAt)) {
        return res.status(400).json({ error: "تم إعادة تعيين المهام الأسبوعية، قم بتحديث الصفحة" });
      }

      progress = player.missions.weekly[mission.condition] || 0;
      claimed = player.missions.weekly.claimed?.[missionId] || false;

      if (progress < mission.target) {
        return res.status(400).json({
          error: `المهمة لم تكتمل بعد (${progress}/${mission.target})`,
        });
      }

      if (claimed) {
        return res.status(409).json({ error: "المكافأة مستلمة بالفعل" });
      }

      // تحديث حالة المطالبة
      player.missions.weekly.claimed = player.missions.weekly.claimed || {};
      player.missions.weekly.claimed[missionId] = true;

    } else {
      return res.status(400).json({ error: "نوع مهمة غير صالح (daily أو weekly)" });
    }

    // منح المكافأة (عملات + XP)
    const coinsGained = mission.coins || 0;
    const xpGained = mission.xp || 0;

    player.coins += coinsGained;
    const levelRewards = await player.addXP(xpGained);

    // تحديث إحصائيات الكلان (نسبة من XP للكلان)
    if (player.clanId && xpGained > 0) {
      try {
        const Clan = require("../models/Clan");
        const clan = await Clan.findById(player.clanId);
        if (clan) {
          await clan.addXP(xpGained, player.playerId);
        }
      } catch (clanErr) {
        console.error("خطأ في إضافة XP للكلان:", clanErr);
      }
    }

    await player.save();

    // إرسال إشعار عبر Socket إذا كان اللاعب متصلاً
    const io = req.app.get("io");
    if (player.socketId) {
      io.to(player.socketId).emit("mission_claimed", {
        missionType,
        missionId,
        xpGained,
        coinsGained,
        newLevel: player.level,
        newXp: player.xp,
        newCoins: player.coins,
        levelRewards,
      });

      // إشعار منبثق
      io.to(player.socketId).emit("notification", {
        type: "mission_claimed",
        message: `استلمت مكافأة المهمة: +${xpGained} XP و +${coinsGained} عملة`,
        priority: "medium",
      });
    }

    return res.json({
      success: true,
      xpGained,
      coinsGained,
      levelRewards,
      newLevel: player.level,
      newXp: player.xp,
      newCoins: player.coins,
    });
  } catch (err) {
    console.error("خطأ في المطالبة بمكافأة المهمة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تحديث تقدم المهمة (يُستدعى من أحداث اللعبة) =====================
// POST /api/missions/update
// ملاحظة: هذا المسار يُستخدم داخلياً لتحديث تقدم المهام من أحداث اللعبة
router.post("/update", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const { type, value } = req.body; // type: wins, hints, correctGuesses, chatMessages, spymasterWins, duoGames, blackAvoided

    if (!type) {
      return res.status(400).json({ error: "نوع التحديث مطلوب" });
    }

    const validTypes = [
      "wins",
      "hints",
      "correctGuesses",
      "chatMessages",
      "spymasterWins",
      "duoGames",
      "blackAvoided",
    ];

    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: "نوع تحديث غير صالح" });
    }

    // تحديث المهام اليومية
    if (player.missions.daily[type] !== undefined) {
      if (!shouldResetDaily(player.missions.daily.resetAt)) {
        player.missions.daily[type] += value || 1;
      }
    }

    // تحديث المهام الأسبوعية
    if (player.missions.weekly[type] !== undefined) {
      if (!shouldResetWeekly(player.missions.weekly.resetAt)) {
        player.missions.weekly[type] += value || 1;
      }
    }

    await player.save();

    return res.json({
      success: true,
      daily: {
        wins: player.missions.daily.wins,
        hints: player.missions.daily.hints,
        correctGuesses: player.missions.daily.correctGuesses,
        chatMessages: player.missions.daily.chatMessages,
      },
      weekly: {
        wins: player.missions.weekly.wins,
        spymasterWins: player.missions.weekly.spymasterWins,
        duoGames: player.missions.weekly.duoGames,
        blackAvoided: player.missions.weekly.blackAvoided,
      },
    });
  } catch (err) {
    console.error("خطأ في تحديث تقدم المهمة:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== جلب التحديات الخاصة (للمطور فقط) =====================
// GET /api/missions/challenges
router.get("/challenges", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    // التحقق من صلاحيات المطور
    if (!player.isDev) {
      return res.status(403).json({ error: "صلاحيات المطور مطلوبة" });
    }

    const now = new Date();
    const challenges = await Challenge.find()
      .sort({ createdAt: -1 })
      .limit(50);

    return res.json(challenges);
  } catch (err) {
    console.error("خطأ في جلب التحديات:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إنشاء تحدي جديد (للمطور فقط) =====================
// POST /api/missions/challenges
router.post("/challenges", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    if (!player.isDev) {
      return res.status(403).json({ error: "صلاحيات المطور مطلوبة" });
    }

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
      createdBy: player.playerId,
      completedBy: [],
      claimedBy: [],
    });

    await challenge.save();

    // إشعار لكل اللاعبين المتصلين
    const io = req.app.get("io");
    io.emit("notification", {
      type: "new_challenge",
      message: `تحدي جديد: ${challenge.name}`,
      priority: "high",
      data: { challengeId: challenge._id },
    });

    return res.status(201).json(challenge);
  } catch (err) {
    console.error("خطأ في إنشاء التحدي:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== تحديث تحدي (للمطور فقط) =====================
// PUT /api/missions/challenges/:id
router.put("/challenges/:id", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    if (!player.isDev) {
      return res.status(403).json({ error: "صلاحيات المطور مطلوبة" });
    }

    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ error: "التحدي غير موجود" });
    }

    const updates = req.body;
    const allowedFields = [
      "name",
      "description",
      "condition",
      "conditionValue",
      "rewardType",
      "rewardValue",
      "startDate",
      "endDate",
      "isActive",
    ];

    allowedFields.forEach((field) => {
      if (updates[field] !== undefined) {
        challenge[field] = updates[field];
      }
    });

    await challenge.save();
    return res.json(challenge);
  } catch (err) {
    console.error("خطأ في تحديث التحدي:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== حذف تحدي (للمطور فقط) =====================
// DELETE /api/missions/challenges/:id
router.delete("/challenges/:id", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    if (!player.isDev) {
      return res.status(403).json({ error: "صلاحيات المطور مطلوبة" });
    }

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

// ===================== المطالبة بمكافأة تحدي خاص =====================
// POST /api/missions/challenges/:id/claim
router.post("/challenges/:id/claim", authMiddleware, async (req, res) => {
  try {
    const player = req.player;
    const challenge = await Challenge.findById(req.params.id);

    if (!challenge) {
      return res.status(404).json({ error: "التحدي غير موجود" });
    }

    if (!challenge.isActive) {
      return res.status(400).json({ error: "التحدي غير نشط" });
    }

    const now = new Date();
    if (now < challenge.startDate || now > challenge.endDate) {
      return res.status(400).json({ error: "التحدي غير متاح حالياً" });
    }

    // التحقق من اكتمال التحدي
    const completed = challenge.completedBy.some((c) => c.playerId === player.playerId);
    if (!completed) {
      return res.status(400).json({ error: "لم تكمل التحدي بعد" });
    }

    // التحقق من عدم المطالبة مسبقاً
    if (challenge.claimedBy.includes(player.playerId)) {
      return res.status(409).json({ error: "تم المطالبة بالمكافأة مسبقاً" });
    }

    // منح المكافأة
    let rewards = [];
    const rewardType = challenge.rewardType;
    const rewardValue = challenge.rewardValue;

    if (rewardType === "coins") {
      player.coins += rewardValue;
      rewards.push({ type: "coins", amount: rewardValue });
    } else if (rewardType === "xp") {
      const levelRewards = await player.addXP(rewardValue);
      rewards.push({ type: "xp", amount: rewardValue, levelRewards });
    } else if (rewardType === "cardPack") {
      // إضافة حزمة بطاقات للمخزون
      const skinId = `pack_${Date.now()}`;
      player.inventory.cardSkins.push({
        skinId,
        equipped: false,
      });
      rewards.push({ type: "cardPack", skinId });
    } else if (rewardType === "nameFrame") {
      // إضافة إطار اسم للمخزون
      const frameId = `frame_${Date.now()}`;
      player.inventory.nameFrames.push({
        frameId,
        equipped: false,
      });
      rewards.push({ type: "nameFrame", frameId });
    }

    // تسجيل المطالبة
    challenge.claimedBy.push(player.playerId);
    await challenge.save();
    await player.save();

    // إشعار عبر Socket
    const io = req.app.get("io");
    if (player.socketId) {
      io.to(player.socketId).emit("notification", {
        type: "challenge_claimed",
        message: `استلمت مكافأة التحدي: ${challenge.name}`,
        priority: "high",
        data: { rewards },
      });
    }

    return res.json({
      success: true,
      rewards,
      newCoins: player.coins,
      newXp: player.xp,
      newLevel: player.level,
    });
  } catch (err) {
    console.error("خطأ في المطالبة بمكافأة التحدي:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// ===================== إعادة تعيين المهام يدوياً (للمطور فقط) =====================
// POST /api/missions/reset
router.post("/reset", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    if (!player.isDev) {
      return res.status(403).json({ error: "صلاحيات المطور مطلوبة" });
    }

    const { type } = req.body;

    if (type === "daily") {
      await Player.updateMany(
        {},
        {
          $set: {
            "missions.daily.resetAt": new Date(),
            "missions.daily.wins": 0,
            "missions.daily.hints": 0,
            "missions.daily.correctGuesses": 0,
            "missions.daily.chatMessages": 0,
            "missions.daily.claimed": {
              wins: false,
              hints: false,
              correctGuesses: false,
              chatMessages: false,
            },
          },
        }
      );
    } else if (type === "weekly") {
      await Player.updateMany(
        {},
        {
          $set: {
            "missions.weekly.resetAt": new Date(),
            "missions.weekly.wins": 0,
            "missions.weekly.spymasterWins": 0,
            "missions.weekly.duoGames": 0,
            "missions.weekly.blackAvoided": 0,
            "missions.weekly.claimed": {
              wins: false,
              spymasterWins: false,
              duoGames: false,
              blackAvoided: false,
            },
          },
        }
      );
    } else {
      return res.status(400).json({ error: "نوع إعادة التعيين غير صالح (daily أو weekly)" });
    }

    return res.json({ success: true, message: `تم إعادة تعيين المهام ${type === "daily" ? "اليومية" : "الأسبوعية"}` });
  } catch (err) {
    console.error("خطأ في إعادة تعيين المهام:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
