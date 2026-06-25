const Player = require("../models/Player");
const ARABIC_WORDS = require("../data/arabicWords");

// ===================== دوال مساعدة =====================
const generateRoomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};

const generatePrivateCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const pickWords = (count) => {
  const shuffled = [...ARABIC_WORDS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
};

// توزيع الألوان حسب الوضع والعدد
const assignColors = (count, mode) => {
  let red, blue, neutral, black;
  if (mode === "classic") {
    // كلاسيك: 25 بطاقة فقط
    red = 9; blue = 8; neutral = 7; black = 1;
  } else {
    // سولو
    if (count === 15) { blue = 5; red = 4; neutral = 5; black = 1; }
    else if (count === 20) { blue = 7; red = 6; neutral = 6; black = 1; }
    else { blue = 9; red = 8; neutral = 7; black = 1; }
  }
  const colors = [
    ...Array(red).fill("red"),
    ...Array(blue).fill("blue"),
    ...Array(neutral).fill("neutral"),
    ...Array(black).fill("black"),
  ];
  return colors.sort(() => Math.random() - 0.5);
};

const createGameState = (room) => {
  const count = room.settings.cardCount || 25;
  const mode = room.settings.mode || "classic";
  const words = pickWords(count);
  const colors = assignColors(count, mode);

  const game = {
    cards: words.map((word, i) => ({
      id: i,
      word,
      color: colors[i],
      revealed: false,
      tempRevealed: false,
      tempPlayerId: null,
      selectionConfirmed: false,
    })),
    mode: mode,
    soloMode: mode === "solo",
    status: "playing",
    log: [],
    startedAt: new Date(),
    // للكلاسيك
    currentTurn: "red",
    currentPhase: "hint",
    hint: null,
    hintCount: 0,
    guessesLeft: 0,
    // للسولو
    hintCards: [],
    selectedCardId: null,
    selectedPlayerId: null,
    selectionTimer: null,
    currentOperativeSocket: null,
    soloFinished: false,
    winnerPlayerId: null,
    // مهلة إعادة الاتصال
    disconnectTimers: {},
  };

  return game;
};

// Cooldown للطرد (30 ثانية)
const kickCooldowns = {};

// ===================== الوحدة الرئيسية =====================
module.exports = (io, rooms) => {
  io.on("connection", (socket) => {
    // ---------- ربط اللاعب ----------
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

    // ---------- إنشاء غرفة ----------
    socket.on("create_room", async (data, callback) => {
      try {
        const { name, password, cardCount, mode, playerData, isPrivate } = data;
        let code;
        do { code = generateRoomCode(); } while (rooms[code]);

        let privateCode = null;
        if (isPrivate) privateCode = generatePrivateCode();

        const room = {
          code,
          name: name || `غرفة ${code}`,
          password: password || null,
          isPrivate: isPrivate || false,
          privateCode,
          settings: {
            cardCount: mode === "classic" ? 25 : (cardCount || 25),
            mode: mode || "classic",
          },
          players: [],
          spectators: [],
          // هيكل الكلاسيك
          teams: {
            red: { spymaster: null, operatives: [] },
            blue: { spymaster: null, operatives: [] },
          },
          // هيكل السولو
          spymaster: null,
          operatives: [],
          currentOperativeTurn: null,
          game: null,
          status: "waiting",
          createdBy: playerData?.playerId,
          createdAt: new Date(),
          maxPlayers: 8,
        };

        rooms[code] = room;

        socket.join(code);
        socket.roomCode = code;

        const playerInRoom = {
          socketId: socket.id,
          playerId: playerData?.playerId,
          nickname: playerData?.nickname,
          avatar: playerData?.avatar,
          level: playerData?.level || 1,
          title: playerData?.activeTitle || "مبتدئ",
          isDev: playerData?.isDev || false,
        };
        room.players.push(playerInRoom);

        if (playerData?.playerId) {
          await Player.findOneAndUpdate(
            { playerId: playerData.playerId },
            { currentRoom: code }
          );
        }

        io.emit("rooms_update", getRoomsList(rooms));
        callback({ success: true, room: sanitizeRoom(room) });
      } catch (err) {
        console.error("خطأ في إنشاء الغرفة:", err);
        callback({ success: false, error: "فشل إنشاء الغرفة" });
      }
    });

    // ---------- الانضمام لغرفة ----------
    socket.on("join_room", async (data, callback) => {
      try {
        const { code, password, playerData, asSpectator, privateCode } = data;
        const room = rooms[code];
        if (!room) return callback({ success: false, error: "الغرفة غير موجودة" });
        if (room.password && room.password !== password) {
          return callback({ success: false, error: "كلمة المرور خاطئة" });
        }
        if (room.isPrivate && room.privateCode !== privateCode) {
          return callback({ success: false, error: "رمز الغرفة غير صحيح" });
        }
        if (kickCooldowns[playerData?.playerId]) {
          return callback({ success: false, error: "تم طردك من هذه الغرفة، انتظر 30 ثانية" });
        }
        if (room.status === "playing" && !asSpectator) {
          return callback({ success: false, error: "اللعبة بدأت، يمكنك الانضمام كمشاهد" });
        }

        if (playerData?.level >= 98) {
          io.to(code).emit("legendary_join", {
            nickname: playerData.nickname,
            avatar: playerData.avatar,
            level: playerData.level,
            title: playerData.activeTitle || "أسطورة",
          });
        }
        if (playerData?.isDev) {
          io.to(code).emit("dev_join", { nickname: playerData.nickname });
        }

        socket.join(code);
        socket.roomCode = code;

        const playerInRoom = {
          socketId: socket.id,
          playerId: playerData?.playerId,
          nickname: playerData?.nickname,
          avatar: playerData?.avatar,
          level: playerData?.level || 1,
          title: playerData?.activeTitle || "مبتدئ",
          isDev: playerData?.isDev || false,
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
          level: playerData?.level,
          title: playerData?.activeTitle,
        });
        io.emit("rooms_update", getRoomsList(rooms));
        callback({ success: true, room: sanitizeRoom(room) });
      } catch (err) {
        console.error("خطأ في الانضمام:", err);
        callback({ success: false, error: "فشل الانضمام" });
      }
    });

    // ---------- اختيار الفريق والدور ----------
    socket.on("select_team_role", ({ team, role }, callback) => {
      const room = rooms[socket.roomCode];
      if (!room) return callback({ success: false, error: "الغرفة غير موجودة" });
      if (room.status === "playing") return callback({ success: false, error: "اللعبة بدأت" });

      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) return callback({ success: false, error: "اللاعب غير موجود" });

      const isSolo = room.settings.mode === "solo";

      if (isSolo) {
        if (role === "spymaster") {
          if (room.spymaster) return callback({ success: false, error: "البوص مأخوذ بالفعل" });
          room.operatives = room.operatives.filter((o) => o.socketId !== socket.id);
          room.spymaster = {
            socketId: socket.id,
            playerId: player.playerId,
            nickname: player.nickname,
            avatar: player.avatar,
            level: player.level,
          };
          const p = room.players.find((p) => p.socketId === socket.id);
          if (p) { p.role = "spymaster"; p.team = null; }
          io.to(socket.roomCode).emit("room_update", sanitizeRoom(room));
          return callback({ success: true });
        } else if (role === "operative") {
          if (room.spymaster?.socketId === socket.id) {
            room.spymaster = null;
          }
          room.operatives = room.operatives.filter((o) => o.socketId !== socket.id);
          room.operatives.push({
            socketId: socket.id,
            playerId: player.playerId,
            nickname: player.nickname,
            avatar: player.avatar,
            level: player.level,
            score: 0,
            eliminated: false,
            hasConfirmed: false,
          });
          const p = room.players.find((p) => p.socketId === socket.id);
          if (p) { p.role = "operative"; p.team = null; }
          io.to(socket.roomCode).emit("room_update", sanitizeRoom(room));
          return callback({ success: true });
        } else {
          return callback({ success: false, error: "دور غير صالح في السولو" });
        }
      } else {
        if (!team || !role) return callback({ success: false, error: "بيانات ناقصة" });
        if (team !== "red" && team !== "blue") return callback({ success: false, error: "فريق غير صالح" });

        if (role === "spymaster") {
          if (room.teams[team].spymaster) return callback({ success: false, error: "البوص مأخوذ" });
          if (player.team && player.role === "spymaster") {
            room.teams[player.team].spymaster = null;
          }
          if (player.team) {
            room.teams[player.team].operatives = room.teams[player.team].operatives.filter(
              (o) => o.socketId !== socket.id
            );
          }
          room.teams[team].spymaster = {
            socketId: socket.id,
            playerId: player.playerId,
            nickname: player.nickname,
            avatar: player.avatar,
            level: player.level,
          };
        } else if (role === "operative") {
          if (player.team && player.role === "spymaster") {
            room.teams[player.team].spymaster = null;
          }
          if (player.team) {
            room.teams[player.team].operatives = room.teams[player.team].operatives.filter(
              (o) => o.socketId !== socket.id
            );
          }
          room.teams[team].operatives.push({
            socketId: socket.id,
            playerId: player.playerId,
            nickname: player.nickname,
            avatar: player.avatar,
            level: player.level,
          });
        } else {
          return callback({ success: false, error: "دور غير صالح" });
        }

        const p = room.players.find((p) => p.socketId === socket.id);
        if (p) { p.team = team; p.role = role; }

        io.to(socket.roomCode).emit("room_update", sanitizeRoom(room));
        return callback({ success: true });
      }
    });

    // ---------- بدء اللعبة ----------
    socket.on("start_game", (callback) => {
      const room = rooms[socket.roomCode];
      if (!room) return callback?.({ success: false, error: "الغرفة غير موجودة" });

      const isCreator = room.createdBy === socket.playerId;
      const isDev = room.players.find((p) => p.socketId === socket.id && p.isDev);
      if (!isCreator && !isDev) {
        return callback?.({ success: false, error: "فقط المنشئ أو المطور يمكنه البدء" });
      }
      if (room.status === "playing") return callback?.({ success: false, error: "اللعبة بدأت بالفعل" });

      const isSolo = room.settings.mode === "solo";

      if (isSolo) {
        if (!room.spymaster) return callback?.({ success: false, error: "يجب اختيار البوص" });
        const activeOperatives = room.operatives.filter((o) => !o.eliminated);
        if (activeOperatives.length < 1) {
          return callback?.({ success: false, error: "يحتاج الفريق إلى لاعب واحد على الأقل" });
        }
      } else {
        const { red, blue } = room.teams;
        if (!red.spymaster || !blue.spymaster) {
          return callback?.({ success: false, error: "كل فريق يحتاج بوصاً" });
        }
        if (red.operatives.length === 0 || blue.operatives.length === 0) {
          return callback?.({ success: false, error: "كل فريق يحتاج عميلاً واحداً على الأقل" });
        }
      }

      room.game = createGameState(room);
      room.status = "playing";

      if (isSolo) {
        const spymasterSocket = room.spymaster?.socketId;
        if (spymasterSocket) {
          io.to(spymasterSocket).emit("spymaster_view", {
            cards: room.game.cards,
            soloMode: true,
            isSpymaster: true,
          });
        }

        const operativeSockets = room.operatives
          .filter((o) => !o.eliminated)
          .map((o) => o.socketId);
        operativeSockets.forEach((sid) => {
          io.to(sid).emit("game_started", {
            game: sanitizeGameForOperatives(room.game),
            soloMode: true,
            players: room.operatives.map((o) => ({
              socketId: o.socketId,
              nickname: o.nickname,
              avatar: o.avatar,
              score: o.score,
              eliminated: o.eliminated,
            })),
            isSpymaster: false,
          });
        });

        io.to(socket.roomCode).emit("game_started", {
          game: sanitizeGameForOperatives(room.game),
          soloMode: true,
          players: room.operatives.map((o) => ({
            socketId: o.socketId,
            nickname: o.nickname,
            avatar: o.avatar,
            score: o.score,
            eliminated: o.eliminated,
          })),
          isSpymaster: false,
        });

        // إرسال إشعار للجميع ببدء اللعبة
        io.to(socket.roomCode).emit("game_started_announce", {
          soloMode: true,
          spymaster: room.spymaster?.nickname,
          players: room.operatives.filter(o => !o.eliminated).map(o => o.nickname),
        });
      } else {
        const redSpymasterSocket = room.teams.red.spymaster?.socketId;
        const blueSpymasterSocket = room.teams.blue.spymaster?.socketId;

        if (redSpymasterSocket) {
          io.to(redSpymasterSocket).emit("spymaster_view", {
            cards: room.game.cards,
            team: "red",
            soloMode: false,
          });
        }
        if (blueSpymasterSocket) {
          io.to(blueSpymasterSocket).emit("spymaster_view", {
            cards: room.game.cards,
            team: "blue",
            soloMode: false,
          });
        }

        io.to(socket.roomCode).emit("game_started", {
          game: sanitizeGameForOperatives(room.game),
          teams: room.teams,
          soloMode: false,
        });
      }

      io.emit("rooms_update", getRoomsList(rooms));
      callback?.({ success: true });
    });

    // ---------- إرسال تلميح السولو ----------
    socket.on("send_hint_solo", ({ word, cardIds }, callback) => {
      const room = rooms[socket.roomCode];
      if (!room || !room.game) return callback?.({ success: false, error: "اللعبة غير موجودة" });
      const game = room.game;
      if (game.status !== "playing") return;
      if (!game.soloMode) return callback?.({ success: false, error: "ليس وضع سولو" });

      if (!room.spymaster || room.spymaster.socketId !== socket.id) {
        return callback?.({ success: false, error: "فقط البوص يمكنه إرسال تلميح" });
      }
      if (game.currentPhase === "guess") {
        return callback?.({ success: false, error: "دور التخمين الآن" });
      }

      if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 3) {
        return callback?.({ success: false, error: "يجب اختيار 1-3 بطاقات للتلميح" });
      }

      // التحقق من عدم وجود بطاقة سوداء
      const hasBlack = cardIds.some((id) => {
        const card = game.cards[id];
        return card && card.color === "black";
      });
      if (hasBlack) {
        return callback?.({ success: false, error: "لا يمكن التلميح على البطاقة السوداء" });
      }

      // التحقق من أن البطاقات غير مكشوفة
      const allValid = cardIds.every((id) => {
        const card = game.cards[id];
        return card && !card.revealed;
      });
      if (!allValid) {
        return callback?.({ success: false, error: "بعض البطاقات مكشوفة بالفعل" });
      }

      const wordOnBoard = game.cards.some((c) => c.word.toLowerCase() === word.toLowerCase());
      if (wordOnBoard) return callback?.({ success: false, error: "الكلمة موجودة على البطاقات" });

      game.hint = word;
      game.hintCards = cardIds;
      game.currentPhase = "guess";
      game.hintCount = cardIds.length;

      game.log.push({
        type: "hint",
        text: `البوص أعطى تلميح: "${word}" (${cardIds.length} بطاقات)`,
        timestamp: new Date(),
      });

      // إرسال التلميح للجميع
      io.to(socket.roomCode).emit("hint_sent", {
        hint: word,
        count: cardIds.length,
        nickname: room.spymaster.nickname,
        soloMode: true,
        hintCards: cardIds,
      });

      // تعيين أول لاعب للدور
      const firstPlayer = room.operatives.find((o) => !o.eliminated);
      if (firstPlayer) {
        game.currentOperativeSocket = firstPlayer.socketId;
        room.currentOperativeTurn = firstPlayer.socketId;
        io.to(firstPlayer.socketId).emit("your_turn", {
          message: "دورك في التخمين!",
          hintCards: cardIds,
          hint: word,
          count: cardIds.length,
        });
      }

      io.to(socket.roomCode).emit("game_update", sanitizeGameForOperatives(game));
      callback?.({ success: true });
    });

    // ---------- اختيار بطاقة مؤقت (السولو) ----------
    socket.on("select_card_temp", ({ cardId }, callback) => {
      const room = rooms[socket.roomCode];
      if (!room || !room.game) return callback?.({ success: false, error: "اللعبة غير موجودة" });
      const game = room.game;
      if (!game.soloMode) return callback?.({ success: false, error: "ليس وضع سولو" });
      if (game.status !== "playing") return;
      if (game.currentPhase !== "guess") {
        return callback?.({ success: false, error: "ليس وقت التخمين" });
      }

      const operative = room.operatives.find((o) => o.socketId === socket.id);
      if (!operative || operative.eliminated) {
        return callback?.({ success: false, error: "أنت مأقصى أو غير موجود" });
      }
      if (game.currentOperativeSocket !== socket.id) {
        return callback?.({ success: false, error: "ليس دورك الآن" });
      }

      const card = game.cards[cardId];
      if (!card || card.revealed) {
        return callback?.({ success: false, error: "بطاقة غير صالحة" });
      }

      // إلغاء التحديد السابق إذا كان موجود
      if (game.selectedCardId !== null && game.selectedCardId !== cardId) {
        const oldCard = game.cards[game.selectedCardId];
        if (oldCard) {
          oldCard.tempRevealed = false;
          oldCard.tempPlayerId = null;
        }
      }

      // تحديد البطاقة الجديدة مؤقتاً
      card.tempRevealed = true;
      card.tempPlayerId = socket.playerId;
      game.selectedCardId = cardId;
      game.selectedPlayerId = socket.playerId;

      // إلغاء المؤقت السابق
      if (game.selectionTimer) {
        clearTimeout(game.selectionTimer);
        game.selectionTimer = null;
      }

      // إرسال تحديث للجميع (إظهار الصورة مؤقتاً)
      io.to(socket.roomCode).emit("card_temp_selected", {
        cardId,
        playerId: socket.playerId,
        playerNickname: socket.playerNickname,
        avatar: operative.avatar,
      });

      // مهلة 10 ثوانٍ للإلغاء التلقائي
      game.selectionTimer = setTimeout(() => {
        const currentCard = game.cards[cardId];
        if (currentCard && currentCard.tempRevealed && !currentCard.revealed) {
          currentCard.tempRevealed = false;
          currentCard.tempPlayerId = null;
          game.selectedCardId = null;
          game.selectedPlayerId = null;
          io.to(socket.roomCode).emit("card_temp_cancel", { cardId });
          io.to(socket.id).emit("feedback", {
            type: "timeout",
            message: "انتهى الوقت، تم إلغاء اختيارك",
          });
        }
        game.selectionTimer = null;
      }, 10000);

      callback?.({ success: true });
    });

    // ---------- تأكيد الاختيار (السولو) ----------
    socket.on("confirm_selection", async ({ cardId }, callback) => {
      const room = rooms[socket.roomCode];
      if (!room || !room.game) return callback?.({ success: false, error: "اللعبة غير موجودة" });
      const game = room.game;
      if (!game.soloMode) return callback?.({ success: false, error: "ليس وضع سولو" });
      if (game.status !== "playing") return;

      const operative = room.operatives.find((o) => o.socketId === socket.id);
      if (!operative || operative.eliminated) {
        return callback?.({ success: false, error: "أنت مأقصى أو غير موجود" });
      }
      if (game.currentOperativeSocket !== socket.id) {
        return callback?.({ success: false, error: "ليس دورك الآن" });
      }

      if (game.selectedCardId !== cardId || game.selectedPlayerId !== socket.playerId) {
        return callback?.({ success: false, error: "لم تقم باختيار هذه البطاقة" });
      }

      const card = game.cards[cardId];
      if (!card || card.revealed) {
        return callback?.({ success: false, error: "بطاقة غير صالحة" });
      }

      // إلغاء المؤقت
      if (game.selectionTimer) {
        clearTimeout(game.selectionTimer);
        game.selectionTimer = null;
      }

      // كشف البطاقة بشكل دائم
      card.revealed = true;
      card.tempRevealed = false;
      card.tempPlayerId = null;
      game.selectedCardId = null;
      game.selectedPlayerId = null;

      const isHinted = game.hintCards.includes(cardId);
      const isBlack = card.color === "black";
      let eventType = "";
      let turnEnd = false;

      if (isBlack) {
        // إقصاء فوري
        operative.eliminated = true;
        eventType = "black_guess";
        turnEnd = true;
        game.log.push({
          type: "black",
          text: `${operative.nickname} اختار البطاقة السوداء! تم إقصاؤه`,
          timestamp: new Date(),
        });
        io.to(socket.id).emit("feedback", {
          type: "black",
          message: "بطاقة سوداء! تم إقصاؤك.",
        });

        // تحويله لمشاهد
        const player = room.players.find((p) => p.socketId === socket.id);
        if (player) {
          room.spectators.push({ ...player });
          room.players = room.players.filter((p) => p.socketId !== socket.id);
        }
        io.to(socket.id).emit("eliminated");

        // التحقق من الفوز (إذا لاعبين فقط)
        const activeOperatives = room.operatives.filter((o) => !o.eliminated);
        if (activeOperatives.length === 1 && room.operatives.length === 2) {
          // لاعب واحد فقط بقي -> يفوز
          const winner = activeOperatives[0];
          game.status = "solo_finish";
          game.soloFinished = true;
          game.winnerPlayerId = winner.playerId;
          const spymasterReward = Math.floor(winner.score * 0.75);
          if (room.spymaster?.playerId) {
            await Player.findOneAndUpdate(
              { playerId: room.spymaster.playerId },
              { $inc: { coins: spymasterReward, xp: spymasterReward * 10 } }
            );
          }
          if (winner.playerId) {
            await Player.findOneAndUpdate(
              { playerId: winner.playerId },
              { $inc: { coins: winner.score * 2, xp: winner.score * 20 } }
            );
          }
          endGameSolo(room, io, {
            winner: winner.nickname,
            winnerScore: winner.score,
            scores: room.operatives.map((o) => ({
              nickname: o.nickname,
              score: o.score,
              eliminated: o.eliminated,
            })),
            spymasterReward,
          });
          io.to(socket.roomCode).emit("card_revealed", {
            cardId,
            word: card.word,
            color: card.color,
            eventType,
            player: operative.nickname,
            soloMode: true,
            score: operative.score,
            eliminated: true,
          });
          return callback?.({ success: true });
        }
      } else if (isHinted) {
        // صحيحة
        operative.score += 1;
        eventType = "correct_guess";
        game.log.push({
          type: "correct",
          text: `${operative.nickname} اختار "${card.word}" صحيحة! +1 نقطة`,
          timestamp: new Date(),
        });
        io.to(socket.id).emit("feedback", {
          type: "correct",
          message: "إجابة صحيحة! استمر.",
        });

        // التحقق من انتهاء كل البطاقات الملمح عليها
        const allHintedRevealed = game.hintCards.every((id) => game.cards[id].revealed);
        if (allHintedRevealed) {
          // انتهت كل البطاقات -> نحسب النقاط
          const sorted = [...room.operatives].sort((a, b) => b.score - a.score);
          const winner = sorted[0];
          game.status = "solo_finish";
          game.soloFinished = true;
          game.winnerPlayerId = winner?.playerId || null;
          const spymasterReward = Math.floor((winner?.score || 0) * 0.75);
          if (room.spymaster?.playerId) {
            await Player.findOneAndUpdate(
              { playerId: room.spymaster.playerId },
              { $inc: { coins: spymasterReward, xp: spymasterReward * 10 } }
            );
          }
          if (winner?.playerId) {
            await Player.findOneAndUpdate(
              { playerId: winner.playerId },
              { $inc: { coins: (winner.score || 0) * 2, xp: (winner.score || 0) * 20 } }
            );
          }
          endGameSolo(room, io, {
            winner: winner?.nickname || "لا أحد",
            winnerScore: winner?.score || 0,
            scores: room.operatives.map((o) => ({
              nickname: o.nickname,
              score: o.score,
              eliminated: o.eliminated,
            })),
            spymasterReward,
          });
          io.to(socket.roomCode).emit("card_revealed", {
            cardId,
            word: card.word,
            color: card.color,
            eventType,
            player: operative.nickname,
            soloMode: true,
            score: operative.score,
          });
          return callback?.({ success: true });
        }

        // البوص يحدد أنه يمكن للاعب الاستمرار
        // ما بننهي دور اللاعب
        turnEnd = false;
      } else {
        // خاطئة
        operative.score -= 1;
        eventType = "wrong_guess";
        turnEnd = true;
        game.log.push({
          type: "wrong",
          text: `${operative.nickname} اختار "${card.word}" خاطئة! -1 نقطة`,
          timestamp: new Date(),
        });
        io.to(socket.id).emit("feedback", {
          type: "wrong",
          message: "إجابة خاطئة! ينتهي دورك.",
        });
      }

      // بث البطاقة المكشوفة للكل
      io.to(socket.roomCode).emit("card_revealed", {
        cardId,
        word: card.word,
        color: card.color,
        eventType,
        player: operative.nickname,
        soloMode: true,
        score: operative.score,
        eliminated: operative.eliminated,
      });

      // تمرير الدور إذا لزم الأمر
      if (turnEnd) {
        const nextPlayer = getNextOperative(room, socket.id);
        if (nextPlayer) {
          game.currentOperativeSocket = nextPlayer.socketId;
          room.currentOperativeTurn = nextPlayer.socketId;
          game.currentPhase = "guess";
          io.to(nextPlayer.socketId).emit("your_turn", {
            message: "دورك الآن!",
            hintCards: game.hintCards,
            hint: game.hint,
            count: game.hintCount,
          });
          game.log.push({
            type: "turn_end",
            text: `تمرير الدور إلى ${nextPlayer.nickname}`,
            timestamp: new Date(),
          });
        } else {
          // لا يوجد لاعبين -> إنهاء الجولة
          game.currentPhase = "hint";
          io.to(socket.roomCode).emit("turn_changed", {
            newTurn: "spymaster",
            soloMode: true,
            message: "انتهت تخمينات اللاعبين، دور البوص لإرسال تلميح جديد",
          });
        }
        io.to(socket.roomCode).emit("game_update", sanitizeGameForOperatives(game));
      }

      callback?.({ success: true });
    });

    // ---------- إلغاء الاختيار (السولو) ----------
    socket.on("cancel_selection", ({ cardId }, callback) => {
      const room = rooms[socket.roomCode];
      if (!room || !room.game) return callback?.({ success: false, error: "اللعبة غير موجودة" });
      const game = room.game;
      if (!game.soloMode) return;

      if (game.selectedCardId === cardId && game.selectedPlayerId === socket.playerId) {
        const card = game.cards[cardId];
        if (card) {
          card.tempRevealed = false;
          card.tempPlayerId = null;
          game.selectedCardId = null;
          game.selectedPlayerId = null;
          if (game.selectionTimer) {
            clearTimeout(game.selectionTimer);
            game.selectionTimer = null;
          }
          io.to(socket.roomCode).emit("card_temp_cancel", { cardId });
          callback?.({ success: true });
        } else {
          callback?.({ success: false, error: "بطاقة غير صالحة" });
        }
      } else {
        callback?.({ success: false, error: "ليس اختيارك" });
      }
    });

    // ---------- إنهاء دور اللاعبين (البوص) ----------
    socket.on("end_operative_turn", (callback) => {
      const room = rooms[socket.roomCode];
      if (!room || !room.game) return callback?.({ success: false, error: "اللعبة غير موجودة" });
      const game = room.game;
      if (!game.soloMode) return callback?.({ success: false, error: "ليس وضع سولو" });
      if (game.status !== "playing") return;

      if (!room.spymaster || room.spymaster.socketId !== socket.id) {
        return callback?.({ success: false, error: "فقط البوص يمكنه إنهاء الدور" });
      }

      game.currentPhase = "hint";
      game.currentOperativeSocket = null;
      room.currentOperativeTurn = null;

      // إلغاء أي تحديدات معلقة
      if (game.selectedCardId !== null) {
        const card = game.cards[game.selectedCardId];
        if (card) {
          card.tempRevealed = false;
          card.tempPlayerId = null;
        }
        game.selectedCardId = null;
        game.selectedPlayerId = null;
        if (game.selectionTimer) {
          clearTimeout(game.selectionTimer);
          game.selectionTimer = null;
        }
      }

      game.log.push({
        type: "turn_end",
        text: "البوص أنهى دور اللاعبين",
        timestamp: new Date(),
      });

      io.to(socket.roomCode).emit("turn_changed", {
        newTurn: "spymaster",
        soloMode: true,
        message: "البوص ينتظر لتقديم تلميح جديد",
      });
      io.to(socket.roomCode).emit("game_update", sanitizeGameForOperatives(game));

      callback?.({ success: true });
    });

    // ---------- إرسال تلميح الكلاسيك ----------
    socket.on("send_hint", ({ word, count }, callback) => {
      const room = rooms[socket.roomCode];
      if (!room || !room.game) return callback?.({ success: false, error: "اللعبة غير موجودة" });
      const game = room.game;
      if (game.soloMode) return callback?.({ success: false, error: "استخدم send_hint_solo" });
      if (game.status !== "playing") return;

      const team = game.currentTurn;
      const spymaster = room.teams[team].spymaster;
      if (!spymaster || spymaster.socketId !== socket.id) {
        return callback?.({ success: false, error: "فقط البوص يمكنه إرسال تلميح" });
      }
      if (game.currentPhase !== "hint") {
        return callback?.({ success: false, error: "ليس وقت التلميح" });
      }

      const wordOnBoard = game.cards.some((c) => c.word.toLowerCase() === word.toLowerCase());
      if (wordOnBoard) return callback?.({ success: false, error: "الكلمة موجودة على البطاقات" });

      const hintCount = parseInt(count);
      if (isNaN(hintCount) || hintCount < 1 || hintCount > 9) {
        return callback?.({ success: false, error: "رقم التلميح غير صالح" });
      }

      game.hint = word;
      game.hintCount = hintCount;
      game.guessesLeft = hintCount + 1;
      game.currentPhase = "guess";

      game.log.push({
        type: "hint",
        text: `البوص ${spymaster.nickname} (${team === "red" ? "أحمر" : "أزرق"}): "${word}" - ${hintCount}`,
        timestamp: new Date(),
      });

      io.to(socket.roomCode).emit("hint_sent", {
        hint: word,
        count: hintCount,
        team,
        nickname: spymaster.nickname,
        soloMode: false,
      });
      io.to(socket.roomCode).emit("game_update", sanitizeGameForOperatives(game));

      callback?.({ success: true });
    });

    // ---------- اختيار بطاقة (كلاسيك) ----------
    socket.on("select_card", async ({ cardId }, callback) => {
      const room = rooms[socket.roomCode];
      if (!room || !room.game) return callback?.({ success: false, error: "اللعبة غير موجودة" });
      const game = room.game;
      if (game.soloMode) return callback?.({ success: false, error: "استخدم select_card_solo" });
      if (game.status !== "playing") return;
      if (game.currentPhase !== "guess") {
        return callback?.({ success: false, error: "ليس وقت التخمين" });
      }

      const team = game.currentTurn;
      const operative = room.teams[team].operatives.find((o) => o.socketId === socket.id);
      if (!operative) return callback?.({ success: false, error: "أنت لست عميلاً في هذا الفريق" });

      if (game.guessesLeft <= 0) {
        return callback?.({ success: false, error: "لا تخمينات متبقية" });
      }

      const card = game.cards.find((c) => c.id === cardId);
      if (!card || card.revealed) return callback?.({ success: false, error: "بطاقة غير صالحة" });

      card.revealed = true;
      const color = card.color;
      let eventType = "";
      let turnEnd = false;

      if (color === team) {
        eventType = "correct_guess";
        game.guessesLeft -= 1;
        game.log.push({
          type: "correct",
          text: `${operative.nickname} اختار "${card.word}" صحيحة`,
          timestamp: new Date(),
        });

        const remaining = game.cards.filter((c) => c.color === team && !c.revealed).length;
        if (remaining === 0) {
          game.status = `${team}_win`;
          endGameClassic(room, io, game.status, {
            winner: team === "red" ? "الأحمر" : "الأزرق",
          });
          io.to(socket.roomCode).emit("card_revealed", {
            cardId,
            word: card.word,
            color: card.color,
            eventType,
            team,
            player: operative.nickname,
            soloMode: false,
          });
          return callback?.({ success: true });
        }

        if (game.guessesLeft === 0) turnEnd = true;
      } else if (color === "neutral") {
        eventType = "neutral_guess";
        turnEnd = true;
        game.log.push({
          type: "neutral",
          text: `${operative.nickname} اختار "${card.word}" محايد`,
          timestamp: new Date(),
        });
      } else if (color === "black") {
        eventType = "black_guess";
        game.status = team === "red" ? "blue_win" : "red_win";
        game.log.push({
          type: "black",
          text: `${operative.nickname} اختار السوداء! خسارة ${team === "red" ? "الأحمر" : "الأزرق"}`,
          timestamp: new Date(),
        });
        endGameClassic(room, io, game.status, {
          winner: game.status === "red_win" ? "الأحمر" : "الأزرق",
        });
        io.to(socket.roomCode).emit("card_revealed", {
          cardId,
          word: card.word,
          color: card.color,
          eventType,
          team,
          player: operative.nickname,
          soloMode: false,
        });
        return callback?.({ success: true });
      } else {
        // بطاقة من الفريق الآخر -> خطأ فادح + خصم بطاقة
        eventType = "wrong_guess";
        turnEnd = true;
        const otherTeam = team === "red" ? "blue" : "red";
        const otherCards = game.cards.filter((c) => c.color === otherTeam && !c.revealed);
        if (otherCards.length > 0) {
          const randomCard = otherCards[Math.floor(Math.random() * otherCards.length)];
          randomCard.revealed = true;
          game.log.push({
            type: "penalty",
            text: `خصم بطاقة من ${otherTeam === "red" ? "الأحمر" : "الأزرق"}`,
            timestamp: new Date(),
          });
          io.to(socket.roomCode).emit("card_revealed", {
            cardId: randomCard.id,
            word: randomCard.word,
            color: randomCard.color,
            eventType: "penalty",
            player: "النظام",
            soloMode: false,
          });
        }
        game.log.push({
          type: "wrong",
          text: `${operative.nickname} اختار "${card.word}" خطأ فادح`,
          timestamp: new Date(),
        });
      }

      io.to(socket.roomCode).emit("card_revealed", {
        cardId,
        word: card.word,
        color: card.color,
        eventType,
        team,
        player: operative.nickname,
        soloMode: false,
      });

      if (turnEnd || game.guessesLeft === 0) {
        game.currentTurn = team === "red" ? "blue" : "red";
        game.currentPhase = "hint";
        game.hint = null;
        game.hintCount = 0;
        game.guessesLeft = 0;
        game.log.push({
          type: "turn_end",
          text: `تمرير الدور إلى ${game.currentTurn === "red" ? "الأحمر" : "الأزرق"}`,
          timestamp: new Date(),
        });
        io.to(socket.roomCode).emit("turn_changed", {
          newTurn: game.currentTurn,
          game: sanitizeGameForOperatives(game),
          soloMode: false,
        });
      }

      io.to(socket.roomCode).emit("game_update", sanitizeGameForOperatives(game));
      callback?.({ success: true });
    });

    // ---------- إنهاء الدور (كلاسيك) ----------
    socket.on("end_turn", (callback) => {
      const room = rooms[socket.roomCode];
      if (!room || !room.game) return callback?.({ success: false, error: "اللعبة غير موجودة" });
      const game = room.game;
      if (game.soloMode) return callback?.({ success: false, error: "استخدم end_operative_turn" });
      if (game.status !== "playing") return;

      const team = game.currentTurn;
      game.currentTurn = team === "red" ? "blue" : "red";
      game.currentPhase = "hint";
      game.hint = null;
      game.hintCount = 0;
      game.guessesLeft = 0;

      game.log.push({
        type: "turn_end",
        text: `${socket.playerNickname} أنهى دور ${team === "red" ? "الأحمر" : "الأزرق"}`,
        timestamp: new Date(),
      });

      io.to(socket.roomCode).emit("turn_changed", {
        newTurn: game.currentTurn,
        game: sanitizeGameForOperatives(game),
        soloMode: false,
      });

      callback?.({ success: true });
    });

    // ---------- إعادة الاتصال ----------
    socket.on("reconnect_room", async ({ code, playerId }, callback) => {
      const room = rooms[code];
      if (!room) return callback?.({ success: false, error: "الغرفة لم تعد موجودة" });
      if (room.status !== "playing") {
        return callback?.({ success: false, error: "اللعبة انتهت" });
      }

      const player = room.players.find((p) => p.playerId === playerId);
      if (player) {
        player.socketId = socket.id;
        socket.join(code);
        socket.roomCode = code;
        socket.playerId = playerId;
        io.to(code).emit("player_reconnected", { nickname: player.nickname });

        const isSolo = room.game?.soloMode;
        let isSpymaster = false;
        if (isSolo) {
          isSpymaster = room.spymaster?.playerId === playerId;
        } else {
          isSpymaster =
            room.teams.red.spymaster?.playerId === playerId ||
            room.teams.blue.spymaster?.playerId === playerId;
        }

        const operative = room.operatives.find((o) => o.playerId === playerId);
        let score = operative?.score || 0;
        let eliminated = operative?.eliminated || false;

        callback?.({
          success: true,
          room: sanitizeRoom(room),
          game: room.game ? sanitizeGameForOperatives(room.game) : null,
          isSpymaster,
          spymasterCards: isSpymaster ? room.game?.cards : null,
          soloMode: isSolo,
          currentTurn: isSolo ? room.currentOperativeTurn : room.game?.currentTurn,
          score,
          eliminated,
          hintCards: isSolo ? room.game?.hintCards : null,
          hint: isSolo ? room.game?.hint : null,
        });
      } else {
        callback?.({ success: false, error: "أنت لست في هذه الغرفة" });
      }
    });

    // ---------- المغادرة ----------
    socket.on("leave_room", async () => {
      await handleLeave(socket, rooms, io);
    });

    // ---------- طرد لاعب ----------
    socket.on("kick_player", async ({ targetPlayerId }, callback) => {
      const room = rooms[socket.roomCode];
      if (!room) return callback?.({ success: false, error: "الغرفة غير موجودة" });
      const isAdmin = room.createdBy === socket.playerId || socket.isDev;
      if (!isAdmin) return callback?.({ success: false, error: "ليس لديك صلاحية" });

      const targetPlayer = room.players.find((p) => p.playerId === targetPlayerId);
      if (!targetPlayer) return callback?.({ success: false, error: "اللاعب غير موجود" });
      if (targetPlayer.playerId === room.createdBy) {
        return callback?.({ success: false, error: "لا يمكن طرد منشئ الغرفة" });
      }
      if (targetPlayer.isDev) return callback?.({ success: false, error: "لا يمكن طرد المطور" });

      room.players = room.players.filter((p) => p.playerId !== targetPlayerId);
      room.spectators = room.spectators.filter((p) => p.playerId !== targetPlayerId);
      if (room.spymaster?.playerId === targetPlayerId) room.spymaster = null;
      room.operatives = room.operatives.filter((p) => p.playerId !== targetPlayerId);
      for (const team of ["red", "blue"]) {
        if (room.teams[team].spymaster?.playerId === targetPlayerId) room.teams[team].spymaster = null;
        room.teams[team].operatives = room.teams[team].operatives.filter(
          (o) => o.playerId !== targetPlayerId
        );
      }

      if (kickCooldowns[targetPlayerId]) clearTimeout(kickCooldowns[targetPlayerId]);
      kickCooldowns[targetPlayerId] = setTimeout(() => delete kickCooldowns[targetPlayerId], 30000);

      const targetSocket = await getSocketByPlayerId(targetPlayerId);
      if (targetSocket) {
        targetSocket.emit("kicked_from_room", { reason: "تم طردك من الغرفة" });
        targetSocket.leave(socket.roomCode);
        targetSocket.roomCode = null;
        await Player.findOneAndUpdate({ playerId: targetPlayerId }, { currentRoom: null });
      }

      io.to(socket.roomCode).emit("player_left", {
        socketId: targetPlayer.socketId,
        nickname: targetPlayer.nickname,
        kicked: true,
      });
      io.to(socket.roomCode).emit("room_update", sanitizeRoom(room));
      io.emit("rooms_update", getRoomsList(rooms));
      callback?.({ success: true });
    });

    // ---------- انقطاع الاتصال ----------
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

// ===================== دوال مساعدة =====================

// الحصول على اللاعب التالي في السولو
function getNextOperative(room, currentSocketId) {
  const active = room.operatives.filter((o) => !o.eliminated);
  if (active.length === 0) return null;
  const index = active.findIndex((o) => o.socketId === currentSocketId);
  if (index === -1) return active[0];
  const nextIndex = (index + 1) % active.length;
  return active[nextIndex];
}

// إنهاء لعبة السولو
async function endGameSolo(room, io, data) {
  room.game.status = "solo_finish";
  room.game.soloFinished = true;
  room.status = "finished";

  io.to(room.code).emit("game_over", {
    status: "solo_finish",
    winner: data.winner,
    reason: data.reason || `الفائز: ${data.winner} مع ${data.winnerScore} نقاط!`,
    scores: data.scores,
    soloMode: true,
    spymasterReward: data.spymasterReward || 0,
    cards: room.game.cards,
    log: room.game.log,
  });

  try {
    for (const p of room.players) {
      await Player.findOneAndUpdate(
        { playerId: p.playerId },
        { $inc: { "stats.gamesPlayed": 1 } }
      );
    }
  } catch {}

  io.emit("rooms_update", getRoomsList(rooms));
}

// إنهاء لعبة كلاسيك
async function endGameClassic(room, io, status, data) {
  room.game.status = status;
  room.status = "finished";

  io.to(room.code).emit("game_over", {
    status,
    winner: data.winner,
    reason: data.reason || `الفائز: ${data.winner}!`,
    soloMode: false,
    cards: room.game.cards,
    log: room.game.log,
  });

  try {
    for (const p of room.players) {
      await Player.findOneAndUpdate(
        { playerId: p.playerId },
        { $inc: { "stats.gamesPlayed": 1 } }
      );
    }
  } catch {}

  io.emit("rooms_update", getRoomsList(rooms));
}

// مغادرة الغرفة
async function handleLeave(socket, rooms, io, isDisconnect = false) {
  const code = socket.roomCode;
  if (!code || !rooms[code]) return;
  const room = rooms[code];

  const isCreator = socket.playerId === room.createdBy;

  room.players = room.players.filter((p) => p.socketId !== socket.id);
  room.spectators = room.spectators.filter((p) => p.socketId !== socket.id);
  if (room.spymaster?.socketId === socket.id) room.spymaster = null;
  room.operatives = room.operatives.filter((o) => o.socketId !== socket.id);
  for (const team of ["red", "blue"]) {
    if (room.teams[team].spymaster?.socketId === socket.id) room.teams[team].spymaster = null;
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

  if (isCreator && room.players.length > 0) {
    io.to(code).emit("room_closed", { reason: "غادر منشئ الغرفة" });
    delete rooms[code];
    io.emit("rooms_update", getRoomsList(rooms));
    return;
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

// الحصول على Socket
async function getSocketByPlayerId(playerId) {
  const player = await Player.findOne({ playerId });
  if (player && player.socketId) {
    const sockets = await io.fetchSockets();
    return sockets.find((s) => s.id === player.socketId);
  }
  return null;
}

// قائمة الغرف
function getRoomsList(rooms) {
  return Object.values(rooms).map((r) => ({
    code: r.code,
    name: r.name,
    players: r.players.length,
    maxPlayers: r.maxPlayers,
    mode: r.settings.mode,
    status: r.status,
    hasPassword: !!r.password,
    isPrivate: r.isPrivate || false,
    spectators: r.spectators.length,
    cardCount: r.settings.cardCount,
  }));
}

// تنظيف بيانات الغرفة
function sanitizeRoom(room) {
  return {
    code: room.code,
    name: room.name,
    isPrivate: room.isPrivate || false,
    settings: room.settings,
    players: room.players.map((p) => ({
      socketId: p.socketId,
      playerId: p.playerId,
      nickname: p.nickname,
      avatar: p.avatar,
      level: p.level,
      title: p.title,
      team: p.team,
      role: p.role,
      isDev: p.isDev,
    })),
    spectators: room.spectators,
    teams: room.teams,
    spymaster: room.spymaster,
    operatives: room.operatives.map((o) => ({
      socketId: o.socketId,
      playerId: o.playerId,
      nickname: o.nickname,
      avatar: o.avatar,
      score: o.score,
      eliminated: o.eliminated,
      hasConfirmed: o.hasConfirmed,
    })),
    status: room.status,
    createdBy: room.createdBy,
    hasGame: !!room.game,
    soloMode: room.settings.mode === "solo",
  };
}

// إخفاء الألوان عن اللاعبين
function sanitizeGameForOperatives(game) {
  return {
    ...game,
    cards: game.cards.map((c) => ({
      id: c.id,
      word: c.word,
      revealed: c.revealed,
      tempRevealed: c.tempRevealed || false,
      tempPlayerId: c.tempPlayerId || null,
      color: c.revealed ? c.color : "hidden",
    })),
  };
      }
