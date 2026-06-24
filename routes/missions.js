const express = require("express");
const router = express.Router();
const Player = require("../models/Player");
const Challenge = require("../models/Challenge");
const { authMiddleware } = require("../middleware/auth");

// المهام اليومية
const DAILY_MISSIONS = [
  { id: "wins", label: "انتصاران", target: 2, xp: 50, coins: 30, condition: "wins" },
  { id: "hints", label: "3 تلميحات", target: 3, xp: 30, coins: 20, condition: "hints" },
  { id: "correctGuesses", label: "5 تخمينات صحيحة", target: 5, xp: 40, coins: 25, condition: "correctGuesses" },
  { id: "chatMessages", label: "10 رسائل شات", target: 10, xp: 20, coins: 15, condition: "chatMessages" },
];

// المهام الأسبوعية
const WEEKLY_MISSIONS = [
  { id: "wins", label: "10 انتصارات", target: 10, xp: 200, coins: 150, condition: "wins" },
  { id: "spymasterWins", label: "3 انتصارات كبوص", target: 3, xp: 150, coins: 100, condition: "spymasterWins" },
  { id: "duoGames", label: "5 مباريات زوجي", target: 5, xp: 100, coins: 80, condition: "duoGames" },
  { id: "blackAvoided", label: "تجنب الأسود 3 مرات", target: 3, xp: 120, coins: 90, condition: "blackAvoided" },
];

// دالة إعادة تعيين المهام
const shouldResetDaily = (resetAt) => {
  if (!resetAt) return true;
  const now = new Date();
  const last = new Date(resetAt);
  return now.toDateString() !== last.toDateString();
};

const shouldResetWeekly = (resetAt) => {
  if (!resetAt) return true;
  const now = new Date();
  const last = new Date(resetAt);
  const dayOfWeek = now.getDay(); // 0 = الأحد
  const diffDays = Math.floor((now - last) / (1000 * 60 * 60 * 24));
  return diffDays >= 7 || (dayOfWeek === 0 && diffDays > 0);
};

// جلب تقدم المهام
// GET /api/missions
router.get("/", authMiddleware, async (req, res) => {
  try {
    const player = req.player;

    // إعادة تعيين المهام اليومية
    if (shouldResetDaily(player.missions.daily.resetAt)) {
      player.missions.daily = {
        resetAt: new Date(),
        wins: 0,
        hints: 0,
        correctGuesses: 0,
        chatMessages: 0,
        claimed: { wins: false, hints: false, correctGuesses: false, chatMessages: false },
      };
      await player.save();
    }

    // إعادة تعيين المهام الأسبوعية
    if (shouldResetWeekly(player.missions.weekly.resetAt)) {
      player.missions.weekly = {
        resetAt: new Date(),
        wins: 0,
        spymasterWins: 0,
        duoGames: 0,
        blackAvoided: 0,
        claimed: { wins: false, spymasterWins: false, duoGames: false, blackAvoided: false },
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

    const daily = DAILY_MISSIONS.map((m) => ({
      ...m,
      progress: player.missions.daily[m.condition] || 0,
      claimed: player.missions.daily.claimed?.[m.id] || false,
    }));

    const weekly = WEEKLY_MISSIONS.map((m) => ({
      ...m,
      progress: player.missions.weekly[m.condition] || 0,
      claimed: player.missions.weekly.claimed?.[m.id] || false,
    }));

    // حساب وقت إعادة التعيين
    const nextDailyReset = new Date();
    nextDailyReset.setHours(24, 0, 0, 0);

    return res.json({ daily, weekly, challenges, nextDailyReset });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// المطالبة بمكافأة مهمة
// POST /api/missions/claim
router.post("/claim", authMiddleware, async (req, res) => {
  try {
    const { missionType, missionId } = req.body;
    const player = req.player;

    let mission;
    if (missionType === "daily") {
      mission = DAILY_MISSIONS.find((m) => m.id === missionId);
      if (!mission) return res.status(404).json({ error: "المهمة غير موجودة" });

      const progress = player.missions.daily[mission.condition] || 0;
      if (progress < mission.target) return res.status(400).json({ error: "المهمة لم تكتمل بعد" });
      if (player.missions.daily.claimed?.[missionId]) return res.status(409).json({ error: "المكافأة مستلمة بالفعل" });

      player.missions.daily.claimed = player.missions.daily.claimed || {};
      player.missions.daily.claimed[missionId] = true;
    } else if (missionType === "weekly") {
      mission = WEEKLY_MISSIONS.find((m) => m.id === missionId);
      if (!mission) return res.status(404).json({ error: "المهمة غير موجودة" });

      const progress = player.missions.weekly[mission.condition] || 0;
      if (progress < mission.target) return res.status(400).json({ error: "المهمة لم تكتمل بعد" });
      if (player.missions.weekly.claimed?.[missionId]) return res.status(409).json({ error: "المكافأة مستلمة بالفعل" });

      player.missions.weekly.claimed = player.missions.weekly.claimed || {};
      player.missions.weekly.claimed[missionId] = true;
    } else {
      return res.status(400).json({ error: "نوع مهمة غير صالح" });
    }

    player.coins += mission.coins;
    const levelRewards = await player.addXP(mission.xp);
    await player.save();

    return res.json({
      success: true,
      xpGained: mission.xp,
      coinsGained: mission.coins,
      levelRewards,
      newLevel: player.level,
      newXp: player.xp,
      newCoins: player.coins,
    });
  } catch {
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

module.exports = router;
