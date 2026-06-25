const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema(
  {
    // القناة (نوع الدردشة)
    channel: {
      type: String,
      enum: ["global", "clan", "friend", "private"],
      required: true,
    },

    // معرف القناة (مثل clanId أو friendId)
    // يُستخدم لتجميع الرسائل في نفس المحادثة
    channelId: {
      type: String,
      default: null,
      index: true,
    },

    // المرسل
    fromPlayerId: {
      type: String,
      required: true,
      index: true,
    },
    fromNickname: {
      type: String,
      required: true,
    },
    fromAvatar: {
      type: String,
      default: "spy",
    },
    fromLevel: {
      type: Number,
      default: 1,
    },
    fromTitle: {
      type: String,
      default: "مبتدئ",
    },

    // المستلم (للقنوات الخاصة فقط)
    toPlayerId: {
      type: String,
      default: null,
      index: true,
    },

    // محتوى الرسالة
    message: {
      type: String,
      required: true,
      maxlength: 500,
    },

    // حالة الفلترة
    isFiltered: {
      type: Boolean,
      default: false,
    },

    // هل المرسل مطور؟
    isDev: {
      type: Boolean,
      default: false,
    },

    // حالة القراءة (للقنوات الخاصة)
    isRead: {
      type: Boolean,
      default: false,
    },

    // تاريخ القراءة
    readAt: {
      type: Date,
      default: null,
    },

    // معلومات إضافية (مثل معرف الكلان، معرف الصديق، إلخ)
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

// فهرس لسرعة البحث في القنوات العامة
chatMessageSchema.index({ channel: 1, createdAt: -1 });

// فهرس لسرعة البحث في قناة معينة (مثل الكلان أو الأصدقاء)
chatMessageSchema.index({ channel: 1, channelId: 1, createdAt: -1 });

// فهرس للرسائل الخاصة بين لاعبين
chatMessageSchema.index({
  channel: 1,
  fromPlayerId: 1,
  toPlayerId: 1,
  createdAt: -1,
});

// فهرس للرسائل غير المقروءة
chatMessageSchema.index({ toPlayerId: 1, isRead: 1 });

// ===================== دوال مساعدة =====================

// تعليم الرسالة كمقروءة
chatMessageSchema.methods.markAsRead = async function () {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

// تعليم جميع رسائل المستخدم كمقروءة في قناة معينة
chatMessageSchema.statics.markAllAsRead = async function (playerId, channel, channelId = null) {
  const query = {
    toPlayerId: playerId,
    isRead: false,
  };

  if (channel) {
    query.channel = channel;
  }

  if (channelId) {
    query.channelId = channelId;
  }

  return this.updateMany(query, {
    $set: { isRead: true, readAt: new Date() },
  });
};

// جلب عدد الرسائل غير المقروءة للمستخدم
chatMessageSchema.statics.getUnreadCount = async function (playerId) {
  return this.countDocuments({
    toPlayerId: playerId,
    isRead: false,
  });
};

// جلب الرسائل غير المقروءة للمستخدم في قناة معينة
chatMessageSchema.statics.getUnreadForChannel = async function (playerId, channel, channelId = null) {
  const query = {
    toPlayerId: playerId,
    isRead: false,
    channel,
  };

  if (channelId) {
    query.channelId = channelId;
  }

  return this.find(query).sort({ createdAt: 1 });
};

// جلب آخر رسالة في محادثة
chatMessageSchema.statics.getLastMessage = async function (channel, channelId = null) {
  const query = { channel };

  if (channelId) {
    query.channelId = channelId;
  }

  return this.findOne(query).sort({ createdAt: -1 });
};

// جلب عدد رسائل مستخدم (لإحصائيات الدردشة)
chatMessageSchema.statics.getUserMessageCount = async function (playerId) {
  return this.countDocuments({
    $or: [{ fromPlayerId: playerId }, { toPlayerId: playerId }],
  });
};

// حذف الرسائل القديمة في قناة معينة (للحفاظ على الحجم)
chatMessageSchema.statics.cleanOldMessages = async function (channel, limit = 500) {
  const count = await this.countDocuments({ channel });

  if (count <= limit) {
    return { deleted: 0 };
  }

  const toDelete = await this.find({ channel })
    .sort({ createdAt: 1 })
    .limit(count - limit)
    .select("_id");

  if (toDelete.length === 0) {
    return { deleted: 0 };
  }

  const result = await this.deleteMany({
    _id: { $in: toDelete.map((doc) => doc._id) },
  });

  return { deleted: result.deletedCount };
};

// حذف رسائل مستخدم (للمطور)
chatMessageSchema.statics.deleteUserMessages = async function (playerId) {
  return this.deleteMany({
    $or: [{ fromPlayerId: playerId }, { toPlayerId: playerId }],
  });
};

// ===================== دوال إنشاء رسائل (Factories) =====================

// إنشاء رسالة عامة
chatMessageSchema.statics.createGlobal = function (fromPlayerId, fromNickname, fromAvatar, fromLevel, fromTitle, message, isDev = false) {
  return new this({
    channel: "global",
    fromPlayerId,
    fromNickname,
    fromAvatar,
    fromLevel,
    fromTitle,
    message,
    isDev,
  });
};

// إنشاء رسالة كلان
chatMessageSchema.statics.createClan = function (clanId, fromPlayerId, fromNickname, fromAvatar, fromLevel, fromTitle, message, isDev = false) {
  return new this({
    channel: "clan",
    channelId: clanId,
    fromPlayerId,
    fromNickname,
    fromAvatar,
    fromLevel,
    fromTitle,
    message,
    isDev,
  });
};

// إنشاء رسالة بين صديقين
chatMessageSchema.statics.createFriend = function (fromPlayerId, toPlayerId, fromNickname, fromAvatar, fromLevel, fromTitle, message, isDev = false) {
  return new this({
    channel: "friend",
    fromPlayerId,
    toPlayerId,
    fromNickname,
    fromAvatar,
    fromLevel,
    fromTitle,
    message,
    isDev,
  });
};

// إنشاء رسالة خاصة (مباشرة)
chatMessageSchema.statics.createPrivate = function (fromPlayerId, toPlayerId, fromNickname, fromAvatar, fromLevel, fromTitle, message, isDev = false) {
  return new this({
    channel: "private",
    fromPlayerId,
    toPlayerId,
    fromNickname,
    fromAvatar,
    fromLevel,
    fromTitle,
    message,
    isDev,
  });
};

// ===================== دوال استعلام محسنة =====================

// جلب محادثة كاملة بين لاعبين (للأصدقاء أو الخاصة)
chatMessageSchema.statics.getConversation = async function (playerId1, playerId2, limit = 50) {
  return this.find({
    channel: { $in: ["friend", "private"] },
    $or: [
      { fromPlayerId: playerId1, toPlayerId: playerId2 },
      { fromPlayerId: playerId2, toPlayerId: playerId1 },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

// جلب محادثة كلان
chatMessageSchema.statics.getClanConversation = async function (clanId, limit = 50) {
  return this.find({
    channel: "clan",
    channelId: clanId,
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

// جلب محادثة عامة
chatMessageSchema.statics.getGlobalConversation = async function (limit = 100) {
  return this.find({ channel: "global" })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

// ===================== تنبيهات (Hooks) =====================

// قبل حفظ الرسالة، تأكد من أن الحقول المطلوبة موجودة
chatMessageSchema.pre("save", function (next) {
  if (this.channel === "friend" || this.channel === "private") {
    if (!this.toPlayerId) {
      return next(new Error("القناة الخاصة تتطلب toPlayerId"));
    }
  }

  if (this.channel === "clan") {
    if (!this.channelId) {
      return next(new Error("قناة الكلان تتطلب channelId"));
    }
  }

  // إضافة القيم الافتراضية للـ title إذا لم تكن موجودة
  if (!this.fromTitle) {
    this.fromTitle = "مبتدئ";
  }

  // إضافة القيم الافتراضية للـ level
  if (!this.fromLevel) {
    this.fromLevel = 1;
  }

  next();
});

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
