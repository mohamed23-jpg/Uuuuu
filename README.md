# Codenames Classic - السيرفر

سيرفر لعبة Codenames Classic العربية بتصميم نيو طوكيو سايبربانك.

## المتطلبات

- Node.js 18+
- حساب MongoDB Atlas (مجاني)
- حساب Render (مجاني)

## خطوات الرفع على Render

### 1. إعداد MongoDB Atlas

1. اذهب إلى [mongodb.com/cloud/atlas](https://mongodb.com/cloud/atlas)
2. أنشئ حساباً مجانياً
3. أنشئ Cluster جديد (M0 Free)
4. أنشئ Database User (username + password)
5. في Network Access → أضف IP: `0.0.0.0/0` (السماح لكل الـ IPs)
6. احصل على Connection String من: Connect → Drivers → Node.js
   - سيكون شكله: `mongodb+srv://username:password@cluster.mongodb.net/codenames`

### 2. رفع الملفات على Render

1. اذهب إلى [render.com](https://render.com)
2. أنشئ حساباً مجانياً
3. اختر **New Web Service**
4. ارفع الملفات عبر GitHub أو مباشرة
5. إعدادات الـ Service:
   - **Name**: codenames-classic-server
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

### 3. إضافة متغيرات البيئة في Render

في قسم **Environment**، أضف:

| المتغير | القيمة |
|--------|--------|
| `MONGODB_URI` | رابط MongoDB Atlas |
| `JWT_SECRET` | كلمة سر طويلة عشوائية (مثل: `abc123xyz...`) |
| `CLIENT_ORIGIN` | رابط Vercel (مثل: `https://codenames.vercel.app`) |
| `NODE_ENV` | `production` |

### 4. بعد الرفع

- سيعطيك Render رابطاً مثل: `https://codenames-server.onrender.com`
- **ابعت هذا الرابط للمطور لإضافته في ملفات الواجهة**

## هيكل API

### المصادقة
- `POST /api/auth/register` — تسجيل لاعب جديد
- `POST /api/auth/login` — تسجيل الدخول
- `GET /api/auth/me` — بيانات اللاعب الحالي

### اللاعبون
- `GET /api/players/:playerId` — بيانات لاعب
- `POST /api/players/:playerId/friend-request` — إرسال طلب صداقة
- `POST /api/players/friend-request/:fromId/respond` — قبول/رفض طلب
- `DELETE /api/players/:playerId/friend` — حذف صديق
- `POST /api/players/:playerId/block` — حظر
- `POST /api/players/:playerId/pin` — تثبيت
- `GET /api/players/me/friends` — قائمة الأصدقاء
- `PUT /api/players/me/settings` — تحديث الإعدادات
- `PUT /api/players/me/equip` — تجهيز عنصر

### الكلانات
- `GET /api/clans` — قائمة الكلانات
- `POST /api/clans` — إنشاء كلان (المستوى 12+، 5000 عملة)
- `POST /api/clans/:id/join` — انضمام (المستوى 5+)
- `POST /api/clans/:id/leave` — مغادرة
- `PUT /api/clans/:id/manage` — إدارة الأعضاء
- `DELETE /api/clans/:id` — حل الكلان

### المهام
- `GET /api/missions` — تقدم المهام
- `POST /api/missions/claim` — المطالبة بمكافأة

### السوق
- `GET /api/market` — عناصر السوق (المستوى 40+)
- `POST /api/market/buy` — شراء عنصر

### الإشعارات
- `GET /api/notifications` — الإشعارات
- `PUT /api/notifications/:id/read` — تعليم كمقروء
- `PUT /api/notifications/read-all` — تعليم الكل كمقروء
- `DELETE /api/notifications/:id` — حذف

### الدردشة
- `GET /api/chat/global` — سجل الدردشة العامة
- `POST /api/chat/global` — إرسال رسالة عامة
- `GET /api/chat/private/:playerId` — الرسائل الخاصة
- `POST /api/chat/private/:playerId` — إرسال رسالة خاصة

### لوحة القائد (المطور فقط)
- `GET /api/admin/stats` — إحصائيات
- `GET /api/admin/players` — إدارة اللاعبين
- `POST /api/admin/players/:id/grant` — منح عملات/XP
- `POST /api/admin/players/:id/ban` — حظر لاعب
- `POST /api/admin/broadcast` — إشعار عام
- `GET/POST /api/admin/challenges` — إدارة التحديات
- `PUT/DELETE /api/admin/challenges/:id` — تعديل/حذف تحدي
- `POST /api/admin/card-skins` — إضافة حزمة بطاقات
- `GET /api/admin/clans` — إدارة الكلانات

### الأحداث الأخرى
- `GET /api/rooms` — قائمة الغرف (HTTP)
- `GET /api/health` — فحص الصحة

## أحداث Socket.io

### من العميل → السيرفر
- `player_connect` — ربط اللاعب بـ socket
- `create_room` — إنشاء غرفة
- `join_room` — انضمام لغرفة
- `select_team_role` — اختيار الفريق والدور
- `start_game` — بدء اللعبة
- `send_hint` — إرسال تلميح (البوص)
- `select_card` — اختيار بطاقة (العميل)
- `end_turn` — إنهاء الدور
- `room_chat` — رسالة دردشة الغرفة
- `reconnect_room` — إعادة الاتصال
- `leave_room` — مغادرة الغرفة

### من السيرفر → العميل
- `connected` — تأكيد الاتصال
- `rooms_update` — تحديث قائمة الغرف
- `room_update` — تحديث الغرفة
- `player_joined` — لاعب انضم
- `player_left` — لاعب غادر
- `player_reconnected` — لاعب عاد
- `game_started` — بدأت اللعبة
- `spymaster_view` — بيانات البوص (الألوان الحقيقية)
- `game_update` — تحديث حالة اللعبة
- `hint_sent` — تلميح جديد
- `card_revealed` — بطاقة مكشوفة
- `turn_changed` — تبديل الدور
- `game_over` — انتهت اللعبة
- `room_chat` — رسالة دردشة
- `legendary_join` — دخول لاعب 98+
- `dev_join` — دخول المطور
- `notification` — إشعار جديد
- `global_chat` — رسالة دردشة عامة
- `private_message` — رسالة خاصة
- `dev_announcement` — إعلان المطور
- `banned` — تم حظرك
