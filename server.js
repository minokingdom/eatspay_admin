const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const express = require('express');
const ExcelJS = require('exceljs');
const multer = require('multer');

const { createPool } = require('./db/pool');
const { createRepository } = require('./db/repository');
const { parseCardGorillaRanking } = require('./lib/cardgorilla');

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
pool.on('error', err => {
  console.error('[DB_POOL_ERROR]', err?.message || err);
});
const repo = createRepository(pool);
const DEFAULT_AGENCY_NAME = '이츠페이 본사';
const TEST_BUSINESS_NUMBER = '1234512345';
const CHARGE_DEPOSIT_RATE = 0.956;
const ACCOUNT_EXPORT_TEMPLATE_PATH = path.join(__dirname, 'assets', 'templates', 'merchant_registration_template.xlsx');
const CARDGORILLA_RANKING_URL = String(process.env.CARDGORILLA_RANKING_URL || '').trim();
const CARDGORILLA_UPDATE_HOUR_KST = Number(process.env.CARDGORILLA_UPDATE_HOUR_KST || 6);
const ALIGO_API_URL = 'https://apis.aligo.in/send/';
const ALIGO_API_KEY = String(process.env.ALIGO_API_KEY || '').trim();
const ALIGO_USER_ID = String(process.env.ALIGO_USER_ID || '').trim();
const ALIGO_SENDER = String(process.env.ALIGO_SENDER || '').replace(/[^0-9]/g, '');
const SMS_VERIFICATION_TTL_MS = Number(process.env.SMS_VERIFICATION_TTL_MS || 3 * 60 * 1000);
const SMS_RESEND_COOLDOWN_MS = Number(process.env.SMS_RESEND_COOLDOWN_MS || 30 * 1000);
const ANDROID_PUSH_CHANNEL_ID = 'eatspay_talk_v2';
const DEFAULT_FIREBASE_SERVICE_ACCOUNT_PATH = '/opt/eatspay/secrets/firebase-service-account.json';
const FCM_MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
let cachedFirebaseServiceAccount = null;
let cachedFcmAccessToken = null;
let cachedFirebaseConfigError = '';
const smsVerificationStore = new Map();
const talkSellerCoordinateCache = new Map();
const ADMIN_LEVELS = {
  SUPER: { key: 'SUPER', name: '총괄 관리자', desc: '모든 기능 + 관리자 계정 생성/삭제', color: '#EF4444' },
  OPERATIONS: { key: 'OPERATIONS', name: '운영 관리자', desc: '가맹점 승인, 대리점 관리, 운영 메뉴', color: '#F59E0B' },
  SETTLEMENT: { key: 'SETTLEMENT', name: '정산 관리자', desc: '결제 내역, PG정산 확인, 정산 조회', color: '#3B82F6' },
  CUSTOMER: { key: 'CUSTOMER', name: '고객 관리자', desc: '공지사항, FAQ, 이용가이드 작성/수정', color: '#3D9B35' }
};
const ADMIN_ROLE_LIST = Object.values(ADMIN_LEVELS).map((role, index) => ({ ...role, displayOrder: index + 1 }));
const ADMIN_MENU_PERMISSIONS = {
  SUPER: ['dashboard', 'payments', 'pgsettle', 'settlements', 'franchises', 'franchiseDetail', 'accounts', 'agencies', 'agencyDetail', 'ag_detail', 'deliveryMgmt', 'inquiries', 'banners', 'legalDocs', 'faqs', 'installments', 'push', 'pg', 'admins', 'notices', 'guides'],
  OPERATIONS: ['dashboard', 'franchises', 'franchiseDetail', 'accounts', 'agencies', 'agencyDetail', 'ag_detail', 'deliveryMgmt', 'inquiries', 'banners', 'legalDocs', 'faqs', 'installments', 'push', 'notices', 'guides'],
  SETTLEMENT: ['dashboard', 'payments', 'pgsettle', 'settlements', 'pg'],
  CUSTOMER: ['dashboard', 'legalDocs', 'faqs', 'notices', 'guides', 'push']
};
const ADMIN_MENU_PERMISSION_SET = new Set(ADMIN_MENU_PERMISSIONS.SUPER);
const DEFAULT_DELIVERY_AGENCIES = [
  '생각대로',
  '바로고',
  '리드콜',
  '모아라인',
  '딜버',
  '만나플러스',
  '배달시대',
  '기타',
  '가까이',
  '가유로',
  '갖다줘유',
  '공유다',
  '국가대표',
  '국민라이더스',
  '국민배달',
  '굿보이',
  '나르미',
  '나르자',
  '나이스',
  '날라가',
  '냠냠박스',
  '넘버원',
  '논스톱',
  '뉴트랙',
  '다드림',
  '다배달',
  '달인콜',
  '달인퀵',
  '데일리퀵',
  '두바퀴',
  '드림',
  '디플러스',
  '딜리온',
  '똑똑',
  '런(RUN)',
  '런닝맨',
  '런투유',
  '렛츠고',
  '로드보이',
  '로드파이터',
  '로드파일럿',
  '링크',
  '마이콜',
  '모두의콜',
  '모아콜',
  '바람처럼',
  '바른콜',
  '배고파',
  '배나두',
  '배달고수',
  '배달본색',
  '배달요',
  '배달의고수',
  '배달의전설',
  '배달이요',
  '배달전설',
  '배달히어로',
  '배민상회',
  '번개G',
  '베테랑',
  '부릉',
  '비욘드 딜리버리',
  '비트',
  '빨리와',
  '상인회',
  '세이프',
  '순간이동',
  '슈퍼맨',
  '슈퍼히어로',
  '스타딜리버리',
  '스타콜',
  '스피드딜리버리',
  '스피드풍산',
  '알바콜',
  '에스콜',
  '에이스콜',
  '엔젤',
  '연합콜가즈아',
  '영웅배송 스파이더',
  '예스런',
  '오빠콜',
  '오케이콜',
  '온나',
  '와따',
  '워밍업',
  '위드런',
  '위드톡',
  '윈윈파트너',
  '유니온go',
  '이어드림',
  '이츠런',
  '인프라',
  '제트콜',
  '젠딜리',
  '젠틀리',
  '젠틀맨',
  '카카오콜',
  '칸',
  '코리오',
  '콜25',
  '콜고',
  '콜플레이',
  '콰이밍',
  '큐큐런',
  '큐텍코리아',
  '타이밍',
  '타자콜',
  '타자하나로',
  '타짜',
  '탑퀵박스',
  '토마토통통',
  '토마트소프트',
  '토마트플러스',
  '파랑F&S',
  '파랑푸드퀵',
  '푸드라인',
  '푸드바이크',
  '푸드뱅크',
  '플라이',
  '한다콜',
  '해피고고',
  '해피콜',
  '히어로',
  'FM',
  'IM극속전설',
  'Korea delivery',
  'link',
  'plz',
  'UFO',
  'VIP',
  'Z',
];
const DEFAULT_FINANCIAL_INSTITUTIONS = [
  { code: '002', name: '산업은행' },
  { code: '003', name: '기업은행' },
  { code: '004', name: '국민은행' },
  { code: '007', name: '수협중앙회' },
  { code: '011', name: '농협은행' },
  { code: '012', name: '지역농축협' },
  { code: '020', name: '우리은행' },
  { code: '023', name: 'SC은행' },
  { code: '027', name: '한국씨티은행' },
  { code: '031', name: '대구은행' },
  { code: '032', name: '부산은행' },
  { code: '034', name: '광주은행' },
  { code: '035', name: '제주은행' },
  { code: '037', name: '전북은행' },
  { code: '039', name: '경남은행' },
  { code: '045', name: '새마을금고중앙회' },
  { code: '048', name: '신협중앙회' },
  { code: '050', name: '저축은행' },
  { code: '054', name: 'HSBC은행' },
  { code: '055', name: '도이치은행' },
  { code: '057', name: '제이피모간체이스은행' },
  { code: '060', name: 'BOA은행' },
  { code: '061', name: '비엔피파리바은행' },
  { code: '064', name: '산림조합' },
  { code: '071', name: '우체국' },
  { code: '081', name: '하나은행' },
  { code: '088', name: '신한은행' },
  { code: '089', name: '케이뱅크' },
  { code: '090', name: '카카오뱅크' },
  { code: '092', name: '토스뱅크' },
  { code: '261', name: '교보증권' },
  { code: '267', name: '대신증권' },
  { code: '287', name: '메리츠증권' },
  { code: '238', name: '미래에셋증권' },
  { code: '240', name: '삼성증권' },
  { code: '278', name: '신한금융투자' },
  { code: '209', name: '유안타증권' },
  { code: '280', name: '유진투자증권' },
  { code: '288', name: '카카오페이증권' },
  { code: '264', name: '키움증권' },
  { code: '271', name: '토스증권' },
  { code: '270', name: '하나금융투자' },
  { code: '243', name: '한국투자증권' },
  { code: '269', name: '한화투자증권' },
  { code: '263', name: '현대차증권' },
  { code: '279', name: 'DB금융투자' },
  { code: '218', name: 'KB증권' },
  { code: '292', name: 'LIG투자증권' },
  { code: '247', name: 'NH투자증권' },
  { code: '266', name: 'SK증권' }
];
const dbBootstrapPromise = (async () => {
  await pool.query('ALTER TABLE users ALTER COLUMN franchise_id DROP NOT NULL');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS login_id TEXT UNIQUE');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_email TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS biz_doc_file_key TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS pos_file_key TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS franchise_fee_rate NUMERIC(5,2)');
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_level TEXT");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_permissions JSONB");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_active BOOLEAN NOT NULL DEFAULT true");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ");
  await pool.query('UPDATE users SET login_id = email WHERE login_id IS NULL');
  await pool.query("UPDATE users SET admin_level = 'SUPER', admin_active = true, login_id = COALESCE(login_id, email), franchise_id = COALESCE(franchise_id, id), franchise_name = COALESCE(franchise_name, name), updated_at = now() WHERE role = 'ADMIN' AND (admin_level IS NULL OR admin_level = '')");
  await pool.query("UPDATE users SET admin_permissions = $1::jsonb, updated_at = now() WHERE role = 'ADMIN' AND admin_permissions IS NULL", [JSON.stringify(ADMIN_MENU_PERMISSIONS.SUPER)]);
  await pool.query('ALTER TABLE cards ADD COLUMN IF NOT EXISTS card_company TEXT');
  await pool.query('ALTER TABLE cards ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true');
  await pool.query('ALTER TABLE cards ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE cards ADD COLUMN IF NOT EXISTS expiry_month TEXT');
  await pool.query('ALTER TABLE cards ADD COLUMN IF NOT EXISTS expiry_year TEXT');
  await pool.query('ALTER TABLE cards ADD COLUMN IF NOT EXISTS payer_name TEXT');
  await pool.query('ALTER TABLE cards ADD COLUMN IF NOT EXISTS payer_email TEXT');
  await pool.query('ALTER TABLE cards ADD COLUMN IF NOT EXISTS payer_tel TEXT');
  await pool.query('ALTER TABLE cards ADD COLUMN IF NOT EXISTS card_identity TEXT');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS bank_name TEXT');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS delivery_agency_name TEXT');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS account_no TEXT');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS export_ready_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS export_batch_id TEXT');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS export_row_no INTEGER');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS txid TEXT');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS txid_uploaded_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS export_ready_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS export_batch_id TEXT');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS export_row_no INTEGER');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS txid TEXT');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS txid_uploaded_at TIMESTAMPTZ');
  await pool.query("UPDATE delivery_accounts SET approved_at = COALESCE(approved_at, updated_at, req_date) WHERE account_status = 'APPROVED'");
  await pool.query('ALTER TABLE agencies ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 3');
  await pool.query('ALTER TABLE agencies ADD COLUMN IF NOT EXISTS delivery_note TEXT');
  await pool.query(`
    UPDATE agencies
    SET level = CASE
      WHEN join_code = 'EATSPAY-HQ' OR type = 'HQ' OR name LIKE '%본사%' THEN 1
      WHEN name LIKE '%1단계%' THEN 1
      WHEN name LIKE '%2단계%' THEN 2
      WHEN name LIKE '%3단계%' THEN 3
      WHEN name LIKE '%4단계%' THEN 4
      ELSE level
    END
  `);
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
  await pool.query("ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7)");
  await pool.query("ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7)");
  await pool.query("ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS coverage_area TEXT");
  await pool.query("ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS phone TEXT");
  await pool.query("ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS description TEXT");
  await pool.query("ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS logo_url TEXT");
  await pool.query("ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS corporation_name TEXT");
  await pool.query("ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS business_number TEXT");
  await pool.query("ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS business_file_key TEXT");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS benefit_cards (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT NOT NULL DEFAULT '',
      rank_no INTEGER,
      card_company TEXT NOT NULL,
      card_name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      discount_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
      annual_fee TEXT NOT NULL DEFAULT '',
      tags TEXT[] NOT NULL DEFAULT '{}',
      source_card_idx TEXT,
      image_url TEXT,
      event_title TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (source, card_company, card_name)
    )
  `);
  await pool.query("ALTER TABLE benefit_cards ADD COLUMN IF NOT EXISTS source_card_idx TEXT");
  await pool.query("ALTER TABLE benefit_cards ADD COLUMN IF NOT EXISTS image_url TEXT");
  await pool.query("ALTER TABLE benefit_cards ADD COLUMN IF NOT EXISTS event_title TEXT");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_benefit_cards_active_rank ON benefit_cards(active, rank_no, id)');
  await pool.query(`
    INSERT INTO benefit_cards (source, rank_no, card_company, card_name, summary, discount_rate, annual_fee, tags, active)
    VALUES
      ('manual', 1, '비씨카드', '배달비 혜택 카드', '배달대행비 결제 시 할인 혜택을 확인해보세요.', 1.5, '국내전용 0원', ARRAY['배달대행비','할인','가맹점'], true),
      ('manual', 2, '신한카드', '사업자 결제 추천 카드', '사업자 카드 결제 이용 시 무이자 혜택을 확인해보세요.', 1.2, '카드별 상이', ARRAY['무이자','사업자','혜택'], true),
      ('manual', 3, '삼성카드', '월 결제 관리 카드', '월 배달대행비 결제 관리에 적합한 카드입니다.', 1.0, '카드별 상이', ARRAY['정산','월결제','관리'], true)
    ON CONFLICT (source, card_company, card_name) DO NOTHING
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pg_providers (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      mid TEXT,
      api_key TEXT,
      callback_url TEXT,
      status TEXT NOT NULL DEFAULT '활성',
      note TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_pg_providers_status ON pg_providers(status, display_order)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pg_notifications (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'GH Payments',
      event_type TEXT,
      transaction_id TEXT,
      pg_transaction_id TEXT,
      result_code TEXT,
      result_message TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      query JSONB NOT NULL DEFAULT '{}'::jsonb,
      headers JSONB NOT NULL DEFAULT '{}'::jsonb,
      processed BOOLEAN NOT NULL DEFAULT false,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_pg_notifications_received_at ON pg_notifications(received_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_pg_notifications_transaction_id ON pg_notifications(transaction_id)');
  await pool.query(`
    UPDATE pg_providers
    SET name = 'GH Payments',
        mid = '빌링 TMN026063 / 수기 TMN026062',
        api_key = '빌링 pk_123b-3b5ea2-d6d-e21a9 / 수기 pk_c375-b5b9e6-f5f-a0b4f',
        callback_url = 'https://eatspay.kr/api/ghpayments/notify',
        status = '활성',
        note = '메인 PG · 빌링 TMN026063 · 수기 TMN026062',
        display_order = 1,
        updated_at = now()
    WHERE name IN ('GH Payments', '건흥페이먼츠')
  `);
  await pool.query(`
    UPDATE pg_providers
    SET name = '넥스트페이',
        mid = 'NP260518001',
        api_key = 'np_live_****',
        callback_url = 'https://eatspay.kr/callback/nextpay',
        status = '활성',
        note = '2차 카드결제 PG사',
        display_order = 2,
        updated_at = now()
    WHERE name IN ('넥스트페이 (NextPay)', '넥스트페이')
  `);
  await pool.query(`
    DELETE FROM pg_providers a
    USING pg_providers b
    WHERE a.id > b.id
      AND a.name = b.name
  `);
  await pool.query(`
    UPDATE pg_settlements
    SET pg = 'GH Payments',
        updated_at = now()
    WHERE pg IN ('넥스트페이', '넥스트페이 (NextPay)', '건흥페이먼츠', '나이스페이', 'NicePay')
       OR pg ILIKE '%next%'
       OR pg ILIKE '%nice%'
       OR pg ILIKE '%건흥%'
  `);
  await pool.query(`
    INSERT INTO pg_providers (name, mid, api_key, callback_url, status, note, display_order)
    SELECT seed.name, seed.mid, seed.api_key, seed.callback_url, seed.status, seed.note, seed.display_order
    FROM (VALUES
      ('GH Payments', '빌링 TMN026063 / 수기 TMN026062', '빌링 pk_123b-3b5ea2-d6d-e21a9 / 수기 pk_c375-b5b9e6-f5f-a0b4f', 'https://eatspay.kr/api/ghpayments/notify', '활성', '메인 PG · 빌링 TMN026063 · 수기 TMN026062', 1),
      ('넥스트페이', 'NP260518001', 'np_live_****', 'https://eatspay.kr/callback/nextpay', '활성', '2차 카드결제 PG사', 2),
      ('이츠페이 예비 PG', 'EPBACKUP001', 'ep_backup_****', 'https://eatspay.kr/callback/backup', '비활성', '장애 대응 예비 PG사', 4)
    ) AS seed(name, mid, api_key, callback_url, status, note, display_order)
    WHERE NOT EXISTS (SELECT 1 FROM pg_providers p WHERE p.name = seed.name)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_inquiries (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      delivery_agency TEXT,
      region TEXT,
      handler TEXT,
      status TEXT NOT NULL DEFAULT '상담 대기',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_agency_inquiries_status ON agency_inquiries(status, created_at DESC)');
  await pool.query(`
    INSERT INTO agency_inquiries (name, phone, delivery_agency, region, handler, status, created_at, updated_at)
    SELECT seed.name, seed.phone, seed.delivery_agency, seed.region, seed.handler, seed.status, seed.created_at::timestamptz, seed.created_at::timestamptz
    FROM (VALUES
      ('정민우', '010-2634-1450', '유', '경주시 안강읍', '이서연', '상담 완료', '2026-02-25T09:00:00+09:00'),
      ('이재원', '010-5719-3651', '유', '춘천시', '미배정', '상담 대기', '2026-02-13T09:00:00+09:00'),
      ('박현수', '010-8823-4412', '무', '대전 유성구', '박지훈', '상담 대기', '2026-05-10T09:00:00+09:00')
    ) AS seed(name, phone, delivery_agency, region, handler, status, created_at)
    WHERE NOT EXISTS (
      SELECT 1
      FROM agency_inquiries ai
      WHERE ai.name = seed.name
        AND ai.phone = seed.phone
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_posts (
      id BIGSERIAL PRIMARY KEY,
      board_type TEXT NOT NULL CHECK (board_type IN ('notices', 'guides')),
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '운영팀',
      content TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_board_posts_type_active ON board_posts(board_type, active, created_at DESC)');
  await pool.query(`
    INSERT INTO board_posts (board_type, title, author, content, active)
    SELECT 'notices', '2026년 6월 시스템 점검 안내', '운영팀', '보다 안정적인 서비스 제공을 위해 시스템 점검이 진행됩니다.', true
    WHERE NOT EXISTS (SELECT 1 FROM board_posts WHERE board_type = 'notices')
  `);
  await pool.query(`
    INSERT INTO board_posts (board_type, title, author, content, active)
    SELECT 'guides', '이츠페이 가입 방법 안내', 'CS팀', '가입 URL 접속 후 사업자 정보와 배달대행사 가상계좌 정보를 등록해 주세요.', true
    WHERE NOT EXISTS (SELECT 1 FROM board_posts WHERE board_type = 'guides')
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS faqs (
      id BIGSERIAL PRIMARY KEY,
      category TEXT NOT NULL DEFAULT '서비스 안내',
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS faq_categories (
      name TEXT PRIMARY KEY,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_faqs_active_category ON faqs(active, category, display_order, id)');
  await pool.query(`
    INSERT INTO faqs (category, question, answer, active, display_order)
    SELECT '서비스 안내', '이츠페이는 어떤 서비스인가요?', '이츠페이(eats PAY)는 배달대행비를 신용카드로 결제할 수 있는 배달대행비 카드결제 중개 솔루션입니다.', true, 1
    WHERE NOT EXISTS (SELECT 1 FROM faqs)
  `);
  await pool.query(`
    INSERT INTO faq_categories (name, display_order)
    SELECT category, dense_rank() OVER (ORDER BY MIN(display_order), category)
    FROM faqs
    GROUP BY category
    ON CONFLICT (name) DO NOTHING
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS banners (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL DEFAULT '메인',
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      detail_title TEXT NOT NULL DEFAULT '',
      detail_subtitle TEXT NOT NULL DEFAULT '',
      detail_image_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '활성',
      display_order INTEGER NOT NULL DEFAULT 0,
      start_at TIMESTAMPTZ,
      end_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query("ALTER TABLE banners ADD COLUMN IF NOT EXISTS detail_title TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE banners ADD COLUMN IF NOT EXISTS detail_subtitle TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE banners ADD COLUMN IF NOT EXISTS detail_image_url TEXT NOT NULL DEFAULT ''");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_banners_status_type_order ON banners(status, type, display_order, id)');
  await pool.query(`
    INSERT INTO banners (type, title, subtitle, url, image_url, status, display_order)
    SELECT '메인', '앱 공지', '공지 준비중입니다.', '', '', '활성', 1
    WHERE NOT EXISTS (SELECT 1 FROM banners)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS legal_documents (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('terms', 'privacy')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_file_name TEXT,
      applied BOOLEAN NOT NULL DEFAULT false,
      applied_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_legal_documents_type_applied ON legal_documents(type, applied, applied_at DESC, id DESC)');
  await pool.query(`
    INSERT INTO legal_documents (type, title, content, applied, applied_at)
    SELECT 'terms', '서비스 이용약관', '이츠페이 서비스 이용을 위한 기본 약관입니다.', true, now()
    WHERE NOT EXISTS (SELECT 1 FROM legal_documents WHERE type = 'terms')
  `);
  await pool.query(`
    INSERT INTO legal_documents (type, title, content, applied, applied_at)
    SELECT 'privacy', '개인정보처리방침', '이츠페이 개인정보 처리에 관한 기본 방침입니다.', true, now()
    WHERE NOT EXISTS (SELECT 1 FROM legal_documents WHERE type = 'privacy')
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
      trade_status TEXT NOT NULL DEFAULT 'SALE',
      view_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query("ALTER TABLE talk_posts ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query("ALTER TABLE talk_posts ADD COLUMN IF NOT EXISTS trade_status TEXT NOT NULL DEFAULT 'SALE'");
  await pool.query("ALTER TABLE talk_posts ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0");
  await pool.query("UPDATE talk_posts SET trade_status = 'SALE' WHERE trade_status IS NULL OR trade_status = ''");
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
  await pool.query('ALTER TABLE talk_chats ADD COLUMN IF NOT EXISTS seller_left_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE talk_chats ADD COLUMN IF NOT EXISTS buyer_left_at TIMESTAMPTZ');
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS talk_comments (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES talk_posts(id) ON DELETE CASCADE,
      parent_comment_id BIGINT REFERENCES talk_comments(id) ON DELETE SET NULL,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      comment TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('ALTER TABLE talk_comments ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT REFERENCES talk_comments(id) ON DELETE SET NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_talk_posts_active_created ON talk_posts(status, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_talk_chats_user_updated ON talk_chats(buyer_user_id, seller_user_id, updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_talk_messages_chat_created ON talk_messages(chat_id, created_at)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_talk_comments_post_created ON talk_comments(post_id, created_at)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS talk_post_likes (
      post_id BIGINT NOT NULL REFERENCES talk_posts(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (post_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS talk_reports (
      id BIGSERIAL PRIMARY KEY,
      reporter_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      post_id BIGINT REFERENCES talk_posts(id) ON DELETE SET NULL,
      chat_id BIGINT REFERENCES talk_chats(id) ON DELETE SET NULL,
      message_id BIGINT REFERENCES talk_messages(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_talk_reports_status_created ON talk_reports(status, created_at DESC)');
  await pool.query(`
    INSERT INTO talk_posts (franchise_name, title, body, price, image_urls, status)
    SELECT '이츠페이', '이츠페이 톡 안내', '가맹점끼리 필요한 정보를 나누는 공간입니다. 승인된 가맹점은 글 등록과 채팅을 이용할 수 있습니다.', 0, '[]'::jsonb, 'ACTIVE'
    WHERE NOT EXISTS (SELECT 1 FROM talk_posts WHERE status = 'ACTIVE')
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS interest_free_installments (
      policy_month DATE NOT NULL DEFAULT date_trunc('month', now())::date,
      card_company TEXT PRIMARY KEY,
      months INTEGER[] NOT NULL DEFAULT '{}',
      active BOOLEAN NOT NULL DEFAULT true,
      display_order INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('ALTER TABLE interest_free_installments ADD COLUMN IF NOT EXISTS policy_month DATE');
  await pool.query("UPDATE interest_free_installments SET policy_month = date_trunc('month', now())::date WHERE policy_month IS NULL");
  await pool.query("ALTER TABLE interest_free_installments ALTER COLUMN policy_month SET DEFAULT date_trunc('month', now())::date");
  await pool.query('ALTER TABLE interest_free_installments ALTER COLUMN policy_month SET NOT NULL');
  await pool.query('ALTER TABLE interest_free_installments DROP CONSTRAINT IF EXISTS interest_free_installments_pkey');
  await pool.query('ALTER TABLE interest_free_installments ADD PRIMARY KEY (policy_month, card_company)');
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
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id, enabled)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS financial_institutions (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await repo.ensureDefaultAgency();
  await seedDeliveryAgencies();
  await seedFinancialInstitutions();
})();
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const deliveryAgencyLogoDir = path.join(__dirname, 'assets', 'delivery-agencies');
app.set('trust proxy', 1);
const GH_PAYMENTS_BASE_URL = (process.env.GH_PAYMENTS_BASE_URL || 'https://api.ghpayments.kr').replace(/\/$/, '');
const GH_PAYMENTS_BILLING_TID = String(process.env.GH_PAYMENTS_BILLING_TID || process.env.GH_PAYMENTS_TID || '').trim();
const GH_PAYMENTS_MANUAL_TID = String(process.env.GH_PAYMENTS_MANUAL_TID || '').trim();

app.get('/healthz', (req, res) => {
  return res.status(200).json({
    ok: true,
    service: 'eatspay',
    timestamp: new Date().toISOString()
  });
});

app.use((req, res, next) => {
  const nativeAppOrigins = ['http://localhost', 'capacitor://localhost', 'ionic://localhost'];
  const allowedOrigins = [
    ...(process.env.CORS_ORIGIN || '*')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
    ...nativeAppOrigins
  ];
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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (/\.(html|js|css)$/i.test(req.path) || req.path === '/' || req.path === '/admin' || req.path.startsWith('/join/') || req.path === '/sw.js') {
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
    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) return cb(null, true);
    return cb(new Error('INVALID_FILE_FORMAT'), false);
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '이츠페이_관리자_시스템_10.html'));
});

app.get('/join/:joinCode', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function getViewerCoordinateFromQuery(query = {}) {
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

async function enrichTalkPostResponse(post, viewerCoordinate = null) {
  if (!post) return post;
  const address = String(post.sellerAddress || '').trim();
  const viewerLat = Number(viewerCoordinate?.lat);
  const viewerLng = Number(viewerCoordinate?.lng);
  const hasViewerCoordinate = Number.isFinite(viewerLat) && Number.isFinite(viewerLng);
  if (!address) {
    return {
      ...post,
      distanceKm: null
    };
  }
  try {
    if (!talkSellerCoordinateCache.has(address)) {
      talkSellerCoordinateCache.set(address, await resolveKakaoAddressCoordinate(address));
    }
    const coordinate = talkSellerCoordinateCache.get(address);
    const sellerLatitude = coordinate?.lat ?? post.sellerLatitude ?? null;
    const sellerLongitude = coordinate?.lng ?? post.sellerLongitude ?? null;
    const hasSellerCoordinate = Number.isFinite(Number(sellerLatitude)) && Number.isFinite(Number(sellerLongitude));
    return {
      ...post,
      sellerLatitude,
      sellerLongitude,
      distanceKm: hasViewerCoordinate && hasSellerCoordinate
        ? calculateDistanceKm(viewerLat, viewerLng, Number(sellerLatitude), Number(sellerLongitude))
        : null
    };
  } catch (err) {
    return {
      ...post,
      distanceKm: null
    };
  }
}

app.get('/api/talk/posts', optionalAuthenticate, asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const viewerCoordinate = getViewerCoordinateFromQuery(req.query);
  const likedOnly = ['1', 'true', 'Y', 'LIKE', 'LIKED'].includes(String(req.query.liked || '').toUpperCase());
  const viewerUserId = req.user?.id || null;
  if (likedOnly && !viewerUserId) {
    return sendError(res, 401, 'UNAUTHORIZED', '로그인이 필요한 필터입니다.');
  }
  const [items, totalItems] = await Promise.all([
    repo.listTalkPosts({ limit, offset: (page - 1) * limit, viewerUserId, likedOnly }),
    repo.countTalkPosts({ viewerUserId, likedOnly })
  ]);
  const enrichedItems = await Promise.all(items.map(post => enrichTalkPostResponse(post, viewerCoordinate)));

  return res.status(200).json({
    success: true,
    data: {
      items: enrichedItems.map(post => ({
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
  const enrichedPost = await enrichTalkPostResponse(post, getViewerCoordinateFromQuery(req.query));
  return res.status(200).json({
    success: true,
    data: {
      ...enrichedPost,
      createdAtLabel: formatKstDateTime(enrichedPost.createdAt)
    }
  });
}));

app.get('/api/talk/posts/:id/comments', asyncHandler(async (req, res) => {
  const post = await repo.findTalkPostById(Number(req.params.id));
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', 'Talk 글을 찾을 수 없습니다.');
  }
  const comments = await repo.listTalkComments(post.id);
  return res.status(200).json({ success: true, data: comments });
}));

app.post('/api/talk/posts/:id/comments', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role === 'AGENCY') {
    return sendError(res, 403, 'ACCESS_DENIED', '대리점 계정은 Talk 댓글을 등록할 수 없습니다.');
  }
  if (req.user.role !== 'OWNER') {
    return sendError(res, 403, 'ACCESS_DENIED', '승인된 가맹점 계정만 Talk 댓글을 등록할 수 있습니다.');
  }
  const post = await repo.findTalkPostById(Number(req.params.id));
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', 'Talk 글을 찾을 수 없습니다.');
  }
  const comment = String(req.body?.comment || '').trim();
  const parentCommentId = req.body?.parentCommentId ? Number(req.body.parentCommentId) : null;
  if (!comment) {
    return sendError(res, 400, 'MISSING_COMMENT', '댓글을 입력해주세요.');
  }
  if (comment.length > 500) {
    return sendError(res, 400, 'COMMENT_TOO_LONG', '댓글은 500자 이내로 입력해주세요.');
  }
  if (parentCommentId) {
    const parentComment = await repo.findTalkCommentById(parentCommentId);
    if (!parentComment || String(parentComment.postId) !== String(post.id)) {
      return sendError(res, 400, 'INVALID_PARENT_COMMENT', '답글 대상 댓글을 찾을 수 없습니다.');
    }
  }
  const created = await repo.createTalkComment({
    postId: post.id,
    userId: req.user.id,
    comment,
    parentCommentId: Number.isFinite(parentCommentId) ? parentCommentId : null
  });
  return res.status(201).json({ success: true, message: '댓글이 등록되었습니다.', data: created });
}));

app.delete('/api/talk/posts/:postId/comments/:commentId', authenticate, asyncHandler(async (req, res) => {
  const post = await repo.findTalkPostById(Number(req.params.postId));
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', 'Talk 글을 찾을 수 없습니다.');
  }
  const comment = await repo.findTalkCommentById(Number(req.params.commentId));
  if (!comment || String(comment.postId) !== String(post.id)) {
    return sendError(res, 404, 'TALK_COMMENT_NOT_FOUND', '댓글을 찾을 수 없습니다.');
  }
  if (String(comment.userId) !== String(req.user.id)) {
    return sendError(res, 403, 'ACCESS_DENIED', '본인이 작성한 댓글만 삭제할 수 있습니다.');
  }
  await repo.deleteTalkComment(comment.id);
  return res.status(200).json({ success: true, message: '댓글이 삭제되었습니다.' });
}));

app.post('/api/talk/posts/:id/view', asyncHandler(async (req, res) => {
  const post = await repo.findTalkPostById(Number(req.params.id));
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', 'Talk 글을 찾을 수 없습니다.');
  }
  const viewCount = await repo.incrementTalkPostView(post.id);
  return res.status(200).json({ success: true, data: { viewCount } });
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

app.patch('/api/talk/posts/:id/trade-status', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role === 'AGENCY') {
    return sendError(res, 403, 'ACCESS_DENIED', '대리점 계정은 Talk 거래 상태를 변경할 수 없습니다.');
  }
  const nextStatus = String(req.body?.tradeStatus || '').trim().toUpperCase();
  const allowedStatuses = new Set(['SALE', 'RESERVED', 'SOLD']);
  if (!allowedStatuses.has(nextStatus)) {
    return sendError(res, 400, 'INVALID_TRADE_STATUS', '거래 상태가 올바르지 않습니다.');
  }
  const post = await repo.updateTalkPostTradeStatus({
    id: Number(req.params.id),
    userId: req.user.id,
    tradeStatus: nextStatus
  });
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', '내가 등록한 Talk 글을 찾을 수 없습니다.');
  }
  return res.status(200).json({
    success: true,
    data: {
      ...post,
      createdAtLabel: formatKstDateTime(post.createdAt)
    }
  });
}));

app.get('/api/talk/posts/:id/like', authenticate, asyncHandler(async (req, res) => {
  const post = await repo.findTalkPostById(Number(req.params.id));
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', 'Talk 글을 찾을 수 없습니다.');
  }
  const state = await repo.getTalkPostLikeState(post.id, req.user.id);
  return res.status(200).json({ success: true, data: state });
}));

app.post('/api/talk/posts/:id/like', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role === 'AGENCY') {
    return sendError(res, 403, 'ACCESS_DENIED', '대리점 계정은 관심 등록을 이용할 수 없습니다.');
  }
  const post = await repo.findTalkPostById(Number(req.params.id));
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', 'Talk 글을 찾을 수 없습니다.');
  }
  if (post.userId && Number(post.userId) === Number(req.user.id)) {
    return sendError(res, 400, 'SELF_LIKE_NOT_ALLOWED', '내가 등록한 글은 관심 등록할 수 없습니다.');
  }
  const state = await repo.toggleTalkPostLike({ postId: post.id, userId: req.user.id });
  return res.status(200).json({ success: true, data: state });
}));

app.post('/api/talk/posts/:id/report', authenticate, asyncHandler(async (req, res) => {
  const post = await repo.findTalkPostById(Number(req.params.id));
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', 'Talk 글을 찾을 수 없습니다.');
  }
  const reason = String(req.body?.reason || '부적절한 게시글').trim().slice(0, 80);
  const detail = String(req.body?.detail || '').trim().slice(0, 1000);
  await repo.createTalkReport({
    reporterUserId: req.user.id,
    postId: post.id,
    reason,
    detail
  });
  return res.status(201).json({ success: true, message: '신고가 접수되었습니다.' });
}));

app.post('/api/talk/posts/:id/chats', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role === 'AGENCY') {
    return sendError(res, 403, 'ACCESS_DENIED', '대리점 계정은 Talk 채팅을 이용할 수 없습니다.');
  }
  const post = await repo.findTalkPostById(Number(req.params.id));
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', 'Talk 글을 찾을 수 없습니다.');
  }
  if (post.tradeStatus === 'SOLD') {
    return sendError(res, 400, 'TALK_POST_SOLD', '판매완료된 글은 새 채팅을 시작할 수 없습니다.');
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

app.post('/api/talk/chats/:id/report', authenticate, asyncHandler(async (req, res) => {
  const chat = await repo.findTalkChatForUser(Number(req.params.id), req.user.id);
  if (!chat) {
    return sendError(res, 404, 'TALK_CHAT_NOT_FOUND', '채팅방을 찾을 수 없습니다.');
  }
  const reason = String(req.body?.reason || '부적절한 채팅').trim().slice(0, 80);
  const detail = String(req.body?.detail || '').trim().slice(0, 1000);
  await repo.createTalkReport({
    reporterUserId: req.user.id,
    postId: chat.postId,
    chatId: chat.id,
    reason,
    detail
  });
  return res.status(201).json({ success: true, message: '신고가 접수되었습니다.' });
}));

app.post('/api/talk/chats/:id/leave', authenticate, asyncHandler(async (req, res) => {
  const chat = await repo.leaveTalkChatForUser(Number(req.params.id), req.user.id);
  if (!chat) {
    return sendError(res, 404, 'TALK_CHAT_NOT_FOUND', '채팅방을 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, message: '채팅방에서 나갔습니다.', data: chat });
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
  const recipientUserId = Number(chat.sellerUserId) === Number(req.user.id)
    ? chat.buyerUserId
    : chat.sellerUserId;
  if (recipientUserId && Number(recipientUserId) !== Number(req.user.id)) {
    const pushData = {
      targetScreen: 'talk-chat',
      talkChatId: chat.id,
      chatId: chat.id,
      talkPostId: chat.postId,
      postId: chat.postId,
      source: 'eatspay_talk'
    };
    const title = '이츠톡 새 메시지';
    const body = `${req.user.franchiseName || req.user.name || '가맹점'}: ${message.slice(0, 80)}`;
    await repo.createNotification({
      userId: recipientUserId,
      type: 'TALK_MESSAGE',
      title,
      body,
      data: pushData
    });
    await sendUserPushNotification(recipientUserId, { title, body, data: pushData });
  }
  return res.status(201).json({
    success: true,
    data: {
      ...created,
      createdAtLabel: formatKstDateTime(created.createdAt)
    }
  });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const loginId = String(req.body?.loginId || req.body?.email || '').trim();
  const password = String(req.body?.password || '').trim();
  if (!loginId || !password) {
    return sendError(res, 400, 'BAD_REQUEST', 'loginId and password are required.');
  }

  let user = await repo.findUserByLoginId(loginId);
  if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    const agencyUser = await repo.findAgencyAuthByLoginId(loginId);
    if (!agencyUser || !agencyUser.passwordHash || !(await verifyPassword(password, agencyUser.passwordHash))) {
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid loginId or password.');
    }
    user = agencyUser;
  }
  if (user.role === 'ADMIN' && user.adminActive === false) {
    return sendError(res, 403, 'ADMIN_DISABLED', '비활성화된 관리자 계정입니다.');
  }
  const loginUser = user.role === 'ADMIN'
    ? (await repo.markAdminLogin(user.id)) || user
    : user;
  const accessToken = signToken(loginUser);
  res.setHeader('Set-Cookie', buildAuthCookie(req, accessToken));

  return res.status(200).json({
    success: true,
    data: {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 86400,
      user: publicUser(loginUser)
    }
  });
}));

app.post('/api/auth/verify-business', asyncHandler(async (req, res) => {
  const { businessNumber } = req.body;
  if (!businessNumber) {
    return sendError(res, 400, 'BAD_REQUEST', '사업자등록번호를 입력해 주세요.');
  }

  const rawBusinessNumber = String(businessNumber).trim();
  if (isTestBusinessNumber(rawBusinessNumber)) {
    return res.status(200).json({
      success: true,
      message: '테스트 사업자등록번호가 확인되었습니다.',
      data: { businessNumber: rawBusinessNumber, status: 'ACTIVE', taxType: 'TEST' }
    });
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

app.post('/api/auth/check-login-id', asyncHandler(async (req, res) => {
  const loginId = String(req.body?.loginId || req.body?.email || '').trim();
  if (!loginId) {
    return sendError(res, 400, 'BAD_REQUEST', '로그인 ID를 입력해 주세요.');
  }
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(loginId)) {
    return sendError(res, 400, 'INVALID_LOGIN_ID', '로그인 ID는 영문, 숫자, ., _, - 조합 3자 이상으로 입력해 주세요.');
  }

  // 탈퇴 회원도 거래 내역 보존을 위해 DB에 남기므로 동일 ID 재가입은 막는다.
  const existingUser = await repo.findUserByLoginId(loginId);
  if (existingUser) {
    return sendError(res, 409, 'ALREADY_EXISTS', '이미 사용 중인 아이디입니다.');
  }

  return res.status(200).json({
    success: true,
    message: '사용 가능한 아이디입니다.',
    data: { loginId, available: true }
  });
}));

app.post('/api/auth/sms/send', asyncHandler(async (req, res) => {
  const phone = normalizePhoneNumber(req.body?.phone);
  if (!phone || phone.length < 10 || phone.length > 11) {
    return sendError(res, 400, 'INVALID_PHONE', '휴대번호를 올바르게 입력해 주세요.');
  }

  const now = Date.now();
  const existing = smsVerificationStore.get(phone);
  if (existing?.sentAt && now - existing.sentAt < SMS_RESEND_COOLDOWN_MS) {
    const waitSeconds = Math.ceil((SMS_RESEND_COOLDOWN_MS - (now - existing.sentAt)) / 1000);
    return sendError(res, 429, 'SMS_RATE_LIMITED', `${waitSeconds}초 후 다시 발송해 주세요.`);
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  const message = `[이츠페이] 인증번호 [${code}]를 입력해 주세요.`;
  await sendAligoSms(phone, message);

  smsVerificationStore.set(phone, {
    codeHash: hashSmsCode(phone, code),
    expiresAt: now + SMS_VERIFICATION_TTL_MS,
    sentAt: now,
    attempts: 0,
    verifiedAt: 0
  });

  return res.status(200).json({
    success: true,
    message: '인증번호가 발송되었습니다.',
    data: {
      phone,
      expiresIn: Math.floor(SMS_VERIFICATION_TTL_MS / 1000)
    }
  });
}));

app.post('/api/auth/sms/verify', asyncHandler(async (req, res) => {
  const phone = normalizePhoneNumber(req.body?.phone);
  const code = String(req.body?.code || '').replace(/[^0-9]/g, '');
  if (!phone || !code) {
    return sendError(res, 400, 'BAD_REQUEST', '휴대번호와 인증번호를 입력해 주세요.');
  }

  const entry = smsVerificationStore.get(phone);
  if (!entry || Date.now() > entry.expiresAt) {
    smsVerificationStore.delete(phone);
    return sendError(res, 400, 'SMS_EXPIRED', '인증번호가 만료되었습니다. 다시 발송해 주세요.');
  }
  if (entry.attempts >= 5) {
    smsVerificationStore.delete(phone);
    return sendError(res, 429, 'SMS_TOO_MANY_ATTEMPTS', '인증 시도 횟수가 초과되었습니다. 다시 발송해 주세요.');
  }
  entry.attempts += 1;
  if (entry.codeHash !== hashSmsCode(phone, code)) {
    return sendError(res, 400, 'SMS_CODE_MISMATCH', '인증번호가 일치하지 않습니다.');
  }

  entry.verifiedAt = Date.now();
  smsVerificationStore.set(phone, entry);
  return res.status(200).json({
    success: true,
    message: '휴대번호 인증이 완료되었습니다.',
    data: { phone, verified: true }
  });
}));

app.post('/api/auth/find-id', asyncHandler(async (req, res) => {
  const phone = normalizePhoneNumber(req.body?.phone);
  if (!phone || phone.length < 10 || phone.length > 11) {
    return sendError(res, 400, 'INVALID_PHONE', '휴대번호를 올바르게 입력해 주세요.');
  }
  if (isAligoConfigured() && !isSmsVerified(phone)) {
    return sendError(res, 400, 'PHONE_NOT_VERIFIED', '휴대번호 인증을 완료해 주세요.');
  }

  const users = await repo.findUsersByPhone(phone);
  if (!users.length) {
    return sendError(res, 404, 'USER_NOT_FOUND', '해당 휴대번호로 가입된 아이디가 없습니다.');
  }

  return res.status(200).json({
    success: true,
    message: '가입된 아이디를 확인했습니다.',
    data: {
      phone,
      loginIds: users.map(user => user.loginId || user.email).filter(Boolean)
    }
  });
}));

app.post('/api/auth/reset-password', asyncHandler(async (req, res) => {
  const loginId = String(req.body?.loginId || req.body?.id || '').trim();
  const phone = normalizePhoneNumber(req.body?.phone);
  const password = String(req.body?.password || '').trim();

  if (!loginId || !phone || !password) {
    return sendError(res, 400, 'BAD_REQUEST', '아이디, 휴대번호, 새 비밀번호를 모두 입력해 주세요.');
  }
  if (isAligoConfigured() && !isSmsVerified(phone)) {
    return sendError(res, 400, 'PHONE_NOT_VERIFIED', '휴대번호 인증을 완료해 주세요.');
  }

  const user = await repo.findUserByLoginId(loginId);
  if (!user || normalizePhoneNumber(user.phone) !== phone) {
    return sendError(res, 404, 'USER_NOT_FOUND', '아이디와 휴대번호가 일치하는 계정을 찾을 수 없습니다.');
  }

  await repo.updateUserPasswordById(user.id, await hashPassword(password));
  console.info('[AUTH_RESET_PASSWORD_SUCCESS]', {
    userId: user.id,
    loginId: user.loginId || user.email,
    phone
  });
  smsVerificationStore.delete(phone);
  return res.status(200).json({
    success: true,
    message: '비밀번호가 재설정되었습니다.',
    data: { loginId: user.loginId || user.email }
  });
}));

app.post('/api/auth/register', upload.fields([
  { name: 'bizLicenseFile', maxCount: 1 }
]), asyncHandler(async (req, res) => {
  const loginId = String(req.body?.loginId || req.body?.email || '').trim();
  const contactEmail = String(req.body?.contactEmail || '').trim();
  const { password, phone, storeName, ceoName, address, tel, businessNumber } = req.body;
  const agencyJoinCode = String(req.body?.agencyJoinCode || req.body?.joinCode || '').trim();
  if (!loginId || !password || !storeName || !ceoName || !businessNumber) {
    return sendError(res, 400, 'BAD_REQUEST', '회원가입 필수 정보를 모두 입력해 주세요.');
  }
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(loginId)) {
    return sendError(res, 400, 'INVALID_LOGIN_ID', '로그인 ID 형식을 확인해 주세요.');
  }
  const isTestBizNo = isTestBusinessNumber(businessNumber);

  const existingUser = await repo.findUserByLoginId(loginId);
  if (existingUser) {
    return sendError(res, 409, 'ALREADY_EXISTS', '이미 사용 중인 아이디입니다.');
  }

  if (!isTestBizNo) {
    const existingBusiness = await repo.findUserByBusinessNumber(businessNumber);
    if (existingBusiness) {
      return sendError(res, 409, 'ALREADY_EXISTS', '이미 가입된 사업자등록번호입니다.');
    }
  }

  let agency = null;
  if (agencyJoinCode) {
    agency = await repo.findAgencyByJoinCode(agencyJoinCode);
    if (!agency) {
      return sendError(res, 404, 'AGENCY_JOIN_CODE_NOT_FOUND', '유효하지 않은 가입 링크입니다.');
    }
  }
  const defaultAgency = agency ? null : await repo.ensureDefaultAgency();
  if (isAligoConfigured() && !isSmsVerified(phone)) {
    return sendError(res, 400, 'PHONE_NOT_VERIFIED', '휴대번호 인증을 완료해 주세요.');
  }
  const bizLicenseFile = req.files?.bizLicenseFile?.[0] || null;
  const bizDocOriginalName = bizLicenseFile
    ? await nextBusinessDocOriginalName(storeName, bizLicenseFile.originalname, bizLicenseFile.mimetype)
    : '';
  const bizDoc = bizLicenseFile ? await persistUpload(bizLicenseFile, null, { originalName: bizDocOriginalName }) : null;
  const user = await repo.createUser({
    email: loginId,
    loginId,
    contactEmail,
    passwordHash: await hashPassword(password),
    name: ceoName,
    franchiseName: storeName,
    phone,
    address,
    tel,
    businessNumber: isTestBizNo ? createStoredTestBusinessNumber(loginId) : businessNumber,
    agencyId: agency?.id || defaultAgency?.id || null,
    bizDocFileKey: bizDoc?.fileKey || null,
    franchiseFeeRate: 0
  });

  return res.status(201).json({
    success: true,
    message: '가입이 완료되었습니다.',
    data: {
      id: user.id,
      email: isEmailLike(user.contactEmail) ? user.contactEmail : '',
      loginId: user.loginId,
      contactEmail: user.contactEmail || '',
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

app.get('/api/web-push/public-key', (req, res) => {
  const publicKey = String(process.env.WEB_PUSH_PUBLIC_KEY || process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.WEB_PUSH_PRIVATE_KEY || process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim();
  return res.status(200).json({
    success: true,
    data: {
      configured: Boolean(publicKey && privateKey),
      publicKey,
      detail: publicKey ? 'WEB_PUSH_VAPID_PUBLIC_KEY configured.' : 'WEB_PUSH_VAPID_PUBLIC_KEY is not configured.'
    }
  });
});

app.post('/api/web-push-subscription', authenticate, asyncHandler(async (req, res) => {
  const subscription = req.body?.subscription;
  if (!subscription?.endpoint) {
    return sendError(res, 400, 'BAD_REQUEST', 'web push subscription endpoint is required.');
  }
  const saved = await repo.upsertWebPushSubscription(req.user.id, subscription, req.body?.platform || 'web');
  return res.status(200).json({
    success: true,
    data: saved
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
    const normalizedNewPhone = normalizePhoneNumber(cleanPhone);
    const normalizedCurrentPhone = normalizePhoneNumber(user.phone);
    if (normalizedNewPhone && normalizedNewPhone !== normalizedCurrentPhone && isAligoConfigured() && !isSmsVerified(normalizedNewPhone)) {
      return sendError(res, 400, 'PHONE_NOT_VERIFIED', '휴대번호 인증을 완료해 주세요.');
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

app.post('/api/franchise/accounts', authenticate, (req, res) => {
  upload.single('documentFile')(req, res, async err => {
    try {
      if (err) {
        if (err.message === 'INVALID_FILE_FORMAT') {
          return sendError(res, 415, 'INVALID_FILE_FORMAT', 'PDF, JPG, JPEG, PNG, GIF, WEBP 파일만 업로드할 수 있습니다.');
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(res, 413, 'FILE_SIZE_LIMIT_EXCEEDED', '첨부 파일은 10MB 이하만 업로드할 수 있습니다.');
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

      const originalName = await nextAccountProofOriginalName(resolvedFranchiseName, req.file.originalname, req.file.mimetype);
      const uploadedFile = await persistUpload(req.file, req.user.id, { originalName });
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

function safeWorksheetValue(value) {
  if (value == null) return '';
  return String(value);
}

function safeWorksheetPercentValue(value) {
  if (value == null || value === '') return '0%';
  const num = Number(value);
  if (!Number.isFinite(num)) return safeWorksheetValue(value);
  return `${String(Number(num.toFixed(2))).replace(/\.0$/, '')}%`;
}

function copyRowStyle(sourceRow, targetRow) {
  sourceRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const targetCell = targetRow.getCell(colNumber);
    targetCell.style = JSON.parse(JSON.stringify(cell.style || {}));
    if (cell.numFmt) targetCell.numFmt = cell.numFmt;
    targetCell.alignment = cell.alignment ? { ...cell.alignment } : targetCell.alignment;
    targetCell.border = cell.border ? JSON.parse(JSON.stringify(cell.border)) : targetCell.border;
    targetCell.fill = cell.fill ? JSON.parse(JSON.stringify(cell.fill)) : targetCell.fill;
  });
  targetRow.height = sourceRow.height;
}

async function createAccountApprovalExportWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  let loadedTemplate = false;
  if (fs.existsSync(ACCOUNT_EXPORT_TEMPLATE_PATH)) {
    await workbook.xlsx.readFile(ACCOUNT_EXPORT_TEMPLATE_PATH);
    loadedTemplate = true;
  } else {
    const fallback = workbook.addWorksheet('등록 양식');
    fallback.getRow(4).values = ['No', '상호명', '사업자번호', '대표자명', '대표자 연락처', '가맹점 주소', '은행명', '계좌번호', '예금주명', '가맹점 수수료(vat포함)', '상위대리점', 'TXID'];
  }
  const worksheet = workbook.getWorksheet('등록 양식') || workbook.worksheets[0];
  const headerRow = worksheet.getRow(4);
  headerRow.getCell(11).value = '상위대리점';
  if (!String(headerRow.getCell(12).value || '').trim()) {
    headerRow.getCell(12).value = 'TXID';
  }
  const styleRow = worksheet.getRow(5);
  rows.forEach((item, index) => {
    const row = worksheet.getRow(5 + index);
    copyRowStyle(styleRow, row);
    row.getCell(1).value = index + 1;
    row.getCell(2).value = safeWorksheetValue(item.franchise_name);
    row.getCell(3).value = safeWorksheetValue(item.business_number);
    row.getCell(4).value = safeWorksheetValue(item.owner_name || item.account_holder);
    row.getCell(5).value = safeWorksheetValue(item.owner_phone);
    row.getCell(6).value = safeWorksheetValue(item.franchise_address);
    row.getCell(7).value = safeWorksheetValue(item.bank_name);
    row.getCell(8).value = safeWorksheetValue(item.account_no);
    row.getCell(9).value = safeWorksheetValue(item.account_holder);
    row.getCell(10).value = safeWorksheetPercentValue(item.fee_rate);
    row.getCell(11).value = safeWorksheetValue(item.sales_name);
    row.getCell(12).value = safeWorksheetValue(item.txid);
    row.commit();
  });
  if (!loadedTemplate) {
    worksheet.columns.forEach(column => {
      if (!column.width || column.width < 12) column.width = 14;
    });
  }
  return workbook.xlsx.writeBuffer();
}

function sanitizeWorksheetName(value, fallback = 'Sheet') {
  const cleaned = String(value || fallback).replace(/[\\/?*[\]:]/g, ' ').trim() || fallback;
  return cleaned.slice(0, 31);
}

function normalizeExportColumns(columns) {
  return (Array.isArray(columns) ? columns : [])
    .slice(0, 40)
    .map((column, index) => ({
      key: String(column?.key || `col${index + 1}`).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40) || `col${index + 1}`,
      header: String(column?.header || column?.key || `항목${index + 1}`).slice(0, 80),
      type: ['number', 'percent', 'date', 'text'].includes(String(column?.type || '')) ? String(column.type) : 'text',
      width: Math.min(Math.max(Number(column?.width || 14), 8), 36)
    }))
    .filter(column => column.header);
}

function normalizeExportCell(value, type) {
  if (type === 'number') {
    const num = Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(num) ? num : 0;
  }
  if (type === 'percent') {
    const num = Number(String(value ?? '').replace(/[% ,]/g, ''));
    return Number.isFinite(num) ? num / 100 : 0;
  }
  return value == null ? '' : String(value);
}

async function createGenericExportWorkbook(sheets = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'eatsPay';
  workbook.created = new Date();
  const normalizedSheets = (Array.isArray(sheets) ? sheets : []).slice(0, 5);
  normalizedSheets.forEach((sheet, sheetIndex) => {
    const columns = normalizeExportColumns(sheet?.columns);
    if (!columns.length) return;
    const rows = (Array.isArray(sheet?.rows) ? sheet.rows : []).slice(0, 10000);
    const ws = workbook.addWorksheet(sanitizeWorksheetName(sheet?.name, `Sheet${sheetIndex + 1}`), {
      views: [{ state: 'frozen', ySplit: 1 }]
    });
    ws.columns = columns.map(column => ({
      header: column.header,
      key: column.key,
      width: column.width
    }));
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FF12351F' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF8EF' } };
    header.alignment = { vertical: 'middle', horizontal: 'center' };
    header.height = 22;
    header.eachCell(cell => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFD1E8D1' } } };
    });
    rows.forEach(source => {
      const rowValue = {};
      columns.forEach(column => {
        rowValue[column.key] = normalizeExportCell(source?.[column.key], column.type);
      });
      const row = ws.addRow(rowValue);
      columns.forEach((column, index) => {
        const cell = row.getCell(index + 1);
        if (column.type === 'number') {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right' };
        } else if (column.type === 'percent') {
          cell.numFmt = '0.00%';
          cell.alignment = { horizontal: 'right' };
        } else {
          cell.alignment = { horizontal: 'left' };
        }
      });
    });
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length }
    };
  });
  if (!workbook.worksheets.length) {
    const ws = workbook.addWorksheet('내보내기');
    ws.getCell('A1').value = '내보낼 데이터가 없습니다.';
  }
  return workbook.xlsx.writeBuffer();
}

function normalizeExcelHeader(value) {
  return String(value || '').replace(/\s+/g, '').replace(/[()]/g, '').toLowerCase();
}

async function parseAccountApprovalTxidWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet('등록 양식') || workbook.worksheets[0];
  if (!worksheet) return [];
  const headerRow = worksheet.getRow(4);
  const headerMap = new Map();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headerMap.set(normalizeExcelHeader(cell.value), colNumber);
  });
  const col = (...names) => {
    for (const name of names) {
      const found = headerMap.get(normalizeExcelHeader(name));
      if (found) return found;
    }
    return 0;
  };
  const txidCol = col('TXID', 'txid', '거래ID');
  const accountCol = col('계좌번호');
  const businessCol = col('사업자번호');
  const franchiseCol = col('상호명');
  if (!txidCol || !accountCol) return [];
  const items = [];
  for (let rowNo = 5; rowNo <= worksheet.rowCount; rowNo += 1) {
    const row = worksheet.getRow(rowNo);
    const txid = String(row.getCell(txidCol).text || row.getCell(txidCol).value || '').trim();
    const accountNo = String(row.getCell(accountCol).text || row.getCell(accountCol).value || '').trim();
    if (!txid && !accountNo) continue;
    items.push({
      txid,
      accountNo,
      businessNumber: businessCol ? String(row.getCell(businessCol).text || row.getCell(businessCol).value || '').trim() : '',
      franchiseName: franchiseCol ? String(row.getCell(franchiseCol).text || row.getCell(franchiseCol).value || '').trim() : '',
      rowNo
    });
  }
  return items;
}

function parseAccountApprovalExportFilters(query = {}) {
  const exportStatus = ['pending', 'exported', 'all'].includes(String(query.exportStatus || ''))
    ? String(query.exportStatus)
    : 'pending';
  const cleanDate = value => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '');
  return {
    exportStatus,
    startDate: cleanDate(query.startDate),
    endDate: cleanDate(query.endDate),
    q: String(query.q || '').trim().slice(0, 80),
    agency: String(query.agency || '').trim().slice(0, 80)
  };
}

app.get('/api/admin/account-approvals/export-count', authenticateAdmin, asyncHandler(async (req, res) => {
  const filters = parseAccountApprovalExportFilters(req.query || {});
  const count = await repo.countAccountApprovalExportRows(filters);
  return res.status(200).json({ success: true, data: { count, filters } });
}));

app.get('/api/admin/account-approvals/export.xlsx', authenticateAdmin, asyncHandler(async (req, res) => {
  const filters = parseAccountApprovalExportFilters(req.query || {});
  const rows = await repo.listAccountApprovalExportRows(filters);
  if (!rows.length) {
    return sendError(res, 404, 'NO_EXPORT_ROWS', '내보낼 승인 계좌가 없습니다.');
  }
  const batchId = generateId('ACCEXP', 6);
  const buffer = await createAccountApprovalExportWorkbook(rows);
  await repo.markAccountApprovalsExported(rows, batchId);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="eatsPay_${batchId}.xlsx"`);
  res.setHeader('X-Export-Count', String(rows.length));
  res.setHeader('X-Export-Batch-Id', batchId);
  return res.status(200).send(Buffer.from(buffer));
}));

app.post('/api/admin/exports/settlement.xlsx', authenticateAdmin, asyncHandler(async (req, res) => {
  const sheets = Array.isArray(req.body?.sheets) ? req.body.sheets : [];
  if (!sheets.length) {
    return sendError(res, 400, 'EXPORT_SHEETS_REQUIRED', '내보낼 엑셀 데이터가 없습니다.');
  }
  const rawFileName = String(req.body?.fileName || 'eatsPay_settlement.xlsx').trim();
  const fileName = rawFileName.replace(/[\\/:*?"<>|]/g, '_').replace(/\.xlsx$/i, '') || 'eatsPay_settlement';
  const buffer = await createGenericExportWorkbook(sheets);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${fileName}.xlsx`)}`);
  return res.status(200).send(Buffer.from(buffer));
}));

app.post('/api/admin/account-approvals/txid-upload', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return sendError(res, 400, 'FILE_REQUIRED', 'TXID 엑셀 파일을 업로드해주세요.');
  }
  const items = await parseAccountApprovalTxidWorkbook(req.file.buffer);
  if (!items.length) {
    return sendError(res, 400, 'NO_TXID_ROWS', 'TXID를 반영할 행을 찾지 못했습니다.');
  }
  const batchIdMatch = String(req.file.originalname || '').match(/(?:eatsPay_|account-approvals-|계좌검증_내보내기_)?(ACCEXP-[A-Za-z0-9]+)/i);
  const results = await repo.applyAccountApprovalTxids(items, {
    batchId: batchIdMatch ? batchIdMatch[1] : ''
  });
  await notifyAccountApprovalTxidApplied(results);
  const updated = results.filter(item => item.status === 'UPDATED').length;
  return res.status(200).json({
    success: true,
    data: {
      total: results.length,
      updated,
      skipped: results.filter(item => item.status === 'SKIPPED').length,
      invalidTxid: results.filter(item => item.status === 'INVALID_TXID').length,
      notFound: results.filter(item => item.status === 'NOT_FOUND').length,
      ambiguous: results.filter(item => item.status === 'AMBIGUOUS').length,
      results
    }
  });
}));

app.get('/api/franchise/accounts', authenticate, asyncHandler(async (req, res) => {
  const [requests, deliveryAccounts] = await Promise.all([
    repo.listAccountRequestsByFranchise(req.user.franchiseId),
    repo.listDeliveryAccountsByFranchise(req.user.franchiseId)
  ]);

  const statusLabel = (status, txid = '') => {
    if (status === 'APPROVED') return txid ? '\uC2B9\uC778\uC644\uB8CC' : '\uC2B9\uC778\uB300\uAE30';
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
    fileName: request.documentOriginalName ? normalizeUploadOriginalName(request.documentOriginalName) : (request.documentUrl ? path.basename(request.documentUrl) : ''),
    status: request.status,
    statusLabel: statusLabel(request.status, request.txid),
    active: request.active !== false,
    hidden: request.hidden === true,
    requestedAt: request.submittedAt,
    txid: request.txid || '',
    exportedAt: request.exportedAt || '',
    exportReadyAt: request.exportReadyAt || '',
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
    fileName: deliveryAccountDisplayFileName(account),
    status: account.accountStatus,
    statusLabel: statusLabel(account.accountStatus, account.txid),
    active: account.active !== false,
    hidden: account.hidden === true,
    requestedAt: account.reqDate,
    txid: account.txid || '',
    exportedAt: account.exportedAt || '',
    rejectionReason: account.rejectionReason || ''
  }));

  const accountPriority = item => {
    if (item.status === 'APPROVED') return 3;
    if (item.status === 'PENDING') return 2;
    if (item.status === 'REJECTED') return 1;
    return 0;
  };
  const accountKey = item => [
    item.franchiseId,
    String(item.agencyName || '').trim().toLowerCase(),
    String(item.bankName || '').trim().toLowerCase(),
    String(item.accountNo || '').replace(/[^0-9A-Za-z]/g, '')
  ].join('|');
  const mergedAccounts = new Map();
  for (const item of [...requestItems, ...deliveryItems]) {
    const key = accountKey(item);
    const current = mergedAccounts.get(key);
    if (
      !current ||
      accountPriority(item) > accountPriority(current) ||
      (accountPriority(item) === accountPriority(current) && new Date(item.requestedAt || 0) > new Date(current.requestedAt || 0))
    ) {
      mergedAccounts.set(key, item);
    }
  }

  return res.status(200).json({
    success: true,
    data: [...mergedAccounts.values()].sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0))
  });
}));

app.patch('/api/franchise/accounts/:id/active', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const source = String(req.query.source || '').trim();
  if (typeof req.body.active !== 'boolean') {
    return sendError(res, 400, 'BAD_REQUEST', 'active must be boolean.');
  }

  const updated = (source === 'delivery_account' || (/^\d+$/.test(id) && source !== 'account_request'))
    ? await repo.updateDeliveryAccountVisibilityByFranchise(Number(id), req.user.franchiseId, { active: req.body.active })
    : await repo.updateAccountRequestVisibilityByFranchise(id, req.user.franchiseId, { active: req.body.active });

  if (!updated) {
    return sendError(res, 404, 'ACCOUNT_NOT_FOUND', 'Virtual account was not found.');
  }

  return res.status(200).json({
    success: true,
    message: req.body.active ? 'Virtual account activated.' : 'Virtual account deactivated.',
    data: updated
  });
}));

app.patch('/api/franchise/accounts/:id/hidden', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const source = String(req.query.source || '').trim();
  if (typeof req.body.hidden !== 'boolean') {
    return sendError(res, 400, 'BAD_REQUEST', 'hidden must be boolean.');
  }

  const updated = (source === 'delivery_account' || (/^\d+$/.test(id) && source !== 'account_request'))
    ? await repo.updateDeliveryAccountVisibilityByFranchise(Number(id), req.user.franchiseId, { hidden: req.body.hidden })
    : await repo.updateAccountRequestVisibilityByFranchise(id, req.user.franchiseId, { hidden: req.body.hidden });

  if (!updated) {
    return sendError(res, 404, 'ACCOUNT_NOT_FOUND', 'Virtual account was not found.');
  }

  return res.status(200).json({
    success: true,
    message: req.body.hidden ? 'Virtual account hidden.' : 'Virtual account shown.',
    data: updated
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

app.all('/api/ghpayments/notify', asyncHandler(async (req, res) => {
  const payload = req.method === 'GET'
    ? { ...req.query }
    : (req.body && typeof req.body === 'object' ? req.body : {});
  const source = {
    ...payload,
    ...(req.query && Object.keys(req.query).length ? { query: req.query } : {})
  };
  const pick = (...keys) => {
    for (const key of keys) {
      const value = source[key] ?? source.result?.[key] ?? source.pay?.[key] ?? source.billing?.[key] ?? source.rebill?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  };
  const transactionId = pick('transactionId', 'transaction_id', 'trackId', 'track_id', 'approvalNo', 'approval_no', 'orderId', 'moid');
  const pgTransactionId = pick('pgTransactionId', 'pg_transaction_id', 'trxId', 'tid', 'TID', 'txId');
  const resultCode = pick('resultCd', 'resultCode', 'result_code', 'code');
  const resultMessage = pick('advanceMsg', 'resultMsg', 'resultMessage', 'message', 'msg');
  const eventType = pick('eventType', 'event_type', 'status', 'payStatus', 'type') || req.method;

  const saved = await repo.recordPgNotification({
    provider: 'GH Payments',
    eventType,
    transactionId,
    pgTransactionId,
    resultCode,
    resultMessage,
    payload,
    query: req.query || {},
    headers: {
      'content-type': req.get('content-type') || '',
      'user-agent': req.get('user-agent') || '',
      'x-forwarded-for': req.get('x-forwarded-for') || req.ip || ''
    }
  });

  console.log(`[GH_PAYMENTS_NOTIFY] saved=${saved.id} tx=${transactionId || '-'} pgTx=${pgTransactionId || '-'} code=${resultCode || '-'}`);
  res.set('Cache-Control', 'no-store');
  return res.status(200).type('text/plain').send('OK');
}));

app.post('/api/payment/charge', authenticate, asyncHandler(async (req, res) => {
  const { amount, calculatedFee, totalAmount, cardId, installment = 0, accountId, accountSource } = req.body;
  if (!amount || !calculatedFee || !totalAmount || !cardId) {
    return sendError(res, 400, 'MISSING_FIELDS', 'amount, calculatedFee, totalAmount, and cardId are required.');
  }
  if (!accountId) {
    return sendError(res, 400, 'MISSING_DEPOSIT_ACCOUNT', '입금받을 가상계좌를 선택해주세요.');
  }

  const expectedTotalAmount = Math.round(Number(amount) / CHARGE_DEPOSIT_RATE);
  const expectedFee = expectedTotalAmount - Number(amount);
  if (Number(calculatedFee) !== expectedFee || Number(totalAmount) !== expectedTotalAmount) {
    return sendError(res, 400, 'FEE_MISMATCH', 'Fee calculation mismatch.');
  }

  if (Number(amount) > 10000000) {
    return sendError(res, 402, 'CARD_LIMIT_EXCEEDED', 'Card limit exceeded.');
  }

  const card = await repo.findCardByUserId(String(cardId), req.user.id);
  if (!card || card.active === false || card.hidden === true) {
    return sendError(res, 404, 'CARD_NOT_FOUND', '결제 가능한 등록 카드가 없습니다.');
  }

  const depositAccount = await repo.findChargeDepositAccount({
    franchiseId: req.user.franchiseId,
    accountId,
    source: accountSource
  });
  if (!depositAccount) {
    return sendError(res, 404, 'DEPOSIT_ACCOUNT_NOT_FOUND', '승인된 입금 계좌를 찾지 못했습니다.');
  }
  if (!depositAccount.txid) {
    return sendError(res, 409, 'DEPOSIT_ACCOUNT_TXID_REQUIRED', '해당 계좌는 TXID가 등록된 후 결제할 수 있습니다.');
  }

  const isProviderCard = !String(card.id).startsWith('card_ref_');
  const useProvider = hasGhPaymentsPayKey() && isProviderCard;
  if (!useProvider) {
    return sendError(res, 409, 'CARD_PROVIDER_NOT_READY', 'PG 결제가 가능한 카드가 아닙니다. 카드를 다시 등록해 주세요.');
  }

  if (useProvider) {
    const transactionId = generateId('TXN', 7);
    console.log(`[GH_PAYMENTS_BILLING_PAY_REQUEST] rebillId=${cardId} trackId=${transactionId} amount=${Number(totalAmount)} installment=${Number(installment) || 0}`);
    const providerResponse = await ghPaymentsRequest('/api/billing/pay', {
      method: 'POST',
      body: {
        billing: {
          rebillId: cardId,
          trackId: transactionId,
          amount: Number(totalAmount),
          installment: Number(installment) || 0,
          txid: depositAccount.txid
        }
      }
    });

    const payload = await providerResponse.json().catch(() => ({}));
    if (!providerResponse.ok || payload?.result?.resultCd !== '0000') {
      const providerMessage = payload?.result?.advanceMsg || payload?.result?.resultMsg || payload?.message || 'Payment failed at payment provider.';
      console.log(`[GH_PAYMENTS_BILLING_PAY_FAILED] rebillId=${cardId} trackId=${transactionId} code=${payload?.result?.resultCd || providerResponse.status} message=${providerMessage}`);
      return sendError(res, providerResponse.status || 502, 'GH_PAYMENTS_BILLING_PAY_FAILED', providerMessage, payload);
    }

    const providerCard = payload.pay?.card || {};
    console.log(`[GH_PAYMENTS_BILLING_PAY_SUCCESS] rebillId=${cardId} trackId=${transactionId} trxId=${payload.pay?.trxId || '-'} authCd=${payload.pay?.authCd || '-'} amount=${payload.pay?.amount || totalAmount}`);
    const cardIssuer = providerCard.issuer || card.cardCompany || card.cardName || providerCard.cardType || 'CARD';
    const cardLast4 = providerCard.last4 || String(card.maskedNumber || card.masked_number || '').replace(/[^0-9]/g, '').slice(-4) || String(cardId).slice(-4);
    const cardDetails = `${cardIssuer} ****-****-****-${cardLast4}`;
    const result = await repo.recordCharge({
      userId: req.user.id,
      franchiseId: req.user.franchiseId,
      transactionId,
      amount: Number(amount),
      fee: expectedFee,
      totalAmount: Number(totalAmount),
      method: 'CARD',
      cardDetails,
      pg: 'GH Payments',
      pgTxId: payload.pay?.trxId || '',
      authCode: payload.pay?.authCd || ''
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

  return sendError(res, 409, 'CARD_PROVIDER_NOT_READY', 'PG 결제가 가능한 카드가 아닙니다. 카드를 다시 등록해 주세요.');
}));

app.get('/api/payment/history', authenticate, asyncHandler(async (req, res) => {
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
  if (!alias) {
    return sendError(res, 400, 'MISSING_ALIAS', 'alias is required.');
  }
  if (digits && digits.length !== 15 && digits.length !== 16) {
    return sendError(res, 400, 'INVALID_CARD_NUMBER', 'cardNumber must contain 15 or 16 digits.');
  }

  const finalCardCompany = digits ? (cardCompany || inferCardName(digits)) : (cardCompany || null);
  const updated = await repo.updateCardByUserId(req.params.id, req.user.id, {
    maskedNumber: digits ? `****-****-****-${digits.slice(-4)}` : null,
    cardName: finalCardCompany,
    cardCompany: finalCardCompany,
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

app.patch('/api/card/:id/active', authenticate, asyncHandler(async (req, res) => {
  if (typeof req.body.active !== 'boolean') {
    return sendError(res, 400, 'BAD_REQUEST', 'active must be boolean.');
  }

  const updated = await repo.updateCardActiveByUserId(req.params.id, req.user.id, req.body.active);
  if (!updated) {
    return sendError(res, 404, 'CARD_NOT_FOUND', 'Card was not found.');
  }

  return res.status(200).json({
    success: true,
    message: req.body.active ? 'Card activated.' : 'Card deactivated.',
    data: updated
  });
}));

app.patch('/api/card/:id/hidden', authenticate, asyncHandler(async (req, res) => {
  if (typeof req.body.hidden !== 'boolean') {
    return sendError(res, 400, 'BAD_REQUEST', 'hidden must be boolean.');
  }

  const updated = await repo.updateCardHiddenByUserId(req.params.id, req.user.id, req.body.hidden);
  if (!updated) {
    return sendError(res, 404, 'CARD_NOT_FOUND', 'Card was not found.');
  }

  return res.status(200).json({
    success: true,
    message: req.body.hidden ? 'Card hidden.' : 'Card shown.',
    data: updated
  });
}));

app.patch('/api/admin/cards/:id/hidden', authenticateAdmin, asyncHandler(async (req, res) => {
  const hidden = typeof req.body.hidden === 'boolean' ? req.body.hidden : true;
  const result = await pool.query(
    `UPDATE cards
     SET hidden = $2,
         active = CASE WHEN $2 THEN false ELSE true END
     WHERE id = $1
     RETURNING id, user_id, masked_number, card_name, card_company, alias, active, hidden, expiry_month, expiry_year, created_at`,
    [req.params.id, hidden]
  );

  if (!result.rows[0]) {
    return sendError(res, 404, 'CARD_NOT_FOUND', 'Card was not found.');
  }

  return res.status(200).json({
    success: true,
    message: hidden ? 'Card hidden.' : 'Card shown.',
    data: result.rows[0]
  });
}));

app.patch('/api/admin/cards/:id/alias', authenticateAdmin, asyncHandler(async (req, res) => {
  const alias = String(req.body.alias || '').trim();
  if (!alias) {
    return sendError(res, 400, 'MISSING_ALIAS', 'alias is required.');
  }

  const result = await pool.query(
    `UPDATE cards
     SET alias = $2
     WHERE id = $1
     RETURNING id, user_id, masked_number, card_name, card_company, alias, active, hidden, expiry_month, expiry_year, created_at`,
    [req.params.id, alias]
  );

  if (!result.rows[0]) {
    return sendError(res, 404, 'CARD_NOT_FOUND', 'Card was not found.');
  }

  return res.status(200).json({
    success: true,
    message: 'Card alias updated.',
    data: result.rows[0]
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
  const { cardNumber, cardPw, cardCvc, cardCvv, cvc, cvv, expiryMonth, expiryYear, identity, alias, cardCompany, payerName, payerEmail, payerTel } = req.body;
  if (!cardNumber || !cardPw || !expiryMonth || !expiryYear || !identity) {
    return sendError(res, 400, 'BAD_REQUEST', 'Card details are required.');
  }

  const digits = String(cardNumber).replace(/[^0-9]/g, '');
  if (digits.length !== 15 && digits.length !== 16) {
    return sendError(res, 400, 'INVALID_CARD_NUMBER', 'Card number must contain 15 or 16 digits.');
  }
  if (!isLikelyCardNumber(digits)) {
    return sendError(res, 400, 'INVALID_CARD_NUMBER', 'Card number checksum is invalid.');
  }
  const resolvedCardCvc = String(cardCvc || cardCvv || cvc || cvv || '').replace(/[^0-9]/g, '');
  if (!/^\d{3,4}$/.test(resolvedCardCvc)) {
    return sendError(res, 400, 'MISSING_CARD_CVC', 'Card CVC is required.');
  }

  const count = await repo.countCardsByUserId(req.user.id);
  const resolvedAlias = alias || (count === 0 ? 'Primary card' : `Card ${count + 1}`);
  const normalizedCardCompany = sanitizeCardCompany(cardCompany, digits);
  const resolvedCompany = String(normalizedCardCompany || '카드').trim();
  const resolvedPayerName = String(payerName || req.user.name || '').trim();
  const resolvedPayerEmail = String(payerEmail || req.user.contactEmail || req.user.email || '').trim();
  const resolvedPayerTel = String(payerTel || req.user.phone || req.user.tel || '').trim();
  const resolvedCardIdentity = String(identity || '').replace(/[^0-9]/g, '');
  if (!resolvedPayerName) {
    return sendError(res, 400, 'MISSING_FIELDS', 'payerName is required.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedPayerEmail)) {
    return sendError(res, 400, 'BAD_REQUEST', 'payerEmail is invalid.');
  }
  if (resolvedPayerTel.replace(/[^0-9]/g, '').length < 10) {
    return sendError(res, 400, 'BAD_REQUEST', 'payerTel is invalid.');
  }

  if (hasGhPaymentsPayKey()) {
    const registrationTrackId = generateId('CARD', 6);
    const response = await ghPaymentsRequest('/api/billing/reg', {
      method: 'POST',
      body: {
        rebill: {
          trackId: registrationTrackId,
          cardNumber: digits,
          cardExpireDate: formatCardExpireDate(expiryMonth, expiryYear),
          cardPassword: String(cardPw).replace(/[^0-9]/g, '').slice(0, 2),
          cardCvv: resolvedCardCvc,
          socialNumber: String(identity).replace(/[^0-9]/g, ''),
          productName: 'eats PAY 카드 등록',
          payerName: resolvedPayerName,
          payerEmail: resolvedPayerEmail,
          payerTel: resolvedPayerTel
        }
      }
    });

    const payload = await response.json().catch(() => ({}));
    const resultCd = String(payload?.result?.resultCd || '').trim();
    const providerMessage = payload?.result?.advanceMsg || payload?.result?.resultMsg || payload?.message || '';
    const rebill = payload.rebill || {};
    const hasProviderRebill = Boolean(rebill.rebillId && (rebill.trxId || rebill.cardId || rebill.cardNumber));
    if (!response.ok || (resultCd !== '0000' && (!hasProviderRebill || providerMessage))) {
      return sendError(res, response.status || 502, 'GH_PAYMENTS_CARD_REGISTRATION_FAILED', providerMessage || 'Card registration failed at payment provider.', payload);
    }

    const providerCardId = rebill.rebillId || `card_ref_${crypto.randomUUID()}`;
    const cardName = normalizeProviderCardCompany(rebill.issueCompanyName || rebill.buyCompanyName, resolvedCompany, digits);
    const maskedNumber = rebill.cardNumber || `${cardName} (****-****-${digits.slice(-4)})`;
    console.log(`[GH_PAYMENTS_CARD_REGISTRATION_SUCCESS] trackId=${registrationTrackId} rebillId=${providerCardId} trxId=${rebill.trxId || '-'} status=${rebill.status || '-'} tmnId=${rebill.tmnId || '-'} mchtId=${rebill.mchtId || '-'} issuer=${cardName} last4=${digits.slice(-4)} raw=${JSON.stringify({
      result: payload.result || null,
      rebill: {
        rebillId: rebill.rebillId || '',
        trxId: rebill.trxId || '',
        cardType: rebill.cardType || '',
        cardNumber: rebill.cardNumber || '',
        issueCompanyName: rebill.issueCompanyName || '',
        buyCompanyName: rebill.buyCompanyName || '',
        status: rebill.status || '',
        mchtId: rebill.mchtId || '',
        tmnId: rebill.tmnId || ''
      }
    })}`);
    const card = await repo.registerCard(req.user.id, {
      id: providerCardId,
      maskedNumber,
      cardName,
      cardCompany: cardName,
      alias: resolvedAlias,
      expiryMonth: String(expiryMonth || '').padStart(2, '0'),
      expiryYear: String(expiryYear || ''),
      payerName: resolvedPayerName,
      payerEmail: resolvedPayerEmail,
      payerTel: resolvedPayerTel,
      cardIdentity: resolvedCardIdentity
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
    cardCompany: cardName,
    alias: resolvedAlias,
    expiryMonth: String(expiryMonth || '').padStart(2, '0'),
    expiryYear: String(expiryYear || ''),
    payerName: resolvedPayerName,
    payerEmail: resolvedPayerEmail,
    payerTel: resolvedPayerTel,
    cardIdentity: resolvedCardIdentity
  });

  return res.status(200).json({
    success: true,
    message: 'Card registered.',
    data: card
  });
}));

app.post('/api/admin/accounts/approve', authenticateAdmin, asyncHandler(async (req, res) => {
  const { requestId, accountId, source, action, assignedVirtualAccount, rejectionReason } = req.body;
  const isDeliveryAccount = !requestId && (source === 'delivery_account' || accountId);
  if (isDeliveryAccount) {
    const numericAccountId = Number(accountId);
    if (!Number.isFinite(numericAccountId)) {
      return sendError(res, 400, 'INVALID_ACCOUNT_ID', 'delivery account id is required.');
    }
    const account = await repo.findDeliveryAccountById(numericAccountId);
    if (!account) {
      return sendError(res, 404, 'ACCOUNT_NOT_FOUND', 'Account was not found.');
    }
    if (account.accountStatus !== 'PENDING') {
      const sameAction = (account.accountStatus === 'APPROVED' && action === 'APPROVED')
        || (account.accountStatus === 'REJECTED' && action === 'REJECTED');
      if (sameAction) {
        return res.status(200).json({
          success: true,
          message: account.accountStatus === 'APPROVED'
            ? '이미 검증 처리된 계좌입니다. TXID 업로드 후 승인완료로 표시됩니다.'
            : '이미 반려 처리된 계좌입니다.',
          data: {
            accountId: account.id,
            status: account.accountStatus,
            alreadyProcessed: true,
            txid: account.txid || ''
          }
        });
      }
      return sendError(res, 409, 'ALREADY_PROCESSED', '이미 처리된 계좌입니다. 화면을 새로고침한 뒤 상태를 확인해주세요.');
    }
    let updatedAccount;
    if (action === 'APPROVED') {
      updatedAccount = await repo.updateDeliveryAccountApprovalStatus(numericAccountId, { status: 'APPROVED' });
    } else if (action === 'REJECTED') {
      if (!rejectionReason) {
        return sendError(res, 400, 'MISSING_REJECTION_REASON', 'rejectionReason is required.');
      }
      updatedAccount = await repo.updateDeliveryAccountApprovalStatus(numericAccountId, { status: 'REJECTED', rejectionReason });
    } else {
      return sendError(res, 400, 'INVALID_ACTION', 'action must be APPROVED or REJECTED.');
    }
    return res.status(200).json({
      success: true,
      message: 'Account processed.',
      data: {
        accountId: updatedAccount.id,
        status: updatedAccount.accountStatus,
        approvedBy: req.user.name,
        processedAt: new Date().toISOString()
      }
    });
  }

  const request = await repo.findAccountRequest(requestId);
  if (!request) {
    return sendError(res, 404, 'REQUEST_NOT_FOUND', 'Account request was not found.');
  }
  if (request.status !== 'PENDING') {
    const sameAction = request.status === action;
    if (sameAction) {
      return res.status(200).json({
        success: true,
        message: request.status === 'APPROVED'
          ? '이미 승인 처리된 계좌입니다. TXID 업로드 후 승인완료로 표시됩니다.'
          : '이미 반려 처리된 계좌입니다.',
        data: {
          requestId: request.requestId,
          status: request.status,
          alreadyProcessed: true,
          txid: request.txid || ''
        }
      });
    }
    return sendError(res, 409, 'ALREADY_PROCESSED', '이미 처리된 계좌 요청입니다. 화면을 새로고침한 뒤 상태를 확인해주세요.');
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

app.post('/api/admin/uploads/account-proof', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return sendError(res, 400, 'MISSING_FILE', 'file is required.');
  }
  const isAllowed = /^image\//i.test(req.file.mimetype || '')
    || req.file.mimetype === 'application/pdf'
    || /\.(png|jpe?g|gif|webp|pdf)$/i.test(req.file.originalname || '');
  if (!isAllowed) {
    return sendError(res, 400, 'INVALID_FILE_TYPE', '계좌 증빙은 이미지 또는 PDF 파일만 등록할 수 있습니다.');
  }
  const originalName = requestedAccountProofOriginalName(req.body?.franchiseName, req.body?.displayName, req.file.originalname, req.file.mimetype)
    || await nextAccountProofOriginalName(req.body?.franchiseName, req.file.originalname, req.file.mimetype);
  const file = await persistUpload(req.file, req.user.id, { originalName });
  return res.status(201).json({
    success: true,
    data: {
      fileKey: file.fileKey,
      fileName: file.originalName,
      url: `/uploads/${encodeURIComponent(file.fileKey)}`
    }
  });
}));

app.post('/api/franchise/:id/biz-doc', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  const franchiseId = Number(req.params.id);
  if (!req.file) {
    return sendError(res, 400, 'MISSING_FILE', 'file is required.');
  }
  const isAllowed = /^image\//i.test(req.file.mimetype || '')
    || req.file.mimetype === 'application/pdf'
    || /\.(png|jpe?g|gif|webp|pdf)$/i.test(req.file.originalname || '');
  if (!isAllowed) {
    return sendError(res, 415, 'INVALID_FILE_FORMAT', '사업자등록증은 PDF 또는 이미지 파일만 업로드할 수 있습니다.');
  }

  const currentUser = await repo.findUserByFranchiseId(franchiseId);
  const originalName = normalizedBusinessDocDisplayName(req.body?.franchiseName || currentUser?.franchiseName, req.file.originalname);
  const file = await persistUpload(req.file, req.user.id, { originalName });
  const user = await repo.updateFranchiseBizDoc(franchiseId, file.fileKey);
  if (!user) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', 'Franchise was not found.');
  }

  return res.status(200).json({
    success: true,
    data: {
      franchiseId,
      bizDocFile: file.fileKey,
      fileName: file.originalName,
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
  const agencies = await repo.listAgencies();
  const currentAgency = agencies.find(item => Number(item.id) === agencyId);
  if (!currentAgency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }
  req.file.originalname = agencyContractOriginalName(currentAgency.name);

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

app.get('/api/agency/me/settlements', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role !== 'AGENCY' || !req.user.agencyId) {
    return sendError(res, 403, 'ACCESS_DENIED', 'Agency account is required.');
  }

  const { startDate, endDate, page = 1, limit = 10 } = req.query;
  const pNum = Math.max(parseInt(page, 10) || 1, 1);
  const lNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const agencies = await repo.listAgencies();
  const agency = agencies.find(item => Number(item.id) === Number(req.user.agencyId));
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }

  const [pageResult, allResult] = await Promise.all([
    repo.listPgSettlements({
      startDate,
      endDate,
      agencyId: Number(req.user.agencyId),
      limit: lNum,
      offset: (pNum - 1) * lNum
    }),
    repo.listPgSettlements({
      startDate,
      endDate,
      agencyId: Number(req.user.agencyId),
      limit: 5000,
      offset: 0
    })
  ]);

  const feeRate = Number(agency.feeRate || 0);
  const mapSettlement = item => {
    const paymentAmount = Number(item.paymentAmt || 0);
    const serviceFee = Number(item.svcFee || 0);
    const netAmount = Number(item.netAmt || 0);
    const agencyFee = Math.floor(netAmount * feeRate / 100);
    return {
      id: item.id,
      date: formatKstDateTime(item.settledAt),
      approvalNo: item.approvalNo,
      franchiseId: item.franchiseId,
      franchiseName: item.franchiseName,
      paymentAmount,
      serviceFee,
      netAmount,
      agencyFee,
      agencyNet: netAmount - agencyFee,
      pg: item.pg,
      status: item.status === 'ROLLED_BACK' ? '취소' : '정상승인'
    };
  };
  const items = pageResult.items.map(mapSettlement);
  const allItems = allResult.items.map(mapSettlement);
  const summary = allItems.reduce((acc, item) => {
    acc.count += 1;
    acc.paymentAmount += item.paymentAmount;
    acc.serviceFee += item.serviceFee;
    acc.agencyFee += item.agencyFee;
    acc.agencyNet += item.agencyNet;
    return acc;
  }, { count: 0, paymentAmount: 0, serviceFee: 0, agencyFee: 0, agencyNet: 0 });

  return res.status(200).json({
    success: true,
    data: {
      agency,
      summary,
      items,
      pagination: {
        currentPage: pNum,
        totalPages: Math.ceil(pageResult.totalItems / lNum) || 1,
        totalItems: pageResult.totalItems,
        limit: lNum
      }
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
  const [users, transactions] = await Promise.all([
    repo.listFranchiseUsers(),
    repo.listTransactions({
      startDate: '2000-01-01',
      endDate: '2100-12-31',
      role: 'ADMIN',
      limit: 1000,
      offset: 0
    })
  ]);
  const userIds = users.map(user => user.id).filter(Boolean);
  const cardResult = userIds.length
    ? await pool.query(
      `SELECT id, user_id, masked_number, card_name, card_company, alias, active, hidden, created_at
       FROM cards
       WHERE user_id = ANY($1::bigint[])
       ORDER BY created_at DESC`,
      [userIds]
    )
    : { rows: [] };
  const cardsByUserId = new Map();
  for (const row of cardResult.rows) {
    const key = String(row.user_id);
    if (!cardsByUserId.has(key)) {
      cardsByUserId.set(key, []);
    }
    cardsByUserId.get(key).push(row);
  }
  const transactionItems = Array.isArray(transactions?.items) ? transactions.items : [];
  const paymentRows = transactionItems.map(tx => ({
    id: tx.transactionId,
    date: formatKstDateTime(tx.createdAt),
    approvalNo: tx.transactionId,
    franchise: '',
    franchiseId: tx.franchiseId,
    cardCompany: tx.cardDetails ? String(tx.cardDetails).split('(')[0].trim() : '',
    maskedNumber: tx.cardDetails || '',
    cardLast4: tx.cardDetails ? String(tx.cardDetails).replace(/[^0-9]/g, '').slice(-4) : ''
  }));
  return res.status(200).json({
    success: true,
    data: users.map((user, index) => {
      const cardList = cardsByUserId.get(String(user.id)) || [];
      const card = cardList[0];
      return enrichAdminFranchiseDisplay({
      id: user.franchiseId,
      name: user.franchiseName || 'Unregistered store',
      agencyId: user.agencyId || null,
      agency: displayAgencyName(user.agencyName),
      owner: user.name,
      phone: user.phone || '',
      address: user.address || '',
      tel: user.tel || '',
      bizNo: user.businessNumber || '',
      feeRate: user.franchiseFeeRate,
      customerId: user.customerId || '',
      bizDocFile: user.bizDocFileKey || '',
      bizDocFileName: user.bizDocFileKey
        ? normalizedBusinessDocDisplayName(user.franchiseName, user.bizDocFileName || user.bizDocFileKey)
        : '',
      joinDate: formatDate(user.createdAt),
      lastPaymentDate: '',
      status: user.role === 'OWNER' ? '정상 승인' : user.role === 'OWNER_REJECTED' ? '승인 거절' : '승인 대기',
      email: isEmailLike(user.contactEmail) ? user.contactEmail : '',
      loginId: user.loginId,
      contactEmail: user.contactEmail || '',
      role: user.role,
      cardRegistered: Boolean(card),
      cardCompany: card?.card_company || card?.card_name || '',
      cardLast4: card?.masked_number ? String(card.masked_number).replace(/[^0-9]/g, '').slice(-4) : '',
      cardRegisteredDate: card?.created_at ? formatDate(card.created_at) : '',
      cardCount: cardList.length,
      cardList: cardList.map(item => ({
        id: item.id,
        cardCompany: item.card_company || item.card_name || '',
        cardName: item.card_name || '',
        alias: item.alias || '',
        active: item.active !== false,
        hidden: item.hidden === true,
        maskedNumber: item.masked_number || '',
        cardLast4: item.masked_number ? String(item.masked_number).replace(/[^0-9]/g, '').slice(-4) : '',
        createdAt: item.created_at,
        registeredDate: item.created_at ? formatDate(item.created_at) : ''
      })),
      deliveryAgencies: []
    }, index, paymentRows);
    })
  });
}));

app.post('/api/admin/franchises', authenticateAdmin, asyncHandler(async (req, res) => {
  const loginId = String(req.body?.loginId || req.body?.email || '').trim();
  const rawContactEmail = String(req.body?.contactEmail || req.body?.email || '').trim();
  const contactEmail = isEmailLike(rawContactEmail) ? rawContactEmail : '';
  const password = String(req.body?.password || '');
  const franchiseName = String(req.body?.name || req.body?.franchiseName || '').trim();
  const ownerName = String(req.body?.owner || req.body?.ownerName || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const address = String(req.body?.address || '').trim();
  const tel = String(req.body?.tel || '').trim();
  const businessNumber = String(req.body?.bizNo || req.body?.businessNumber || '').replace(/[^0-9]/g, '');
  const agencyId = req.body?.agencyId ? Number(req.body.agencyId) : null;
  const franchiseFeeRate = req.body?.feeRate === '' || req.body?.feeRate == null ? 0 : Number(req.body.feeRate);
  const deliveryAccounts = Array.isArray(req.body?.deliveryAccounts) ? req.body.deliveryAccounts : [];

  if (!loginId || !password || !franchiseName || !ownerName || !businessNumber) {
    return sendError(res, 400, 'MISSING_FIELDS', 'loginId, password, franchiseName, ownerName, and businessNumber are required.');
  }
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(loginId)) {
    return sendError(res, 400, 'INVALID_LOGIN_ID', '로그인 ID 형식을 확인해 주세요.');
  }
  if (password.length < 4) {
    return sendError(res, 400, 'INVALID_PASSWORD', 'Password must be at least 4 characters.');
  }
  if (businessNumber.length !== 10) {
    return sendError(res, 400, 'INVALID_BUSINESS_NUMBER', 'businessNumber must contain 10 digits.');
  }
  if (franchiseFeeRate !== null && (!Number.isFinite(franchiseFeeRate) || franchiseFeeRate < 0 || franchiseFeeRate >= 100)) {
    return sendError(res, 400, 'INVALID_FEE_RATE', '수수료율은 0 이상 100 미만으로 입력해 주세요.');
  }
  if (await repo.findUserByLoginId(loginId)) {
    return sendError(res, 409, 'EMAIL_EXISTS', '이미 사용 중인 아이디입니다.');
  }
  if (await repo.findUserByBusinessNumber(businessNumber)) {
    return sendError(res, 409, 'BUSINESS_EXISTS', '이미 가입된 사업자등록번호입니다.');
  }

  const defaultAgency = agencyId ? null : await repo.ensureDefaultAgency();
  const user = await repo.createUser({
    email: loginId,
    loginId,
    contactEmail,
    passwordHash: await hashPassword(password),
    name: ownerName,
    franchiseName,
    phone,
    address,
    tel,
    businessNumber,
    agencyId: Number.isFinite(agencyId) ? agencyId : (defaultAgency?.id || null),
    franchiseFeeRate
  });

  const savedDeliveryAccounts = [];
  for (const account of deliveryAccounts) {
    const agencyName = String(account.agencyName || account.deliveryAgencyName || '').trim();
    const accountNo = String(account.accountNo || '').trim();
    if (!agencyName || !accountNo) continue;
    const savedAccount = await repo.addDeliveryAccount({
      franchiseId: user.franchiseId,
      agencyId: null,
      agencyName,
      bankName: String(account.bankName || '').trim(),
      accountHolder: agencyName,
      accountNo,
      fileKey: normalizeStoredFileKey(account.fileKey)
    });
    savedDeliveryAccounts.push(savedAccount);
  }

  return res.status(201).json({
    success: true,
    message: '가맹점이 생성되었습니다.',
    data: {
      id: user.franchiseId,
      email: isEmailLike(user.contactEmail) ? user.contactEmail : '',
      loginId: user.loginId,
      contactEmail: user.contactEmail || '',
      name: user.franchiseName,
      owner: user.name,
      phone: user.phone,
      bizNo: user.businessNumber,
      bizDocFile: user.bizDocFileKey || '',
      bizDocFileName: user.bizDocFileKey
        ? normalizedBusinessDocDisplayName(user.franchiseName, user.bizDocFileName || user.bizDocFileKey)
        : '',
      feeRate: user.franchiseFeeRate,
      role: user.role,
      deliveryAgencies: savedDeliveryAccounts.map(account => ({
        id: account.id,
        source: 'delivery_account',
        agency: account.agencyName,
        agencyName: account.agencyName,
        bankName: account.bankName,
        accountHolder: account.accountHolder,
        accountNo: account.accountNo,
        fileKey: account.fileKey || '',
        fileName: deliveryAccountDisplayFileName(account),
        documentUrl: account.fileKey ? `/uploads/${encodeURIComponent(account.fileKey)}` : '',
        status: account.accountStatus || account.status,
        accountStatus: deliveryAccountStatusLabel(account.accountStatus, account.txid),
        approvalStatus: account.accountStatus,
        txid: account.txid || '',
        exportReadyAt: account.exportReadyAt || '',
        exportedAt: account.exportedAt || '',
        active: account.active !== false,
        hidden: account.hidden === true
      }))
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
  const removedDuplicateAccounts = typeof repo.dedupeDeliveryAccountsForFranchise === 'function'
    ? await repo.dedupeDeliveryAccountsForFranchise(franchiseId)
    : [];

  return res.status(200).json({
    success: true,
    data: {
      franchiseId: user.franchiseId,
      agencyId,
      agencyName: displayAgencyName(agency.name),
      removedDuplicateAccountCount: removedDuplicateAccounts.length
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

  const loginId = String(req.body?.loginId || req.body?.email || '').trim();
  const rawContactEmail = String(req.body?.contactEmail || req.body?.email || '').trim();
  const contactEmail = isEmailLike(rawContactEmail) ? rawContactEmail : '';
  const password = String(req.body?.password || '');
  const franchiseName = String(req.body?.name || req.body?.franchiseName || '').trim();
  const ownerName = String(req.body?.owner || req.body?.ownerName || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const address = String(req.body?.address || '').trim();
  const businessNumber = String(req.body?.bizNo || req.body?.businessNumber || '').replace(/[^0-9]/g, '');
  const tel = String(req.body?.tel || '').trim();
  const agencyId = req.body?.agencyId ? Number(req.body.agencyId) : null;
  const franchiseFeeRate = req.body?.feeRate === '' || req.body?.feeRate == null ? 0 : Number(req.body.feeRate);
  const deliveryAccounts = Array.isArray(req.body?.deliveryAccounts) ? req.body.deliveryAccounts : [];

  if (!franchiseName) {
    return sendError(res, 400, 'MISSING_FRANCHISE_NAME', 'franchiseName is required.');
  }
  if (!ownerName) {
    return sendError(res, 400, 'MISSING_OWNER_NAME', 'ownerName is required.');
  }
  if (!loginId) {
    return sendError(res, 400, 'MISSING_LOGIN_ID', 'loginId is required.');
  }
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(loginId)) {
    return sendError(res, 400, 'INVALID_LOGIN_ID', '로그인 ID 형식을 확인해 주세요.');
  }
  if (password && password.length < 4) {
    return sendError(res, 400, 'INVALID_PASSWORD', 'Password must be at least 4 characters.');
  }
  if (businessNumber && businessNumber.length !== 10) {
    return sendError(res, 400, 'INVALID_BUSINESS_NUMBER', 'businessNumber must contain 10 digits.');
  }
  if (agencyId && !Number.isFinite(agencyId)) {
    return sendError(res, 400, 'INVALID_AGENCY_ID', 'agencyId is invalid.');
  }
  if (franchiseFeeRate !== null && (!Number.isFinite(franchiseFeeRate) || franchiseFeeRate < 0 || franchiseFeeRate >= 100)) {
    return sendError(res, 400, 'INVALID_FEE_RATE', '수수료율은 0 이상 100 미만으로 입력해 주세요.');
  }
  const existingLogin = await repo.findUserByLoginId(loginId);
  if (existingLogin && Number(existingLogin.franchiseId) !== franchiseId) {
    return sendError(res, 409, 'LOGIN_ID_EXISTS', '이미 사용 중인 아이디입니다.');
  }
  if (businessNumber) {
    const existingBusiness = await repo.findUserByBusinessNumber(businessNumber);
    if (existingBusiness && Number(existingBusiness.franchiseId) !== franchiseId) {
      return sendError(res, 409, 'BUSINESS_EXISTS', '이미 가입된 사업자등록번호입니다.');
    }
  }
  let agency = null;
  if (agencyId) {
    const agencies = await repo.listAgencies();
    agency = agencies.find(item => Number(item.id) === agencyId);
    if (!agency) {
      return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
    }
  }

  const updated = await repo.updateFranchiseDetails(franchiseId, {
    franchiseName,
    ownerName,
    phone,
    address,
    businessNumber,
    tel,
    loginId,
    contactEmail,
    agencyId: agencyId || null,
    franchiseFeeRate
  });
  if (!updated) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', '가맹점을 찾을 수 없습니다.');
  }
  if (password) {
    await repo.updateUserPasswordByFranchiseId(franchiseId, await hashPassword(password));
  }
  let normalizedBizDocFileName = updated.bizDocFileName || '';
  if (updated.bizDocFileKey) {
    const bizDocFile = await repo.findFileByKey(updated.bizDocFileKey);
    normalizedBizDocFileName = normalizedBusinessDocDisplayName(franchiseName, bizDocFile?.originalName || updated.bizDocFileKey);
    if (bizDocFile?.originalName !== normalizedBizDocFileName) {
      await repo.updateStoredFileOriginalName(updated.bizDocFileKey, normalizedBizDocFileName);
    }
  }
  const normalizedDeliveryAccounts = deliveryAccounts
    .map(account => ({
      id: account.id || account.accountId || null,
      agencyName: String(account.agencyName || account.deliveryAgencyName || '').trim(),
      bankName: String(account.bankName || '').trim(),
      accountHolder: String(account.agencyName || account.deliveryAgencyName || '').trim(),
      accountNo: String(account.accountNo || '').trim(),
      fileKey: normalizeStoredFileKey(account.fileKey),
      displayName: normalizedAccountProofDisplayName(franchiseName, account.displayName),
      accountStatus: normalizeDeliveryAccountStatusForDb(account.accountStatus || account.status),
      txid: String(account.txid || '').trim(),
      hidden: account.hidden === true,
      active: account.active !== false
    }))
    .filter(account => account.agencyName && account.accountNo);
  for (const account of normalizedDeliveryAccounts) {
    if (account.fileKey && account.displayName) {
      await repo.updateStoredFileOriginalName(account.fileKey, account.displayName);
    }
  }
  const savedDeliveryAccounts = await repo.replaceDeliveryAccountsForFranchise(
    franchiseId,
    normalizedDeliveryAccounts
  );

  return res.status(200).json({
    success: true,
    message: '가맹점 정보가 수정되었습니다.',
    data: {
      id: updated.franchiseId,
      loginId: updated.loginId,
      email: isEmailLike(updated.contactEmail) ? updated.contactEmail : '',
      contactEmail: updated.contactEmail || '',
      name: updated.franchiseName,
      owner: updated.name,
      phone: updated.phone,
      address: updated.address,
      bizNo: updated.businessNumber,
      tel: updated.tel,
      bizDocFile: updated.bizDocFileKey || '',
      bizDocFileName: normalizedBizDocFileName,
      feeRate: updated.franchiseFeeRate,
      agencyId: updated.agencyId || null,
      agency: agency ? displayAgencyName(agency.name) : '',
      deliveryAgencies: savedDeliveryAccounts.map(account => ({
        id: account.id,
        source: 'delivery_account',
        agency: account.agencyName,
        agencyName: account.agencyName,
        bankName: account.bankName,
        accountHolder: account.accountHolder,
        accountNo: account.accountNo,
        fileKey: account.fileKey || '',
        fileName: deliveryAccountDisplayFileName(account),
        documentUrl: account.fileKey ? `/uploads/${encodeURIComponent(account.fileKey)}` : '',
        status: account.accountStatus || account.status,
        accountStatus: deliveryAccountStatusLabel(account.accountStatus, account.txid),
        approvalStatus: account.accountStatus,
        txid: account.txid || '',
        exportReadyAt: account.exportReadyAt || '',
        exportedAt: account.exportedAt || '',
        active: account.active !== false,
        hidden: account.hidden === true
      }))
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

app.get('/api/admin/bootstrap', authenticateAdminOrAgency, asyncHandler(async (req, res) => {
  const [users, agencies, deliveryAgencies, deliveryAccounts, accountRequests, transactions, settlements, installments, pgProviders, inquiries, notices, guides, faqs, legalDocuments, banners, admins, bankRows] = await Promise.all([
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
    repo.listInterestFreeInstallments(),
    repo.listPgProviders(),
    repo.listAgencyInquiries(),
    repo.listBoardPosts('notices', { includeInactive: true }),
    repo.listBoardPosts('guides', { includeInactive: true }),
    repo.listFaqs({ includeInactive: true }),
    repo.listLegalDocuments(),
    repo.listBanners({ includeInactive: true }),
    repo.listAdminUsers(),
    pool.query(
      `SELECT code, name, sort_order
       FROM financial_institutions
       WHERE active = true
       ORDER BY sort_order ASC, name ASC`
    )
  ]);

  const adminUserIds = users.map(user => user.id).filter(Boolean);
  const adminCardRows = adminUserIds.length
    ? (await pool.query(
      `SELECT id, user_id, masked_number, card_name, card_company, alias, active, hidden, created_at
       FROM cards
       WHERE user_id = ANY($1::bigint[])
       ORDER BY created_at DESC`,
      [adminUserIds]
    )).rows
    : [];
  const adminCardById = new Map(adminCardRows.map(row => [String(row.id), row]));
  const adminCardByUserId = new Map();
  for (const row of adminCardRows) {
    const key = String(row.user_id);
    if (!adminCardByUserId.has(key)) {
      adminCardByUserId.set(key, []);
    }
    adminCardByUserId.get(key).push(row);
  }

  const franchiseMap = new Map();
  users.forEach(user => {
    const cardList = adminCardByUserId.get(String(user.id)) || [];
    const card = cardList[0];
    franchiseMap.set(user.franchiseId, {
      id: user.franchiseId,
      userId: user.id,
      name: user.franchiseName || 'Unregistered store',
      agencyId: user.agencyId || null,
      agency: displayAgencyName(user.agencyName),
      owner: user.name,
      phone: user.phone || '',
      address: user.address || '',
      tel: user.tel || '',
      bizNo: user.businessNumber || '',
      feeRate: user.franchiseFeeRate,
      bizDocFile: user.bizDocFileKey || '',
      bizDocFileName: user.bizDocFileKey
        ? normalizedBusinessDocDisplayName(user.franchiseName, user.bizDocFileName || user.bizDocFileKey)
        : '',
      joinDate: formatDate(user.createdAt),
      lastPaymentDate: '',
      status: user.role === 'OWNER' ? '\uC815\uC0C1 \uC2B9\uC778' : user.role === 'OWNER_REJECTED' ? '\uC2B9\uC778 \uAC70\uC808' : '\uC2B9\uC778 \uB300\uAE30',
      email: isEmailLike(user.contactEmail) ? user.contactEmail : '',
      loginId: user.loginId,
      customerId: user.customerId || user.loginId || user.email || '',
      contactEmail: user.contactEmail || '',
      role: user.role,
      cardRegistered: Boolean(card),
      cardCompany: card?.card_company || card?.card_name || '',
      cardLast4: card?.masked_number ? String(card.masked_number).replace(/[^0-9]/g, '').slice(-4) : '',
      cardRegisteredDate: card?.created_at ? formatDate(card.created_at) : '',
      cardCount: cardList.length,
      cardList: cardList.map(item => ({
        id: item.id,
        cardCompany: item.card_company || item.card_name || '',
        cardName: item.card_name || '',
        alias: item.alias || '',
        active: item.active !== false,
        hidden: item.hidden === true,
        maskedNumber: item.masked_number || '',
        cardLast4: item.masked_number ? String(item.masked_number).replace(/[^0-9]/g, '').slice(-4) : '',
        createdAt: item.created_at,
        registeredDate: item.created_at ? formatDate(item.created_at) : ''
      })),
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
    const normalizeAccountMergeKey = value => String(value || '').replace(/[^0-9A-Za-z]/g, '').toLowerCase();
    const normalizedKey = item => [
      String(item.agency || '').trim().toLowerCase(),
      String(item.bankName || '').trim().toLowerCase(),
      normalizeAccountMergeKey(item.accountNo)
    ].join('|');
    const statusPriority = item => {
      if (item.accountStatus === '승인완료') return 3;
      if (item.accountStatus === '승인대기') return 2;
      if (item.accountStatus === '반려') return 1;
      return 0;
    };
    const existingIndex = franchise.deliveryAgencies.findIndex(item => (
      item.requestId && item.requestId === entry.requestId
    ) || normalizedKey(item) === normalizedKey(entry));
    if (existingIndex === -1) {
      franchise.deliveryAgencies.push(entry);
      return;
    }
    const existing = franchise.deliveryAgencies[existingIndex];
    if (
      statusPriority(entry) > statusPriority(existing) ||
      (statusPriority(entry) === statusPriority(existing) && String(entry.reqDate || '').localeCompare(String(existing.reqDate || '')) > 0)
    ) {
      franchise.deliveryAgencies[existingIndex] = entry;
    }
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
      customerId: '',
      bizDocFile: '',
      joinDate: formatDate(request.submittedAt),
      lastPaymentDate: '',
      status: request.status === 'APPROVED' ? '\uC815\uC0C1 \uC2B9\uC778' : request.status === 'REJECTED' ? '\uC2B9\uC778 \uAC70\uC808' : '\uC2B9\uC778 \uB300\uAE30',
      email: '',
      role: 'OWNER_PENDING',
      deliveryAgencies: []
    });
  };

  for (const request of accountRequests) {
    const requestAccountNo = request.accountNo || request.assignedVirtualAccount?.accountNumber || '';
    if (!requestAccountNo) continue;
    ensureFranchiseForAccountRequest(request);
    pushDeliveryAgency(request.franchiseId, {
      agency: request.deliveryAgencyName || bankLabel(request.bankCode),
      bankName: request.bankName || bankLabel(request.bankCode),
      accountNo: requestAccountNo,
      accountHolder: request.representativeName || '',
      businessNumber: request.businessNumber || '',
      fileName: request.documentOriginalName ? normalizeUploadOriginalName(request.documentOriginalName) : (request.documentUrl ? path.basename(request.documentUrl) : ''),
      documentUrl: request.documentUrl || '',
      accountStatus: request.status === 'APPROVED' && request.txid ? '\uC2B9\uC778\uC644\uB8CC' : request.status === 'REJECTED' ? '\uBC18\uB824' : '\uC2B9\uC778\uB300\uAE30',
      approvalStatus: request.status,
      reqDate: formatDate(request.submittedAt),
      requestId: request.requestId,
      source: 'account_request',
      hidden: request.hidden === true,
      txid: request.txid || '',
      exportedAt: request.exportedAt || '',
      exportReadyAt: request.exportReadyAt || '',
      rejectReason: request.rejectionReason || ''
    });
  }

  for (const account of deliveryAccounts) {
    pushDeliveryAgency(account.franchiseId, {
      id: account.id,
      agency: account.agencyName || account.bankName || '\uAC00\uC0C1\uACC4\uC88C',
      bankName: account.bankName || '',
      accountNo: account.accountNo || '',
      accountHolder: account.accountHolder || '',
      fileName: deliveryAccountDisplayFileName(account),
      fileKey: account.fileKey || '',
      documentUrl: account.fileKey ? `/uploads/${encodeURIComponent(account.fileKey)}` : '',
      accountStatus: account.accountStatus === 'APPROVED' && account.txid ? '\uC2B9\uC778\uC644\uB8CC' : account.accountStatus === 'REJECTED' ? '\uBC18\uB824' : '\uC2B9\uC778\uB300\uAE30',
      approvalStatus: account.accountStatus,
      reqDate: formatDate(account.reqDate),
      requestId: null,
      source: 'delivery_account',
      hidden: account.hidden === true,
      txid: account.txid || '',
      exportedAt: account.exportedAt || '',
      exportReadyAt: account.exportReadyAt || '',
      rejectReason: account.rejectionReason || ''
    });
  }

  normalizeAdminAccountProofDisplayNames(franchiseMap.values());

  let franchises = Array.from(franchiseMap.values()).sort((a, b) => b.joinDate.localeCompare(a.joinDate));
  const transactionItems = Array.isArray(transactions?.items) ? transactions.items : [];
  const settlementItems = Array.isArray(settlements?.items) ? settlements.items : [];
  const franchiseById = new Map(franchises.map(franchise => [String(franchise.id), franchise]));
  const defaultAgency = agencies.find(agency => (
    agency.joinCode === 'EATSPAY-HQ' ||
    displayAgencyName(agency.name) === DEFAULT_AGENCY_NAME ||
    agency.name === DEFAULT_AGENCY_NAME
  ));
  const primaryPgProvider = [...pgProviders]
    .filter(provider => provider.status === '활성')
    .sort((a, b) => (Number(a.displayOrder || 0) - Number(b.displayOrder || 0)) || String(a.name || '').localeCompare(String(b.name || '')))[0]
    || [...pgProviders].sort((a, b) => (Number(a.displayOrder || 0) - Number(b.displayOrder || 0)) || String(a.name || '').localeCompare(String(b.name || '')))[0]
    || null;
  const primaryPgName = primaryPgProvider?.name || 'GH Payments';
  const pgNameByApprovalNo = new Map(settlementItems.map(item => [String(item.approvalNo || ''), item.pg]).filter(([approvalNo, pg]) => approvalNo && pg));

  const resolveAdminPaymentCard = tx => {
    const settlementPgName = pgNameByApprovalNo.get(String(tx.transactionId || ''));
    const raw = String(tx.cardDetails || '').trim();
    const resolvedPgName = settlementPgName || primaryPgName;
    if (!raw) return { pg: resolvedPgName, cardCompany: '', maskedNumber: '' };
    const refId = raw.startsWith('card:') ? raw.replace(/^card:/, '').trim() : raw;
    const referencedCard = adminCardById.get(refId);
    if (referencedCard) {
      return {
        pg: resolvedPgName,
        cardCompany: referencedCard.card_company || referencedCard.card_name || referencedCard.alias || '카드',
        maskedNumber: referencedCard.masked_number || '****-****-****-****'
      };
    }
    const company = raw.includes('(') ? raw.split('(')[0].trim() : '';
    const maskedMatch = raw.match(/\(([^)]+)\)/);
    const inlineMaskedMatch = raw.match(/(\*{2,4}[-\s]?\*{2,4}[-\s]?\*{2,4}[-\s]?\d{2,4})/);
    if (inlineMaskedMatch) {
      const inlineCompany = raw.slice(0, inlineMaskedMatch.index).trim();
      return {
        pg: resolvedPgName,
        cardCompany: inlineCompany || company || (tx.method === 'CARD' ? '카드' : ''),
        maskedNumber: inlineMaskedMatch[1].replace(/\s+/g, '-')
      };
    }
    if (raw.startsWith('card:')) return { pg: resolvedPgName, cardCompany: '', maskedNumber: '****-****-****-****' };
    return {
      pg: resolvedPgName,
      cardCompany: company || (tx.method === 'CARD' ? '카드' : ''),
      maskedNumber: maskedMatch ? maskedMatch[1] : raw
    };
  };

  const paymentRows = transactionItems.map(tx => {
    const franchise = franchiseById.get(String(tx.franchiseId));
    const agencyId = franchise?.agencyId || defaultAgency?.id || null;
    const agencyName = franchise?.agency || (defaultAgency ? displayAgencyName(defaultAgency.name) : DEFAULT_AGENCY_NAME);
    const depositAmount = Number(tx.amount || 0);
    const feeAmount = Number(tx.fee || tx.calculatedFee || 0);
    const totalAmount = Number(tx.totalAmount || tx.total_amount || (depositAmount + feeAmount));
    const cardInfo = resolveAdminPaymentCard(tx);
    return {
      id: tx.transactionId,
      date: formatKstDateTime(tx.createdAt),
      approvalNo: tx.transactionId,
      agency: agencyName,
      franchise: franchise?.name || `가맹점 ${tx.franchiseId}`,
      franchiseId: tx.franchiseId,
      customerId: franchise?.customerId || '',
      type: tx.type === 'CHARGE' ? '\uCDA9\uC804' : tx.type,
      amount: totalAmount,
      depositAmount,
      fee: feeAmount,
      totalAmount,
      installment: '\uC77C\uC2DC\uBD88',
      status: tx.status === 'SUCCESS' ? '\uACB0\uC81C\uC644\uB8CC' : tx.status,
      pg: cardInfo.pg,
      cardCompany: cardInfo.cardCompany,
      maskedNumber: cardInfo.maskedNumber,
      cardLast4: cardInfo.maskedNumber ? String(cardInfo.maskedNumber).replace(/[^0-9]/g, '').slice(-4) : '',
      agencyId
    };
  });
  const normalizeAccountKey = value => String(value || '').replace(/[^0-9A-Za-z]/g, '');
  const bankLabelByName = bankCode => {
    const normalized = String(bankCode || '').replace(/[^0-9]/g, '');
    const labels = {
      '003': '기업은행',
      '004': '국민은행',
      '011': '농협은행',
      '020': '우리은행',
      '081': '하나은행',
      '088': '신한은행'
    };
    return labels[normalized] || bankCode || '';
  };
  const latestSettlementAccountByFranchise = new Map();
  for (const settlement of settlementItems) {
    const franchiseId = String(settlement.franchiseId || '');
    const accountNo = String(settlement.accountNo || '').trim();
    if (!franchiseId || !accountNo) continue;
    const current = latestSettlementAccountByFranchise.get(franchiseId);
    const currentDate = current?.settledAt || '';
    const nextDate = settlement.settledAt || '';
    if (!current || String(nextDate).localeCompare(String(currentDate)) >= 0) {
      latestSettlementAccountByFranchise.set(franchiseId, settlement);
    }
  }
  for (const franchise of franchises) {
    const settlement = latestSettlementAccountByFranchise.get(String(franchise.id || ''));
    if (!settlement) continue;
    if (!Array.isArray(franchise.deliveryAgencies)) franchise.deliveryAgencies = [];
    const settlementAccountKey = normalizeAccountKey(settlement.accountNo);
    if (!settlementAccountKey) continue;
    const exists = franchise.deliveryAgencies.some(account => (
      normalizeAccountKey(account.accountNo) === settlementAccountKey
    ));
    if (exists) continue;
    franchise.deliveryAgencies.push({
      id: `settlement:${settlement.id || settlement.approvalNo || settlementAccountKey}`,
      agency: settlement.deliveryAgency || settlement.agencyName || '배달대행사',
      bankName: bankLabelByName(settlement.bankCode),
      bankCode: settlement.bankCode || '',
      accountNo: settlement.accountNo,
      accountHolder: franchise.owner || '',
      fileName: '',
      documentUrl: '',
      accountStatus: '승인완료',
      reqDate: settlement.settledAt ? formatDate(settlement.settledAt) : '',
      requestId: null,
      source: 'pg_settlement',
      hidden: false,
      txid: settlement.pgTxId || '',
      exportedAt: '',
      exportReadyAt: '',
      rejectReason: '',
      readonly: true
    });
  }
  franchises = franchises.map((franchise, index) => enrichAdminFranchiseDisplay(franchise, index, paymentRows));

  const paymentNameByFranchiseId = new Map(franchises.map(f => [f.id, f.name]));
  const paymentAgencyByFranchiseId = new Map(franchises.map(f => [String(f.id), {
    id: f.agencyId || null,
    name: f.agency || f.agencyName || ''
  }]));
  const paymentDateByApprovalNo = new Map(paymentRows.map(row => [String(row.approvalNo || ''), row.date]).filter(([approvalNo, date]) => approvalNo && date));
  const pgRows = settlementItems.map(item => {
    const fallbackAgency = paymentAgencyByFranchiseId.get(String(item.franchiseId || '')) || {};
    return {
      id: item.id,
      date: paymentDateByApprovalNo.get(String(item.approvalNo || '')) || formatKstDateTime(item.settledAt),
      paymentDate: paymentDateByApprovalNo.get(String(item.approvalNo || '')) || formatKstDateTime(item.settledAt),
      settlementDate: formatKstDateTime(item.settledAt),
      settledAt: formatKstDateTime(item.settledAt),
      approvalNo: item.approvalNo,
      franchiseId: item.franchiseId || null,
      pg: item.pg,
      franchise: item.franchiseName || paymentNameByFranchiseId.get(item.franchiseId) || '',
      paymentAmt: Number(item.paymentAmt),
      svcFee: Number(item.svcFee),
      netAmt: Number(item.netAmt),
      deliveryAgency: item.deliveryAgency || '',
      status: item.status === 'ROLLED_BACK' ? '\uB864\uBC31' : '\uC815\uC0C1\uC2B9\uC778',
      note: '',
      agencyId: item.agencyId || fallbackAgency.id || null,
      agency: item.agencyName || fallbackAgency.name || '',
      customerId: item.customerId || '',
      bankCode: item.bankCode || '',
      accountNo: item.accountNo || '',
      pgTxId: item.pgTxId || ''
    };
  });

  const isAgencyViewer = req.user.role === 'AGENCY';
  const scopedAgencyIds = isAgencyViewer ? agencyScopeIds(agencies, req.user.agencyId || req.user.id) : null;
  const scopedFranchises = isAgencyViewer
    ? franchises.filter(franchise => scopedAgencyIds.has(String(franchise.agencyId || '')))
    : franchises;
  const scopedFranchiseIds = new Set(scopedFranchises.map(franchise => String(franchise.id || '')).filter(Boolean));
  const scopedPayments = isAgencyViewer
    ? paymentRows.filter(payment => scopedFranchiseIds.has(String(payment.franchiseId || '')) || scopedAgencyIds.has(String(payment.agencyId || '')))
    : paymentRows;
  const scopedPgRows = isAgencyViewer
    ? pgRows.filter(row => scopedFranchiseIds.has(String(row.franchiseId || '')) || scopedAgencyIds.has(String(row.agencyId || '')))
    : pgRows;
  const scopedAccountRequests = isAgencyViewer
    ? accountRequests.filter(request => scopedFranchiseIds.has(String(request.franchiseId || '')))
    : accountRequests;
  const scopedDeliveryAccounts = isAgencyViewer
    ? deliveryAccounts.filter(account => scopedFranchiseIds.has(String(account.franchiseId || '')))
    : deliveryAccounts;
  const scopedAgencies = isAgencyViewer
    ? agencies.filter(agency => scopedAgencyIds.has(String(agency.id || '')))
    : agencies;

  const today = formatKstDate(new Date());
  const todayPaymentTotal = scopedPayments
    .filter(payment => payment.date.startsWith(today))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  return res.status(200).json({
    success: true,
    data: {
      summary: {
        pendingFranchises: scopedFranchises.filter(franchise => franchise.role === 'OWNER_PENDING').length,
        pendingAccounts: scopedAccountRequests.filter(request => request.status === 'PENDING').length,
      totalFranchises: scopedFranchises.length,
      todayPaymentTotal
    },
    franchises: scopedFranchises,
    agencies: scopedAgencies.map(agency => ({
      ...agency,
      name: displayAgencyName(agency.name)
    })),
    deliveryAgencies,
    installments,
    pgProviders,
    inquiries,
    notices,
    guides,
    faqs,
    legalDocuments,
    banners,
    admins: isAgencyViewer ? [] : admins.map(serializeAdminUser),
    banks: bankRows.rows.map(row => ({
      code: row.code,
      name: row.name,
      sortOrder: row.sort_order
    })),
    customRoles: ADMIN_ROLE_LIST,
    payments: scopedPayments,
    pgSettlements: scopedPgRows,
    accountRequests: scopedAccountRequests,
      deliveryAccounts: scopedDeliveryAccounts
    }
  });
}));

app.patch('/api/admin/me/password', authenticateAdmin, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return sendError(res, 400, 'BAD_REQUEST', '현재 비밀번호와 새 비밀번호를 입력해 주세요.');
  }
  if (String(newPassword).length < 8) {
    return sendError(res, 400, 'INVALID_PASSWORD', '관리자 비밀번호는 8자 이상이어야 합니다.');
  }
  const user = await repo.findUserById(req.user.id);
  if (!user || !user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return sendError(res, 401, 'INVALID_CURRENT_PASSWORD', '현재 비밀번호가 일치하지 않습니다.');
  }
  const updated = await repo.updateAdminUser(user.id, {
    passwordHash: await hashPassword(newPassword)
  });
  return res.status(200).json({
    success: true,
    data: { user: publicUser(updated) }
  });
}));

app.get('/api/admin/admins', authenticateAdmin, requireSuperAdmin, asyncHandler(async (req, res) => {
  const admins = await repo.listAdminUsers();
  return res.status(200).json({
    success: true,
    data: admins.map(serializeAdminUser)
  });
}));

app.post('/api/admin/admins', authenticateAdmin, requireSuperAdmin, asyncHandler(async (req, res) => {
  const loginId = String(req.body?.loginId || req.body?.email || '').trim();
  const name = String(req.body?.name || '').trim();
  const password = String(req.body?.password || '');
  const adminLevel = normalizeAdminLevel(req.body?.adminLevel || req.body?.role || 'CUSTOMER');
  const adminPermissions = normalizeAdminPermissions(req.body?.adminPermissions, adminLevel);
  if (!loginId || !name || !password) {
    return sendError(res, 400, 'BAD_REQUEST', '로그인 아이디, 이름, 비밀번호를 입력해 주세요.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginId) && !/^[a-zA-Z0-9._-]{3,60}$/.test(loginId)) {
    return sendError(res, 400, 'INVALID_LOGIN_ID', '로그인 아이디 형식을 확인해 주세요.');
  }
  if (password.length < 8) {
    return sendError(res, 400, 'INVALID_PASSWORD', '관리자 비밀번호는 8자 이상이어야 합니다.');
  }
  const existing = await repo.findUserByLoginId(loginId);
  if (existing && existing.adminActive !== false) {
    return sendError(res, 409, 'ALREADY_EXISTS', '이미 사용 중인 관리자 아이디입니다.');
  }
  const created = await repo.createAdminUser({
    loginId,
    name,
    adminLevel,
    adminPermissions,
    passwordHash: await hashPassword(password)
  });
  return res.status(201).json({
    success: true,
    data: serializeAdminUser(created)
  });
}));

app.patch('/api/admin/admins/:id', authenticateAdmin, requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '관리자 ID가 올바르지 않습니다.');
  }
  const current = await repo.findUserById(id);
  if (!current || current.role !== 'ADMIN') {
    return sendError(res, 404, 'ADMIN_NOT_FOUND', '관리자 계정을 찾을 수 없습니다.');
  }
  const fields = {};
  if (req.body?.loginId !== undefined || req.body?.email !== undefined) {
    const loginId = String(req.body.loginId || req.body.email || '').trim();
    if (!loginId) return sendError(res, 400, 'BAD_REQUEST', '로그인 아이디를 입력해 주세요.');
    const existing = await repo.findUserByLoginId(loginId);
    if (existing && String(existing.id) !== String(id)) {
      return sendError(res, 409, 'ALREADY_EXISTS', '이미 사용 중인 관리자 아이디입니다.');
    }
    fields.loginId = loginId;
  }
  if (req.body?.name !== undefined) {
    const name = String(req.body.name || '').trim();
    if (!name) return sendError(res, 400, 'BAD_REQUEST', '이름을 입력해 주세요.');
    fields.name = name;
  }
  if (req.body?.adminLevel !== undefined || req.body?.role !== undefined) {
    const adminLevel = normalizeAdminLevel(req.body.adminLevel || req.body.role);
    if (normalizeAdminLevel(current.adminLevel) === 'SUPER' && adminLevel !== 'SUPER') {
      const remainingSuperAdmins = await repo.countActiveSuperAdmins(id);
      if (remainingSuperAdmins < 1) {
        return sendError(res, 400, 'LAST_SUPER_ADMIN', '총괄 관리자는 최소 1명 필요합니다.');
      }
    }
    fields.adminLevel = adminLevel;
  }
  if (req.body?.adminPermissions !== undefined) {
    fields.adminPermissions = normalizeAdminPermissions(req.body.adminPermissions, fields.adminLevel || current.adminLevel);
  } else if (fields.adminLevel !== undefined && !current.adminPermissions) {
    fields.adminPermissions = normalizeAdminPermissions(null, fields.adminLevel);
  }
  if (req.body?.password) {
    const password = String(req.body.password);
    if (password.length < 8) {
      return sendError(res, 400, 'INVALID_PASSWORD', '관리자 비밀번호는 8자 이상이어야 합니다.');
    }
    fields.passwordHash = await hashPassword(password);
  }
  const updated = await repo.updateAdminUser(id, fields);
  return res.status(200).json({
    success: true,
    data: serializeAdminUser(updated)
  });
}));

app.delete('/api/admin/admins/:id', authenticateAdmin, requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '관리자 ID가 올바르지 않습니다.');
  }
  if (String(req.user.id) === String(id)) {
    return sendError(res, 400, 'SELF_DELETE_DENIED', '현재 로그인한 관리자 계정은 삭제할 수 없습니다.');
  }
  const target = await repo.findUserById(id);
  if (!target || target.role !== 'ADMIN') {
    return sendError(res, 404, 'ADMIN_NOT_FOUND', '관리자 계정을 찾을 수 없습니다.');
  }
  if (normalizeAdminLevel(target.adminLevel) === 'SUPER') {
    const remainingSuperAdmins = await repo.countActiveSuperAdmins(id);
    if (remainingSuperAdmins < 1) {
      return sendError(res, 400, 'LAST_SUPER_ADMIN', '총괄 관리자는 최소 1명 필요합니다.');
    }
  }
  const deleted = await repo.updateAdminUser(id, { adminActive: false });
  return res.status(200).json({
    success: true,
    data: serializeAdminUser(deleted)
  });
}));

app.get('/api/admin/delivery-agencies', authenticateAdmin, asyncHandler(async (req, res) => {
  const deliveryAgencies = await repo.listDeliveryAgencies();
  return res.status(200).json({ success: true, data: deliveryAgencies });
}));

app.get('/api/admin/installments', authenticateAdmin, asyncHandler(async (req, res) => {
  const installments = await repo.listInterestFreeInstallments({ policyMonth: req.query.policyMonth });
  return res.status(200).json({ success: true, data: installments });
}));

app.put('/api/admin/installments', authenticateAdmin, asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) {
    return sendError(res, 400, 'BAD_REQUEST', 'items are required.');
  }

  const saved = await repo.replaceInterestFreeInstallments(items, { policyMonth: req.body?.policyMonth });
  return res.status(200).json({ success: true, data: saved });
}));

app.get('/api/admin/pg-providers', authenticateAdmin, asyncHandler(async (req, res) => {
  const providers = await repo.listPgProviders();
  return res.status(200).json({ success: true, data: providers });
}));

app.post('/api/admin/pg-providers', authenticateAdmin, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return sendError(res, 400, 'BAD_REQUEST', 'PG사명은 필수입니다.');
  }

  const provider = await repo.createPgProvider({
    name,
    mid: String(body.mid || '').trim(),
    apiKey: String(body.apiKey || '').trim(),
    callbackUrl: String(body.callbackUrl || '').trim(),
    status: String(body.status || '활성').trim(),
    note: String(body.note || '').trim(),
    displayOrder: Number(body.displayOrder) || 0
  });
  return res.status(201).json({ success: true, data: provider });
}));

async function savePgProviderHandler(req, res) {
  const id = Number(req.params.id);
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', 'PG사 ID가 올바르지 않습니다.');
  }
  if (!name) {
    return sendError(res, 400, 'BAD_REQUEST', 'PG사명은 필수입니다.');
  }

  const provider = await repo.updatePgProvider(id, {
    name,
    mid: String(body.mid || '').trim(),
    apiKey: String(body.apiKey || '').trim(),
    callbackUrl: String(body.callbackUrl || '').trim(),
    status: String(body.status || '활성').trim(),
    note: String(body.note || '').trim(),
    displayOrder: Number(body.displayOrder) || 0
  });
  if (!provider) {
    return sendError(res, 404, 'PG_PROVIDER_NOT_FOUND', 'PG사를 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: provider });
}

app.put('/api/admin/pg-providers/:id', authenticateAdmin, asyncHandler(savePgProviderHandler));
app.patch('/api/admin/pg-providers/:id', authenticateAdmin, asyncHandler(savePgProviderHandler));

app.patch('/api/admin/pg-providers/:id/status', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '').trim();
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', 'PG사 ID가 올바르지 않습니다.');
  }
  if (!['활성', '비활성', '준비중'].includes(status)) {
    return sendError(res, 400, 'BAD_REQUEST', 'PG사 상태가 올바르지 않습니다.');
  }
  const provider = await repo.setPgProviderStatus(id, status);
  if (!provider) {
    return sendError(res, 404, 'PG_PROVIDER_NOT_FOUND', 'PG사를 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: provider });
}));

app.delete('/api/admin/pg-providers/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', 'PG사 ID가 올바르지 않습니다.');
  }
  const deleted = await repo.deletePgProvider(id);
  if (!deleted) {
    return sendError(res, 404, 'PG_PROVIDER_NOT_FOUND', 'PG사를 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: deleted });
}));

app.get('/api/admin/inquiries', authenticateAdmin, asyncHandler(async (req, res) => {
  const inquiries = await repo.listAgencyInquiries();
  return res.status(200).json({ success: true, data: inquiries });
}));

app.post('/api/admin/inquiries', authenticateAdmin, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return sendError(res, 400, 'BAD_REQUEST', '이름은 필수입니다.');
  }
  const inquiry = await repo.createAgencyInquiry({
    name,
    phone: String(body.phone || '').trim(),
    deliveryAgency: String(body.deliveryAgency || '').trim(),
    region: String(body.region || '').trim(),
    handler: String(body.handler || '').trim(),
    status: String(body.status || '상담 대기').trim()
  });
  return res.status(201).json({ success: true, data: inquiry });
}));

async function updateAdminInquiryHandler(req, res) {
  const id = Number(req.params.id);
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '문의 ID가 올바르지 않습니다.');
  }
  if (!name) {
    return sendError(res, 400, 'BAD_REQUEST', '이름은 필수입니다.');
  }
  const inquiry = await repo.updateAgencyInquiry(id, {
    name,
    phone: String(body.phone || '').trim(),
    deliveryAgency: String(body.deliveryAgency || '').trim(),
    region: String(body.region || '').trim(),
    handler: String(body.handler || '').trim(),
    status: String(body.status || '상담 대기').trim()
  });
  if (!inquiry) {
    return sendError(res, 404, 'INQUIRY_NOT_FOUND', '문의를 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: inquiry });
}

app.put('/api/admin/inquiries/:id', authenticateAdmin, asyncHandler(updateAdminInquiryHandler));
app.patch('/api/admin/inquiries/:id', authenticateAdmin, asyncHandler(updateAdminInquiryHandler));

app.patch('/api/admin/inquiries/:id/status', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '').trim();
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '문의 ID가 올바르지 않습니다.');
  }
  if (!['상담 대기', '상담 완료'].includes(status)) {
    return sendError(res, 400, 'BAD_REQUEST', '상태는 상담 대기 또는 상담 완료여야 합니다.');
  }
  const inquiry = await repo.updateAgencyInquiryStatus(id, status);
  if (!inquiry) {
    return sendError(res, 404, 'INQUIRY_NOT_FOUND', '문의를 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: inquiry });
}));

app.delete('/api/admin/inquiries/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '문의 ID가 올바르지 않습니다.');
  }
  const deleted = await repo.deleteAgencyInquiry(id);
  if (!deleted) {
    return sendError(res, 404, 'INQUIRY_NOT_FOUND', '문의를 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: deleted });
}));

function validateBannerBody(body) {
  const title = String(body?.title || '').trim();
  if (!title) {
    return { error: '배너 제목은 필수입니다.' };
  }
  const status = String(body?.status || '활성').trim();
  if (!['활성', '비활성', '예약'].includes(status)) {
    return { error: '배너 상태가 올바르지 않습니다.' };
  }
  return {
    title,
    subtitle: String(body?.subtitle || '').trim(),
    url: String(body?.url || '').trim(),
    imageUrl: String(body?.imageUrl || body?.image_url || '').trim(),
    detailTitle: String(body?.detailTitle || body?.detail_title || '').trim(),
    detailSubtitle: String(body?.detailSubtitle || body?.detail_subtitle || '').trim(),
    detailImageUrl: String(body?.detailImageUrl || body?.detail_image_url || '').trim(),
    type: String(body?.type || '메인').trim() || '메인',
    status,
    displayOrder: Number(body?.displayOrder ?? body?.order) || 0,
    startAt: String(body?.startAt || body?.start_at || '').trim(),
    endAt: String(body?.endAt || body?.end_at || '').trim()
  };
}

function escapeSvgText(value, maxLength = 120) {
  return String(value || '')
    .trim()
    .slice(0, maxLength)
    .replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
}

function bannerPalette(style) {
  const key = String(style || '').trim();
  const palettes = {
    premium: {
      bg1: '#f8fff7',
      bg2: '#e8f8e6',
      border: '#cfe8cf',
      title: '#14532d',
      subtitle: '#375645',
      accent: '#03c75a',
      accent2: '#1f9d55'
    },
    clean: {
      bg1: '#ffffff',
      bg2: '#f2fbf4',
      border: '#d8ead8',
      title: '#15351f',
      subtitle: '#4f6257',
      accent: '#3d9b35',
      accent2: '#03c75a'
    },
    blue: {
      bg1: '#f7fcff',
      bg2: '#eaf7ff',
      border: '#c9e5f5',
      title: '#16435a',
      subtitle: '#4c6370',
      accent: '#1687c9',
      accent2: '#03c75a'
    },
    warm: {
      bg1: '#fffdf7',
      bg2: '#f6faec',
      border: '#e4ecc7',
      title: '#314316',
      subtitle: '#64704b',
      accent: '#7dbb35',
      accent2: '#03c75a'
    }
  };
  return palettes[key] || palettes.premium;
}

function renderBannerSvg({ title, subtitle, style, logoDataUrl }) {
  const safeTitle = escapeSvgText(title, 44);
  const safeSubtitle = escapeSvgText(subtitle, 70);
  const palette = bannerPalette(style);
  const logoImage = logoDataUrl
    ? `<image href="${logoDataUrl}" x="58" y="31" width="94" height="66" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="105" y="73" text-anchor="middle" font-family="Pretendard, Arial, sans-serif" font-size="24" font-weight="900" fill="${palette.accent}">eats PAY</text>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="128" viewBox="0 0 720 128" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.bg1}"/>
      <stop offset="1" stop-color="${palette.bg2}"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".5" stop-color="#fff" stop-opacity=".42"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-30%" width="140%" height="160%">
      <feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#1d4d2a" flood-opacity=".12"/>
    </filter>
  </defs>
  <rect x="8" y="8" width="704" height="112" rx="15" fill="url(#bg)" stroke="${palette.border}" stroke-width="2"/>
  <circle cx="650" cy="20" r="62" fill="${palette.accent}" opacity=".08"/>
  <circle cx="690" cy="102" r="38" fill="${palette.accent2}" opacity=".10"/>
  <g filter="url(#softShadow)">
    ${logoImage}
  </g>
  <g font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, Arial, sans-serif">
    <text x="206" y="57" font-size="27" font-weight="900" fill="${palette.title}">${safeTitle}</text>
    ${safeSubtitle ? `<text x="206" y="86" font-size="16" font-weight="800" fill="${palette.subtitle}">${safeSubtitle}</text>` : ''}
  </g>
  <rect x="-190" y="8" width="120" height="112" fill="url(#shine)" transform="skewX(-18)">
    <animate attributeName="x" values="-190;790" dur="5.8s" repeatCount="indefinite"/>
  </rect>
</svg>`;
}

async function saveGeneratedBannerImage({ title, subtitle, style, file }) {
  const isImage = file && ['image/png', 'image/jpeg', 'image/jpg'].includes(String(file.mimetype || '').toLowerCase());
  if (file && !isImage) {
    const error = new Error('로고 파일은 PNG 또는 JPG만 사용할 수 있습니다.');
    error.statusCode = 400;
    throw error;
  }
  const logoDataUrl = file ? `data:${file.mimetype};base64,${file.buffer.toString('base64')}` : '';
  const svg = renderBannerSvg({ title, subtitle, style, logoDataUrl });
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const slug = String(title || 'banner').trim().toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'banner';
  const filename = `banner-${Date.now()}-${crypto.randomUUID()}-${slug}.svg`;
  await fs.promises.writeFile(path.join(uploadDir, filename), svg, 'utf8');
  return `/uploads/${encodeURIComponent(filename)}`;
}

app.get('/api/admin/banners', authenticateAdmin, asyncHandler(async (req, res) => {
  const banners = await repo.listBanners({ includeInactive: true });
  return res.status(200).json({ success: true, data: banners });
}));

app.get('/api/banners', asyncHandler(async (req, res) => {
  const type = String(req.query.type || '').trim();
  const now = Date.now();
  const banners = (await repo.listBanners({ includeInactive: false }))
    .filter(banner => !type || banner.type === type)
    .filter(banner => {
      const start = banner.startAt ? new Date(banner.startAt).getTime() : null;
      const end = banner.endAt ? new Date(banner.endAt).getTime() : null;
      return (!Number.isFinite(start) || start <= now) && (!Number.isFinite(end) || end >= now);
    });
  return res.status(200).json({ success: true, data: banners });
}));

app.post('/api/admin/banners', authenticateAdmin, asyncHandler(async (req, res) => {
  const body = validateBannerBody(req.body);
  if (body.error) {
    return sendError(res, 400, 'BAD_REQUEST', body.error);
  }
  const banner = await repo.createBanner(body);
  return res.status(201).json({ success: true, data: banner });
}));

app.post('/api/admin/banners/render-image', authenticateAdmin, singleUpload('logo'), asyncHandler(async (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title) {
    return sendError(res, 400, 'BAD_REQUEST', '배너 제목을 먼저 입력하세요.');
  }
  const imageUrl = await saveGeneratedBannerImage({
    title,
    subtitle: String(req.body?.subtitle || '').trim(),
    style: String(req.body?.style || 'premium').trim(),
    file: req.file || null
  });
  return res.status(201).json({
    success: true,
    data: {
      imageUrl,
      source: 'internal-svg'
    }
  });
}));

async function updateAdminBannerHandler(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '배너 ID가 올바르지 않습니다.');
  }
  const body = validateBannerBody(req.body);
  if (body.error) {
    return sendError(res, 400, 'BAD_REQUEST', body.error);
  }
  const banner = await repo.updateBanner(id, body);
  if (!banner) {
    return sendError(res, 404, 'BANNER_NOT_FOUND', '배너를 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: banner });
}

app.put('/api/admin/banners/:id', authenticateAdmin, asyncHandler(updateAdminBannerHandler));
app.patch('/api/admin/banners/:id', authenticateAdmin, asyncHandler(updateAdminBannerHandler));

app.patch('/api/admin/banners/:id/status', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '').trim();
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '배너 ID가 올바르지 않습니다.');
  }
  if (!['활성', '비활성', '예약'].includes(status)) {
    return sendError(res, 400, 'BAD_REQUEST', '배너 상태가 올바르지 않습니다.');
  }
  const banner = await repo.setBannerStatus(id, status);
  if (!banner) {
    return sendError(res, 404, 'BANNER_NOT_FOUND', '배너를 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: banner });
}));

app.delete('/api/admin/banners/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '배너 ID가 올바르지 않습니다.');
  }
  const deleted = await repo.deleteBanner(id);
  if (!deleted) {
    return sendError(res, 404, 'BANNER_NOT_FOUND', '배너를 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: deleted });
}));

function normalizeBoardType(type) {
  return ['notices', 'guides'].includes(type) ? type : '';
}

function normalizeAdminAgencyKind(type, level) {
  const rawType = String(type || '').trim().toLowerCase();
  if (['bonbu', 'hq', 'head'].includes(rawType)) return { type: 'HQ', level: 1 };
  if (['jisa', 'branch'].includes(rawType)) return { type: 'BRANCH', level: 2 };
  if (['jijum', 'office', 'agency'].includes(rawType)) return { type: 'OFFICE', level: 3 };

  const numericLevel = Number(level);
  if (numericLevel <= 1) return { type: 'HQ', level: 1 };
  if (numericLevel === 2) return { type: 'BRANCH', level: 2 };
  return { type: 'OFFICE', level: 3 };
}

function validateBoardPostBody(body) {
  const title = String(body?.title || '').trim();
  const author = String(body?.author || '운영팀').trim() || '운영팀';
  const content = String(body?.content || '').trim();
  if (!title || !content) {
    return { error: '제목과 내용은 필수입니다.' };
  }
  return { title, author, content };
}

app.get('/api/boards/:type', asyncHandler(async (req, res) => {
  const boardType = normalizeBoardType(req.params.type);
  if (!boardType) {
    return sendError(res, 400, 'INVALID_BOARD_TYPE', '게시판 유형이 올바르지 않습니다.');
  }
  const posts = await repo.listBoardPosts(boardType, {
    includeInactive: false,
    limit: Math.min(Number(req.query.limit) || 50, 100)
  });
  return res.status(200).json({ success: true, data: posts });
}));

app.get('/api/notices', asyncHandler(async (req, res) => {
  const posts = await repo.listBoardPosts('notices', {
    includeInactive: false,
    limit: Math.min(Number(req.query.limit) || 50, 100)
  });
  return res.status(200).json({ success: true, data: posts });
}));

app.get('/api/guides', asyncHandler(async (req, res) => {
  const posts = await repo.listBoardPosts('guides', {
    includeInactive: false,
    limit: Math.min(Number(req.query.limit) || 50, 100)
  });
  return res.status(200).json({ success: true, data: posts });
}));

app.get('/api/admin/boards/:type', authenticateAdmin, asyncHandler(async (req, res) => {
  const boardType = normalizeBoardType(req.params.type);
  if (!boardType) {
    return sendError(res, 400, 'INVALID_BOARD_TYPE', '게시판 유형이 올바르지 않습니다.');
  }
  const posts = await repo.listBoardPosts(boardType, { includeInactive: true, limit: 200 });
  return res.status(200).json({ success: true, data: posts });
}));

app.post('/api/admin/boards/:type', authenticateAdmin, asyncHandler(async (req, res) => {
  const boardType = normalizeBoardType(req.params.type);
  if (!boardType) {
    return sendError(res, 400, 'INVALID_BOARD_TYPE', '게시판 유형이 올바르지 않습니다.');
  }
  const body = validateBoardPostBody(req.body);
  if (body.error) {
    return sendError(res, 400, 'BAD_REQUEST', body.error);
  }
  const post = await repo.createBoardPost(boardType, body);
  return res.status(201).json({ success: true, data: post });
}));

app.patch('/api/admin/boards/:type/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const boardType = normalizeBoardType(req.params.type);
  const id = Number(req.params.id);
  if (!boardType || !Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '게시글 정보가 올바르지 않습니다.');
  }
  const body = validateBoardPostBody(req.body);
  if (body.error) {
    return sendError(res, 400, 'BAD_REQUEST', body.error);
  }
  const post = await repo.updateBoardPost(boardType, id, body);
  if (!post) {
    return sendError(res, 404, 'BOARD_POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: post });
}));

app.delete('/api/admin/boards/:type/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const boardType = normalizeBoardType(req.params.type);
  const id = Number(req.params.id);
  if (!boardType || !Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '게시글 정보가 올바르지 않습니다.');
  }
  const deleted = await repo.deleteBoardPost(boardType, id);
  if (!deleted) {
    return sendError(res, 404, 'BOARD_POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: deleted });
}));

function validateFaqBody(body) {
  const category = String(body?.category || '서비스 안내').trim() || '서비스 안내';
  const question = String(body?.question || '').trim();
  const answer = String(body?.answer || '').trim();
  if (!question || !answer) {
    return { error: '질문과 답변은 필수입니다.' };
  }
  return { category, question, answer };
}

app.get('/api/faqs', asyncHandler(async (req, res) => {
  const faqs = await repo.listFaqs({ includeInactive: false });
  return res.status(200).json({ success: true, data: faqs });
}));

app.get('/api/admin/faqs', authenticateAdmin, asyncHandler(async (req, res) => {
  const faqs = await repo.listFaqs({ includeInactive: true });
  return res.status(200).json({ success: true, data: faqs });
}));

app.post('/api/admin/faqs', authenticateAdmin, asyncHandler(async (req, res) => {
  const body = validateFaqBody(req.body);
  if (body.error) {
    return sendError(res, 400, 'BAD_REQUEST', body.error);
  }
  const faq = await repo.createFaq(body);
  return res.status(201).json({ success: true, data: faq });
}));

app.patch('/api/admin/faqs/order', authenticateAdmin, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) {
    return sendError(res, 400, 'BAD_REQUEST', '정렬할 FAQ가 없습니다.');
  }
  const faqs = await repo.updateFaqOrder(ids);
  return res.status(200).json({ success: true, data: faqs });
}));

app.patch('/api/admin/faqs/category', authenticateAdmin, asyncHandler(async (req, res) => {
  const oldCategory = String(req.body?.oldCategory || '').trim();
  const newCategory = String(req.body?.newCategory || '').trim();
  if (!oldCategory || !newCategory) {
    return sendError(res, 400, 'BAD_REQUEST', '카테고리 이름을 확인해주세요.');
  }
  if (oldCategory === newCategory) {
    return res.status(200).json({ success: true, data: [] });
  }
  const faqs = await repo.renameFaqCategory(oldCategory, newCategory);
  return res.status(200).json({ success: true, data: faqs });
}));

app.patch('/api/admin/faqs/categories/order', authenticateAdmin, asyncHandler(async (req, res) => {
  const categories = Array.isArray(req.body?.categories)
    ? req.body.categories.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  if (!categories.length) {
    return sendError(res, 400, 'BAD_REQUEST', '정렬할 FAQ 탭이 없습니다.');
  }
  const items = await repo.updateFaqCategoryOrder(categories);
  const faqs = await repo.listFaqs({ includeInactive: true });
  return res.status(200).json({ success: true, data: { categories: items, faqs } });
}));

app.delete('/api/admin/faqs/category/:category', authenticateAdmin, asyncHandler(async (req, res) => {
  const category = String(req.params.category || '').trim();
  if (!category) {
    return sendError(res, 400, 'BAD_REQUEST', '삭제할 카테고리를 확인해주세요.');
  }
  const deleted = await repo.deleteFaqCategory(category);
  return res.status(200).json({ success: true, data: deleted });
}));

app.patch('/api/admin/faqs/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', 'FAQ ID가 올바르지 않습니다.');
  }
  const body = validateFaqBody(req.body);
  if (body.error) {
    return sendError(res, 400, 'BAD_REQUEST', body.error);
  }
  const faq = await repo.updateFaq(id, body);
  if (!faq) {
    return sendError(res, 404, 'FAQ_NOT_FOUND', 'FAQ를 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: faq });
}));

app.delete('/api/admin/faqs/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', 'FAQ ID가 올바르지 않습니다.');
  }
  const deleted = await repo.deleteFaq(id);
  if (!deleted) {
    return sendError(res, 404, 'FAQ_NOT_FOUND', 'FAQ를 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: deleted });
}));

function validateLegalDocumentBody(body) {
  const type = String(body?.type || '').trim();
  const title = String(body?.title || '').trim();
  const content = String(body?.content || '').trim();
  const sourceFileName = String(body?.sourceFileName || '').trim();
  const applied = body?.applied === true;
  if (!['terms', 'privacy'].includes(type)) {
    return { error: '문서 종류가 올바르지 않습니다.' };
  }
  if (!title || !content) {
    return { error: '제목과 본문은 필수입니다.' };
  }
  return { type, title, content, sourceFileName, applied };
}

app.get('/api/legal-documents/active', asyncHandler(async (req, res) => {
  const documents = await repo.listLegalDocuments({ activeOnly: true });
  return res.status(200).json({ success: true, data: documents });
}));

app.get('/api/admin/legal-documents', authenticateAdmin, asyncHandler(async (req, res) => {
  const documents = await repo.listLegalDocuments();
  return res.status(200).json({ success: true, data: documents });
}));

app.post('/api/admin/legal-documents', authenticateAdmin, express.json({ limit: '10mb' }), asyncHandler(async (req, res) => {
  const body = validateLegalDocumentBody(req.body);
  if (body.error) {
    return sendError(res, 400, 'BAD_REQUEST', body.error);
  }
  const doc = await repo.createLegalDocument(body);
  return res.status(201).json({ success: true, data: doc });
}));

app.patch('/api/admin/legal-documents/:id/apply', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '문서 ID가 올바르지 않습니다.');
  }
  const doc = await repo.applyLegalDocument(id, req.body?.applied === true);
  if (!doc) {
    return sendError(res, 404, 'LEGAL_DOCUMENT_NOT_FOUND', '문서를 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: doc });
}));

app.delete('/api/admin/legal-documents/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '문서 ID가 올바르지 않습니다.');
  }
  const deleted = await repo.deleteLegalDocument(id);
  if (!deleted) {
    return sendError(res, 404, 'LEGAL_DOCUMENT_NOT_FOUND', '문서를 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: deleted });
}));

app.post('/api/admin/agencies', authenticateAdmin, asyncHandler(async (req, res) => {
  const { name, loginId, type, level, region, owner, phone, feeRate, parentId, deliveryNote } = req.body || {};
  if (!String(name || '').trim()) {
    return sendError(res, 400, 'BAD_REQUEST', 'name is required.');
  }
  const agencyKind = normalizeAdminAgencyKind(type, level);

  const agency = await repo.createAgency({
    type: agencyKind.type,
    level: agencyKind.level,
    parentId: parentId ? Number(parentId) : null,
    name: String(name).trim(),
    loginId: String(loginId || '').trim(),
    address: String(region || '').trim(),
    owner: String(owner || '').trim(),
    phone: String(phone || '').trim(),
    feeRate: Number(feeRate) || 0,
    deliveryNote: String(deliveryNote || '').trim(),
    joinCode: `JOIN-${Date.now()}`
  });

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
  const { name, loginId, type, level, region, owner, phone, feeRate, parentId, deliveryNote, password } = req.body || {};
  if (!Number.isFinite(agencyId)) {
    return sendError(res, 400, 'BAD_REQUEST', 'agency id is required.');
  }
  if (!String(name || '').trim()) {
    return sendError(res, 400, 'BAD_REQUEST', 'name is required.');
  }
  const agencyKind = normalizeAdminAgencyKind(type, level);

  const agency = await repo.updateAgency(agencyId, {
    type: agencyKind.type,
    level: agencyKind.level,
    parentId: parentId ? Number(parentId) : null,
    name: String(name).trim(),
    loginId: String(loginId || '').trim(),
    address: String(region || '').trim(),
    owner: String(owner || '').trim(),
    phone: String(phone || '').trim(),
    feeRate: Number(feeRate) || 0,
    deliveryNote: String(deliveryNote || '').trim()
  });
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }
  const nextPassword = String(password || '').trim();
  if (nextPassword) {
    await repo.updateAgencyPasswordById(agencyId, await hashPassword(nextPassword));
  }

  return res.status(200).json({
    success: true,
    data: {
      ...agency,
      name: displayAgencyName(agency.name)
    }
  });
}));

app.patch('/api/admin/agencies/:id/join-code', authenticateAdmin, asyncHandler(async (req, res) => {
  const agencyId = Number(req.params.id);
  const bodyCode = String(req.body?.joinCode || '').trim();
  if (!Number.isFinite(agencyId)) {
    return sendError(res, 400, 'BAD_REQUEST', 'agency id is required.');
  }
  const joinCode = bodyCode || `JOIN-${agencyId}-${Date.now().toString(36).toUpperCase()}`;
  const agency = await repo.updateAgencyJoinCode(agencyId, joinCode);
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
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

  const agency = await repo.deleteAgency(agencyId);
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }

  return res.status(200).json({
    success: true,
    data: {
      ...agency,
      detachedFranchiseCount: assignedCount
    }
  });
}));

app.get('/api/admin/push/status', authenticateAdmin, asyncHandler(async (req, res) => {
  const email = String(req.query.email || '').trim();
  const summary = await repo.countPushTokenSummary(email ? { email } : {});
  const fcmStatus = getFcmConfigStatus();
  const webPublicKey = String(process.env.WEB_PUSH_PUBLIC_KEY || process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
  const webPrivateKey = String(process.env.WEB_PUSH_PRIVATE_KEY || process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim();
  const targetUser = email ? await repo.findUserByLoginId(email) : null;
  const enabledRows = summary.rows.filter(row => row.enabled);
  const enabledAppRows = enabledRows.filter(row => row.platform !== 'web');
  const enabledWebRows = enabledRows.filter(row => row.platform === 'web');
  return res.status(200).json({
    success: true,
    data: {
      firebase: fcmStatus,
      webPush: {
        configured: Boolean(webPublicKey && webPrivateKey),
        detail: webPublicKey && webPrivateKey ? 'Web Push VAPID keys configured.' : 'Web Push VAPID keys are not configured.'
      },
      tokens: summary.tokens,
      webSubscriptions: summary.webSubscriptions,
      target: email ? {
        found: Boolean(targetUser),
        email,
        userId: targetUser?.id || null,
        franchiseName: targetUser?.franchiseName || targetUser?.name || '',
        enabledTokens: enabledAppRows.length,
        enabledWebSubscriptions: enabledWebRows.length,
        platforms: Array.from(new Set(enabledRows.map(row => row.platform || 'unknown')))
      } : null,
      rows: summary.rows.map(row => ({
        id: row.id,
        userId: row.userId,
        email: row.email,
        name: row.name,
        platform: row.platform,
        enabled: row.enabled,
        token: maskPushToken(row.token),
        updatedAt: row.updatedAt ? formatKstDateTime(row.updatedAt) : '-'
      }))
    }
  });
}));

app.post('/api/admin/push/test', authenticateAdmin, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const title = String(req.body?.title || 'eats PAY 테스트 알림').trim();
  const body = String(req.body?.body || '푸시알림 연결이 정상적으로 동작합니다.').trim();
  const data = {
    targetScreen: String(req.body?.targetScreen || req.body?.screen || 'home').trim() || 'home',
    talkPostId: req.body?.talkPostId || req.body?.postId || undefined,
    talkChatId: req.body?.talkChatId || req.body?.chatId || undefined,
    source: 'admin_push_test',
    requestedBy: req.user.id,
    requestedAt: new Date().toISOString()
  };
  if (!email) {
    return sendError(res, 400, 'BAD_REQUEST', '대상 이메일 또는 로그인 ID를 입력해 주세요.');
  }
  const user = await repo.findUserByLoginId(email);
  if (!user) {
    return sendError(res, 404, 'USER_NOT_FOUND', '대상 사용자를 찾을 수 없습니다.');
  }
  await repo.createNotification({
    userId: user.id,
    type: 'ADMIN_PUSH_TEST',
    title,
    body,
    data
  });
  const push = await sendUserPushNotification(user.id, { title, body, data });
  return res.status(200).json({
    success: true,
    data: {
      notification: { stored: true, title, body },
      push
    }
  });
}));

app.get('/api/delivery-agencies', asyncHandler(async (req, res) => {
  const deliveryAgencies = await repo.listDeliveryAgencies();
  return res.status(200).json({
    success: true,
    data: deliveryAgencies.filter(item => item.status === 'active' || item.status === 'inactive')
  });
}));

app.get('/api/banks', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT code, name, sort_order
     FROM financial_institutions
     WHERE active = true
     ORDER BY sort_order ASC, name ASC`
  );
  return res.status(200).json({
    success: true,
    data: result.rows.map(row => ({
      code: row.code,
      name: row.name,
      sortOrder: row.sort_order
    }))
  });
}));

app.get('/api/weather/current', asyncHandler(async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return sendError(res, 400, 'INVALID_LOCATION', 'latitude and longitude are required.');
  }
  const [region, weather] = await Promise.all([
    resolveKakaoRegion(lat, lng).catch(() => null),
    fetchCurrentWeather(lat, lng)
  ]);
  return res.status(200).json({
    success: true,
    data: {
      location: region?.addressName || [region?.region1, region?.region2, region?.region3].filter(Boolean).join(' ') || '현재 위치',
      region1: region?.region1 || '',
      region2: region?.region2 || '',
      region3: region?.region3 || '',
      latitude: lat,
      longitude: lng,
      ...weather
    }
  });
}));

app.get('/api/delivery-agencies/nearby', asyncHandler(async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
  const [kakaoRegion, kakaoPlaces] = hasLocation
    ? await Promise.all([
      resolveKakaoRegion(lat, lng),
      searchKakaoDeliveryPlaces(lat, lng)
    ])
    : [null, []];
  const naverPlaces = hasLocation ? await searchNaverDeliveryPlaces(kakaoRegion, lat, lng) : [];
  const deliveryAgencies = await repo.listDeliveryAgencies();
  const activeAgencies = deliveryAgencies.filter(item => item.status === 'active' || item.status === 'inactive');
  const dbAgencies = activeAgencies.map(item => {
    const agencyLat = Number(item.latitude);
    const agencyLng = Number(item.longitude);
    const canMeasure = hasLocation && Number.isFinite(agencyLat) && Number.isFinite(agencyLng);
    return {
      ...item,
      source: 'delivery_agencies',
      sourceLabel: '등록 대행사',
      placeUrl: buildKakaoMapUrl(item.name, agencyLat, agencyLng),
      distanceKm: canMeasure ? calculateDistanceKm(lat, lng, agencyLat, agencyLng) : null
    };
  }).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    if (a.distanceKm == null && b.distanceKm != null) return 1;
    if (a.distanceKm != null && b.distanceKm == null) return -1;
    if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
    return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  });
  const locationPlaces = sortPlacesByDistance([...kakaoPlaces, ...naverPlaces]);
  const items = hasLocation && locationPlaces.length
    ? sortPlacesByDistance([...locationPlaces, ...dbAgencies])
    : dbAgencies;
  const nearest = items.find(item => item.distanceKm != null) || items[0] || null;
  return res.status(200).json({
    success: true,
    data: {
      items,
      meta: {
        source: locationPlaces.length ? 'local-search+delivery_agencies' : 'delivery_agencies',
        hasLocation,
        latitude: hasLocation ? lat : null,
        longitude: hasLocation ? lng : null,
        locationAddress: kakaoRegion?.addressName || null,
        locationRegion1: kakaoRegion?.region1 || null,
        locationRegion2: kakaoRegion?.region2 || null,
        locationRegion3: kakaoRegion?.region3 || null,
        kakaoLocalEnabled: !!process.env.KAKAO_REST_API_KEY,
        kakaoPlaceCount: kakaoPlaces.length,
        naverLocalEnabled: !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET),
        naverPlaceCount: naverPlaces.length,
        nearestAgencyName: nearest?.name || null,
        nearestCoverageArea: nearest?.coverageArea || null,
        nearestDistanceKm: nearest?.distanceKm ?? null
      }
    },
    meta: {
      source: locationPlaces.length ? 'local-search+delivery_agencies' : 'delivery_agencies',
      hasLocation,
      latitude: hasLocation ? lat : null,
      longitude: hasLocation ? lng : null,
      locationAddress: kakaoRegion?.addressName || null,
      locationRegion1: kakaoRegion?.region1 || null,
      locationRegion2: kakaoRegion?.region2 || null,
      locationRegion3: kakaoRegion?.region3 || null,
      kakaoLocalEnabled: !!process.env.KAKAO_REST_API_KEY,
      kakaoPlaceCount: kakaoPlaces.length,
      naverLocalEnabled: !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET),
      naverPlaceCount: naverPlaces.length,
      nearestAgencyName: nearest?.name || null,
      nearestCoverageArea: nearest?.coverageArea || null,
      nearestDistanceKm: nearest?.distanceKm ?? null
    }
  });
}));

app.get('/api/benefit-cards/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Number(req.query.limit || 100);
  const cards = await repo.searchBenefitCards(q, limit);
  const items = cards.map(card => ({
    ...card,
    summary: String(card.summary || '')
      .replace(/카드고릴라\s*TOP100\s*기반/gi, '')
      .replace(/카드고릴라\s*TOP100\s*인기\s*카드/gi, '카드 혜택을 확인해보세요.')
      .replace(/카드고릴라\s*순위\s*\d*/gi, '')
      .replace(/카드고릴라\d*/gi, '')
      .replace(/\s*·\s*$/g, '')
      .trim()
  }));
  return res.status(200).json({
    success: true,
    data: {
      sourceUrl: '',
      items
    }
  });
}));

app.post('/api/admin/benefit-cards/cardgorilla/update', authenticateAdmin, asyncHandler(async (req, res) => {
  const result = await updateCardGorillaBenefits({ force: true });
  return res.status(200).json({
    success: true,
    data: result
  });
}));

app.post('/api/admin/delivery-agencies', authenticateAdmin, asyncHandler(async (req, res) => {
  const {
    name,
    status = 'active',
    sortOrder = 0,
    logoUrl = '',
    corporationName = '',
    businessNumber = ''
  } = req.body || {};
  if (!name || !String(name).trim()) {
    return sendError(res, 400, 'MISSING_NAME', 'name is required.');
  }
  const agency = await repo.createDeliveryAgency({
    name: String(name).trim(),
    status,
    sortOrder: Number(sortOrder) || 0,
    logoUrl: String(logoUrl || '').trim(),
    corporationName: String(corporationName || '').trim(),
    businessNumber: String(businessNumber || '').trim()
  });
  return res.status(201).json({ success: true, data: agency });
}));

app.put('/api/admin/delivery-agencies/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const {
    name,
    status = 'active',
    sortOrder = 0,
    logoUrl = '',
    corporationName = '',
    businessNumber = ''
  } = req.body || {};
  if (!name || !String(name).trim()) {
    return sendError(res, 400, 'MISSING_NAME', 'name is required.');
  }
  if (!['active', 'inactive'].includes(status)) {
    return sendError(res, 400, 'INVALID_STATUS', 'status must be active or inactive.');
  }
  const agency = await repo.updateDeliveryAgency(id, {
    name: String(name).trim(),
    status,
    sortOrder: Number(sortOrder) || 0,
    logoUrl: String(logoUrl || '').trim(),
    corporationName: String(corporationName || '').trim(),
    businessNumber: String(businessNumber || '').trim()
  });
  if (!agency) {
    return sendError(res, 404, 'DELIVERY_AGENCY_NOT_FOUND', 'Delivery agency was not found.');
  }
  return res.status(200).json({ success: true, data: agency });
}));

app.post('/api/admin/delivery-agencies/:id/logo', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!req.file) {
    return sendError(res, 400, 'MISSING_FILE', 'file is required.');
  }
  const agencies = await repo.listDeliveryAgencies();
  const currentAgency = agencies.find(item => Number(item.id) === id);
  if (!currentAgency) {
    return sendError(res, 404, 'DELIVERY_AGENCY_NOT_FOUND', 'Delivery agency was not found.');
  }
  const isImage = /^image\//i.test(req.file.mimetype || '') || /\.(png|jpe?g|webp|gif|svg)$/i.test(req.file.originalname || '');
  if (!isImage) {
    return sendError(res, 400, 'INVALID_FILE_TYPE', 'Image file is required.');
  }
  const ext = path.extname(req.file.originalname || '').toLowerCase() || '.png';
  req.file.originalname = `${safeDisplayFileBaseName(currentAgency.name, '배달대행사')}_로고${ext}`;
  const file = await persistUpload(req.file, req.user.id);
  const logoUrl = `/uploads/${encodeURIComponent(file.fileKey)}`;
  const agency = await repo.updateDeliveryAgencyLogo(id, logoUrl);
  if (!agency) {
    return sendError(res, 404, 'DELIVERY_AGENCY_NOT_FOUND', 'Delivery agency was not found.');
  }
  return res.status(200).json({
    success: true,
    data: {
      agencyId: id,
      logoUrl
    }
  });
}));

app.delete('/api/admin/delivery-agencies/:id/logo', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const agencies = await repo.listDeliveryAgencies();
  const currentAgency = agencies.find(item => Number(item.id) === id);
  if (!currentAgency) {
    return sendError(res, 404, 'DELIVERY_AGENCY_NOT_FOUND', 'Delivery agency was not found.');
  }
  const deletedFile = await deleteManagedLogoFile(currentAgency.logoUrl);
  const agency = await repo.updateDeliveryAgencyLogo(id, '');
  if (!agency) {
    return sendError(res, 404, 'DELIVERY_AGENCY_NOT_FOUND', 'Delivery agency was not found.');
  }
  return res.status(200).json({
    success: true,
    data: {
      agencyId: id,
      logoUrl: '',
      deletedFile
    }
  });
}));

app.post('/api/admin/delivery-agencies/:id/business-file', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!req.file) {
    return sendError(res, 400, 'MISSING_FILE', 'file is required.');
  }
  const agencies = await repo.listDeliveryAgencies();
  const currentAgency = agencies.find(item => Number(item.id) === id);
  if (!currentAgency) {
    return sendError(res, 404, 'DELIVERY_AGENCY_NOT_FOUND', 'Delivery agency was not found.');
  }
  const isAllowed = /^image\//i.test(req.file.mimetype || '')
    || req.file.mimetype === 'application/pdf'
    || /\.(png|jpe?g|gif|webp|pdf)$/i.test(req.file.originalname || '');
  if (!isAllowed) {
    return sendError(res, 400, 'INVALID_FILE_TYPE', '사업자등록증은 PDF 또는 이미지 파일만 업로드할 수 있습니다.');
  }
  req.file.originalname = deliveryAgencyBusinessOriginalName(currentAgency.name, uploadExtension(req.file.originalname, req.file.mimetype));
  const file = await persistUpload(req.file, req.user.id);
  const agency = await repo.updateDeliveryAgencyBusinessFile(id, file.fileKey);
  if (!agency) {
    return sendError(res, 404, 'DELIVERY_AGENCY_NOT_FOUND', 'Delivery agency was not found.');
  }
  return res.status(200).json({
    success: true,
    data: {
      agencyId: id,
      businessFile: file.fileKey,
      businessFileName: file.originalName,
      url: `/uploads/${encodeURIComponent(file.fileKey)}`
    }
  });
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
  const email = String(req.body?.loginId || req.body?.email || '').trim();
  const { action } = req.body;
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
    data: { email: user.loginId, loginId: user.loginId, role: user.role }
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

app.patch('/api/admin/accounts/:id/hidden', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const source = String(req.query.source || req.body.source || 'account_request');
  if (typeof req.body.hidden !== 'boolean') {
    return sendError(res, 400, 'BAD_REQUEST', 'hidden must be boolean.');
  }

  const visibility = { active: !req.body.hidden, hidden: req.body.hidden };
  let updated;
  if (source === 'delivery_account') {
    if (/^\d+$/.test(id)) {
      updated = await repo.updateDeliveryAccountVisibility(Number(id), visibility);
    }
    if (!updated) {
      updated = await repo.updateAccountRequestVisibility(id, visibility);
    }
  } else {
    updated = await repo.updateAccountRequestVisibility(id, visibility);
    if (!updated && /^\d+$/.test(id)) {
      updated = await repo.updateDeliveryAccountVisibility(Number(id), visibility);
    }
  }

  if (!updated) {
    return sendError(res, 404, 'ACCOUNT_NOT_FOUND', '출금계좌를 DB에서 찾지 못했습니다.');
  }

  return res.status(200).json({
    success: true,
    message: req.body.hidden ? 'Account hidden.' : 'Account shown.',
    data: updated
  });
}));

app.delete('/api/admin/accounts/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const source = String(req.query.source || 'account_request');
  let hiddenAccount;
  if (source === 'delivery_account') {
    if (!/^\d+$/.test(id)) {
      hiddenAccount = await repo.updateAccountRequestVisibility(id, { active: false, hidden: true });
    } else {
      hiddenAccount = await repo.updateDeliveryAccountVisibility(Number(id), { active: false, hidden: true });
      if (!hiddenAccount) {
        hiddenAccount = await repo.updateAccountRequestVisibility(id, { active: false, hidden: true });
      }
    }
  } else {
    hiddenAccount = await repo.updateAccountRequestVisibility(id, { active: false, hidden: true });
    if (!hiddenAccount && /^\d+$/.test(id)) {
      hiddenAccount = await repo.updateDeliveryAccountVisibility(Number(id), { active: false, hidden: true });
    }
  }

  if (!hiddenAccount) {
    return sendError(res, 404, 'ACCOUNT_NOT_FOUND', '숨김 처리할 출금계좌를 DB에서 찾지 못했습니다.');
  }

  return res.status(200).json({
    success: true,
    message: 'Account hidden.',
    data: { id, source }
  });
}));

async function fetchCardGorillaRankingPayload() {
  if (!CARDGORILLA_RANKING_URL) {
    throw new Error('CARDGORILLA_RANKING_URL is not configured.');
  }
  const response = await fetch(CARDGORILLA_RANKING_URL, {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: 'https://www.card-gorilla.com/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    }
  });
  if (!response.ok) {
    throw new Error(`CARDGORILLA_FETCH_FAILED ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    const contentType = response.headers.get('content-type') || '';
    throw new Error(`CARDGORILLA_NON_JSON_RESPONSE ${contentType} ${text.slice(0, 80)}`);
  }
}

async function updateCardGorillaBenefits({ force = false } = {}) {
  if (!CARDGORILLA_RANKING_URL && !force) {
    return { skipped: true, reason: 'CARDGORILLA_RANKING_URL is not configured.' };
  }
  const payload = await fetchCardGorillaRankingPayload();
  const cards = parseCardGorillaRanking(payload);
  if (!cards.length) {
    throw new Error('CARDGORILLA_EMPTY_RESULT');
  }
  const result = await repo.upsertBenefitCardsFromCardGorilla(cards);
  return {
    skipped: false,
    imported: result.imported,
    firstCard: `${cards[0].cardCompany} ${cards[0].cardName}`,
    updatedAt: new Date().toISOString()
  };
}

function getDelayUntilNextKstHour(hour) {
  const safeHour = Math.min(Math.max(Number(hour) || 6, 0), 23);
  const now = Date.now();
  const kstNow = new Date(now + 9 * 60 * 60 * 1000);
  let targetUtcMs = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate(),
    safeHour,
    0,
    0,
    0
  ) - 9 * 60 * 60 * 1000;
  if (targetUtcMs <= now) targetUtcMs += 24 * 60 * 60 * 1000;
  return targetUtcMs - now;
}

function scheduleCardGorillaDailyUpdate() {
  const run = async () => {
    try {
      const result = await updateCardGorillaBenefits();
      if (result.skipped) {
        console.warn(`[cardgorilla] daily update skipped: ${result.reason}`);
      } else {
        console.log(`[cardgorilla] daily update imported=${result.imported}`);
      }
    } catch (err) {
      console.error('[cardgorilla] daily update failed:', err.message);
    }
  };

  const delay = getDelayUntilNextKstHour(CARDGORILLA_UPDATE_HOUR_KST);
  setTimeout(() => {
    void run();
    setInterval(() => void run(), 24 * 60 * 60 * 1000);
  }, delay);
  console.log(`[cardgorilla] next daily update scheduled in ${Math.round(delay / 60000)} minutes (KST ${CARDGORILLA_UPDATE_HOUR_KST}:00)`);
}

app.use((err, req, res, next) => {
  handleError(err, res);
});

if (require.main === module) {
  dbBootstrapPromise
    .then(() => {
      scheduleCardGorillaDailyUpdate();
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
        return sendError(res, 415, 'INVALID_FILE_FORMAT', '허용되지 않는 파일 형식입니다. PDF, JPG, JPEG, PNG, GIF, WEBP, XLS, XLSX 파일만 업로드할 수 있습니다.');
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 413, 'FILE_SIZE_LIMIT_EXCEEDED', '첨부 파일은 10MB 이하만 업로드할 수 있습니다.');
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
        return sendError(res, 415, 'INVALID_FILE_FORMAT', '허용되지 않는 파일 형식입니다. PDF, JPG, JPEG, PNG, GIF, WEBP, XLS, XLSX 파일만 업로드할 수 있습니다.');
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 413, 'FILE_SIZE_LIMIT_EXCEEDED', '첨부 파일은 10MB 이하만 업로드할 수 있습니다.');
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return sendError(res, 400, 'TOO_MANY_FILES', '첨부 파일 개수를 확인해 주세요.');
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
  if (err.publicMessage) {
    return sendError(res, err.statusCode || 500, err.message || 'PROVIDER_ERROR', err.publicMessage);
  }
  if (err.code === '23505') {
    return sendError(res, 409, 'ALREADY_EXISTS', 'Unique constraint conflict.');
  }
  if (err.code === 'FRANCHISE_NOT_FOUND') {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', 'Franchise was not found.');
  }
  if (err.code === 'FRANCHISE_HAS_TRANSACTIONS') {
    return sendError(res, 409, 'FRANCHISE_HAS_TRANSACTIONS', '결제 내역이 있는 가맹점은 삭제할 수 없습니다.');
  }
  if (err.code === 'INSUFFICIENT_BALANCE') {
    return sendError(res, 400, 'INSUFFICIENT_BALANCE', 'Insufficient balance for rollback.');
  }
  console.error(err);
  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Unexpected server error.');
}

function calculateDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = value => Number(value) * Math.PI / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round((earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) * 10) / 10;
}

function buildKakaoMapUrl(name, lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return '';
  const label = encodeURIComponent(String(name || '배달대행사'));
  return `https://map.kakao.com/link/map/${label},${lat},${lng}`;
}

function buildKakaoSearchUrl(name, address = '') {
  const query = [name, address].filter(Boolean).join(' ');
  if (!query) return '';
  return `https://map.kakao.com/link/search/${encodeURIComponent(query)}`;
}

async function resolveKakaoRegion(lat, lng) {
  const restApiKey = String(process.env.KAKAO_REST_API_KEY || '').trim();
  if (!restApiKey) return null;
  try {
    const url = new URL('https://dapi.kakao.com/v2/local/geo/coord2regioncode.json');
    url.searchParams.set('x', String(lng));
    url.searchParams.set('y', String(lat));
    url.searchParams.set('input_coord', 'WGS84');
    const response = await fetch(url, { headers: { Authorization: `KakaoAK ${restApiKey}` } });
    if (!response.ok) {
      console.warn('[kakao-local] coord2regioncode failed:', response.status);
      return null;
    }
    const payload = await response.json().catch(() => null);
    const documents = Array.isArray(payload?.documents) ? payload.documents : [];
    const region = documents.find(item => item.region_type === 'H') || documents[0];
    if (!region) return null;
    const addressName = [region.region_1depth_name, region.region_2depth_name, region.region_3depth_name]
      .filter(Boolean)
      .join(' ');
    return {
      addressName,
      region1: region.region_1depth_name || '',
      region2: region.region_2depth_name || '',
      region3: region.region_3depth_name || '',
      raw: region
    };
  } catch (err) {
    console.warn('[kakao-local] coord2regioncode error:', err.message);
    return null;
  }
}

function weatherCodeLabel(code) {
  const labels = {
    0: '맑음',
    1: '대체로 맑음',
    2: '구름 조금',
    3: '흐림',
    45: '안개',
    48: '서리 안개',
    51: '약한 이슬비',
    53: '이슬비',
    55: '강한 이슬비',
    61: '약한 비',
    63: '비',
    65: '강한 비',
    71: '약한 눈',
    73: '눈',
    75: '강한 눈',
    80: '약한 소나기',
    81: '소나기',
    82: '강한 소나기',
    95: '뇌우',
    96: '우박 동반 뇌우',
    99: '강한 우박 동반 뇌우'
  };
  return labels[Number(code)] || '날씨 확인 중';
}

function weatherCodeIcon(code, isDay = 1) {
  const numericCode = Number(code);
  if ([0, 1].includes(numericCode)) return Number(isDay) === 1 ? '☀' : '☾';
  if ([2, 3].includes(numericCode)) return '☁';
  if ([45, 48].includes(numericCode)) return '≋';
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(numericCode)) return '☔';
  if ([71, 73, 75].includes(numericCode)) return '❄';
  if ([95, 96, 99].includes(numericCode)) return '⚡';
  return '⛅';
}

async function fetchCurrentWeather(lat, lng) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day');
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max');
  url.searchParams.set('timezone', 'Asia/Seoul');
  url.searchParams.set('forecast_days', '7');
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'eats-pay-weather/1.0'
    }
  });
  if (!response.ok) {
    throw Object.assign(new Error('WEATHER_FETCH_FAILED'), {
      statusCode: 502,
      publicMessage: '날씨 정보를 가져오지 못했습니다.'
    });
  }
  const payload = await response.json().catch(() => null);
  const current = payload?.current || {};
  const daily = payload?.daily || {};
  const code = current.weather_code;
  const forecast = Array.isArray(daily.time) ? daily.time.map((date, index) => {
    const dailyCode = daily.weather_code?.[index];
    return {
      date,
      weatherCode: Number.isFinite(Number(dailyCode)) ? Number(dailyCode) : null,
      weatherLabel: weatherCodeLabel(dailyCode),
      weatherIcon: weatherCodeIcon(dailyCode, 1),
      minTemperature: Number.isFinite(Number(daily.temperature_2m_min?.[index])) ? Number(daily.temperature_2m_min[index]) : null,
      maxTemperature: Number.isFinite(Number(daily.temperature_2m_max?.[index])) ? Number(daily.temperature_2m_max[index]) : null,
      precipitationProbability: Number.isFinite(Number(daily.precipitation_probability_max?.[index])) ? Number(daily.precipitation_probability_max[index]) : null,
      windSpeed: Number.isFinite(Number(daily.wind_speed_10m_max?.[index])) ? Number(daily.wind_speed_10m_max[index]) : null
    };
  }) : [];
  return {
    provider: 'Open-Meteo',
    time: current.time || '',
    temperature: Number.isFinite(Number(current.temperature_2m)) ? Number(current.temperature_2m) : null,
    apparentTemperature: Number.isFinite(Number(current.apparent_temperature)) ? Number(current.apparent_temperature) : null,
    precipitation: Number.isFinite(Number(current.precipitation)) ? Number(current.precipitation) : null,
    windSpeed: Number.isFinite(Number(current.wind_speed_10m)) ? Number(current.wind_speed_10m) : null,
    weatherCode: Number.isFinite(Number(code)) ? Number(code) : null,
    weatherLabel: weatherCodeLabel(code),
    weatherIcon: weatherCodeIcon(code, current.is_day),
    forecast
  };
}

async function resolveKakaoAddressCoordinate(address) {
  const restApiKey = String(process.env.KAKAO_REST_API_KEY || '').trim();
  const query = String(address || '').trim();
  if (!restApiKey || !query) return null;
  try {
    const url = new URL('https://dapi.kakao.com/v2/local/search/address.json');
    url.searchParams.set('query', query);
    url.searchParams.set('size', '1');
    const response = await fetch(url, { headers: { Authorization: `KakaoAK ${restApiKey}` } });
    if (!response.ok) {
      console.warn('[kakao-local] address search failed:', response.status);
      return null;
    }
    const payload = await response.json().catch(() => null);
    const item = Array.isArray(payload?.documents) ? payload.documents[0] : null;
    const lat = Number(item?.y);
    const lng = Number(item?.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (err) {
    console.warn('[kakao-local] address search error:', err.message);
    return null;
  }
}

async function resolveKakaoPlaceUrl(name, address = '', coordinate = null) {
  const restApiKey = String(process.env.KAKAO_REST_API_KEY || '').trim();
  const cleanName = String(name || '').trim();
  if (!restApiKey || !cleanName) return '';
  const nameVariants = [
    cleanName,
    ...cleanName.split(/[\/,]/).map(part => part.trim()),
    cleanName.replace(/지사$/g, '').trim(),
    cleanName.replace(/점$/g, '').trim()
  ].filter(Boolean);
  const queries = [
    ...nameVariants.map(value => [value, address].filter(Boolean).join(' ')),
    ...nameVariants
  ].filter(Boolean);
  for (const query of [...new Set(queries)]) {
    try {
      const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
      url.searchParams.set('query', query);
      url.searchParams.set('size', '1');
      if (coordinate?.lat && coordinate?.lng) {
        url.searchParams.set('x', String(coordinate.lng));
        url.searchParams.set('y', String(coordinate.lat));
        url.searchParams.set('radius', '5000');
        url.searchParams.set('sort', 'distance');
      }
      const response = await fetch(url, { headers: { Authorization: `KakaoAK ${restApiKey}` } });
      if (!response.ok) {
        console.warn('[kakao-local] place url search failed:', response.status);
        continue;
      }
      const payload = await response.json().catch(() => null);
      const item = Array.isArray(payload?.documents) ? payload.documents[0] : null;
      if (item?.place_url) return item.place_url;
    } catch (err) {
      console.warn('[kakao-local] place url search error:', err.message);
    }
  }
  return '';
}

async function searchKakaoDeliveryPlaces(lat, lng) {
  const restApiKey = String(process.env.KAKAO_REST_API_KEY || '').trim();
  if (!restApiKey || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const queries = ['배달대행', '배달대행사'];
  const excludedKeywords = ['퀵', '퀵서비스', '대리운전'];
  const seen = new Set();
  const places = [];
  for (const query of queries) {
    try {
      const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
      url.searchParams.set('query', query);
      url.searchParams.set('x', String(lng));
      url.searchParams.set('y', String(lat));
      url.searchParams.set('radius', '20000');
      url.searchParams.set('sort', 'distance');
      url.searchParams.set('size', '15');
      const response = await fetch(url, { headers: { Authorization: `KakaoAK ${restApiKey}` } });
      if (!response.ok) {
        console.warn('[kakao-local] keyword search failed:', query, response.status);
        continue;
      }
      const payload = await response.json().catch(() => null);
      const documents = Array.isArray(payload?.documents) ? payload.documents : [];
      for (const item of documents) {
        const placeId = String(item.id || `${item.place_name}-${item.x}-${item.y}`);
        if (seen.has(placeId)) continue;
        const searchableText = [item.place_name, item.category_name, item.address_name, item.road_address_name]
          .filter(Boolean)
          .join(' ');
        if (excludedKeywords.some(keyword => searchableText.includes(keyword))) continue;
        seen.add(placeId);
        const placeLat = Number(item.y);
        const placeLng = Number(item.x);
        const distanceMeters = Number(item.distance);
        const distanceKm = Number.isFinite(distanceMeters)
          ? Math.round((distanceMeters / 1000) * 10) / 10
          : Number.isFinite(placeLat) && Number.isFinite(placeLng)
            ? calculateDistanceKm(lat, lng, placeLat, placeLng)
            : null;
        const phone = item.phone || await searchNaverPhoneForPlace(
          item.place_name || '',
          item.road_address_name || item.address_name || ''
        );
        places.push({
          id: `kakao-${placeId}`,
          name: item.place_name || '배달대행사',
          status: 'active',
          source: 'kakao-local',
          sourceLabel: '배달대행사',
          sortOrder: 0,
          latitude: Number.isFinite(placeLat) ? placeLat : null,
          longitude: Number.isFinite(placeLng) ? placeLng : null,
          coverageArea: item.road_address_name || item.address_name || '현재 위치 주변',
          phone,
          description: item.category_name || '현재 위치 기준으로 검색된 주변 배달대행 후보입니다.',
          placeUrl: item.place_url || buildKakaoMapUrl(item.place_name || '배달대행사', placeLat, placeLng) || '',
          distanceKm
        });
      }
    } catch (err) {
      console.warn('[kakao-local] keyword search error:', query, err.message);
    }
  }
  return places
    .sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm != null) return 1;
      if (a.distanceKm != null && b.distanceKm == null) return -1;
      if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    })
    .slice(0, 30);
}

function stripNaverHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function normalizePhoneCandidate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/[^\d-]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 12) return '';
  if (digits === '0123456789' || digits === '01012345678' || /^(\d)\1+$/.test(digits)) return '';
  const validPrefix = (
    (digits.startsWith('02') && (digits.length === 9 || digits.length === 10))
    || (/^0[3-6]\d/.test(digits) && (digits.length === 10 || digits.length === 11))
    || (/^050\d/.test(digits) && (digits.length === 11 || digits.length === 12))
    || (/^0(?:70|80)/.test(digits) && (digits.length === 10 || digits.length === 11))
    || (/^01(?:0|1|6|7|8|9)/.test(digits) && (digits.length === 10 || digits.length === 11))
    || (/^(?:15|16|18)\d{6}$/.test(digits))
  );
  if (!validPrefix) return '';
  return cleaned;
}

function extractPhoneFromText(text) {
  const source = stripNaverHtml(String(text || '').replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>'));
  const patterns = [
    /(?:대표번호|전화번호|전화|연락처)\s*[:：]?\s*((?:0\d{1,2}|050\d|070|080|15\d{2}|16\d{2}|18\d{2})[-.\s]?\d{3,4}[-.\s]?\d{4})/g,
    /((?:0\d{1,2}|050\d|070|080)[-.\s]?\d{3,4}[-.\s]?\d{4})/g,
    /((?:15\d{2}|16\d{2}|18\d{2})[-.\s]?\d{4})/g
  ];
  for (const pattern of patterns) {
    const matches = [...source.matchAll(pattern)];
    for (const match of matches) {
      const phone = normalizePhoneCandidate(match[1] || match[0]);
      if (phone) return phone;
    }
  }
  return '';
}

async function searchNaverWebPhoneForPlace(name, address = '') {
  const cleanName = String(name || '').trim();
  if (!cleanName) return '';
  const queries = [
    `${cleanName} ${address} 전화번호`,
    `${cleanName} 네이버 플레이스 전화번호`,
    `${cleanName} 연락처`
  ].filter(Boolean);
  for (const query of [...new Set(queries)]) {
    try {
      const url = new URL('https://search.naver.com/search.naver');
      url.searchParams.set('where', 'nexearch');
      url.searchParams.set('query', query);
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9'
        }
      });
      if (!response.ok) continue;
      const html = await response.text();
      const phone = extractPhoneFromText(html);
      if (phone) return phone;
    } catch (err) {
      console.warn('[naver-search] phone scrape error:', err.message);
    }
  }
  return '';
}

async function searchNaverPhoneForPlace(name, address = '') {
  const clientId = String(process.env.NAVER_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.NAVER_CLIENT_SECRET || '').trim();
  const cleanName = String(name || '').trim();
  if (!cleanName) return '';
  const queries = [[cleanName, address].filter(Boolean).join(' '), cleanName].filter(Boolean);
  if (clientId && clientSecret) {
    for (const query of [...new Set(queries)]) {
      try {
        const url = new URL('https://openapi.naver.com/v1/search/local.json');
        url.searchParams.set('query', query);
        url.searchParams.set('display', '3');
        url.searchParams.set('start', '1');
        url.searchParams.set('sort', 'random');
        const response = await fetch(url, {
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret
          }
        });
        if (!response.ok) continue;
        const payload = await response.json().catch(() => null);
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const matched = items.find(item => {
          const title = stripNaverHtml(item.title);
          const roadAddress = stripNaverHtml(item.roadAddress || item.address);
          const titleMatches = title && (title.includes(cleanName) || cleanName.includes(title));
          const addressMatches = !address || !roadAddress || roadAddress.includes(String(address).split(' ').slice(0, 3).join(' '));
          return titleMatches || addressMatches;
        }) || items[0];
        const phone = normalizePhoneCandidate(stripNaverHtml(matched?.telephone));
        if (phone) return phone;
      } catch (err) {
        console.warn('[naver-local] phone lookup error:', err.message);
      }
    }
  }
  return searchNaverWebPhoneForPlace(cleanName, address);
}

function buildNaverDeliveryQueries(kakaoRegion) {
  const region1 = String(kakaoRegion?.region1 || '').trim();
  const region2 = String(kakaoRegion?.region2 || '').trim();
  const region3 = String(kakaoRegion?.region3 || '').trim();
  const compactRegion1 = region1.replace(/광역시|특별시|특별자치시|특별자치도|도$/g, '').trim();
  const areas = [
    [compactRegion1, region2, region3].filter(Boolean).join(' '),
    [compactRegion1, region2].filter(Boolean).join(' '),
    [region1, region2].filter(Boolean).join(' ')
  ].filter(Boolean);
  const uniqueAreas = [...new Set(areas)];
  return [...new Set(uniqueAreas.flatMap(area => [`${area} 배달대행`, `${area} 배달대행사`]))];
}

async function searchNaverDeliveryPlaces(kakaoRegion, originLat, originLng) {
  const clientId = String(process.env.NAVER_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.NAVER_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret || !kakaoRegion) return [];
  const queries = buildNaverDeliveryQueries(kakaoRegion);
  const excludedKeywords = ['퀵', '퀵서비스', '대리운전'];
  const seen = new Set();
  const places = [];
  for (const query of queries) {
    try {
      const url = new URL('https://openapi.naver.com/v1/search/local.json');
      url.searchParams.set('query', query);
      url.searchParams.set('display', '5');
      url.searchParams.set('start', '1');
      url.searchParams.set('sort', 'random');
      const response = await fetch(url, {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret
        }
      });
      if (!response.ok) {
        console.warn('[naver-local] local search failed:', query, response.status);
        continue;
      }
      const payload = await response.json().catch(() => null);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      for (const item of items) {
        const name = stripNaverHtml(item.title);
        const category = stripNaverHtml(item.category);
        const address = stripNaverHtml(item.roadAddress || item.address);
        const phone = normalizePhoneCandidate(stripNaverHtml(item.telephone))
          || await searchNaverWebPhoneForPlace(name, address);
        const searchableText = [name, category, address].filter(Boolean).join(' ');
        if (!name || excludedKeywords.some(keyword => searchableText.includes(keyword))) continue;
        const placeKey = `${name}|${address}`;
        if (seen.has(placeKey)) continue;
        seen.add(placeKey);
        const coordinate = await resolveKakaoAddressCoordinate(address);
        const distanceKm = coordinate ? calculateDistanceKm(originLat, originLng, coordinate.lat, coordinate.lng) : null;
        const kakaoPlaceUrl = await resolveKakaoPlaceUrl(name, address, coordinate);
        places.push({
          id: `naver-${Buffer.from(placeKey).toString('base64url').slice(0, 24)}`,
          name,
          status: 'active',
          source: 'naver-local',
          sourceLabel: '배달대행사',
          sortOrder: 5,
          latitude: coordinate?.lat ?? null,
          longitude: coordinate?.lng ?? null,
          coverageArea: address || kakaoRegion.addressName || '현재 위치 주변',
          phone,
          description: category || '네이버 지역검색에서 확인된 주변 배달대행 후보입니다.',
          placeUrl: kakaoPlaceUrl || buildKakaoSearchUrl(name, address) || (coordinate ? buildKakaoMapUrl(name, coordinate.lat, coordinate.lng) : ''),
          distanceKm
        });
      }
    } catch (err) {
      console.warn('[naver-local] local search error:', query, err.message);
    }
  }
  return places.slice(0, 20);
}

function sortPlacesByDistance(places = []) {
  return [...places].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    if (a.distanceKm == null && b.distanceKm != null) return 1;
    if (a.distanceKm != null && b.distanceKm == null) return -1;
    if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
    return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  });
}

function buildFallbackDeliveryAgencies(originLat, originLng) {
  const hasLocation = Number.isFinite(Number(originLat)) && Number.isFinite(Number(originLng));
  const seeds = [
    { name: '생각대로 인천', coverageArea: '인천 남동구', latitude: 37.4563, longitude: 126.7052, phone: '1566-3558', description: '인천권 배달대행 상담 가능' },
    { name: '만나플러스 인천', coverageArea: '인천 미추홀구', latitude: 37.4638, longitude: 126.6503, phone: '1566-3558', description: '가맹점 배달대행 연결 상담 가능' },
    { name: '딜버 인천', coverageArea: '인천 부평구', latitude: 37.5070, longitude: 126.7218, phone: '1566-3558', description: '주변 권역 배달대행 상담 가능' },
    { name: '리드콜 인천', coverageArea: '인천 연수구', latitude: 37.4100, longitude: 126.6783, phone: '1566-3558', description: '인천 남부권 배달대행 상담 가능' },
    { name: '모아라인 인천', coverageArea: '인천 서구', latitude: 37.5455, longitude: 126.6759, phone: '1566-3558', description: '인천 서북권 배달대행 상담 가능' }
  ];
  return seeds.map((item, index) => ({
    id: `fallback-${index + 1}`,
    ...item,
    source: 'delivery_agencies',
    status: 'active',
    sortOrder: index + 1,
    placeUrl: buildKakaoMapUrl(item.name, item.latitude, item.longitude),
    distanceKm: hasLocation ? calculateDistanceKm(Number(originLat), Number(originLng), item.latitude, item.longitude) : null
  }));
}

function enrichAdminFranchiseDisplay(franchise, index = 0, paymentRows = []) {
  const enriched = { ...franchise };
  const ownPayments = paymentRows
    .filter(payment => String(payment.franchiseId || '') === String(enriched.id || '') || String(payment.franchise || '') === String(enriched.name || ''))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const latestPayment = ownPayments[0] || null;
  const usablePaymentCards = ownPayments.filter(payment => payment.cardCompany && !['카드', '등록카드'].includes(String(payment.cardCompany).trim()));
  const paymentCard = usablePaymentCards[0] || null;
  const storedCardName = String(enriched.cardCompany || '').trim();
  const hasRealStoredCard = Boolean(storedCardName && !['카드', '등록카드'].includes(storedCardName));
  const hasCard = Boolean(enriched.cardRegistered || hasRealStoredCard || enriched.cardLast4 || paymentCard);

  if (hasCard) {
    enriched.cardRegistered = true;
    enriched.cardCompany = hasRealStoredCard ? storedCardName : paymentCard?.cardCompany || enriched.cardCompany || '';
    enriched.cardLast4 = enriched.cardLast4 || String(paymentCard?.maskedNumber || '').slice(-4).replace(/[^0-9]/g, '');
    enriched.cardRegisteredDate = enriched.cardRegisteredDate || enriched.joinDate || formatDate(new Date());
  } else {
    enriched.cardRegistered = false;
    enriched.cardCompany = '';
    enriched.cardLast4 = '';
  }
  if (!enriched.lastPaymentDate) {
    if (latestPayment?.date) {
      enriched.lastPaymentDate = String(latestPayment.date).slice(0, 10);
    }
  }
  if (Array.isArray(enriched.cardList)) {
    enriched.cardList = enriched.cardList.map(card => {
      const cardLast4 = String(card.cardLast4 || card.maskedNumber || '').replace(/[^0-9]/g, '').slice(-4);
      const cardCompany = String(card.cardCompany || card.cardName || '').trim();
      const matchedPayment = ownPayments.find(payment => (
        cardLast4 && String(payment.cardLast4 || payment.maskedNumber || '').replace(/[^0-9]/g, '').slice(-4) === cardLast4
      )) || ownPayments.find(payment => (
        cardCompany && String(payment.cardCompany || '').includes(cardCompany)
      ));
      return {
        ...card,
        lastPaymentDate: matchedPayment?.date ? String(matchedPayment.date).slice(0, 10) : (card.lastPaymentDate || '')
      };
    });
    for (const payment of usablePaymentCards) {
      const paymentLast4 = String(payment.cardLast4 || payment.maskedNumber || '').replace(/[^0-9]/g, '').slice(-4);
      if (!paymentLast4) continue;
      const alreadyExists = enriched.cardList.some(card => {
        const cardLast4 = String(card.cardLast4 || card.maskedNumber || '').replace(/[^0-9]/g, '').slice(-4);
        return cardLast4 && cardLast4 === paymentLast4;
      });
      if (alreadyExists) continue;
      enriched.cardList.push({
        id: `payment:${payment.approvalNo || payment.id || paymentLast4}`,
        cardCompany: payment.cardCompany,
        cardName: payment.cardCompany,
        alias: '',
        active: true,
        hidden: false,
        maskedNumber: payment.maskedNumber || `****-****-****-${paymentLast4}`,
        cardLast4: paymentLast4,
        createdAt: payment.date || '',
        registeredDate: payment.date ? String(payment.date).slice(0, 10) : '',
        lastPaymentDate: payment.date ? String(payment.date).slice(0, 10) : ''
      });
    }
  }
  enriched.realPaymentCount = ownPayments.length;
  enriched.paymentCount = Number(enriched.paymentCount || ownPayments.length || 0);
  return enriched;
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

async function optionalAuthenticate(req, res, next) {
  try {
    req.user = await userFromRequest(req);
  } catch (_) {
    req.user = null;
  }
  return next();
}

async function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (process.env.NODE_ENV !== 'production' && ['Bearer mocked_admin_token', 'Bearer dev-admin-token'].includes(authHeader)) {
    req.user = { id: 0, role: 'ADMIN', email: 'mocked-admin', adminLevel: 'SUPER', adminActive: true };
    return next();
  }
  await authenticate(req, res, () => {
    if (req.user.role !== 'ADMIN') {
      return sendError(res, 403, 'ACCESS_DENIED', 'Admin role is required.');
    }
    if (req.user.adminActive === false) {
      return sendError(res, 403, 'ADMIN_DISABLED', '비활성화된 관리자 계정입니다.');
    }
    return next();
  });
}

async function authenticateAdminOrAgency(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (process.env.NODE_ENV !== 'production' && ['Bearer mocked_admin_token', 'Bearer dev-admin-token'].includes(authHeader)) {
    req.user = { id: 0, role: 'ADMIN', email: 'mocked-admin', adminLevel: 'SUPER', adminActive: true };
    return next();
  }
  await authenticate(req, res, () => {
    if (!['ADMIN', 'AGENCY'].includes(req.user.role)) {
      return sendError(res, 403, 'ACCESS_DENIED', 'Admin or agency role is required.');
    }
    if (req.user.role === 'ADMIN' && req.user.adminActive === false) {
      return sendError(res, 403, 'ADMIN_DISABLED', '비활성화된 관리자 계정입니다.');
    }
    return next();
  });
}

function agencyScopeIds(agencies = [], rootAgencyId) {
  const rootId = String(rootAgencyId || '');
  if (!rootId) return new Set();
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const agency of agencies) {
      const id = String(agency.id || '');
      const parentId = String(agency.parentId || '');
      if (id && parentId && ids.has(parentId) && !ids.has(id)) {
        ids.add(id);
        changed = true;
      }
    }
  }
  return ids;
}

function requireSuperAdmin(req, res, next) {
  if (normalizeAdminLevel(req.user?.adminLevel) !== 'SUPER') {
    return sendError(res, 403, 'ACCESS_DENIED', '총괄 관리자 권한이 필요합니다.');
  }
  return next();
}

async function userFromRequest(req) {
  const authHeader = req.headers.authorization;
  const cookieToken = getCookieValue(req, 'eatspay_access_token');
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : cookieToken;
  if (!token) return null;
  const payload = verifyToken(token);
  if (payload.role === 'AGENCY') {
    return repo.findAgencyAuthById(payload.sub);
  }
  return repo.findUserById(payload.sub);
}

function getCookieValue(req, name) {
  const cookieHeader = String(req.headers.cookie || '');
  if (!cookieHeader) return '';
  const target = `${name}=`;
  const parts = cookieHeader.split(';').map(part => part.trim());
  const found = parts.find(part => part.startsWith(target));
  return found ? decodeURIComponent(found.slice(target.length)) : '';
}

function buildAuthCookie(req, token) {
  const host = String(req.headers.host || '').split(':')[0];
  const domain = host === 'eatspay.kr' || host.endsWith('.eatspay.kr') ? '; Domain=.eatspay.kr' : '';
  const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `eatspay_access_token=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; SameSite=Lax${secure}${domain}`;
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

function normalizePhoneNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function hashSmsCode(phone, code) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(`${normalizePhoneNumber(phone)}:${String(code || '')}`)
    .digest('hex');
}

function isAligoConfigured() {
  return Boolean(ALIGO_API_KEY && ALIGO_USER_ID && ALIGO_SENDER);
}

function isSmsVerified(phone) {
  const normalized = normalizePhoneNumber(phone);
  const entry = smsVerificationStore.get(normalized);
  return Boolean(entry?.verifiedAt && Date.now() <= entry.expiresAt);
}

async function sendAligoSms(receiver, message) {
  if (!isAligoConfigured()) {
    throw Object.assign(new Error('ALIGO_CONFIG_MISSING'), {
      statusCode: 500,
      publicMessage: '알리고 SMS 설정이 누락되었습니다. API 키, 사용자 ID, 발신번호를 확인해 주세요.'
    });
  }

  const form = new URLSearchParams({
    key: ALIGO_API_KEY,
    user_id: ALIGO_USER_ID,
    sender: ALIGO_SENDER,
    receiver: normalizePhoneNumber(receiver),
    msg: message,
    msg_type: 'SMS'
  });
  const response = await fetch(ALIGO_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form
  });
  const payload = await response.json().catch(() => ({}));
  const resultCode = String(payload.result_code || payload.resultCode || '');
  if (!response.ok || resultCode !== '1') {
    console.error('[ALIGO_SMS_FAILED]', {
      status: response.status,
      resultCode,
      message: payload.message || payload.msg || ''
    });
    throw Object.assign(new Error('ALIGO_SMS_FAILED'), {
      statusCode: 502,
      publicMessage: payload.message || payload.msg || '인증번호 발송에 실패했습니다.'
    });
  }
  return payload;
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

function isTestBusinessNumber(value) {
  return String(value || '').trim() === TEST_BUSINESS_NUMBER;
}

function createStoredTestBusinessNumber(loginId) {
  const safeLoginId = String(loginId || 'user').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
  return `${TEST_BUSINESS_NUMBER}-TEST-${safeLoginId}-${Date.now()}-${crypto.randomInt(1000, 9999)}`;
}

function safeFileKey(fileName) {
  return path.basename(String(fileName)).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function normalizeStoredFileKey(value) {
  const key = safeFileKey(value || '');
  if (!key) return null;
  return /^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]+)?$/i.test(key) ? key : null;
}
function normalizeUploadOriginalName(fileName) {
  const raw = String(fileName || '').trim();
  if (!raw) return 'upload';
  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    if (decoded && !decoded.includes('\uFFFD') && /[가-힣]/.test(decoded)) {
      return decoded;
    }
  } catch (_) {
    // Keep the browser-provided name if decoding is not needed.
  }
  return raw;
}

function deliveryAccountDisplayFileName(account) {
  if (!account) return '';
  return account.originalName ? normalizeUploadOriginalName(account.originalName) : (account.fileKey || '');
}

function safeDisplayFileBaseName(value, fallback = '파일') {
  return String(value || fallback).trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_') || fallback;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function accountProofBaseName(franchiseName) {
  return `${safeDisplayFileBaseName(franchiseName, '가맹점')}_포스사진`;
}

function businessDocBaseName(franchiseName) {
  return `${safeDisplayFileBaseName(franchiseName, '가맹점')}_사업자등록증`;
}

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function uploadExtension(originalName, mimeType) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf'].includes(ext)) return ext;
  if (/png/i.test(mimeType || '')) return '.png';
  if (/jpe?g/i.test(mimeType || '')) return '.jpg';
  if (/gif/i.test(mimeType || '')) return '.gif';
  if (/webp/i.test(mimeType || '')) return '.webp';
  if (/pdf/i.test(mimeType || '')) return '.pdf';
  return ext || '';
}

async function nextAccountProofOriginalName(franchiseName, originalName, mimeType) {
  const baseName = accountProofBaseName(franchiseName);
  const ext = uploadExtension(originalName, mimeType);
  const existingNames = await repo.listStoredOriginalNamesByPrefix(baseName);
  const pattern = new RegExp(`^${escapeRegExp(baseName)}(\\d{2,})(?:\\.[^.]+)?$`, 'i');
  const legacyPattern = new RegExp(`^${escapeRegExp(baseName)}(?:\\.[^.]+)?$`, 'i');
  const maxNo = existingNames.reduce((max, name) => {
    const match = String(name || '').match(pattern);
    if (match) return Math.max(max, Number(match[1]) || 0);
    return legacyPattern.test(String(name || '')) ? Math.max(max, 1) : max;
  }, 0);
  return `${baseName}${String(maxNo + 1).padStart(2, '0')}${ext}`;
}

function requestedAccountProofOriginalName(franchiseName, requestedName, originalName, mimeType) {
  const baseName = accountProofBaseName(franchiseName);
  const ext = uploadExtension(originalName, mimeType);
  const requestedBase = path.basename(String(requestedName || '')).replace(/\.[^.]+$/, '');
  const pattern = new RegExp(`^${escapeRegExp(baseName)}(\\d{2,})$`, 'i');
  const match = requestedBase.match(pattern);
  return match ? `${baseName}${match[1]}${ext}` : '';
}

function normalizedAccountProofDisplayName(franchiseName, displayName) {
  const raw = path.basename(String(displayName || ''));
  const ext = path.extname(raw).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf'].includes(ext)) return '';
  const baseName = accountProofBaseName(franchiseName);
  const rawBase = raw.slice(0, -ext.length);
  const pattern = new RegExp(`^${escapeRegExp(baseName)}(\\d{2,})$`, 'i');
  const match = rawBase.match(pattern);
  return match ? `${baseName}${match[1]}${ext}` : '';
}

function normalizeAdminAccountProofDisplayNames(franchises = []) {
  for (const franchise of franchises) {
    const accounts = Array.isArray(franchise?.deliveryAgencies) ? franchise.deliveryAgencies : [];
    let proofNo = 1;
    for (const account of accounts) {
      if (!account || account.hidden === true) continue;
      const rawName = account.fileName || account.documentUrl || account.fileKey || '';
      const ext = uploadExtension(rawName, '');
      if (!ext) continue;
      account.fileName = `${accountProofBaseName(franchise.name)}${String(proofNo).padStart(2, '0')}${ext}`;
      proofNo += 1;
    }
  }
  return franchises;
}

async function nextBusinessDocOriginalName(franchiseName, originalName, mimeType) {
  const baseName = businessDocBaseName(franchiseName);
  const ext = uploadExtension(originalName, mimeType);
  const existingNames = await repo.listStoredOriginalNamesByPrefix(baseName);
  const pattern = new RegExp(`^${escapeRegExp(baseName)}(\\d{2,})(?:\\.[^.]+)?$`, 'i');
  const maxNo = existingNames.reduce((max, name) => {
    const match = String(name || '').match(pattern);
    return match ? Math.max(max, Number(match[1]) || 0) : max;
  }, 0);
  return `${baseName}${String(maxNo + 1).padStart(2, '0')}${ext}`;
}

function normalizedBusinessDocDisplayName(franchiseName, currentName) {
  const ext = uploadExtension(currentName, '');
  return `${businessDocBaseName(franchiseName)}01${ext || '.pdf'}`;
}

function normalizeDeliveryAccountStatusForDb(value) {
  const status = String(value || '').trim().toUpperCase();
  if (status === 'APPROVED' || value === '승인완료') return 'APPROVED';
  if (status === 'REJECTED' || value === '반려') return 'REJECTED';
  return 'PENDING';
}

function deliveryAccountStatusLabel(status, txid = '') {
  if (status === 'APPROVED') return txid ? '승인완료' : '승인대기';
  if (status === 'REJECTED') return '반려';
  return '승인대기';
}

function agencyContractOriginalName(agencyName) {
  return `${safeDisplayFileBaseName(agencyName, '대리점')}_계약서.pdf`;
}

function deliveryAgencyBusinessOriginalName(agencyName, ext = '.pdf') {
  return `${safeDisplayFileBaseName(agencyName, '배달대행사')}_사업자등록증${ext || '.pdf'}`;
}

async function persistUpload(file, uploadedBy, options = {}) {
  const ext = path.extname(file.originalname).toLowerCase();
  const fileKey = `${Date.now()}-${crypto.randomUUID()}${ext}`;
  const storagePath = path.join(uploadDir, fileKey);
  await fs.promises.writeFile(storagePath, file.buffer);
  return repo.recordFile({
    fileKey,
    originalName: options.originalName || normalizeUploadOriginalName(file.originalname),
    mimeType: file.mimetype,
    sizeBytes: file.size,
    storagePath,
    uploadedBy
  });
}

function resolveManagedLogoPath(logoUrl) {
  const raw = String(logoUrl || '').trim();
  if (!raw) return null;
  const cleanPath = raw.split('?')[0].split('#')[0];
  let decoded = '';
  try {
    decoded = decodeURIComponent(cleanPath);
  } catch {
    decoded = cleanPath;
  }
  const normalized = decoded.replace(/\\/g, '/');
  let targetPath = null;
  if (normalized.startsWith('/uploads/')) {
    targetPath = path.join(uploadDir, normalized.slice('/uploads/'.length));
  } else if (normalized.startsWith('/assets/delivery-agencies/')) {
    targetPath = path.join(deliveryAgencyLogoDir, normalized.slice('/assets/delivery-agencies/'.length));
  }
  if (!targetPath) return null;
  const resolved = path.resolve(targetPath);
  const allowedRoots = [path.resolve(uploadDir), path.resolve(deliveryAgencyLogoDir)];
  const insideAllowedRoot = allowedRoots.some(root => resolved === root || resolved.startsWith(root + path.sep));
  return insideAllowedRoot ? resolved : null;
}

async function deleteManagedLogoFile(logoUrl) {
  const filePath = resolveManagedLogoPath(logoUrl);
  if (!filePath) return false;
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
  const raw = String(logoUrl || '').split('?')[0].split('#')[0];
  if (raw.startsWith('/uploads/')) {
    let fileKey = raw.slice('/uploads/'.length);
    try {
      fileKey = decodeURIComponent(fileKey);
    } catch {
      // Keep the raw key if decoding fails.
    }
    if (fileKey) await repo.deleteFileByKey(fileKey).catch(() => null);
  }
  return true;
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

function maskPushToken(token) {
  const text = String(token || '');
  if (!text) return '';
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      return `${String(parsed.endpoint || '').slice(0, 36)}...`;
    } catch (_) {
      return `${text.slice(0, 18)}...`;
    }
  }
  if (text.length <= 18) return text;
  return `${text.slice(0, 10)}...${text.slice(-8)}`;
}

function fcmBase64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getFirebaseServiceAccountPath() {
  return String(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    DEFAULT_FIREBASE_SERVICE_ACCOUNT_PATH ||
    ''
  ).trim();
}

function loadFirebaseServiceAccount() {
  if (cachedFirebaseServiceAccount) return cachedFirebaseServiceAccount;
  cachedFirebaseConfigError = '';
  const inlineJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const filePath = getFirebaseServiceAccountPath();
  let parsed = null;
  try {
    if (inlineJson) {
      parsed = JSON.parse(inlineJson);
    } else if (filePath && fs.existsSync(filePath)) {
      const fileJson = fs.readFileSync(filePath, 'utf8').trim();
      if (fileJson) parsed = JSON.parse(fileJson);
    }
  } catch (error) {
    cachedFirebaseConfigError = error?.message || 'Firebase service account JSON parse failed.';
    console.warn('[FCM] Firebase service account configuration is invalid:', cachedFirebaseConfigError);
    return null;
  }
  if (!parsed?.client_email || !parsed?.private_key || !parsed?.project_id) {
    cachedFirebaseConfigError = parsed ? 'Firebase service account required fields are missing.' : '';
    return null;
  }
  cachedFirebaseServiceAccount = parsed;
  return cachedFirebaseServiceAccount;
}

function getFcmLegacyServerKey() {
  return String(
    process.env.FIREBASE_SERVER_KEY ||
    process.env.FCM_SERVER_KEY ||
    process.env.FIREBASE_FCM_SERVER_KEY ||
    ''
  ).trim();
}

function getFcmConfigStatus() {
  const serviceAccount = loadFirebaseServiceAccount();
  if (serviceAccount) {
    return {
      configured: true,
      mode: 'http_v1',
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      detail: 'Firebase HTTP v1 service account configured.'
    };
  }
  const legacyKey = getFcmLegacyServerKey();
  return {
    configured: Boolean(legacyKey),
    mode: legacyKey ? 'legacy' : 'none',
    detail: legacyKey ? 'Firebase legacy server key configured.' : (cachedFirebaseConfigError || 'Firebase service account is not configured.'),
    error: cachedFirebaseConfigError || ''
  };
}

async function getFcmAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedFcmAccessToken?.token && cachedFcmAccessToken.expiresAt - 60 > now) {
    return cachedFcmAccessToken.token;
  }
  const serviceAccount = loadFirebaseServiceAccount();
  if (!serviceAccount) return '';
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: serviceAccount.client_email,
    scope: FCM_MESSAGING_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const unsignedJwt = `${fcmBase64UrlEncode(JSON.stringify(header))}.${fcmBase64UrlEncode(JSON.stringify(claimSet))}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsignedJwt)
    .sign(serviceAccount.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const assertion = `${unsignedJwt}.${signature}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || 'FCM access token request failed.');
  }
  cachedFcmAccessToken = {
    token: payload.access_token,
    expiresAt: now + Number(payload.expires_in || 3600)
  };
  return cachedFcmAccessToken.token;
}

function normalizeFcmData(data = {}) {
  const result = {};
  Object.entries(data || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    result[key] = typeof value === 'string' ? value : JSON.stringify(value);
  });
  return result;
}

function getPushThreadId(notification = {}) {
  const data = notification.data || {};
  const source = String(data.source || notification.type || 'eatspay').trim() || 'eatspay';
  const talkChatId = data.talkChatId || data.chatId;
  if (talkChatId) return `eatspay-talk-chat-${talkChatId}`;
  const targetScreen = String(data.targetScreen || data.screen || '').trim();
  if (targetScreen) return `eatspay-${targetScreen}`;
  return `eatspay-${source}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64);
}

function getPushUnreadCount(notification = {}) {
  const raw = notification.unreadCount ?? notification.data?.unreadCount;
  const count = Number(raw || 0);
  return Number.isFinite(count) && count > 0 ? Math.min(Math.floor(count), 999) : 1;
}

async function sendFcmNotification(tokens, notification) {
  const cleanTokens = [...new Set((Array.isArray(tokens) ? tokens : []).map(token => String(token || '').trim()).filter(Boolean))];
  if (!cleanTokens.length) {
    return { sent: 0, failed: 0, detail: '등록된 FCM 토큰이 없습니다.' };
  }
  const serviceAccount = loadFirebaseServiceAccount();
  if (serviceAccount) {
    return sendFcmHttpV1Notification(cleanTokens, notification, serviceAccount);
  }
  return sendFcmLegacyNotification(cleanTokens, notification);
}

async function sendFcmHttpV1Notification(cleanTokens, notification, serviceAccount) {
  const accessToken = await getFcmAccessToken();
  const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
  const threadId = getPushThreadId(notification);
  const unreadCount = getPushUnreadCount(notification);
  let sent = 0;
  let failed = 0;
  for (const token of cleanTokens) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title: notification.title,
              body: notification.body
            },
            data: normalizeFcmData({
              ...(notification.data || {}),
              title: notification.title,
              body: notification.body,
              source: notification.data?.source || 'eatspay_admin',
              unreadCount,
              notificationThreadId: threadId
            }),
            android: {
              collapse_key: threadId,
              priority: 'HIGH',
              notification: {
                channel_id: ANDROID_PUSH_CHANNEL_ID,
                sound: 'eatspay_talk',
                tag: threadId,
                notification_count: unreadCount,
                click_action: 'EATSPAY_PUSH_CLICK'
              }
            },
            apns: {
              headers: {
                'apns-collapse-id': threadId
              },
              payload: {
                aps: {
                  badge: unreadCount,
                  sound: 'eatspay_talk.mp3'
                }
              }
            }
          }
        })
      });
      if (response.ok) sent += 1;
      else failed += 1;
    } catch (_) {
      failed += 1;
    }
  }
  return { sent, failed, detail: 'FCM HTTP v1 API request completed.' };
}

async function sendFcmLegacyNotification(cleanTokens, notification) {
  const serverKey = getFcmLegacyServerKey();
  if (!serverKey) {
    return { sent: 0, failed: cleanTokens.length, detail: 'Firebase service account is not configured.' };
  }
  const threadId = getPushThreadId(notification);
  const unreadCount = getPushUnreadCount(notification);
  let sent = 0;
  let failed = 0;
  for (const token of cleanTokens) {
    try {
      const response = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `key=${serverKey}`
        },
        body: JSON.stringify({
          to: token,
          priority: 'high',
          collapse_key: threadId,
          notification: {
            title: notification.title,
            body: notification.body,
            android_channel_id: ANDROID_PUSH_CHANNEL_ID,
            sound: 'eatspay_talk',
            tag: threadId,
            notification_count: unreadCount
          },
          data: {
            ...(notification.data || {}),
            title: notification.title,
            body: notification.body,
            source: notification.data?.source || 'eatspay_admin',
            unreadCount,
            notificationThreadId: threadId
          }
        })
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && Number(result.success || 0) > 0) sent += 1;
      else failed += 1;
    } catch (_) {
      failed += 1;
    }
  }
  return { sent, failed, detail: 'FCM legacy HTTP API request completed.' };
}

async function sendUserPushNotification(userId, notification) {
  const summary = await repo.countPushTokenSummary({ userId });
  const fcmRows = summary.rows.filter(row => row.enabled && row.platform !== 'web');
  const webRows = summary.rows.filter(row => row.enabled && row.platform === 'web');
  const unreadCount = await repo.countUnreadNotifications(userId).catch(() => 1);
  const enrichedNotification = {
    ...notification,
    unreadCount,
    data: {
      ...(notification.data || {}),
      unreadCount
    }
  };
  const fcm = await sendFcmNotification(fcmRows.map(row => row.token), enrichedNotification);
  return {
    fcm,
    web: {
      sent: 0,
      failed: webRows.length,
      detail: webRows.length
        ? 'Web Push 구독은 저장되어 있으며, 앱 내 알림으로 목적지 데이터가 보존됩니다.'
        : '등록된 Web Push 구독이 없습니다.'
    }
  };
}

async function notifyAccountApprovalTxidApplied(results = []) {
  const updatedTargets = (Array.isArray(results) ? results : [])
    .filter(item => item?.status === 'UPDATED')
    .flatMap(item => Array.isArray(item.affected) ? item.affected : []);
  const sentKeys = new Set();
  for (const target of updatedTargets) {
    const source = String(target?.source || '').trim();
    const id = String(target?.id || '').trim();
    const key = `${source}:${id}`;
    if (!source || !id || sentKeys.has(key)) continue;
    sentKeys.add(key);
    try {
      const account = await repo.findAccountApprovalNotificationTarget(source, id);
      const userId = Number(account?.user_id);
      if (!Number.isFinite(userId)) continue;
      const agencyName = String(account?.agency_name || '등록하신').trim();
      const title = '계좌 검증완료';
      const body = `등록하신 ${agencyName} 계좌가 승인완료되었습니다. 이제 충전 결제에 사용할 수 있습니다.`;
      const data = {
        targetScreen: 'vaccount-list',
        source: 'account_approval_txid',
        accountSource: source,
        accountId: id,
        franchiseId: account?.franchise_id || '',
        agencyName,
        accountNo: account?.account_no || '',
        txid: account?.txid || ''
      };
      await repo.createNotification({
        userId,
        type: 'ACCOUNT_APPROVAL_COMPLETED',
        title,
        body,
        data
      });
      await sendUserPushNotification(userId, { title, body, data });
    } catch (err) {
      console.warn('[ACCOUNT_APPROVAL_NOTIFICATION_FAILED]', { source, id, message: err?.message || String(err) });
    }
  }
}

function publicUser(user) {
  const isAdmin = user.role === 'ADMIN';
  const adminLevel = normalizeAdminLevel(user.adminLevel);
  const adminPermissions = normalizeAdminPermissions(user.adminPermissions, adminLevel);
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
    loginId: user.loginId,
    contactEmail: user.contactEmail || '',
    name: user.name,
    franchiseName: isAdmin ? adminDisplayName : user.franchiseName,
    franchiseId: isAdmin ? user.id : user.franchiseId,
    businessNumber: isAdmin ? null : user.businessNumber,
    phone: isAdmin ? null : user.phone,
    address: isAdmin ? null : user.address,
    tel: isAdmin ? null : user.tel,
    role: user.role,
    agencyId: user.agencyId || null,
    agencyName: user.agencyName || null,
    adminLevel: isAdmin ? adminLevel : null,
    adminRoleLabel: isAdmin ? ADMIN_LEVELS[adminLevel].name : null,
    adminPermissions: isAdmin ? adminPermissions : [],
    approvalState,
    approvalLabel: approvalState === 'APPROVED'
        ? '\uC2B9\uC778\uC644\uB8CC'
        : approvalState === 'REJECTED'
          ? '\uC2B9\uC778\uAC70\uC808'
          : '\uC2B9\uC778\uB300\uAE30'
  };
}

function normalizeAdminLevel(value) {
  const raw = String(value || 'SUPER').trim();
  if (ADMIN_LEVELS[raw]) return raw;
  const labelMatch = ADMIN_ROLE_LIST.find(role => role.name === raw);
  return labelMatch?.key || 'SUPER';
}

function normalizeAdminPermissions(value, adminLevel = 'SUPER') {
  const fallback = ADMIN_MENU_PERMISSIONS[normalizeAdminLevel(adminLevel)] || ADMIN_MENU_PERMISSIONS.SUPER;
  if (!Array.isArray(value)) return [...fallback];
  const normalized = value
    .map(item => String(item || '').trim())
    .filter(item => ADMIN_MENU_PERMISSION_SET.has(item));
  return Array.from(new Set(normalized.length ? normalized : fallback));
}

function serializeAdminUser(user) {
  const adminLevel = normalizeAdminLevel(user?.adminLevel);
  const adminPermissions = normalizeAdminPermissions(user?.adminPermissions, adminLevel);
  return {
    id: user.id,
    email: user.email,
    loginId: user.loginId || user.email,
    name: user.name || '',
    role: ADMIN_LEVELS[adminLevel].name,
    adminLevel,
    adminRoleLabel: ADMIN_LEVELS[adminLevel].name,
    adminPermissions,
    adminActive: user.adminActive !== false,
    lastLogin: user.lastLoginAt ? formatKstDateTime(user.lastLoginAt) : '-',
    createdAt: user.createdAt ? formatKstDateTime(user.createdAt) : ''
  };
}

function displayAgencyName(name) {
  const normalized = String(name || '').trim();
  if (!normalized || normalized === 'undefined' || normalized === '본사') {
    return DEFAULT_AGENCY_NAME;
  }
  return normalized;
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
  const value = String(digits || '').replace(/[^0-9]/g, '');
  const first2 = Number(value.slice(0, 2));
  const first4 = Number(value.slice(0, 4));
  if (value.length < 6) return '';
  if (/^(419803)/.test(value)) return 'IBK기업은행';
  if (value.startsWith('34') || value.startsWith('37')) return '아멕스카드';
  if (/^(356316|356317|356901|404825|438676|457973|515594|524353|540926|552220|558526|625804)/.test(value)) return '신한카드';
  if (/^(356416|356417|356418|404678|457047|464942|515954|516574|524144|540447|552070|558526)/.test(value)) return '삼성카드';
  if (/^(356312|356415|356516|404681|457048|457973|515949|524242|540416|552576|558526)/.test(value)) return '현대카드';
  if (/^(356311|356511|356912|404669|438676|457047|515936|524040|540926|552070|558526)/.test(value)) return 'KB국민카드';
  if (/^(356315|356516|404668|457973|515937|524148|540447|552576|558526)/.test(value)) return '롯데카드';
  if (/^(356910|404671|457047|515954|524335|540926|552220|558526)/.test(value)) return '하나카드';
  if (/^(356901|404825|457973|515954|524353|540447|552070|558526)/.test(value)) return '우리카드';
  if (/^(356912|404825|457973|515954|524242|540926|552576|558526|9410)/.test(value)) return 'BC카드';
  if (/^(356317|404825|457047|515954|524353|540926|552220|558526)/.test(value)) return 'NH농협카드';
  if (value.startsWith('4')) return '비자카드';
  if ((first2 >= 51 && first2 <= 55) || (first4 >= 2221 && first4 <= 2720)) return '마스터카드';
  if (value.startsWith('35')) return 'JCB카드';
  if (value.startsWith('62')) return '은련카드';
  return '카드';
}

function normalizeProviderCardCompany(providerName, fallbackName, digits = '') {
  const inferred = inferCardName(digits);
  const raw = String(providerName || '').trim();
  const fallback = String(fallbackName || '').trim();
  const compact = raw.replace(/\s+/g, '').toLowerCase();
  if (inferred === 'IBK기업은행') return inferred;
  if ((compact.includes('unionpay') || raw.includes('은련')) && (compact.includes('bc') || raw.includes('비씨'))) {
    return fallback || inferred || '카드';
  }
  if (!raw || ['카드사 확인중', '확인중', '카드사확인중'].includes(raw)) return fallback || inferred || '카드';
  return raw;
}
function sanitizeCardCompany(value, digits = '') {
  const name = String(value || '').trim();
  if (!name || ['카드사 확인중', '확인중', '카드사확인중'].includes(name)) {
    return inferCardName(digits) || '카드';
  }
  return name;
}

function isLikelyCardNumber(digits) {
  const value = String(digits || '').replace(/[^0-9]/g, '');
  if (value.length < 12 || value.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = value.length - 1; i >= 0; i -= 1) {
    let n = Number(value[i]);
    if (shouldDouble) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function formatCardExpireDate(month, year) {
  const mm = String(month).replace(/[^0-9]/g, '').padStart(2, '0').slice(-2);
  const yy = String(year).replace(/[^0-9]/g, '').padStart(2, '0').slice(-2);
  return `${yy}${mm}`;
}

async function seedDeliveryAgencies() {
  const existing = await repo.listDeliveryAgencies();
  if (existing.length > 0) {
    return;
  }

  for (const [index, name] of DEFAULT_DELIVERY_AGENCIES.entries()) {
    await repo.createDeliveryAgency(name, 'active', index + 1);
  }
}

async function seedFinancialInstitutions() {
  for (const [index, item] of DEFAULT_FINANCIAL_INSTITUTIONS.entries()) {
    await pool.query(
      `INSERT INTO financial_institutions (code, name, sort_order, active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (name) DO UPDATE SET
         code = EXCLUDED.code,
         sort_order = EXCLUDED.sort_order,
         active = true,
         updated_at = now()`,
      [item.code, item.name, index + 1]
    );
  }
}

function hasGhPaymentsPayKey() {
  const key = String(
    process.env.GH_PAYMENTS_BILLING_PAY_KEY ||
    process.env.GH_PAYMENTS_PAY_KEY ||
    ''
  ).trim();
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

function getGhPaymentsPayKey(pathname = '') {
  const isBilling = String(pathname).includes('/api/billing/');
  return String(
    (isBilling
      ? process.env.GH_PAYMENTS_BILLING_PAY_KEY
      : process.env.GH_PAYMENTS_MANUAL_PAY_KEY) ||
    process.env.GH_PAYMENTS_PAY_KEY ||
    ''
  ).trim();
}

async function ghPaymentsRequest(pathname, { method = 'GET', body } = {}) {
  if (!hasGhPaymentsPayKey()) {
    throw new Error('GH_PAYMENTS_PAY_KEY is required for GH Payments integration.');
  }

  const payKey = getGhPaymentsPayKey(pathname);
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





