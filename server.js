const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const express = require('express');
const multer = require('multer');

const { createPool } = require('./db/pool');
const { createRepository } = require('./db/repository');

loadEnv();

const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'EATSPAY_HMAC_SECRET', 'ADMIN_ROLLBACK_TOKEN'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`${key} is required for the production PostgreSQL backend.`);
  }
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const pool = createPool();
const repo = createRepository(pool);
const DEFAULT_AGENCY_NAME = '이츠페이 본사';
const MAX_ACCOUNTS_PER_FRANCHISE = 2;
const DEFAULT_DELIVERY_AGENCIES = [
  '생각대로',
  '바로고',
  '리드콜',
  '모아라인',
  '딜버',
  '만나플러스',
  '배달시대',
  '제트콜',
  '딜리온',
  '기타',
  '부릉',
  '랜(RUN)',
  '비욘드딜리버리',
  '디플러스',
  '에스런',
  '알바콜',
  '에스콜',
  '모이콜',
  '마이콜',
  '모다자유',
  '디지콜',
  '타와',
  '스피드운산',
  '배달본색',
  '배달고수',
  '오짜콜',
  '플고',
  '배달이요',
  '슈퍼자이로',
  '라이딩',
  '다배달',
  'FM',
  '날바람',
  '배달전설',
  'VIP',
  '화파',
  '비트',
  '국가대표',
  '스타딜리버리',
  '오케이콜',
  '토마토스포트',
  '나르디',
  '위드톡',
  '푸드뱅크',
  '칸',
  '날라가',
  '가유류',
  '토마토플러스',
  '콜플레이',
  '논스톱',
  '콜25',
  '배달그수',
  '위드런',
  '두바위',
  '푸드라인',
  '이초런',
  '매피콜',
  '하이브',
  '바른콜',
  '드림',
  'Korea delivery',
  '젠딜리',
  '공유다',
  '배달요',
  '국민배달',
  '뉴트랙',
  '배고파',
  '배민상회',
  '로드보이',
  'pfc',
  '로드파이터',
  '에이스콜',
  '플라이',
  '독독',
  '모두의콜',
  '배태랑',
  '크리오',
  '인프라',
  'Z',
  '청초고',
  '나이스',
  '연범',
  '국민라이더스',
  'IM극속전설',
  '런두유',
  '상인회',
  '토마토동동',
  '온나',
  '스피드딜리버리',
  '닭아콜',
  '링그',
  '푸드바이크',
  '군보이',
  '해피고2',
  '번개G',
  '타이밍',
  '배달하이로',
  'link',
  '푸드파일럿',
  '스타콜',
  '뭐하코리아',
  '런다콜',
  '배달의컨설',
  '바람처럼',
  '나르자',
  '카카오콜',
  '별리와',
  '팀릭스',
  '유니온go',
  '순간이등',
  '슈파맨',
  '다드림',
  '세이프',
  'UFO',
  '국도타이다스',
  '밍동',
  '가자이',
  '파랑무드릭',
  '파징F&S',
  '전플런'
];
const dbBootstrapPromise = (async () => {
  await pool.query('ALTER TABLE users ALTER COLUMN franchise_id DROP NOT NULL');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS biz_doc_file_key TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS pos_file_key TEXT');
  await pool.query('ALTER TABLE cards ADD COLUMN IF NOT EXISTS card_company TEXT');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS bank_name TEXT');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS delivery_agency_name TEXT');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS account_no TEXT');
  await pool.query("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'OWNER'");
  await pool.query("UPDATE users SET role = 'OWNER', updated_at = now() WHERE role = 'OWNER_PENDING'");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS delivery_agencies (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query("ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'");
  await pool.query("ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS interest_free_installments (
      card_company TEXT PRIMARY KEY,
      months INTEGER[] NOT NULL DEFAULT '{}',
      active BOOLEAN NOT NULL DEFAULT true,
      display_order INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      platform TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS talk_posts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      franchise_id BIGINT,
      franchise_name TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      price NUMERIC(14, 0) NOT NULL DEFAULT 0,
      image_url TEXT,
      image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query("ALTER TABLE talk_posts ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS talk_chats (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES talk_posts(id) ON DELETE CASCADE,
      seller_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      buyer_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(post_id, buyer_user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS talk_messages (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL REFERENCES talk_chats(id) ON DELETE CASCADE,
      sender_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id, enabled)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_talk_posts_active_created ON talk_posts(status, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_talk_chats_user_updated ON talk_chats(buyer_user_id, seller_user_id, updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_talk_messages_chat_created ON talk_messages(chat_id, created_at)');
  await repo.ensureDefaultAgency();
  await seedDeliveryAgencies();
})();
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
app.set('trust proxy', 1);
const GH_PAYMENTS_BASE_URL = (process.env.GH_PAYMENTS_BASE_URL || 'https://api.ghpayments.kr').replace(/\/$/, '');

app.get('/healthz', (req, res) => {
  return res.status(200).json({
    ok: true,
    service: 'eatspay',
    timestamp: new Date().toISOString()
  });
});

app.use((req, res, next) => {
  const allowedOrigins = (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  const requestOrigin = req.headers.origin;
  const allowAnyOrigin = allowedOrigins.includes('*');

  if (allowAnyOrigin) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
  } else if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-EATSPAY-SIGNATURE');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (/\.(html|js|css)$/i.test(req.path) || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(__dirname));
app.use('/uploads', express.static(uploadDir));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) return cb(null, true);
    return cb(new Error('INVALID_FILE_FORMAT'), false);
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, '이츠페이_관리자_시스템_10.html'));
});

app.get('/api/talk/posts', asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const [items, totalItems] = await Promise.all([
    repo.listTalkPosts({ limit, offset: (page - 1) * limit }),
    repo.countTalkPosts()
  ]);

  return res.status(200).json({
    success: true,
    data: {
      items: items.map(post => ({
        ...post,
        createdAtLabel: formatKstDateTime(post.createdAt)
      })),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalItems / limit) || 1,
        totalItems,
        limit
      }
    }
  });
}));

app.get('/api/talk/posts/:id', asyncHandler(async (req, res) => {
  const post = await repo.findTalkPostById(Number(req.params.id));
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', 'Talk 글을 찾을 수 없습니다.');
  }
  return res.status(200).json({
    success: true,
    data: {
      ...post,
      createdAtLabel: formatKstDateTime(post.createdAt)
    }
  });
}));

app.post('/api/talk/posts', authenticate, multiUpload('images', 10), asyncHandler(async (req, res) => {
  if (req.user.role === 'AGENCY') {
    return sendError(res, 403, 'ACCESS_DENIED', '대리점 계정은 Talk 글을 등록할 수 없습니다.');
  }
  if (req.user.role !== 'OWNER') {
    return sendError(res, 403, 'ACCESS_DENIED', '승인된 가맹점 계정만 Talk 글을 등록할 수 있습니다.');
  }

  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  const price = Math.max(Math.round(Number(req.body?.price || 0)), 0);
  const imageUrl = String(req.body?.imageUrl || '').trim();
  const files = Array.isArray(req.files) ? req.files : [];
  if (!title || !body) {
    return sendError(res, 400, 'MISSING_FIELDS', '제목과 내용을 입력해주세요.');
  }
  if (title.length > 80) {
    return sendError(res, 400, 'TITLE_TOO_LONG', '제목은 80자 이내로 입력해주세요.');
  }
  if (body.length > 1000) {
    return sendError(res, 400, 'BODY_TOO_LONG', '내용은 1000자 이내로 입력해주세요.');
  }
  if (files.length > 10) {
    return sendError(res, 400, 'TOO_MANY_IMAGES', '이미지는 최대 10개까지 첨부할 수 있습니다.');
  }
  if (files.some(file => !String(file.mimetype || '').startsWith('image/'))) {
    return sendError(res, 415, 'INVALID_FILE_FORMAT', '이미지 파일만 첨부할 수 있습니다.');
  }
  const uploadedFiles = [];
  for (const file of files) {
    uploadedFiles.push(await persistUpload(file, req.user.id));
  }
  const imageUrls = uploadedFiles.map(file => `/uploads/${encodeURIComponent(file.fileKey)}`);
  if (!imageUrls.length && imageUrl) imageUrls.push(imageUrl);

  const post = await repo.createTalkPost({
    userId: req.user.id,
    franchiseId: req.user.franchiseId,
    franchiseName: req.user.franchiseName || req.user.name || '이츠페이 가맹점',
    title,
    body,
    price,
    imageUrl: imageUrls[0] || '',
    imageUrls
  });

  return res.status(201).json({
    success: true,
    message: 'Talk 글이 등록되었습니다.',
    data: {
      ...post,
      createdAtLabel: formatKstDateTime(post.createdAt)
    }
  });
}));

app.post('/api/talk/posts/:id/chats', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role === 'AGENCY') {
    return sendError(res, 403, 'ACCESS_DENIED', '대리점 계정은 Talk 채팅을 이용할 수 없습니다.');
  }
  const post = await repo.findTalkPostById(Number(req.params.id));
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', 'Talk 글을 찾을 수 없습니다.');
  }
  if (post.franchiseId && req.user.franchiseId && Number(post.franchiseId) === Number(req.user.franchiseId)) {
    return sendError(res, 400, 'SELF_CHAT_NOT_ALLOWED', '내가 등록한 글에는 채팅을 시작할 수 없습니다.');
  }
  const chat = await repo.findOrCreateTalkChat({
    postId: post.id,
    sellerUserId: post.userId,
    buyerUserId: req.user.id
  });
  return res.status(200).json({ success: true, data: chat });
}));

app.get('/api/talk/chats', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role === 'AGENCY') {
    return sendError(res, 403, 'ACCESS_DENIED', '대리점 계정은 Talk 채팅을 이용할 수 없습니다.');
  }
  const chats = await repo.listTalkChatsByUser(req.user.id);
  return res.status(200).json({
    success: true,
    data: chats.map(chat => ({
      ...chat,
      lastMessageAtLabel: chat.lastMessageAt ? formatKstDateTime(chat.lastMessageAt) : ''
    }))
  });
}));

app.get('/api/talk/chats/:id/messages', authenticate, asyncHandler(async (req, res) => {
  const chat = await repo.findTalkChatForUser(Number(req.params.id), req.user.id);
  if (!chat) {
    return sendError(res, 404, 'TALK_CHAT_NOT_FOUND', '채팅방을 찾을 수 없습니다.');
  }
  await repo.markTalkMessagesRead(chat.id, req.user.id);
  const messages = await repo.listTalkMessages(chat.id);
  return res.status(200).json({
    success: true,
    data: {
      chat,
      messages: messages.map(message => ({
        ...message,
        createdAtLabel: formatKstDateTime(message.createdAt)
      }))
    }
  });
}));

app.post('/api/talk/chats/:id/messages', authenticate, asyncHandler(async (req, res) => {
  const chat = await repo.findTalkChatForUser(Number(req.params.id), req.user.id);
  if (!chat) {
    return sendError(res, 404, 'TALK_CHAT_NOT_FOUND', '채팅방을 찾을 수 없습니다.');
  }
  const message = String(req.body?.message || '').trim();
  if (!message) {
    return sendError(res, 400, 'MISSING_MESSAGE', '메시지를 입력해주세요.');
  }
  if (message.length > 1000) {
    return sendError(res, 400, 'MESSAGE_TOO_LONG', '메시지는 1000자 이내로 입력해주세요.');
  }
  const created = await repo.createTalkMessage({
    chatId: chat.id,
    senderUserId: req.user.id,
    message
  });
  return res.status(201).json({
    success: true,
    data: {
      ...created,
      createdAtLabel: formatKstDateTime(created.createdAt)
    }
  });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return sendError(res, 400, 'BAD_REQUEST', 'email and password are required.');
  }

  const user = await repo.findUserByEmail(email);
  if (user?.passwordHash && await verifyPassword(password, user.passwordHash)) {
    return res.status(200).json({
      success: true,
      data: {
        accessToken: signToken(user),
        tokenType: 'Bearer',
        expiresIn: 86400,
        user: publicUser(user)
      }
    });
  }

  const agency = await repo.findAgencyByLoginId(email);
  if (!agency || !agency.passwordHash || !(await verifyPassword(password, agency.passwordHash))) {
    return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  return res.status(200).json({
    success: true,
    data: {
      accessToken: signToken(agencyPrincipal(agency)),
      tokenType: 'Bearer',
      expiresIn: 86400,
      user: publicUser(agencyPrincipal(agency))
    }
  });
}));

app.post('/api/auth/verify-business', asyncHandler(async (req, res) => {
  const { businessNumber } = req.body;
  if (!businessNumber) {
    return sendError(res, 400, 'BAD_REQUEST', '사업자등록번호를 입력해 주세요.');
  }

  const clean = businessNumber.replace(/[^0-9]/g, '');
  if (clean.length !== 10) {
    return sendError(res, 400, 'INVALID_FORMAT', '사업자등록번호 10자리를 입력해 주세요.');
  }

  const duplicate = await repo.findUserByBusinessNumber(clean);
  if (duplicate) {
    return sendError(res, 409, 'ALREADY_EXISTS', '이미 가입된 사업자등록번호입니다.');
  }

  if (!(await verifyBusinessNumber(clean))) {
    return sendError(res, 400, 'VERIFICATION_FAILED', '사업자등록번호를 확인할 수 없습니다.');
  }

  return res.status(200).json({
    success: true,
    message: '사업자등록번호가 확인되었습니다.',
    data: { businessNumber, status: 'ACTIVE', taxType: 'GENERAL' }
  });
}));

app.post('/api/auth/register', upload.fields([
  { name: 'bizLicenseFile', maxCount: 1 }
]), asyncHandler(async (req, res) => {
  const { email, password, phone, storeName, ceoName, address, tel, businessNumber } = req.body;
  if (!email || !password || !storeName || !ceoName || !businessNumber) {
    return sendError(res, 400, 'BAD_REQUEST', '회원가입 필수 정보를 모두 입력해 주세요.');
  }

  const existingUser = await repo.findUserByEmail(email);
  if (existingUser) {
    return sendError(res, 409, 'ALREADY_EXISTS', '이미 사용 중인 아이디입니다.');
  }

  const existingBusiness = await repo.findUserByBusinessNumber(businessNumber);
  if (existingBusiness) {
    return sendError(res, 409, 'ALREADY_EXISTS', '이미 가입된 사업자등록번호입니다.');
  }

  const defaultAgency = await repo.ensureDefaultAgency();
  const bizLicenseFile = req.files?.bizLicenseFile?.[0] || null;
  const bizDoc = bizLicenseFile ? await persistUpload(bizLicenseFile, null) : null;
  const user = await repo.createUser({
    email,
    passwordHash: await hashPassword(password),
    name: ceoName,
    franchiseName: storeName,
    phone,
    address,
    tel,
    businessNumber,
    agencyId: defaultAgency?.id || null,
    bizDocFileKey: bizDoc?.fileKey || null
  });

  return res.status(201).json({
    success: true,
    message: '가입이 완료되었습니다.',
    data: {
      id: user.id,
      email: user.email,
      storeName: user.franchiseName,
      role: user.role
    }
  });
}));

app.post('/api/auth/social', asyncHandler(async (req, res) => {
  const { provider } = req.body;
  const allowedProviders = ['KAKAO', 'NAVER', 'GOOGLE'];
  if (!provider || !allowedProviders.includes(provider.toUpperCase())) {
    return sendError(res, 400, 'INVALID_PROVIDER', 'Unsupported social provider.');
  }

  return sendError(res, 501, 'SOCIAL_LOGIN_NOT_CONFIGURED', 'Real social OAuth integration is not configured yet.');
}));

app.get('/api/auth/me', authenticate, asyncHandler(async (req, res) => {
  const user = await repo.findUserById(req.user.id);
  if (!user) {
    return sendError(res, 404, 'USER_NOT_FOUND', 'User was not found.');
  }

  return res.status(200).json({
    success: true,
    data: {
      user: publicUser(user)
    }
  });
}));

app.get('/api/notifications/unread', authenticate, asyncHandler(async (req, res) => {
  const notifications = await repo.listUnreadNotifications(req.user.id);
  return res.status(200).json({
    success: true,
    data: notifications
  });
}));

app.post('/api/notifications/read', authenticate, asyncHandler(async (req, res) => {
  const marked = await repo.markNotificationsRead(req.user.id, req.body?.ids || []);
  return res.status(200).json({
    success: true,
    data: marked
  });
}));

app.post('/api/push-token', authenticate, asyncHandler(async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) {
    return sendError(res, 400, 'MISSING_PUSH_TOKEN', 'push token is required.');
  }
  await repo.upsertPushToken(req.user.id, token, req.body?.platform || null);
  return res.status(200).json({
    success: true,
    message: 'Push token registered.'
  });
}));

app.patch('/api/auth/me', authenticate, asyncHandler(async (req, res) => {
  const user = await repo.findUserById(req.user.id);
  if (!user) {
    return sendError(res, 404, 'USER_NOT_FOUND', 'User was not found.');
  }

  const { phone, currentPassword, newPassword } = req.body || {};
  const fields = {};
  if (phone !== undefined) {
    const cleanPhone = String(phone || '').trim();
    if (cleanPhone && cleanPhone.replace(/[^0-9]/g, '').length < 10) {
      return sendError(res, 400, 'INVALID_PHONE', 'A valid phone number is required.');
    }
    fields.phone = cleanPhone || null;
  }

  if (newPassword !== undefined && String(newPassword).length > 0) {
    if (String(newPassword).length < 4) {
      return sendError(res, 400, 'INVALID_PASSWORD', 'Password must be at least 4 characters.');
    }
    if (!currentPassword || !user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return sendError(res, 401, 'INVALID_CURRENT_PASSWORD', 'Current password is invalid.');
    }
    fields.passwordHash = await hashPassword(newPassword);
  }

  if (!Object.keys(fields).length) {
    return sendError(res, 400, 'NO_CHANGES', 'No profile changes were submitted.');
  }

  const updated = await repo.updateUserProfile(user.id, fields);
  return res.status(200).json({
    success: true,
    data: {
      user: publicUser(updated)
    }
  });
}));

app.patch('/api/admin/me/password', authenticateAdmin, asyncHandler(async (req, res) => {
  const user = await repo.findUserById(req.user.id);
  if (!user || user.role !== 'ADMIN') {
    return sendError(res, 404, 'ADMIN_NOT_FOUND', 'Admin account was not found.');
  }

  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!currentPassword || !newPassword) {
    return sendError(res, 400, 'MISSING_PASSWORD', '현재 비밀번호와 새 비밀번호를 입력해주세요.');
  }
  if (newPassword.length < 8) {
    return sendError(res, 400, 'INVALID_PASSWORD', '관리자 비밀번호는 8자 이상으로 입력해주세요.');
  }
  if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return sendError(res, 401, 'INVALID_CURRENT_PASSWORD', '현재 비밀번호가 일치하지 않습니다.');
  }

  await repo.updateUserProfile(user.id, {
    passwordHash: await hashPassword(newPassword)
  });

  return res.status(200).json({
    success: true,
    message: '관리자 비밀번호가 변경되었습니다.'
  });
}));

app.post('/api/franchise/accounts', authenticate, (req, res) => {
  upload.single('documentFile')(req, res, async err => {
    try {
      if (err) {
        if (err.message === 'INVALID_FILE_FORMAT') {
          return sendError(res, 415, 'INVALID_FILE_FORMAT', 'Only pdf, jpg, jpeg, and png files are allowed.');
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(res, 413, 'FILE_SIZE_LIMIT_EXCEEDED', 'Attachment size must be 10MB or less.');
        }
        return sendError(res, 400, 'UPLOAD_ERROR', err.message);
      }

      const user = await repo.findUserById(req.user.id);
      if (!user) {
        return sendError(res, 404, 'USER_NOT_FOUND', 'User was not found.');
      }

      const { franchiseName, businessNumber, bankCode, bankName, deliveryAgencyName, accountNo, representativeName } = req.body;
      const resolvedFranchiseName = franchiseName || user.franchiseName;
      const rawBusinessNumber = String(businessNumber || user.businessNumber || '').replace(/[^0-9]/g, '');
      const resolvedBusinessNumber = rawBusinessNumber.length === 10
        ? `${rawBusinessNumber.slice(0, 3)}-${rawBusinessNumber.slice(3, 5)}-${rawBusinessNumber.slice(5)}`
        : (businessNumber || user.businessNumber || '');
      const resolvedRepresentativeName = representativeName || user.name;

      if (!resolvedBusinessNumber || !/^\d{3}-\d{2}-\d{5}$/.test(resolvedBusinessNumber)) {
        return sendError(res, 400, 'INVALID_BUSINESS_NUMBER', 'businessNumber must match XXX-XX-XXXXX.');
      }
      if (!resolvedFranchiseName || !bankCode || !bankName || !deliveryAgencyName || !accountNo || !resolvedRepresentativeName) {
        return sendError(res, 400, 'MISSING_FIELDS', 'franchiseName, bankCode, bankName, deliveryAgencyName, accountNo, and representativeName are required.');
      }
      if (!/^[0-9-]{8,30}$/.test(String(accountNo))) {
        return sendError(res, 400, 'INVALID_ACCOUNT_NO', 'accountNo must contain 8 to 30 digits or hyphens.');
      }
      if (!req.file) {
        return sendError(res, 400, 'DOCUMENT_FILE_REQUIRED', 'A POS photo attachment is required.');
      }
      const currentAccountCount = await repo.countAccountsByFranchise(req.user.franchiseId);
      if (currentAccountCount >= MAX_ACCOUNTS_PER_FRANCHISE) {
        return sendError(res, 409, 'ACCOUNT_LIMIT_EXCEEDED', '가맹점당 출금계좌는 최대 2개까지 등록할 수 있습니다.');
      }

      const uploadedFile = await persistUpload(req.file, req.user.id);
      const request = await repo.createAccountRequest({
        requestId: generateId('REQ', 4),
        franchiseId: req.user.franchiseId,
        franchiseName: resolvedFranchiseName,
        businessNumber: resolvedBusinessNumber,
        bankCode,
        bankName,
        deliveryAgencyName,
        accountNo,
        representativeName: resolvedRepresentativeName,
        documentUrl: `/uploads/${encodeURIComponent(uploadedFile.fileKey)}`
      });

      return res.status(202).json({
        success: true,
        message: 'Virtual account request submitted.',
        data: request
      });
    } catch (error) {
      return handleError(error, res);
    }
  });
});

app.get('/api/installments/current', asyncHandler(async (req, res) => {
  const items = await repo.listInterestFreeInstallments({ onlyActive: true });
  return res.status(200).json({ success: true, data: items });
}));

app.get('/api/franchise/accounts', authenticate, asyncHandler(async (req, res) => {
  const [requests, deliveryAccounts] = await Promise.all([
    repo.listAccountRequestsByFranchise(req.user.franchiseId),
    repo.listDeliveryAccountsByFranchise(req.user.franchiseId)
  ]);

  const statusLabel = status => {
    if (status === 'APPROVED') return '\uC2B9\uC778\uC644\uB8CC';
    if (status === 'REJECTED') return '\uBC18\uB824';
    return '\uC2B9\uC778\uB300\uAE30';
  };

  const requestItems = requests.map(request => ({
    id: request.requestId,
    source: 'account_request',
    franchiseId: request.franchiseId,
    franchiseName: request.franchiseName,
    agencyName: request.deliveryAgencyName || '',
    bankName: request.bankName || '',
    accountNo: request.accountNo || request.assignedVirtualAccount?.accountNumber || '',
    accountHolder: request.representativeName,
    fileName: request.documentUrl ? path.basename(request.documentUrl) : '',
    status: request.status,
    statusLabel: statusLabel(request.status),
    requestedAt: request.submittedAt,
    rejectionReason: request.rejectionReason || ''
  }));

  const deliveryItems = deliveryAccounts.map(account => ({
    id: account.id,
    source: 'delivery_account',
    franchiseId: account.franchiseId,
    agencyName: account.agencyName,
    bankName: account.bankName,
    accountNo: account.accountNo,
    accountHolder: account.accountHolder,
    fileName: account.fileKey || '',
    status: account.accountStatus,
    statusLabel: statusLabel(account.accountStatus),
    requestedAt: account.reqDate,
    rejectionReason: account.rejectionReason || ''
  }));

  return res.status(200).json({
    success: true,
    data: [...requestItems, ...deliveryItems].sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0))
  });
}));

app.delete('/api/franchise/accounts/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const source = String(req.query.source || '').trim();
  let deleted = null;

  if (source === 'delivery_account' || (/^\d+$/.test(id) && source !== 'account_request')) {
    deleted = await repo.deleteDeliveryAccountByFranchise(Number(id), req.user.franchiseId);
  } else {
    deleted = await repo.deleteAccountRequestByFranchise(id, req.user.franchiseId);
  }

  if (!deleted) {
    return sendError(res, 404, 'ACCOUNT_NOT_FOUND', 'Virtual account was not found.');
  }

  return res.status(200).json({
    success: true,
    message: 'Virtual account deleted.',
    data: {
      id,
      source: source || (typeof deleted.id === 'number' ? 'delivery_account' : 'account_request')
    }
  });
}));

app.all('/api/ghpayments/echo', authenticateAdmin, asyncHandler(async (req, res) => {
  const proxyResponse = await ghPaymentsRequest('/api/echo', {
    method: req.method,
    body: req.method === 'GET' ? undefined : req.body
  });
  return relayProviderResponse(proxyResponse, res);
}));

app.post('/api/ghpayments/billing/reg', authenticateAdmin, asyncHandler(async (req, res) => {
  const proxyResponse = await ghPaymentsRequest('/api/billing/reg', {
    method: 'POST',
    body: req.body
  });
  return relayProviderResponse(proxyResponse, res);
}));

app.get('/api/ghpayments/billing/delete/:rebillId', authenticateAdmin, asyncHandler(async (req, res) => {
  const proxyResponse = await ghPaymentsRequest(`/api/billing/delete/${encodeURIComponent(req.params.rebillId)}`, {
    method: 'GET'
  });
  return relayProviderResponse(proxyResponse, res);
}));

app.post('/api/ghpayments/billing/pay', authenticateAdmin, asyncHandler(async (req, res) => {
  const proxyResponse = await ghPaymentsRequest('/api/billing/pay', {
    method: 'POST',
    body: req.body
  });
  return relayProviderResponse(proxyResponse, res);
}));

app.post('/api/ghpayments/refund', authenticateAdmin, asyncHandler(async (req, res) => {
  const proxyResponse = await ghPaymentsRequest('/api/refund', {
    method: 'POST',
    body: req.body
  });
  return relayProviderResponse(proxyResponse, res);
}));

app.all('/api/ghpayments/get', authenticateAdmin, asyncHandler(async (req, res) => {
  const proxyResponse = await ghPaymentsRequest('/api/get', {
    method: req.method,
    body: req.method === 'GET' ? undefined : req.body
  });
  return relayProviderResponse(proxyResponse, res);
}));

app.post('/api/payment/charge', authenticate, asyncHandler(async (req, res) => {
  const { amount, calculatedFee, totalAmount, cardId, installment = 0 } = req.body;
  if (!amount || !calculatedFee || !totalAmount || !cardId) {
    return sendError(res, 400, 'MISSING_FIELDS', 'amount, calculatedFee, totalAmount, and cardId are required.');
  }

  const expectedFee = Math.floor(Number(amount) * 0.04602);
  if (Number(calculatedFee) !== expectedFee || Number(totalAmount) !== Number(amount) + expectedFee) {
    return sendError(res, 400, 'FEE_MISMATCH', 'Fee calculation mismatch.');
  }

  if (Number(amount) > 10000000) {
    return sendError(res, 402, 'CARD_LIMIT_EXCEEDED', 'Card limit exceeded.');
  }

  const useProvider = hasGhPaymentsPayKey() && String(cardId).startsWith('rb_');
  if (useProvider) {
    const transactionId = generateId('TXN', 7);
    const providerResponse = await ghPaymentsRequest('/api/billing/pay', {
      method: 'POST',
      body: {
        billing: {
          rebillId: cardId,
          trackId: transactionId,
          amount: Number(totalAmount),
          installment: Number(installment) || 0
        }
      }
    });

    const payload = await providerResponse.json().catch(() => ({}));
    if (!providerResponse.ok || payload?.result?.resultCd !== '0000') {
      const providerMessage = payload?.result?.advanceMsg || payload?.result?.resultMsg || payload?.message || 'Payment failed at payment provider.';
      return sendError(res, providerResponse.status || 502, 'GH_PAYMENTS_BILLING_PAY_FAILED', providerMessage, payload);
    }

    const providerCard = payload.pay?.card || {};
    const cardDetails = `${providerCard.issuer || providerCard.cardType || 'CARD'} (****-****-${providerCard.last4 || String(cardId).slice(-4)})`;
    const result = await repo.recordCharge({
      userId: req.user.id,
      franchiseId: req.user.franchiseId,
      transactionId,
      amount: Number(amount),
      fee: expectedFee,
      totalAmount: Number(totalAmount),
      method: 'CARD',
      cardDetails
    });

    return res.status(200).json({
      success: true,
      data: {
        transactionId,
        status: 'PAID',
        amount: Number(amount),
        fee: expectedFee,
        totalAmount: Number(totalAmount),
        approvedAt: new Date().toISOString(),
        updatedBalance: result.updatedBalance,
        provider: 'GH_PAYMENTS',
        providerResult: payload
      }
    });
  }

  const transactionId = generateId('TXN', 7);
  const result = await repo.recordCharge({
    userId: req.user.id,
    franchiseId: req.user.franchiseId,
    transactionId,
    amount: Number(amount),
    fee: expectedFee,
    totalAmount: Number(totalAmount),
    method: 'CARD',
    cardDetails: `card:${cardId}`
  });

  return res.status(200).json({
    success: true,
    data: {
      transactionId,
      status: 'PAID',
      amount: Number(amount),
      fee: expectedFee,
      totalAmount: Number(totalAmount),
      approvedAt: new Date().toISOString(),
      updatedBalance: result.updatedBalance
    }
  });
}));

app.get('/api/payment/history', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role === 'AGENCY') {
    return sendError(res, 403, 'ACCESS_DENIED', 'Agency accounts must use the agency settlement API.');
  }
  const { startDate, endDate, type = 'ALL', page = 1, limit = 10 } = req.query;
  if (!startDate || !endDate) {
    return sendError(res, 400, 'MISSING_DATE_FILTER', 'startDate and endDate are required.');
  }

  const pNum = Math.max(parseInt(page, 10) || 1, 1);
  const lNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const { items, totalItems } = await repo.listTransactions({
    startDate,
    endDate,
    type,
    limit: lNum,
    offset: (pNum - 1) * lNum,
    role: req.user.franchiseId ? 'OWNER' : req.user.role,
    franchiseId: req.user.franchiseId
  });
  const historyItems = items.map(item => ({
    ...item,
    statusLabel: item.status === 'SUCCESS' ? '결제완료' : item.status === 'ROLLED_BACK' ? '취소' : item.status,
    paymentDate: formatKstDateTime(item.createdAt)
  }));

  return res.status(200).json({
    success: true,
    data: {
      items: historyItems,
      pagination: {
        currentPage: pNum,
        totalPages: Math.ceil(totalItems / lNum) || 1,
        totalItems,
        limit: lNum
      }
    }
  });
}));

app.get('/api/agency/me/settlements', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role !== 'AGENCY') {
    return sendError(res, 403, 'ACCESS_DENIED', 'Agency role is required.');
  }
  const { startDate, endDate, page = 1, limit = 10 } = req.query;
  if (!startDate || !endDate) {
    return sendError(res, 400, 'MISSING_DATE_FILTER', 'startDate and endDate are required.');
  }

  const pNum = Math.max(parseInt(page, 10) || 1, 1);
  const lNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 300);
  const { items, totalItems } = await repo.listAgencyTransactions({
    startDate,
    endDate,
    agencyId: req.user.agencyId,
    limit: lNum,
    offset: (pNum - 1) * lNum
  });
  const agencyRate = Number(req.user.feeRate || 0.3);
  const rows = items.map(item => {
    const paymentAmount = Number(item.totalAmount || 0);
    const serviceFee = Number(item.fee || 0);
    const depositAmount = Number(item.amount || Math.max(paymentAmount - serviceFee, 0));
    const agencyFee = Math.round(paymentAmount * (agencyRate / 100));
    const agencyNet = Math.round(agencyFee * 0.967);
    return {
      id: item.transactionId,
      date: formatKstDateTime(item.createdAt),
      approvalNo: item.transactionId,
      franchiseId: item.franchiseId,
      franchiseName: item.franchiseName || `가맹점 ${item.franchiseId}`,
      paymentAmount,
      depositAmount,
      serviceFee,
      agencyFee,
      agencyNet,
      status: item.status === 'SUCCESS' ? '결제완료' : item.status === 'ROLLED_BACK' ? '취소' : item.status
    };
  });
  const summary = rows.reduce((acc, row) => {
    acc.count += 1;
    acc.paymentAmount += row.paymentAmount;
    acc.depositAmount += row.depositAmount;
    acc.serviceFee += row.serviceFee;
    acc.agencyFee += row.agencyFee;
    acc.agencyNet += row.agencyNet;
    return acc;
  }, { count: 0, paymentAmount: 0, depositAmount: 0, serviceFee: 0, agencyFee: 0, agencyNet: 0 });

  return res.status(200).json({
    success: true,
    data: {
      agency: {
        id: req.user.agencyId,
        name: req.user.agencyName,
        feeRate: agencyRate
      },
      period: { startDate, endDate },
      summary,
      items: rows,
      pagination: {
        currentPage: pNum,
        totalPages: Math.ceil(totalItems / lNum) || 1,
        totalItems,
        limit: lNum
      }
    }
  });
}));

app.get('/api/card/list', authenticate, asyncHandler(async (req, res) => {
  const cards = await repo.listCardsByUserId(req.user.id);
  return res.status(200).json({
    success: true,
    data: cards
  });
}));

app.put('/api/card/:id', authenticate, asyncHandler(async (req, res) => {
  const cardCompany = String(req.body.cardCompany || '').trim();
  const alias = String(req.body.alias || '').trim();
  const digits = String(req.body.cardNumber || '').replace(/\D/g, '');
  if (!cardCompany) {
    return sendError(res, 400, 'MISSING_CARD_COMPANY', 'cardCompany is required.');
  }
  if (!alias) {
    return sendError(res, 400, 'MISSING_ALIAS', 'alias is required.');
  }
  if (digits && digits.length !== 16) {
    return sendError(res, 400, 'INVALID_CARD_NUMBER', 'cardNumber must contain 16 digits.');
  }

  const updated = await repo.updateCardByUserId(req.params.id, req.user.id, {
    maskedNumber: digits ? `****-****-****-${digits.slice(-4)}` : null,
    cardName: cardCompany,
    cardCompany,
    alias
  });
  if (!updated) {
    return sendError(res, 404, 'CARD_NOT_FOUND', 'Card was not found.');
  }

  return res.status(200).json({
    success: true,
    message: 'Card updated.',
    data: updated
  });
}));

app.delete('/api/card/:id', authenticate, asyncHandler(async (req, res) => {
  const deleted = await repo.deleteCardByUserId(req.params.id, req.user.id);
  if (!deleted) {
    return sendError(res, 404, 'CARD_NOT_FOUND', 'Card was not found.');
  }

  return res.status(200).json({
    success: true,
    message: 'Card deleted.',
    data: {
      id: deleted.id
    }
  });
}));

app.post('/api/card/register', authenticate, asyncHandler(async (req, res) => {
  const { cardNumber, cardPw, expiryMonth, expiryYear, identity, alias, cardCompany } = req.body;
  if (!cardNumber || !cardPw || !expiryMonth || !expiryYear || !identity) {
    return sendError(res, 400, 'BAD_REQUEST', 'Card details are required.');
  }

  const digits = String(cardNumber).replace(/[^0-9]/g, '');
  if (digits.length < 12 || digits.length > 19) {
    return sendError(res, 400, 'INVALID_CARD_NUMBER', 'Card number format is invalid.');
  }

  const count = await repo.countCardsByUserId(req.user.id);
  const resolvedAlias = alias || (count === 0 ? 'Primary card' : `Card ${count + 1}`);
  const resolvedCompany = String(cardCompany || '').trim();
  if (!resolvedCompany) {
    return sendError(res, 400, 'MISSING_CARD_COMPANY', 'Card company is required.');
  }

  if (hasGhPaymentsPayKey()) {
    const response = await ghPaymentsRequest('/api/billing/reg', {
      method: 'POST',
      body: {
        rebill: {
          trackId: generateId('CARD', 6),
          cardNumber: digits,
          cardExpireDate: formatCardExpireDate(expiryMonth, expiryYear),
          cardPassword: String(cardPw).replace(/[^0-9]/g, '').slice(0, 2),
          socialNumber: String(identity).replace(/[^0-9]/g, ''),
          productName: 'eats PAY 카드 등록',
          payerName: req.user.name || '',
          payerEmail: req.user.email || '',
          payerTel: req.user.phone || ''
        }
      }
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.result?.resultCd !== '0000') {
      const providerMessage = payload?.result?.advanceMsg || payload?.result?.resultMsg || payload?.message || 'Card registration failed at payment provider.';
      return sendError(res, response.status || 502, 'GH_PAYMENTS_CARD_REGISTRATION_FAILED', providerMessage, payload);
    }

    const rebill = payload.rebill || {};
    const providerCardId = rebill.rebillId || `card_ref_${crypto.randomUUID()}`;
    const cardName = rebill.issueCompanyName || rebill.buyCompanyName || resolvedCompany || inferCardName(digits);
    const maskedNumber = rebill.cardNumber || `${cardName} (****-****-${digits.slice(-4)})`;
    const card = await repo.registerCard(req.user.id, {
      id: providerCardId,
      maskedNumber,
      cardName,
      cardCompany: resolvedCompany,
      alias: resolvedAlias
    });

    return res.status(200).json({
      success: true,
      message: 'Card registered through GH Payments.',
      data: {
        ...card,
        provider: 'GH_PAYMENTS',
        rebillId: providerCardId,
        providerResult: payload.result || null
      }
    });
  }

  const cardName = resolvedCompany || inferCardName(digits);
  const last4 = digits.slice(-4);
  const card = await repo.registerCard(req.user.id, {
    id: `card_ref_${crypto.randomUUID()}`,
    maskedNumber: `****-****-****-${last4}`,
    cardName,
    cardCompany: resolvedCompany,
    alias: resolvedAlias
  });

  return res.status(200).json({
    success: true,
    message: 'Card registered.',
    data: card
  });
}));

app.post('/api/admin/accounts/approve', authenticateAdmin, asyncHandler(async (req, res) => {
  const { requestId, action, assignedVirtualAccount, rejectionReason } = req.body;
  const request = await repo.findAccountRequest(requestId);
  if (!request) {
    return sendError(res, 404, 'REQUEST_NOT_FOUND', 'Account request was not found.');
  }
  if (request.status !== 'PENDING') {
    return sendError(res, 409, 'ALREADY_PROCESSED', 'Account request is already processed.');
  }

  let updated;
  if (action === 'APPROVED') {
    if (!assignedVirtualAccount || !assignedVirtualAccount.accountNumber) {
      return sendError(res, 400, 'MISSING_ACCOUNT_INFO', 'assignedVirtualAccount.accountNumber is required.');
    }
    updated = await repo.updateAccountRequest(requestId, { status: 'APPROVED', assignedVirtualAccount });
  } else if (action === 'REJECTED') {
    if (!rejectionReason) {
      return sendError(res, 400, 'MISSING_REJECTION_REASON', 'rejectionReason is required.');
    }
    updated = await repo.updateAccountRequest(requestId, { status: 'REJECTED', rejectionReason });
  } else {
    return sendError(res, 400, 'INVALID_ACTION', 'action must be APPROVED or REJECTED.');
  }

  const owner = await repo.findUserByFranchiseId(request.franchiseId);
  if (owner) {
    const approved = action === 'APPROVED';
    await repo.createNotification({
      userId: owner.id,
      type: approved ? 'ACCOUNT_APPROVED' : 'ACCOUNT_REJECTED',
      title: approved ? '가상계좌가 승인되었습니다.' : '가상계좌가 반려되었습니다.',
      body: approved
        ? `${request.deliveryAgencyName || '배달대행사'} 가상계좌가 승인되었습니다.`
        : `${request.deliveryAgencyName || '배달대행사'} 가상계좌가 반려되었습니다.${rejectionReason ? `\n사유: ${rejectionReason}` : ''}`,
      data: {
        requestId,
        action,
        deliveryAgencyName: request.deliveryAgencyName,
        accountNo: request.accountNo,
        assignedVirtualAccount: action === 'APPROVED' ? assignedVirtualAccount : null
      }
    });
  }

  return res.status(200).json({
    success: true,
    message: 'Account request processed.',
    data: {
      requestId: updated.requestId,
      status: updated.status,
      approvedBy: req.user.name,
      processedAt: new Date().toISOString()
    }
  });
}));

app.post('/api/franchise/:id/reset-password', authenticateAdmin, asyncHandler(async (req, res) => {
  const franchiseId = Number(req.params.id);
  const temporaryPassword = createTemporaryPassword();
  const user = await repo.updateUserPasswordByFranchiseId(franchiseId, await hashPassword(temporaryPassword));
  if (!user) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', 'Franchise was not found.');
  }

  return res.status(200).json({
    success: true,
    data: {
      franchiseId,
      temporaryPassword,
      resetAt: new Date().toISOString()
    }
  });
}));

app.post('/api/agency/:id/reset-password', authenticateAdmin, asyncHandler(async (req, res) => {
  const agencyId = Number(req.params.id);
  const temporaryPassword = createTemporaryPassword();
  const agency = await repo.updateAgencyPasswordById(agencyId, await hashPassword(temporaryPassword));
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }

  return res.status(200).json({
    success: true,
    data: {
      agencyId,
      temporaryPassword,
      resetAt: new Date().toISOString()
    }
  });
}));

app.get('/api/files/:fileName', authenticateAdmin, asyncHandler(async (req, res) => {
  const fileKey = safeFileKey(req.params.fileName);
  const file = await repo.findFileByKey(fileKey);
  if (!file) {
    return sendError(res, 404, 'FILE_NOT_FOUND', 'File was not found.');
  }

  return res.status(200).json({
    success: true,
    data: {
      fileName: file.fileKey,
      originalName: file.originalName,
      mimeType: file.mimeType,
      url: file.publicUrl || `/uploads/${encodeURIComponent(file.fileKey)}`
    }
  });
}));

app.post('/api/franchise/:id/biz-doc', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  const franchiseId = Number(req.params.id);
  if (!req.file) {
    return sendError(res, 400, 'MISSING_FILE', 'file is required.');
  }

  const file = await persistUpload(req.file, req.user.id);
  const user = await repo.updateFranchiseBizDoc(franchiseId, file.fileKey);
  if (!user) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', 'Franchise was not found.');
  }

  return res.status(200).json({
    success: true,
    data: {
      franchiseId,
      bizDocFile: file.fileKey,
      url: `/uploads/${encodeURIComponent(file.fileKey)}`
    }
  });
}));

app.post('/api/franchise/:id/delivery-accounts', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  const franchiseId = Number(req.params.id);
  const { agencyId, agencyName, bankName, accountHolder, accountNo } = req.body;
  if (!agencyName || !bankName || !accountHolder || !accountNo) {
    return sendError(res, 400, 'MISSING_FIELDS', 'agencyName, bankName, accountHolder, and accountNo are required.');
  }
  const currentAccountCount = await repo.countAccountsByFranchise(franchiseId);
  if (currentAccountCount >= MAX_ACCOUNTS_PER_FRANCHISE) {
    return sendError(res, 409, 'ACCOUNT_LIMIT_EXCEEDED', '가맹점당 출금계좌는 최대 2개까지 등록할 수 있습니다.');
  }

  const file = req.file ? await persistUpload(req.file, req.user.id) : null;
  const account = await repo.addDeliveryAccount({
    franchiseId,
    agencyId: agencyId ? Number(agencyId) : null,
    agencyName,
    bankName,
    accountHolder,
    accountNo,
    fileKey: file?.fileKey || null
  });

  return res.status(201).json({
    success: true,
    message: 'Delivery agency account submitted for review.',
    data: account
  });
}));

app.post('/api/agency/:id/settle-account', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  const agencyId = Number(req.params.id);
  const { bankName, accountNo, accountHolder } = req.body;
  if (!bankName || !accountNo || !accountHolder) {
    return sendError(res, 400, 'MISSING_FIELDS', 'bankName, accountNo, and accountHolder are required.');
  }

  const file = req.file ? await persistUpload(req.file, req.user.id) : null;
  const agency = await repo.updateAgencySettleAccount(agencyId, {
    bankName,
    accountNo,
    accountHolder,
    fileKey: file?.fileKey || null
  });
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }

  return res.status(200).json({ success: true, data: agency });
}));

app.post('/api/agency/:id/contract', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  const agencyId = Number(req.params.id);
  if (!req.file) {
    return sendError(res, 400, 'MISSING_FILE', 'file is required.');
  }

  const file = await persistUpload(req.file, req.user.id);
  const agency = await repo.updateAgencyContractFile(agencyId, file.fileKey);
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }

  return res.status(200).json({
    success: true,
    data: {
      agencyId,
      contractFile: file.fileKey,
      url: `/uploads/${encodeURIComponent(file.fileKey)}`
    }
  });
}));

app.get('/api/pg/settlements', authenticateAdmin, asyncHandler(async (req, res) => {
  const { startDate, endDate, agencyId, status, page = 1, limit = 50 } = req.query;
  const pNum = Math.max(parseInt(page, 10) || 1, 1);
  const lNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const result = await repo.listPgSettlements({
    startDate,
    endDate,
    agencyId: agencyId ? Number(agencyId) : null,
    status,
    limit: lNum,
    offset: (pNum - 1) * lNum
  });

  return res.status(200).json({
    success: true,
    data: {
      items: result.items,
      pagination: {
        currentPage: pNum,
        totalPages: Math.ceil(result.totalItems / lNum) || 1,
        totalItems: result.totalItems,
        limit: lNum
      }
    }
  });
}));

app.post('/api/settle/export', authenticateAdmin, asyncHandler(async (req, res) => {
  const { startDate, endDate, agencyId, status } = req.body || {};
  const result = await repo.listPgSettlements({
    startDate,
    endDate,
    agencyId: agencyId ? Number(agencyId) : null,
    status,
    limit: 5000,
    offset: 0
  });
  const csv = toCsv(result.items);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="settlements.csv"');
  return res.status(200).send(`\uFEFF${csv}`);
}));

app.post('/api/admin/settlement/rollback', authenticateAdmin, verifySignature, asyncHandler(async (req, res) => {
  const { targetTransactionId, reason, doubleAuthToken } = req.body;
  if (!reason) {
    return sendError(res, 400, 'MISSING_REASON', 'reason is required.');
  }
  if (!doubleAuthToken || doubleAuthToken !== process.env.ADMIN_ROLLBACK_TOKEN) {
    return sendError(res, 401, 'MFA_REQUIRED', 'Valid admin rollback token is required.');
  }

  const transaction = await repo.findTransaction(targetTransactionId);
  if (!transaction) {
    return sendError(res, 404, 'TRANSACTION_NOT_FOUND', 'Transaction was not found.');
  }
  if (transaction.status === 'ROLLED_BACK') {
    return sendError(res, 409, 'TRANSACTION_ALREADY_ROLLED_BACK', 'Transaction is already rolled back.');
  }

  const result = await repo.rollbackTransaction({
    transactionId: transaction.transactionId,
    franchiseId: transaction.franchiseId,
    amount: transaction.amount
  });

  return res.status(200).json({
    success: true,
    message: 'Rollback completed.',
    data: {
      rollbackTransactionId: generateId('ROL', 5),
      targetTransactionId: transaction.transactionId,
      refundAmount: transaction.amount,
      refundFee: transaction.fee,
      refundTotalAmount: transaction.totalAmount,
      deductedFranchiseBalance: result.deductedFranchiseBalance,
      processedAt: new Date().toISOString()
    }
  });
}));

app.get('/api/admin/franchises', authenticateAdmin, asyncHandler(async (req, res) => {
  const users = await repo.listFranchiseUsers();
  return res.status(200).json({
    success: true,
    data: users.map(user => ({
      id: user.franchiseId,
      name: user.franchiseName || 'Unregistered store',
      agencyId: user.agencyId || null,
      agency: displayAgencyName(user.agencyName),
      owner: user.name,
      phone: user.phone || '',
      address: user.address || '',
      tel: user.tel || '',
      bizNo: user.businessNumber || '',
      joinDate: formatDate(user.createdAt),
      lastPaymentDate: '',
      status: user.role === 'OWNER' ? '정상 승인' : user.role === 'OWNER_REJECTED' ? '승인 거절' : '승인 대기',
      email: user.email,
      role: user.role,
      deliveryAgencies: []
    }))
  });
}));

app.post('/api/admin/franchises', authenticateAdmin, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const franchiseName = String(req.body?.name || req.body?.franchiseName || '').trim();
  const ownerName = String(req.body?.owner || req.body?.ownerName || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const address = String(req.body?.address || '').trim();
  const tel = String(req.body?.tel || '').trim();
  const businessNumber = String(req.body?.bizNo || req.body?.businessNumber || '').replace(/[^0-9]/g, '');
  const agencyId = req.body?.agencyId ? Number(req.body.agencyId) : null;
  const deliveryAccounts = Array.isArray(req.body?.deliveryAccounts) ? req.body.deliveryAccounts : [];

  if (!email || !password || !franchiseName || !ownerName || !businessNumber) {
    return sendError(res, 400, 'MISSING_FIELDS', 'email, password, franchiseName, ownerName, and businessNumber are required.');
  }
  if (password.length < 4) {
    return sendError(res, 400, 'INVALID_PASSWORD', 'Password must be at least 4 characters.');
  }
  if (businessNumber.length !== 10) {
    return sendError(res, 400, 'INVALID_BUSINESS_NUMBER', 'businessNumber must contain 10 digits.');
  }
  const validDeliveryAccounts = deliveryAccounts.filter(account => (
    String(account.agencyName || account.deliveryAgencyName || '').trim() &&
    String(account.accountNo || '').trim()
  ));
  if (validDeliveryAccounts.length > MAX_ACCOUNTS_PER_FRANCHISE) {
    return sendError(res, 409, 'ACCOUNT_LIMIT_EXCEEDED', '가맹점당 출금계좌는 최대 2개까지 등록할 수 있습니다.');
  }
  if (await repo.findUserByEmail(email)) {
    return sendError(res, 409, 'EMAIL_EXISTS', '이미 사용 중인 아이디입니다.');
  }
  if (await repo.findUserByBusinessNumber(businessNumber)) {
    return sendError(res, 409, 'BUSINESS_EXISTS', '이미 가입된 사업자등록번호입니다.');
  }

  const defaultAgency = agencyId ? null : await repo.ensureDefaultAgency();
  const user = await repo.createUser({
    email,
    passwordHash: await hashPassword(password),
    name: ownerName,
    franchiseName,
    phone,
    address,
    tel,
    businessNumber,
    agencyId: Number.isFinite(agencyId) ? agencyId : (defaultAgency?.id || null)
  });

  for (const account of validDeliveryAccounts) {
    const agencyName = String(account.agencyName || account.deliveryAgencyName || '').trim();
    const accountNo = String(account.accountNo || '').trim();
    if (!agencyName || !accountNo) continue;
    await repo.addDeliveryAccount({
      franchiseId: user.franchiseId,
      agencyId: null,
      agencyName,
      bankName: String(account.bankName || agencyName).trim(),
      accountHolder: String(account.accountHolder || ownerName).trim(),
      accountNo
    });
  }

  return res.status(201).json({
    success: true,
    message: '가맹점이 생성되었습니다.',
    data: {
      id: user.franchiseId,
      email: user.email,
      name: user.franchiseName,
      owner: user.name,
      phone: user.phone,
      bizNo: user.businessNumber,
      role: user.role
    }
  });
}));

app.patch('/api/admin/franchises/:id/agency', authenticateAdmin, asyncHandler(async (req, res) => {
  const franchiseId = Number(req.params.id);
  const agencyId = Number(req.body?.agencyId);
  if (!Number.isFinite(franchiseId) || !Number.isFinite(agencyId)) {
    return sendError(res, 400, 'BAD_REQUEST', 'franchiseId and agencyId are required.');
  }

  const agencies = await repo.listAgencies();
  const agency = agencies.find(item => Number(item.id) === agencyId);
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }

  const user = await repo.updateFranchiseAgency(franchiseId, agencyId);
  if (!user) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', 'Franchise was not found.');
  }

  return res.status(200).json({
    success: true,
    data: {
      franchiseId: user.franchiseId,
      agencyId,
      agencyName: displayAgencyName(agency.name)
    }
  });
}));

app.post('/api/admin/franchises/agency/bulk', authenticateAdmin, asyncHandler(async (req, res) => {
  const franchiseIds = Array.isArray(req.body?.franchiseIds) ? req.body.franchiseIds : [];
  const agencyId = Number(req.body?.agencyId);
  if (!franchiseIds.length || !Number.isFinite(agencyId)) {
    return sendError(res, 400, 'BAD_REQUEST', 'franchiseIds and agencyId are required.');
  }

  const agencies = await repo.listAgencies();
  const agency = agencies.find(item => Number(item.id) === agencyId);
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }

  const users = await repo.updateFranchisesAgency(franchiseIds, agencyId);
  return res.status(200).json({
    success: true,
    data: {
      updatedCount: users.length,
      agencyId,
      agencyName: displayAgencyName(agency.name)
    }
  });
}));

app.put('/api/admin/franchises/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const franchiseId = Number(req.params.id);
  if (!Number.isFinite(franchiseId)) {
    return sendError(res, 400, 'BAD_REQUEST', 'franchiseId is required.');
  }

  const franchiseName = String(req.body?.name || req.body?.franchiseName || '').trim();
  const ownerName = String(req.body?.owner || req.body?.ownerName || '').trim();
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const phone = String(req.body?.phone || '').trim();
  const address = String(req.body?.address || '').trim();
  const businessNumber = String(req.body?.bizNo || req.body?.businessNumber || '').replace(/[^0-9]/g, '');
  const tel = String(req.body?.tel || '').trim();
  const agencyId = req.body?.agencyId !== undefined && req.body?.agencyId !== '' ? Number(req.body.agencyId) : null;

  if (!franchiseName) {
    return sendError(res, 400, 'MISSING_FRANCHISE_NAME', 'franchiseName is required.');
  }
  if (!ownerName) {
    return sendError(res, 400, 'MISSING_OWNER_NAME', 'ownerName is required.');
  }
  if (businessNumber && businessNumber.length !== 10) {
    return sendError(res, 400, 'INVALID_BUSINESS_NUMBER', 'businessNumber must contain 10 digits.');
  }
  if (!email) {
    return sendError(res, 400, 'MISSING_EMAIL', '로그인 ID를 입력해주세요.');
  }
  if (password && password.length < 4) {
    return sendError(res, 400, 'INVALID_PASSWORD', '비밀번호는 4자 이상 입력해주세요.');
  }
  if (req.body?.agencyId !== undefined && req.body?.agencyId !== '' && !Number.isFinite(agencyId)) {
    return sendError(res, 400, 'BAD_AGENCY_ID', '대리점 정보가 올바르지 않습니다.');
  }

  const existing = await repo.findUserByFranchiseId(franchiseId);
  if (!existing) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', '가맹점을 찾을 수 없습니다.');
  }
  const duplicateEmail = await repo.findUserByEmail(email);
  if (duplicateEmail && Number(duplicateEmail.franchiseId) !== franchiseId) {
    return sendError(res, 409, 'EMAIL_EXISTS', '이미 사용 중인 아이디입니다.');
  }
  if (businessNumber) {
    const duplicateBusiness = await repo.findUserByBusinessNumber(businessNumber);
    if (duplicateBusiness && Number(duplicateBusiness.franchiseId) !== franchiseId) {
      return sendError(res, 409, 'BUSINESS_EXISTS', '이미 가입된 사업자등록번호입니다.');
    }
  }

  const updated = await repo.updateFranchiseDetails(franchiseId, {
    franchiseName,
    ownerName,
    phone,
    address,
    businessNumber,
    tel,
    email,
    passwordHash: password ? await hashPassword(password) : undefined,
    agencyId
  });
  if (!updated) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', '가맹점을 찾을 수 없습니다.');
  }

  return res.status(200).json({
    success: true,
    message: '가맹점 정보가 수정되었습니다.',
    data: {
      id: updated.franchiseId,
      email: updated.email,
      name: updated.franchiseName,
      owner: updated.name,
      phone: updated.phone,
      address: updated.address,
      bizNo: updated.businessNumber,
      tel: updated.tel,
      agencyId: updated.agencyId
    }
  });
}));

app.delete('/api/admin/franchises/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const franchiseId = Number(req.params.id);
  if (!Number.isFinite(franchiseId)) {
    return sendError(res, 400, 'BAD_REQUEST', 'franchiseId is required.');
  }

  const deleted = await repo.deleteFranchiseById(franchiseId);
  if (!deleted) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', '가맹점을 찾을 수 없습니다.');
  }

  return res.status(200).json({
    success: true,
    message: '가맹점이 삭제되었습니다.',
    data: {
      franchiseId: deleted.franchiseId,
      businessNumber: deleted.businessNumber
    }
  });
}));

app.get('/api/admin/bootstrap', authenticateAdmin, asyncHandler(async (req, res) => {
  const [users, agencies, deliveryAgencies, deliveryAccounts, accountRequests, transactions, settlements, installments] = await Promise.all([
    repo.listFranchiseUsers(),
    repo.listAgencies(),
    repo.listDeliveryAgencies(),
    repo.listDeliveryAccounts(),
    repo.listAccountRequests(),
    repo.listTransactions({
      startDate: '2000-01-01',
      endDate: '2100-12-31',
      role: 'ADMIN',
      limit: 1000,
      offset: 0
    }),
    repo.listPgSettlements({
      startDate: '2000-01-01',
      endDate: '2100-12-31',
      limit: 1000,
      offset: 0
    }),
    repo.listInterestFreeInstallments()
  ]);

  const franchiseMap = new Map();
  users.forEach(user => {
    franchiseMap.set(user.franchiseId, {
      id: user.franchiseId,
      name: user.franchiseName || 'Unregistered store',
      agencyId: user.agencyId || null,
      agency: displayAgencyName(user.agencyName),
      owner: user.name,
      phone: user.phone || '',
      address: user.address || '',
      tel: user.tel || '',
      bizNo: user.businessNumber || '',
      joinDate: formatDate(user.createdAt),
      lastPaymentDate: '',
      status: user.role === 'OWNER' ? '\uC815\uC0C1 \uC2B9\uC778' : user.role === 'OWNER_REJECTED' ? '\uC2B9\uC778 \uAC70\uC808' : '\uC2B9\uC778 \uB300\uAE30',
      email: user.email,
      role: user.role,
      deliveryAgencies: []
    });
  });

  const bankLabel = bankCode => {
    const normalized = String(bankCode || '').replace(/[^0-9]/g, '');
    const labels = {
      '003': '\uAE30\uC5C5\uC740\uD589',
      '004': '\uAD6D\uBBFC\uC740\uD589',
      '011': '\uB18D\uD611\uC740\uD589',
      '020': '\uC6B0\uB9AC\uC740\uD589',
      '081': '\uD558\uB098\uC740\uD589',
      '088': '\uC2E0\uD55C\uC740\uD589'
    };
    return labels[normalized] || bankCode || '\uAC00\uC0C1\uACC4\uC88C';
  };

  const pushDeliveryAgency = (franchiseId, entry) => {
    const franchise = franchiseMap.get(franchiseId);
    if (!franchise) return;
    const exists = franchise.deliveryAgencies.some(item => (
      item.requestId && item.requestId === entry.requestId
    ) || (
      item.agency === entry.agency &&
      item.accountNo === entry.accountNo &&
      item.reqDate === entry.reqDate
    ));
    if (!exists) franchise.deliveryAgencies.push(entry);
  };

  const ensureFranchiseForAccountRequest = request => {
    if (franchiseMap.has(request.franchiseId)) return;
    franchiseMap.set(request.franchiseId, {
      id: request.franchiseId,
      name: request.franchiseName || 'Unregistered store',
      agencyId: null,
      agency: DEFAULT_AGENCY_NAME,
      owner: request.representativeName || request.franchiseName || '',
      phone: '',
      bizNo: request.businessNumber || '',
      joinDate: formatDate(request.submittedAt),
      lastPaymentDate: '',
      status: request.status === 'APPROVED' ? '\uC815\uC0C1 \uC2B9\uC778' : request.status === 'REJECTED' ? '\uC2B9\uC778 \uAC70\uC808' : '\uC2B9\uC778 \uB300\uAE30',
      email: '',
      role: 'OWNER_PENDING',
      deliveryAgencies: []
    });
  };

  for (const request of accountRequests) {
    ensureFranchiseForAccountRequest(request);
    pushDeliveryAgency(request.franchiseId, {
      agency: request.deliveryAgencyName || bankLabel(request.bankCode),
      bankName: request.bankName || bankLabel(request.bankCode),
      accountNo: request.accountNo || request.assignedVirtualAccount?.accountNumber || '',
      fileName: request.documentUrl ? path.basename(request.documentUrl) : '',
      documentUrl: request.documentUrl || '',
      accountStatus: request.status === 'APPROVED' ? '\uC2B9\uC778\uC644\uB8CC' : request.status === 'REJECTED' ? '\uBC18\uB824' : '\uC2B9\uC778\uB300\uAE30',
      reqDate: formatDate(request.submittedAt),
      requestId: request.requestId,
      source: 'account_request',
      rejectReason: request.rejectionReason || ''
    });
  }

  for (const account of deliveryAccounts) {
    pushDeliveryAgency(account.franchiseId, {
      id: account.id,
      agency: account.bankName || account.agencyName || '\uAC00\uC0C1\uACC4\uC88C',
      bankName: account.bankName || '',
      accountNo: account.accountNo || '',
      fileName: account.fileKey || '',
      accountStatus: account.accountStatus === 'APPROVED' ? '\uC2B9\uC778\uC644\uB8CC' : account.accountStatus === 'REJECTED' ? '\uBC18\uB824' : '\uC2B9\uC778\uB300\uAE30',
      reqDate: formatDate(account.reqDate),
      requestId: null,
      source: 'delivery_account',
      rejectReason: account.rejectionReason || ''
    });
  }

  const franchises = Array.from(franchiseMap.values()).sort((a, b) => b.joinDate.localeCompare(a.joinDate));
  const transactionItems = Array.isArray(transactions?.items) ? transactions.items : [];
  const settlementItems = Array.isArray(settlements?.items) ? settlements.items : [];
  const franchiseById = new Map(franchises.map(franchise => [String(franchise.id), franchise]));
  const defaultAgency = agencies.find(agency => (
    agency.joinCode === 'EATSPAY-HQ' ||
    displayAgencyName(agency.name) === DEFAULT_AGENCY_NAME ||
    agency.name === DEFAULT_AGENCY_NAME
  ));
  const paymentRows = transactionItems.map(tx => {
    const franchise = franchiseById.get(String(tx.franchiseId));
    const agencyId = franchise?.agencyId || defaultAgency?.id || null;
    const agencyName = franchise?.agency || (defaultAgency ? displayAgencyName(defaultAgency.name) : DEFAULT_AGENCY_NAME);
    const depositAmount = Number(tx.amount || 0);
    const feeAmount = Number(tx.fee || tx.calculatedFee || 0);
    const totalAmount = Number(tx.totalAmount || tx.total_amount || (depositAmount + feeAmount));
    return {
      id: tx.transactionId,
      date: formatKstDateTime(tx.createdAt),
      approvalNo: tx.transactionId,
      agency: agencyName,
      franchise: franchise?.name || `가맹점 ${tx.franchiseId}`,
      franchiseId: tx.franchiseId,
      type: tx.type === 'CHARGE' ? '\uCDA9\uC804' : tx.type,
      amount: totalAmount,
      depositAmount,
      fee: feeAmount,
      totalAmount,
      installment: '\uC77C\uC2DC\uBD88',
      status: tx.status === 'SUCCESS' ? '\uACB0\uC81C\uC644\uB8CC' : tx.status === 'ROLLED_BACK' ? '\uCDE8\uC18C' : tx.status,
      pg: tx.method || 'PG',
      agencyId
    };
  });

  const paymentNameByFranchiseId = new Map(franchises.map(f => [f.id, f.name]));
  const pgRows = settlementItems.map(item => ({
    id: item.id,
    date: formatKstDateTime(item.settledAt),
    approvalNo: item.approvalNo,
    pg: item.pg,
    franchise: item.franchiseName || paymentNameByFranchiseId.get(item.franchiseId) || '',
    paymentAmt: Number(item.paymentAmt),
    svcFee: Number(item.svcFee),
    netAmt: Number(item.netAmt),
    deliveryAgency: item.deliveryAgency || '',
    status: item.status === 'ROLLED_BACK' ? '\uCDE8\uC18C' : '\uC815\uC0B0\uC644\uB8CC',
    note: '',
    agencyId: item.agencyId || null,
    pgTxId: item.pgTxId || ''
  }));

  const today = formatKstDate(new Date());
  const todayPaymentTotal = paymentRows
    .filter(payment => payment.date.startsWith(today))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const agenciesForAdmin = buildAdminAgencies(agencies);

  return res.status(200).json({
    success: true,
    data: {
      summary: {
        pendingFranchises: users.filter(user => user.role === 'OWNER_PENDING').length,
        pendingAccounts: accountRequests.filter(request => request.status === 'PENDING').length,
      totalFranchises: users.length,
      todayPaymentTotal
    },
    franchises,
    agencies: agenciesForAdmin,
    deliveryAgencies,
    installments,
    payments: paymentRows,
    pgSettlements: pgRows,
    accountRequests,
      deliveryAccounts
    }
  });
}));

app.get('/api/admin/delivery-agencies', authenticateAdmin, asyncHandler(async (req, res) => {
  const deliveryAgencies = await repo.listDeliveryAgencies();
  return res.status(200).json({ success: true, data: deliveryAgencies });
}));

app.get('/api/admin/installments', authenticateAdmin, asyncHandler(async (req, res) => {
  const installments = await repo.listInterestFreeInstallments();
  return res.status(200).json({ success: true, data: installments });
}));

app.put('/api/admin/installments', authenticateAdmin, asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) {
    return sendError(res, 400, 'BAD_REQUEST', 'items are required.');
  }

  const saved = await repo.replaceInterestFreeInstallments(items);
  return res.status(200).json({ success: true, data: saved });
}));

app.post('/api/admin/agencies', authenticateAdmin, asyncHandler(async (req, res) => {
  const { name, loginId, level, region, owner, phone, feeRate, parentId, password } = req.body || {};
  if (!String(name || '').trim()) {
    return sendError(res, 400, 'BAD_REQUEST', 'name is required.');
  }

  const agency = await repo.createAgency({
    type: Number(level) <= 2 ? 'HQ' : 'AGENCY',
    parentId: parentId ? Number(parentId) : null,
    name: String(name).trim(),
    loginId: String(loginId || '').trim(),
    address: String(region || '').trim(),
    owner: String(owner || '').trim(),
    phone: String(phone || '').trim(),
    feeRate: Number(feeRate) || 0,
    joinCode: `JOIN-${Date.now()}`
  });
  if (String(password || '').trim()) {
    await repo.updateAgencyPasswordById(agency.id, await hashPassword(String(password)));
  }

  return res.status(201).json({
    success: true,
    data: {
      ...agency,
      name: displayAgencyName(agency.name)
    }
  });
}));

app.patch('/api/admin/agencies/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const agencyId = Number(req.params.id);
  const { name, loginId, level, region, owner, phone, feeRate, parentId, password } = req.body || {};
  if (!Number.isFinite(agencyId)) {
    return sendError(res, 400, 'BAD_REQUEST', 'agency id is required.');
  }
  if (!String(name || '').trim()) {
    return sendError(res, 400, 'BAD_REQUEST', 'name is required.');
  }

  const agency = await repo.updateAgency(agencyId, {
    type: Number(level) <= 2 ? 'HQ' : 'AGENCY',
    parentId: parentId ? Number(parentId) : null,
    name: String(name).trim(),
    loginId: String(loginId || '').trim(),
    address: String(region || '').trim(),
    owner: String(owner || '').trim(),
    phone: String(phone || '').trim(),
    feeRate: Number(feeRate) || 0
  });
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }
  if (String(password || '').trim()) {
    await repo.updateAgencyPasswordById(agencyId, await hashPassword(String(password)));
  }

  return res.status(200).json({
    success: true,
    data: {
      ...agency,
      name: displayAgencyName(agency.name)
    }
  });
}));

app.delete('/api/admin/agencies/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const agencyId = Number(req.params.id);
  if (!Number.isFinite(agencyId)) {
    return sendError(res, 400, 'BAD_REQUEST', 'agency id is required.');
  }

  const assignedCount = await repo.countUsersByAgencyId(agencyId);
  if (assignedCount > 0) {
    return sendError(res, 409, 'AGENCY_IN_USE', 'Agency is assigned to franchises.', [{ assignedCount }]);
  }

  const agency = await repo.deleteAgency(agencyId);
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }

  return res.status(200).json({ success: true, data: agency });
}));

app.get('/api/delivery-agencies', asyncHandler(async (req, res) => {
  const deliveryAgencies = await repo.listDeliveryAgencies();
  return res.status(200).json({
    success: true,
    data: deliveryAgencies.filter(item => item.status === 'active' || item.status === 'inactive')
  });
}));

app.post('/api/admin/delivery-agencies', authenticateAdmin, asyncHandler(async (req, res) => {
  const { name, status = 'active', sortOrder = 0 } = req.body || {};
  if (!name || !String(name).trim()) {
    return sendError(res, 400, 'MISSING_NAME', 'name is required.');
  }
  const agency = await repo.createDeliveryAgency(String(name).trim(), status, Number(sortOrder) || 0);
  return res.status(201).json({ success: true, data: agency });
}));

app.patch('/api/admin/delivery-agencies/:id/status', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!['active', 'inactive', 'deleted'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'status must be active, inactive, or deleted.');
  }
  const agency = await repo.updateDeliveryAgencyStatus(id, status);
  if (!agency) {
    return sendError(res, 404, 'DELIVERY_AGENCY_NOT_FOUND', 'Delivery agency was not found.');
  }
  return res.status(200).json({ success: true, data: agency });
}));

app.delete('/api/admin/delivery-agencies/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const agency = await repo.deleteDeliveryAgency(id);
  if (!agency) {
    return sendError(res, 404, 'DELIVERY_AGENCY_NOT_FOUND', 'Delivery agency was not found.');
  }
  return res.status(200).json({ success: true, data: { id } });
}));

app.post('/api/admin/franchise/approve', authenticateAdmin, asyncHandler(async (req, res) => {
  const { email, action } = req.body;
  const role = action === 'APPROVED' ? 'OWNER' : action === 'REJECTED' ? 'OWNER_REJECTED' : null;
  if (!role) {
    return sendError(res, 400, 'INVALID_ACTION', 'action must be APPROVED or REJECTED.');
  }

  const user = await repo.updateUserRoleByEmail(email, role);
  if (!user) {
    return sendError(res, 404, 'USER_NOT_FOUND', 'User was not found.');
  }

  return res.status(200).json({
    success: true,
    message: 'Franchise status updated.',
    data: { email: user.email, role: user.role }
  });
}));

app.get('/api/admin/accounts', authenticateAdmin, asyncHandler(async (req, res) => {
  const requests = await repo.listAccountRequests();
  return res.status(200).json({ success: true, data: requests });
}));

app.put('/api/admin/accounts/:id', authenticateAdmin, singleUpload('documentFile'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const source = String(req.query.source || req.body.source || 'account_request');
  const accountNo = String(req.body.accountNo || '').trim();
  const bankName = String(req.body.bankName || '').trim();
  const deliveryAgencyName = String(req.body.deliveryAgencyName || req.body.agencyName || '').trim();
  const accountHolder = String(req.body.accountHolder || req.body.representativeName || '').trim();
  const uploadedFile = req.file ? await persistUpload(req.file, req.user.id) : null;

  if (!accountNo || !/^[0-9-]{8,30}$/.test(accountNo)) {
    return sendError(res, 400, 'INVALID_ACCOUNT_NO', 'accountNo must contain 8 to 30 digits or hyphens.');
  }

  let updated;
  if (source === 'delivery_account') {
    if (!/^\d+$/.test(id)) {
      return sendError(res, 400, 'INVALID_ACCOUNT_ID', 'delivery account id must be numeric.');
    }
    updated = await repo.updateDeliveryAccount(Number(id), {
      agencyName: deliveryAgencyName,
      bankName,
      accountHolder,
      accountNo,
      fileKey: uploadedFile?.fileKey || null
    });
  } else {
    updated = await repo.updateAccountRequestDetails(id, {
      bankName,
      deliveryAgencyName,
      representativeName: accountHolder,
      accountNo,
      documentUrl: uploadedFile ? `/uploads/${encodeURIComponent(uploadedFile.fileKey)}` : null
    });
  }

  if (!updated) {
    return sendError(res, 404, 'ACCOUNT_NOT_FOUND', 'Account was not found.');
  }

  return res.status(200).json({
    success: true,
    message: 'Account updated.',
    data: updated
  });
}));

app.delete('/api/admin/accounts/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const source = String(req.query.source || 'account_request');
  let deleted;
  if (source === 'delivery_account') {
    if (!/^\d+$/.test(id)) {
      deleted = await repo.deleteAccountRequest(id);
    } else {
      deleted = await repo.deleteDeliveryAccount(Number(id));
      if (!deleted) {
        deleted = await repo.deleteAccountRequest(id);
      }
    }
  } else {
    deleted = await repo.deleteAccountRequest(id);
    if (!deleted && /^\d+$/.test(id)) {
      deleted = await repo.deleteDeliveryAccount(Number(id));
    }
  }

  if (!deleted) {
    return sendError(res, 404, 'ACCOUNT_NOT_FOUND', '삭제할 출금계좌를 DB에서 찾지 못했습니다.');
  }

  return res.status(200).json({
    success: true,
    message: 'Account deleted.',
    data: { id, source }
  });
}));

app.use((err, req, res, next) => {
  handleError(err, res);
});

if (require.main === module) {
  dbBootstrapPromise
    .then(() => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`[EatsPay Server] Running on http://localhost:${PORT}`);
      });
    })
    .catch(err => {
      console.error('[EatsPay Server] database bootstrap failed', err);
      process.exit(1);
    });
}

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split('=');
    if (parts.length < 2) return;
    const key = parts[0].trim();
    const value = parts.slice(1).join('=').trim().replace(/(^['"]|['"]$)/g, '');
    process.env[key] = value;
  });
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function singleUpload(fieldName) {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, err => {
      if (!err) return next();
      if (err.message === 'INVALID_FILE_FORMAT') {
        return sendError(res, 415, 'INVALID_FILE_FORMAT', 'Only pdf, jpg, jpeg, and png files are allowed.');
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 413, 'FILE_SIZE_LIMIT_EXCEEDED', 'Attachment size must be 10MB or less.');
      }
      return sendError(res, 400, 'UPLOAD_ERROR', err.message);
    });
  };
}

function multiUpload(fieldName, maxCount) {
  return (req, res, next) => {
    upload.array(fieldName, maxCount)(req, res, err => {
      if (!err) return next();
      if (err.message === 'INVALID_FILE_FORMAT') {
        return sendError(res, 415, 'INVALID_FILE_FORMAT', 'jpg, jpeg, png, pdf 파일만 업로드할 수 있습니다.');
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return sendError(res, 400, 'TOO_MANY_IMAGES', `이미지는 최대 ${maxCount}개까지 첨부할 수 있습니다.`);
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 413, 'FILE_SIZE_LIMIT_EXCEEDED', '첨부 파일은 10MB 이하만 업로드할 수 있습니다.');
      }
      return sendError(res, 400, 'UPLOAD_ERROR', err.message);
    });
  };
}

function logError(code, message, details = []) {
  console.error(`[${new Date().toISOString()}] [${code}] ${message}`, JSON.stringify(details));
}

function sendError(res, statusCode, code, message, details = []) {
  logError(code, message, details);
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details,
      timestamp: new Date().toISOString()
    }
  });
}

function handleError(err, res) {
  if (err.code === '23505') {
    return sendError(res, 409, 'ALREADY_EXISTS', 'Unique constraint conflict.');
  }
  if (err.code === 'FRANCHISE_NOT_FOUND') {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', 'Franchise was not found.');
  }
  if (err.code === 'INSUFFICIENT_BALANCE') {
    return sendError(res, 400, 'INSUFFICIENT_BALANCE', 'Insufficient balance for rollback.');
  }
  console.error(err);
  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Unexpected server error.');
}

async function authenticate(req, res, next) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Valid bearer token is required.');
    }
    req.user = user;
    return next();
  } catch (err) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Valid bearer token is required.');
  }
}

async function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (process.env.NODE_ENV !== 'production' && ['Bearer mocked_admin_token', 'Bearer dev-admin-token'].includes(authHeader)) {
    req.user = { id: 0, role: 'ADMIN', email: 'mocked-admin' };
    return next();
  }
  await authenticate(req, res, () => {
    if (req.user.role !== 'ADMIN') {
      return sendError(res, 403, 'ACCESS_DENIED', 'Admin role is required.');
    }
    return next();
  });
}

async function userFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  const payload = verifyToken(token);
  if (payload.authType === 'agency' || payload.role === 'AGENCY') {
    const agency = await repo.findAgencyById(payload.sub);
    return agency ? agencyPrincipal(agency) : null;
  }
  return repo.findUserById(payload.sub);
}

function verifySignature(req, res, next) {
  const signature = req.headers['x-eatspay-signature'];
  const timestamp = req.headers['x-eatspay-timestamp'];
  if (!signature || !timestamp) {
    return sendError(res, 403, 'SIGNATURE_VERIFICATION_FAILED', 'HMAC signature headers are required.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    return sendError(res, 403, 'SIGNATURE_VERIFICATION_FAILED', 'Request timestamp is outside the allowed window.');
  }

  const expected = crypto
    .createHmac('sha256', process.env.EATSPAY_HMAC_SECRET)
    .update(JSON.stringify(req.body) + timestamp)
    .digest('hex');
  const provided = Buffer.from(String(signature), 'hex');
  const calculated = Buffer.from(expected, 'hex');
  if (provided.length !== calculated.length || !crypto.timingSafeEqual(provided, calculated)) {
    return sendError(res, 403, 'SIGNATURE_VERIFICATION_FAILED', 'Invalid HMAC signature.');
  }
  return next();
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt);
  return `scrypt$${salt}$${hash}`;
}

async function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = await scrypt(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString('hex'));
    });
  });
}

function signToken(user) {
  const header = base64UrlEncode({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlEncode({
    sub: user.id,
    role: user.role,
    authType: user.authType || 'user',
    exp: Math.floor(Date.now() / 1000) + 86400
  });
  const body = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', process.env.JWT_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  const [header, payload, signature] = String(token).split('.');
  if (!header || !payload || !signature) throw new Error('Invalid token');
  const body = `${header}.${payload}`;
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error('Invalid token');
  }
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Expired token');
  }
  return decoded;
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function verifyBusinessNumber(clean) {
  if (process.env.NTS_SERVICE_KEY) {
    const apiUrl = `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${process.env.NTS_SERVICE_KEY}`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ b_no: [clean] })
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.data?.[0]?.b_stt_cd === '01';
  }

  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    sum += parseInt(clean[i], 10) * weights[i];
  }
  const val = parseInt(clean[8], 10) * weights[8];
  sum += Math.floor(val / 10) + (val % 10);
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(clean[9], 10);
}

function generateId(prefix, randomDigits) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const min = 10 ** (randomDigits - 1);
  const max = 10 ** randomDigits - 1;
  return `${prefix}-${today}-${crypto.randomInt(min, max)}`;
}

function createTemporaryPassword() {
  return `Ep!${crypto.randomBytes(9).toString('base64url')}`;
}

function safeFileKey(fileName) {
  return path.basename(String(fileName)).replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function persistUpload(file, uploadedBy) {
  const ext = path.extname(file.originalname).toLowerCase();
  const fileKey = `${Date.now()}-${crypto.randomUUID()}${ext}`;
  const storagePath = path.join(uploadDir, fileKey);
  await fs.promises.writeFile(storagePath, file.buffer);
  return repo.recordFile({
    fileKey,
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    storagePath,
    uploadedBy
  });
}

function toCsv(rows) {
  const headers = [
    'settledAt',
    'approvalNo',
    'pgTxId',
    'customerId',
    'agencyName',
    'franchiseName',
    'paymentAmt',
    'svcFee',
    'netAmt',
    'deliveryAgency',
    'pg',
    'status',
    'bankCode',
    'accountNo'
  ];
  const lines = [headers.join(',')];
  rows.forEach(row => {
    lines.push(headers.map(header => csvCell(row[header])).join(','));
  });
  return lines.join('\r\n');
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function agencyPrincipal(agency) {
  return {
    id: agency.id,
    authType: 'agency',
    role: 'AGENCY',
    name: agency.owner || agency.name,
    agencyId: agency.id,
    agencyName: displayAgencyName(agency.name),
    franchiseName: displayAgencyName(agency.name),
    feeRate: Number(agency.feeRate || 0.3),
    loginId: agency.loginId,
    phone: agency.phone,
    passwordHash: agency.passwordHash
  };
}

function publicUser(user) {
  if (user.role === 'AGENCY') {
    return {
      id: user.id,
      name: user.name || user.agencyName,
      franchiseName: user.agencyName,
      franchiseId: null,
      agencyId: user.agencyId,
      agencyName: user.agencyName,
      feeRate: Number(user.feeRate || 0.3),
      businessNumber: null,
      phone: user.phone || null,
      address: null,
      tel: null,
      role: 'AGENCY',
      approvalState: 'APPROVED',
      approvalLabel: '\uC2B9\uC778\uC644\uB8CC'
    };
  }
  const isAdmin = user.role === 'ADMIN';
  const approvalState = isAdmin
    ? 'APPROVED'
    : user.role === 'OWNER'
      ? 'APPROVED'
      : user.role === 'OWNER_REJECTED'
        ? 'REJECTED'
        : 'PENDING';
  const adminDisplayName = user.name || 'Eats Pay Admin';
  return {
    id: user.id,
    name: user.name,
    franchiseName: isAdmin ? adminDisplayName : user.franchiseName,
    franchiseId: isAdmin ? user.id : user.franchiseId,
    businessNumber: isAdmin ? null : user.businessNumber,
    phone: isAdmin ? null : user.phone,
    address: isAdmin ? null : user.address,
    tel: isAdmin ? null : user.tel,
    role: user.role,
    approvalState,
    approvalLabel: approvalState === 'APPROVED'
        ? '\uC2B9\uC778\uC644\uB8CC'
        : approvalState === 'REJECTED'
          ? '\uC2B9\uC778\uAC70\uC808'
          : '\uC2B9\uC778\uB300\uAE30'
  };
}

function displayAgencyName(name) {
  const normalized = String(name || '').trim();
  if (!normalized || normalized === 'undefined' || normalized === '본사') {
    return DEFAULT_AGENCY_NAME;
  }
  return normalized;
}

function buildAdminAgencies(agencies = []) {
  const items = agencies.map(agency => ({
    ...agency,
    name: displayAgencyName(agency.name)
  }));
  const levelById = new Map();
  const resolveLevel = agency => {
    const key = String(agency.id);
    if (levelById.has(key)) return levelById.get(key);
    if (!agency.parentId) {
      levelById.set(key, 1);
      return 1;
    }
    const parent = items.find(item => String(item.id) === String(agency.parentId));
    const level = parent ? Math.min(resolveLevel(parent) + 1, 4) : 1;
    levelById.set(key, level);
    return level;
  };
  return items.map(agency => ({
    ...agency,
    level: resolveLevel(agency),
    region: agency.address || '',
    deliveryNote: agency.deliveryNote || ''
  }));
}

function formatDate(value) {
  if (!value) return '';
  return formatKstDate(value);
}

function formatKstDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

function formatKstDateTime(value) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(
    parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function inferCardName(digits) {
  if (digits.startsWith('9')) return 'BC Card';
  if (digits.startsWith('8')) return 'Hyundai Card';
  if (digits.startsWith('5')) return 'Lotte Card';
  return 'Samsung Card';
}

function formatCardExpireDate(month, year) {
  const mm = String(month).replace(/[^0-9]/g, '').padStart(2, '0').slice(-2);
  const yy = String(year).replace(/[^0-9]/g, '').padStart(2, '0').slice(-2);
  return `${yy}${mm}`;
}

async function seedDeliveryAgencies() {
  const existing = await repo.listDeliveryAgencies();
  const existingNames = new Set(existing.map(item => String(item.name || '').trim()));

  for (const [index, name] of DEFAULT_DELIVERY_AGENCIES.entries()) {
    if (existingNames.has(name)) continue;
    await repo.createDeliveryAgency(name, 'active', index + 1);
  }
}

function hasGhPaymentsPayKey() {
  const key = String(process.env.GH_PAYMENTS_PAY_KEY || '').trim();
  if (!key) return false;
  const normalized = key.toLowerCase();
  if (
    normalized === 'replace-with-gh-pay-key' ||
    normalized === 'your-gh-pay-key' ||
    normalized === 'your-real-key' ||
    normalized === 'test' ||
    normalized === 'none' ||
    normalized === 'null'
  ) {
    return false;
  }
  if (normalized.startsWith('replace-') || normalized.includes('replace-with')) return false;
  return true;
}

async function ghPaymentsRequest(pathname, { method = 'GET', body } = {}) {
  if (!hasGhPaymentsPayKey()) {
    throw new Error('GH_PAYMENTS_PAY_KEY is required for GH Payments integration.');
  }

  const payKey = String(process.env.GH_PAYMENTS_PAY_KEY || '').trim();
  const headers = {
    Authorization: payKey,
    Accept: 'application/json'
  };

  const init = { method, headers };
  if (body !== undefined && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  return fetch(`${GH_PAYMENTS_BASE_URL}${pathname}`, init);
}

async function relayProviderResponse(providerResponse, res) {
  const contentType = providerResponse.headers.get('content-type') || 'application/json';
  res.status(providerResponse.status);
  res.setHeader('Content-Type', contentType);

  const text = await providerResponse.text();
  if (!text) {
    return res.end();
  }

  if (contentType.includes('application/json')) {
    return res.send(text);
  }

  return res.send(text);
}

module.exports = app;
