const mongoose = require("mongoose");

const cardSkinSchema = new mongoose.Schema(
  {
    // المعرف الفريد للحزمة
    id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // اسم الحزمة
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    // CSS المخصص للبطاقة
    css: {
      type: String,
      required: true,
      trim: true,
    },

    // السعر (عملات)
    price: {
      type: Number,
      required: true,
      min: 100,
    },

    // الندرة
    rarity: {
      type: String,
      enum: ["common", "rare", "epic", "legendary", "mythic"],
      default: "rare",
    },

    // اسم الندرة بالعربية
    rarityAr: {
      type: String,
      default: "نادر",
    },

    // ترتيب الندرة (للعرض)
    rarityOrder: {
      type: Number,
      default: 2,
    },

    // الحالة
    isActive: {
      type: Boolean,
      default: true,
    },

    // منشئ الحزمة (مطور)
    createdBy: {
      type: String,
      default: "system",
    },

    // عدد المستخدمين الذين يمتلكون الحزمة (للإحصائيات)
    ownedCount: {
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

// فهرس للبحث السريع
cardSkinSchema.index({ rarity: 1, isActive: 1 });
cardSkinSchema.index({ price: 1 });
cardSkinSchema.index({ createdAt: -1 });

// ===================== دوال مساعدة =====================

// الحصول على ترتيب الندرة للعرض
cardSkinSchema.methods.getRarityOrder = function () {
  const rarityMap = {
    common: 0,
    rare: 1,
    epic: 2,
    legendary: 3,
    mythic: 4,
  };
  return rarityMap[this.rarity] || 0;
};

// الحصول على لون الندرة (للواجهة)
cardSkinSchema.methods.getRarityColor = function () {
  const rarityColors = {
    common: "#8d8d8d",
    rare: "#4fc3f7",
    epic: "#ce93d8",
    legendary: "#ffa726",
    mythic: "#ff6b6b",
  };
  return rarityColors[this.rarity] || "#8d8d8d";
};

// الحصول على اسم الندرة بالعربية
cardSkinSchema.methods.getRarityAr = function () {
  const rarityNames = {
    common: "عادي",
    rare: "نادر",
    epic: "فائق",
    legendary: "أسطوري",
    mythic: "خارق",
  };
  return this.rarityAr || rarityNames[this.rarity] || "نادر";
};

// التحقق من أن الحزمة متاحة للشراء
cardSkinSchema.methods.isAvailable = function () {
  return this.isActive;
};

// زيادة عدد المالكين
cardSkinSchema.methods.incrementOwned = function () {
  this.ownedCount += 1;
  return this.save();
};

// ===================== دوال ثابتة =====================

// جلب الحزم النشطة
cardSkinSchema.statics.getActiveSkins = function () {
  return this.find({ isActive: true }).sort({ rarityOrder: 1, price: 1 });
};

// جلب الحزم حسب الندرة
cardSkinSchema.statics.getByRarity = function (rarity) {
  return this.find({ rarity, isActive: true }).sort({ price: 1 });
};

// جلب الحزم ضمن نطاق سعري
cardSkinSchema.statics.getByPriceRange = function (minPrice, maxPrice) {
  return this.find({
    isActive: true,
    price: { $gte: minPrice, $lte: maxPrice },
  }).sort({ price: 1 });
};

// جلب الحزم الأكثر ملكية
cardSkinSchema.statics.getMostOwned = function (limit = 10) {
  return this.find({ isActive: true })
    .sort({ ownedCount: -1 })
    .limit(limit);
};

// جلب الحزم الأحدث
cardSkinSchema.statics.getLatest = function (limit = 10) {
  return this.find({ isActive: true })
    .sort({ createdAt: -1 })
    .limit(limit);
};

// جلب إحصائيات الحزم
cardSkinSchema.statics.getStats = async function () {
  const total = await this.countDocuments();
  const active = await this.countDocuments({ isActive: true });

  const byRarity = await this.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: "$rarity", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const avgPrice = await this.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: null, avg: { $avg: "$price" } } },
  ]);

  const totalOwned = await this.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: null, total: { $sum: "$ownedCount" } } },
  ]);

  return {
    total,
    active,
    byRarity: byRarity.map((item) => ({
      rarity: item._id,
      count: item.count,
    })),
    averagePrice: avgPrice[0]?.avg || 0,
    totalOwned: totalOwned[0]?.total || 0,
  };
};

// ===================== دوال المصانع (Factories) =====================

// إنشاء حزمة جديدة بقيم افتراضية
cardSkinSchema.statics.createSkin = function (data) {
  const defaults = {
    isActive: true,
    createdBy: "system",
  };

  const skinData = { ...defaults, ...data };

  // تعيين rarityAr تلقائياً إذا لم يتم توفيره
  if (!skinData.rarityAr) {
    const rarityNames = {
      common: "عادي",
      rare: "نادر",
      epic: "فائق",
      legendary: "أسطوري",
      mythic: "خارق",
    };
    skinData.rarityAr = rarityNames[skinData.rarity] || "نادر";
  }

  // تعيين rarityOrder تلقائياً
  const rarityOrders = {
    common: 0,
    rare: 1,
    epic: 2,
    legendary: 3,
    mythic: 4,
  };
  skinData.rarityOrder = rarityOrders[skinData.rarity] || 1;

  return new this(skinData);
};

// ===================== تنبيهات (Hooks) =====================

// قبل الحفظ، تأكد من أن السعر أكبر من 0
cardSkinSchema.pre("save", function (next) {
  if (this.price < 100) {
    return next(new Error("السعر يجب أن يكون 100 عملة على الأقل"));
  }

  // تأكد من أن المعرف فريد
  if (!this.id || this.id.trim().length === 0) {
    return next(new Error("معرف الحزمة مطلوب"));
  }

  // تعيين rarityOrder إذا لم يتم تعيينه
  if (this.rarityOrder === undefined || this.rarityOrder === null) {
    const rarityOrders = {
      common: 0,
      rare: 1,
      epic: 2,
      legendary: 3,
      mythic: 4,
    };
    this.rarityOrder = rarityOrders[this.rarity] || 1;
  }

  next();
});

module.exports = mongoose.model("CardSkin", cardSkinSchema);
