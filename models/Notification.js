const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    // المستلم
    toPlayerId: {
      type: String,
      required: true,
      index: true,
    },

    // نوع الإشعار
    type: {
      type: String,
      enum: [
        // نظام الأصدقاء
        "friend_request",
        "friend_accepted",
        "friend_removed",
        "blocked",

        // نظام الكلانات
        "clan_message",
        "clan_announcement",
        "clan_join_accepted",
        "clan_join_request",
        "clan_member_joined",
        "clan_member_left",
        "clan_level_up",

        // نظام الدردشة
        "private_message",
        "global_mention",

        // نظام المهام والتحديات
        "new_mission",
        "mission_reset",
        "mission_claimed",
        "challenge_claimed",
        "new_challenge",

        // نظام اللعبة
        "room_invite",
        "legendary_join",
        "game_invite",

        // نظام المطور
        "dev_announcement",
        "system_announcement",

        // نظام المستوى
        "level_up",
        "title_unlocked",

        // نظام السوق
        "purchase_confirmed",
        "item_received",

        // أخرى
        "friend_online",
        "friend_offline",
      ],
      required: true,
    },

    // محتوى الإشعار
    message: {
      type: String,
      required: true,
      maxlength: 500,
    },

    // المرسل (playerId أو "system")
    from: {
      type: String,
      default: null,
    },

    // اسم المرسل (للعرض)
    fromNickname: {
      type: String,
      default: null,
    },

    // حالة القراءة
    isRead: {
      type: Boolean,
      default: false,
    },

    // الأولوية
    priority: {
      type: String,
      enum: ["high", "medium", "low"],
      default: "medium",
    },

    // بيانات إضافية (مرنة)
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // للمشاهدات (مثل الإعلانات المثبتة)
    isPinned: {
      type: Boolean,
      default: false,
    },

    // تاريخ انتهاء الإشعار (للإشعارات المؤقتة)
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ===================== دوال مساعدة =====================

// تعليم الإشعار كمقروء
notificationSchema.methods.markAsRead = async function () {
  this.isRead = true;
  return this.save();
};

// تعليم جميع إشعارات المستخدم كمقروءة
notificationSchema.statics.markAllAsRead = async function (playerId) {
  return this.updateMany(
    { toPlayerId: playerId, isRead: false },
    { isRead: true }
  );
};

// جلب الإشعارات غير المقروءة للمستخدم
notificationSchema.statics.getUnreadCount = async function (playerId) {
  return this.countDocuments({ toPlayerId: playerId, isRead: false });
};

// جلب الإشعارات حسب الأولوية
notificationSchema.statics.getByPriority = async function (playerId, priority) {
  return this.find({ toPlayerId: playerId, priority })
    .sort({ createdAt: -1 })
    .limit(50);
};

// جلب الإشعارات الحديثة
notificationSchema.statics.getRecent = async function (playerId, limit = 50) {
  return this.find({ toPlayerId: playerId })
    .sort({ createdAt: -1 })
    .limit(limit);
};

// جلب الإشعارات المثبتة
notificationSchema.statics.getPinned = async function (playerId) {
  return this.find({ toPlayerId: playerId, isPinned: true })
    .sort({ createdAt: -1 });
};

// حذف الإشعارات القديمة (أكثر من 30 يوم)
notificationSchema.statics.cleanOld = async function (days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return this.deleteMany({
    createdAt: { $lt: cutoff },
    isRead: true,
    isPinned: false,
  });
};

// حذف جميع إشعارات المستخدم
notificationSchema.statics.deleteAllForUser = async function (playerId) {
  return this.deleteMany({ toPlayerId: playerId });
};

// ===================== دوال إنشاء إشعارات (Factories) =====================

// إنشاء إشعار طلب صداقة
notificationSchema.statics.createFriendRequest = function (toPlayerId, fromPlayerId, fromNickname, fromAvatar) {
  return new this({
    toPlayerId,
    type: "friend_request",
    message: `${fromNickname} أرسل لك طلب صداقة`,
    from: fromPlayerId,
    fromNickname,
    priority: "high",
    data: { fromPlayerId, fromNickname, fromAvatar },
  });
};

// إنشاء إشعار قبول صداقة
notificationSchema.statics.createFriendAccepted = function (toPlayerId, fromPlayerId, fromNickname) {
  return new this({
    toPlayerId,
    type: "friend_accepted",
    message: `${fromNickname} قبل طلب صداقتك`,
    from: fromPlayerId,
    fromNickname,
    priority: "medium",
    data: { fromPlayerId, fromNickname },
  });
};

// إنشاء إشعار دعوة غرفة
notificationSchema.statics.createRoomInvite = function (toPlayerId, fromPlayerId, fromNickname, roomCode, roomName) {
  return new this({
    toPlayerId,
    type: "room_invite",
    message: `${fromNickname} يدعوك للانضمام إلى غرفة ${roomName || roomCode}`,
    from: fromPlayerId,
    fromNickname,
    priority: "high",
    data: { fromPlayerId, fromNickname, roomCode, roomName },
  });
};

// إنشاء إشعار إعلان كلان
notificationSchema.statics.createClanAnnouncement = function (toPlayerId, fromPlayerId, fromNickname, clanId, clanName, message) {
  return new this({
    toPlayerId,
    type: "clan_announcement",
    message: `إعلان من ${fromNickname}: ${message}`,
    from: fromPlayerId,
    fromNickname,
    priority: "high",
    data: { clanId, clanName, message },
  });
};

// إنشاء إشعار رسالة كلان
notificationSchema.statics.createClanMessage = function (toPlayerId, fromPlayerId, fromNickname, clanId, clanName) {
  return new this({
    toPlayerId,
    type: "clan_message",
    message: `${fromNickname} أرسل رسالة في شات الكلان`,
    from: fromPlayerId,
    fromNickname,
    priority: "low",
    data: { clanId, clanName },
  });
};

// إنشاء إشعار انضمام لكلان
notificationSchema.statics.createClanJoin = function (toPlayerId, fromPlayerId, fromNickname, clanId, clanName) {
  return new this({
    toPlayerId,
    type: "clan_join_accepted",
    message: `${fromNickname} انضم إلى الكلان`,
    from: fromPlayerId,
    fromNickname,
    priority: "medium",
    data: { clanId, clanName, playerId: fromPlayerId },
  });
};

// إنشاء إشعار طلب انضمام لكلان
notificationSchema.statics.createClanJoinRequest = function (toPlayerId, fromPlayerId, fromNickname, clanId, clanName) {
  return new this({
    toPlayerId,
    type: "clan_join_request",
    message: `${fromNickname} طلب الانضمام إلى الكلان`,
    from: fromPlayerId,
    fromNickname,
    priority: "high",
    data: { clanId, clanName, playerId: fromPlayerId },
  });
};

// إنشاء إشعار مستوى الكلان
notificationSchema.statics.createClanLevelUp = function (toPlayerId, clanId, clanName, newLevel, rewards) {
  return new this({
    toPlayerId,
    type: "clan_level_up",
    message: `الكلا ${clanName} وصل إلى المستوى ${newLevel}!`,
    from: "system",
    fromNickname: "النظام",
    priority: "high",
    data: { clanId, clanName, newLevel, rewards },
  });
};

// إنشاء إشعار دخول أسطوري
notificationSchema.statics.createLegendaryJoin = function (toPlayerId, playerId, nickname, level, title) {
  return new this({
    toPlayerId,
    type: "legendary_join",
    message: `${nickname} دخل اللعبة! (مستوى ${level})`,
    from: playerId,
    fromNickname: nickname,
    priority: "high",
    data: { playerId, nickname, level, title },
    isPinned: true,
  });
};

// إنشاء إشعار رسالة خاصة
notificationSchema.statics.createPrivateMessage = function (toPlayerId, fromPlayerId, fromNickname, message) {
  return new this({
    toPlayerId,
    type: "private_message",
    message: `رسالة خاصة من ${fromNickname}`,
    from: fromPlayerId,
    fromNickname,
    priority: "medium",
    data: { fromPlayerId, fromNickname, message },
  });
};

// إنشاء إشعار مستوى جديد
notificationSchema.statics.createLevelUp = function (toPlayerId, newLevel, rewards) {
  return new this({
    toPlayerId,
    type: "level_up",
    message: `مبروك! وصلت إلى المستوى ${newLevel}`,
    from: "system",
    fromNickname: "النظام",
    priority: "high",
    data: { newLevel, rewards },
    isPinned: true,
  });
};

// إنشاء إشعار مكافأة مهمة
notificationSchema.statics.createMissionClaimed = function (toPlayerId, missionName, xpGained, coinsGained) {
  return new this({
    toPlayerId,
    type: "mission_claimed",
    message: `استلمت مكافأة المهمة: ${missionName}`,
    from: "system",
    fromNickname: "النظام",
    priority: "medium",
    data: { missionName, xpGained, coinsGained },
  });
};

// إنشاء إشعار إعلان مطور
notificationSchema.statics.createDevAnnouncement = function (toPlayerId, message, fromPlayerId, fromNickname) {
  return new this({
    toPlayerId,
    type: "dev_announcement",
    message: message,
    from: fromPlayerId || "system",
    fromNickname: fromNickname || "المطور",
    priority: "high",
    data: { fromDev: true },
    isPinned: true,
  });
};

// إنشاء إشعار حظر
notificationSchema.statics.createBlocked = function (toPlayerId, fromPlayerId, fromNickname) {
  return new this({
    toPlayerId,
    type: "blocked",
    message: `${fromNickname} قام بحظرك`,
    from: fromPlayerId,
    fromNickname,
    priority: "high",
    data: { fromPlayerId, fromNickname },
  });
};

// إنشاء إشعار شراء
notificationSchema.statics.createPurchase = function (toPlayerId, itemName, itemType, price) {
  return new this({
    toPlayerId,
    type: "purchase_confirmed",
    message: `تم شراء ${itemName} بنجاح`,
    from: "system",
    fromNickname: "النظام",
    priority: "medium",
    data: { itemName, itemType, price },
  });
};

// ===================== دوال ثابتة إضافية =====================

// جلب عدد الإشعارات غير المقروءة لكل لاعب (للوحة الإدارة)
notificationSchema.statics.getUnreadStats = async function () {
  return this.aggregate([
    { $match: { isRead: false } },
    { $group: { _id: "$toPlayerId", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]);
};

// جلب أنواع الإشعارات الأكثر استخداماً
notificationSchema.statics.getTypeStats = async function () {
  return this.aggregate([
    { $group: { _id: "$type", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);
};

// حذف الإشعارات المنتهية (expiresAt)
notificationSchema.statics.cleanExpired = async function () {
  const now = new Date();
  return this.deleteMany({
    expiresAt: { $lt: now, $ne: null },
  });
};

// ===================== الفهارس =====================

// فهرس مركب للبحث السريع
notificationSchema.index({ toPlayerId: 1, createdAt: -1 });
notificationSchema.index({ toPlayerId: 1, isRead: 1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Notification", notificationSchema);
