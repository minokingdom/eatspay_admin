const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Load .env file manually if exists for seamless environment configuration
if (fs.existsSync(path.join(__dirname, '.env'))) {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/(^['"]|['"]$)/g, '');
      process.env[key] = val;
    }
  });
}

const app = express();
const PORT = 3000;
const SECRET_KEY = 'eatspay-secret-key-2026';

// Middleware configurations
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets from the current directory
app.use(express.static(__dirname));

// Route to serve the main mobile app (index.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Route to serve the admin dashboard panel explicitly
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '이츠페이_관리자_시스템_10.html'));
});

// Multitpart upload config (Store files in-memory for volatile storage)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_FORMAT'), false);
    }
  }
});

// ==========================================
// In-Memory volatile DB Initial Data
// ==========================================
const db = {
  users: [
    {
      id: 9999,
      email: 'admin',
      password: '1234',
      name: '관리자',
      franchiseName: '이츠페이 테스트 가맹점',
      franchiseId: 9999,
      role: 'OWNER',
      balance: 1000000,
      phone: '010-1234-5678',
      address: '서울특별시 강남구 테헤란로 123',
      tel: '02-123-4567',
      businessNumber: '120-00-12345',
      cards: []
    },
    {
      id: 4820,
      email: 'franchise_owner@eatspay.com',
      password: 'Password123!',
      name: '홍길동',
      franchiseName: '이츠분식 강남점',
      franchiseId: 1052,
      role: 'OWNER',
      balance: 145398 // In-memory deposit/balance
    },
    {
      id: 4821,
      email: 'social_user@eatspay.com',
      password: 'Password123!',
      name: '김철수',
      franchiseName: null,
      franchiseId: null,
      role: 'OWNER_PENDING',
      balance: 0
    },
    {
      id: 1,
      email: 'admin001@eatspay.com',
      password: 'AdminPassword123!',
      name: '김민준',
      role: 'ADMIN',
      balance: 0
    }
  ],
  accountRequests: [
    {
      requestId: 'REQ-20260528-0912',
      franchiseId: 1052,
      franchiseName: '이츠분식 강남점',
      businessNumber: '120-00-12345',
      bankCode: '088',
      representativeName: '홍길동',
      status: 'PENDING',
      documentUrl: 'https://storage.eatspay.co.kr/documents/biz_cert_1052.jpg',
      submittedAt: '2026-05-28T15:10:08+09:00',
      assignedVirtualAccount: null,
      rejectionReason: null
    }
  ],
  transactions: [
    {
      transactionId: 'TXN-20260528-9840294',
      franchiseId: 1052,
      type: 'CHARGE',
      amount: 100000,
      fee: 4602,
      totalAmount: 104602,
      method: 'CARD',
      cardDetails: '국민카드 (****-****-1234)',
      status: 'SUCCESS',
      createdAt: '2026-05-28T14:20:00+09:00'
    },
    {
      transactionId: 'TXN-20260525-1102934',
      franchiseId: 1052,
      type: 'CHARGE',
      amount: 50000,
      fee: 2301,
      totalAmount: 52301,
      method: 'VIRTUAL_ACCOUNT',
      cardDetails: null,
      status: 'SUCCESS',
      createdAt: '2026-05-25T09:12:30+09:00'
    }
  ]
};

// ==========================================
// Helper Utilities & Logging
// ==========================================
const getTimestamp = () => new Date().toISOString();

const logAction = (tag, message, metadata = {}) => {
  console.log(`[${getTimestamp()}] [${tag}] ${message}`, JSON.stringify(metadata));
};

const sendError = (res, statusCode, code, message, details = []) => {
  logAction('ERROR', `${statusCode} - ${code} - ${message}`, { details });
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details,
      timestamp: getTimestamp()
    }
  });
};

// Middleware: Authenticate Bearer JWT or Mock token
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'UNAUTHORIZED', '인증 토큰이 누락되었거나 형식이 유효하지 않습니다.');
  }
  const token = authHeader.split(' ')[1];
  // Simple Mock token verify based on roles
  const user = db.users.find(u => token.includes(u.email) || token === 'mocked_jwt_token_here' && u.role === 'OWNER' || token === 'mocked_admin_token' && u.role === 'ADMIN');
  if (!user) {
    // Default to first user if token is mock
    req.user = db.users[0];
  } else {
    req.user = user;
  }
  next();
};

// Middleware: Admin Authenticate
const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'UNAUTHORIZED', '인증 토큰이 누락되었습니다.');
  }
  const token = authHeader.split(' ')[1];
  const user = db.users.find(u => (token.includes(u.email) || token === 'mocked_admin_token') && u.role === 'ADMIN');
  if (!user) {
    return sendError(res, 403, 'ACCESS_DENIED', '본사 관리자 권한이 없는 접근입니다.');
  }
  req.user = user;
  next();
};

// Middleware: HMAC Signature Validation
const verifySignature = (req, res, next) => {
  const signature = req.headers['x-eatspay-signature'];
  const timestamp = req.headers['x-eatspay-timestamp'];

  if (!signature || !timestamp) {
    return sendError(res, 403, 'SIGNATURE_VERIFICATION_FAILED', '보안용 HMAC 헤더가 누락되었습니다.');
  }

  // Allow bypass for local test signature
  if (signature === 'mocked_signature') {
    return next();
  }

  // Check if timestamp is within 5 minutes (300,000 ms) for replay attack prevention
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    return sendError(res, 403, 'SIGNATURE_VERIFICATION_FAILED', '요청 타임스탬프 허용 오차 한계를 초과했습니다.');
  }

  // Calculate HMAC using Secret Key and request body
  const rawBody = JSON.stringify(req.body);
  const calculatedSig = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(rawBody + timestamp)
    .digest('hex');

  // Allow 'mocked_signature' for testing ease
  if (signature !== 'mocked_signature' && signature !== calculatedSig) {
    return sendError(res, 403, 'SIGNATURE_VERIFICATION_FAILED', '무결성 해시 서명이 올바르지 않습니다.');
  }

  next();
};

// ==========================================
// API Endpoints
// ==========================================

/**
 * 2.1 A. 일반 로그인 (POST /api/auth/login)
 */
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  logAction('AUTH', '로그인 요청', { email });

  if (!email || !password) {
    return sendError(res, 400, 'BAD_REQUEST', '이메일과 비밀번호는 필수 입력 항목입니다.');
  }

  const user = db.users.find(u => u.email === email && u.password === password);
  if (!user) {
    return sendError(res, 401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 일치하지 않습니다.');
  }

  return res.status(200).json({
    success: true,
    data: {
      accessToken: `jwt_token_${user.email}_session`,
      tokenType: 'Bearer',
      expiresIn: 86400,
      user: {
        id: user.id,
        name: user.name,
        franchiseName: user.franchiseName,
        role: user.role
      }
    }
  });
});

/**
 * 2.1 A. 사업자등록번호 검증 및 국세청 조회 시뮬레이션 (POST /api/auth/verify-business)
 */
app.post('/api/auth/verify-business', async (req, res) => {
  const { businessNumber } = req.body;
  logAction('AUTH', '사업자등록번호 조회 요청', { businessNumber });

  if (!businessNumber) {
    return sendError(res, 400, 'BAD_REQUEST', '사업자등록번호를 입력해주세요.');
  }

  const clean = businessNumber.replace(/[^0-9]/g, '');
  if (clean.length !== 10) {
    return sendError(res, 400, 'INVALID_FORMAT', '사업자등록번호는 10자리 숫자여야 합니다.');
  }

  // Check if already registered
  const duplicate = db.users.find(u => u.businessNumber && u.businessNumber.replace(/[^0-9]/g, '') === clean);
  if (duplicate) {
    return sendError(res, 409, 'ALREADY_EXISTS', '이미 가입된 사업자등록번호입니다.');
  }

  // 1. Real-time National Tax Service (NTS) Public API Integration
  const ntsServiceKey = process.env.NTS_SERVICE_KEY;
  if (ntsServiceKey) {
    try {
      logAction('AUTH', '국세청 실시간 API 조회 시도', { clean });
      const apiUrl = `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${ntsServiceKey}`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ b_no: [clean] })
      });

      if (response.ok) {
        const result = await response.json();
        const bizData = result.data && result.data[0];
        if (bizData) {
          if (bizData.b_stt_cd === '01') { // 01: 계속사업자 (정상영업)
            return res.status(200).json({
              success: true,
              message: `[국세청 실시간 확인 완료] ${bizData.tax_type || '정상 가맹점'}으로 확인되었습니다.`,
              data: {
                businessNumber: businessNumber,
                status: '정상영업',
                taxType: bizData.tax_type
              }
            });
          } else if (bizData.b_stt_cd === '02' || bizData.b_stt_cd === '03') {
            const statusText = bizData.b_stt || '휴/폐업 가맹점';
            return sendError(res, 400, 'VERIFICATION_FAILED', `국세청 조회 결과 가입할 수 없는 사업자 상태입니다. (상태: ${statusText})`);
          } else {
            // Unregistered or deleted business number
            return sendError(res, 400, 'VERIFICATION_FAILED', bizData.tax_type || '국세청에 등록되지 않은 사업자등록번호입니다.');
          }
        }
      }
      logAction('AUTH', '국세청 API 응답 오류 혹은 데이터 없음. 로컬 시뮬레이션 폴백 실행');
    } catch (apiErr) {
      console.error('NTS API Connection Error:', apiErr);
      logAction('AUTH', '국세청 API 연결 에러. 로컬 시뮬레이션 폴백 실행');
    }
  }

  // 2. Standard Korean business registration checksum validation (Option 2 Checklist Fallback)
  const mockBypasses = ['1200012345', '1200054321', '1200099999', '1200000000'];
  let isValid = mockBypasses.includes(clean);

  if (!isValid) {
    const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
    let sum = 0;
    for (let i = 0; i < 8; i++) {
      sum += parseInt(clean[i], 10) * weights[i];
    }
    const val = parseInt(clean[8], 10) * weights[8];
    sum += Math.floor(val / 10) + (val % 10);
    const checkDigit = (10 - (sum % 10)) % 10;
    isValid = (checkDigit === parseInt(clean[9], 10));
  }

  if (!isValid) {
    return sendError(res, 400, 'VERIFICATION_FAILED', '국세청에 등록되지 않았거나 유효하지 않은 사업자등록번호입니다.');
  }

  return res.status(200).json({
    success: true,
    message: '국세청 기준 정상 영업 가맹점으로 정상 조회되었습니다.',
    data: {
      businessNumber: businessNumber,
      status: '정상영업',
      taxType: '일반과세자'
    }
  });
});

/**
 * 2.1 C. 일반 회원가입 (POST /api/auth/register)
 */
app.post('/api/auth/register', (req, res) => {
  const { email, password, phone, storeName, ceoName, address, tel, businessNumber } = req.body;
  logAction('AUTH', '회원가입 요청', { email, storeName });

  if (!email || !password || !storeName || !ceoName || !businessNumber) {
    return sendError(res, 400, 'BAD_REQUEST', '이메일, 비밀번호, 상호명, 대표자명, 사업자등록번호는 필수 항목입니다.');
  }

  const existingUser = db.users.find(u => u.email === email);
  if (existingUser) {
    return sendError(res, 409, 'ALREADY_EXISTS', '이미 사용 중인 이메일 주소입니다.');
  }

  const nextUserId = Math.max(...db.users.map(u => u.id)) + 1;
  const nextFranchiseId = Math.max(...db.users.map(u => u.franchiseId || 0)) + 1;

  const newUser = {
    id: nextUserId,
    email,
    password,
    name: ceoName,
    franchiseName: storeName,
    franchiseId: nextFranchiseId,
    role: 'OWNER_PENDING',
    balance: 0,
    phone,
    address,
    tel,
    businessNumber,
    cards: []
  };

  db.users.push(newUser);

  return res.status(201).json({
    success: true,
    message: '회원가입이 완료되었습니다. 관리자 승인 대기 중입니다.',
    data: {
      id: newUser.id,
      email: newUser.email,
      storeName: newUser.franchiseName,
      role: newUser.role
    }
  });
});


/**
 * 2.1 B. 소셜 로그인 (POST /api/auth/social)
 */
app.post('/api/auth/social', (req, res) => {
  const { provider, accessToken } = req.body;
  logAction('AUTH', '소셜 로그인 요청', { provider });

  const allowedProviders = ['KAKAO', 'NAVER', 'GOOGLE'];
  if (!provider || !allowedProviders.includes(provider.toUpperCase())) {
    return sendError(res, 400, 'INVALID_PROVIDER', '지원하지 않는 소셜 로그인 제공업체입니다.', [
      { field: 'provider', reason: 'KAKAO, NAVER, GOOGLE만 허용됩니다.' }
    ]);
  }

  // Mock mapping for 김철수 based on social login provider
  const user = db.users.find(u => u.role === 'OWNER_PENDING') || db.users[1];

  return res.status(200).json({
    success: true,
    data: {
      isRegistered: true,
      accessToken: `social_jwt_token_${provider}_session`,
      tokenType: 'Bearer',
      expiresIn: 86400,
      user: {
        id: user.id,
        name: user.name,
        franchiseName: user.franchiseName,
        role: user.role
      }
    }
  });
});

/**
 * 2.2 가상계좌 심사 등록 요청 및 사진 업로드 (POST /api/franchise/accounts)
 */
app.post('/api/franchise/accounts', authenticate, (req, res) => {
  upload.single('documentFile')(req, res, function (err) {
    if (err) {
      if (err.message === 'INVALID_FILE_FORMAT' || err.code === 'LIMIT_FILE_TYPES') {
        return sendError(res, 415, 'INVALID_FILE_FORMAT', '허용되지 않는 파일 형식입니다. (pdf, jpg, png만 가능)');
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 413, 'FILE_SIZE_LIMIT_EXCEEDED', '첨부파일 크기 한도(10MB)를 초과하였습니다.');
      }
      return sendError(res, 400, 'UPLOAD_ERROR', err.message);
    }

    const { franchiseName, businessNumber, bankCode, representativeName } = req.body;
    logAction('FRANCHISE', '가상계좌 심사 신청', { franchiseName, businessNumber, bankCode });

    // Validation
    const bizNoRegex = /^\d{3}-\d{2}-\d{5}$/;
    if (!businessNumber || !bizNoRegex.test(businessNumber)) {
      return sendError(res, 400, 'INVALID_BUSINESS_NUMBER', '사업자등록번호 형식이 불일치합니다. (XXX-XX-XXXXX 형식 필요)');
    }

    if (!franchiseName || !bankCode || !representativeName) {
      return sendError(res, 400, 'MISSING_FIELDS', '필수 입력 필드가 누락되었습니다.');
    }

    // Generate Request ID
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const requestId = `REQ-${todayStr}-${randNum}`;

    const newRequest = {
      requestId,
      franchiseId: req.user.franchiseId || 1052,
      franchiseName,
      businessNumber,
      bankCode,
      representativeName,
      status: 'PENDING',
      documentUrl: req.file ? `https://storage.eatspay.co.kr/documents/${req.file.originalname}` : 'https://storage.eatspay.co.kr/documents/biz_cert_mock.jpg',
      submittedAt: getTimestamp(),
      assignedVirtualAccount: null,
      rejectionReason: null
    };

    db.accountRequests.push(newRequest);

    return res.status(202).json({
      success: true,
      message: '가상계좌 발급 심사 요청이 접수되었습니다.',
      data: newRequest
    });
  });
});

/**
 * 2.3 대행비 카드 결제 요청 (POST /api/payment/charge)
 */
app.post('/api/payment/charge', authenticate, verifySignature, (req, res) => {
  const { amount, calculatedFee, totalAmount, cardId, paymentGateway } = req.body;
  logAction('PAYMENT', '대행비 카드 결제 요청', { amount, calculatedFee, totalAmount });

  if (!amount || !calculatedFee || !totalAmount || !cardId) {
    return sendError(res, 400, 'MISSING_FIELDS', '요청 필드가 누락되었습니다.');
  }

  // Precise financial check: 4.602% fee validation (Math.floor(amount * 0.04602))
  const expectedFee = Math.floor(amount * 0.04602);
  if (calculatedFee !== expectedFee) {
    return sendError(res, 400, 'FEE_MISMATCH', `수수료 연산 결과 검증 실패. 기대값: ${expectedFee}, 요청값: ${calculatedFee}`);
  }

  if (totalAmount !== amount + expectedFee) {
    return sendError(res, 400, 'FEE_MISMATCH', `총액 오류. 기대값: ${amount + expectedFee}, 요청값: ${totalAmount}`);
  }

  // Mock Card Limit Check
  if (amount > 10000000) {
    return sendError(res, 402, 'CARD_LIMIT_EXCEEDED', '카드 한도 초과 혹은 카드 승인 거절 오류가 발생했습니다.');
  }

  // Success payment updates balance
  const user = db.users.find(u => u.id === req.user.id);
  user.balance += amount;

  const transactionId = `TXN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000000 + Math.random() * 9000000)}`;
  const newTxn = {
    transactionId,
    franchiseId: user.franchiseId || 1052,
    type: 'CHARGE',
    amount,
    fee: calculatedFee,
    totalAmount,
    method: 'CARD',
    cardDetails: '국민카드 (****-****-1234)',
    status: 'SUCCESS',
    createdAt: getTimestamp()
  };

  db.transactions.push(newTxn);

  return res.status(200).json({
    success: true,
    data: {
      transactionId,
      status: 'PAID',
      amount,
      fee: calculatedFee,
      totalAmount,
      approvedAt: getTimestamp(),
      updatedBalance: user.balance
    }
  });
});

/**
 * 2.4 가맹점별 기간 필터 결제 내역 조회 (GET /api/payment/history)
 */
app.get('/api/payment/history', authenticate, (req, res) => {
  const { startDate, endDate, type = 'ALL', page = 1, limit = 10 } = req.query;
  logAction('PAYMENT', '내역 조회 요청', { startDate, endDate, type, page, limit });

  if (!startDate || !endDate) {
    return sendError(res, 400, 'MISSING_DATE_FILTER', 'startDate와 endDate는 필수 검색 필터 조건입니다.');
  }

  const pNum = parseInt(page, 10);
  const lNum = parseInt(limit, 10);

  // Filter transactions
  const filtered = db.transactions.filter(t => {
    // Filter by franchise
    if (req.user.role === 'OWNER' && t.franchiseId !== req.user.franchiseId) return false;

    // Filter by date
    const txnDate = t.createdAt.slice(0, 10);
    if (txnDate < startDate || txnDate > endDate) return false;

    // Filter by type
    if (type !== 'ALL' && t.type !== type) return false;

    return true;
  });

  // Pagination
  const startIndex = (pNum - 1) * lNum;
  const endIndex = pNum * lNum;
  const paginatedItems = filtered.slice(startIndex, endIndex);
  const totalPages = Math.ceil(filtered.length / lNum) || 1;

  return res.status(200).json({
    success: true,
    data: {
      items: paginatedItems,
      pagination: {
        currentPage: pNum,
        totalPages,
        totalItems: filtered.length,
        limit: lNum
      }
    }
  });
});

/**
 * 2.3 B. 카드 등록 (POST /api/card/register)
 */
app.post('/api/card/register', authenticate, (req, res) => {
  const { cardNumber, cardPw, expiryMonth, expiryYear, identity, alias } = req.body;
  logAction('PAYMENT', '카드 등록 요청', { cardNumber: cardNumber ? cardNumber.slice(0, 4) + '-****' : 'none', alias });

  if (!cardNumber || !cardPw || !expiryMonth || !expiryYear || !identity) {
    return sendError(res, 400, 'BAD_REQUEST', '카드번호, 비밀번호앞2자리, 만료월, 만료년, 식별정보(생년월일/법인번호)는 필수입니다.');
  }

  // Find user and save card information
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) {
    return sendError(res, 404, 'USER_NOT_FOUND', '사용자 정보를 찾을 수 없습니다.');
  }

  if (!user.cards) {
    user.cards = [];
  }

  const cardName = cardNumber.startsWith('9') ? '비씨카드' : cardNumber.startsWith('8') ? '현대카드' : '삼성카드';
  const last4 = cardNumber.slice(-4);
  const maskedCard = `${cardName} (****-****-${last4})`;

  const newCard = {
    id: `card_ref_${Math.floor(10000 + Math.random() * 90000)}`,
    maskedNumber: maskedCard,
    cardName,
    alias: alias || (user.cards.length === 0 ? '운영카드' : `서브카드${user.cards.length}`),
    createdAt: getTimestamp()
  };

  user.cards.push(newCard);

  return res.status(200).json({
    success: true,
    message: '카드가 성공적으로 등록되었습니다.',
    data: newCard
  });
});


/**
 * 2.5 본사 관리자용 계좌 심사 승인/반려 처리 (POST /api/admin/accounts/approve)
 */
app.post('/api/admin/accounts/approve', authenticateAdmin, (req, res) => {
  const { requestId, action, assignedVirtualAccount, rejectionReason } = req.body;
  logAction('ADMIN', '가상계좌 승인/반려 처리', { requestId, action });

  const request = db.accountRequests.find(r => r.requestId === requestId);
  if (!request) {
    return sendError(res, 404, 'REQUEST_NOT_FOUND', '존재하지 않는 가상계좌 심사 신청건입니다.');
  }

  if (request.status !== 'PENDING') {
    return sendError(res, 409, 'ALREADY_PROCESSED', '이미 심사가 최종 완료된 건으로 재처리가 불가합니다.');
  }

  if (action === 'APPROVED') {
    if (!assignedVirtualAccount || !assignedVirtualAccount.accountNumber) {
      return sendError(res, 400, 'MISSING_ACCOUNT_INFO', '승인 시 발급할 가상계좌 정보가 필수입니다.');
    }
    request.status = 'APPROVED';
    request.assignedVirtualAccount = assignedVirtualAccount;
  } else if (action === 'REJECTED') {
    if (!rejectionReason) {
      return sendError(res, 400, 'MISSING_REJECTION_REASON', '반려 처리 시에는 반려 사유 기입이 필수입니다.');
    }
    request.status = 'REJECTED';
    request.rejectionReason = rejectionReason;
  } else {
    return sendError(res, 400, 'INVALID_ACTION', 'Action 필드는 APPROVED 또는 REJECTED여야 합니다.');
  }

  return res.status(200).json({
    success: true,
    message: '계좌 발급 심사가 성공적으로 완료 및 계좌가 할당되었습니다.',
    data: {
      requestId: request.requestId,
      status: request.status,
      approvedBy: req.user.name,
      processedAt: getTimestamp()
    }
  });
});

/**
 * 2.6 본사 관리자용 결제 및 정산 롤백 처리 (POST /api/admin/settlement/rollback)
 */
app.post('/api/admin/settlement/rollback', authenticateAdmin, verifySignature, (req, res) => {
  const { targetTransactionId, reason, doubleAuthToken } = req.body;
  logAction('ADMIN', '결제 롤백 요청', { targetTransactionId, reason });

  if (doubleAuthToken !== 'ADMIN_2FA_TOKEN_VERIFIED') {
    return sendError(res, 401, 'MFA_REQUIRED', '2차 보안용 인증 토큰(MFA) 검증에 실패했습니다.');
  }

  const transaction = db.transactions.find(t => t.transactionId === targetTransactionId);
  if (!transaction) {
    return sendError(res, 404, 'TRANSACTION_NOT_FOUND', '롤백 처리할 원 거래 내역을 찾을 수 없습니다.');
  }

  if (transaction.status === 'ROLLED_BACK') {
    return sendError(res, 409, 'TRANSACTION_ALREADY_ROLLED_BACK', '이미 환불 및 롤백이 완료된 정산 트랜잭션입니다.');
  }

  const user = db.users.find(u => u.franchiseId === transaction.franchiseId);
  if (!user) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', '연계된 가맹점주 정보를 찾을 수 없습니다.');
  }

  // Financial constraint check: Current balance must be enough to deduct refundAmount
  if (user.balance < transaction.amount) {
    return sendError(
      res,
      400,
      'INSUFFICIENT_BALANCE',
      `보유 잔액 부족으로 롤백이 불가능합니다. 롤백요청액: ${transaction.amount}원, 현재잔액: ${user.balance}원`
    );
  }

  // Process balance deduction & state update
  user.balance -= transaction.amount;
  transaction.status = 'ROLLED_BACK';

  const rollbackId = `ROL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(10000 + Math.random() * 90000)}`;

  return res.status(200).json({
    success: true,
    message: '결제 거래 및 가맹점 정산 잔액이 정상적으로 롤백 완료되었습니다.',
    data: {
      rollbackTransactionId: rollbackId,
      targetTransactionId: transaction.transactionId,
      refundAmount: transaction.amount,
      refundFee: transaction.fee,
      refundTotalAmount: transaction.totalAmount,
      deductedFranchiseBalance: user.balance,
      processedAt: getTimestamp()
    }
  });
});

/**
 * 2.7 본사 관리자용 가맹점 목록 전체 조회 (GET /api/admin/franchises)
 */
app.get('/api/admin/franchises', authenticateAdmin, (req, res) => {
  logAction('ADMIN', '가맹점 목록 조회 요청');

  // Convert db.users with OWNER roles to franchise records for admin consumption
  const list = db.users.filter(u => u.role === 'OWNER' || u.role === 'OWNER_PENDING').map(u => {
    return {
      id: u.franchiseId,
      name: u.franchiseName || '미등록 상점',
      owner: u.name,
      phone: u.phone || '010-0000-0000',
      bizNo: u.businessNumber || '000-00-00000',
      joinDate: new Date().toISOString().slice(0, 10),
      lastPaymentDate: '',
      status: u.role === 'OWNER' ? '정상 승인' : '승인 대기',
      email: u.email,
      role: u.role,
      deliveryAgencies: []
    };
  });

  return res.status(200).json({
    success: true,
    data: list
  });
});

/**
 * 2.8 본사 관리자용 가맹점 가입 승인 처리 (POST /api/admin/franchise/approve)
 */
app.post('/api/admin/franchise/approve', authenticateAdmin, (req, res) => {
  const { email, action } = req.body;
  logAction('ADMIN', '가맹점 승인/반려 처리', { email, action });

  const user = db.users.find(u => u.email === email);
  if (!user) {
    return sendError(res, 404, 'USER_NOT_FOUND', '존재하지 않는 가맹점주 이메일입니다.');
  }

  if (action === 'APPROVED') {
    user.role = 'OWNER';
  } else if (action === 'REJECTED') {
    user.role = 'OWNER_REJECTED';
  } else {
    return sendError(res, 400, 'INVALID_ACTION', 'Action 필드는 APPROVED 또는 REJECTED여야 합니다.');
  }

  return res.status(200).json({
    success: true,
    message: '가맹점 승인 상태가 업데이트되었습니다.',
    data: {
      email: user.email,
      role: user.role
    }
  });
});

/**
 * 2.9 본사 관리자용 가상계좌 심사 목록 조회 (GET /api/admin/accounts)
 */
app.get('/api/admin/accounts', authenticateAdmin, (req, res) => {
  logAction('ADMIN', '가상계좌 심사 목록 조회 요청');
  return res.status(200).json({
    success: true,
    data: db.accountRequests
  });
});


// Start Express Server
app.listen(PORT, () => {
  console.log(`[EatsPay Server] Running on http://localhost:${PORT}`);
  console.log('========================================================================');
  console.log('1. [POST] 일반 로그인: /api/auth/login');
  console.log('2. [POST] 소셜 로그인: /api/auth/social');
  console.log('3. [POST] 가상계좌 심사 신청: /api/franchise/accounts');
  console.log('4. [POST] 대행비 카드결제: /api/payment/charge');
  console.log('5. [GET] 결제 내역 기간 조회: /api/payment/history');
  console.log('6. [POST] 계좌 심사 승인/반려: /api/admin/accounts/approve');
  console.log('7. [POST] 결제 및 정산 롤백: /api/admin/settlement/rollback');
  console.log('========================================================================');
});

/**
 * ========================================================================
 * 🧪 CURL TEST SCENARIOS (실행 및 통합 검증 시나리오)
 * ========================================================================
 *
 * 아래 cURL 스크립트를 사용하여 가상 통합 백엔드 API를 테스트할 수 있습니다.
 *
 * 1. 일반 로그인 테스트
 * curl -X POST http://localhost:3000/api/auth/login \
 *   -H "Content-Type: application/json" \
 *   -d "{\"email\":\"franchise_owner@eatspay.com\",\"password\":\"Password123!\"}"
 *
 * 2. 소셜 로그인 테스트
 * curl -X POST http://localhost:3000/api/auth/social \
 *   -H "Content-Type: application/json" \
 *   -d "{\"provider\":\"KAKAO\",\"accessToken\":\"mock_kakao_token\"}"
 *
 * 3. 가상계좌 발급 심사 신청 등록 (Multipart 파일 첨부 포함)
 * curl -X POST http://localhost:3000/api/franchise/accounts \
 *   -H "Authorization: Bearer mocked_jwt_token_here" \
 *   -F "franchiseName=이츠분식 강남점" \
 *   -F "businessNumber=120-00-12345" \
 *   -F "bankCode=088" \
 *   -F "representativeName=홍길동" \
 *   -F "documentFile=@biz_cert_mock.jpg"
 *
 * 4. 대행비 카드 결제 충전 (4.602% 수수료 검증 및 mock Signature 헤더 필수)
 * curl -X POST http://localhost:3000/api/payment/charge \
 *   -H "Authorization: Bearer mocked_jwt_token_here" \
 *   -H "Content-Type: application/json" \
 *   -H "x-eatspay-signature: mocked_signature" \
 *   -H "x-eatspay-timestamp: 1716876608" \
 *   -d "{\"amount\":100000,\"calculatedFee\":4602,\"totalAmount\":104602,\"cardId\":\"card_ref_88204\",\"paymentGateway\":\"KCP\"}"
 *
 * 5. 결제 및 충전 히스토리 필터 조회
 * curl -X GET "http://localhost:3000/api/payment/history?startDate=2026-05-01&endDate=2026-05-30&type=ALL" \
 *   -H "Authorization: Bearer mocked_jwt_token_here"
 *
 * 6. 본사 관리자용 가상계좌 승인 처리 (Admin 토큰 필요)
 * curl -X POST http://localhost:3000/api/admin/accounts/approve \
 *   -H "Authorization: Bearer mocked_admin_token" \
 *   -H "Content-Type: application/json" \
 *   -d "{\"requestId\":\"REQ-20260528-0912\",\"action\":\"APPROVED\",\"assignedVirtualAccount\":{\"bankCode\":\"088\",\"bankName\":\"신한은행\",\"accountNumber\":\"562-901-209384\",\"accountHolder\":\"(주)이츠페이_강남점\"}}"
 *
 * 7. 본사 관리자용 거래 취소 및 정산 롤백 처리 (Double Auth 및 Signature 헤더 필수)
 * curl -X POST http://localhost:3000/api/admin/settlement/rollback \
 *   -H "Authorization: Bearer mocked_admin_token" \
 *   -H "Content-Type: application/json" \
 *   -H "x-eatspay-signature: mocked_signature" \
 *   -H "x-eatspay-timestamp: 1716876608" \
 *   -d "{\"targetTransactionId\":\"TXN-20260528-9840294\",\"reason\":\"가맹점 중복 결제 확인\",\"doubleAuthToken\":\"ADMIN_2FA_TOKEN_VERIFIED\"}"
 */
