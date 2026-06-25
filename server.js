require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

// استيراد المسارات
const authRoutes = require("./routes/auth");
const playerRoutes = require("./routes/players");
const clanRoutes = require("./routes/clans");
const missionRoutes = require("./routes/missions");
const marketRoutes = require("./routes/market");
const notificationRoutes = require("./routes/notifications");
const chatRoutes = require("./routes/chat");
const adminRoutes = require("./routes/admin");

// استيراد معالجات Socket
const gameHandler = require("./socket/gameHandler");

// ===================== الإعداد =====================
const app = express();
const server = http.createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "https://codenames.vercel.app";

// إعداد Socket.io
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"],
});

// متغير عالمي للغرف (في الذاكرة - سريع للعبة الحية)
const rooms = {};

// تمرير io و rooms لمعالجات Socket
gameHandler(io, rooms);

// تمرير io و rooms للـ routes
app.set("io", io);
app.set("rooms", rooms);

// ===================== Middleware =====================
app.use(
  cors({
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(morgan("combined"));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// ===================== المسارات =====================

// مسارات المصادقة
app.use("/api/auth", authRoutes);

// مسارات اللاعبين
app.use("/api/players", playerRoutes);

// مسارات الكلانات
app.use("/api/clans", clanRoutes);

// مسارات المهام
app.use("/api/missions", missionRoutes);

// مسارات السوق
app.use("/api/market", marketRoutes);

// مسارات الإشعارات
app.use("/api/notifications", notificationRoutes);

// مسارات الدردشة
app.use("/api/chat", chatRoutes);

// مسارات لوحة المطور (القائد)
app.use("/api/admin", adminRoutes);

// ===================== مسارات إضافية =====================

// مسار الصحة
app.get("/api/health", (req, res) => {
  const activeRooms = Object.keys(rooms).length;
  const totalPlayers = Object.values(rooms).reduce(
    (sum, room) => sum + (room.players?.length || 0),
    0
  );

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    serverTime: new Date().toLocaleString("ar-EG"),
    activeRooms,
    totalPlayers,
    rooms: Object.values(rooms).map((r) => ({
      code: r.code,
      name: r.name,
      players: r.players?.length || 0,
      spectators: r.spectators?.length || 0,
      status: r.status,
      mode: r.settings?.mode || "classic",
      isPrivate: r.isPrivate || false,
    })),
  });
});

// مسار قائمة الغرف (HTTP - بديل للـ Socket)
app.get("/api/rooms", (req, res) => {
  const roomsList = Object.values(rooms).map((r) => ({
    code: r.code,
    name: r.name,
    players: r.players?.length || 0,
    maxPlayers: r.maxPlayers || 8,
    mode: r.settings?.mode || "classic",
    status: r.status || "waiting",
    hasPassword: !!r.password,
    isPrivate: r.isPrivate || false,
    spectators: r.spectators?.length || 0,
    cardCount: r.settings?.cardCount || 25,
    createdBy: r.createdBy || null,
  }));

  res.json(roomsList);
});

// مسار معلومات السيرفر
app.get("/api/info", (req, res) => {
  res.json({
    name: "Codenames Classic Server",
    version: "2.0.0",
    environment: process.env.NODE_ENV || "development",
    features: {
      rooms: true,
      clans: true,
      missions: true,
      market: true,
      friends: true,
      blockList: true,
      soloMode: true,
      classicMode: true,
      reconnection: true,
      voiceChat: false,
    },
    limits: {
      maxRooms: 1000,
      maxPlayersPerRoom: 8,
      maxClanMembers: 100,
      maxFriends: 50,
    },
  });
});

// ===================== معالجة الأخطاء =====================

// معالجة الأخطاء 404
app.use((req, res) => {
  res.status(404).json({
    error: "المسار غير موجود",
    path: req.originalUrl,
    method: req.method,
  });
});

// معالجة الأخطاء العامة
app.use((err, req, res, next) => {
  console.error("خطأ غير متوقع:", err.stack);

  // أخطاء MongoDB
  if (err.name === "MongoServerError") {
    return res.status(400).json({
      error: "خطأ في قاعدة البيانات",
      details: err.message,
    });
  }

  // أخطاء التحقق
  if (err.name === "ValidationError") {
    return res.status(400).json({
      error: "بيانات غير صالحة",
      details: err.message,
    });
  }

  // أخطاء JWT
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      error: "توكن غير صالح",
    });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      error: "انتهت صلاحية التوكن",
    });
  }

  res.status(500).json({
    error: "خطأ داخلي في الخادم",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// ===================== الاتصال بقاعدة البيانات والبدء =====================

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("خطأ: MONGODB_URI غير موجود في ملف .env");
  process.exit(1);
}

// إعدادات الاتصال بقاعدة البيانات
const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4, // استخدام IPv4
};

mongoose
  .connect(MONGODB_URI, mongooseOptions)
  .then(() => {
    console.log("تم الاتصال بقاعدة البيانات MongoDB");

    // بدء السيرفر
    server.listen(PORT, () => {
      console.log(`السيرفر يعمل على المنفذ ${PORT}`);
      console.log(`رابط الصحة: http://localhost:${PORT}/api/health`);
      console.log(`رابط الغرف: http://localhost:${PORT}/api/rooms`);
      console.log(`بيئة التشغيل: ${process.env.NODE_ENV || "development"}`);
      console.log("Codenames Classic Server جاهز!");
    });
  })
  .catch((err) => {
    console.error("خطأ في الاتصال بقاعدة البيانات:", err.message);

    // محاولة إعادة الاتصال بعد 5 ثوانٍ
    setTimeout(() => {
      console.log("جاري محاولة إعادة الاتصال بقاعدة البيانات...");
      mongoose
        .connect(MONGODB_URI, mongooseOptions)
        .then(() => {
          console.log("تم إعادة الاتصال بقاعدة البيانات");
        })
        .catch((e) => {
          console.error("فشلت إعادة الاتصال:", e.message);
          process.exit(1);
        });
    }, 5000);
  });

// ===================== إيقاف نظيف =====================

// إشارة SIGTERM (من Render/Heroku)
process.on("SIGTERM", async () => {
  console.log("جاري إيقاف الخادم (SIGTERM)...");

  // إغلاق جميع الغرف النشطة
  const roomCodes = Object.keys(rooms);
  for (const code of roomCodes) {
    const room = rooms[code];
    io.to(code).emit("server_shutdown", {
      message: "سيتم إيقاف السيرفر، جاري حفظ حالة اللعبة...",
    });
    // تنظيف الغرفة
    delete rooms[code];
  }

  // إغلاق اتصالات Socket
  io.close(() => {
    console.log("تم إغلاق اتصالات Socket");
  });

  // إغلاق قاعدة البيانات
  await mongoose.connection.close();
  console.log("تم إغلاق قاعدة البيانات");

  // إغلاق السيرفر
  server.close(() => {
    console.log("تم إيقاف الخادم");
    process.exit(0);
  });
});

// إشارة SIGINT (Ctrl+C)
process.on("SIGINT", async () => {
  console.log("جاري إيقاف الخادم (SIGINT)...");
  process.exit(0);
});

// ===================== استثناءات غير معالجة =====================

process.on("uncaughtException", (err) => {
  console.error("استثناء غير معالج:", err);
  // لا نغلق السيرفر، نستمر في العمل
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("رفض غير معالج:", reason);
  // لا نغلق السيرفر، نستمر في العمل
});

// ===================== تصدير التطبيق (للاستخدام في الاختبارات) =====================

module.exports = { app, server, io, rooms };
