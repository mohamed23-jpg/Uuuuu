const jwt = require("jsonwebtoken");
const Player = require("../models/Player");

// التحقق من التوكن
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "غير مصرح" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const player = await Player.findById(decoded.id).select("-__v");
    if (!player) return res.status(401).json({ error: "اللاعب غير موجود" });

    req.player = player;
    next();
  } catch {
    return res.status(401).json({ error: "توكن غير صالح" });
  }
};

// التحقق من صلاحيات المطور
const devMiddleware = async (req, res, next) => {
  if (!req.player?.isDev) {
    return res.status(403).json({ error: "صلاحيات المطور مطلوبة" });
  }
  next();
};

module.exports = { authMiddleware, devMiddleware };
