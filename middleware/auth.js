const jwt = require("jsonwebtoken");
const Player = require("../models/Player");

// ===================== التحقق من التوكن =====================
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "غير مصرح، التوكن مطلوب" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const player = await Player.findById(decoded.id).select("-__v -passwordHash");

    if (!player) {
      return res.status(401).json({ error: "اللاعب غير موجود" });
    }

    // التحقق من الحظر
    if (player.isBanned) {
      return res.status(403).json({
        error: "تم حظر هذا الحساب",
        reason: player.banReason || "مخالفة قواعد اللعب",
      });
    }

    req.player = player;
    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "توكن غير صالح" });
    }
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "انتهت صلاحية التوكن" });
    }
    console.error("خطأ في التحقق من التوكن:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
};

// ===================== التحقق من صلاحيات المطور =====================
const devMiddleware = (req, res, next) => {
  if (!req.player) {
    return res.status(401).json({ error: "غير مصرح" });
  }

  if (!req.player.isDev) {
    return res.status(403).json({ error: "صلاحيات المطور مطلوبة" });
  }

  next();
};

// ===================== التحقق من صلاحيات القائد (للكلانات) =====================
const leaderMiddleware = async (req, res, next) => {
  try {
    if (!req.player) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const { clanId } = req.params;
    const Clan = require("../models/Clan");

    const clan = await Clan.findById(clanId);
    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    if (clan.leaderId !== req.player.playerId) {
      return res.status(403).json({ error: "صلاحيات القائد مطلوبة" });
    }

    req.clan = clan;
    next();
  } catch (err) {
    console.error("خطأ في التحقق من صلاحيات القائد:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
};

// ===================== التحقق من عضوية الكلان =====================
const clanMemberMiddleware = async (req, res, next) => {
  try {
    if (!req.player) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const { clanId } = req.params;
    const Clan = require("../models/Clan");

    const clan = await Clan.findById(clanId);
    if (!clan) {
      return res.status(404).json({ error: "الكلان غير موجود" });
    }

    const isMember = clan.members.some((m) => m.playerId === req.player.playerId);
    if (!isMember) {
      return res.status(403).json({ error: "يجب أن تكون عضواً في الكلان" });
    }

    req.clan = clan;
    next();
  } catch (err) {
    console.error("خطأ في التحقق من عضوية الكلان:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
};

// ===================== التحقق من عدم الحظر =====================
const notBannedMiddleware = (req, res, next) => {
  if (req.player && req.player.isBanned) {
    return res.status(403).json({
      error: "تم حظر هذا الحساب",
      reason: req.player.banReason || "مخالفة قواعد اللعب",
    });
  }
  next();
};

module.exports = {
  authMiddleware,
  devMiddleware,
  leaderMiddleware,
  clanMemberMiddleware,
  notBannedMiddleware,
};
