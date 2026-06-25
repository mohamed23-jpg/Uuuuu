const mongoose = require("mongoose");

const challengeSchema = new mongoose.Schema(
  {
    // المعلومات الأساسية
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },

    // شروط التحدي
    condition: {
      type: String,
      required: true,
      enum: ["wins", "hints", "correctGuesses", "chatMessages", "spymasterWins", "duoGames", "blackAvoided"],
    },
    conditionValue: {
      type: Number,
      required: true,
      min: 1,
      max: 1000,
    },

    // نوع المكافأة
    rewardType: {
      type: String,
      required: true,
      enum: ["xp", "coins", "cardPack", "nameFrame", "title"],
    },
    rewardValue: {
      type: Number,
      required: true,
      min: 1,
      max: 10000,
    },

    // مكافأة إضافية (لقب مثلاً)
    rewardTitle: {
      type: String,
      default: null,
      trim: true,
    },

    // التواريخ
    startDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endDate: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 أيام افتراضياً
    },

    // الحالة
    isActive: {
      type: Boolean,
      default: true,
    },

    // منشئ التحدي
    createdBy: {
      type: String,
      default: "system",
    },

    // اللاعبون الذين أكملوا التحدي
    completedBy: [
      {
        playerId: {
          type: String,
          required: true,
        },
        completedAt: {
          type: Date,
          default: Date.now,
        },
        progress: {
          type: Number,
          default: 0,
        },
      },
    ],

    // اللاعبون الذين طالبوا بالمكافأة
    claimedBy: [
      {
        type: String,
        ref: "Player",
      },
    ],

    // عدد المشاركين (لإحصائيات)
    participantCount: {
      type: Number,
      default: 0,
    },

    // بيانات إضافية (مرنة)
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ===================== الفهارس =====================

// فهرس للبحث السريع عن التحديات النشطة
challengeSchema.index({ isActive: 1, startDate: 1, endDate: 1 });

// فهرس للبحث عن التحديات التي أكملها لاعب معين
challengeSchema.index({ "completedBy.playerId": 1 });

// فهرس للبحث عن التحديات التي طالب بها لاعب معين
challengeSchema.index({ claimedBy: 1 });

// ===================== دوال مساعدة =====================

// التحقق من أن التحدي نشط (في الفترة الزمنية)
challengeSchema.methods.isActiveNow = function () {
  const now = new Date();
  return this.isActive && now >= this.startDate && now <= this.endDate;
};

// التحقق من أن اللاعب أكمل التحدي
challengeSchema.methods.isCompletedBy = function (playerId) {
  return this.completedBy.some((entry) => entry.playerId === playerId);
};

// التحقق من أن اللاعب طالب بالمكافأة
challengeSchema.methods.isClaimedBy = function (playerId) {
  return this.claimedBy.includes(playerId);
};

// إكمال التحدي للاعب
challengeSchema.methods.completeFor = function (playerId, progress = null) {
  if (this.isCompletedBy(playerId)) {
    return false;
  }

  this.completedBy.push({
    playerId,
    completedAt: new Date(),
    progress: progress || this.conditionValue,
  });

  this.participantCount += 1;
  return true;
};

// المطالبة بالمكافأة
challengeSchema.methods.claimFor = function (playerId) {
  if (!this.isCompletedBy(playerId)) {
    throw new Error("اللاعب لم يكمل التحدي بعد");
  }

  if (this.isClaimedBy(playerId)) {
    throw new Error("تم المطالبة بالمكافأة مسبقاً");
  }

  this.claimedBy.push(playerId);
  return true;
};

// حساب عدد المكتملين
challengeSchema.methods.getCompletionCount = function () {
  return this.completedBy.length;
};

// حساب نسبة الإكمال (مقارنة بالمشاركين)
challengeSchema.methods.getCompletionRate = function () {
  if (this.participantCount === 0) return 0;
  return (this.completedBy.length / this.participantCount) * 100;
};

// ===================== دوال ثابتة =====================

// جلب التحديات النشطة حالياً
challengeSchema.statics.getActiveChallenges = function () {
  const now = new Date();
  return this.find({
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).sort({ endDate: 1 });
};

// جلب التحديات التي أكملها لاعب معين
challengeSchema.statics.getCompletedByPlayer = function (playerId) {
  return this.find({
    "completedBy.playerId": playerId,
  }).sort({ createdAt: -1 });
};

// جلب التحديات التي طالب بها لاعب معين
challengeSchema.statics.getClaimedByPlayer = function (playerId) {
  return this.find({
    claimedBy: playerId,
  }).sort({ createdAt: -1 });
};

// جلب التحديات القادمة (التي لم تبدأ بعد)
challengeSchema.statics.getUpcomingChallenges = function (limit = 10) {
  const now = new Date();
  return this.find({
    isActive: true,
    startDate: { $gt: now },
  })
    .sort({ startDate: 1 })
    .limit(limit);
};

// جلب التحديات المنتهية (التي انتهت صلاحيتها)
challengeSchema.statics.getExpiredChallenges = function (limit = 50) {
  const now = new Date();
  return this.find({
    isActive: true,
    endDate: { $lt: now },
  })
    .sort({ endDate: -1 })
    .limit(limit);
};

// جلب إحصائيات التحديات
challengeSchema.statics.getStats = async function () {
  const total = await this.countDocuments();
  const active = await this.countDocuments({ isActive: true });
  const expired = await this.countDocuments({
    isActive: true,
    endDate: { $lt: new Date() },
  });
  const upcoming = await this.countDocuments({
    isActive: true,
    startDate: { $gt: new Date() },
  });

  // أكثر التحديات إكمالاً
  const topCompleted = await this.aggregate([
    { $match: { isActive: true } },
    { $project: { name: 1, completionCount: { $size: "$completedBy" } } },
    { $sort: { completionCount: -1 } },
    { $limit: 5 },
  ]);

  // أكثر التحديات مشاركة
  const topParticipated = await this.aggregate([
    { $match: { isActive: true } },
    { $project: { name: 1, participantCount: 1 } },
    { $sort: { participantCount: -1 } },
    { $limit: 5 },
  ]);

  return {
    total,
    active,
    expired,
    upcoming,
    topCompleted,
    topParticipated,
  };
};

// ===================== دوال المصانع (Factories) =====================

// إنشاء تحدي جديد مع قيم افتراضية
challengeSchema.statics.createChallenge = function (data) {
  const defaults = {
    startDate: new Date(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    isActive: true,
    createdBy: "system",
  };

  const challengeData = { ...defaults, ...data };
  return new this(challengeData);
};

// ===================== تنبيهات (Hooks) =====================

// قبل الحفظ، تأكد من أن endDate بعد startDate
challengeSchema.pre("save", function (next) {
  if (this.startDate && this.endDate && this.endDate <= this.startDate) {
    return next(new Error("تاريخ النهاية يجب أن يكون بعد تاريخ البداية"));
  }

  // تأكد من أن conditionValue عدد صحيح موجب
  if (this.conditionValue < 1) {
    return next(new Error("قيمة الشرط يجب أن تكون أكبر من 0"));
  }

  // تأكد من أن rewardValue عدد صحيح موجب
  if (this.rewardValue < 1) {
    return next(new Error("قيمة المكافأة يجب أن تكون أكبر من 0"));
  }

  next();
});

module.exports = mongoose.model("Challenge", challengeSchema);
