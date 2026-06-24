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

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

// إعداد Socket.io
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 30000,
  pingInterval: 10000,
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

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ===================== المسارات =====================
app.use("/api/auth", authRoutes);
app.use("/api/players", playerRoutes);
app.use("/api/clans", clanRoutes);
app.use("/api/missions", missionRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/admin", adminRoutes);

// مسار الصحة
app.get("/api/health", (req, res) => {
  const activeRooms = Object.keys(rooms).length;
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    activeRooms,
    rooms: Object.values(rooms).map((r) => ({
      code: r.code,
      name: r.name,
      players: r.players.length,
      status: r.status,
    })),
  });
});

// مسار قائمة الغرف (HTTP - بديل للـ Socket)
app.get("/api/rooms", (req, res) => {
  const roomsList = Object.values(rooms).map((r) => ({
    code: r.code,
    name: r.name,
    players: r.players.length,
    maxPlayers: r.maxPlayers,
    mode: r.settings?.mode,
    status: r.status,
    hasPassword: !!r.password,
    spectators: r.spectators.length,
    cardCount: r.settings?.cardCount,
  }));
  res.json(roomsList);
});

// معالجة الأخطاء 404
app.use((req, res) => {
  res.status(404).json({ error: "المسار غير موجود" });
});

// معالجة الأخطاء العامة
app.use((err, req, res, next) => {
  console.error("خطأ غير متوقع:", err);
  res.status(500).json({ error: "خطأ داخلي في الخادم" });
});

// ===================== الاتصال بقاعدة البيانات والبدء =====================
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("خطأ: MONGODB_URI غير موجود في ملف .env");
  process.exit(1);
}

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log("✅ تم الاتصال بقاعدة البيانات MongoDB");
    server.listen(PORT, () => {
      console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
      console.log(`🌐 رابط الصحة: http://localhost:${PORT}/api/health`);
      console.log(`🎮 Codenames Classic Server جاهز!`);
    });
  })
  .catch((err) => {
    console.error("خطأ في الاتصال بقاعدة البيانات:", err.message);
    process.exit(1);
  });

// إيقاف نظيف
process.on("SIGTERM", async () => {
  console.log("جاري إيقاف الخادم...");
  await mongoose.connection.close();
  server.close(() => {
    console.log("تم إيقاف الخادم");
    process.exit(0);
  });
});
