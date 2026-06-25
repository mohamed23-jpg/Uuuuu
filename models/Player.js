const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema(
  {
    // الهوية الأساسية
    playerId: { type: String, unique: true, required: true },
    nickname: { type: String, required: true, trim: true, minlength: 3, maxlength: 20 },
    passwordHash: { type: String, default: null },
    avatar: { type: String, default: "spy" },
    customAvatar: { type: String, default: null },

    // المستوى والتقدم
    level: { type: Number, default: 1, min: 1, max: 100 },
    xp: { type: Number, default: 0, min: 0 },
    coins: { type: Number, default: 0, min: 0 },
    title: { type: String, default: "مبتدئ" },
    activeTitle: { type: String, default: "مبتدئ" },

    // المطور
    isDev: { type: Boolean, default: false },

    // الأصدقاء
    friends: [{ type: String }],
    friendRequests: [
      {
        from: String,
        nickname: String,
        avatar: String,
        sentAt: { type: Date, default: Date.now },
      },
    ],
    blockedPlayers: [{ type: String }],
    pinnedFriends: [{ type: String }],
    maxFriends: { type: Number, default: 30 },
    maxPins: { type: Number, default: 1 },

    // المخزون
    inventory: {
      cardSkins: [{ skinId: String, equipped: Boolean }],
      nameFrames: [{ frameId: String, equipped: Boolean }],
      unlockedTitles: [{ type: String }],
    },

    // الإعدادات
    settings: {
      legendaryNotification: { type: Boolean, default: true },
      soundEffects: { type: Boolean, default: true },
      vibration: { type: Boolean, default: true },
      pushNotifications: { type: Boolean, default: false },
      volume: { type: Number, default: 80, min: 0, max: 100 },
    },

    // الإحصائيات
    stats: {
      gamesPlayed: { type: Number, default: 0 },
      gamesWon: { type: Number, default: 0 },
      gamesAsSpymaster: { type: Number, default: 0 },
      winsAsSpymaster: { type: Number, default: 0 },
      correctGuesses: { type: Number, default: 0 },
      hintsGiven: { type: Number, default: 0 },
      chatMessages: { type: Number, default: 0 },
    },

    // المهام اليومية والأسبوعية
    missions: {
      daily: {
        resetAt: { type: Date, default: null },
        wins: { type: Number, default: 0 },
        hints: { type: Number, default: 0 },
        correctGuesses: { type: Number, default: 0 },
        chatMessages: { type: Number, default: 0 },
        claimed: {
          wins: { type: Boolean, default: false },
          hints: { type: Boolean, default: false },
          correctGuesses: { type: Boolean, default: false },
          chatMessages: { type: Boolean, default: false },
        },
      },
      weekly: {
        resetAt: { type: Date, default: null },
        wins: { type: Number, default: 0 },
        spymasterWins: { type: Number, default: 0 },
        duoGames: { type: Number, default: 0 },
        blackAvoided: { type: Number, default: 0 },
        claimed: {
          wins: { type: Boolean, default: false },
          spymasterWins: { type: Boolean, default: false },
          duoGames: { type: Boolean, default: false },
          blackAvoided: { type: Boolean, default: false },
        },
      },
    },

    // الكلان
    clanId: { type: mongoose.Schema.Types.ObjectId, ref: "Clan", default: null },
    clanRole: { type: String, enum: ["member", "officer", "leader"], default: "member" },

    // الحالة
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    currentRoom: { type: String, default: null },
    socketId: { type: String, default: null },

    // المصادقة
    token: { type: String, default: null },

    // الحظر (إضافة حقل isBanned و banReason)
    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: "" },
  },
  { timestamps: true }
);

// توليد ID فريد يبدأ بـ 238
playerSchema.statics.generatePlayerId = async function () {
  let id;
  let exists = true;
  while (exists) {
    const rand = Math.floor(Math.random() * 1000000000).toString().padStart(9, "0");
    id = "238" + rand;
    exists = await this.findOne({ playerId: id });
  }
  return id;
};

// حساب XP المطلوب للمستوى التالي
playerSchema.methods.xpNeeded = function () {
  return Math.floor(100 * this.level * (1 + this.level / 20));
};

// منح XP مع التصعيد التلقائي
playerSchema.methods.addXP = async function (amount) {
  this.xp += amount;
  const rewards = [];

  while (this.xp >= this.xpNeeded() && this.level < 100) {
    this.xp -= this.xpNeeded();
    this.level += 1;

    // مكافآت المستوى
    const coinReward = Math.min(15 * this.level, 1000);
    this.coins += coinReward;
    rewards.push({ type: "coins", amount: coinReward });

    // حزم بطاقات عند مستويات معينة
    if ([5, 15, 25, 35, 50, 65, 80, 95].includes(this.level)) {
      rewards.push({ type: "cardPack", level: this.level });
    }

    // إطارات الاسم
    if ([10, 20, 30, 40, 60, 70, 90, 100].includes(this.level)) {
      rewards.push({ type: "nameFrame", level: this.level });
    }

    // زيادة الأصدقاء والتثبيت
    if ([14, 43, 63, 83].includes(this.level)) {
      this.maxFriends += 5;
      this.maxPins += 1;
    }

    // تحديث اللقب
    const newTitle = this.getTitleByLevel();
    if (newTitle !== this.title) {
      this.title = newTitle;
      if (!this.inventory.unlockedTitles.includes(newTitle)) {
        this.inventory.unlockedTitles.push(newTitle);
      }
    }
  }

  return rewards;
};

// اللقب حسب المستوى
playerSchema.methods.getTitleByLevel = function () {
  if (this.level >= 100) return "مختم اللعبة";
  if (this.level >= 85) return "أسطورة حية";
  if (this.level >= 70) return "سيد";
  if (this.level >= 60) return "فارس";
  if (this.level >= 50) return "بطل";
  if (this.level >= 40) return "أسطورة";
  if (this.level >= 30) return "خبير";
  if (this.level >= 20) return "محترف";
  if (this.level >= 10) return "متعلم";
  return "مبتدئ";
};

module.exports = mongoose.model("Player", playerSchema);
