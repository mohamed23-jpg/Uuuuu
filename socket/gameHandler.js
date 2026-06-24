const Player = require("../models/Player");
const ARABIC_WORDS = require("../data/arabicWords");

// توليد كود غرفة عشوائي من 6 أحرف
const generateRoomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};

// اختيار كلمات عشوائية
const pickWords = (count) => {
  const shuffled = [...ARABIC_WORDS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
};

// توزيع الألوان للبطاقات
const assignColors = (count) => {
  let red, blue, neutral, black;
  if (count === 25) { red = 9; blue = 8; neutral = 7; black = 1; }
  else if (count === 16) { red = 5; blue = 5; neutral = 5; black = 1; }
  else { red = 4; blue = 4; neutral = 3; black = 1; }

  const colors = [
    ...Array(red).fill("red"),
    ...Array(blue).fill("blue"),
    ...Array(neutral).fill("neutral"),
    ...Array(black).fill("black"),
  ];
  return colors.sort(() => Math.random() - 0.5);
};

// إنشاء حالة لعبة جديدة
const createGameState = (room) => {
  const count = room.settings.cardCount || 25;
  const words = pickWords(count);
  const colors = assignColors(count);

  return {
    cards: words.map((word, i) => ({
      id: i,
      word,
      color: colors[i],
      revealed: false,
    })),
    currentTurn: "red", // يبدأ الأحمر
    currentPhase: "hint", // hint | guess
    hint: null,
    hintCount: null,
    guessesLeft: 0,
    log: [],
    status: "playing", // playing | red_win | blue_win
    startedAt: new Date(),
  };
};

module.exports = (io, rooms) => {
  io.on("connection", (socket) => {
    // ربط اللاعب بالـ socket
    socket.on("player_connect", async ({ playerId, token }) => {
      try {
        const player = await Player.findOne({ playerId });
        if (!player) return;

        player.socketId = socket.id;
        player.isOnline = true;
        player.lastSeen = new Date();
        await player.save();

        socket.playerId = playerId;
        socket.playerNickname = player.nickname;
        socket.emit("connected", { playerId, socketId: socket.id });
      } catch (err) {
        console.error("خطأ في ربط اللاعب:", err);
      }
    });

    // ================== الغرف ==================

    // إنشاء غرفة
    socket.on("create_room", async (data, callback) => {
      try {
        const { name, password, cardCount, mode, playerData } = data;

        let code;
        do { code = generateRoomCode(); } while (rooms[code]);

        const room = {
          code,
          name: name || `غرفة ${code}`,
          password: password || null,
          settings: { cardCount: cardCount || 25, mode: mode || "classic" },
          players: [],
          spectators: [],
          teams: { red: { spymaster: null, operatives: [] }, blue: { spymaster: null, operatives: [] } },
          game: null,
          status: "waiting", // waiting | playing | finished
          createdBy: playerData?.playerId,
          createdAt: new Date(),
          maxPlayers: 8,
        };

        rooms[code] = room;

        // انضمام المنشئ
        socket.join(code);
        socket.roomCode = code;

        const playerInRoom = {
          socketId: socket.id,
          playerId: playerData?.playerId,
          nickname: playerData?.nickname,
          avatar: playerData?.avatar,
          level: playerData?.level || 1,
          isDev: playerData?.isDev || false,
          team: null,
          role: null,
        };

        room.players.push(playerInRoom);

        // تحديث قاعدة البيانات
        if (playerData?.playerId) {
          await Player.findOneAndUpdate(
            { playerId: playerData.playerId },
            { currentRoom: code }
          );
        }

        // بث قائمة الغرف
        io.emit("rooms_update", getRoomsList(rooms));

        callback({ success: true, room: sanitizeRoom(room) });
      } catch (err) {
        callback({ success: false, error: "فشل إنشاء الغرفة" });
      }
    });

    // الانضمام لغرفة
    socket.on("join_room", async (data, callback) => {
      try {
        const { code, password, playerData, asSpectator } = data;
        const room = rooms[code];

        if (!room) return callback({ success: false, error: "الغرفة غير موجودة" });
        if (room.password && room.password !== password) {
          return callback({ success: false, error: "كلمة المرور خاطئة" });
        }

        // التحقق من الإشعار الذهبي (مستوى 98+)
        if (playerData?.level >= 98) {
          io.to(code).emit("legendary_join", {
            nickname: playerData.nickname,
            avatar: playerData.avatar,
            level: playerData.level,
          });
        }

        // إشعار دخول المطور
        if (playerData?.isDev) {
          io.to(code).emit("dev_join", {
            nickname: playerData.nickname,
          });
        }

        socket.join(code);
        socket.roomCode = code;

        const playerInRoom = {
          socketId: socket.id,
          playerId: playerData?.playerId,
          nickname: playerData?.nickname,
          avatar: playerData?.avatar,
          level: playerData?.level || 1,
          isDev: playerData?.isDev || false,
          team: null,
          role: asSpectator ? "spectator" : null,
        };

        if (asSpectator) {
          room.spectators.push(playerInRoom);
        } else {
          room.players.push(playerInRoom);
        }

        if (playerData?.playerId) {
          await Player.findOneAndUpdate(
            { playerId: playerData.playerId },
            { currentRoom: code }
          );
        }

        io.to(code).emit("room_update", sanitizeRoom(room));
        io.to(code).emit("player_joined", {
          nickname: playerData?.nickname,
          avatar: playerData?.avatar,
        });

        io.emit("rooms_update", getRoomsList(rooms));
        callback({ success: true, room: sanitizeRoom(room) });
      } catch (err) {
        callback({ success: false, error: "فشل الانضمام" });
      }
    });

    // اختيار الفريق والدور
    socket.on("select_team_role", ({ team, role }, callback) => {
      const room = rooms[socket.roomCode];
      if (!room) return callback({ success: false, error: "الغرفة غير موجودة" });

      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) return callback({ success: false, error: "اللاعب غير موجود في الغرفة" });

      if (role === "spymaster") {
        if (room.teams[team].spymaster) {
          return callback({ success: false, error: "دور البوص مأخوذ" });
        }
        // إزالة من الدور القديم
        if (player.team && player.role === "spymaster") {
          room.teams[player.team].spymaster = null;
        }
        room.teams[team].spymaster = { socketId: socket.id, nickname: player.nickname };
      } else {
        if (player.team && player.role === "spymaster") {
          room.teams[player.team].spymaster = null;
        }
        if (player.team) {
          room.teams[player.team].operatives = room.teams[player.team].operatives.filter(
            (o) => o.socketId !== socket.id
          );
        }
        room.teams[team].operatives.push({ socketId: socket.id, nickname: player.nickname });
      }

      player.team = team;
      player.role = role;

      io.to(socket.roomCode).emit("room_update", sanitizeRoom(room));
      callback({ success: true });
    });

    // بدء اللعبة
    socket.on("start_game", (callback) => {
      const room = rooms[socket.roomCode];
      if (!room) return callback?.({ success: false, error: "الغرفة غير موجودة" });

      if (room.createdBy !== socket.playerId && !room.players.find(p => p.socketId === socket.id && p.isDev)) {
        return callback?.({ success: false, error: "فقط منشئ الغرفة يمكنه بدء اللعبة" });
      }

      const { red, blue } = room.teams;
      if (!red.spymaster || !blue.spymaster) {
        return callback?.({ success: false, error: "كل فريق يحتاج بوصاً" });
      }
      if (red.operatives.length === 0 || blue.operatives.length === 0) {
        return callback?.({ success: false, error: "كل فريق يحتاج عميلاً على الأقل" });
      }

      room.game = createGameState(room);
      room.status = "playing";

      // إرسال حالة اللعبة - البوص يرى الألوان الحقيقية
      const redSpymasterSocket = red.spymaster.socketId;
      const blueSpymasterSocket = blue.spymaster.socketId;

      io.to(socket.roomCode).emit("game_started", {
        game: sanitizeGameForOperatives(room.game),
        teams: room.teams,
      });

      // إرسال الألوان للبوصين فقط
      if (redSpymasterSocket) {
        io.to(redSpymasterSocket).emit("spymaster_view", { cards: room.game.cards });
      }
      if (blueSpymasterSocket) {
        io.to(blueSpymasterSocket).emit("spymaster_view", { cards: room.game.cards });
      }

      io.emit("rooms_update", getRoomsList(rooms));
      callback?.({ success: true });
    });

    // إرسال تلميح (البوص فقط)
    socket.on("send_hint", ({ word, count }, callback) => {
      const room = rooms[socket.roomCode];
      if (!room || !room.game) return callback?.({ success: false, error: "اللعبة غير موجودة" });

      const game = room.game;
      if (game.status !== "playing") return;

      // تحقق من أن المرسل هو البوص الصحيح
      const team = game.currentTurn;
      const spymaster = room.teams[team].spymaster;
      if (!spymaster || spymaster.socketId !== socket.id) {
        return callback?.({ success: false, error: "فقط البوص يمكنه إرسال تلميح" });
      }

      if (game.currentPhase !== "hint") {
        return callback?.({ success: false, error: "ليس وقت التلميح" });
      }

      // تحقق من أن الكلمة غير موجودة على البطاقات
      const wordOnBoard = game.cards.some(
        (c) => c.word.toLowerCase() === word.toLowerCase()
      );
      if (wordOnBoard) {
        return callback?.({ success: false, error: "الكلمة موجودة على البطاقات" });
      }

      const hintCount = parseInt(count);
      if (isNaN(hintCount) || hintCount < 1 || hintCount > 9) {
        return callback?.({ success: false, error: "رقم التلميح غير صالح" });
      }

      game.hint = word;
      game.hintCount = hintCount;
      game.guessesLeft = hintCount + 1;
      game.currentPhase = "guess";

      const logEntry = {
        type: "hint",
        team,
        text: `${socket.playerNickname} أعطى تلميح: "${word}" - ${hintCount}`,
        timestamp: new Date(),
      };
      game.log.push(logEntry);

      io.to(socket.roomCode).emit("hint_sent", {
        hint: word,
        count: hintCount,
        team,
        nickname: socket.playerNickname,
      });
      io.to(socket.roomCode).emit("game_update", sanitizeGameForOperatives(game));

      // تحديث إحصائية التلميحات
      Player.findOneAndUpdate(
        { playerId: socket.playerId },
        {
          $inc: {
            "stats.hintsGiven": 1,
            "missions.daily.hints": 1,
          },
        }
      ).catch(() => {});

      callback?.({ success: true });
    });

    // اختيار بطاقة (العميل فقط)
    socket.on("select_card", async ({ cardId }, callback) => {
      const room = rooms[socket.roomCode];
      if (!room || !room.game) return callback?.({ success: false, error: "اللعبة غير موجودة" });

      const game = room.game;
      if (game.status !== "playing") return;
      if (game.currentPhase !== "guess") {
        return callback?.({ success: false, error: "ليس وقت التخمين" });
      }

      const card = game.cards.find((c) => c.id === cardId);
      if (!card || card.revealed) {
        return callback?.({ success: false, error: "البطاقة غير صالحة أو مكشوفة" });
      }

      card.revealed = true;
      const team = game.currentTurn;

      let eventType, nextTurn;

      if (card.color === "black") {
        // خسارة فورية
        game.status = team === "red" ? "blue_win" : "red_win";
        eventType = "black_card";
      } else if (card.color === team) {
        // بطاقة صحيحة
        game.guessesLeft -= 1;
        eventType = "correct_guess";

        // تحقق من الفوز
        const remaining = game.cards.filter((c) => c.color === team && !c.revealed).length;
        if (remaining === 0) {
          game.status = `${team}_win`;
        }
      } else {
        // بطاقة خاطئة - الدور ينتهي
        game.guessesLeft = 0;
        eventType = "wrong_guess";
      }

      const logEntry = {
        type: eventType,
        team,
        cardWord: card.word,
        cardColor: card.color,
        player: socket.playerNickname,
        timestamp: new Date(),
      };
      game.log.push(logEntry);

      // انتهاء الدور
      if (game.status === "playing" && (game.guessesLeft <= 0 || eventType === "wrong_guess")) {
        game.currentTurn = team === "red" ? "blue" : "red";
        game.currentPhase = "hint";
        game.hint = null;
        game.hintCount = null;
      }

      io.to(socket.roomCode).emit("card_revealed", {
        cardId,
        word: card.word,
        color: card.color,
        eventType,
        team,
        player: socket.playerNickname,
      });

      if (game.status === "playing") {
        io.to(socket.roomCode).emit("game_update", sanitizeGameForOperatives(game));
      } else {
        io.to(socket.roomCode).emit("game_over", {
          status: game.status,
          cards: game.cards, // كشف كل البطاقات
          log: game.log,
        });

        room.status = "finished";

        // تحديث إحصائيات اللاعبين
        const winTeam = game.status.replace("_win", "");
        for (const player of room.players) {
          const isWinner = player.team === winTeam;
          const isSpymaster = player.role === "spymaster";

          const update = {
            $inc: {
              "stats.gamesPlayed": 1,
              ...(isWinner && { "stats.gamesWon": 1 }),
              ...(isSpymaster && { "stats.gamesAsSpymaster": 1 }),
              ...(isSpymaster && isWinner && { "stats.winsAsSpymaster": 1 }),
              ...(isWinner && { "missions.daily.wins": 1, "missions.weekly.wins": 1 }),
              ...(isSpymaster && isWinner && { "missions.weekly.spymasterWins": 1 }),
            },
          };

          if (player.playerId) {
            Player.findOneAndUpdate({ playerId: player.playerId }, update).catch(() => {});
          }
        }
      }

      // تحديث إحصائية التخمين الصحيح
      if (eventType === "correct_guess" && socket.playerId) {
        Player.findOneAndUpdate(
          { playerId: socket.playerId },
          { $inc: { "stats.correctGuesses": 1, "missions.daily.correctGuesses": 1 } }
        ).catch(() => {});
      }

      callback?.({ success: true });
    });

    // إنهاء الدور يدوياً
    socket.on("end_turn", (callback) => {
      const room = rooms[socket.roomCode];
      if (!room || !room.game) return;

      const game = room.game;
      const team = game.currentTurn;

      if (game.currentPhase !== "guess") {
        return callback?.({ success: false, error: "ليس وقت التخمين" });
      }

      game.currentTurn = team === "red" ? "blue" : "red";
      game.currentPhase = "hint";
      game.hint = null;
      game.hintCount = null;
      game.guessesLeft = 0;

      game.log.push({
        type: "turn_end",
        team,
        text: `${socket.playerNickname} أنهى دور فريق ${team === "red" ? "الأحمر" : "الأزرق"}`,
        timestamp: new Date(),
      });

      io.to(socket.roomCode).emit("turn_changed", {
        newTurn: game.currentTurn,
        game: sanitizeGameForOperatives(game),
      });

      callback?.({ success: true });
    });

    // الدردشة داخل الغرفة
    socket.on("room_chat", ({ message, channel }, callback) => {
      const room = rooms[socket.roomCode];
      if (!room) return;

      const BAD_WORDS = ["كلمة1", "كلمة2"];
      let filtered = message;
      BAD_WORDS.forEach((w) => {
        filtered = filtered.replace(new RegExp(w, "gi"), "***");
      });

      const player = room.players.find((p) => p.socketId === socket.id);

      const chatData = {
        from: socket.playerNickname,
        fromPlayerId: socket.playerId,
        avatar: player?.avatar,
        message: filtered,
        channel: channel || "all",
        team: player?.team,
        timestamp: new Date(),
      };

      if (channel === "team" && player?.team) {
        // إرسال لأعضاء الفريق فقط
        const teamPlayers = room.players
          .filter((p) => p.team === player.team)
          .map((p) => p.socketId);
        teamPlayers.forEach((sid) => io.to(sid).emit("room_chat", chatData));
      } else {
        io.to(socket.roomCode).emit("room_chat", chatData);
      }

      callback?.({ success: true });
    });

    // إعادة الاتصال
    socket.on("reconnect_room", async ({ code, playerId }, callback) => {
      const room = rooms[code];
      if (!room) return callback?.({ success: false, error: "الغرفة لم تعد موجودة" });

      if (room.status !== "playing") {
        return callback?.({ success: false, error: "اللعبة انتهت" });
      }

      // تحديث socket ID
      const player = room.players.find((p) => p.playerId === playerId);
      if (player) {
        player.socketId = socket.id;
        socket.join(code);
        socket.roomCode = code;
        socket.playerId = playerId;

        io.to(code).emit("player_reconnected", { nickname: player.nickname });

        callback?.({
          success: true,
          room: sanitizeRoom(room),
          game: room.game ? sanitizeGameForOperatives(room.game) : null,
          isSpymaster: player.role === "spymaster",
          spymasterCards: player.role === "spymaster" ? room.game?.cards : null,
        });
      } else {
        callback?.({ success: false, error: "أنت لست في هذه الغرفة" });
      }
    });

    // دعوة صديق للغرفة
    socket.on("invite_to_room", async (data) => {
      await handleInviteToRoom(socket, io, data);
    });

    // مغادرة الغرفة
    socket.on("leave_room", async () => {
      await handleLeave(socket, rooms, io);
    });

    // انقطاع الاتصال
    socket.on("disconnect", async () => {
      try {
        await Player.findOneAndUpdate(
          { socketId: socket.id },
          { isOnline: false, lastSeen: new Date(), socketId: null, currentRoom: null }
        );
        await handleLeave(socket, rooms, io, true);
      } catch {}
    });
  });
};

// دعوة صديق لغرفة
async function handleInviteToRoom(socket, io, data) {
  try {
    const { targetPlayerId } = data;
    if (!socket.roomCode || !targetPlayerId) return;

    const target = await Player.findOne({ playerId: targetPlayerId });
    if (!target || !target.socketId) return;

    const inviter = await Player.findOne({ playerId: socket.playerId });
    if (!inviter) return;

    io.to(target.socketId).emit("room_invite", {
      fromPlayerId: socket.playerId,
      fromNickname: inviter.nickname,
      roomCode: socket.roomCode,
      roomName: data.roomName || `غرفة ${socket.roomCode}`,
    });
  } catch (err) {
    console.error("خطأ في الدعوة:", err);
  }
}

// دالة مغادرة الغرفة
async function handleLeave(socket, rooms, io, isDisconnect = false) {
  const code = socket.roomCode;
  if (!code || !rooms[code]) return;

  const room = rooms[code];

  // إزالة من قائمة اللاعبين
  room.players = room.players.filter((p) => p.socketId !== socket.id);
  room.spectators = room.spectators.filter((p) => p.socketId !== socket.id);

  // إزالة من الفرق
  for (const team of ["red", "blue"]) {
    if (room.teams[team].spymaster?.socketId === socket.id) {
      room.teams[team].spymaster = null;
    }
    room.teams[team].operatives = room.teams[team].operatives.filter(
      (o) => o.socketId !== socket.id
    );
  }

  if (socket.playerId) {
    await Player.findOneAndUpdate(
      { playerId: socket.playerId },
      { currentRoom: null }
    ).catch(() => {});
  }

  if (room.players.length === 0 && room.spectators.length === 0) {
    delete rooms[code];
  } else {
    io.to(code).emit("player_left", { socketId: socket.id, nickname: socket.playerNickname });
    io.to(code).emit("room_update", sanitizeRoom(room));
  }

  io.emit("rooms_update", getRoomsList(rooms));
  socket.leave(code);
}

// قائمة الغرف للعرض
function getRoomsList(rooms) {
  return Object.values(rooms).map((r) => ({
    code: r.code,
    name: r.name,
    players: r.players.length,
    maxPlayers: r.maxPlayers,
    mode: r.settings.mode,
    status: r.status,
    hasPassword: !!r.password,
    spectators: r.spectators.length,
  }));
}

// تنظيف بيانات الغرفة للعملاء (بدون كلمات المرور)
function sanitizeRoom(room) {
  return {
    code: room.code,
    name: room.name,
    settings: room.settings,
    players: room.players,
    spectators: room.spectators,
    teams: room.teams,
    status: room.status,
    createdBy: room.createdBy,
    hasGame: !!room.game,
  };
}

// إخفاء ألوان البطاقات عن العملاء
function sanitizeGameForOperatives(game) {
  return {
    ...game,
    cards: game.cards.map((c) => ({
      ...c,
      color: c.revealed ? c.color : "hidden",
    })),
  };
}
