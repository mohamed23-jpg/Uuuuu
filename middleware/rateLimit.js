const rateLimit = require("express-rate-limit");

// ===================== حد معدل الطلبات العام =====================
// يمنع الإرسال المفرط للطلبات من نفس الـ IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 200, // حد أقصى 200 طلب لكل IP
  message: {
    error: "طلبات كثيرة جداً، حاول بعد قليل",
    retryAfter: 900, // 15 دقيقة بالثواني
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // لا تخطي الطلبات الناجحة
});

// ===================== حد معدل التسجيل =====================
// يمنع إنشاء حسابات متعددة من نفس الـ IP
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // ساعة واحدة
  max: 10, // حد أقصى 10 محاولات تسجيل لكل IP
  message: {
    error: "محاولات تسجيل كثيرة جداً، حاول بعد ساعة",
    retryAfter: 3600,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // تخطي الطلبات الناجحة (التسجيل الناجح لا يُحتسب)
});

// ===================== حد معدل الدردشة العامة =====================
// يمنع الإرسال المفرط للرسائل في الدردشة العامة
const chatLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 ثواني
  max: 5, // حد أقصى 5 رسائل كل 10 ثواني
  message: {
    error: "رسائل كثيرة جداً، انتظر قليلاً",
    retryAfter: 10,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// ===================== حد معدل الرسائل الخاصة =====================
// يمنع الإرسال المفرط للرسائل الخاصة
const privateMessageLimiter = rateLimit({
  windowMs: 15 * 1000, // 15 ثانية
  max: 10, // حد أقصى 10 رسائل خاصة كل 15 ثانية
  message: {
    error: "رسائل خاصة كثيرة جداً، انتظر قليلاً",
    retryAfter: 15,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// ===================== حد معدل إرسال التلميحات =====================
// يمنع إرسال تلميحات بشكل مفرط في اللعبة
const hintLimiter = rateLimit({
  windowMs: 30 * 1000, // 30 ثانية
  max: 10, // حد أقصى 10 تلميحات كل 30 ثانية
  message: {
    error: "تلميحات كثيرة جداً، انتظر قليلاً",
    retryAfter: 30,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// ===================== حد معدل إنشاء الغرف =====================
// يمنع إنشاء غرف بشكل مفرط
const createRoomLimiter = rateLimit({
  windowMs: 60 * 1000, // دقيقة واحدة
  max: 5, // حد أقصى 5 غرف كل دقيقة
  message: {
    error: "محاولات إنشاء غرفة كثيرة جداً، انتظر قليلاً",
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// ===================== حد معدل الانضمام للغرف =====================
// يمنع محاولات الانضمام المفرطة للغرف
const joinRoomLimiter = rateLimit({
  windowMs: 30 * 1000, // 30 ثانية
  max: 15, // حد أقصى 15 محاولة انضمام كل 30 ثانية
  message: {
    error: "محاولات انضمام كثيرة جداً، انتظر قليلاً",
    retryAfter: 30,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// ===================== حد معدل الطلبات الحساسة =====================
// يستخدم للطلبات الحساسة مثل تغيير كلمة المرور أو الحظر
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 20, // حد أقصى 20 طلب حساس كل 15 دقيقة
  message: {
    error: "طلبات كثيرة جداً على هذا المسار، حاول بعد قليل",
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// ===================== حد معدل الإشعارات =====================
// يمنع إرسال إشعارات مفرطة
const notificationLimiter = rateLimit({
  windowMs: 60 * 1000, // دقيقة واحدة
  max: 30, // حد أقصى 30 إشعار كل دقيقة
  message: {
    error: "إشعارات كثيرة جداً، انتظر قليلاً",
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// ===================== حد معدل طلبات API العامة =====================
// يستخدم لحماية نقاط النهاية العامة
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // دقيقة واحدة
  max: 100, // حد أقصى 100 طلب لكل IP
  message: {
    error: "طلبات كثيرة جداً على الـ API، حاول بعد قليل",
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

module.exports = {
  generalLimiter,
  authLimiter,
  chatLimiter,
  privateMessageLimiter,
  hintLimiter,
  createRoomLimiter,
  joinRoomLimiter,
  sensitiveLimiter,
  notificationLimiter,
  apiLimiter,
};
