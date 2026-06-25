const mongoose = require("mongoose");

const clanSchema = new mongoose.Schema(
  {
    // المعلومات الأساسية
    name: {
      type: String,
      required: true,
      unique: true,
      minlength: 3,
      maxlength: 20,
      trim: true,
    },
    icon: {
      type: String,
      default: "shield",
      enum: [
        "shield",
        "sword",
        "trident",
        "lightning",
        "moon",
        "flame",
        "wave",
        "eagle",
        "skull",
        "target",
        "crown",
        "star",
        "diamond",
        "heart",
        "infinity",
      ],
    },
    description: {
      type: String,
      maxlength: 200,
      default: "",
      trim: true,
    },

    // القائد
    leaderId: {
      type: String,
      required: true,
    },

    // نوع الانضمام
    joinType: {
      type: String,
      enum: ["open", "request"],
      default: "open",
    },

    // شروط الانضمام
    minLevel: {
      type: Number,
      default: 1,
      min: 1,
      max: 100,
    },
    maxMembers: {
      type: Number,
      default: 50,
      min: 5,
      max: 100,
    },

    // الأعضاء
    members: [
      {
        playerId: { type: String, required: true },
        nickname: { type: String, required: true },
        avatar: { type: String, default: "spy" },
        level: { type: Number, default: 1 },
        role: {
          type: String,
          enum: ["member", "officer", "leader"],
          default: "member",
        },
        joinedAt: { type: Date, default: Date.now },
        xpContributed: { type: Number, default: 0 },
      },
    ],

    // طلبات الانضمام
    joinRequests: [
      {
        playerId: { type: String, required: true },
        nickname: { type: String, required: true },
        avatar: { type: String, default: "spy" },
        level: { type: Number, default: 1 },
        sentAt: { type: Date, default: Date.now },
      },
    ],

    // نظام XP والليفلات
    xp: {
      type: Number,
      default: 0,
      min: 0,
    },
    level: {
      type: Number,
      default: 1,
      min: 1,
      max: 10,
    },

    // جوائز المستويات
    levelRewards: {
      type: Map,
      of: {
        coins: { type: Number, default: 0 },
        xp: { type: Number, default: 0 },
        title: { type: String, default: null },
        description: { type: String, default: "" },
      },
      default: {},
    },

    // الإحصائيات
    stats: {
      totalWins: { type: Number, default: 0 },
      totalGames: { type: Number, default: 0 },
      totalMembersEver: { type: Number, default: 0 },
      topContributor: { type: String, default: null },
      topContributorXp: { type: Number, default: 0 },
    },

    // الإعلانات (للقائد)
    announcements: [
      {
        message: { type: String, required: true, maxlength: 500 },
        from: { type: String, required: true },
        fromNickname: { type: String, required: true },
        sentAt: { type: Date, default: Date.now },
        isPinned: { type: Boolean, default: false },
      },
    ],

    // آخر نشاط
    lastActivity: { type: Date, default: Date.now },

    // الحالة
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ===================== دوال مساعدة =====================

// حساب XP المطلوب للمستوى التالي في الكلان
clanSchema.methods.xpNeededForLevel = function (level) {
  const baseXp = 100;
  const multiplier = 1.5;
  return Math.floor(baseXp * Math.pow(multiplier, level - 1));
};

// الحصول على XP المطلوب للمستوى الحالي
clanSchema.methods.xpNeeded = function () {
  return this.xpNeededForLevel(this.level + 1);
};

// إضافة XP للكلان (نسبة من XP اللاعب)
clanSchema.methods.addXP = async function (amount, playerId) {
  const xpToAdd = Math.floor(amount * 0.1); // 10% من XP اللاعب
  if (xpToAdd <= 0) return { leveledUp: false };

  this.xp += xpToAdd;

  // تحديث مساهمات العضو
  const member = this.members.find((m) => m.playerId === playerId);
  if (member) {
    member.xpContributed += xpToAdd;
  }

  // تحديث أفضل مساهم
  if (member && member.xpContributed > this.stats.topContributorXp) {
    this.stats.topContributor = playerId;
    this.stats.topContributorXp = member.xpContributed;
  }

  let leveledUp = false;
  const rewards = [];

  // الترقية إلى المستوى التالي
  while (this.xp >= this.xpNeeded() && this.level < 10) {
    this.xp -= this.xpNeeded();
    this.level += 1;
    leveledUp = true;

    // مكافآت المستوى
    const reward = this.getLevelReward(this.level);
    if (reward) {
      rewards.push(reward);
      // تطبيق المكافآت على الأعضاء (سيتم تطبيقها عند المطالبة)
    }

    this.lastActivity = new Date();
  }

  await this.save();
  return { leveledUp, rewards, newLevel: this.level };
};

// الحصول على مكافآت المستوى
clanSchema.methods.getLevelReward = function (level) {
  const defaultRewards = {
    2: { coins: 100, xp: 50, description: "مكافأة التأسيس" },
    3: { coins: 200, xp: 75, description: "مكافأة النمو" },
    4: { coins: 300, xp: 100, description: "مكافأة التماسك" },
    5: { coins: 500, xp: 150, title: "كلان متماسك", description: "لقب جديد للكلان" },
    6: { coins: 700, xp: 200, description: "مكافأة القوة" },
    7: { coins: 1000, xp: 250, description: "مكافأة الريادة" },
    8: { coins: 1500, xp: 350, description: "مكافأة العظمة" },
    9: { coins: 2000, xp: 500, description: "مكافأة الأسطورة" },
    10: { coins: 5000, xp: 1000, title: "كلان أسطوري", description: "اللقب النهائي للكلان" },
  };

  return defaultRewards[level] || null;
};

// التحقق من إمكانية الانضمام
clanSchema.methods.canJoin = function (playerLevel) {
  if (!this.isActive) return { canJoin: false, reason: "الكلان غير نشط" };
  if (this.members.length >= this.maxMembers) {
    return { canJoin: false, reason: "الكلان ممتلئ" };
  }
  if (playerLevel < this.minLevel) {
    return { canJoin: false, reason: `تحتاج إلى المستوى ${this.minLevel} على الأقل` };
  }
  return { canJoin: true };
};

// إضافة إعلان
clanSchema.methods.addAnnouncement = function (message, fromId, fromNickname) {
  if (this.announcements.length >= 50) {
    this.announcements.shift(); // حذف أقدم إعلان
  }
  this.announcements.push({
    message: message.trim(),
    from: fromId,
    fromNickname: fromNickname,
    sentAt: new Date(),
    isPinned: false,
  });
  this.lastActivity = new Date();
  return this.announcements[this.announcements.length - 1];
};

// إزالة عضو
clanSchema.methods.removeMember = function (playerId) {
  this.members = this.members.filter((m) => m.playerId !== playerId);
  this.stats.totalMembersEver = Math.max(this.stats.totalMembersEver, this.members.length);
  this.lastActivity = new Date();
  return this;
};

// ترقية عضو
clanSchema.methods.promoteMember = function (playerId, newRole) {
  const member = this.members.find((m) => m.playerId === playerId);
  if (!member) return false;
  if (member.role === "leader") return false;
  if (newRole === "leader" && this.leaderId === playerId) return false;
  member.role = newRole;
  this.lastActivity = new Date();
  return true;
};

// الحصول على إحصائيات الكلان للتقرير
clanSchema.methods.getStats = function () {
  const totalMembers = this.members.length;
  const officers = this.members.filter((m) => m.role === "officer").length;
  const totalXp = this.xp;
  const level = this.level;
  const xpNeeded = this.xpNeeded();

  return {
    totalMembers,
    officers,
    totalXp,
    level,
    xpNeeded,
    progress: Math.min(100, (totalXp / xpNeeded) * 100),
    topContributor: this.stats.topContributor,
    topContributorXp: this.stats.topContributorXp,
    totalWins: this.stats.totalWins,
    totalGames: this.stats.totalGames,
    totalMembersEver: this.stats.totalMembersEver,
  };
};

// ===================== دوال ثابتة =====================

// البحث عن كلان بالاسم
clanSchema.statics.findByName = function (name) {
  return this.findOne({ name: { $regex: new RegExp(`^${name}$`, "i") } });
};

// البحث عن كلانات مفتوحة للانضمام
clanSchema.statics.findOpenClans = function (limit = 20) {
  return this.find({
    joinType: "open",
    isActive: true,
    $expr: { $lt: [{ $size: "$members" }, "$maxMembers"] },
  })
    .sort({ level: -1, createdAt: 1 })
    .limit(limit);
};

// الحصول على كلانات اللاعب
clanSchema.statics.findPlayerClans = function (playerId) {
  return this.find({ "members.playerId": playerId });
};

// زيادة إحصائيات الفوز
clanSchema.methods.addWin = function () {
  this.stats.totalWins += 1;
  this.stats.totalGames += 1;
  this.lastActivity = new Date();
  return this.save();
};

// زيادة إحصائيات اللعب
clanSchema.methods.addGame = function () {
  this.stats.totalGames += 1;
  this.lastActivity = new Date();
  return this.save();
};

module.exports = mongoose.model("Clan", clanSchema);
