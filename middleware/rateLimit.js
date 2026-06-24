const rateLimit = require("express-rate-limit");

// حد معدل الطلبات العام
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 200,
  message: { error: "طلبات كثيرة جداً، حاول بعد قليل" },
  standardHeaders: true,
  legacyHeaders: false,
});

// حد معدل التسجيل
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // ساعة
  max: 20,
  message: { error: "محاولات تسجيل كثيرة جداً" },
  standardHeaders: true,
  legacyHeaders: false,
});

// حد معدل الدردشة
const chatLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 ثواني
  max: 10,
  message: { error: "رسائل كثيرة جداً" },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { generalLimiter, authLimiter, chatLimiter };
