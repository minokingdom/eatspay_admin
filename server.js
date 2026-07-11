const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const express = require('express');
const ExcelJS = require('exceljs');
const multer = require('multer');

const { createPool } = require('./db/pool');
const { createRepository } = require('./db/repository');
const { parseCardGorillaRanking } = require('./lib/cardgorilla');
const { createPublicAgencyInvite } = require('./lib/public-agency-invite');
const { buildAuditChangeSet, sanitizeAuditData } = require('./lib/audit-log');
const { createSignupAttribution } = require('./lib/signup-attribution');
const { isProtectedAgencyJoinCode } = require('./lib/agency-link-policy');
const {
  buildRouteupBillKeyPayload,
  buildRouteupBillPayPayload,
  extractRouteupBillKey,
  isRouteupSuccess,
  routeupMessage
} = require('./lib/routeup-payments');
const {
  buildRouteupPaymentContract,
  hasBillablePgContract,
  hasRouteupExternalIntegrationKeys,
  maskPgContract,
  normalizePgContract,
  normalizeProviderName,
  sanitizePgContracts
} = require('./lib/pg-contracts');
const { calculateAgencySettlementRows } = require('./admin-assets/js/admin-agency-settlement-calculator');
const {
  normalizeAccountNo: normalizeOcrAccountNo,
  normalizeOcrRegion,
  resolveProofImagePath,
  recognizeAccountProof,
  assertProofImageExists
} = require('./lib/account-proof-ocr');

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
const MAX_INSTALLMENT_MONTH = 6;
let accountProofOcrBusy = false;
const ACCOUNT_EXPORT_TEMPLATE_PATH = path.join(__dirname, 'assets', 'templates', 'merchant_registration_template.xlsx');
const CARDGORILLA_RANKING_URL = String(process.env.CARDGORILLA_RANKING_URL || '').trim();
const CARDGORILLA_UPDATE_HOUR_KST = Number(process.env.CARDGORILLA_UPDATE_HOUR_KST || 6);
const ALIGO_API_URL = 'https://apis.aligo.in/send/';
const CH_PAYWAY_UID = String(process.env.CH_PAYWAY_UID || process.env.PAYWAY_UID || '').trim();
const CH_PAYWAY_PW = String(process.env.CH_PAYWAY_PW || process.env.PAYWAY_PW || '').trim();
const CH_PAYWAY_BASE_URL = 'https://payway.kr';
const CH_PAYWAY_PROXY_TTL_MS = 10 * 60 * 1000;
const CH_PAYWAY_FALLBACK_ENABLED = String(process.env.CH_PAYWAY_FALLBACK_ENABLED || 'true').toLowerCase() !== 'false';
const CH_PAYWAY_FALLBACK_BATCH_SIZE = Math.max(1, Math.min(Number(process.env.CH_PAYWAY_FALLBACK_BATCH_SIZE || 5), 20));
const CH_PAYWAY_FALLBACK_TIMEOUT_MS = Math.max(5000, Math.min(Number(process.env.CH_PAYWAY_FALLBACK_TIMEOUT_MS || 15000), 60000));
const ROUTEUP_UID = String(process.env.ROUTEUP_UID || '').trim();
const ROUTEUP_PW = String(process.env.ROUTEUP_PW || '').trim();
const ROUTEUP_BASE_URL = 'https://www.routeup.kr';
const ROUTEUP_API_BASE_URL = 'https://api.routeup.kr';
const ROUTEUP_SIGN_KEY = String(process.env.ROUTEUP_SIGN_KEY || '').trim();
const ROUTEUP_MERCHANT_DEFAULT_PW = String(process.env.ROUTEUP_MERCHANT_DEFAULT_PW || process.env.ROUTEUP_DEFAULT_USER_PW || '').trim();
const ROUTEUP_PROXY_TTL_MS = 10 * 60 * 1000;
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const chPaywayProxyTokens = new Map();
const chPaywayStartTokens = new Map();
const routeupProxyTokens = new Map();
const routeupStartTokens = new Map();
let chPaywayCookieHeader = '';
let routeupSessionCache = null;


const AVICX_SAFE_TABLES = new Map([
  ['pg_providers', ['id', 'name', 'mid', 'callback_url', 'status', 'display_order', 'note', 'updated_at']],
  ['pg_notifications', ['id', 'provider', 'event_type', 'transaction_id', 'pg_transaction_id', 'result_code', 'result_message', 'processed', 'received_at']],
  ['deposit_notifications', ['id', 'provider', 'event_type', 'txid', 'account_no', 'bank_name', 'depositor_name', 'amount', 'processed', 'received_at']],
  ['pg_settlements', ['id', 'franchise_name', 'delivery_agency', 'account_no', 'account_holder', 'payment_amt', 'svc_fee', 'net_amt', 'status', 'approval_no', 'pg_tx_id', 'created_at']],
  ['users', ['id', 'email', 'name', 'franchise_name', 'franchise_id', 'role', 'phone', 'agency_id', 'login_id', 'created_at']],
  ['cards', ['id', 'user_id', 'masked_number', 'card_name', 'card_company', 'alias', 'active', 'hidden', 'created_at']],
  ['account_requests', ['request_id', 'franchise_id', 'franchise_name', 'bank_name', 'account_no', 'representative_name', 'status', 'txid', 'manual_tid', 'recurring_tid', 'submitted_at', 'updated_at']],
  ['agencies', ['id', 'type', 'name', 'login_id', 'parent_id', 'status', 'created_at', 'updated_at']],
  ['transactions', ['transaction_id', 'franchise_id', 'type', 'amount', 'fee', 'total_amount', 'method', 'pg', 'pg_tx_id', 'auth_code', 'status', 'created_at']]
]);

function avicxLines(lines = [], tone = 'info') {
  return { type: 'lines', tone, lines: Array.isArray(lines) ? lines.map(line => String(line)) : [String(lines)] };
}

function avicxTable(columns, rows) {
  return { type: 'table', columns, rows };
}

function avicxFormatKstDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
  return parts.replace(' ', ' ');
}

function avicxDisplayCell(value) {
  if (value == null || value === '') return '-';
  if (value instanceof Date) return avicxFormatKstDateTime(value) || String(value);
  if (typeof value === 'boolean') return value ? '활성' : '비활성';
  const text = String(value);
  if (/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT/.test(text)) return avicxFormatKstDateTime(text) || text;
  const statusMap = new Map([
    ['SUCCESS', '승인완료'], ['APPROVED', '승인완료'], ['SETTLED', '정산완료'], ['PENDING', '대기'], ['FAILED', '실패'],
    ['OWNER', '가맹점'], ['OWNER_PENDING', '승인대기'], ['OWNER_REJECTED', '반려'],
    ['POST', '결제알림'], ['DEPOSIT', '입금알림'], ['WITHDRAW', '입금이체'], ['ERROR', '오류'],
    ['SUPER', '총괄 관리자'], ['OPERATIONS', '운영 관리자'], ['SETTLEMENT', '정산 관리자'], ['CUSTOMER', '고객 관리자'],
    ['FRANCHISE_UPDATE', '가맹점 정보 수정'], ['FRANCHISE_REGISTER', '가맹점 등록'], ['FRANCHISE_PASSWORD_RESET', '가맹점 비밀번호 초기화'], ['FRANCHISE_DELIVERY_ACCOUNTS_REPLACE', '가맹점 배달계좌 수정'],
    ['ACCOUNT_PG_CONTRACT_UPDATE', 'PG 계약 정보 수정'], ['ACCOUNT_TXID_UPLOAD', 'TID 엑셀 업로드'], ['ROUTEUP_ACCOUNT_APPROVAL_UPLOAD', '위루트 계좌검증 업로드'],
    ['ACCOUNT_REQUEST_VERIFY', '계좌 검증 처리'], ['ACCOUNT_REQUEST_REVERIFY', '계좌 재검증 요청'], ['ACCOUNT_REQUEST_REJECT', '계좌 반려 처리'],
    ['DELIVERY_ACCOUNT_VERIFY', '배달계좌 검증 처리'], ['DELIVERY_ACCOUNT_REVERIFY', '배달계좌 재검증 요청'], ['DELIVERY_ACCOUNT_REJECT', '배달계좌 반려 처리'],
    ['CARD_CREATE', '카드 등록'], ['CARD_UPDATE', '카드 정보 수정'], ['CARD_DELETE', '카드 삭제'], ['CARD_HIDE', '카드 숨김'], ['CARD_SHOW', '카드 표시'], ['CARD_ADMIN_HIDE', '관리자 카드 숨김'], ['CARD_ADMIN_SHOW', '관리자 카드 표시'], ['CARD_ADMIN_ALIAS_UPDATE', '카드 별칭 수정'],
    ['AGENCY_INQUIRY_CREATE', '지사 문의 접수'], ['AGENCY_INQUIRY_DELETE', '지사 문의 삭제'], ['AGENCY_SETTLE_ACCOUNT_UPDATE', '대리점 정산계좌 수정'],
    ['TALK_POST_CREATE', '이츠톡 글 등록'], ['TALK_POST_TRADE_STATUS', '이츠톡 거래상태 변경'], ['TALK_AUTHOR_HIDE', '이츠톡 작성자 숨김'],
    ['ADMIN_USER_CREATE', '관리자 계정 생성'], ['ADMIN_USER_UPDATE', '관리자 계정 수정'], ['ADMIN_USER_DELETE', '관리자 계정 비활성화'], ['AUDIT_NOTIFICATION_PREFERENCE_UPDATE', '변경 알림 설정 수정'],
    ['account_request', '계좌요청'], ['delivery_account', '배달계좌'], ['account_approval_batch', '계좌 승인 배치'], ['franchise', '가맹점'], ['user', '사용자'], ['agency', '대리점'], ['agency_inquiry', '지사 문의'], ['talk_post', '이츠톡 글'], ['talk_author', '이츠톡 작성자'], ['admin', '관리자'], ['audit_notification_preference', '변경 알림 설정']
  ]);
  return statusMap.get(text) || text;
}

function avicxOutputToText(output) {
  if (!output) return '';
  if (output.type === 'lines') return (output.lines || []).join('\n');
  if (output.type === 'table') {
    const columns = output.columns || [];
    const rows = output.rows || [];
    if (!rows.length) return '조건에 맞는 데이터가 없습니다.';
    const head = columns.join(' | ');
    const body = rows.slice(0, 8).map(row => columns.map(col => avicxDisplayCell(row?.[col])).join(' | '));
    const more = rows.length > 8 ? `외 ${rows.length - 8}건 더 있음` : '';
    return [head, ...body, more].filter(Boolean).join('\n');
  }
  if (output.type === 'group') return (output.sections || []).map(section => {
    if (section?.type === 'table' && !(section.rows || []).length) return '';
    return avicxOutputToText(section);
  }).filter(Boolean).join('\n\n');
  if (Array.isArray(output.lines)) return output.lines.join('\n');
  return JSON.stringify(output);
}

function avicxHumanizeChatText(text) {
  const labels = new Map([
    ['time', '시간'], ['day', '날짜'], ['status', '상태'], ['count', '건수'], ['total', '결제금액'], ['fee', '수수료'],
    ['pg', 'PG'], ['month', '월'], ['franchise', '가맹점'], ['hour', '시간'], ['id', 'ID'],
    ['delivery', '대행사'], ['payment', '결제금액'], ['net', '입금액'], ['approval', '승인번호'],
    ['provider', 'PG사'], ['event', '이벤트'], ['transactionId', '거래번호'], ['pgTx', 'PG거래번호'],
    ['code', '코드'], ['txid', 'TID'], ['bank', '은행'], ['depositor', '예금주'], ['amount', '원금'],
    ['request', '요청번호'], ['account', '계좌'], ['holder', '예금주'], ['type', '구분'],
    ['agency', '대리점'], ['franchises', '가맹점'], ['contacts', '연락처'], ['cards', '카드'], ['accounts', '계좌'],
    ['owner', '대표자'], ['login', '로그인ID'], ['phone', '휴대폰'], ['tel', '전화'], ['email', '이메일'], ['auth', '승인번호'], ['mid', 'MID'], ['name', '이름'], ['adminLevel', '권한'], ['lastLogin', '최근 로그인'], ['action', '작업'], ['type', '구분'], ['target', '대상'], ['fields', '변경 항목'], ['joined', '가입일'], ['reason', '구분'],
    ['source', '출처'], ['feeRate', '수수료율'], ['payments', '결제'], ['cardId', '카드ID'], ['masked', '카드번호'],
    ['company', '카드사'], ['card', '카드'], ['alias', '별칭'], ['active', '활성'], ['hidden', '숨김'], ['callbackUrl', '콜백URL'], ['order', '순서'], ['manualTid', '수기TID'], ['recurringTid', '정기TID'], ['bank', '은행'], ['approved', '승인완료'], ['pending', '대기'], ['tid', 'TID등록']
  ]);
  return String(text || '')
    .split('\n')
    .map(line => {
      if (!line.includes(' | ')) return line;
      return line.split(' | ').map(cell => labels.get(cell) || cell).join(' | ');
    })
    .join('\n')
    .replace(/AVICX commands/g, '제가 바로 확인할 수 있는 항목이에요')
    .replace(/health \| status \| today brief \| brief/g, '운영 요약, 서버 상태')
    .replace(/sales today \| sales yesterday \| sales YYYY-MM-DD \| sales all/g, '오늘 매출, 어제 매출, 특정일 매출, 누적 매출')
    .replace(/deposit latest \[limit\] \| settle pending \[limit\]/g, '최근 입금 알림, 정산 대기 내역')
    .replace(/noti latest \[limit\] \| noti provider <PG사> \[limit\]/g, '최근 PG 노티, PG사별 노티')
    .replace(/franchise search <검색어> \| account pending \[limit\] \| card list <가맹점명>/g, '가맹점 검색, 계좌 승인 대기, 가맹점 카드 목록')
    .replace(/db tables.*\n?/g, '')
    .replace(/explain <TXN번호>.*\n?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function avicxChatHelpText() {
  return [
    '필요한 걸 편하게 물어보면 바로 찾아볼게요.',
    '',
    '- 오늘 뭐 확인해야 해? / 오늘 문제 있어?',
    '- 이번달 장사 잘돼? / 어제보다 어때?',
    '- 방금 들어온 결제 / 최근 입금된 거',
    '- 교촌 돈 들어왔어? / 손별 계좌 맞아?',
    '- TID 안 들어간 곳 / 카드 등록 안 된 곳',
    '- 누가 방금 바꿨어? / 관리자 누가 있어?',
    '- 가입 링크 어디서 보내? / PG 콜백 어디야?',
    '',
    '가맹점명, 대표자명, 전화번호, 승인번호, 거래번호를 같이 적으면 더 정확하게 찾아볼 수 있어요.'
  ].join('\n');
}

function avicxOutputToChatText(output, command = '') {
  if (command === 'help') return avicxChatHelpText();
  const text = avicxHumanizeChatText(avicxOutputToText(output));
  if (!text) return '조건에 맞는 데이터는 아직 없어요.';
  if (/조건에 맞는 데이터가 없습니다\.?$/.test(text)) return '조건에 맞는 데이터는 아직 없어요.';
  return text;
}

function itzbiFallbackReply(message) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  const examples = [];

  if (/(매출|장사|수수료|승인|결제)/.test(lower)) {
    examples.push('오늘 매출 얼마야?', '이번달 매출 보여줘', '어제보다 어때?');
  } else if (/(정산|입금|돈|이체)/.test(lower)) {
    examples.push('정산 대기 뭐 있어?', '입금 이체 성공만', '교촌 돈 들어왔어?');
  } else if (/(계좌|tid|txid|은행)/i.test(text)) {
    examples.push('계좌 승인 대기', 'TID 없는 곳', '은행별 계좌 현황');
  } else if (/(카드|가맹점|상점|대표자|전화|연락처)/.test(lower)) {
    examples.push('가맹점 몇 개야?', '카드 없는 가맹점', '손별 누구야?');
  } else if (/(관리자|로그|수정|변경|권한)/.test(lower)) {
    examples.push('관리자 누가 있어?', '누가 방금 수정했어?', '비밀번호 어디서 바꿔?');
  } else {
    examples.push('오늘 뭐 확인해야 해?', '방금 들어온 결제 보여줘', 'TID 안 들어간 곳');
  }

  return [
    '지금 질문은 바로 조회 가능한 형태로 잡지 못했어요.',
    '가맹점명, 대표자명, 전화번호, 승인번호, TID 중 하나를 같이 적어주면 더 정확히 찾을 수 있어요.',
    '',
    '이렇게 물어볼 수 있어요:',
    ...examples.slice(0, 3).map(item => `- ${item}`)
  ].join('\n');
}
function itzbiRequiresDeveloper(message) {
  const text = String(message || '').toLowerCase();
  const asksReadOnly = /(보여|조회|확인|알려|목록|내역|현황|상태|몇|있어|가능|없는|안된|안\\s*된|미등록|누락|롤백|된\\s*것|된거|된 건|된\\s*건)/i.test(text);
  if (/운영\s*db/i.test(text)) return true;
  if (/\b(update|delete|insert|drop|truncate|alter)\b/i.test(text)) return true;
  if (/db\s*(수정|변경|삭제|반영|복구)/i.test(text)) return true;
  if (/(배포|재시작|restart|권한\\s*변경|권한.*(바꿔|변경|수정)|관리자.*(삭제|비활성|권한|비밀번호|비번|암호|초기화|생성|추가|수정|바꿔)|은행.*(추가|등록|수정|삭제|바꿔|변경))/i.test(text)) return true;
  if (!asksReadOnly && /(상태|계좌|은행명|정산완료|정산대기|결제|정산|가맹점|대리점|카드|엑셀|파일|업로드|다운로드).*(바꿔|변경|처리|반영|수정|등록(?!된)|삭제|취소해|취소\\s*처리|다운로드해|업로드해|받아줘|올려줘|해라|해 주세요)/i.test(text)) return true;
  if (/(rollback|롤백)/i.test(text) && !asksReadOnly) return true;
  return false;
}

function itzbiExtractFranchiseQuery(text) {
  const value = String(text || '').trim();
  if (!/(가맹점|상점|매장|업체|결제내역|거래내역|매출내역)/.test(value)) return '';
  if (/(오늘|어제|누적|전체|총|이번달|이달|월간|대기|노티|입금|정산|계좌)/.test(value)) return '';
  const cleaned = value
    .replace(/(가맹점|상점|매장|업체|결제내역|거래내역|매출내역|결제|거래|매출|내역|조회|확인|찾아|보여|알려|줘|해줘|좀|있어|있나|\?)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 60) : '';
}

function itzbiExtractContactQuery(text) {
  const value = String(text || '').trim();
  if (!/(연락처|전화번호|휴대폰|핸드폰|번호)/.test(value)) return '';
  if (/(목록|전체|리스트|상위|랭킹|많은|순위)/.test(value)) return '';
  const cleaned = value
    .replace(/(연락처|전화번호|휴대폰|핸드폰|번호|조회|확인|찾아|보여|알려|줘|해줘|좀|있어|있나|\?)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 60) : '';
}

function itzbiExtractReferenceCode(text) {
  const value = String(text || '').trim();
  const match = value.match(/(TXN-\d{8}-\d+|REQ-\d{8}-\d+|WD\d{12,}|TMN\d{6,}|T\d{12,}|\b\d{6,12}\b|[A-Z]{2,}-[0-9A-Z-]{6,})/i);
  if (!match) return '';
  const code = match[1];
  if (/^(TXN-|REQ-|WD\d{12,}|TMN\d{6,}|T\d{12,}|[A-Z]{2,}-[0-9A-Z-]{6,})/i.test(code)) return code;
  if (/^\d{6,8}$/.test(code) && /^\d{6,8}$/.test(value)) return code;
  if (/(승인번호|승인 번호|거래번호|거래 번호|결제코드|결제 코드|txid|tid|txn|입금코드|입금 코드|pg입금코드|pg 입금코드|확인|조회|찾아|알려|내역|상태|뭐야|누구|어디)/i.test(value)) return code;
  return '';
}
function itzbiExtractLookupQuery(text) {
  const cleaned = String(text || '')
    .replace(/(가맹점|상점|매장|업체|상태|정보|정산|입금|승인|승인된|실패|완료된|계좌|카드|연락처|전화번호|휴대폰|핸드폰|번호|결제내역|거래내역|결제|거래|매출|내역|조회|확인|찾아|보여|알려|줘|해줘|좀|있어|있나|맞아|누구야|어디야|됐어|되었어|됐나|되었나|됐는지|되었는지|된거|된 건|된건|최근|최신|마지막|목록|리스트|현황|은행별|tid|txid|돈|들어왔어|들어왔|들어|몇개야|몇\s*개야|몇개|몇\s*개|몇곳이야|몇\s*곳이야|몇곳|몇\s*곳|개수|갯수|몇건|몇\s*건|이야|야|뭐야|\?)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 60) : '';
}

function itzbiExtractPhoneQuery(text) {
  const digits = String(text || '').replace(/[^0-9]/g, '');
  return digits.length >= 8 ? digits.slice(0, 20) : '';
}
function itzbiGuideText(topic) {
  const guideTopic = String(topic || '').toLowerCase();
  if (guideTopic === 'excel') {
    return [
      '엑셀은 해당 화면의 다운로드 버튼에서 받을 수 있어요.',
      '- PG 정산: 결제/정산 > PG 정산 확인',
      '- 대리점 정산: 결제/정산 > 대리점 정산',
      '- 계좌 승인/TID: 출금계좌 목록에서 필요한 항목을 확인해 주세요.'
    ].join('\n');
  }
  if (guideTopic === 'tidupload') {
    return [
      'TID 엑셀은 업로드 페이지에서 파일을 선택한 뒤 서버에 반영하면 돼요.',
      '중복 건은 기존 등록 여부를 확인해서 건너뛰고, 실패 건은 결과 메시지에 따로 표시됩니다.',
      '특정 건은 “TMN026613 확인해줘”처럼 TID를 입력하면 바로 찾아볼 수 있어요.'
    ].join('\n');
  }
  if (guideTopic === 'pgcallback') {
    return [
      'PG 콜백 주소는 PG사 관리 메뉴에서 확인하면 돼요.',
      '- GH Payments: https://eatspay.kr/api/ghpayments/notify',
      '- 위루트: https://eatspay.kr/api/routeup/notify',
      'PG사별 MID와 활성 상태도 같은 화면에서 같이 볼 수 있어요.'
     ].join('\n');
  }
  if (guideTopic === 'joinlink') {
    return [
      '가입 링크는 가입 URL 관리 또는 내 가입 URL 메뉴에서 확인하고 보낼 수 있어요.',
      '대리점/지사별 가입 URL이 다를 수 있으니 보낼 대상 지사를 먼저 확인해 주세요.',
      '링크가 안 보이면 권한 또는 대리점 배정 상태를 확인하면 됩니다.'
     ].join('\n');
  }
  if (guideTopic === 'adminusage') {
    return [
      '관리자 페이지에서 궁금한 걸 말하듯이 물어보면 돼요.',
      '- 오늘 뭐 확인해야 해? / 이번달 장사 잘돼?',
      '- 교촌 돈 들어왔어? / 손별 계좌 맞아?',
      '- TID 안 들어간 곳 / 카드 등록 안 된 곳',
      '- 누가 방금 바꿨어? / 관리자 누가 있어?'
    ].join('\n');
  }
  if (guideTopic === 'fee') {
    return [
      '수수료 구조는 결제금액, 가맹점 수수료율, 대리점 배분 기준을 같이 봐야 해요.',
      '실제 금액은 “오늘 수수료”, “이번달 수수료”, “누적 수수료”처럼 물어보면 바로 계산해서 보여줄 수 있어요.',
      '가맹점별 수수료율은 “교촌치킨 포일내손점 상태”처럼 가맹점명을 같이 적으면 확인할 수 있어요.'
    ].join('\n');
  }  if (guideTopic === 'kakao') {
    return [
      '카카오 발송 여부는 현재 관리자 DB에서 직접 확정 조회하는 항목은 아니에요.',
      '대신 최근 입금/PG 알림은 조회할 수 있어요: “입금 이체 성공 알림 보여줘”, “GH Payments 최근 노티”.'
    ].join('\n');
  }
  if (guideTopic === 'menu') {
    return [
      '메뉴 위치는 왼쪽 사이드바에서 찾으면 돼요.',
      '- PG 설정/콜백: PG사 관리',
      '- 가입 URL: 가입 URL 관리 또는 내 가입 URL',
      '- 배너: 배너 관리',
      '- 공지/이용가이드/FAQ: 공지사항, 이용가이드, FAQ 관리',
      '- 약관/개인정보 처리방침: 약관 관리 또는 개인정보 처리방침 관리',
      '- 푸시/카카오 알림 확인: 푸시알림 또는 최근 PG/입금 알림 조회',
      '- 변경 기록: 변경 기록 메뉴에서 확인할 수 있어요.'
    ].join('\n');
  }
  if (guideTopic === 'bankmenu') {
    return [
      '은행 목록은 관리자 메뉴의 은행 관리 탭에서 관리하면 돼요.',
      '현재 등록/사용 현황을 보려면 “은행별 계좌 현황”이라고 물어보면 됩니다.',
      '은행 추가나 삭제처럼 목록을 바꾸는 작업은 여기서 바로 실행하지 않을게요.'
    ].join('\n');
  }
  if (guideTopic === 'agencymenu') {
    return [
      '대리점 관리는 왼쪽 사이드바의 대리점 관리 메뉴에서 확인하면 돼요.',
      '대리점별 가맹점/연락처/카드/계좌 현황은 “대리점별 등록 현황”이라고 물어보면 바로 볼 수 있어요.',
      '대리점 생성, 삭제, 권한 변경은 실제 데이터가 바뀌는 작업이라 여기서 바로 실행하지 않을게요.'
    ].join('\n');
  }
  if (guideTopic === 'permission') {
    return [
      '메뉴가 안 보이면 관리자 권한에 따라 숨겨진 상태일 수 있어요.',
      '권한 확인은 “관리자 계정 상태”라고 물어보면 되고, 권한 변경은 총괄 관리자만 처리할 수 있어요.',
      '비밀번호 변경과 로그아웃은 우측 상단 메뉴에 있어요.'
    ].join('\n');
  }
  if (guideTopic === 'screen') {
    return [
      '화면이 이상하면 먼저 새로고침 후 다시 로그인해 주세요.',
      '계속 안 보이면 브라우저 캐시 문제일 수 있어서 강력 새로고침을 해보면 됩니다.',
      '특정 메뉴가 안 보이는 경우는 권한 문제일 수 있어요. “관리자 계정 상태”로 확인해 주세요.'
    ].join('\n');
  }  return '';
}
function itzbiExtractMoneyAmount(text) {
  const value = String(text || '').replace(/,/g, '');
  const man = value.match(/(\d{1,9})\s*만원/);
  if (man) return String(Number(man[1]) * 10000);
  const match = value.match(/(\d{3,12})\s*원|금액\s*(\d{3,12})/);
  if (!match) return '';
  return match[1] || match[2] || '';
}

function itzbiLooksLikeNameOnlyLookup(text) {
  const value = String(text || '').trim();
  if (!/(누구야|누구|어디야|어디|찾아|조회|확인|알려)/.test(value)) return false;
  if (/(계좌|카드|매출|정산|결제|거래|입금|문의|대리점|지사|가맹점|상점|매장|업체|번호|전화|연락처)/.test(value)) return false;
  const q = itzbiExtractLookupQuery(value);
  return q.length >= 2;
}
function itzbiCommandFromMessage(message) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  if (!text) return '';
  if (/^(learn|학습)\b/i.test(text)) return text;
  if (/^(학습목록|학습 목록|이츠비학습목록|이츠비 학습 목록)$/.test(text.replace(/[?!？.。]+/g, '').trim())) return 'learn list';
  const compactText = lower.replace(/[\s?!？.。]+/g, '');
  if (/^(안녕|안녕하세요|하이|hello|hi|헬로|도와줘|도움|도움말|help|헬프|처음왔어|처음이야|처음)$/.test(compactText)) return 'guide adminUsage';
  if (/^(뭐부터보면돼|뭐부터보면돼?|뭐부터봐|뭐봐야해|문제있어?|이상한거있어?|오늘체크|확인할거|확인할것|문제있어|이상한거있어|보고서줘|요약해줘|운영요약|전체현황|그냥알려줘)$/.test(compactText)) return 'brief';
  if (/^(시스템상태|서버상태|db상태|디비상태|서버괜찮아|서버괜찮아?|db괜찮아|db괜찮아?|디비괜찮아|디비괜찮아?)$/.test(compactText)) return 'health';
  if (/^(가맹점현황|상점현황|매장현황|업체현황)$/.test(compactText)) return 'stats franchise';
  if (/^(대리점현황|지사현황|지점현황)$/.test(compactText)) return 'stats agency';
  if (/^(연락처수상위대리점|전화번호수상위대리점|휴대폰수상위대리점)$/.test(compactText)) return 'agency top contacts 10';
  if (/^(카드수상위대리점)$/.test(compactText)) return 'agency top cards 10';
  if (/^(계좌수상위대리점)$/.test(compactText)) return 'agency top accounts 10';
  if (/^(가맹점수상위대리점|가맹점수많은지사|가맹점수많은대리점)$/.test(compactText)) return 'agency top franchises 10';
  if (/^(대리점별등록현황|지사별등록현황|대리점등록현황|지사등록현황)$/.test(compactText)) return 'agency top accounts 10';
  if (/^(pgstatus|pg상태|pg현황|pg목록)$/.test(compactText)) return 'pg list';
  if (/^(ghnoti|gh노티|gh알림|ghpaymentsnoti|ghpayments노티)$/.test(compactText)) return 'noti provider gh';
  if (/^(routeupnoti|routeup노티|routeup알림|위루트노티|위루트알림)$/.test(compactText)) return 'noti provider routeup';
  if (/^(tidmissing|txidmissing|tid누락|txid누락|tid없는곳|txid없는곳|tid미등록|txid미등록)$/.test(compactText)) return 'account missing-tid 20';
  if (/^(accountmissing|계좌missing|계좌없는곳|계좌미등록|계좌누락)$/.test(compactText)) return 'franchise missing-accounts 20';
  if (/^(cardmissing|카드missing|카드없는곳|카드미등록|카드누락)$/.test(compactText)) return 'franchise missing-cards 20';
  if (/^(공지|공지사항|faq|이용가이드|푸시알림|푸시|알림설정)$/.test(compactText)) return 'guide menu';
  if (/(수수료|fee)/i.test(text) && /(구조|정책|기준|어떻게|뭐야|무엇|설명)/.test(lower)) return 'guide fee';
  if (/^(왜안돼|왜안됨|뭐가문제야|안되는데|안됨|문제있어|오류있어)$/.test(compactText)) return 'brief';
  if (/^(결제안됨|결제오류|승인오류|승인안됨)$/.test(compactText)) return 'payments failed 10';
  if (/(수수료|fee)/i.test(text) && /(누적|전체|총|합계|총액|all|total|cumulative)/.test(lower)) return 'sales all';
  if (/(수수료|fee)/i.test(text) && /(이번달|이달|월간|month)/.test(lower)) return 'sales month';
  if (/(수수료|fee)/i.test(text) && /(어제|yesterday)/.test(lower)) return 'sales yesterday';
  if (/^(정산완료현황|정산현황|정산완료|정산상태)$/.test(compactText)) return 'settle status';
  if (/^(롤백된정산|롤백정산|롤백내역|취소정산|취소된정산)$/.test(compactText)) return 'settle rolledback 10';
  if (/(입금|이체)/.test(lower) && /(성공)/.test(lower)) return 'deposit transfer 10';
  if (/^(입금안됨|입금누락|정산안됨|정산누락|미입금|미정산)$/.test(compactText)) return 'settle pending 10';
  if (/^(카드오류|카드문제)$/.test(compactText)) return 'franchise missing-cards 20';
  if (/^(대리점순위|지사순위|대리점매출|지사매출)$/.test(compactText)) return 'agency sales 10';
  if (/^(가맹점순위|상점순위|매장순위)$/.test(compactText)) return 'sales month';
  if (/^(오늘문제|오늘이슈|오늘뭐|오늘뭐봐|오늘뭐확인)$/.test(compactText)) return 'brief';
  if (/^(처음|처음안내|시작|시작안내|뭐할수있어|뭐할수있나|사용법)$/.test(compactText)) return 'guide adminUsage';
  if (/^(관리자누구|관리자목록|관리자누가|어드민누구|어드민목록)$/.test(compactText)) return 'admin status 20';
  if (/^(방금수정|최근수정|누가수정|수정내역|관리자로그|변경로그|변경기록)$/.test(compactText)) return 'audit latest 20';
  if (/^(pg콜백|pg콜백주소|콜백주소|pg설정|gh설정|위루트설정)$/.test(compactText)) return 'guide pgCallback';
  if (/^(가입링크|가입url|가입주소|가입코드|내가입링크|내가입url)$/.test(compactText)) return 'guide joinLink';
  if (/^(배너위치|배너변경위치|공지위치|약관위치|개인정보위치)$/.test(compactText)) return 'guide menu';
  if (/^(은행관리위치|은행관리메뉴|은행목록위치|은행목록관리|은행어디|은행관리어디)$/.test(compactText)) return 'guide bankMenu';
  if (/^(대리점관리위치|대리점관리메뉴|대리점관리어디|대리점관리어디야|지사관리위치|지사관리메뉴)$/.test(compactText)) return 'guide agencyMenu';
  if (/^(비밀번호위치|비번위치|비밀번호변경|비번변경|로그아웃위치|로그아웃어디)$/.test(compactText)) return 'guide permission';
  if (/^(화면안떠|화면안뜸|페이지안열림|페이지안열려|로그인안됨|로그인안돼)$/.test(compactText)) return 'guide screen';  if (/^(pg상태|pg현황|pg목록)$/.test(compactText)) return 'pg list';
  if (/^(gh|ghpayments)$/.test(compactText)) return 'noti provider gh';
  if (/^(위루트|routeup)$/.test(compactText)) return 'noti provider routeup';
  if (/^(입금이체성공알림|입금이체알림|이체성공알림|입금이체성공알림보여줘|입금이체알림보여줘|이체성공알림보여줘)$/.test(compactText)) return 'deposit transfer 10';
  if (/^(입금알림|입금노티|입금알림보여줘|입금노티보여줘)$/.test(compactText)) return 'deposit latest 10';
  if (/^(최근승인실패|승인실패최근|결제실패최근|최근결제실패)$/.test(compactText)) return 'payments failed 10';
  if (/^(선정산문의대기|선정산대기|가맹점문의대기|지사문의대기)$/.test(compactText)) return 'inquiry pending 10';
  if (/^(계좌승인대기|계좌대기|계좌검증대기|계좌승인확인)$/.test(compactText)) return 'account pending 10';
  if (/^(tid없는승인건|txid없는승인건|tid없는건|txid없는건|tid미등록승인건|txid미등록승인건)$/.test(compactText)) return 'account missing-tid 20';
  if (/^(노티|최근노티)$/.test(compactText)) return 'noti latest 10';
  if (/^(입금성공|이체성공|입금이체성공)$/.test(compactText)) return 'deposit transfer 10';
  if (/^(최근입금)$/.test(compactText)) return 'deposit latest 10';
  if (/^(정산대기|입금누락|미입금|미정산)$/.test(compactText)) return 'settle pending 10';
  if (/^(정산완료|정산현황)$/.test(compactText)) return 'settle status';
  if (/^(롤백내역|롤백정산|취소정산)$/.test(compactText)) return 'settle rolledback 10';
  if (/^(취소내역|결제취소|승인실패|결제실패)$/.test(compactText)) return 'payments failed 10';
  const dateRangeMatch = text.match(/(20\d{2}-\d{1,2}-\d{1,2})\s*일?\s*(?:부터|에서|~|-)\s*(20\d{2}-\d{1,2}-\d{1,2})/);
  if (dateRangeMatch) return `payments range ${dateRangeMatch[1]} ${dateRangeMatch[2]} 100`;
  const recentText = text.replace(/\s+/g, '');
  const recentWordDays = [
    { pattern: /(최근|지난)(일주일|일주일간|한주|한주간|1주|1주간|1주일|1주일간|7일|7일간|칠일|칠일간)(거래|결제|승인|매출)/, days: 7 },
    { pattern: /(최근|지난)(보름|보름간|15일|15일간|십오일|십오일간)(거래|결제|승인|매출)/, days: 15 },
    { pattern: /(최근|지난)(한달|한달간|1개월|1개월간|30일|30일간|삼십일|삼십일간)(거래|결제|승인|매출)/, days: 30 },
    { pattern: /(최근|지난)(분기|분기간|한분기|한분기간|3개월|3개월간|90일|90일간|구십일|구십일간)(거래|결제|승인|매출)/, days: 90 }
  ];
  const recentWordMatch = recentWordDays.find(item => item.pattern.test(recentText));
  if (recentWordMatch) return `payments recent ${recentWordMatch.days} 50`;
  const recentDaysMatch = text.match(/최근\s*(\d{1,3})\s*일\s*(거래|결제|승인|매출)/);
  if (recentDaysMatch) return `payments recent ${Math.min(Number(recentDaysMatch[1]) || 3, 90)} 50`;
  if (/^(최근승인|최근결제|최근거래)$/.test(compactText)) return 'payments latest 10';
  if (/^(대기뭐있어|대기뭐야|대기있는거|대기건|미처리뭐있어|처리할거있어)$/.test(compactText)) return 'brief';
  if (/^(어제승인|어제결제|어제거래)$/.test(compactText)) return 'sales yesterday';
  if (/^(문의대기|선정산|지사문의|가맹점문의)$/.test(compactText)) return 'inquiry pending 10';
  if (/^(카드없는곳|카드미등록|카드누락)$/.test(compactText)) return 'franchise missing-cards 20';
  if (/^(계좌없는곳|계좌미등록|계좌누락)$/.test(compactText)) return 'franchise missing-accounts 20';
  if (itzbiExtractLookupQuery(text) && /(승인)/.test(lower) && !/(번호|승인번호|몇|건수|오늘)/.test(lower)) return `franchise payments "${itzbiExtractLookupQuery(text)}" 10`;
  if (itzbiExtractLookupQuery(text) && /(최근|최신|마지막)/.test(lower) && /(결제|거래|승인)/.test(lower)) return `franchise payments "${itzbiExtractLookupQuery(text)}" 10`;
  if (/(방금|최근|최신|마지막)/.test(lower) && /(결제|거래|승인)/.test(lower)) return 'payments latest 10';
  if (/(방금|최근|최신|마지막)/.test(lower) && /(입금|이체|돈)/.test(lower) && /(성공)/.test(lower)) return 'deposit transfer 10';
  if (/(방금|최근|최신|마지막)/.test(lower) && /(입금|이체|돈)/.test(lower)) return 'deposit latest 10';
  if (/(이번달|이번 달|이달|월간)/.test(lower) && /(장사|잘돼|잘 돼|많은곳|많은 곳|1등|일등|상위|랭킹|순위|흐름)/.test(lower)) return 'sales month';
  if (/(어제보다|어제랑|전일)/.test(lower) && /(어때|비교|차이|늘|줄|좋|나쁘|많|적)/.test(lower)) return 'sales compare';
  if (/(최근|최신|월간|이번달|이번 달)/.test(lower) && /(매출|결제|거래)/.test(lower) && /(흐름|추이|상황|어때)/.test(lower)) return 'sales month';
  if (/(tid|txid)/i.test(text) && /(없는|안\s*들어|안들어|미등록|누락|안\s*된|안된|곳|가맹점)/.test(lower)) return 'account missing-tid 20';
  if (/(관리자|어드민|admin)/i.test(text) && /(누가|목록|있어|계정|상태|현황|로그인)/.test(lower)) return 'admin status 20';
  if (/(변경|수정|로그|기록|바꿨|바꿨어)/.test(lower) && /(최근|누가|관리자|내역|보여|조회|확인|내가|뭘)/.test(lower)) return 'audit latest 20';
  if (/(pg|gh|위루트|routeup).*콜백|콜백.*(pg|gh|위루트|routeup)/i.test(text)) return 'guide pgCallback';
  if (/(가입\s*(url|링크)|가입코드|링크)/i.test(text) && /(가입|안양지사|대리점|지사|어디|보내|확인|보여|줘|있어|링크)/.test(lower)) return 'guide joinLink';
  if (/(오늘|지금|미처리|대기\s*업무|처리할|해야\s*할|뭐\s*확인|확인해야|브리핑)/.test(lower) && /(뭐|확인|처리|해야|할\s*일|업무|있어|알려|브리핑|요약)/.test(lower)) return 'brief';
  if (/(은행)/.test(lower) && /(어디|어디서|위치|메뉴|관리)/.test(lower)) return 'guide bankMenu';
  if (/(은행\\s*목록|은행별|은행.*현황)/.test(lower)) return 'account banks 20';
  if (/(대리점|지사|지점)/.test(lower) && /(등록\s*현황|현황|상위|랭킹|많은|순위)/.test(lower) && /(연락처|전화번호|휴대폰|카드|계좌|가맹점|상점|매장|업체|등록)/.test(lower)) return 'agency top 10';
  if (/(연락처|전화번호|휴대폰|카드|계좌|가맹점|상점|매장|업체)/.test(lower) && /(수|몇개|몇 개|많은|상위|순위|랭킹)/.test(lower) && /(대리점|지사|지점)/.test(lower)) return 'agency top 10';
  if (/(카드)/.test(lower) && /(등록\s*현황|현황|사용중|사용\s*중|카드사별|카드사)/.test(lower)) return 'stats cards';
  if (/(카드)/.test(lower) && /(등록\s*안|안\s*된|없는|미등록|누락)/.test(lower)) return 'franchise missing-cards 20';
  if (/(tid|txid)/i.test(text) && /(없는|미등록|누락|안\s*된|안들어|안\s*들어)/.test(lower)) return 'account missing-tid 20';
  if (/(계좌)/i.test(text) && /(없는|미등록|누락|안\s*된)/.test(lower)) return 'franchise missing-accounts 20';
  if (/(저축은행|상호저축은행중앙회|신한은행|우리은행|기업은행|국민은행|농협|하나은행|카카오뱅크|토스뱅크|케이뱅크)/.test(text) && /(쓰는|사용|계좌|가맹점|상점|매장|업체|곳)/.test(lower)) return `account list "${text.replace(/(쓰는|사용|들어간|들어가는|계좌|가맹점|상점|매장|업체|곳|보여|조회|찾아|알려|줘|해줘|좀|있어|있나|\?)/g, ' ').replace(/\s+/g, ' ').trim()}" 20`;
  if (/(대리점별|지사별)/.test(lower) && /(매출|결제|거래)/.test(lower)) return 'agency sales 10';
  if (/(가맹점|상점|매장|업체)/.test(lower) && /(매출|결제|거래|많이|상위|순위|랭킹|제일)/.test(lower)) {
    if (/(이번달|이달|월간|month)/.test(lower)) return 'sales month';
    if (/(누적|전체|총|total|all|cumulative)/.test(lower)) return 'sales all';
    if (/(어제|yesterday)/.test(lower)) return 'sales yesterday';
    return 'sales today';
  }
  if (/(이번달|이달|월간|이번 달)/.test(lower) && /(누적|얼마|금액|합계|총액)/.test(lower)) return 'sales month';
  if (/(누적|전체|총|합계|총액)/.test(lower) && /(얼마|금액|매출|결제|거래)/.test(lower)) return 'sales all';
  if (/(정산|입금)/.test(lower) && /(대기|누락|미입금|미정산|안\s*된|안된|몇\s*건|몇건)/.test(lower)) return 'settle pending 10';
  if (/(최근|최신|마지막)/.test(lower) && /(입금|이체)/.test(lower)) return 'deposit latest 10';
  if (/(gh payments|gh)/i.test(text) && /(노티|알림|notification|최근|보여|조회|확인)/.test(lower)) return 'noti provider gh';
  if (/(위루트|routeup)/i.test(text) && /(노티|알림|notification|최근|보여|조회|확인)/.test(lower)) return 'noti provider routeup';
  if (/(넥스트|nextpay|next pay)/i.test(text) && /(노티|알림|notification|최근|보여|조회|확인)/.test(lower)) return 'noti provider nextpay';
  if (/(엑셀|다운로드|download)/i.test(text) && /(어디|어떻게|방법|사용법|받아|내려)/.test(lower) && !/(해줘|해라|해 주세요|받아줘|다운로드해)/.test(lower)) return 'guide excel';
  if (/(tid|txid|업로드|upload)/i.test(text) && /(어디|어떻게|방법|사용법|상태|실패)/.test(lower) && !/(해줘|해라|해 주세요|올려줘|업로드해)/.test(lower)) return 'guide tidUpload';
  if (/(관리자페이지|관리자 페이지|사용법|뭐 할 수|어떻게 써|처음 안내|처음안내)/.test(lower)) return 'guide adminUsage';
  if (/(카카오|카톡|모비스테스트방|톡방)/.test(lower) && /(알림|갔|보냈|전송)/.test(lower)) return 'guide kakao';
  if (/(롤백|취소정산|취소된)/.test(lower) && /(정산)/.test(lower)) return 'settle rolledback 10';
  const earlyMoneyAmount = itzbiExtractMoneyAmount(text);
  if (earlyMoneyAmount && (/(입금|결제|거래|금액|찾아|확인|조회|정산)/.test(lower) || /[0-9,]+\s*(원|만원)/.test(text))) {
    const moneyLookup = itzbiExtractLookupQuery(text.replace(/[0-9,]+\s*(원|만원)/g, ' '));
    return 'money search ' + earlyMoneyAmount + (moneyLookup ? ' "' + moneyLookup + '"' : '');
  }
  const earlyLookup = itzbiExtractLookupQuery(text);
  if (earlyLookup && /(몇\s*개|몇개|몇\s*곳|몇곳|개수|갯수|몇\s*건|몇건)/.test(lower) && !/(대리점|지사|지점|카드|계좌|연락처|전화번호|휴대폰|은행)/.test(lower)) return `franchise count "${earlyLookup}" 20`;
  const referenceCode = itzbiExtractReferenceCode(text);
  if (referenceCode) return `explain ${referenceCode}`;
  const accountDigits = text.replace(/[^0-9]/g, '');
  if (accountDigits.length >= 5 && /(계좌|은행|예금주)/.test(lower)) return `account list "${accountDigits}" 20`;
  if (earlyLookup && /(됐|되었|됐나|되었나|정산|돈|들어왔|들어)/.test(lower) && !/(입금|이체|카드|계좌|문의|노티|알림)/.test(lower)) return `settle search "${earlyLookup}" 10`;
  if (earlyLookup && /(승인|결제|거래)/.test(lower) && /(내역|확인|됐|되었|보여|조회)/.test(lower)) return `franchise payments "${earlyLookup}" 10`;
  if (earlyLookup && /(실패|오류|거절)/.test(lower) && /(내역|확인|결제|승인|거래)/.test(lower)) return 'payments failed 10';
  if (/(롤백|취소정산)/.test(lower)) return 'settle rolledback 10';
  if (/(변경\s*기록|감사\s*로그|누가\s*수정|수정했|관리자\s*변경)/.test(lower)) return 'audit latest 20';
  if (/(가입\s*url|가입코드|개인정보|처리방침|약관)/i.test(text)) return 'guide menu';
  if (/(입금|이체)/.test(lower) && /(성공)/.test(lower)) return 'deposit transfer 10';
  if (/(입금|이체)/.test(lower) && /(알림|노티|최근|보여|조회|확인|들어왔)/.test(lower)) return 'deposit latest 10';
  if (/(비밀번호|비번|로그아웃)/.test(lower) && /(어디|어디서|위치|메뉴|바꿔|변경|확인|보여|뭐야|곳)/.test(lower)) return 'guide permission';
  if (/(대리점|지사)\s*관리/.test(lower) && /(어디|어디서|위치|메뉴|관리|보여|뭐야|곳)/.test(lower)) return 'guide agencyMenu';
  if (/(pg|gh|위루트|콜백|배너|공지|공지사항|faq|이용가이드|푸시|알림|대리점\\s*관리|배달대행사|무이자|할부|가맹점\\s*승인|계좌\\s*승인)/i.test(text) && /(어디|어디서|위치|메뉴|설정|관리|보내|올리는|바꿔|바꾸|받아|확인|보여|뭐야|곳)/.test(lower)) return 'guide menu';
  if (/(권한|메뉴)/.test(lower) && /(안\s*보|안보|없|이상|확인|뭐야|상태|계정)/.test(lower)) return 'guide permission';
  if (/(페이지|화면|로그인)/.test(lower) && /(이상|안\s*떠|안떠|안\s*열|안열|안돼|안\s*돼|오류|문제)/.test(lower)) return 'guide screen';
  const moneyAmount = itzbiExtractMoneyAmount(text);
  if (moneyAmount && (/(입금|결제|거래|금액|찾아|확인|조회|정산)/.test(lower) || /^\s*[0-9,]+\s*(원|만원)\s*$/.test(text))) return `money search ${moneyAmount}`;
    if (/(어제보다|비교|전일|어제랑)/.test(lower) && /(오늘|매출|결제|거래)/.test(lower)) return 'sales compare';
  if (/(관리자|어드민|admin|로그인)/i.test(text) && /(계정|상태|로그인|안되는|안\s*되는|비활성|목록|현황)/.test(lower)) return 'admin status 20';
  if (/(대리점별|지사별)/.test(lower) && /(가맹점|상점|매장|업체)/.test(lower) && /(수|몇개|몇 개|몇곳|몇 곳|현황)/.test(lower)) return 'agency top 10';
  if (/(이번달|이달|월간|month)/.test(lower) && /(가맹점|상점|매장|업체)/.test(lower) && /(매출|결제|거래|많이|상위|순위|랭킹|제일)/.test(lower)) return 'sales month';
  if (/(카드)/.test(lower) && /(등록된|등록|수|몇개|몇 개|현황)/.test(lower) && /(가맹점|상점|매장|업체)/.test(lower)) return 'stats cards';
  if (/(가맹점|상점|매장|업체)/.test(lower) && /(수|몇개|몇 개|몇곳|몇 곳|몇명|몇 명|count)/i.test(text)) return 'stats franchise';
  if (/(대리점|지사|지점)/.test(lower) && /(수|몇개|몇 개|몇곳|몇 곳|몇명|몇 명|count)/i.test(text)) return 'stats agency';
  if (/(최근|신규|새로|가입)/.test(lower) && /(가맹점|상점|매장|업체)/.test(lower)) return 'franchise recent 20';
  if (/(실패|오류|거절|취소|문제)/.test(lower) && /(결제|거래|승인|payment)/.test(lower)) return 'payments failed 10';
  if (!itzbiExtractLookupQuery(text) && /(최근|최신|마지막)/.test(lower) && /(결제|거래|승인)/.test(lower)) return 'payments latest 10';
  if (/(문의|상담|신청|선정산|지사\s*문의|가맹점\s*문의)/.test(lower) && /(대기|들어|왔|몇|확인|pending|최근|보여|조회|목록|문의|선정산|지사)/.test(lower)) return 'inquiry pending 10';
  if (/(대리점|지사|지점)/.test(lower) && /(상위|랭킹|많은|순위)/.test(lower) && /(연락처|전화번호|휴대폰)/.test(lower)) return 'agency top contacts 10';
  if (/(대리점|지사|지점)/.test(lower) && /(상위|랭킹|많은|순위)/.test(lower) && /(카드)/.test(lower)) return 'agency top cards 10';
  if (/(대리점|지사|지점)/.test(lower) && /(상위|랭킹|많은|순위)/.test(lower) && /(계좌)/.test(lower)) return 'agency top accounts 10';
  if (/(대리점|지사|지점)/.test(lower) && /(상위|랭킹|많은|순위)/.test(lower) && /(가맹점|상점|매장|업체)/.test(lower)) return 'agency top franchises 10';
  if (/(연락처|전화번호|휴대폰)/.test(lower) && /(상위|랭킹|많은|순위|대리점|지사|지점)/.test(lower)) return 'agency top contacts 10';
  if (/(카드)/.test(lower) && /(상위|랭킹|많은|순위|대리점|지사|지점)/.test(lower)) return 'agency top cards 10';
  if (/(계좌)/.test(lower) && /(상위|랭킹|많은|순위|대리점|지사|지점)/.test(lower)) return 'agency top accounts 10';
  const phoneQuery = itzbiExtractPhoneQuery(text);
  if (!phoneQuery && itzbiLooksLikeNameOnlyLookup(text)) return `contact list "${itzbiExtractLookupQuery(text)}" 20`;
  if (phoneQuery && (/(계좌|account)/.test(lower) || (!/^010/.test(phoneQuery) && phoneQuery.length >= 10))) return `account list "${phoneQuery}" 20`;
  if (phoneQuery && /(누구|어디|가맹점|상점|매장|업체|연락처|전화|번호)/.test(lower)) return `contact list "${phoneQuery}" 20`;
  const contactQuery = itzbiExtractContactQuery(text);
  if (contactQuery) return `contact list "${contactQuery}" 20`;
  if (/(오늘|지금)?\s*(처리할|해야 할|할 일|대기 업무|체크할)/.test(lower)) return 'brief';
  const lookupQuery = itzbiExtractLookupQuery(text);
  if (lookupQuery && /(최근|최신|마지막)/.test(lower) && !/(노티|알림|입금|정산|계좌|카드)/.test(lower)) return `franchise payments "${lookupQuery}" 10`;
  if (/^[가-힣A-Za-z0-9]{2,30}$/.test(text) && !/(정산|입금|계좌|카드|매출|결제|문의|노티|승인|취소|롤백|pg|PG|상태|헬스|도움)/.test(text)) return `contact list "${text}" 20`;
  if (/(대리점|지사|지점)/.test(lower) && /(목록|리스트|전체|보여|조회)/.test(lower) && !/(문의|매출|결제|카드|계좌|연락처|가맹점|상점|매장|업체)/.test(lower)) return 'agency list 20';
  if (/(pg사|pg 사|pg목록|pg 목록|pg 현황|pg 상태|pg provider|결제사 목록)/i.test(text)) return 'pg list';
  if (/(gh payments|gh)/i.test(text) && /(노티|알림|notification|최근)/.test(lower)) return 'noti provider gh';
  if (/(위루트|routeup)/i.test(text) && /(노티|알림|notification|최근)/.test(lower)) return 'noti provider routeup';
  if (/(넥스트|nextpay|next pay)/i.test(text) && /(노티|알림|notification|최근)/.test(lower)) return 'noti provider nextpay';
  if (lookupQuery && /(최근|최신|마지막)/.test(lower) && /(결제|거래|승인)/.test(lower)) return `franchise payments "${lookupQuery}" 10`;
  if (/(매출|결제|거래)/.test(lower) && /(알림|최근|최신)/.test(lower)) return 'payments latest 10';
  if (!itzbiExtractLookupQuery(text) && /(최근|최신|마지막)/.test(lower) && /(결제|거래|승인)/.test(lower)) return 'payments latest 10';
  if (/(롤백된|취소된|rolled)/.test(lower) && /(정산|settle)/.test(lower)) return 'settle rolledback 10';
  if (/(입금|정산)/.test(lower) && /(안된|안 된|누락|미입금|미정산|대기)/.test(lower)) return 'settle pending 10';
  if (/(계좌|account|tid|txid)/.test(lower) && /(은행별|은행.*현황|현황|통계)/.test(lower)) return 'account banks 20';
  if (/(계좌|account|tid|txid)/.test(lower) && /(완료|승인완료|approved|실패|오류|문제|반려|대기|승인|확인|몇)/.test(lower)) return 'account pending 10';
  if (/(승인|approved)/i.test(text) && /(오늘|몇|건수|몇건|몇 건)/.test(lower)) return 'sales today';
  if (/(수수료|fee)/i.test(text) && /(누적|전체|총|total|all|cumulative)/.test(lower)) return 'sales all';
  if (/(수수료|fee)/i.test(text) && /(이번달|이달|월간|month)/.test(lower)) return 'sales month';
  if (/(수수료|fee)/i.test(text) && /(어제|yesterday)/.test(lower)) return 'sales yesterday';
  if (/(수수료|fee)/i.test(text)) return 'sales today';
  if (lookupQuery && /(매출|결제|거래)/.test(lower) && !/(오늘|어제|누적|전체|총|이번달|이달|월간|상위|랭킹|순위)/.test(lower)) return `franchise payments "${lookupQuery}" 10`;
  if (lookupQuery && /(정산)/.test(lower) && !/(대기|완료|현황|상태|전체|요약|몇|건수)/.test(lower)) return `settle search "${lookupQuery}" 10`;
  if (lookupQuery && /(카드)/.test(lower) && !/(없는|미등록|누락|안된|안 된)/.test(lower)) return `card list "${lookupQuery}"`;
  if (lookupQuery && /(계좌|account|tid|txid)/.test(lower) && !/(대기|승인|오류|문제|확인|몇)/.test(lower)) return `account list "${lookupQuery}" 20`;
  if (/(상태|정보)/.test(lower) && /(가맹점|상점|매장|업체)/.test(lower) && !lookupQuery) return 'franchise status 20';
  if (lookupQuery && /(대리점|지사|지점)/.test(lower) && /(가맹점|상점|매장|업체)/.test(lower)) return `franchise status "${lookupQuery}" 20`;
  if (/(대리점|지사|지점)/.test(lower) && /(매출|결제|거래|결제금액|결제 금액)/.test(lower)) return 'agency sales 10';
  if (lookupQuery && /(정산)/.test(lower) && /(상태|내역|확인|보여|알려)/.test(lower)) return `settle search "${lookupQuery}" 10`;
  if (lookupQuery && /(상태|정보)/.test(lower) && !/(서버|헬스|health)/.test(lower)) return `franchise status "${lookupQuery}" 20`;
  if (/(최근|신규|새로|가입)/.test(lower) && /(가맹점|상점|매장|업체)/.test(lower)) return 'franchise recent 20';
  if (/(카드)/.test(lower) && /(없는|미등록|누락|안된|안 된)/.test(lower) && /(가맹점|상점|매장|업체)/.test(lower)) return 'franchise missing-cards 20';
  if (/(계좌)/.test(lower) && /(없는|미등록|누락|안된|안 된)/.test(lower) && /(가맹점|상점|매장|업체)/.test(lower)) return 'franchise missing-accounts 20';
  if (/(대리점|지사|지점)/.test(lower) && /(매출|결제|거래|결제금액|결제 금액)/.test(lower) && /(상위|랭킹|많은|순위)/.test(lower)) return 'agency sales 10';
  if (/(가맹점|상점|매장|업체)/.test(lower) && /(매출|결제|거래|결제금액|결제 금액)/.test(lower) && /(상위|랭킹|많은|순위)/.test(lower)) {
    if (/(누적|전체|총|total|all|cumulative)/.test(lower)) return 'sales all';
    if (/(이번달|이달|월간|month)/.test(lower)) return 'sales month';
    if (/(어제|yesterday)/.test(lower)) return 'sales yesterday';
    return 'sales today';
  }
  if (/(연락처|전화번호|휴대폰)/.test(lower) && !/(상위|랭킹|많은|순위)/.test(lower)) return 'contact list 20';
  const franchiseQuery = itzbiExtractFranchiseQuery(text);
  if (franchiseQuery) return `franchise payments "${franchiseQuery}" 10`;
  if (/(대리점|지사|지점)/.test(lower) && /(상위|랭킹|많은|순위)/.test(lower) && /(연락처|전화번호|휴대폰)/.test(lower)) return 'agency top contacts 10';
  if (/(대리점|지사|지점)/.test(lower) && /(상위|랭킹|많은|순위)/.test(lower) && /(카드)/.test(lower)) return 'agency top cards 10';
  if (/(대리점|지사|지점)/.test(lower) && /(상위|랭킹|많은|순위)/.test(lower) && /(계좌)/.test(lower)) return 'agency top accounts 10';
  if (/(대리점|지사|지점)/.test(lower) && /(상위|랭킹|많은|순위)/.test(lower) && /(가맹점|상점|매장|업체)/.test(lower)) return 'agency top franchises 10';
  if (/(연락처|전화번호|휴대폰)/.test(lower) && /(상위|랭킹|많은|순위|대리점|지사|지점)/.test(lower)) return 'agency top contacts 10';
  if (/(카드)/.test(lower) && /(상위|랭킹|많은|순위|대리점|지사|지점)/.test(lower)) return 'agency top cards 10';
  if (/(계좌)/.test(lower) && /(상위|랭킹|많은|순위|대리점|지사|지점)/.test(lower)) return 'agency top accounts 10';
  if (/(실패|오류|거절|취소|문제)/.test(lower) && /(결제|거래|승인|payment)/.test(lower)) return 'payments failed 10';
  if (/(매출|sales|결제|거래|결제금액|결제 금액)/.test(lower) && /(누적|전체|총|total|all|cumulative)/.test(lower)) return 'sales all';
  if (/(매출|sales|결제|거래|결제금액|결제 금액)/.test(lower) && /(이번달|이달|월간|month)/.test(lower)) return 'sales month';
  if (/(매출|sales|결제|거래|결제금액|결제 금액)/.test(lower) && /어제|yesterday/.test(lower)) return 'sales yesterday';
  if (/(매출|sales|결제|거래|결제금액|결제 금액)/.test(lower)) return 'sales today';
  if (/(문의|상담|신청)/.test(lower) && /(대기|들어|왔|몇|확인|pending|최근|보여|조회|목록)/.test(lower)) return 'inquiry pending 10';
  if (/(정산|settle)/.test(lower) && /(완료|현황|상태|전체|요약|몇|건수)/.test(lower) && !/(대기|누락|pending)/.test(lower)) return 'settle status';
  if (/(정산|settle)/.test(lower) && /(대기|누락|확인|pending|몇)/.test(lower)) return 'settle pending 10';
  if (/(계좌|account|tid|txid)/.test(lower) && /(실패|오류|문제|반려)/.test(lower)) return 'account pending 10';
  if (/(계좌|account|tid|txid)/.test(lower) && /(대기|승인|오류|문제|확인|몇|완료|승인완료|approved)/.test(lower)) return 'account pending 10';
  if (/입금|deposit|이체/.test(lower)) return 'deposit latest 10';
  if (/노티|noti|notification|pg|알림/.test(lower)) return 'noti latest 10';
  if (/상태|헬스|health|status/.test(lower)) return 'health';
  if (/요약|brief|브리핑|운영|대기 업무|처리할 것/.test(lower)) return 'brief';
  if (/^(도움|도움말|뭐 할 수 있어|무엇을 할 수 있어|help|commands|\?)$/i.test(text)) return 'help';
  return '';
}
async function notifyItzbiDeveloper(req, message, reason) {
  const developerEmail = SYSTEM_ADMIN_LOGIN_ID;
  try {
    const developer = await repo.findUserByLoginId(developerEmail);
    if (!developer?.id) {
      console.warn('[ITZBI_DEVELOPER_NOT_FOUND]', { developerEmail, reason });
      return false;
    }
    const title = '이츠비 운영DB 확인 요청';
    const body = `${req.user?.loginId || req.user?.email || '관리자'}: ${String(message || '').slice(0, 180)}`;
    const data = {
      source: 'itzbi',
      reason: reason || 'developer_required',
      requesterId: String(req.user?.id || ''),
      requesterEmail: String(req.user?.loginId || req.user?.email || ''),
      targetScreen: 'admin-audit-logs'
    };
    await repo.createNotification({ userId: developer.id, type: 'ITZBI_DEVELOPER_ALERT', title, body, data });
    await sendUserPushNotification(developer.id, { title, body, data });
    return true;
  } catch (err) {
    console.warn('[ITZBI_DEVELOPER_NOTIFY_FAILED]', {
      developerEmail,
      reason,
      message: err?.message || String(err)
    });
    return false;
  }
}

function avicxLimit(value, fallback = 20, max = 100) {
  const n = Number(value || fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function avicxExtractLimit(tokens, fallback = 20, max = 100) {
  const idx = tokens.findIndex(token => token.toLowerCase() === 'limit');
  if (idx >= 0) return avicxLimit(tokens[idx + 1], fallback, max);
  const tail = tokens[tokens.length - 1];
  if (/^\d+$/.test(tail || '')) return avicxLimit(tail, fallback, max);
  return fallback;
}

function avicxNormalizeProvider(input) {
  const value = String(input || '').trim().toLowerCase();
  if (!value || value === 'all') return '';
  if (['gh', 'ghpayments', 'ghpayment', 'gh-payments'].includes(value)) return 'GH Payments';
  if (['routeup', 'route', '위루트'].includes(value)) return '위루트';
  if (['next', 'nextpay', '넥스트페이'].includes(value)) return '넥스트페이';
  return String(input || '').trim();
}

function defaultFranchiseFeeRateForPg(provider) {
  return 4.4;
}

function avicxSessionId(value) {
  const raw = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{12,80}$/.test(raw) ? raw : crypto.randomBytes(18).toString('base64url');
}

async function touchAvicxSession(req, requestedId) {
  const sessionId = avicxSessionId(requestedId);
  await pool.query(
    `INSERT INTO admin_console_sessions (id, admin_user_id, admin_email, updated_at, last_seen_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       admin_user_id = EXCLUDED.admin_user_id,
       admin_email = EXCLUDED.admin_email,
       updated_at = now(),
       last_seen_at = now()`,
    [sessionId, req.user?.id || null, req.user?.email || req.user?.loginId || null]
  );
  return sessionId;
}

async function recordAvicxCommand(sessionId, req, command, status, output) {
  await pool.query(
    `INSERT INTO admin_console_commands (session_id, admin_user_id, command, status, output)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [sessionId, req.user?.id || null, command, status, JSON.stringify(output || {})]
  );
}

async function avicxRows(query, params = []) {
  const result = await pool.query(query, params);
  return result.rows;
}

function itzbiLearningKey(text) {
  return String(text || '').toLowerCase().replace(/[\s?!？.。~]+/g, '').trim();
}

function itzbiIsAllowedLearnedCommand(commandText) {
  const tokens = String(commandText || '').trim().match(/"[^"]*"|'[^']*'|\S+/g)?.map(token => token.replace(/^["']|["']$/g, '')) || [];
  const cmd = String(tokens[0] || '').toLowerCase();
  return ['help','guide','brief','health','stats','sales','money','payments','franchise','settle','account','card','agency','contact','pg','noti','deposit','inquiry','admin','audit','explain'].includes(cmd);
}

function itzbiParseTeachingMessage(message) {
  const text = String(message || '').trim();
  if (!text) return null;
  const direct = text.match(/^(?:가르쳐|학습|learn)\s*[:：]?\s*(.+?)\s*(?:=>|->|→)\s*(.+)$/i);
  if (direct) {
    const triggerText = direct[1].trim();
    const commandText = direct[2].trim();
    if (!triggerText || !commandText) return null;
    return { triggerText, commandText, description: 'manual command mapping' };
  }
  const natural = text.match(/^(.+?)\s*(?:라고\s*하면|이라고\s*하면|라면|이라고\s*물으면|라고\s*물으면)\s*(.+)$/);
  if (!natural) return null;
  const triggerText = natural[1].trim().replace(/^['"]|['"]$/g, '').trim();
  const intentText = natural[2].trim();
  const intentTarget = intentText.match(/(?:이름|명)에\s*([가-힣A-Za-z0-9 ._-]{2,40}?)(?:이|가)?\s*(?:들어간|포함|검색)/);
  const q = intentTarget ? intentTarget[1].trim() : itzbiExtractLookupQuery(triggerText);
  if (q && /(가맹점|상점|매장|업체).*(이름|명)?.*(들어간|포함|검색).*(수|개|곳|몇)|가맹점.*(수|개수|갯수)/.test(intentText)) {
    return { triggerText, commandText: `franchise count "${q}" 20`, description: intentText.slice(0, 200) };
  }
  if (q && /(가맹점|상점|매장|업체).*(목록|리스트|찾아|검색|보여)/.test(intentText)) {
    return { triggerText, commandText: `franchise search "${q}"`, description: intentText.slice(0, 200) };
  }
  if (q && /(결제|거래|승인).*(내역|목록|최근|보여|조회)/.test(intentText)) {
    return { triggerText, commandText: `franchise payments "${q}" 10`, description: intentText.slice(0, 200) };
  }
  return null;
}

async function saveItzbiLearningRule(req, teaching) {
  if (!teaching?.triggerText || !teaching?.commandText) return avicxLines(['학습할 질문과 실행 명령을 찾지 못했어요.'], 'warn');
  if (!itzbiIsAllowedLearnedCommand(teaching.commandText)) {
    return avicxLines([
      '읽기 조회 명령만 학습할 수 있어요.',
      '예: 가르쳐: 교촌치킨 몇개야 => franchise count "교촌치킨" 20'
    ], 'warn');
  }
  const key = itzbiLearningKey(teaching.triggerText);
  if (!key) return avicxLines(['학습할 질문을 찾지 못했어요.'], 'warn');
  const rows = await avicxRows(
    `INSERT INTO itzbi_learning_rules (trigger_text, trigger_key, command_text, description, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (trigger_key) DO UPDATE
       SET trigger_text = EXCLUDED.trigger_text,
           command_text = EXCLUDED.command_text,
           description = EXCLUDED.description,
           active = true,
           updated_at = now()
     RETURNING id, trigger_text, command_text`,
    [teaching.triggerText, key, teaching.commandText, teaching.description || '', req.user?.id || null]
  );
  const rule = rows[0];
  return avicxLines([
    `학습 완료: #${rule.id}`,
    `질문: ${rule.trigger_text}`,
    `실행: ${rule.command_text}`,
    '다음 질문부터 이 규칙을 먼저 적용할게요.'
  ], 'success');
}

async function findItzbiLearnedCommand(message) {
  const key = itzbiLearningKey(message);
  if (!key) return '';
  const rows = await avicxRows(
    `SELECT command_text
       FROM itzbi_learning_rules
      WHERE active = true AND trigger_key = $1
      ORDER BY priority ASC, id DESC
      LIMIT 1`,
    [key]
  );
  return rows[0]?.command_text || '';
}
async function avicxRunCodexCli(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return avicxLines(['질문 내용을 입력해 주세요.'], 'warn');
  const codexBin = String(process.env.AVICX_CODEX_BIN || '/usr/bin/codex').trim();
  const cwd = String(process.env.AVICX_CODEX_CWD || __dirname).trim();
  const timeoutMs = Math.max(10000, Math.min(Number(process.env.AVICX_CODEX_TIMEOUT_MS || 30000), 120000));
  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', cwd, text];
  return await new Promise(resolve => {
    const child = execFile(codexBin, args, {
      cwd,
      env: {
        ...process.env,
        HOME: process.env.AVICX_CODEX_HOME_DIR || '/opt/eatspay/.codex-runtime/home',
        CODEX_HOME: process.env.AVICX_CODEX_HOME || '/opt/eatspay/.codex-runtime',
        XDG_CACHE_HOME: process.env.AVICX_CODEX_CACHE_HOME || '/opt/eatspay/.codex-runtime/xdg-cache',
        XDG_CONFIG_HOME: process.env.AVICX_CODEX_CONFIG_HOME || '/opt/eatspay/.codex-runtime/xdg-config',
        XDG_DATA_HOME: process.env.AVICX_CODEX_DATA_HOME || '/opt/eatspay/.codex-runtime/xdg-data',
        TMPDIR: process.env.AVICX_CODEX_TMPDIR || '/opt/eatspay/.codex-runtime/tmp',
        CI: '1',
        NO_COLOR: '1'
      },
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024
    }, (error, stdout = '', stderr = '') => {
      const cleanOut = String(stdout || '').trim();
      const cleanErr = String(stderr || '').trim();
      if (error) {
        const merged = `${cleanErr}\n${cleanOut}`;
        let message = cleanErr || cleanOut || '출력이 없습니다.';
        if (/401 Unauthorized|Missing bearer|basic authentication/i.test(merged)) {
          message = '답변 기능 인증 설정을 확인해야 합니다.';
        } else if (/Permission denied|os error 13/i.test(merged)) {
          message = '답변 기능 권한 설정을 확인해야 합니다.';
        } else if (error.killed) {
          message = `답변 준비 시간이 ${Math.round(timeoutMs / 1000)}초를 초과했습니다.`;
        }
        const lines = [
          `답변 생성 실패: ${error.killed ? 'timeout' : (error.code || 'error')}`,
          message
        ];
        return resolve(avicxLines(lines, 'error'));
      }
      return resolve(avicxLines((cleanOut || '답변할 내용이 없습니다.').split(/\r?\n/).slice(0, 80), 'success'));
    });
    if (child.stdin) child.stdin.end();
  });
}


function avicxLooksLikeDestructiveDataRequest(text) {
  const value = String(text || '').toLowerCase();
  const destructive = /(삭제|지워|제거|탈퇴|초기화|delete|drop|truncate|remove)/i.test(value);
  const dataTarget = /(가맹점|계정|카드|결제|정산|db|database|table|user|franchise|card|payment|settlement)/i.test(value);
  return destructive && dataTarget;
}

async function avicxRunCodexApply(prompt) {
  const text = String(prompt || '').trim();
  if (!text) {
    return avicxLines([
      '사용법: codex apply 수정요청',
      '현재 codex apply는 제안 모드입니다. 파일/DB를 직접 변경하지 않습니다.',
      '예: codex apply PG 관리 버튼 위치를 수정하려면 어떤 파일을 바꿔야 해?'
    ], 'warn');
  }
  if (avicxLooksLikeDestructiveDataRequest(text)) {
    return avicxLines([
      'codex apply는 운영 DB 삭제를 직접 실행하지 않습니다.',
      '가맹점/카드/결제/정산 삭제는 전용 승인 명령이나 관리자 화면에서 처리해야 합니다.',
      '먼저 확인용 명령을 사용하세요: franchise search <가맹점명> 또는 card list <가맹점명>'
    ], 'warn');
  }
  const result = await avicxRunCodexCli([
    'AVICX codex apply 제안 모드입니다.',
    '운영 서버의 파일, DB, 서비스는 직접 변경하지 마세요.',
    '요청을 처리하려면 어떤 파일/함수/명령이 필요한지 한국어로 간결하게 제안하세요.',
    `요청: ${text}`
  ].join('\n'));
  return {
    type: 'group',
    sections: [
      avicxLines(['codex apply: 제안 모드입니다. 직접 변경은 하지 않습니다.'], 'warn'),
      result
    ]
  };
}

function avicxPad2(value) {
  return String(value).padStart(2, '0');
}

function avicxKstYmd(offsetDays = 0) {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  return `${kst.getUTCFullYear()}-${avicxPad2(kst.getUTCMonth() + 1)}-${avicxPad2(kst.getUTCDate())}`;
}

function avicxResolveSalesDate(token) {
  const value = String(token || 'today').trim().toLowerCase();
  if (!value || value === 'today' || value === '오늘') return avicxKstYmd(0);
  if (value === 'yesterday' || value === '어제') return avicxKstYmd(-1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return '';
}

function avicxWon(value) {
  const num = Number(value || 0);
  return `${Math.round(num).toLocaleString('ko-KR')}원`;
}

function avicxNumber(value) {
  return Number(value || 0).toLocaleString('ko-KR');
}

async function avicxSalesCompareReport() {
  const today = avicxKstYmd(0);
  const yesterday = avicxKstYmd(-1);
  const rows = await avicxRows(
    `WITH ranges AS (
       SELECT '오늘' AS label, $1::timestamptz AS start_at, ($1::timestamptz + interval '1 day') AS end_at
       UNION ALL
       SELECT '어제' AS label, $2::timestamptz AS start_at, ($2::timestamptz + interval '1 day') AS end_at
     )
     SELECT r.label,
            count(t.transaction_id)::int AS count,
            COALESCE(sum(t.amount),0)::numeric AS amount,
            COALESCE(sum(t.fee),0)::numeric AS fee,
            COALESCE(sum(t.total_amount),0)::numeric AS total,
            COALESCE(avg(t.total_amount),0)::numeric AS avg_total
       FROM ranges r
       LEFT JOIN transactions t ON t.created_at >= r.start_at AND t.created_at < r.end_at
      GROUP BY r.label
      ORDER BY CASE r.label WHEN '오늘' THEN 1 ELSE 2 END`,
    [`${today} 00:00:00+09`, `${yesterday} 00:00:00+09`]
  );
  const todayRow = rows.find(row => row.label === '오늘') || {};
  const yesterdayRow = rows.find(row => row.label === '어제') || {};
  const todayTotal = Number(todayRow.total || 0);
  const yesterdayTotal = Number(yesterdayRow.total || 0);
  const diff = todayTotal - yesterdayTotal;
  const diffRate = yesterdayTotal > 0 ? `${((diff / yesterdayTotal) * 100).toFixed(1)}%` : '-';
  return {
    type: 'group',
    sections: [
      avicxLines([
        `오늘/어제 매출 비교 (${today} vs ${yesterday})`,
        `오늘: ${avicxWon(todayRow.total)} / ${avicxNumber(todayRow.count)}건 / 객단가 ${avicxWon(todayRow.avg_total)}`,
        `어제: ${avicxWon(yesterdayRow.total)} / ${avicxNumber(yesterdayRow.count)}건 / 객단가 ${avicxWon(yesterdayRow.avg_total)}`,
        `차이: ${diff >= 0 ? '+' : ''}${avicxWon(diff)} / ${diffRate}`
      ], diff >= 0 ? 'success' : 'warn'),
      avicxTable(['day', 'count', 'amount', 'fee', 'total', 'avg'], rows.map(row => ({
        day: row.label,
        count: avicxNumber(row.count),
        amount: avicxWon(row.amount),
        fee: avicxWon(row.fee),
        total: avicxWon(row.total),
        avg: avicxWon(row.avg_total)
      })))
    ]
  };
}
async function avicxSalesReport(tokens) {
  const scope = String(tokens[1] || '').trim().toLowerCase();
  if (['all', 'total', 'cumulative', '전체', '누적', '총'].includes(scope)) return avicxCumulativeSalesReport();
  if (['month', 'monthly', '이번달', '이달', '월간'].includes(scope)) return avicxMonthSalesReport();
  const ymd = avicxResolveSalesDate(tokens[1]);
  if (!ymd) return avicxLines(['사용법: sales today | sales yesterday | sales YYYY-MM-DD'], 'warn');
  const start = `${ymd} 00:00:00+09`;
  const end = `${ymd} 00:00:00+09`;
  const params = [start, end];
  const txSummary = await avicxRows(
    `SELECT count(*)::int AS count,
            COALESCE(sum(amount),0)::numeric AS amount,
            COALESCE(sum(fee),0)::numeric AS fee,
            COALESCE(sum(total_amount),0)::numeric AS total,
            COALESCE(avg(total_amount),0)::numeric AS avg_total
       FROM transactions
      WHERE created_at >= $1::timestamptz
        AND created_at < ($2::timestamptz + interval '1 day')`,
    params
  );
  const settlementSummary = await avicxRows(
    `SELECT count(*)::int AS count,
            COALESCE(sum(payment_amt),0)::numeric AS payment,
            COALESCE(sum(svc_fee),0)::numeric AS fee,
            COALESCE(sum(net_amt),0)::numeric AS net
       FROM pg_settlements
      WHERE created_at >= $1::timestamptz
        AND created_at < ($2::timestamptz + interval '1 day')`,
    params
  );
  const statusRows = await avicxRows(
    `SELECT COALESCE(NULLIF(status,''), '-') AS status,
            count(*)::int AS count,
            COALESCE(sum(total_amount),0)::numeric AS total
       FROM transactions
      WHERE created_at >= $1::timestamptz
        AND created_at < ($2::timestamptz + interval '1 day')
      GROUP BY COALESCE(NULLIF(status,''), '-')
      ORDER BY total DESC, count DESC`,
    params
  );
  const pgRows = await avicxRows(
    `SELECT COALESCE(NULLIF(pg,''), '미지정') AS pg,
            count(*)::int AS count,
            COALESCE(sum(total_amount),0)::numeric AS total,
            COALESCE(sum(fee),0)::numeric AS fee
       FROM transactions
      WHERE created_at >= $1::timestamptz
        AND created_at < ($2::timestamptz + interval '1 day')
      GROUP BY COALESCE(NULLIF(pg,''), '미지정')
      ORDER BY total DESC, count DESC`,
    params
  );
  const hourlyRows = await avicxRows(
    `SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul', 'HH24') AS hour,
            count(*)::int AS count,
            COALESCE(sum(total_amount),0)::numeric AS total
       FROM transactions
      WHERE created_at >= $1::timestamptz
        AND created_at < ($2::timestamptz + interval '1 day')
      GROUP BY hour
      ORDER BY hour ASC`,
    params
  );
  const topRows = await avicxRows(
    `SELECT COALESCE(u.franchise_name, '가맹점 ' || t.franchise_id::text) AS franchise,
            count(*)::int AS count,
            COALESCE(sum(t.total_amount),0)::numeric AS total,
            COALESCE(sum(t.fee),0)::numeric AS fee
       FROM transactions t
       LEFT JOIN users u ON u.franchise_id = t.franchise_id
      WHERE t.created_at >= $1::timestamptz
        AND t.created_at < ($2::timestamptz + interval '1 day')
      GROUP BY COALESCE(u.franchise_name, '가맹점 ' || t.franchise_id::text)
      ORDER BY total DESC, count DESC
      LIMIT 10`,
    params
  );
  const tx = txSummary[0] || {};
  const st = settlementSummary[0] || {};
  const peak = hourlyRows.reduce((best, row) => Number(row.total || 0) > Number(best?.total || 0) ? row : best, null);
  return {
    type: 'group',
    sections: [
      avicxLines([
        `매출 분석: ${ymd} (한국시간)`,
        `거래 매출: ${avicxWon(tx.total)} / ${avicxNumber(tx.count)}건 / 객단가 ${avicxWon(tx.avg_total)}`,
        `거래 원금: ${avicxWon(tx.amount)} / 수수료: ${avicxWon(tx.fee)}`,
        `PG 정산: 결제 ${avicxWon(st.payment)} / 수수료 ${avicxWon(st.fee)} / 입금 ${avicxWon(st.net)} / ${avicxNumber(st.count)}건`,
        peak ? `피크 시간대: ${peak.hour}시 (${avicxWon(peak.total)}, ${avicxNumber(peak.count)}건)` : '피크 시간대: 데이터 없음'
      ], 'success'),
      avicxTable(['status', 'count', 'total'], statusRows.map(row => ({ status: row.status, count: avicxNumber(row.count), total: avicxWon(row.total) }))),
      avicxTable(['pg', 'count', 'total', 'fee'], pgRows.map(row => ({ pg: row.pg, count: avicxNumber(row.count), total: avicxWon(row.total), fee: avicxWon(row.fee) }))),
      avicxTable(['hour', 'count', 'total'], hourlyRows.map(row => ({ hour: `${row.hour}시`, count: avicxNumber(row.count), total: avicxWon(row.total) }))),
      avicxTable(['franchise', 'count', 'total', 'fee'], topRows.map(row => ({ franchise: row.franchise, count: avicxNumber(row.count), total: avicxWon(row.total), fee: avicxWon(row.fee) })))
    ]
  };
}

async function avicxMonthSalesReport() {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const year = kst.getFullYear();
  const month = String(kst.getMonth() + 1).padStart(2, '0');
  const start = `${year}-${month}-01 00:00:00+09`;
  const nextMonth = kst.getMonth() === 11
    ? `${year + 1}-01-01 00:00:00+09`
    : `${year}-${String(kst.getMonth() + 2).padStart(2, '0')}-01 00:00:00+09`;
  const params = [start, nextMonth];
  const [txSummary, settlementSummary, pgRows, dailyRows, topRows] = await Promise.all([
    avicxRows(
      `SELECT count(*)::int AS count,
              COALESCE(sum(amount),0)::numeric AS amount,
              COALESCE(sum(fee),0)::numeric AS fee,
              COALESCE(sum(total_amount),0)::numeric AS total,
              COALESCE(avg(total_amount),0)::numeric AS avg_total
         FROM transactions
        WHERE created_at >= $1::timestamptz
          AND created_at < $2::timestamptz`,
      params
    ),
    avicxRows(
      `SELECT count(*)::int AS count,
              COALESCE(sum(payment_amt),0)::numeric AS payment,
              COALESCE(sum(svc_fee),0)::numeric AS fee,
              COALESCE(sum(net_amt),0)::numeric AS net
         FROM pg_settlements
        WHERE created_at >= $1::timestamptz
          AND created_at < $2::timestamptz`,
      params
    ),
    avicxRows(
      `SELECT COALESCE(NULLIF(pg,''), '미지정') AS pg,
              count(*)::int AS count,
              COALESCE(sum(total_amount),0)::numeric AS total,
              COALESCE(sum(fee),0)::numeric AS fee
         FROM transactions
        WHERE created_at >= $1::timestamptz
          AND created_at < $2::timestamptz
        GROUP BY COALESCE(NULLIF(pg,''), '미지정')
        ORDER BY total DESC, count DESC`,
      params
    ),
    avicxRows(
      `SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day,
              count(*)::int AS count,
              COALESCE(sum(total_amount),0)::numeric AS total
         FROM transactions
        WHERE created_at >= $1::timestamptz
          AND created_at < $2::timestamptz
        GROUP BY day
        ORDER BY day DESC
        LIMIT 31`,
      params
    ),
    avicxRows(
      `SELECT COALESCE(u.franchise_name, '가맹점 ' || t.franchise_id::text) AS franchise,
              count(*)::int AS count,
              COALESCE(sum(t.total_amount),0)::numeric AS total,
              COALESCE(sum(t.fee),0)::numeric AS fee
         FROM transactions t
         LEFT JOIN users u ON u.franchise_id = t.franchise_id
        WHERE t.created_at >= $1::timestamptz
          AND t.created_at < $2::timestamptz
        GROUP BY COALESCE(u.franchise_name, '가맹점 ' || t.franchise_id::text)
        ORDER BY total DESC, count DESC
        LIMIT 10`,
      params
    )
  ]);
  const tx = txSummary[0] || {};
  const st = settlementSummary[0] || {};
  return {
    type: 'group',
    sections: [
      avicxLines([
        `월간 매출 분석: ${year}-${month} (한국시간)`,
        `거래 매출: ${avicxWon(tx.total)} / ${avicxNumber(tx.count)}건 / 객단가 ${avicxWon(tx.avg_total)}`,
        `거래 원금: ${avicxWon(tx.amount)} / 수수료: ${avicxWon(tx.fee)}`,
        `PG 정산: 결제 ${avicxWon(st.payment)} / 수수료 ${avicxWon(st.fee)} / 입금 ${avicxWon(st.net)} / ${avicxNumber(st.count)}건`
      ], 'success'),
      avicxTable(['pg', 'count', 'total', 'fee'], pgRows.map(row => ({ pg: row.pg, count: avicxNumber(row.count), total: avicxWon(row.total), fee: avicxWon(row.fee) }))),
      avicxTable(['day', 'count', 'total'], dailyRows.map(row => ({ day: row.day, count: avicxNumber(row.count), total: avicxWon(row.total) }))),
      avicxTable(['franchise', 'count', 'total', 'fee'], topRows.map(row => ({ franchise: row.franchise, count: avicxNumber(row.count), total: avicxWon(row.total), fee: avicxWon(row.fee) })))
    ]
  };
}
async function avicxCumulativeSalesReport() {
  const [txSummary, settlementSummary, pgRows, monthlyRows, topRows] = await Promise.all([
    avicxRows(
      `SELECT count(*)::int AS count,
              COALESCE(sum(amount),0)::numeric AS amount,
              COALESCE(sum(fee),0)::numeric AS fee,
              COALESCE(sum(total_amount),0)::numeric AS total,
              COALESCE(avg(total_amount),0)::numeric AS avg_total,
              min(created_at) AS first_at,
              max(created_at) AS last_at
         FROM transactions`
    ),
    avicxRows(
      `SELECT count(*)::int AS count,
              COALESCE(sum(payment_amt),0)::numeric AS payment,
              COALESCE(sum(svc_fee),0)::numeric AS fee,
              COALESCE(sum(net_amt),0)::numeric AS net
         FROM pg_settlements`
    ),
    avicxRows(
      `SELECT COALESCE(NULLIF(pg,''), '미지정') AS pg,
              count(*)::int AS count,
              COALESCE(sum(total_amount),0)::numeric AS total,
              COALESCE(sum(fee),0)::numeric AS fee
         FROM transactions
        GROUP BY COALESCE(NULLIF(pg,''), '미지정')
        ORDER BY total DESC, count DESC
        LIMIT 10`
    ),
    avicxRows(
      `SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM') AS month,
              count(*)::int AS count,
              COALESCE(sum(total_amount),0)::numeric AS total
         FROM transactions
        GROUP BY date_trunc('month', created_at AT TIME ZONE 'Asia/Seoul')
        ORDER BY month DESC
        LIMIT 12`
    ),
    avicxRows(
      `SELECT COALESCE(u.franchise_name, '가맹점 ' || t.franchise_id::text) AS franchise,
              count(*)::int AS count,
              COALESCE(sum(t.total_amount),0)::numeric AS total,
              COALESCE(sum(t.fee),0)::numeric AS fee
         FROM transactions t
         LEFT JOIN users u ON u.franchise_id = t.franchise_id
        GROUP BY COALESCE(u.franchise_name, '가맹점 ' || t.franchise_id::text)
        ORDER BY total DESC, count DESC
        LIMIT 10`
    )
  ]);
  const tx = txSummary[0] || {};
  const st = settlementSummary[0] || {};
  const period = tx.first_at && tx.last_at
    ? `${avicxFormatKstDateTime(tx.first_at)} ~ ${avicxFormatKstDateTime(tx.last_at)}`
    : '거래 데이터 없음';
  return {
    type: 'group',
    sections: [
      avicxLines([
        '누적 매출 분석: 전체 기간',
        `조회 기간: ${period}`,
        `누적 거래 매출: ${avicxWon(tx.total)} / ${avicxNumber(tx.count)}건 / 객단가 ${avicxWon(tx.avg_total)}`,
        `누적 거래 원금: ${avicxWon(tx.amount)} / 수수료: ${avicxWon(tx.fee)}`,
        `누적 PG 정산: 결제 ${avicxWon(st.payment)} / 수수료 ${avicxWon(st.fee)} / 입금 ${avicxWon(st.net)} / ${avicxNumber(st.count)}건`
      ], 'success'),
      avicxTable(['pg', 'count', 'total', 'fee'], pgRows.map(row => ({ pg: row.pg, count: avicxNumber(row.count), total: avicxWon(row.total), fee: avicxWon(row.fee) }))),
      avicxTable(['month', 'count', 'total'], monthlyRows.map(row => ({ month: row.month, count: avicxNumber(row.count), total: avicxWon(row.total) }))),
      avicxTable(['franchise', 'count', 'total', 'fee'], topRows.map(row => ({ franchise: row.franchise, count: avicxNumber(row.count), total: avicxWon(row.total), fee: avicxWon(row.fee) })))
    ]
  };
}
function avicxDelta(current, previous, unit = '원') {
  const now = Number(current || 0);
  const before = Number(previous || 0);
  const diff = now - before;
  if (!before && !now) return '변동 없음';
  if (!before) return `신규 +${unit === '건' ? avicxNumber(diff) + '건' : avicxWon(diff)}`;
  const pct = (diff / before) * 100;
  const sign = diff >= 0 ? '+' : '';
  const diffText = unit === '건' ? `${sign}${avicxNumber(diff)}건` : `${sign}${avicxWon(diff)}`;
  return `${diffText} (${sign}${pct.toFixed(1)}%)`;
}

async function avicxTodayBrief() {
  const today = avicxKstYmd(0);
  const yesterday = avicxKstYmd(-1);
  const todayParams = [`${today} 00:00:00+09`, `${today} 00:00:00+09`];
  const yesterdayParams = [`${yesterday} 00:00:00+09`, `${yesterday} 00:00:00+09`];
  const [todaySales, yesterdaySales, pendingAccounts, pendingSettle, inquiryCounts, notiSummary, depositSummary, pgRows, recentFailures] = await Promise.all([
    avicxRows(
      `SELECT count(*)::int AS count,
              COALESCE(sum(amount),0)::numeric AS amount,
              COALESCE(sum(fee),0)::numeric AS fee,
              COALESCE(sum(total_amount),0)::numeric AS total,
              COALESCE(avg(total_amount),0)::numeric AS avg_total
         FROM transactions
        WHERE created_at >= $1::timestamptz
          AND created_at < ($2::timestamptz + interval '1 day')`,
      todayParams
    ),
    avicxRows(
      `SELECT count(*)::int AS count,
              COALESCE(sum(total_amount),0)::numeric AS total,
              COALESCE(avg(total_amount),0)::numeric AS avg_total
         FROM transactions
        WHERE created_at >= $1::timestamptz
          AND created_at < ($2::timestamptz + interval '1 day')`,
      yesterdayParams
    ),
    avicxRows("SELECT count(*)::int AS count FROM account_requests WHERE status IN ('PENDING','검증전','승인 대기','대기')"),
    avicxRows("SELECT count(*)::int AS count, COALESCE(sum(net_amt),0)::numeric AS net FROM pg_settlements WHERE status IN ('정산대기','PENDING','pending') OR settled_at IS NULL"),
    avicxRows(
      `SELECT
         (SELECT count(*)::int FROM agency_inquiries WHERE status = '상담 대기') AS agency,
         (SELECT count(*)::int FROM advance_inquiries WHERE status = '상담 대기') AS advance`
    ),
    avicxRows(
      `SELECT count(*)::int AS count_24h,
              count(*) FILTER (WHERE received_at > now() - interval '1 hour')::int AS count_1h,
              count(*) FILTER (WHERE processed IS FALSE)::int AS unprocessed
         FROM pg_notifications
        WHERE received_at > now() - interval '24 hours'`
    ),
    avicxRows(
      `SELECT count(*)::int AS count_24h,
              count(*) FILTER (WHERE received_at > now() - interval '1 hour')::int AS count_1h,
              count(*) FILTER (WHERE processed IS FALSE)::int AS unprocessed,
              COALESCE(sum(amount),0)::numeric AS amount
         FROM deposit_notifications
        WHERE received_at > now() - interval '24 hours'`
    ),
    avicxRows(
      `SELECT COALESCE(NULLIF(pg,''), '미지정') AS pg,
              count(*)::int AS count,
              COALESCE(sum(total_amount),0)::numeric AS total
         FROM transactions
        WHERE created_at >= $1::timestamptz
          AND created_at < ($2::timestamptz + interval '1 day')
        GROUP BY COALESCE(NULLIF(pg,''), '미지정')
        ORDER BY total DESC, count DESC
        LIMIT 8`,
      todayParams
    ),
    avicxRows(
      `SELECT transaction_id, pg, pg_tx_id, auth_code, status, total_amount, created_at
         FROM transactions
        WHERE created_at >= $1::timestamptz
          AND created_at < ($2::timestamptz + interval '1 day')
          AND status NOT IN ('SUCCESS','정상','승인','APPROVED')
        ORDER BY created_at DESC
        LIMIT 8`,
      todayParams
    )
  ]);
  const t = todaySales[0] || {};
  const y = yesterdaySales[0] || {};
  const acc = pendingAccounts[0]?.count || 0;
  const settle = pendingSettle[0] || {};
  const inquiries = inquiryCounts[0] || {};
  const noti = notiSummary[0] || {};
  const dep = depositSummary[0] || {};
  const actionLines = [];
  if (Number(acc) > 0) actionLines.push(`계좌 검증 대기 ${avicxNumber(acc)}건`);
  if (Number(settle.count || 0) > 0) actionLines.push(`정산 대기 ${avicxNumber(settle.count)}건 / ${avicxWon(settle.net)}`);
  if (Number(inquiries.agency || 0) + Number(inquiries.advance || 0) > 0) actionLines.push(`상담 대기 ${avicxNumber(Number(inquiries.agency || 0) + Number(inquiries.advance || 0))}건`);
  if (Number(noti.unprocessed || 0) > 0) actionLines.push(`미처리 PG 노티 ${avicxNumber(noti.unprocessed)}건`);
  if (Number(dep.unprocessed || 0) > 0) actionLines.push(`미처리 입금 노티 ${avicxNumber(dep.unprocessed)}건`);
  if (!actionLines.length) actionLines.push('즉시 처리할 대기 항목 없음');
  return {
    type: 'group',
    sections: [
      avicxLines([
        `오늘 브리핑: ${today} (한국시간)`,
        `오늘 매출: ${avicxWon(t.total)} / ${avicxNumber(t.count)}건 / 객단가 ${avicxWon(t.avg_total)}`,
        `어제 대비: 매출 ${avicxDelta(t.total, y.total)} / 건수 ${avicxDelta(t.count, y.count, '건')}`,
        `수수료: ${avicxWon(t.fee)} / 원금 ${avicxWon(t.amount)}`,
        `노티: PG 24h ${avicxNumber(noti.count_24h)}건(1h ${avicxNumber(noti.count_1h)}건) / 입금 24h ${avicxNumber(dep.count_24h)}건 ${avicxWon(dep.amount)}`
      ], 'success'),
      avicxLines(actionLines.map(line => `처리 필요: ${line}`), actionLines[0] === '즉시 처리할 대기 항목 없음' ? 'success' : 'warn'),
      avicxTable(['pg', 'count', 'total'], pgRows.map(row => ({ pg: row.pg, count: avicxNumber(row.count), total: avicxWon(row.total) }))),
      avicxTable(['type', 'count'], [
        { type: '계좌 검증 대기', count: avicxNumber(acc) },
        { type: '정산 대기', count: avicxNumber(settle.count || 0) },
        { type: '선정/지사 문의 대기', count: avicxNumber(inquiries.agency || 0) },
        { type: '가맹점/지점 문의 대기', count: avicxNumber(inquiries.advance || 0) },
        { type: '미처리 PG 노티', count: avicxNumber(noti.unprocessed || 0) },
        { type: '미처리 입금 노티', count: avicxNumber(dep.unprocessed || 0) }
      ]),
      avicxTable(['time', 'transactionId', 'pg', 'pgTx', 'auth', 'status', 'amount'], recentFailures.map(row => ({ time: row.created_at, transactionId: row.transaction_id || '-', pg: row.pg || '-', pgTx: row.pg_tx_id || '-', auth: row.auth_code || '-', status: row.status || '-', amount: avicxWon(row.total_amount) })))
    ]
  };
}
async function executeAvicxCommand(req, commandText) {
  const raw = String(commandText || '').trim();
  if (!raw) return avicxLines(['궁금한 내용을 자연스럽게 물어봐 주세요. 예: 오늘 매출 얼마야, 누적 매출 보여줘, 정산 대기 몇 건이야'], 'muted');
  const tokens = raw.match(/"[^"]*"|'[^']*'|\S+/g)?.map(token => token.replace(/^['"]|['"]$/g, '')) || [];
  const cmd = String(tokens[0] || '').toLowerCase();
  const sub = String(tokens[1] || '').toLowerCase();

  if (cmd === 'help' || cmd === '?') {
    return avicxLines([
      '이츠비가 바로 확인할 수 있는 것들이에요.',
      '매출: 오늘 매출, 이번달 매출, 누적 매출, 어제랑 비교',
      '결제/정산: 최근 승인, 결제 실패, 정산 대기, 롤백 내역, 입금 누락',
      '가맹점: 교촌 연락처, 손별, 교촌 계좌, 카드 없는 곳, 최근 가입 가맹점',
      '대리점/문의: 대리점 목록, 카드 많은 대리점, 선정산 문의, 지사 문의',
      'PG/알림: PG 상태, GH 노티, 위루트 노티'
    ], 'info');
  }
  if (cmd === 'guide') return avicxLines(itzbiGuideText(sub).split(/\r?\n/).filter(Boolean), 'info');
  if (cmd === 'learn' || cmd === '학습') {
    if (sub === 'list' || sub === '목록' || !sub) {
      const rows = await avicxRows(
        `SELECT id, trigger_text, command_text, active, updated_at
           FROM itzbi_learning_rules
          ORDER BY active DESC, priority ASC, id DESC
          LIMIT 30`
      );
      if (!rows.length) return avicxLines(['저장된 이츠비 학습 규칙이 아직 없어요.'], 'muted');
      return avicxTable(['id', 'active', 'trigger', 'command', 'updated'], rows.map(row => ({
        id: row.id,
        active: row.active ? 'ON' : 'OFF',
        trigger: row.trigger_text,
        command: row.command_text,
        updated: row.updated_at
      })));
    }
    if (sub === 'delete' || sub === 'del' || sub === '삭제') {
      const id = Number(tokens[2]);
      if (!Number.isFinite(id) || id <= 0) return avicxLines(['사용법: learn delete <id>'], 'warn');
      const rows = await avicxRows('UPDATE itzbi_learning_rules SET active = false, updated_at = now() WHERE id = $1 RETURNING id, trigger_text', [id]);
      if (!rows.length) return avicxLines([`학습 규칙 #${id}를 찾지 못했어요.`], 'warn');
      return avicxLines([`학습 규칙 비활성화: #${rows[0].id} ${rows[0].trigger_text}`], 'success');
    }
    return avicxLines(['사용법: learn list | learn delete <id>'], 'warn');
  }  if (cmd === 'clear') return { type: 'clear', lines: ['cleared'] };
  if (cmd === 'stats') {
    if (sub === 'franchise') {
      const rows = await avicxRows("SELECT role, count(*)::int AS count FROM users WHERE role IN ('OWNER','OWNER_PENDING','OWNER_REJECTED') GROUP BY role ORDER BY role ASC");
      const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
      return { type: 'group', sections: [
        avicxLines([`가맹점 계정: 총 ${avicxNumber(total)}개`], 'success'),
        avicxTable(['status', 'count'], rows.map(row => ({ status: row.role || '-', count: avicxNumber(row.count) })))
      ] };
    }
    if (sub === 'agency') {
      const rows = await avicxRows("SELECT COALESCE(type,'-') AS type, count(*)::int AS count FROM agencies GROUP BY COALESCE(type,'-') ORDER BY type ASC");
      const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
      return { type: 'group', sections: [
        avicxLines([`대리점/지사: 총 ${avicxNumber(total)}개`], 'success'),
        avicxTable(['type', 'count'], rows.map(row => ({ type: row.type || '-', count: avicxNumber(row.count) })))
      ] };
    }
    if (sub === 'cards') {
      const rows = await avicxRows(
        `SELECT count(DISTINCT u.id)::int AS franchise_count,
                count(c.id)::int AS card_count,
                count(c.id) FILTER (WHERE COALESCE(c.active, true) = true AND COALESCE(c.hidden, false) = false)::int AS active_count
           FROM users u
           JOIN cards c ON c.user_id = u.id
          WHERE u.role IN ('OWNER','OWNER_PENDING','OWNER_REJECTED')`
      );
      const row = rows[0] || {};
      return avicxLines([
        `카드 등록 가맹점: ${avicxNumber(row.franchise_count)}개`,
        `등록 카드: ${avicxNumber(row.card_count)}개 / 사용 가능 ${avicxNumber(row.active_count)}개`
      ], 'success');
    }
  }
  if (cmd === 'audit' && sub === 'latest') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const rows = await avicxRows(
      `SELECT created_at, actor_login_id, actor_name, action, entity_type, entity_name, changed_fields
         FROM audit_logs
        ORDER BY created_at DESC, id DESC
        LIMIT $1`,
      [limit]
    );
    return avicxTable(['time', 'login', 'name', 'action', 'type', 'target', 'fields'], rows.map(row => ({
      time: row.created_at,
      login: row.actor_login_id || '-',
      name: row.actor_name || '-',
      action: row.action || '-',
      type: row.entity_type || '-',
      target: row.entity_name || '-',
      fields: Array.isArray(row.changed_fields) ? row.changed_fields.join(', ') : '-'
    })));
  }  if (cmd === 'admin' && sub === 'status') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const rows = await avicxRows(
      `SELECT email, COALESCE(login_id, email) AS login_id, name, COALESCE(admin_level, 'SUPER') AS admin_level,
              COALESCE(admin_active, true) AS admin_active, last_login_at, created_at
         FROM users
        WHERE role = 'ADMIN'
        ORDER BY COALESCE(admin_active, true) DESC,
                 CASE COALESCE(admin_level, 'SUPER') WHEN 'SUPER' THEN 1 WHEN 'OPERATIONS' THEN 2 WHEN 'SETTLEMENT' THEN 3 WHEN 'CUSTOMER' THEN 4 ELSE 9 END,
                 id ASC
        LIMIT $1`,
      [limit]
    );
    return avicxTable(['login', 'name', 'adminLevel', 'status', 'lastLogin', 'joined'], rows.map(row => ({
      login: row.login_id || row.email || '-',
      name: row.name || '-',
      adminLevel: row.admin_level || '-',
      status: row.admin_active === false ? '비활성' : '활성',
      lastLogin: row.last_login_at || '-',
      joined: row.created_at || '-'
    })));
  }
  if (cmd === 'history') {
    const rows = await avicxRows(
      `SELECT command, status, created_at FROM admin_console_commands WHERE admin_user_id = $1 ORDER BY id DESC LIMIT 20`,
      [req.user?.id || null]
    );
    return avicxTable(['time', 'status', 'command'], rows.map(row => ({ time: row.created_at, status: row.status, command: row.command })));
  }
  if (cmd === 'brief' || (cmd === 'today' && sub === 'brief')) {
    return avicxTodayBrief();
  }
  if (cmd === 'health' || cmd === 'status') {
    const now = await avicxRows('SELECT now() AS db_now');
    const pgCount = await avicxRows('SELECT count(*)::int AS count FROM pg_providers');
    const notiCount = await avicxRows("SELECT count(*)::int AS count FROM pg_notifications WHERE received_at > now() - interval '24 hours'");
    return avicxLines([
      `server: ok`,
      `db: ok (${avicxFormatKstDateTime(now[0]?.db_now) || '-'})`,
      `pg providers: ${pgCount[0]?.count ?? 0}`,
      `pg noti 24h: ${notiCount[0]?.count ?? 0}`
    ], 'success');
  }
  if (cmd === 'pg') {
    if (sub === 'list' || sub === 'status' || !sub) {
      const rows = await avicxRows('SELECT id, name, status, mid, callback_url, display_order FROM pg_providers ORDER BY display_order ASC, id ASC');
      return avicxTable(['id', 'name', 'status', 'mid', 'callbackUrl', 'order'], rows.map(row => ({ id: row.id, name: row.name, status: row.status, mid: row.mid || '-', callbackUrl: row.callback_url || '-', order: row.display_order })));
    }
    const provider = avicxNormalizeProvider(tokens.slice(1).join(' '));
    const rows = await avicxRows('SELECT id, provider, event_type, transaction_id, pg_transaction_id, result_code, received_at FROM pg_notifications WHERE provider = $1 ORDER BY received_at DESC, id DESC LIMIT 20', [provider]);
    return avicxTable(['time', 'provider', 'event', 'transactionId', 'pgTx', 'code'], rows.map(row => ({ time: row.received_at, provider: row.provider, event: row.event_type || '-', transactionId: row.transaction_id || '-', pgTx: row.pg_transaction_id || '-', code: row.result_code || '-' })));
  }
  if (cmd === 'noti') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const provider = sub === 'provider' ? avicxNormalizeProvider(tokens.slice(2).filter(t => t.toLowerCase() !== 'limit' && !/^\d+$/.test(t)).join(' ')) : '';
    const params = provider ? [provider, limit] : [limit];
    const sql = provider
      ? 'SELECT id, provider, event_type, transaction_id, pg_transaction_id, result_code, received_at FROM pg_notifications WHERE provider = $1 ORDER BY received_at DESC, id DESC LIMIT $2'
      : 'SELECT id, provider, event_type, transaction_id, pg_transaction_id, result_code, received_at FROM pg_notifications ORDER BY received_at DESC, id DESC LIMIT $1';
    const rows = await avicxRows(sql, params);
    return avicxTable(['time', 'provider', 'event', 'transactionId', 'pgTx', 'code'], rows.map(row => ({ time: row.received_at, provider: row.provider, event: row.event_type || '-', transactionId: row.transaction_id || '-', pgTx: row.pg_transaction_id || '-', code: row.result_code || '-' })));
  }
  if (cmd === 'sales') {
    if (sub === 'compare') return avicxSalesCompareReport();
    return avicxSalesReport(tokens);
  }
  if (cmd === 'money' && sub === 'search') {
    const amount = Number(String(tokens[2] || '').replace(/[^0-9]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return avicxLines(['찾을 금액을 숫자로 입력해 주세요.'], 'warn');
    const q = tokens.slice(3).join(' ').replace(/^["']|["']$/g, '').trim();
    const like = q ? `%${q}%` : '';
    const [payments, settles, deposits] = await Promise.all([
      avicxRows(
        `SELECT t.created_at, COALESCE(u.franchise_name, '가맹점 ' || t.franchise_id::text) AS franchise,
                t.transaction_id, t.amount, t.fee, t.total_amount, t.pg, t.pg_tx_id, t.auth_code, t.status
           FROM transactions t
           LEFT JOIN users u ON u.franchise_id = t.franchise_id
          WHERE (round(COALESCE(t.amount,0)) = $1 OR round(COALESCE(t.total_amount,0)) = $1 OR round(COALESCE(t.fee,0)) = $1)
            AND ($2 = '' OR u.franchise_name ILIKE $2 OR u.name ILIKE $2 OR u.login_id ILIKE $2 OR t.transaction_id ILIKE $2 OR t.pg_tx_id ILIKE $2 OR t.auth_code ILIKE $2)
          ORDER BY t.created_at DESC
          LIMIT 10`,
        [amount, like]
      ),
      avicxRows(
        `SELECT created_at, franchise_name, approval_no, pg_tx_id, payment_amt, svc_fee, net_amt, status
           FROM pg_settlements
          WHERE (round(COALESCE(payment_amt,0)) = $1 OR round(COALESCE(net_amt,0)) = $1 OR round(COALESCE(svc_fee,0)) = $1)
            AND ($2 = '' OR franchise_name ILIKE $2 OR approval_no ILIKE $2 OR pg_tx_id ILIKE $2)
          ORDER BY created_at DESC
          LIMIT 10`,
        [amount, like]
      ),
      avicxRows(
        `SELECT received_at, provider, event_type, txid, bank_name, account_no, depositor_name, amount
           FROM deposit_notifications
          WHERE round(COALESCE(amount,0)) = $1
            AND ($2 = '' OR txid ILIKE $2 OR bank_name ILIKE $2 OR account_no ILIKE $2 OR depositor_name ILIKE $2 OR provider ILIKE $2)
          ORDER BY received_at DESC
          LIMIT 10`,
        [amount, like]
      )
    ]);
    return { type: 'group', sections: [
      avicxLines([`금액 ${avicxWon(amount)}${q ? ` / 검색어 ${q}` : ''} 검색 결과`], 'success'),
      avicxTable(['time','franchise','transactionId','amount','fee','total','pg','pgTx','auth','status'], payments.map(row => ({ time: row.created_at, franchise: row.franchise || '-', transactionId: row.transaction_id || '-', amount: avicxWon(row.amount), fee: avicxWon(row.fee), total: avicxWon(row.total_amount), pg: row.pg || '-', pgTx: row.pg_tx_id || '-', auth: row.auth_code || '-', status: row.status || '-' }))),
      avicxTable(['time','franchise','approval','pgTx','payment','fee','net','status'], settles.map(row => ({ time: row.created_at, franchise: row.franchise_name || '-', approval: row.approval_no || '-', pgTx: row.pg_tx_id || '-', payment: avicxWon(row.payment_amt), fee: avicxWon(row.svc_fee), net: avicxWon(row.net_amt), status: row.status || '-' }))),
      avicxTable(['time','provider','event','txid','bank','account','depositor','amount'], deposits.map(row => ({ time: row.received_at, provider: row.provider || '-', event: row.event_type || '-', txid: row.txid || '-', bank: row.bank_name || '-', account: row.account_no || '-', depositor: row.depositor_name || '-', amount: avicxWon(row.amount) })))
    ] };
  }
  if (cmd === 'payments' && sub === 'recent') {
    const days = Math.min(Math.max(Number(tokens[2] || 3) || 3, 1), 90);
    const limit = avicxLimit(tokens[3], 50, 100);
    const rows = await avicxRows(
      `SELECT t.created_at, COALESCE(u.franchise_name, '가맹점 ' || t.franchise_id::text) AS franchise,
              t.transaction_id, t.amount, t.fee, t.total_amount, t.pg, t.pg_tx_id, t.auth_code, t.status
         FROM transactions t
         LEFT JOIN users u ON u.franchise_id = t.franchise_id
        WHERE t.created_at >= (now() AT TIME ZONE 'Asia/Seoul' - ($1::text || ' days')::interval) AT TIME ZONE 'Asia/Seoul'
        ORDER BY t.created_at DESC
        LIMIT $2`,
      [days, limit]
    );
    return { type: 'group', sections: [
      avicxLines([`최근 ${days}일 거래: ${avicxNumber(rows.length)}건`], rows.length ? 'success' : 'warn'),
      avicxTable(['time', 'franchise', 'transactionId', 'amount', 'fee', 'total', 'pg', 'pgTx', 'auth', 'status'], rows.map(row => ({
        time: row.created_at,
        franchise: row.franchise || '-',
        transactionId: row.transaction_id || '-',
        amount: avicxWon(row.amount),
        fee: avicxWon(row.fee),
        total: avicxWon(row.total_amount),
        pg: row.pg || '-',
        pgTx: row.pg_tx_id || '-',
        auth: row.auth_code || '-',
        status: row.status || '-'
      })))
    ] };
  }
  if (cmd === 'payments' && sub === 'range') {
    const start = String(tokens[2] || '').trim();
    const end = String(tokens[3] || '').trim();
    const limit = avicxLimit(tokens[4], 100, 500);
    if (!/^20\d{2}-\d{1,2}-\d{1,2}$/.test(start) || !/^20\d{2}-\d{1,2}-\d{1,2}$/.test(end)) {
      return avicxLines(['기간은 YYYY-MM-DD YYYY-MM-DD 형식으로 입력해 주세요.'], 'warn');
    }
    const rows = await avicxRows(
      `SELECT t.created_at, COALESCE(u.franchise_name, '가맹점 ' || t.franchise_id::text) AS franchise,
              t.transaction_id, t.amount, t.fee, t.total_amount, t.pg, t.pg_tx_id, t.auth_code, t.status
         FROM transactions t
         LEFT JOIN users u ON u.franchise_id = t.franchise_id
        WHERE t.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Seoul')
          AND t.created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Seoul')
        ORDER BY t.created_at DESC
        LIMIT $3`,
      [start, end, limit]
    );
    return { type: 'group', sections: [
      avicxLines([`${start} ~ ${end} 거래: ${avicxNumber(rows.length)}건`], rows.length ? 'success' : 'warn'),
      avicxTable(['time', 'franchise', 'transactionId', 'amount', 'fee', 'total', 'pg', 'pgTx', 'auth', 'status'], rows.map(row => ({
        time: row.created_at,
        franchise: row.franchise || '-',
        transactionId: row.transaction_id || '-',
        amount: avicxWon(row.amount),
        fee: avicxWon(row.fee),
        total: avicxWon(row.total_amount),
        pg: row.pg || '-',
        pgTx: row.pg_tx_id || '-',
        auth: row.auth_code || '-',
        status: row.status || '-'
      })))
    ] };
  }
  if (cmd === 'payments' && sub === 'latest') {
    const limit = avicxExtractLimit(tokens, 10, 50);
    const rows = await avicxRows(
      `SELECT t.created_at, COALESCE(u.franchise_name, '가맹점 ' || t.franchise_id::text) AS franchise,
              t.transaction_id, t.amount, t.fee, t.total_amount, t.pg, t.pg_tx_id, t.auth_code, t.status
         FROM transactions t
         LEFT JOIN users u ON u.franchise_id = t.franchise_id
        ORDER BY t.created_at DESC
        LIMIT $1`,
      [limit]
    );
    return avicxTable(['time', 'franchise', 'transactionId', 'amount', 'fee', 'total', 'pg', 'pgTx', 'auth', 'status'], rows.map(row => ({
      time: row.created_at,
      franchise: row.franchise || '-',
      transactionId: row.transaction_id || '-',
      amount: avicxWon(row.amount),
      fee: avicxWon(row.fee),
      total: avicxWon(row.total_amount),
      pg: row.pg || '-',
      pgTx: row.pg_tx_id || '-',
      auth: row.auth_code || '-',
      status: row.status || '-'
    })));
  }
  if (cmd === 'payments' && sub === 'failed') {
    const limit = avicxExtractLimit(tokens, 10, 50);
    const rows = await avicxRows(
      `SELECT t.created_at, COALESCE(u.franchise_name, '가맹점 ' || t.franchise_id::text) AS franchise,
              t.transaction_id, t.total_amount, t.pg, t.pg_tx_id, t.auth_code, t.status
         FROM transactions t
         LEFT JOIN users u ON u.franchise_id = t.franchise_id
        WHERE t.status NOT IN ('SUCCESS','정상','승인','APPROVED')
        ORDER BY t.created_at DESC
        LIMIT $1`,
      [limit]
    );
    return avicxTable(['time', 'franchise', 'transactionId', 'total', 'pg', 'pgTx', 'auth', 'status'], rows.map(row => ({ time: row.created_at, franchise: row.franchise || '-', transactionId: row.transaction_id || '-', total: avicxWon(row.total_amount), pg: row.pg || '-', pgTx: row.pg_tx_id || '-', auth: row.auth_code || '-', status: row.status || '-' })));
  }
  if (cmd === 'agency' && sub === 'sales') {
    const limit = avicxExtractLimit(tokens, 10, 50);
    const rows = await avicxRows(
      `SELECT COALESCE(a.name, '대리점 미지정') AS agency,
              count(t.transaction_id)::int AS count,
              COALESCE(sum(t.total_amount),0)::numeric AS total,
              COALESCE(sum(t.fee),0)::numeric AS fee
         FROM transactions t
         LEFT JOIN users u ON u.franchise_id = t.franchise_id
         LEFT JOIN agencies a ON a.id = u.agency_id
        GROUP BY COALESCE(a.name, '대리점 미지정')
        ORDER BY total DESC, count DESC
        LIMIT $1`,
      [limit]
    );
    return avicxTable(['agency', 'count', 'total', 'fee'], rows.map(row => ({ agency: row.agency, count: avicxNumber(row.count), total: avicxWon(row.total), fee: avicxWon(row.fee) })));
  }
  if (cmd === 'franchise' && sub === 'recent') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const rows = await avicxRows(
      `SELECT u.created_at, u.franchise_name, u.name, u.login_id, u.phone, COALESCE(a.name, '-') AS agency, u.role
         FROM users u
         LEFT JOIN agencies a ON a.id = u.agency_id
        WHERE u.role IN ('OWNER','OWNER_PENDING','OWNER_REJECTED')
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT $1`,
      [limit]
    );
    return avicxTable(['joined', 'franchise', 'owner', 'login', 'phone', 'agency', 'status'], rows.map(row => ({ joined: row.created_at, franchise: row.franchise_name || '-', owner: row.name || '-', login: row.login_id || '-', phone: row.phone || '-', agency: row.agency || '-', status: row.role || '-' })));
  }
  if (cmd === 'franchise' && sub === 'missing-cards') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const rows = await avicxRows(
      `SELECT u.created_at, u.franchise_name, u.name, u.login_id, u.phone, COALESCE(a.name, '-') AS agency
         FROM users u
         LEFT JOIN agencies a ON a.id = u.agency_id
        WHERE u.role IN ('OWNER','OWNER_PENDING','OWNER_REJECTED')
          AND NOT EXISTS (
            SELECT 1 FROM cards c
             WHERE c.user_id = u.id
               AND COALESCE(c.hidden, false) = false
               AND COALESCE(c.active, true) = true
          )
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT $1`,
      [limit]
    );
    return avicxTable(['franchise', 'owner', 'login', 'phone', 'agency', 'joined'], rows.map(row => ({ franchise: row.franchise_name || '-', owner: row.name || '-', login: row.login_id || '-', phone: row.phone || '-', agency: row.agency || '-', joined: row.created_at })));
  }
  if (cmd === 'franchise' && sub === 'missing-accounts') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const rows = await avicxRows(
      `SELECT u.created_at, u.franchise_name, u.name, u.login_id, u.phone, COALESCE(a.name, '-') AS agency
         FROM users u
         LEFT JOIN agencies a ON a.id = u.agency_id
        WHERE u.role IN ('OWNER','OWNER_PENDING','OWNER_REJECTED')
          AND NOT EXISTS (SELECT 1 FROM account_requests ar WHERE ar.franchise_id = u.franchise_id)
          AND NOT EXISTS (SELECT 1 FROM delivery_accounts da WHERE da.franchise_id = u.franchise_id)
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT $1`,
      [limit]
    );
    return avicxTable(['franchise', 'owner', 'login', 'phone', 'agency', 'joined'], rows.map(row => ({ franchise: row.franchise_name || '-', owner: row.name || '-', login: row.login_id || '-', phone: row.phone || '-', agency: row.agency || '-', joined: row.created_at })));
  }
  if (cmd === 'contact' && sub === 'list') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const contactTail = tokens.slice(2).filter(t => t.toLowerCase() !== 'limit');
    const q = (contactTail.length > 1 && /^\d{1,3}$/.test(contactTail[contactTail.length - 1]) ? contactTail.slice(0, -1) : contactTail).join(' ').trim();
    const params = q ? [`%${q}%`, limit] : [limit];
    const sql = q
      ? `SELECT u.franchise_name, u.name, u.login_id, u.phone, u.tel, u.contact_email, COALESCE(a.name, '-') AS agency
           FROM users u
           LEFT JOIN agencies a ON a.id = u.agency_id
          WHERE u.role IN ('OWNER','OWNER_PENDING','OWNER_REJECTED')
            AND (u.franchise_name ILIKE $1 OR u.name ILIKE $1 OR u.login_id ILIKE $1 OR u.phone ILIKE $1 OR (NULLIF(regexp_replace($1, '[^0-9]', '', 'g'), '') IS NOT NULL AND regexp_replace(COALESCE(u.phone,''), '[^0-9]', '', 'g') ILIKE '%' || regexp_replace($1, '[^0-9]', '', 'g') || '%') OR COALESCE(u.tel,'') ILIKE $1 OR (NULLIF(regexp_replace($1, '[^0-9]', '', 'g'), '') IS NOT NULL AND regexp_replace(COALESCE(u.tel,''), '[^0-9]', '', 'g') ILIKE '%' || regexp_replace($1, '[^0-9]', '', 'g') || '%') OR COALESCE(a.name,'') ILIKE $1)
          ORDER BY u.id DESC
          LIMIT $2`
      : `SELECT u.franchise_name, u.name, u.login_id, u.phone, u.tel, u.contact_email, COALESCE(a.name, '-') AS agency
           FROM users u
           LEFT JOIN agencies a ON a.id = u.agency_id
          WHERE u.role IN ('OWNER','OWNER_PENDING','OWNER_REJECTED')
          ORDER BY u.id DESC
          LIMIT $1`;
    const rows = await avicxRows(sql, params);
    return avicxTable(['franchise', 'owner', 'login', 'phone', 'tel', 'email', 'agency'], rows.map(row => ({
      franchise: row.franchise_name || '-',
      owner: row.name || '-',
      login: row.login_id || '-',
      phone: row.phone || '-',
      tel: row.tel || '-',
      email: row.contact_email || '-',
      agency: row.agency || '-'
    })));
  }
  if (cmd === 'agency' && sub === 'list') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const rows = await avicxRows(
      `SELECT a.id, a.type, a.name, a.login_id, a.owner, a.phone, a.created_at,
              count(u.id)::int AS franchise_count
         FROM agencies a
         LEFT JOIN users u ON u.agency_id = a.id AND u.role IN ('OWNER','OWNER_PENDING','OWNER_REJECTED')
        GROUP BY a.id, a.type, a.name, a.login_id, a.owner, a.phone, a.created_at
        ORDER BY a.id ASC
        LIMIT $1`,
      [limit]
    );
    return avicxTable(['id', 'type', 'agency', 'login', 'owner', 'phone', 'status', 'franchises', 'joined'], rows.map(row => ({
      id: row.id,
      type: row.type || '-',
      agency: row.name || '-',
      login: row.login_id || '-',
      owner: row.owner || '-',
      phone: row.phone || '-',
      status: row.status || '-',
      franchises: avicxNumber(row.franchise_count),
      joined: row.created_at || '-'
    })));
  }
  if (cmd === 'agency' && sub === 'top') {
    const limit = avicxExtractLimit(tokens, 10, 50);
    const metric = ['contacts','cards','accounts','franchises'].includes(String(tokens[2] || '').toLowerCase()) ? String(tokens[2]).toLowerCase() : 'accounts';
    const orderBy = metric === 'contacts'
      ? 'contact_count DESC, account_count DESC, card_count DESC, franchise_count DESC, a.id ASC'
      : metric === 'cards'
        ? 'card_count DESC, account_count DESC, contact_count DESC, franchise_count DESC, a.id ASC'
        : metric === 'franchises'
          ? 'franchise_count DESC, contact_count DESC, account_count DESC, card_count DESC, a.id ASC'
          : 'account_count DESC, card_count DESC, contact_count DESC, franchise_count DESC, a.id ASC';
    const rows = await avicxRows(
      `WITH owner_users AS (
         SELECT id, agency_id, franchise_id, phone
           FROM users
          WHERE role IN ('OWNER','OWNER_PENDING','OWNER_REJECTED')
       ),
       card_counts AS (
         SELECT u.agency_id, count(c.id)::int AS card_count
           FROM owner_users u
           JOIN cards c ON c.user_id = u.id
          WHERE COALESCE(c.hidden, false) = false
            AND COALESCE(c.active, true) = true
          GROUP BY u.agency_id
       ),
       request_counts AS (
         SELECT u.agency_id, count(ar.request_id)::int AS account_request_count
           FROM owner_users u
           JOIN account_requests ar ON ar.franchise_id = u.franchise_id
          GROUP BY u.agency_id
       ),
       delivery_account_counts AS (
         SELECT COALESCE(da.agency_id, u.agency_id) AS agency_id, count(da.id)::int AS delivery_account_count
           FROM delivery_accounts da
           LEFT JOIN owner_users u ON u.franchise_id = da.franchise_id
          GROUP BY COALESCE(da.agency_id, u.agency_id)
       )
       SELECT a.id,
              COALESCE(NULLIF(a.name,''), '대리점 ' || a.id::text) AS agency,
              count(u.id)::int AS franchise_count,
              count(u.id) FILTER (WHERE NULLIF(regexp_replace(COALESCE(u.phone,''), '[^0-9]', '', 'g'), '') IS NOT NULL)::int AS contact_count,
              COALESCE(cc.card_count, 0)::int AS card_count,
              (COALESCE(rc.account_request_count, 0) + COALESCE(dc.delivery_account_count, 0))::int AS account_count
         FROM agencies a
         LEFT JOIN owner_users u ON u.agency_id = a.id
         LEFT JOIN card_counts cc ON cc.agency_id = a.id
         LEFT JOIN request_counts rc ON rc.agency_id = a.id
         LEFT JOIN delivery_account_counts dc ON dc.agency_id = a.id
        GROUP BY a.id, a.name, cc.card_count, rc.account_request_count, dc.delivery_account_count
        ORDER BY ${orderBy}
        LIMIT $1`,
      [limit]
    );
    return avicxTable(['agency', 'franchises', 'contacts', 'cards', 'accounts'], rows.map(row => ({
      agency: row.agency,
      franchises: avicxNumber(row.franchise_count),
      contacts: avicxNumber(row.contact_count),
      cards: avicxNumber(row.card_count),
      accounts: avicxNumber(row.account_count)
    })));
  }
  if (cmd === 'inquiry' && sub === 'pending') {
    const limit = avicxExtractLimit(tokens, 10, 50);
    const rows = await avicxRows(
      `(SELECT created_at, '지점/지사 문의' AS type, COALESCE(NULLIF(inquiry_type,''), '지점/지사 개설') AS category, name AS name, phone, COALESCE(region,'-') AS region, COALESCE(delivery_agency,'-') AS memo, status
          FROM agency_inquiries
         WHERE status = '상담 대기'
         ORDER BY created_at DESC
         LIMIT $1)
       UNION ALL
       (SELECT created_at, '가맹점/선정산 문의' AS type, '선정산 상담' AS category, COALESCE(franchise_name,'-') AS name, phone, '-' AS region, COALESCE(delivery_apps,'-') AS memo, status
          FROM advance_inquiries
         WHERE status = '상담 대기'
         ORDER BY created_at DESC
         LIMIT $1)
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return avicxTable(['time', 'type', 'category', 'name', 'phone', 'region', 'memo', 'status'], rows.map(row => ({ time: row.created_at, type: row.type, category: row.category, name: row.name || '-', phone: row.phone || '-', region: row.region || '-', memo: row.memo || '-', status: row.status || '-' })));
  }
  if (cmd === 'deposit') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const transferOnly = sub === 'transfer' || sub === 'withdraw';
    const sql = transferOnly
      ? "SELECT id, provider, event_type, txid, bank_name, depositor_name, amount, received_at FROM deposit_notifications WHERE event_type IN ('TRANSFER','WITHDRAW') ORDER BY received_at DESC, id DESC LIMIT $1"
      : "SELECT id, provider, event_type, txid, bank_name, depositor_name, amount, received_at FROM deposit_notifications WHERE COALESCE(event_type,'') NOT ILIKE '%TEST%' AND COALESCE(provider,'') NOT ILIKE '%테스트%' ORDER BY received_at DESC, id DESC LIMIT $1";
    const rows = await avicxRows(sql, [limit]);
    return avicxTable(['time', 'provider', 'event', 'txid', 'bank', 'depositor', 'amount'], rows.map(row => ({ time: row.received_at, provider: row.provider, event: row.event_type || '-', txid: row.txid || '-', bank: row.bank_name || '-', depositor: row.depositor_name || '-', amount: avicxWon(row.amount) })));
  }
  if (cmd === 'settle' && sub === 'search') {
    const limit = avicxExtractLimit(tokens, 10, 50);
    const contactTail = tokens.slice(2).filter(t => t.toLowerCase() !== 'limit');
    const q = (contactTail.length > 1 && /^\d{1,3}$/.test(contactTail[contactTail.length - 1]) ? contactTail.slice(0, -1) : contactTail).join(' ').trim();
    if (!q) return avicxLines(['가맹점명이나 대표자명을 같이 적어주세요. 예: 손별 정산 보여줘'], 'warn');
    const rows = await avicxRows(
      `SELECT ps.created_at, ps.franchise_name, ps.delivery_agency, ps.approval_no, ps.pg_tx_id,
              ps.payment_amt, ps.svc_fee, ps.net_amt, ps.status
         FROM pg_settlements ps
         LEFT JOIN users u ON u.franchise_name = ps.franchise_name
        WHERE ps.franchise_name ILIKE $1 OR COALESCE(u.name,'') ILIKE $1 OR COALESCE(u.login_id,'') ILIKE $1
        ORDER BY ps.created_at DESC
        LIMIT $2`,
      [`%${q}%`, limit]
    );
    return avicxTable(['time','franchise','delivery','approval','pgTx','payment','fee','net','status'], rows.map(row => ({
      time: row.created_at,
      franchise: row.franchise_name || '-',
      delivery: row.delivery_agency || '-',
      approval: row.approval_no || '-',
      pgTx: row.pg_tx_id || '-',
      payment: avicxWon(row.payment_amt),
      fee: avicxWon(row.svc_fee),
      net: avicxWon(row.net_amt),
      status: row.status || '-'
    })));
  }
  if (cmd === 'settle' && sub === 'status') {
    const rows = await avicxRows(
      `SELECT COALESCE(NULLIF(status,''), '-') AS status,
              count(*)::int AS count,
              COALESCE(sum(payment_amt),0)::numeric AS payment,
              COALESCE(sum(svc_fee),0)::numeric AS fee,
              COALESCE(sum(net_amt),0)::numeric AS net
         FROM pg_settlements
        GROUP BY COALESCE(NULLIF(status,''), '-')
        ORDER BY count DESC, net DESC`
    );
    return avicxTable(['status', 'count', 'payment', 'fee', 'net'], rows.map(row => ({
      status: row.status,
      count: avicxNumber(row.count),
      payment: avicxWon(row.payment),
      fee: avicxWon(row.fee),
      net: avicxWon(row.net)
    })));
  }
  if (cmd === 'settle' && sub === 'rolledback') {
    const limit = avicxExtractLimit(tokens, 10, 50);
    const rows = await avicxRows(
      `SELECT id, franchise_name, delivery_agency, payment_amt, net_amt, status, approval_no, pg_tx_id, created_at
         FROM pg_settlements
        WHERE status IN ('ROLLED_BACK','롤백','취소','취소처리')
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit]
    );
    return avicxTable(['time', 'id', 'franchise', 'delivery', 'payment', 'net', 'status', 'approval', 'pgTx'], rows.map(row => ({
      time: row.created_at,
      id: row.id,
      franchise: row.franchise_name || '-',
      delivery: row.delivery_agency || '-',
      payment: avicxWon(row.payment_amt),
      net: avicxWon(row.net_amt),
      status: row.status || '-',
      approval: row.approval_no || '-',
      pgTx: row.pg_tx_id || '-'
    })));
  }
  if (cmd === 'settle' && sub === 'pending') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const rows = await avicxRows("SELECT id, franchise_name, delivery_agency, payment_amt, net_amt, status, approval_no, created_at FROM pg_settlements WHERE status IN ('정산대기','PENDING','pending') OR (settled_at IS NULL AND COALESCE(status,'') NOT IN ('정산완료','SETTLED','settled','COMPLETED','completed','완료')) ORDER BY created_at DESC LIMIT $1", [limit]);
    return avicxTable(['time', 'id', 'franchise', 'delivery', 'payment', 'net', 'status', 'approval'], rows.map(row => ({ time: row.created_at, id: row.id, franchise: row.franchise_name || '-', delivery: row.delivery_agency || '-', payment: avicxWon(row.payment_amt), net: avicxWon(row.net_amt), status: row.status || '-', approval: row.approval_no || '-' })));
  }
  if (cmd === 'franchise' && sub === 'status') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const contactTail = tokens.slice(2).filter(t => t.toLowerCase() !== 'limit');
    const q = (contactTail.length > 1 && /^\d{1,3}$/.test(contactTail[contactTail.length - 1]) ? contactTail.slice(0, -1) : contactTail).join(' ').trim();
    const params = q ? [`%${q}%`, limit] : [limit];
    const sql = q
      ? `SELECT u.id, u.created_at, u.franchise_name, u.name, u.login_id, u.phone, u.role,
                COALESCE(a.name, '-') AS agency, COALESCE(pg.name, '-') AS pg_provider,
                u.franchise_fee_rate,
                (SELECT count(*)::int FROM cards c WHERE c.user_id = u.id AND COALESCE(c.hidden, false) = false) AS card_count,
                ((SELECT count(*)::int FROM account_requests ar WHERE ar.franchise_id = u.franchise_id)
                 + (SELECT count(*)::int FROM delivery_accounts da WHERE da.franchise_id = u.franchise_id)) AS account_count,
                (SELECT count(*)::int FROM transactions t WHERE t.franchise_id = u.franchise_id) AS payment_count
           FROM users u
           LEFT JOIN agencies a ON a.id = u.agency_id
           LEFT JOIN pg_providers pg ON pg.id = u.pg_provider_id
          WHERE u.role IN ('OWNER','OWNER_PENDING','OWNER_REJECTED')
            AND (u.franchise_name ILIKE $1 OR u.name ILIKE $1 OR u.login_id ILIKE $1 OR u.phone ILIKE $1 OR (NULLIF(regexp_replace($1, '[^0-9]', '', 'g'), '') IS NOT NULL AND regexp_replace(COALESCE(u.phone,''), '[^0-9]', '', 'g') ILIKE '%' || regexp_replace($1, '[^0-9]', '', 'g') || '%') OR COALESCE(u.tel,'') ILIKE $1 OR (NULLIF(regexp_replace($1, '[^0-9]', '', 'g'), '') IS NOT NULL AND regexp_replace(COALESCE(u.tel,''), '[^0-9]', '', 'g') ILIKE '%' || regexp_replace($1, '[^0-9]', '', 'g') || '%') OR COALESCE(a.name,'') ILIKE $1)
          ORDER BY u.id DESC
          LIMIT $2`
      : `SELECT u.id, u.created_at, u.franchise_name, u.name, u.login_id, u.phone, u.role,
                COALESCE(a.name, '-') AS agency, COALESCE(pg.name, '-') AS pg_provider,
                u.franchise_fee_rate,
                (SELECT count(*)::int FROM cards c WHERE c.user_id = u.id AND COALESCE(c.hidden, false) = false) AS card_count,
                ((SELECT count(*)::int FROM account_requests ar WHERE ar.franchise_id = u.franchise_id)
                 + (SELECT count(*)::int FROM delivery_accounts da WHERE da.franchise_id = u.franchise_id)) AS account_count,
                (SELECT count(*)::int FROM transactions t WHERE t.franchise_id = u.franchise_id) AS payment_count
           FROM users u
           LEFT JOIN agencies a ON a.id = u.agency_id
           LEFT JOIN pg_providers pg ON pg.id = u.pg_provider_id
          WHERE u.role IN ('OWNER','OWNER_PENDING','OWNER_REJECTED')
          ORDER BY u.id DESC
          LIMIT $1`;
    const rows = await avicxRows(sql, params);
    return avicxTable(['franchise', 'owner', 'login', 'phone', 'status', 'agency', 'pg', 'feeRate', 'cards', 'accounts', 'payments', 'joined'], rows.map(row => ({
      franchise: row.franchise_name || '-',
      owner: row.name || '-',
      login: row.login_id || '-',
      phone: row.phone || '-',
      status: row.role || '-',
      agency: row.agency || '-',
      pg: row.pg_provider || '-',
      feeRate: row.franchise_fee_rate == null ? '-' : `${row.franchise_fee_rate}%`,
      cards: avicxNumber(row.card_count),
      accounts: avicxNumber(row.account_count),
      payments: avicxNumber(row.payment_count),
      joined: row.created_at
    })));
  }
  if (cmd === 'franchise' && sub === 'count') {
    const qTokens = tokens.slice(2).filter((t, idx, arr) => t.toLowerCase() !== 'limit' && String(arr[idx - 1] || '').toLowerCase() !== 'limit');
    if (qTokens.length > 1 && /^\d+$/.test(qTokens[qTokens.length - 1])) qTokens.pop();
    const q = qTokens.join(' ').replace(/^(["'])|(["'])$/g, '').trim();
    const limit = avicxExtractLimit(tokens, 20, 100);
    if (!q) return avicxLines(['검색할 가맹점명을 입력해 주세요. 예: 교촌치킨 몇개야'], 'warn');
    const like = `%${q}%`;
    const totalRows = await avicxRows(
      `SELECT count(*)::int AS count
         FROM users u
        WHERE u.role LIKE 'OWNER%'
          AND (u.franchise_name ILIKE $1 OR u.name ILIKE $1 OR u.email ILIKE $1 OR u.login_id ILIKE $1 OR u.phone ILIKE $1)`,
      [like]
    );
    const rows = await avicxRows(
      `SELECT u.id, u.email, u.name, u.franchise_name, u.role, u.phone, u.agency_id, u.login_id,
              COALESCE(a.name, '-') AS agency
         FROM users u
         LEFT JOIN agencies a ON a.id = u.agency_id
        WHERE u.role LIKE 'OWNER%'
          AND (u.franchise_name ILIKE $1 OR u.name ILIKE $1 OR u.email ILIKE $1 OR u.login_id ILIKE $1 OR u.phone ILIKE $1)
        ORDER BY u.id DESC
        LIMIT $2`,
      [like, limit]
    );
    const count = Number(totalRows?.[0]?.count || 0);
    return { type: 'group', sections: [
      avicxLines([`${q} 검색 가맹점: ${avicxNumber(count)}개`], count ? 'success' : 'warn'),
      avicxTable(['id', 'login', 'franchise', 'owner', 'role', 'phone', 'agency'], rows.map(row => ({
        id: row.id,
        login: row.login_id || row.email,
        franchise: row.franchise_name || '-',
        owner: row.name || '-',
        role: row.role,
        phone: row.phone || '-',
        agency: row.agency || row.agency_id || '-'
      })))
    ] };
  }
  if (cmd === 'franchise' && sub === 'search') {
    const q = tokens.slice(2).join(' ').trim();
    if (!q) return avicxLines(['사용법: franchise search <검색어>'], 'warn');
    const rows = await avicxRows("SELECT id, email, name, franchise_name, role, phone, agency_id, login_id FROM users WHERE role LIKE 'OWNER%' AND (franchise_name ILIKE $1 OR name ILIKE $1 OR email ILIKE $1 OR login_id ILIKE $1 OR phone ILIKE $1) ORDER BY id DESC LIMIT 20", [`%${q}%`]);
    return avicxTable(['id', 'login', 'franchise', 'owner', 'role', 'phone', 'agency'], rows.map(row => ({ id: row.id, login: row.login_id || row.email, franchise: row.franchise_name || '-', owner: row.name || '-', role: row.role, phone: row.phone || '-', agency: row.agency_id || '-' })));
  }
  if (cmd === 'franchise' && sub === 'payments') {
    const qTokens = tokens.slice(2).filter((t, idx, arr) => t.toLowerCase() !== 'limit' && String(arr[idx - 1] || '').toLowerCase() !== 'limit');
    if (qTokens.length > 1 && /^\d+$/.test(qTokens[qTokens.length - 1])) qTokens.pop();
    const q = qTokens.join(' ').trim();
    const limit = avicxExtractLimit(tokens, 20, 100);
    if (!q) return avicxLines(['사용법: franchise payments <가맹점명> [limit]'], 'warn');
    const rows = await avicxRows(
      `SELECT t.created_at, COALESCE(u.franchise_name, '가맹점 ' || t.franchise_id::text) AS franchise_name,
              t.transaction_id, t.amount, t.fee, t.total_amount, t.pg, t.pg_tx_id, t.auth_code, t.status
         FROM transactions t
         LEFT JOIN users u ON u.franchise_id = t.franchise_id
        WHERE u.franchise_name ILIKE $1 OR u.name ILIKE $1 OR u.login_id ILIKE $1 OR t.franchise_id::text = $2
        ORDER BY t.created_at DESC
        LIMIT $3`,
      [`%${q}%`, q, limit]
    );
    return avicxTable(['time', 'franchise', 'transactionId', 'amount', 'fee', 'total', 'pg', 'pgTx', 'auth', 'status'], rows.map(row => ({ time: row.created_at, franchise: row.franchise_name || '-', transactionId: row.transaction_id || '-', amount: avicxWon(row.amount), fee: avicxWon(row.fee), total: avicxWon(row.total_amount), pg: row.pg || '-', pgTx: row.pg_tx_id || '-', auth: row.auth_code || '-', status: row.status || '-' })));
  }
  if (cmd === 'account' && sub === 'banks') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const rows = await avicxRows(
      `WITH account_rows AS (
         SELECT COALESCE(NULLIF(ar.bank_name,''), '은행 미지정') AS bank_name,
                ar.status,
                ar.txid
           FROM account_requests ar
          WHERE COALESCE(ar.hidden, false) = false
         UNION ALL
         SELECT COALESCE(NULLIF(da.bank_name,''), '은행 미지정') AS bank_name,
                da.account_status AS status,
                da.txid
           FROM delivery_accounts da
          WHERE COALESCE(da.hidden, false) = false
       )
       SELECT bank_name,
              count(*)::int AS count,
              count(*) FILTER (WHERE status IN ('APPROVED','승인완료','검증완료'))::int AS approved_count,
              count(*) FILTER (WHERE status IN ('PENDING','검증전','승인 대기','대기'))::int AS pending_count,
              count(*) FILTER (WHERE NULLIF(txid,'') IS NOT NULL)::int AS tid_count
         FROM account_rows
        GROUP BY bank_name
        ORDER BY count DESC, bank_name ASC
        LIMIT $1`,
      [limit]
    );
    return avicxTable(['bank', 'count', 'approved', 'pending', 'tid'], rows.map(row => ({
      bank: row.bank_name || '-',
      count: avicxNumber(row.count),
      approved: avicxNumber(row.approved_count),
      pending: avicxNumber(row.pending_count),
      tid: avicxNumber(row.tid_count)
    })));
  }
  if (cmd === 'account' && sub === 'missing-tid') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const rows = await avicxRows(
      `(SELECT COALESCE(ar.submitted_at, ar.updated_at) AS time,
               COALESCE(u.franchise_name, ar.franchise_name) AS franchise_name,
               COALESCE(u.name, ar.representative_name) AS owner,
               COALESCE(u.login_id, u.email, '-') AS login,
               COALESCE(u.phone, '-') AS phone,
               '계좌요청' AS source,
               ar.bank_name,
               COALESCE(ar.account_no, ar.assigned_virtual_account->>'accountNumber', '') AS account_no,
               COALESCE(ar.representative_name, u.name, '') AS account_holder,
               ar.status,
               ar.txid,
               ar.manual_tid,
               ar.recurring_tid
          FROM account_requests ar
          LEFT JOIN users u ON u.franchise_id = ar.franchise_id
         WHERE COALESCE(ar.hidden, false) = false
           AND COALESCE(ar.status, '') IN ('APPROVED','승인완료','검증완료')
           AND NULLIF(COALESCE(ar.txid, ar.manual_tid, ar.recurring_tid, ''), '') IS NULL)
       UNION ALL
       (SELECT COALESCE(da.updated_at, da.req_date) AS time,
               u.franchise_name,
               u.name AS owner,
               COALESCE(u.login_id, u.email, '-') AS login,
               COALESCE(u.phone, '-') AS phone,
               '배달계좌' AS source,
               da.bank_name,
               da.account_no,
               da.account_holder,
               da.account_status AS status,
               da.txid,
               da.manual_tid,
               da.recurring_tid
          FROM delivery_accounts da
          LEFT JOIN users u ON u.franchise_id = da.franchise_id
         WHERE COALESCE(da.hidden, false) = false
           AND COALESCE(da.account_status, '') IN ('APPROVED','승인완료','검증완료')
           AND NULLIF(COALESCE(da.txid, da.manual_tid, da.recurring_tid, ''), '') IS NULL)
       ORDER BY time DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    return avicxTable(['time', 'franchise', 'owner', 'login', 'phone', 'source', 'bank', 'account', 'holder', 'status', 'txid', 'manualTid', 'recurringTid'], rows.map(row => ({
      time: row.time || '-',
      franchise: row.franchise_name || '-',
      owner: row.owner || '-',
      login: row.login || '-',
      phone: row.phone || '-',
      source: row.source || '-',
      bank: row.bank_name || '-',
      account: row.account_no || '-',
      holder: row.account_holder || '-',
      status: row.status || '-',
      txid: row.txid || '-',
      manualTid: row.manual_tid || '-',
      recurringTid: row.recurring_tid || '-'
    })));
  }  if (cmd === 'account' && sub === 'list') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const qTokens = tokens.slice(2).filter((t, idx, arr) => t.toLowerCase() !== 'limit' && String(arr[idx - 1] || '').toLowerCase() !== 'limit');
    if (qTokens.length > 1 && /^\d+$/.test(qTokens[qTokens.length - 1])) qTokens.pop();
    const q = qTokens.join(' ').trim();
    if (!q) return avicxLines(['가맹점명, 대표자명, 전화번호 중 하나를 같이 적어주세요. 예: 교촌치킨 계좌 알려줘'], 'warn');
    const rows = await avicxRows(
      `(SELECT COALESCE(u.franchise_name, ar.franchise_name) AS franchise_name,
               COALESCE(u.name, ar.representative_name) AS owner,
               COALESCE(u.login_id, u.email, '-') AS login,
               COALESCE(u.phone, '-') AS phone,
               '계좌요청' AS source,
               ar.bank_name,
               COALESCE(ar.account_no, ar.assigned_virtual_account->>'accountNumber', '') AS account_no,
               COALESCE(ar.representative_name, u.name, '') AS account_holder,
               ar.status,
               ar.txid,
               ar.submitted_at AS time
          FROM account_requests ar
          LEFT JOIN users u ON u.franchise_id = ar.franchise_id
         WHERE COALESCE(ar.hidden, false) = false
           AND (COALESCE(u.franchise_name, ar.franchise_name, '') ILIKE $1 OR COALESCE(u.name, ar.representative_name, '') ILIKE $1 OR COALESCE(u.login_id, u.email, '') ILIKE $1 OR COALESCE(u.phone, '') ILIKE $1 OR COALESCE(ar.bank_name, '') ILIKE $1 OR COALESCE(ar.account_no, ar.assigned_virtual_account->>'accountNumber', '') ILIKE $1 OR COALESCE(ar.representative_name, '') ILIKE $1 OR COALESCE(ar.txid, '') ILIKE $1 OR COALESCE(ar.manual_tid, '') ILIKE $1 OR COALESCE(ar.recurring_tid, '') ILIKE $1))
       UNION ALL
       (SELECT u.franchise_name,
               u.name AS owner,
               COALESCE(u.login_id, u.email, '-') AS login,
               COALESCE(u.phone, '-') AS phone,
               '배달계좌' AS source,
               da.bank_name,
               da.account_no,
               da.account_holder,
               da.account_status AS status,
               da.txid,
               COALESCE(da.updated_at, da.req_date) AS time
          FROM delivery_accounts da
          LEFT JOIN users u ON u.franchise_id = da.franchise_id
         WHERE COALESCE(da.hidden, false) = false
           AND (COALESCE(u.franchise_name, '') ILIKE $1 OR COALESCE(u.name, '') ILIKE $1 OR COALESCE(u.login_id, u.email, '') ILIKE $1 OR COALESCE(u.phone, '') ILIKE $1 OR COALESCE(da.bank_name, '') ILIKE $1 OR COALESCE(da.account_no, '') ILIKE $1 OR COALESCE(da.account_holder, '') ILIKE $1 OR COALESCE(da.txid, '') ILIKE $1 OR COALESCE(da.manual_tid, '') ILIKE $1 OR COALESCE(da.recurring_tid, '') ILIKE $1))
       ORDER BY time DESC NULLS LAST
       LIMIT $2`,
      [`%${q}%`, limit]
    );
    return avicxTable(['time', 'franchise', 'owner', 'login', 'phone', 'source', 'bank', 'account', 'holder', 'status', 'txid'], rows.map(row => ({
      time: row.time || '-',
      franchise: row.franchise_name || '-',
      owner: row.owner || '-',
      login: row.login || '-',
      phone: row.phone || '-',
      source: row.source || '-',
      bank: row.bank_name || '-',
      account: row.account_no || '-',
      holder: row.account_holder || '-',
      status: row.status || '-',
      txid: row.txid || '-'
    })));
  }
  if (cmd === 'account' && sub === 'pending') {
    const limit = avicxExtractLimit(tokens, 20, 100);
    const rows = await avicxRows("SELECT request_id, franchise_name, bank_name, account_no, representative_name, status, txid, submitted_at FROM account_requests WHERE status IN ('PENDING','검증전','승인 대기','대기') ORDER BY submitted_at DESC LIMIT $1", [limit]);
    return avicxTable(['time', 'request', 'franchise', 'bank', 'account', 'holder', 'status', 'txid'], rows.map(row => ({ time: row.submitted_at, request: row.request_id, franchise: row.franchise_name, bank: row.bank_name || '-', account: row.account_no || '-', holder: row.representative_name || '-', status: row.status, txid: row.txid || '-' })));
  }
  if (cmd === 'card' && sub === 'list') {
    const q = tokens.slice(2).join(' ').trim();
    if (!q) return avicxLines(['사용법: card list <가맹점명>'], 'warn');
    const rows = await avicxRows("SELECT c.id, u.franchise_name, c.masked_number, c.card_company, c.card_name, c.alias, c.active, c.hidden, c.created_at FROM cards c JOIN users u ON u.id = c.user_id WHERE u.franchise_name ILIKE $1 OR u.name ILIKE $1 OR u.login_id ILIKE $1 ORDER BY c.created_at DESC LIMIT 30", [`%${q}%`]);
    return avicxTable(['time', 'franchise', 'cardId', 'masked', 'company', 'card', 'alias', 'active', 'hidden'], rows.map(row => ({ time: row.created_at, franchise: row.franchise_name || '-', cardId: row.id, masked: row.masked_number, company: row.card_company || '-', card: row.card_name || '-', alias: row.alias || '-', active: row.active, hidden: row.hidden })));
  }
  if (cmd === 'db') {
    if (sub === 'tables') return avicxTable(['table', 'columns'], Array.from(AVICX_SAFE_TABLES.entries()).map(([name, cols]) => ({ table: name, columns: cols.join(', ') })));
    const table = String(tokens[2] || '').trim();
    if (!AVICX_SAFE_TABLES.has(table)) return avicxLines([`허용되지 않은 테이블입니다: ${table || '-'}`, `db tables 로 허용 목록을 확인하세요.`], 'warn');
    const columns = AVICX_SAFE_TABLES.get(table);
    if (sub === 'describe') return avicxTable(['table', 'column'], columns.map(column => ({ table, column })));
    if (sub === 'select') {
      const limit = avicxExtractLimit(tokens, 20, 50);
      const sql = `SELECT ${columns.map(col => '"' + col + '"').join(', ')} FROM "${table}" ORDER BY 1 DESC LIMIT $1`;
      const rows = await avicxRows(sql, [limit]);
      return avicxTable(columns, rows);
    }
  }
  if (cmd === 'explain') {
    const tx = tokens.slice(1).join(' ').trim();
    if (!tx) return avicxLines(['TXN번호, 승인번호, TID, 입금코드 중 하나를 같이 적어주세요.'], 'warn');
    const payments = await avicxRows("SELECT transaction_id, franchise_id, amount, fee, total_amount, pg, pg_tx_id, auth_code, status, created_at FROM transactions WHERE transaction_id = $1 OR pg_tx_id = $1 OR auth_code = $1 LIMIT 5", [tx]);
    const settles = await avicxRows("SELECT id, franchise_name, approval_no, pg_tx_id, payment_amt, net_amt, status, created_at FROM pg_settlements WHERE approval_no = $1 OR pg_tx_id = $1 LIMIT 5", [tx]);
    const notis = await avicxRows("SELECT id, provider, event_type, transaction_id, pg_transaction_id, result_code, result_message, received_at FROM pg_notifications WHERE transaction_id = $1 OR pg_transaction_id = $1 ORDER BY received_at DESC LIMIT 5", [tx]);
    const deposits = await avicxRows("SELECT provider, event_type, txid, bank_name, account_no, depositor_name, amount, received_at FROM deposit_notifications WHERE txid = $1 ORDER BY received_at DESC LIMIT 5", [tx]);
    const accounts = await avicxRows(
      `(SELECT '계좌요청' AS source, COALESCE(u.franchise_name, ar.franchise_name) AS franchise_name,
               COALESCE(u.name, ar.representative_name) AS owner, COALESCE(u.login_id, u.email, '-') AS login,
               ar.bank_name, COALESCE(ar.account_no, ar.assigned_virtual_account->>'accountNumber', '') AS account_no,
               COALESCE(ar.representative_name, u.name, '') AS holder, ar.status, ar.txid, ar.manual_tid, ar.recurring_tid, ar.submitted_at AS time
          FROM account_requests ar
          LEFT JOIN users u ON u.franchise_id = ar.franchise_id
         WHERE ar.request_id = $1 OR ar.txid = $1 OR ar.manual_tid = $1 OR ar.recurring_tid = $1)
       UNION ALL
       (SELECT '배달계좌' AS source, u.franchise_name, u.name AS owner, COALESCE(u.login_id, u.email, '-') AS login,
               da.bank_name, da.account_no, da.account_holder AS holder, da.account_status AS status,
               da.txid, da.manual_tid, da.recurring_tid, COALESCE(da.updated_at, da.req_date) AS time
          FROM delivery_accounts da
          LEFT JOIN users u ON u.franchise_id = da.franchise_id
         WHERE da.txid = $1 OR da.manual_tid = $1 OR da.recurring_tid = $1)
       ORDER BY time DESC NULLS LAST
       LIMIT 10`,
      [tx]
    );
    return { type: 'group', sections: [
      avicxTable(['transactionId','amount','pg','pgTx','auth','status','time'], payments.map(row => ({ transactionId: row.transaction_id, amount: avicxWon(row.amount), pg: row.pg || '-', pgTx: row.pg_tx_id || '-', auth: row.auth_code || '-', status: row.status || '-', time: row.created_at }))),
      avicxTable(['id','franchise','approval','pgTx','payment','net','status','time'], settles.map(row => ({ id: row.id, franchise: row.franchise_name || '-', approval: row.approval_no || '-', pgTx: row.pg_tx_id || '-', payment: avicxWon(row.payment_amt), net: avicxWon(row.net_amt), status: row.status || '-', time: row.created_at }))),
      avicxTable(['time','provider','event','txid','bank','account','depositor','amount'], deposits.map(row => ({ time: row.received_at, provider: row.provider || '-', event: row.event_type || '-', txid: row.txid || '-', bank: row.bank_name || '-', account: row.account_no || '-', depositor: row.depositor_name || '-', amount: avicxWon(row.amount) }))),
      avicxTable(['time','source','franchise','owner','login','bank','account','holder','status','txid','manualTid','recurringTid'], accounts.map(row => ({ time: row.time || '-', source: row.source || '-', franchise: row.franchise_name || '-', owner: row.owner || '-', login: row.login || '-', bank: row.bank_name || '-', account: row.account_no || '-', holder: row.holder || '-', status: row.status || '-', txid: row.txid || '-', manualTid: row.manual_tid || '-', recurringTid: row.recurring_tid || '-' }))),
      avicxTable(['time','provider','event','transactionId','pgTx','code','message'], notis.map(row => ({ time: row.received_at, provider: row.provider, event: row.event_type || '-', transactionId: row.transaction_id || '-', pgTx: row.pg_transaction_id || '-', code: row.result_code || '-', message: row.result_message || '-' })))
    ] };
  }
  if (cmd === 'codex' && sub === 'apply') {
    const question = tokens.slice(2).join(' ').trim();
    return avicxRunCodexApply(question);
  }
  if (cmd === 'codex' && ['exec', 'ask', 'adk'].includes(sub)) {
    const question = tokens.slice(2).join(' ').trim();
    return avicxRunCodexCli(question);
  }
  return avicxLines(['제가 바로 이해하지 못했어요.', '예: 오늘 매출 얼마야 / 누적 매출 보여줘 / 정산 대기 몇 건이야 처럼 물어봐 주세요.'], 'warn');
}

function createFriendlyAgencyJoinCode(agencyId) {
  const id = Number(agencyId);
  return Number.isFinite(id) && id > 0 ? `agency-${id}` : '';
}

function htmlAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function buildScopedCookie(req, name, value, maxAgeSeconds, pathValue) {
  const secure = req?.secure || String(req?.headers?.['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=${pathValue}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

function issueChPaywayProxyToken(req, res, adminIdOverride = null) {
  const token = crypto.randomBytes(24).toString('base64url');
  chPaywayProxyTokens.set(token, { adminId: adminIdOverride ?? req.user?.id ?? 0, expiresAt: Date.now() + CH_PAYWAY_PROXY_TTL_MS });
  res.setHeader('Set-Cookie', buildScopedCookie(req, 'ch_payway_proxy_token', token, Math.floor(CH_PAYWAY_PROXY_TTL_MS / 1000), '/api/admin/ch-payway/proxy'));
  return token;
}

function cleanupChPaywayProxyTokens() {
  const now = Date.now();
  for (const [token, entry] of chPaywayProxyTokens.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) chPaywayProxyTokens.delete(token);
  }
  for (const [token, entry] of chPaywayStartTokens.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) chPaywayStartTokens.delete(token);
  }
}

function hasValidChPaywayProxyToken(req) {
  cleanupChPaywayProxyTokens();
  const token = getCookieValue(req, 'ch_payway_proxy_token');
  const entry = token ? chPaywayProxyTokens.get(token) : null;
  return Boolean(entry && Number(entry.expiresAt || 0) > Date.now());
}

function issueChPaywayStartToken(req) {
  cleanupChPaywayProxyTokens();
  const token = crypto.randomBytes(24).toString('base64url');
  chPaywayStartTokens.set(token, { adminId: req.user?.id || 0, expiresAt: Date.now() + 60 * 1000 });
  return token;
}

function consumeChPaywayStartToken(token) {
  cleanupChPaywayProxyTokens();
  const key = String(token || '');
  const entry = key ? chPaywayStartTokens.get(key) : null;
  if (!entry || Number(entry.expiresAt || 0) <= Date.now()) return null;
  chPaywayStartTokens.delete(key);
  return entry;
}

function issueRouteupProxyToken(req, res, adminIdOverride = null) {
  const token = crypto.randomBytes(24).toString('base64url');
  routeupProxyTokens.set(token, { adminId: adminIdOverride ?? req.user?.id ?? 0, expiresAt: Date.now() + ROUTEUP_PROXY_TTL_MS });
  res.setHeader('Set-Cookie', buildScopedCookie(req, 'routeup_proxy_token', token, Math.floor(ROUTEUP_PROXY_TTL_MS / 1000), '/api/admin/routeup'));
  return token;
}

function cleanupRouteupProxyTokens() {
  const now = Date.now();
  for (const [token, entry] of routeupProxyTokens.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) routeupProxyTokens.delete(token);
  }
  for (const [token, entry] of routeupStartTokens.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) routeupStartTokens.delete(token);
  }
}

function hasValidRouteupProxyToken(req) {
  cleanupRouteupProxyTokens();
  const token = getCookieValue(req, 'routeup_proxy_token');
  const entry = token ? routeupProxyTokens.get(token) : null;
  return Boolean(entry && Number(entry.expiresAt || 0) > Date.now());
}

function issueRouteupStartToken(req) {
  cleanupRouteupProxyTokens();
  const token = crypto.randomBytes(24).toString('base64url');
  routeupStartTokens.set(token, { adminId: req.user?.id || 0, expiresAt: Date.now() + 60 * 1000 });
  return token;
}

function consumeRouteupStartToken(token) {
  cleanupRouteupProxyTokens();
  const key = String(token || '');
  const entry = key ? routeupStartTokens.get(key) : null;
  if (!entry || Number(entry.expiresAt || 0) <= Date.now()) return null;
  routeupStartTokens.delete(key);
  return entry;
}

function verifyRouteupSignature({ mid, timestamp, signature }) {
  const provided = String(signature || '').trim().toLowerCase();
  if (!ROUTEUP_SIGN_KEY || !provided) return { checked: false, valid: true };
  const message = `sign_key=${ROUTEUP_SIGN_KEY}&timestamp=${String(timestamp || '').trim()}&mid=${String(mid || '').trim()}`;
  const expected = crypto.createHash('sha256').update(message, 'utf8').digest('hex').toLowerCase();
  try {
    const providedBuffer = Buffer.from(provided, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return {
      checked: true,
      valid: providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    };
  } catch (_) {
    return { checked: true, valid: false };
  }
}

function normalizeAgencyJoinCode(value) {
  const code = String(value || '').trim().toLowerCase();
  if (!code) return '';
  if (!/^[a-z0-9-]{3,40}$/.test(code)) return '';
  if (/^-|-$|--/.test(code)) return '';
  return code;
}

async function createUniqueFriendlyAgencyJoinCode(agencyId) {
  const base = createFriendlyAgencyJoinCode(agencyId);
  if (!base) return '';
  for (let index = 0; index < 20; index += 1) {
    const code = index ? `${base}-${index + 1}` : base;
    const duplicate = await repo.findAgencyByJoinCode(code);
    if (!duplicate || Number(duplicate.id) === Number(agencyId)) return code;
  }
  return `${base}-${Date.now().toString(36).toLowerCase()}`.slice(0, 40);
}
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
const SYSTEM_ADMIN_LOGIN_ID = 'admin@eatspay.kr';
const ADMIN_SSO_CODE_TTL_SECONDS = Math.max(15, Math.min(300, Number(process.env.ADMIN_SSO_CODE_TTL_SECONDS || 60)));
const ADMIN_SSO_EATSGO_BASE_URL = String(process.env.ADMIN_SSO_EATSGO_BASE_URL || 'https://eatsgo.kr').replace(/\/$/, '');
const ADMIN_SSO_EATSPAY_EXCHANGE_SECRET = String(process.env.ADMIN_SSO_EATSPAY_EXCHANGE_SECRET || '');
const ADMIN_SSO_EATSGO_EXCHANGE_SECRET = String(process.env.ADMIN_SSO_EATSGO_EXCHANGE_SECRET || '');
const SYSTEM_ADMIN_ONLY_MENU_PERMISSIONS = new Set(['pg', 'push']);
const ADMIN_LEVELS = {
  SUPER: { key: 'SUPER', name: '총괄 관리자', desc: '모든 기능 + 관리자 계정 생성/삭제', color: '#EF4444' },
  OPERATIONS: { key: 'OPERATIONS', name: '운영 관리자', desc: '가맹점 승인, 대리점 관리, 운영 메뉴', color: '#F59E0B' },
  SETTLEMENT: { key: 'SETTLEMENT', name: '정산 관리자', desc: '결제 내역, PG정산 확인, 정산 조회', color: '#3B82F6' },
  CUSTOMER: { key: 'CUSTOMER', name: '고객 관리자', desc: '공지사항, FAQ, 이용가이드 작성/수정', color: '#3D9B35' }
};
const ADMIN_ROLE_LIST = Object.values(ADMIN_LEVELS).map((role, index) => ({ ...role, displayOrder: index + 1 }));
const AUDIT_NOTIFICATION_CATEGORIES = [
  { key: 'all', label: '전체 변경' },
  { key: 'banners', label: '배너 변경' },
  { key: 'franchises', label: '가맹점 변경' },
  { key: 'accounts', label: '출금계좌 변경' },
  { key: 'agencies', label: '대리점 변경' },
  { key: 'inquiries', label: '문의 변경' },
  { key: 'talk', label: '이츠톡 변경' },
  { key: 'boards', label: '게시판 변경' },
  { key: 'installments', label: '무이자 할부 변경' },
  { key: 'admins', label: '관리자 계정 변경' },
  { key: 'pg', label: 'PG 변경' },
  { key: 'system', label: '운영 설정 변경' }
];
const AUDIT_NOTIFICATION_CATEGORY_SET = new Set(AUDIT_NOTIFICATION_CATEGORIES.map(item => item.key));
const ADMIN_MENU_PERMISSIONS = {
  SUPER: ['dashboard', 'payments', 'pgsettle', 'settlements', 'franchises', 'franchiseDetail', 'accounts', 'agencies', 'agencyDetail', 'ag_detail', 'deliveryMgmt', 'inquiries', 'advanceInquiries', 'banners', 'legalDocs', 'faqs', 'installments', 'auditLogs', 'admins', 'notices', 'guides', 'talk'],
  OPERATIONS: ['dashboard', 'franchises', 'franchiseDetail', 'accounts', 'agencies', 'agencyDetail', 'ag_detail', 'deliveryMgmt', 'inquiries', 'advanceInquiries', 'banners', 'legalDocs', 'faqs', 'installments', 'notices', 'guides', 'talk'],
  SETTLEMENT: ['dashboard', 'payments', 'pgsettle', 'settlements'],
  CUSTOMER: ['dashboard', 'legalDocs', 'faqs', 'notices', 'guides', 'talk']
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
  { code: '050', name: '상호저축은행중앙회', iconUrl: '/assets/banks/federation-savings.svg' },
  { code: '050', name: 'SBI저축은행', iconUrl: '/assets/banks/sbi-savings.svg' },
  { code: '050', name: 'OK저축은행', iconUrl: '/assets/banks/ok-savings.svg' },
  { code: '050', name: '웰컴저축은행', iconUrl: '/assets/banks/welcome-savings.svg' },
  { code: '050', name: '애큐온저축은행', iconUrl: '/assets/banks/acuon-savings.svg' },
  { code: '050', name: '한국투자저축은행', iconUrl: '/assets/banks/koreainvest-savings.svg' },
  { code: '050', name: '페퍼저축은행', iconUrl: '/assets/banks/pepper-savings.svg' },
  { code: '050', name: '다올저축은행', iconUrl: '/assets/banks/daol-savings.svg' },
  { code: '050', name: '상상인저축은행', iconUrl: '/assets/banks/sangsangin-savings.svg' },
  { code: '050', name: '상상인플러스저축은행', iconUrl: '/assets/banks/sangsanginplus-savings.svg' },
  { code: '050', name: '모아저축은행', iconUrl: '/assets/banks/moa-savings.svg' },
  { code: '050', name: '스마트저축은행', iconUrl: '/assets/banks/smart-savings.svg' },
  { code: '050', name: 'DB저축은행', iconUrl: '/assets/banks/db-savings.svg' },
  { code: '050', name: '대신저축은행', iconUrl: '/assets/banks/daishin-savings.svg' },
  { code: '050', name: '키움저축은행', iconUrl: '/assets/banks/kiwoom-savings.svg' },
  { code: '050', name: '키움YES저축은행', iconUrl: '/assets/banks/kiwoomyes-savings.svg' },
  { code: '050', name: '하나저축은행', iconUrl: '/assets/banks/hana-savings.svg' },
  { code: '050', name: '신한저축은행', iconUrl: '/assets/banks/shinhan-savings.svg' },
  { code: '050', name: '우리금융저축은행', iconUrl: '/assets/banks/woori-savings.svg' },
  { code: '050', name: 'NH저축은행', iconUrl: '/assets/banks/nh-savings.svg' },
  { code: '050', name: 'KB저축은행', iconUrl: '/assets/banks/kb-savings.svg' },
  { code: '050', name: 'BNK저축은행', iconUrl: '/assets/banks/bnk-savings.svg' },
  { code: '050', name: 'IBK저축은행', iconUrl: '/assets/banks/ibk-savings.svg' },
  { code: '050', name: 'JT저축은행', iconUrl: '/assets/banks/jt-savings.svg' },
  { code: '050', name: 'JT친애저축은행', iconUrl: '/assets/banks/jtchinae-savings.svg' },
  { code: '050', name: 'OSB저축은행', iconUrl: '/assets/banks/osb-savings.svg' },
  { code: '050', name: '푸른저축은행', iconUrl: '/assets/banks/pureun-savings.svg' },
  { code: '050', name: '예가람저축은행', iconUrl: '/assets/banks/yegaram-savings.svg' },
  { code: '050', name: '바로저축은행', iconUrl: '/assets/banks/baro-savings.svg' },
  { code: '050', name: '참저축은행', iconUrl: '/assets/banks/charm-savings.svg' },
  { code: '050', name: '고려저축은행', iconUrl: '/assets/banks/koryo-savings.svg' },
  { code: '050', name: '동원제일저축은행', iconUrl: '/assets/banks/dongwon-savings.svg' },
  { code: '050', name: '흥국저축은행', iconUrl: '/assets/banks/heungkuk-savings.svg' },
  { code: '050', name: '유안타저축은행', iconUrl: '/assets/banks/yuanta-savings.svg' },
  { code: '050', name: 'CK저축은행', iconUrl: '/assets/banks/ck-savings.svg' },
  { code: '050', name: '오투저축은행', iconUrl: '/assets/banks/o2-savings.svg' },
  { code: '050', name: '대한저축은행', iconUrl: '/assets/banks/daehan-savings.svg' },
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
const ROUTEUP_FINANCIAL_INSTITUTIONS = [
  { code: '001', name: '한국은행' },
  { code: '005', name: '외환은행' },
  { code: '008', name: '수출입은행' },
  { code: '007', name: '수협은행' },
  { code: '012', name: '농협회원조합' },
  { code: '023', name: 'SC제일은행' },
  { code: '026', name: '서울은행' },
  { code: '045', name: '새마을금고연합회' },
  { code: '050', name: '상호저축은행' },
  { code: '051', name: '기타 외국계은행' },
  { code: '052', name: '모건스탠리은행' },
  { code: '056', name: '알비에스피엘씨은행' },
  { code: '058', name: '미즈호코퍼레이트은행' },
  { code: '059', name: '미쓰비시도쿄UFJ은행' },
  { code: '060', name: 'BOA' },
  { code: '062', name: '중국공상은행' },
  { code: '063', name: '중국은행' },
  { code: '065', name: '대화은행' },
  { code: '076', name: '신용보증기금' },
  { code: '077', name: '기술신용보증기금' },
  { code: '094', name: '서울보증보험' },
  { code: '101', name: '한국신용정보원' },
  { code: '103', name: 'SBI저축은행' },
  { code: '105', name: '웰컴저축은행' },
  { code: '190', name: '융창저축은행' },
  { code: '191', name: '청주저축은행' },
  { code: '192', name: '금화저축은행' },
  { code: '193', name: '저축은행' },
  { code: '221', name: '상상인증권' },
  { code: '222', name: '한양증권' },
  { code: '223', name: '리딩투자증권' },
  { code: '224', name: 'BNK투자증권' },
  { code: '225', name: 'IBK투자증권' },
  { code: '227', name: '다올투자증권' },
  { code: '262', name: '하이투자증권' },
  { code: '265', name: '이베스트투자증권' },
  { code: '270', name: '하나증권' },
  { code: '272', name: 'NH선물' },
  { code: '273', name: '코리아에셋투자증권' },
  { code: '274', name: 'DS투자증권' },
  { code: '275', name: '흥국증권' },
  { code: '278', name: '신한투자증권' },
  { code: '290', name: '부국증권' },
  { code: '291', name: '신영증권' },
  { code: '292', name: '케이프투자증권' },
  { code: '293', name: '한국증권금융' },
  { code: '294', name: '한국포스증권' },
  { code: '295', name: '우리종합금융' }
];
const dbBootstrapPromise = (async () => {
  await pool.query('ALTER TABLE users ALTER COLUMN franchise_id DROP NOT NULL');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS login_id TEXT UNIQUE');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_email TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS biz_doc_file_key TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS pos_file_key TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS franchise_fee_rate NUMERIC(5,2)');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_agency_id BIGINT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_join_code TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS pg_provider_id BIGINT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS note TEXT');
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
  await pool.query('ALTER TABLE cards ADD COLUMN IF NOT EXISTS pg_provider_id BIGINT');
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
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS manual_tid TEXT');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS manual_key TEXT');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS recurring_tid TEXT');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS recurring_key TEXT');
  await pool.query('ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS txid_uploaded_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS export_ready_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS export_batch_id TEXT');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS export_row_no INTEGER');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS txid TEXT');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS manual_tid TEXT');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS manual_key TEXT');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS recurring_tid TEXT');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS recurring_key TEXT');
  await pool.query('ALTER TABLE delivery_accounts ADD COLUMN IF NOT EXISTS txid_uploaded_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deposit_account_source TEXT');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deposit_account_id TEXT');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deposit_bank_name TEXT');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deposit_account_no TEXT');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deposit_account_holder TEXT');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deposit_delivery_agency TEXT');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deposit_txid TEXT');
  await pool.query('ALTER TABLE pg_settlements ADD COLUMN IF NOT EXISTS account_holder TEXT');
  await pool.query("UPDATE delivery_accounts SET approved_at = COALESCE(approved_at, updated_at, req_date) WHERE account_status = 'APPROVED'");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_rejection_reasons (
      id BIGSERIAL PRIMARY KEY,
      reason TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT true,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    INSERT INTO account_rejection_reasons (reason, display_order)
    VALUES
      ('계좌번호 확인 불가', 10),
      ('예금주 불일치', 20),
      ('증빙 사진 식별 불가', 30),
      ('배달대행사 정보 불일치', 40),
      ('기타', 50)
    ON CONFLICT (reason) DO NOTHING
  `);
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
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id BIGINT,
      actor_role TEXT NOT NULL DEFAULT '',
      actor_login_id TEXT NOT NULL DEFAULT '',
      actor_name TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      entity_name TEXT NOT NULL DEFAULT '',
      before_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      after_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      changed_fields TEXT[] NOT NULL DEFAULT '{}',
      request_method TEXT NOT NULL DEFAULT '',
      request_path TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action, created_at DESC)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_notification_preferences (
      id BIGSERIAL PRIMARY KEY,
      admin_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (admin_user_id, category)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_notification_preferences_user
    ON admin_audit_notification_preferences(admin_user_id, category)`);
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
    CREATE TABLE IF NOT EXISTS pg_assignment_rules (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      pg_provider_id BIGINT NOT NULL REFERENCES pg_providers(id) ON DELETE CASCADE,
      agency_id BIGINT REFERENCES agencies(id) ON DELETE SET NULL,
      join_code TEXT,
      start_date DATE,
      end_date DATE,
      weekdays INTEGER[] NOT NULL DEFAULT '{}',
      priority INTEGER NOT NULL DEFAULT 100,
      active BOOLEAN NOT NULL DEFAULT true,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_pg_assignment_rules_active_priority ON pg_assignment_rules(active, priority, id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_pg_assignment_rules_agency ON pg_assignment_rules(agency_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_pg_assignment_rules_join_code ON pg_assignment_rules(lower(join_code))');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_pg_contracts (
      id BIGSERIAL PRIMARY KEY,
      account_source TEXT NOT NULL,
      account_id TEXT NOT NULL,
      franchise_id BIGINT NOT NULL,
      pg_provider_id BIGINT REFERENCES pg_providers(id) ON DELETE SET NULL,
      pg_provider_name TEXT NOT NULL,
      credential_type TEXT NOT NULL DEFAULT 'recurring',
      mid TEXT,
      tid TEXT NOT NULL,
      payment_key TEXT,
      signature_key TEXT,
      contract_start_date DATE,
      contract_end_date DATE,
      device_type TEXT,
      is_default BOOLEAN NOT NULL DEFAULT true,
      active BOOLEAN NOT NULL DEFAULT true,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (account_source, account_id, pg_provider_name, credential_type, tid)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_account_pg_contracts_account ON account_pg_contracts(account_source, account_id, active)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_account_pg_contracts_franchise ON account_pg_contracts(franchise_id, pg_provider_name, active)');
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
    CREATE TABLE IF NOT EXISTS deposit_notifications (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'DEPOSIT',
      event_type TEXT,
      txid TEXT,
      account_no TEXT,
      bank_name TEXT,
      depositor_name TEXT,
      amount NUMERIC(14, 0),
      result_code TEXT,
      result_message TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      query JSONB NOT NULL DEFAULT '{}'::jsonb,
      headers JSONB NOT NULL DEFAULT '{}'::jsonb,
      processed BOOLEAN NOT NULL DEFAULT false,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_deposit_notifications_received_at ON deposit_notifications(received_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_deposit_notifications_txid ON deposit_notifications(txid)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_deposit_notifications_account_no ON deposit_notifications(account_no)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_console_sessions (
      id TEXT PRIMARY KEY,
      admin_user_id BIGINT,
      admin_email TEXT,
      title TEXT NOT NULL DEFAULT 'AVICX Session',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_admin_console_sessions_admin ON admin_console_sessions(admin_user_id, updated_at DESC)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_console_commands (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES admin_console_sessions(id) ON DELETE CASCADE,
      admin_user_id BIGINT,
      command TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      output JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_admin_console_commands_session ON admin_console_commands(session_id, id DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_admin_console_commands_admin ON admin_console_commands(admin_user_id, created_at DESC)');
  await pool.query(
    `CREATE TABLE IF NOT EXISTS itzbi_learning_rules (
      id BIGSERIAL PRIMARY KEY,
      trigger_text TEXT NOT NULL,
      trigger_key TEXT NOT NULL UNIQUE,
      command_text TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      priority INTEGER NOT NULL DEFAULT 100,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  );
  await pool.query('CREATE INDEX IF NOT EXISTS idx_itzbi_learning_rules_active ON itzbi_learning_rules(active, priority, id)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pg_settlement_ch_checks (
      settlement_id BIGINT PRIMARY KEY,
      approval_no TEXT NOT NULL,
      pg_tx_id TEXT NOT NULL,
      last_checked_at TIMESTAMPTZ,
      next_check_at TIMESTAMPTZ,
      check_count INTEGER NOT NULL DEFAULT 0,
      last_result TEXT,
      last_error TEXT,
      confirmed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_pg_settlement_ch_checks_next ON pg_settlement_ch_checks(next_check_at, confirmed_at)');
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
    DELETE FROM pg_providers a
    USING pg_providers b
    WHERE a.id > b.id
      AND a.name = b.name
  `);
  await pool.query(`
    DELETE FROM pg_providers
    WHERE name IN ('넥스트페이', '넥스트페이 (NextPay)', '이츠페이 예비 PG')
  `);
  await pool.query(`
    UPDATE pg_providers
    SET mid = 'M233207',
        callback_url = 'https://eatspay.kr/api/routeup/notify',
        status = CASE WHEN status = '준비중' THEN '활성' ELSE status END,
        updated_at = now()
    WHERE name = '위루트'
      AND (mid IS NULL OR btrim(mid) = '' OR mid = '운영팀 전달 예정')
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
      ('위루트', 'M233207', 'Authorization Pay Key 운영팀 전달 예정', 'https://eatspay.kr/api/routeup/notify', '활성', 'Routeup API · Host https://api.routeup.kr · 결제통지 Noti URL · Webhook IP 221.168.33.227 허용 · 성공응답 {} · 입금노티 Postman 전문 대기', 2)
    ) AS seed(name, mid, api_key, callback_url, status, note, display_order)
    WHERE NOT EXISTS (SELECT 1 FROM pg_providers p WHERE p.name = seed.name)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_inquiries (
      id BIGSERIAL PRIMARY KEY,
      inquiry_type TEXT NOT NULL DEFAULT '지점/지사 개설',
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
  await pool.query("ALTER TABLE agency_inquiries ADD COLUMN IF NOT EXISTS inquiry_type TEXT NOT NULL DEFAULT '지점/지사 개설'");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_agency_inquiries_status ON agency_inquiries(status, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_agency_inquiries_type_status ON agency_inquiries(inquiry_type, status, created_at DESC)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS advance_inquiries (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      franchise_id BIGINT,
      franchise_name TEXT,
      phone TEXT NOT NULL,
      email TEXT,
      delivery_sales_manwon INTEGER NOT NULL DEFAULT 0,
      delivery_apps TEXT,
      store_sales_manwon INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '상담 대기',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_advance_inquiries_status ON advance_inquiries(status, created_at DESC)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_posts (
      id BIGSERIAL PRIMARY KEY,
      board_type TEXT NOT NULL CHECK (board_type IN ('notices', 'guides', 'announcements')),
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '운영팀',
      content TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('ALTER TABLE board_posts DROP CONSTRAINT IF EXISTS board_posts_board_type_check');
  await pool.query("ALTER TABLE board_posts ADD CONSTRAINT board_posts_board_type_check CHECK (board_type IN ('notices', 'guides', 'announcements'))");
  await pool.query('ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0');
  await pool.query("ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_post_likes (
      post_id BIGINT NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (post_id, user_id)
    )
  `);
  await pool.query(`
    WITH ranked AS (
      SELECT id, row_number() OVER (PARTITION BY board_type ORDER BY created_at DESC, id DESC) AS row_no
      FROM board_posts
      WHERE display_order = 0
    )
    UPDATE board_posts bp
    SET display_order = ranked.row_no
    FROM ranked
    WHERE bp.id = ranked.id
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_board_posts_type_active ON board_posts(board_type, active, display_order ASC, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_board_post_likes_user ON board_post_likes(user_id, created_at DESC)');
  await pool.query(`
    INSERT INTO board_posts (board_type, title, author, content, active, display_order)
    SELECT 'notices', '2026년 6월 시스템 점검 안내', '운영팀', '보다 안정적인 서비스 제공을 위해 시스템 점검이 진행됩니다.', true, 1
    WHERE NOT EXISTS (SELECT 1 FROM board_posts WHERE board_type = 'notices')
  `);
  await pool.query(`
    INSERT INTO board_posts (board_type, title, author, content, active, display_order)
    SELECT 'guides', '이츠페이 가입 방법 안내', 'CS팀', '가입 URL 접속 후 사업자 정보와 배달대행사 가상계좌 정보를 등록해 주세요.', true, 1
    WHERE NOT EXISTS (SELECT 1 FROM board_posts WHERE board_type = 'guides')
  `);
  await pool.query(`
    INSERT INTO board_posts (board_type, title, author, content, active, display_order)
    SELECT 'announcements', '세금신고 자료 확인 안내', '본사 알림장', '부가세 신고 기간에는 결제내역과 정산내역을 먼저 확인해 주세요.', true, 1
    WHERE NOT EXISTS (SELECT 1 FROM board_posts WHERE board_type = 'announcements')
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
    CREATE TABLE IF NOT EXISTS design_sets (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT 'homepage',
      layout TEXT NOT NULL DEFAULT 'banner',
      tone TEXT NOT NULL DEFAULT '',
      colors JSONB NOT NULL DEFAULT '[]'::jsonb,
      cta_style TEXT NOT NULL DEFAULT '',
      reference_image_url TEXT NOT NULL DEFAULT '',
      prompt_template TEXT NOT NULL DEFAULT '',
      design_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
      active BOOLEAN NOT NULL DEFAULT true,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_design_sets_active_updated ON design_sets(active, updated_at DESC, id DESC)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brand_kits (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      logo_url TEXT NOT NULL DEFAULT '',
      primary_color TEXT NOT NULL DEFAULT '#03C75A',
      secondary_color TEXT NOT NULL DEFAULT '#3D9B35',
      accent_color TEXT NOT NULL DEFAULT '#4FA72E',
      surface_color TEXT NOT NULL DEFAULT '#FFFFFF',
      text_color TEXT NOT NULL DEFAULT '#12351B',
      font_family TEXT NOT NULL DEFAULT 'Pretendard',
      heading_font_family TEXT NOT NULL DEFAULT 'Pretendard',
      default_cta_label TEXT NOT NULL DEFAULT '',
      default_cta_url TEXT NOT NULL DEFAULT '',
      contact_text TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_brand_kits_active_name ON brand_kits(active, name, id)');
  await pool.query(`
    INSERT INTO brand_kits (
      name, slug, primary_color, secondary_color, accent_color, surface_color,
      text_color, font_family, heading_font_family, default_cta_label,
      default_cta_url, contact_text, active
    )
    SELECT '이츠페이', 'eatspay', '#03C75A', '#3D9B35', '#4FA72E', '#FFFFFF',
           '#12351B', 'Pretendard', 'Pretendard', '1분 상담 신청하기',
           'https://eatspay.co.kr', '고객센터 1566-3558', true
    WHERE NOT EXISTS (SELECT 1 FROM brand_kits WHERE slug = 'eatspay')
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS design_documents (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('banner', 'popup')),
      brand_kit_id BIGINT REFERENCES brand_kits(id) ON DELETE RESTRICT,
      width INTEGER NOT NULL CHECK (width BETWEEN 120 AND 4096),
      height INTEGER NOT NULL CHECK (height BETWEEN 120 AND 4096),
      canvas_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      preview_url TEXT NOT NULL DEFAULT '',
      export_url TEXT NOT NULL DEFAULT '',
      export_format TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_design_documents_kind_updated ON design_documents(status, kind, updated_at DESC, id DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_design_documents_brand ON design_documents(brand_kit_id, status, updated_at DESC)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS design_document_versions (
      id BIGSERIAL PRIMARY KEY,
      design_document_id BIGINT NOT NULL REFERENCES design_documents(id) ON DELETE CASCADE,
      version INTEGER NOT NULL CHECK (version > 0),
      canvas_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      preview_url TEXT NOT NULL DEFAULT '',
      export_url TEXT NOT NULL DEFAULT '',
      export_format TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (design_document_id, version)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_design_document_versions_doc ON design_document_versions(design_document_id, version DESC)');
  await pool.query('ALTER TABLE banners ADD COLUMN IF NOT EXISTS design_document_id BIGINT REFERENCES design_documents(id) ON DELETE SET NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_banners_design_document ON banners(design_document_id)');
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
  await pool.query("ALTER TABLE talk_posts ADD COLUMN IF NOT EXISTS admin_deleted_reason TEXT NOT NULL DEFAULT ''");
  await pool.query('ALTER TABLE talk_posts ADD COLUMN IF NOT EXISTS admin_deleted_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE talk_posts ADD COLUMN IF NOT EXISTS admin_deleted_by BIGINT');
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
    CREATE TABLE IF NOT EXISTS talk_comment_likes (
      comment_id BIGINT NOT NULL REFERENCES talk_comments(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (comment_id, user_id)
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
    CREATE TABLE IF NOT EXISTS interest_free_installments (
      policy_month DATE NOT NULL DEFAULT date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date,
      card_company TEXT PRIMARY KEY,
      months INTEGER[] NOT NULL DEFAULT '{}',
      partial_plans JSONB NOT NULL DEFAULT '[]'::jsonb,
      active BOOLEAN NOT NULL DEFAULT true,
      display_order INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('ALTER TABLE interest_free_installments ADD COLUMN IF NOT EXISTS policy_month DATE');
  await pool.query("ALTER TABLE interest_free_installments ADD COLUMN IF NOT EXISTS partial_plans JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query("UPDATE interest_free_installments SET policy_month = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date WHERE policy_month IS NULL");
  await pool.query("ALTER TABLE interest_free_installments ALTER COLUMN policy_month SET DEFAULT date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date");
  await pool.query('ALTER TABLE interest_free_installments ALTER COLUMN policy_month SET NOT NULL');
  await pool.query('ALTER TABLE interest_free_installments DROP CONSTRAINT IF EXISTS interest_free_installments_pkey');
  await pool.query('ALTER TABLE interest_free_installments ADD PRIMARY KEY (policy_month, card_company)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS installment_policy_meta (
      policy_month DATE PRIMARY KEY,
      general_note TEXT NOT NULL DEFAULT '',
      exclusion_notes TEXT[] NOT NULL DEFAULT '{}',
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
  await pool.query("ALTER TABLE financial_institutions ADD COLUMN IF NOT EXISTS icon_url TEXT NOT NULL DEFAULT ''");
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
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  const nativeAppOrigins = ['http://localhost', 'capacitor://localhost', 'ionic://localhost'];
  const configuredCorsOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  const defaultCorsOrigins = process.env.NODE_ENV === 'production'
    ? ['https://eatspay.kr', 'https://www.eatspay.kr']
    : ['*'];
  const allowedOrigins = [
    ...(configuredCorsOrigins.length ? configuredCorsOrigins : defaultCorsOrigins),
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

const staticOptions = {
  dotfiles: 'deny',
  etag: true,
  lastModified: true,
  maxAge: '1h',
  index: false,
  redirect: false
};
const uploadStaticOptions = {
  ...staticOptions,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
  }
};
const publicRootFiles = new Set([
  'sw.js',
  'logo.png',
  'Asset 1@2x.png',
  '구글.png',
  '네이버.png',
  '카카오톡.png'
]);
app.use('/css', express.static(path.join(__dirname, 'css'), staticOptions));
app.use('/js', express.static(path.join(__dirname, 'js'), staticOptions));
app.use('/assets', express.static(path.join(__dirname, 'assets'), staticOptions));
app.use('/admin-assets', express.static(path.join(__dirname, 'admin-assets'), staticOptions));
app.use('/tv-dashboard', express.static(path.join(__dirname, 'tv-dashboard'), staticOptions));
app.use('/uploads', express.static(uploadDir, uploadStaticOptions));
app.get('/:publicFile', (req, res, next) => {
  const fileName = String(req.params.publicFile || '');
  if (!publicRootFiles.has(fileName)) return next();
  return res.sendFile(path.join(__dirname, fileName));
});

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

app.get('/tv-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'tv-dashboard', 'index.html'));
});

app.get('/join/:joinCode', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/public/agency-invites/:joinCode', asyncHandler(async (req, res) => {
  const joinCode = String(req.params.joinCode || '').trim();
  if (!joinCode) {
    return sendError(res, 400, 'BAD_REQUEST', '가입 링크 코드가 없습니다.');
  }
  const agency = await repo.findAgencyByJoinCode(joinCode);
  const invite = createPublicAgencyInvite(agency);
  if (!invite) {
    return sendError(res, 404, 'AGENCY_JOIN_CODE_NOT_FOUND', '유효하지 않은 가입 링크입니다.');
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ success: true, data: invite });
}));

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

app.get('/api/talk/posts/:id/comments', optionalAuthenticate, asyncHandler(async (req, res) => {
  const post = await repo.findTalkPostById(Number(req.params.id));
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', 'Talk 글을 찾을 수 없습니다.');
  }
  const comments = await repo.listTalkComments(post.id, req.user?.id || null);
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

app.post('/api/talk/posts/:postId/comments/:commentId/like', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role === 'AGENCY') {
    return sendError(res, 403, 'ACCESS_DENIED', '대리점 계정은 댓글 관심을 이용할 수 없습니다.');
  }
  if (req.user.role !== 'OWNER') {
    return sendError(res, 403, 'ACCESS_DENIED', '승인된 가맹점 계정만 댓글 관심을 이용할 수 있습니다.');
  }
  const post = await repo.findTalkPostById(Number(req.params.postId));
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', 'Talk 글을 찾을 수 없습니다.');
  }
  const comment = await repo.findTalkCommentById(Number(req.params.commentId));
  if (!comment || String(comment.postId) !== String(post.id)) {
    return sendError(res, 404, 'TALK_COMMENT_NOT_FOUND', '댓글을 찾을 수 없습니다.');
  }
  const state = await repo.toggleTalkCommentLike({
    commentId: comment.id,
    userId: req.user.id
  });
  return res.status(200).json({ success: true, data: state });
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

  await recordAuditLog(req, {
    action: 'TALK_POST_CREATE',
    entityType: 'talk_post',
    entityId: post.id,
    entityName: post.title || title,
    beforeData: {},
    afterData: {
      id: post.id,
      title: post.title,
      franchiseName: post.franchiseName,
      authorLoginId: req.user.loginId || req.user.email || '',
      price: post.price,
      tradeStatus: post.tradeStatus,
      status: post.status
    },
    changedFields: ['title', 'franchiseName', 'price', 'tradeStatus']
  });

  return res.status(201).json({
    success: true,
    message: 'Talk 글이 등록되었습니다.',
    data: {
      ...post,
      authorLoginId: req.user.loginId || req.user.email || '',
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
  const beforePost = await repo.findTalkPostById(Number(req.params.id));
  const post = await repo.updateTalkPostTradeStatus({
    id: Number(req.params.id),
    userId: req.user.id,
    tradeStatus: nextStatus
  });
  if (!post) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', '내가 등록한 Talk 글을 찾을 수 없습니다.');
  }
  await recordAuditLog(req, {
    action: 'TALK_POST_TRADE_STATUS',
    entityType: 'talk_post',
    entityId: post.id,
    entityName: post.title || '',
    beforeData: {
      id: beforePost?.id || post.id,
      title: beforePost?.title || post.title,
      franchiseName: beforePost?.franchiseName || post.franchiseName,
      tradeStatus: beforePost?.tradeStatus || ''
    },
    afterData: {
      id: post.id,
      title: post.title,
      franchiseName: post.franchiseName,
      tradeStatus: post.tradeStatus
    },
    changedFields: ['tradeStatus']
  });
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

let adminSsoTablesReady = false;

async function ensureAdminSsoTables() {
  if (adminSsoTablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_sso_codes (
      id BIGSERIAL PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      issuer TEXT NOT NULL,
      audience TEXT NOT NULL,
      admin_login_id TEXT NOT NULL,
      admin_snapshot JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS admin_sso_codes_expiry_idx ON admin_sso_codes (expires_at);
    CREATE TABLE IF NOT EXISTS admin_sso_events (
      id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      issuer TEXT NOT NULL,
      audience TEXT NOT NULL,
      admin_login_id TEXT,
      result TEXT NOT NULL,
      reason TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('ALTER TABLE admin_sso_codes ADD COLUMN IF NOT EXISTS browser_state_hash TEXT');
  adminSsoTablesReady = true;
}

function createAdminSsoCodeValue() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashAdminSsoCode(code) {
  return crypto.createHash('sha256').update(String(code || '')).digest('hex');
}

function safeAdminSsoSecretEqual(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function isValidAdminSsoState(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''));
}

function eatspayAdminSsoIdentity(user) {
  const adminLevel = normalizeAdminLevel(user?.adminLevel);
  return {
    loginId: String(user?.loginId || user?.email || '').trim().toLowerCase(),
    name: String(user?.name || 'Eats Pay Admin').trim(),
    adminLevel,
    adminPermissions: normalizeAdminPermissions(user?.adminPermissions, adminLevel),
    active: user?.adminActive !== false,
    issuer: 'eatspay-admin',
    audience: 'eatsgo-admin'
  };
}

function normalizeInboundAdminSsoIdentity(input = {}) {
  const loginId = String(input.loginId || '').trim().toLowerCase();
  if (!loginId) throw new Error('SSO_LOGIN_ID_REQUIRED');
  if (input.active !== true) throw new Error('SSO_ADMIN_INACTIVE');
  const rawLevel = String(input.adminLevel || '').trim();
  const labelMatch = ADMIN_ROLE_LIST.find(role => role.name === rawLevel);
  const strictLevel = ADMIN_LEVELS[rawLevel] ? rawLevel : labelMatch?.key;
  if (!strictLevel) throw new Error('UNSUPPORTED_ADMIN_LEVEL');
  const adminLevel = loginId === SYSTEM_ADMIN_LOGIN_ID ? 'SUPER' : strictLevel;
  return {
    loginId,
    name: String(input.name || loginId).trim(),
    adminLevel,
    adminPermissions: normalizeAdminPermissions(null, adminLevel),
    active: true
  };
}

async function createStoredAdminSsoCode({ codeHash, identity, expiresAt, stateHash }) {
  await ensureAdminSsoTables();
  await pool.query("DELETE FROM admin_sso_codes WHERE expires_at < now() - interval '1 day'");
  await pool.query(
    `INSERT INTO admin_sso_codes
       (code_hash, issuer, audience, admin_login_id, admin_snapshot, expires_at, browser_state_hash)
     VALUES ($1, 'eatspay-admin', 'eatsgo-admin', $2, $3::jsonb, $4, $5)`,
    [codeHash, identity.loginId, JSON.stringify(identity), expiresAt, stateHash]
  );
}

async function consumeStoredAdminSsoCode(codeHash, audience, stateHash) {
  await ensureAdminSsoTables();
  const result = await pool.query(
    `UPDATE admin_sso_codes
     SET consumed_at = now()
     WHERE code_hash = $1 AND audience = $2 AND browser_state_hash = $3
       AND consumed_at IS NULL AND expires_at > now()
     RETURNING admin_snapshot`,
    [codeHash, audience, stateHash]
  );
  return result.rows[0]?.admin_snapshot || null;
}

async function recordAdminSsoEvent(req, event) {
  try {
    await ensureAdminSsoTables();
    await pool.query(
      `INSERT INTO admin_sso_events
         (event_type, issuer, audience, admin_login_id, result, reason, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [event.eventType, event.issuer, event.audience, event.loginId || null, event.result, event.reason || null, req.ip || null, req.get('user-agent') || null]
    );
  } catch (error) {
    console.warn('[ADMIN_SSO_AUDIT_FAILED]', error.message);
  }
}

async function provisionEatspayAdminFromSso(rawIdentity) {
  const identity = normalizeInboundAdminSsoIdentity(rawIdentity);
  const existing = await repo.findUserByLoginId(identity.loginId);
  if (!existing || existing.role !== 'ADMIN' || existing.adminActive === false) {
    throw new Error('SSO_ADMIN_NOT_FOUND');
  }
  return existing;
}

function setEatspayAdminSsoStateCookie(req, res, state) {
  res.cookie('eatspay_admin_sso_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https'),
    maxAge: 3 * 60 * 1000,
    path: '/admin/sso/eatsgo'
  });
}

function clearEatspayAdminSsoStateCookie(res) {
  res.clearCookie('eatspay_admin_sso_state', { path: '/admin/sso/eatsgo' });
}

app.get('/admin/sso/eatsgo/init', (req, res) => {
  const state = createAdminSsoCodeValue();
  setEatspayAdminSsoStateCookie(req, res, state);
  const source = new URL('/api/admin/sso/eatspay/start', ADMIN_SSO_EATSGO_BASE_URL);
  source.searchParams.set('state', state);
  return res.redirect(302, source.toString());
});

app.get('/api/admin/sso/eatsgo/start', authenticateAdmin, asyncHandler(async (req, res) => {
  if (!ADMIN_SSO_EATSPAY_EXCHANGE_SECRET) {
    return sendError(res, 503, 'SSO_NOT_CONFIGURED', '관리자 서비스 연동이 설정되지 않았습니다.');
  }
  const state = String(req.query?.state || '');
  if (!isValidAdminSsoState(state)) {
    return sendError(res, 400, 'SSO_STATE_INVALID', 'SSO browser state is invalid.');
  }
  const code = createAdminSsoCodeValue();
  const identity = eatspayAdminSsoIdentity(req.user);
  await createStoredAdminSsoCode({
    codeHash: hashAdminSsoCode(code),
    identity,
    expiresAt: new Date(Date.now() + ADMIN_SSO_CODE_TTL_SECONDS * 1000),
    stateHash: hashAdminSsoCode(state)
  });
  await recordAdminSsoEvent(req, {
    eventType: 'issue', issuer: 'eatspay-admin', audience: 'eatsgo-admin',
    loginId: identity.loginId, result: 'success'
  });
  const target = new URL('/admin/sso/eatspay', ADMIN_SSO_EATSGO_BASE_URL);
  target.searchParams.set('code', code);
  target.searchParams.set('state', state);
  return res.redirect(302, target.toString());
}));

app.post('/api/admin/sso/exchange', asyncHandler(async (req, res) => {
  const authorization = String(req.headers.authorization || '');
  const presentedSecret = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!safeAdminSsoSecretEqual(presentedSecret, ADMIN_SSO_EATSPAY_EXCHANGE_SECRET)) {
    await recordAdminSsoEvent(req, {
      eventType: 'exchange', issuer: 'eatspay-admin', audience: String(req.body?.audience || ''),
      result: 'rejected', reason: 'unauthorized'
    });
    return sendError(res, 401, 'SSO_EXCHANGE_UNAUTHORIZED', 'SSO exchange authentication failed.');
  }
  const code = String(req.body?.code || '');
  const audience = String(req.body?.audience || '');
  const state = String(req.body?.state || '');
  if (!code || !isValidAdminSsoState(state) || audience !== 'eatsgo-admin') {
    await recordAdminSsoEvent(req, {
      eventType: 'exchange', issuer: 'eatspay-admin', audience,
      result: 'rejected', reason: 'invalid_request'
    });
    return sendError(res, 400, 'SSO_EXCHANGE_INVALID', 'SSO exchange request is invalid.');
  }
  const identity = await consumeStoredAdminSsoCode(hashAdminSsoCode(code), audience, hashAdminSsoCode(state));
  if (!identity) {
    return sendError(res, 410, 'SSO_CODE_EXPIRED_OR_USED', 'SSO code has expired or was already used.');
  }
  await recordAdminSsoEvent(req, {
    eventType: 'exchange', issuer: 'eatspay-admin', audience,
    loginId: identity.loginId, result: 'success'
  });
  return res.status(200).json({ success: true, data: identity });
}));

app.get('/admin/sso/eatsgo', asyncHandler(async (req, res) => {
  const code = String(req.query?.code || '');
  const state = String(req.query?.state || '');
  const cookieState = getCookieValue(req, 'eatspay_admin_sso_state');
  if (!code || !isValidAdminSsoState(state) || !safeAdminSsoSecretEqual(state, cookieState) || !ADMIN_SSO_EATSGO_EXCHANGE_SECRET) {
    clearEatspayAdminSsoStateCookie(res);
    return res.redirect(302, '/admin?sso_error=not_configured');
  }
  try {
    const response = await fetch(`${ADMIN_SSO_EATSGO_BASE_URL}/api/admin/sso/exchange`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ADMIN_SSO_EATSGO_EXCHANGE_SECRET}`
      },
      body: JSON.stringify({ code, state, audience: 'eatspay-admin' }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('SSO_EXCHANGE_FAILED');
    const payload = await response.json();
    const admin = await provisionEatspayAdminFromSso(payload.data || payload);
    const loggedIn = (await repo.markAdminLogin(admin.id)) || admin;
    const accessToken = signToken(loggedIn);
    clearEatspayAdminSsoStateCookie(res);
    res.append('Set-Cookie', buildAuthCookie(req, accessToken));
    await recordAdminSsoEvent(req, {
      eventType: 'login', issuer: 'eatsgo-admin', audience: 'eatspay-admin',
      loginId: admin.loginId || admin.email, result: 'success'
    });
    return res.redirect(302, '/admin');
  } catch (error) {
    clearEatspayAdminSsoStateCookie(res);
    await recordAdminSsoEvent(req, {
      eventType: 'login', issuer: 'eatsgo-admin', audience: 'eatspay-admin',
      result: 'rejected', reason: error.message
    });
    return res.redirect(302, '/admin?sso_error=exchange_failed');
  }
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
  await recordAuditLog(req, {
    action: 'USER_PASSWORD_RESET',
    entityType: 'user',
    entityId: user.id,
    entityName: user.franchiseName || user.name || user.loginId,
    beforeData: { password: 'previous' },
    afterData: { password: 'changed' },
    changedFields: ['password'],
    force: true
  });
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
  const signupAttribution = createSignupAttribution({
    source: agency ? 'agency_link' : 'direct_default',
    agency,
    defaultAgency
  });
  const assignedPg = await resolveSignupPgProvider({
    agencyId: signupAttribution.agencyId,
    joinCode: signupAttribution.signupJoinCode || agencyJoinCode
  });
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
    agencyId: signupAttribution.agencyId,
    signupSource: signupAttribution.signupSource,
    signupAgencyId: signupAttribution.signupAgencyId,
    signupJoinCode: signupAttribution.signupJoinCode,
    pgProviderId: assignedPg.provider?.id || null,
    bizDocFileKey: bizDoc?.fileKey || null,
    franchiseFeeRate: 0
  });
  await recordAuditLog(req, {
    action: 'FRANCHISE_REGISTER',
    entityType: 'franchise',
    entityId: user.franchiseId,
    entityName: user.franchiseName,
    beforeData: {},
    afterData: pickFranchiseAuditData(user),
    force: true
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
      role: user.role,
      pgProviderId: assignedPg.provider?.id || null,
      pgProviderName: assignedPg.provider?.name || '',
      pgAssignmentRuleId: assignedPg.rule?.id || null
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
  const user = req.user.role === 'AGENCY'
    ? await repo.findAgencyAuthById(req.user.id)
    : await repo.findUserById(req.user.id);
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
  const beforeAudit = pickFranchiseAuditData(user);
  const afterAudit = pickFranchiseAuditData(updated);
  if (fields.passwordHash !== undefined) {
    beforeAudit.password = 'previous';
    afterAudit.password = 'changed';
  }
  await recordAuditLog(req, {
    action: 'USER_PROFILE_UPDATE',
    entityType: 'user',
    entityId: user.id,
    entityName: updated.franchiseName || updated.name || updated.loginId,
    beforeData: beforeAudit,
    afterData: afterAudit
  });
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
  const [items, meta] = await Promise.all([
    repo.listInterestFreeInstallments({ onlyActive: true }),
    repo.getInstallmentPolicyMeta()
  ]);
  return res.status(200).json({ success: true, data: items, meta });
}));

function safeWorksheetValue(value) {
  if (value == null) return '';
  return String(value);
}

function stripLeadingPostalCode(value) {
  return safeWorksheetValue(value).replace(/^\s*[\[(]?\d{5}[\])]?\s*/, '').trim();
}

function normalizeAccountNo(value) {
  return String(value || '').replace(/[^0-9A-Za-z]/g, '');
}

function safeWorksheetPercentValue(value) {
  if (value == null || value === '') return '0%';
  const num = Number(value);
  if (!Number.isFinite(num)) return safeWorksheetValue(value);
  return `${String(Number(num.toFixed(2))).replace(/\.0$/, '')}%`;
}

function forceWorksheetTextColumns(worksheet, columnNumbers, startRow = 3, endRow = 300) {
  columnNumbers.forEach(colNumber => {
    const column = worksheet.getColumn(colNumber);
    column.numFmt = '@';
    for (let rowNumber = startRow; rowNumber <= Math.max(endRow, worksheet.rowCount); rowNumber += 1) {
      const cell = worksheet.getRow(rowNumber).getCell(colNumber);
      cell.numFmt = '@';
      cell.alignment = { ...(cell.alignment || {}), horizontal: 'left' };
    }
  });
}

function setWorksheetTextCell(row, colNumber, value) {
  const cell = row.getCell(colNumber);
  cell.value = safeWorksheetValue(value);
  cell.numFmt = '@';
  cell.alignment = { ...(cell.alignment || {}), horizontal: 'left' };
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

function normalizeRouteupBankKey(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function routeupBankCodeByNameMap() {
  const map = new Map();
  [...DEFAULT_FINANCIAL_INSTITUTIONS, ...ROUTEUP_FINANCIAL_INSTITUTIONS].forEach(item => {
    const name = normalizeRouteupBankKey(item.name);
    if (!name || !item.code) return;
    if (!map.has(name)) map.set(name, item.code);
    const withoutBankSuffix = name.replace(/은행$/, '');
    if (withoutBankSuffix && !map.has(withoutBankSuffix)) map.set(withoutBankSuffix, item.code);
  });
  return map;
}

function resolveRouteupBankInfo(item = {}) {
  const rawCode = String(item.bank_code || item.bankCode || item.acct_bank_code || '').replace(/[^0-9]/g, '');
  const institutions = [...DEFAULT_FINANCIAL_INSTITUTIONS, ...ROUTEUP_FINANCIAL_INSTITUTIONS];
  const bankName = safeWorksheetValue(item.bank_name || item.bankName || item.acct_bank_name);
  if (rawCode) {
    const code = rawCode.padStart(3, '0');
    const matched = institutions.find(institution => institution.code === code);
    return { code, name: matched?.name || bankName };
  }
  const nameMap = routeupBankCodeByNameMap();
  const code = nameMap.get(normalizeRouteupBankKey(bankName)) || '';
  const matched = institutions.find(institution => institution.code === code);
  return { code, name: matched?.name || bankName };
}

function routeupMerchantLoginId(item = {}, index = 0) {
  return safeWorksheetValue(
    item.login_id
    || item.loginId
    || item.customer_id
    || item.customerId
    || item.email
    || item.franchise_id
    || item.id
    || `merchant${index + 1}`
  ).trim();
}

function routeupMerchantPassword(item = {}, index = 0) {
  if (ROUTEUP_MERCHANT_DEFAULT_PW) return ROUTEUP_MERCHANT_DEFAULT_PW;
  const digits = `${item.owner_phone || ''}${item.account_no || ''}${item.business_number || ''}`.replace(/[^0-9]/g, '');
  if (digits.length >= 4) return `Ep${digits.slice(-4)}!`;
  const seed = String(item.id || item.franchise_id || index + 1).replace(/[^0-9A-Za-z]/g, '').slice(-6) || String(index + 1);
  return `Ep${seed}!`;
}

function routeupAccountSuffix(item = {}, index = 0) {
  const agency = safeWorksheetValue(item.delivery_agency_name || item.agency_name || '').replace(/\s+/g, '');
  const accountTail = normalizeAccountNo(item.account_no || item.acct_num).slice(-4);
  return agency || accountTail || String(index + 1);
}

const ROUTEUP_MERCHANT_UPLOAD_COLUMNS = [
  { header: '본사 상호(X)', key: 'head_office_name', width: 16 },
  { header: '본사 수수료(X)', key: 'head_office_fee', width: 16 },
  { header: '에이전시 상호(X)', key: 'agency_company_name', width: 18 },
  { header: '에이전시 수수료(X)', key: 'agency_fee', width: 18 },
  { header: '지사 상호(X)', key: 'branch_company_name', width: 16 },
  { header: '지사 수수료(X)', key: 'branch_fee', width: 16 },
  { header: '총판 상호(X)', key: 'distributor_company_name', width: 16 },
  { header: '총판 수수료(X)', key: 'distributor_fee', width: 16 },
  { header: '대리점 상호(X)', key: 'dealer_company_name', width: 16 },
  { header: '대리점 수수료(X)', key: 'dealer_fee', width: 16 },
  { header: '영업자 상호(X)', key: 'salesperson_company_name', width: 16 },
  { header: '영업자 수수료(X)', key: 'salesperson_fee', width: 16 },
  { header: '가맹점 ID(O)', key: 'user_name', width: 18 },
  { header: '가맹점 패스워드(O)', key: 'user_pw', width: 18 },
  { header: '가맹점 수수료(X)', key: 'trx_fee', width: 16 },
  { header: '유보금 수수료(X)', key: 'hold_fee', width: 16 },
  { header: '상호(O)', key: 'mcht_name', width: 22 },
  { header: '가맹점 명(X)', key: 'mcht_sub_name', width: 22 },
  { header: '대표자명(X)', key: 'nick_name', width: 14 },
  { header: '이메일(X)', key: 'email', width: 24 },
  { header: '주소(X)', key: 'addr', width: 34 },
  { header: '휴대폰번호(X)', key: 'phone_num', width: 16 },
  { header: '주민등록번호(X)', key: 'resident_num', width: 18 },
  { header: '사업자등록번호(X)', key: 'business_num', width: 18 },
  { header: '법인등록번호(X)', key: 'corp_registration_num', width: 18 },
  { header: '가맹점 연락처(X)', key: 'mcht_tel', width: 16 },
  { header: 'GMID(X)', key: 'gmid', width: 16 },
  { header: '메모사항(X)', key: 'memo', width: 22 },
  { header: '업종(X)', key: 'sector', width: 14 },
  { header: '구분(X)', key: 'business_type', width: 12 },
  { header: '계좌번호(X)', key: 'acct_num', width: 22 },
  { header: '예금주(X)', key: 'acct_name', width: 14 },
  { header: '은행코드(O)', key: 'acct_bank_code', width: 12 },
  { header: '사업자 유형(X)', key: 'tax_category_type', width: 16 },
  { header: '커스텀 필터(X)', key: 'custom_id', width: 16 },
  { header: '입금자 타입(X)', key: 'deposit_name_type', width: 16 },
  { header: '출금 수수료(X)', key: 'withdraw_fee', width: 14 }
];

const ROUTEUP_MERCHANT_TEXT_KEYS = new Set([
  'user_name',
  'user_pw',
  'phone_num',
  'resident_num',
  'business_num',
  'corp_registration_num',
  'mcht_tel',
  'gmid',
  'acct_num',
  'acct_name',
  'acct_bank_code',
  'memo'
]);

function buildRouteupMerchantPayloadRows(rows = []) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const loginCounts = new Map();
  const merchantCounts = new Map();
  sourceRows.forEach((item, index) => {
    const loginId = routeupMerchantLoginId(item, index);
    const franchiseName = safeWorksheetValue(item.franchise_name || item.mcht_name).trim();
    loginCounts.set(loginId, (loginCounts.get(loginId) || 0) + 1);
    merchantCounts.set(franchiseName, (merchantCounts.get(franchiseName) || 0) + 1);
  });
  return sourceRows.map((item, index) => {
    const bank = resolveRouteupBankInfo(item);
    const businessNumber = String(item.business_number || item.businessNumber || '').replace(/[^0-9]/g, '');
    const phoneNumber = String(item.owner_phone || item.phone_num || item.phone || '').replace(/[^0-9]/g, '');
    const baseFranchiseName = safeWorksheetValue(item.franchise_name || item.mcht_name).trim();
    const baseLoginId = routeupMerchantLoginId(item, index);
    const suffix = routeupAccountSuffix(item, index);
    const franchiseName = merchantCounts.get(baseFranchiseName) > 1 ? `${baseFranchiseName}_${suffix}`.slice(0, 80) : baseFranchiseName;
    const userName = loginCounts.get(baseLoginId) > 1 ? `${baseLoginId}_${normalizeAccountNo(suffix) || index + 1}`.slice(0, 80) : baseLoginId;
    const accountHolder = safeWorksheetValue(item.account_holder || item.acct_name || item.owner_name).trim();
    return {
      head_office_name: '',
      head_office_fee: '',
      agency_company_name: '',
      agency_fee: '',
      branch_company_name: '',
      branch_fee: '',
      distributor_company_name: '',
      distributor_fee: '',
      dealer_company_name: '',
      dealer_fee: '',
      salesperson_company_name: '',
      salesperson_fee: '',
      user_name: userName,
      user_pw: routeupMerchantPassword(item, index),
      trx_fee: 4.4,
      hold_fee: 0,
      mcht_name: franchiseName,
      mcht_sub_name: franchiseName,
      nick_name: safeWorksheetValue(item.owner_name || accountHolder),
      email: safeWorksheetValue(item.email),
      addr: stripLeadingPostalCode(item.franchise_address || item.address),
      phone_num: phoneNumber,
      resident_num: '',
      business_num: businessNumber,
      corp_registration_num: '',
      mcht_tel: phoneNumber,
      gmid: '',
      memo: '',
      sector: '',
      business_type: '',
      acct_num: normalizeAccountNo(item.account_no || item.acct_num),
      acct_name: accountHolder,
      acct_bank_code: bank.code,
      acct_bank_name: bank.name,
      tax_category_type: '',
      custom_id: '',
      deposit_name_type: '',
      withdraw_fee: 0,
    };
  });
}

function validateRouteupMerchantPayload(rows = []) {
  const errors = [];
  const seenUserNames = new Set();
  const seenMerchantNames = new Set();
  rows.forEach((row, index) => {
    const rowNo = index + 1;
    const userName = String(row.user_name || '').trim();
    const merchantName = String(row.mcht_name || '').trim();
    if (!userName) errors.push(`${rowNo}번째 행: 가맹점 ID가 없습니다.`);
    if (!merchantName) errors.push(`${rowNo}번째 행: 상호가 없습니다.`);
    if (!String(row.user_pw || '').trim()) errors.push(`${rowNo}번째 행: 가맹점 패스워드가 없습니다.`);
    if (!String(row.acct_bank_code || '').trim()) errors.push(`${rowNo}번째 행: 은행코드를 찾지 못했습니다.`);
    if (userName) {
      if (seenUserNames.has(userName)) errors.push(`${rowNo}번째 행: 가맹점 ID가 중복됩니다. (${userName})`);
      seenUserNames.add(userName);
    }
    if (merchantName) {
      if (seenMerchantNames.has(merchantName)) errors.push(`${rowNo}번째 행: 상호가 중복됩니다. (${merchantName})`);
      seenMerchantNames.add(merchantName);
    }
  });
  return errors;
}

function createRouteupAccountApprovalExportWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('가맹점 대량등록 포멧');
  worksheet.columns = ROUTEUP_MERCHANT_UPLOAD_COLUMNS;
  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FF12351F' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF8EF' } };
  header.alignment = { horizontal: 'center', vertical: 'middle' };
  header.eachCell(cell => {
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD1E8D1' } } };
  });
  buildRouteupMerchantPayloadRows(rows).forEach((item, index) => {
    const row = worksheet.addRow(item);
    ROUTEUP_MERCHANT_UPLOAD_COLUMNS.forEach((column, columnIndex) => {
      if (!ROUTEUP_MERCHANT_TEXT_KEYS.has(column.key)) return;
      const cell = row.getCell(columnIndex + 1);
      cell.numFmt = '@';
      cell.value = String(cell.value || '');
    });
  });
  return workbook.xlsx.writeBuffer();
}

async function createAccountApprovalExportWorkbook(rows, options = {}) {
  if (String(options.format || '').toLowerCase() === 'routeup') {
    return createRouteupAccountApprovalExportWorkbook(rows);
  }
  const workbook = new ExcelJS.Workbook();
  let loadedTemplate = false;
  if (fs.existsSync(ACCOUNT_EXPORT_TEMPLATE_PATH)) {
    await workbook.xlsx.readFile(ACCOUNT_EXPORT_TEMPLATE_PATH);
    loadedTemplate = true;
  } else {
    const fallback = workbook.addWorksheet('에이빅스');
    fallback.getRow(2).values = ['No', '등록일자', '상호명', '대표자명', '사업자번호', '가맹점 주소', '대표자 연락처', '은행명', '계좌번호', '예금주명', '가맹점 수수료(vat포함)', '상세 취급품목', '이메일 주소'];
  }
  const worksheet = workbook.getWorksheet('에이빅스') || workbook.getWorksheet('등록 양식') || workbook.worksheets[0];
  worksheet.name = '에이빅스';
  const headerRow = worksheet.getRow(2);
  headerRow.values = ['No', '등록일자', '상호명', '대표자명', '사업자번호', '가맹점 주소', '대표자 연락처', '은행명', '계좌번호', '예금주명', '가맹점 수수료(vat포함)', '상세 취급품목', '이메일 주소'];
  forceWorksheetTextColumns(worksheet, [5, 7, 9], 3, Math.max(300, rows.length + 20));
  const styleRow = worksheet.getRow(3);
  rows.forEach((item, index) => {
    const row = worksheet.getRow(3 + index);
    copyRowStyle(styleRow, row);
    row.getCell(1).value = index + 1;
    row.getCell(2).value = item.approved_at ? new Date(item.approved_at) : null;
    row.getCell(3).value = safeWorksheetValue(item.franchise_name);
    row.getCell(4).value = safeWorksheetValue(item.owner_name || item.account_holder);
    setWorksheetTextCell(row, 5, item.business_number);
    row.getCell(6).value = stripLeadingPostalCode(item.franchise_address);
    setWorksheetTextCell(row, 7, item.owner_phone);
    row.getCell(8).value = safeWorksheetValue(item.bank_name);
    setWorksheetTextCell(row, 9, item.account_no);
    row.getCell(10).value = safeWorksheetValue(item.account_holder);
    row.getCell(11).value = 0.044;
    row.getCell(11).numFmt = '0.0%';
    row.getCell(12).value = '';
    row.getCell(13).value = '';
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
  const worksheet = workbook.getWorksheet('에이빅스') || workbook.getWorksheet('등록 양식') || workbook.worksheets[0];
  if (!worksheet) return [];
  const headerRow = worksheet.getRow(2);
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
  const manualTidCol = col('수기 TID', '수기TID', 'manual TID', 'manualTid');
  const manualKeyCol = col('수기 Key', '수기Key', 'manual Key', 'manualKey');
  const recurringTidCol = col('정기 TID', '정기TID', 'recurring TID', 'recurringTid');
  const recurringKeyCol = col('정기 Key', '정기Key', 'recurring Key', 'recurringKey');
  const routeupMidCol = col('MID', '위루트 MID', 'routeup MID');
  const routeupTidCol = col('TID', '위루트 TID', 'routeup TID');
  const routeupPaymentKeyCol = col('결제 KEY', '결제KEY', '결제키', 'payment KEY', 'paymentKey', 'payKey');
  const routeupSignatureKeyCol = col('서명 KEY', '서명KEY', '서명키', 'signature KEY', 'signatureKey', 'signKey');
  const routeupStartCol = col('계약 시작일', '계약시작일', 'contractStartDate', 'startDate');
  const routeupEndCol = col('계약 종료일', '계약종료일', 'contractEndDate', 'endDate');
  const routeupDeviceCol = col('장비타입', '장비 타입', '모듈타입', '모듈 타입', 'deviceType', 'terminalType', 'moduleType');
  const routeupSerialCol = col('시리얼번호', '시리얼 번호', 'serialNo', 'serialNumber');
  const routeupMerchantIdCol = col('가맹점 ID', '가맹점ID', 'merchantId', 'userName', 'loginId');
  const accountCol = col('계좌번호');
  const businessCol = col('사업자번호', '사업자등록번호', '사업자 등록번호');
  const franchiseCol = col('상호명', '상호', '가맹점명', '상점명');
  const hasGhColumns = recurringTidCol || manualTidCol;
  const hasRouteupColumns = routeupTidCol || routeupPaymentKeyCol || routeupSignatureKeyCol;
  if (!hasGhColumns && !hasRouteupColumns) return [];
  const items = [];
  for (let rowNo = 3; rowNo <= worksheet.rowCount; rowNo += 1) {
    const row = worksheet.getRow(rowNo);
    const manualTid = manualTidCol ? String(row.getCell(manualTidCol).text || row.getCell(manualTidCol).value || '').trim() : '';
    const manualKey = manualKeyCol ? String(row.getCell(manualKeyCol).text || row.getCell(manualKeyCol).value || '').trim() : '';
    const recurringTid = recurringTidCol ? String(row.getCell(recurringTidCol).text || row.getCell(recurringTidCol).value || '').trim() : '';
    const recurringKey = recurringKeyCol ? String(row.getCell(recurringKeyCol).text || row.getCell(recurringKeyCol).value || '').trim() : '';
    const routeupMid = routeupMidCol ? String(row.getCell(routeupMidCol).text || row.getCell(routeupMidCol).value || '').trim() : '';
    const routeupTid = routeupTidCol ? String(row.getCell(routeupTidCol).text || row.getCell(routeupTidCol).value || '').trim() : '';
    const routeupPaymentKey = routeupPaymentKeyCol ? String(row.getCell(routeupPaymentKeyCol).text || row.getCell(routeupPaymentKeyCol).value || '').trim() : '';
    const routeupSignatureKey = routeupSignatureKeyCol ? String(row.getCell(routeupSignatureKeyCol).text || row.getCell(routeupSignatureKeyCol).value || '').trim() : '';
    const routeupStartDate = routeupStartCol ? String(row.getCell(routeupStartCol).text || row.getCell(routeupStartCol).value || '').trim() : '';
    const routeupEndDate = routeupEndCol ? String(row.getCell(routeupEndCol).text || row.getCell(routeupEndCol).value || '').trim() : '';
    const routeupDeviceType = routeupDeviceCol ? String(row.getCell(routeupDeviceCol).text || row.getCell(routeupDeviceCol).value || '').trim() : '';
    const routeupSerialNo = routeupSerialCol ? String(row.getCell(routeupSerialCol).text || row.getCell(routeupSerialCol).value || '').trim() : '';
    const routeupMerchantId = routeupMerchantIdCol ? String(row.getCell(routeupMerchantIdCol).text || row.getCell(routeupMerchantIdCol).value || '').trim() : '';
    const accountNo = accountCol ? String(row.getCell(accountCol).text || row.getCell(accountCol).value || '').trim() : '';
    if (!manualTid && !manualKey && !recurringTid && !recurringKey && !routeupTid && !routeupPaymentKey && !routeupSignatureKey && !accountNo) continue;
    const routeupContract = (routeupTid || routeupPaymentKey || routeupSignatureKey)
      ? buildRouteupPaymentContract({
        mid: routeupMid,
        tid: routeupTid,
        paymentKey: routeupPaymentKey,
        signatureKey: routeupSignatureKey,
        contractStartDate: routeupStartDate,
        contractEndDate: routeupEndDate,
        deviceType: routeupDeviceType,
        metadata: {
          routeupSerialNo,
          routeupMerchantId
        }
      })
      : null;
    items.push({
      txid: recurringTid || manualTid || routeupTid,
      manualTid,
      manualKey,
      recurringTid,
      recurringKey,
      routeupContract,
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
  const format = ['routeup', 'gh', 'default'].includes(String(query.format || '').toLowerCase())
    ? String(query.format).toLowerCase()
    : '';
  const pgProvider = avicxNormalizeProvider(query.pgProvider || query.provider || (format === 'routeup' ? '위루트' : format === 'gh' ? 'GH Payments' : ''));
  return {
    exportStatus,
    startDate: cleanDate(query.startDate),
    endDate: cleanDate(query.endDate),
    q: String(query.q || '').trim().slice(0, 80),
    agency: String(query.agency || '').trim().slice(0, 80),
    format,
    pgProvider
  };
}

app.get('/api/admin/account-approvals/export-count', authenticateAdmin, asyncHandler(async (req, res) => {
  const filters = parseAccountApprovalExportFilters(req.query || {});
  const count = await repo.countAccountApprovalExportRows(filters);
  return res.status(200).json({ success: true, data: { count, filters } });
}));

async function createAccountApprovalExportBuffer(req) {
  const filters = parseAccountApprovalExportFilters(req.query || {});
  const rows = await repo.listAccountApprovalExportRows(filters);
  if (!rows.length) {
    const err = new Error('내보낼 승인 계좌가 없습니다.');
    err.statusCode = 404;
    err.code = 'NO_EXPORT_ROWS';
    throw err;
  }
  const batchId = generateId('ACCEXP', 6);
  const buffer = await createAccountApprovalExportWorkbook(rows, { format: filters.format });
  await repo.markAccountApprovalsExported(rows, batchId);
  return { buffer: Buffer.from(buffer), batchId, count: rows.length };
}

async function verifyRouteupBankAccounts(payloadRows = []) {
  const verifiableRows = payloadRows.filter(row => (
    String(row.acct_num || '').trim()
    && String(row.acct_name || '').trim()
    && String(row.acct_bank_code || '').trim()
  ));
  for (let start = 0; start < verifiableRows.length; start += 5) {
    const chunk = verifiableRows.slice(start, start + 5).map(row => ({
      acct_num: row.acct_num,
      acct_name: row.acct_name,
      acct_bank_code: row.acct_bank_code,
      acct_bank_name: row.acct_bank_name
    }));
    await routeupManagerRequest('bank-accounts/batch-updaters/register', {
      method: 'POST',
      body: chunk
    });
  }
}

async function handleRouteupAccountApprovalUpload(req, res) {
  try {
    const filters = parseAccountApprovalExportFilters({
      ...(req.query || {}),
      exportStatus: 'pending',
      format: 'routeup',
      pgProvider: '위루트'
    });
    const rows = await repo.listAccountApprovalExportRows(filters);
    if (!rows.length) {
      return sendError(res, 404, 'NO_ROUTEUP_UPLOAD_ROWS', '위루트에 업로드할 승인 계좌가 없습니다.');
    }
    if (rows.length > 1000) {
      return sendError(res, 400, 'ROUTEUP_UPLOAD_LIMIT_EXCEEDED', '위루트 대량등록은 한 번에 1000건 이하만 처리할 수 있습니다.');
    }
    const payloadRows = buildRouteupMerchantPayloadRows(rows);
    const validationErrors = validateRouteupMerchantPayload(payloadRows);
    if (validationErrors.length) {
      return sendError(
        res,
        400,
        'ROUTEUP_UPLOAD_VALIDATION_FAILED',
        '위루트 업로드에 필요한 정보가 부족합니다.',
        validationErrors.slice(0, 30)
      );
    }
    const verifyBankAccount = req.body?.verifyBankAccount !== false;
    if (verifyBankAccount) await verifyRouteupBankAccounts(payloadRows);
    const upstream = await routeupManagerRequest('merchandises/batch-updaters/register', {
      method: 'POST',
      body: payloadRows
    });
    const batchId = generateId('RTUP', 6);
    await repo.markAccountApprovalsExported(rows, batchId);
    await recordAuditLog(req, {
      action: 'ROUTEUP_ACCOUNT_APPROVAL_UPLOAD',
      entityType: 'account_approval_batch',
      entityId: batchId,
      entityName: '위루트 계좌검증 업로드',
      beforeData: {},
      afterData: {
        batchId,
        count: rows.length,
        verifyBankAccount,
        franchises: rows.map(row => ({
          source: row.source,
          id: row.id,
          franchiseName: row.franchise_name,
          accountNo: row.account_no,
          bankName: row.bank_name,
          loginId: row.login_id
        }))
      },
      force: true
    });
    return res.status(200).json({
      success: true,
      data: {
        batchId,
        count: rows.length,
        verifyBankAccount,
        routeup: upstream.data || upstream.text || null
      }
    });
  } catch (err) {
    if (String(err?.code || '').startsWith('ROUTEUP_')) {
      return sendError(res, err.statusCode || 502, err.code, err.message || '위루트 업로드에 실패했습니다.', err.details || []);
    }
    throw err;
  }
}

async function sendAccountApprovalExportWorkbook(req, res) {
  try {
    const result = await createAccountApprovalExportBuffer(req);
    const filters = parseAccountApprovalExportFilters(req.query || {});
    const prefix = filters.format === 'routeup' ? 'routeup' : 'eatsPay';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${prefix}_${result.batchId}.xlsx"`);
    res.setHeader('X-Export-Count', String(result.count));
    res.setHeader('X-Export-Batch-Id', result.batchId);
    return res.status(200).send(result.buffer);
  } catch (err) {
    if (err?.code === 'NO_EXPORT_ROWS') return sendError(res, 404, 'NO_EXPORT_ROWS', err.message);
    throw err;
  }
}

const KAKAO_TID_LATEST_UPLOAD_TOKEN_PATH = path.join(uploadDir, 'kakao-tid-latest-upload-token.json');

function saveLatestKakaoTidUploadToken(batchId, token) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(KAKAO_TID_LATEST_UPLOAD_TOKEN_PATH, JSON.stringify({
      batchId: String(batchId || ''),
      token: String(token || ''),
      issuedAt: new Date().toISOString()
    }, null, 2));
  } catch (err) {
    console.error('[KAKAO_TID_UPLOAD_TOKEN_SAVE_FAILED]', err?.message || err);
  }
}

function isLatestKakaoTidUploadToken(batchId, token) {
  try {
    if (!fs.existsSync(KAKAO_TID_LATEST_UPLOAD_TOKEN_PATH)) return false;
    const latest = JSON.parse(fs.readFileSync(KAKAO_TID_LATEST_UPLOAD_TOKEN_PATH, 'utf8'));
    return String(latest?.batchId || '') === String(batchId || '') && String(latest?.token || '') === String(token || '');
  } catch (err) {
    console.error('[KAKAO_TID_UPLOAD_TOKEN_READ_FAILED]', err?.message || err);
    return false;
  }
}

function createKakaoTxidUploadToken(batchId) {
  const secret = String(process.env.KAKAO_TXID_TOKEN || process.env.JWT_SECRET || '').trim();
  const payload = {
    batchId: String(batchId || ''),
    exp: Date.now() + (14 * 24 * 60 * 60 * 1000)
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyKakaoTxidUploadToken(token) {
  const secret = String(process.env.KAKAO_TXID_TOKEN || process.env.JWT_SECRET || '').trim();
  const rawToken = String(token || '');
  const [body, sig] = rawToken.split('.');
  if (!secret || !body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const sigBuffer = Buffer.from(sig);
  if (expectedBuffer.length !== sigBuffer.length || !crypto.timingSafeEqual(expectedBuffer, sigBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.batchId || Number(payload.exp || 0) < Date.now()) return null;
    if (!isLatestKakaoTidUploadToken(payload.batchId, rawToken)) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

function renderKakaoTxidUploadPage(token, message = '') {
  const safeToken = htmlAttr(token);
  const note = message ? '<div class="note" id="result-note">' + htmlAttr(message) + '</div>' : '<div class="note hidden" id="result-note"></div>';
  return [
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>이츠페이 TID 업로드</title>',
    '<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f7f5;color:#172217;margin:0;padding:28px}.box{max-width:520px;margin:0 auto;background:#fff;border:1px solid #d8e5d8;border-radius:10px;padding:22px;box-shadow:0 8px 28px rgba(20,50,20,.08)}.brand{display:flex;align-items:center;gap:12px;margin-bottom:12px}.brand-logo{width:auto;height:42px;display:block}h1{font-size:20px;margin:0}.sub{color:#516151;font-size:14px;line-height:1.5;margin-bottom:18px}.file{display:block;width:100%;box-sizing:border-box;border:1px solid #cbd8cb;border-radius:8px;padding:12px;background:#fbfdfb}.btn{width:100%;margin-top:14px;border:0;border-radius:8px;background:#2f8f3b;color:white;font-weight:700;font-size:16px;padding:13px}.btn:disabled{background:#8ab98f;cursor:wait}.note{margin:12px 0;padding:10px;border-radius:8px;background:#eef8ee;color:#1d5d29;font-size:14px}.note.err{background:#fff1f1;color:#9d1c1c}.hidden{display:none}.progress-wrap{margin:14px 0 2px}.progress-meta{display:flex;justify-content:space-between;gap:10px;margin-bottom:7px;font-size:13px;color:#516151}.track{height:12px;background:#e6eee6;border-radius:999px;overflow:hidden;border:1px solid #d1dfd1}.bar{width:0%;height:100%;background:#2f8f3b;transition:width .18s ease}.status{font-weight:700;color:#244d29}</style>',
    '</head><body><main class="box"><div class="brand"><img class="brand-logo" src="/logo.png" alt="이츠페이"><h1>이츠페이 TID 엑셀 업로드</h1></div>',
    '<p class="sub">수정한 엑셀 파일(.xlsx/.xls)을 선택한 뒤 업로드하세요. 완료되면 서버에 바로 반영됩니다.</p>',
    note,
    '<form id="upload-form" method="post" action="/tid-upload/' + safeToken + '" enctype="multipart/form-data">',
    '<input class="file" type="file" name="file" accept=".xlsx,.xls" required>',
    '<div class="progress-wrap hidden" id="progress-wrap"><div class="progress-meta"><span class="status" id="progress-status">업로드 준비</span><span id="progress-percent">0%</span></div><div class="track"><div class="bar" id="progress-bar"></div></div></div>',
    '<button class="btn" id="submit-btn" type="submit">서버에 반영</button></form>',
    '<script>(function(){var form=document.getElementById("upload-form"),bar=document.getElementById("progress-bar"),pct=document.getElementById("progress-percent"),status=document.getElementById("progress-status"),wrap=document.getElementById("progress-wrap"),btn=document.getElementById("submit-btn"),note=document.getElementById("result-note");function setProgress(n,t){wrap.classList.remove("hidden");bar.style.width=n+"%";pct.textContent=n+"%";if(t)status.textContent=t}form.addEventListener("submit",function(e){e.preventDefault();if(!form.file.files.length)return;note.className="note hidden";note.textContent="";btn.disabled=true;btn.textContent="업로드 중";setProgress(0,"업로드 시작");var xhr=new XMLHttpRequest();xhr.open("POST",form.action,true);xhr.upload.onprogress=function(ev){if(ev.lengthComputable){var n=Math.max(1,Math.min(95,Math.round(ev.loaded/ev.total*100)));setProgress(n,"파일 전송 중")}};xhr.onload=function(){setProgress(100,xhr.status>=200&&xhr.status<300?"반영 완료":"처리 실패");btn.disabled=false;btn.textContent="서버에 반영";if(xhr.status>=200&&xhr.status<300){document.open();document.write(xhr.responseText);document.close()}else{note.className="note err";note.textContent="업로드 실패: 서버 응답 " + xhr.status}};xhr.onerror=function(){btn.disabled=false;btn.textContent="서버에 반영";note.className="note err";note.textContent="업로드 실패: 네트워크 연결을 확인하세요";setProgress(0,"전송 실패")};xhr.upload.onload=function(){setProgress(98,"서버 반영 처리 중")};xhr.send(new FormData(form))})})();</script>',
    '</main></body></html>'
  ].join('');
}

async function createKakaoAccountApprovalExportLink(req, res) {
  try {
    const result = await createAccountApprovalExportBuffer(req);
    const dir = path.join(uploadDir, 'kakao-tid-exports');
    fs.mkdirSync(dir, { recursive: true });
    const fileName = 'eatsPay_' + result.batchId + '.xlsx';
    fs.writeFileSync(path.join(dir, fileName), result.buffer);
    const publicPath = '/uploads/kakao-tid-exports/' + encodeURIComponent(fileName);
    const baseUrl = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://eatspay.kr').replace(/\/$/, '');
    const uploadToken = createKakaoTxidUploadToken(result.batchId);
    saveLatestKakaoTidUploadToken(result.batchId, uploadToken);
    const uploadPath = '/tid-upload/' + encodeURIComponent(uploadToken);
    return res.status(200).json({
      success: true,
      data: {
        fileName,
        batchId: result.batchId,
        count: result.count,
        path: publicPath,
        url: baseUrl + publicPath,
        uploadPath,
        uploadUrl: baseUrl + uploadPath
      }
    });
  } catch (err) {
    if (err?.code === 'NO_EXPORT_ROWS') return sendError(res, 404, 'NO_EXPORT_ROWS', err.message);
    throw err;
  }
}

app.get('/api/admin/account-approvals/export.xlsx', authenticateAdmin, asyncHandler(sendAccountApprovalExportWorkbook));
app.post('/api/admin/account-approvals/routeup-upload', authenticateAdmin, requireSuperAdmin, asyncHandler(handleRouteupAccountApprovalUpload));

app.post('/api/internal/kakao/account-approvals/export-link', authenticateKakaoTxid, asyncHandler(createKakaoAccountApprovalExportLink));


const KAKAO_TID_UPLOAD_EVENTS_PATH = path.join(uploadDir, 'kakao-tid-upload-events.json');

function readKakaoTidUploadEvents() {
  try {
    if (!fs.existsSync(KAKAO_TID_UPLOAD_EVENTS_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(KAKAO_TID_UPLOAD_EVENTS_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[KAKAO_TID_EVENTS_READ_FAILED]', err?.message || err);
    return [];
  }
}

function appendKakaoTidUploadEvent({ batchId = '', fileName = '', resultBody = {} } = {}) {
  const data = resultBody?.data || {};
  const results = Array.isArray(data.results) ? data.results : [];
  const targets = results.slice(0, 30).map(item => ({
    status: item.status || '',
    franchiseName: item.franchiseName || '',
    accountNo: item.accountNo || '',
    manualTid: item.manualTid || '',
    recurringTid: item.recurringTid || '',
    affected: item.affected || []
  }));
  const event = {
    id: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    createdAt: new Date().toISOString(),
    batchId,
    fileName,
    total: Number(data.total || 0),
    updated: Number(data.updated || 0),
    skipped: Number(data.skipped || 0),
    invalidTid: Number(data.invalidTxid || 0),
    notFound: Number(data.notFound || 0),
    ambiguous: Number(data.ambiguous || 0),
    targets
  };
  try {
    const events = readKakaoTidUploadEvents();
    events.push(event);
    fs.mkdirSync(path.dirname(KAKAO_TID_UPLOAD_EVENTS_PATH), { recursive: true });
    fs.writeFileSync(KAKAO_TID_UPLOAD_EVENTS_PATH, JSON.stringify(events.slice(-200), null, 2));
    return event;
  } catch (err) {
    console.warn('[KAKAO_TID_EVENT_WRITE_FAILED]', err?.message || err);
    return null;
  }
}

async function handleAccountApprovalTxidUpload(req, res) {
  if (!req.file) {
    return sendError(res, 400, 'FILE_REQUIRED', 'TID/Key 엑셀 파일을 업로드해주세요.');
  }
  const uploadFileName = normalizeUploadOriginalName(req.file.originalname || '');
  req.file.originalname = uploadFileName;
  const items = await parseAccountApprovalTxidWorkbook(req.file.buffer);
  if (!items.length) {
    return sendError(res, 400, 'NO_TID_ROWS', 'TID/Key를 반영할 행을 찾지 못했습니다.');
  }
  const batchIdMatch = uploadFileName.match(/(?:eatsPay_|account-approvals-|계좌검증_내보내기_)?(ACCEXP-[A-Za-z0-9]+)/i);
  const results = await repo.applyAccountApprovalTxids(items, {
    batchId: batchIdMatch ? batchIdMatch[1] : ''
  });
  await notifyAccountApprovalTxidApplied(results);
  const updated = results.filter(item => item.status === 'UPDATED').length;
  await recordAuditLog(req, {
    action: 'ACCOUNT_TXID_UPLOAD',
    entityType: 'account_approval_batch',
    entityId: batchIdMatch ? batchIdMatch[1] : uploadFileName,
    entityName: uploadFileName,
    beforeData: {},
    afterData: {
      fileName: uploadFileName,
      batchId: batchIdMatch ? batchIdMatch[1] : '',
      total: results.length,
      updated,
      updatedTargets: results
        .filter(item => item.status === 'UPDATED')
        .map(item => ({
          manualTid: item.manualTid,
          recurringTid: item.recurringTid,
          accountNo: item.accountNo,
          franchiseName: item.franchiseName,
          affected: item.affected || []
        }))
    },
    force: true
  });
  return res.status(200).json({
    success: true,
    data: {
      total: results.length,
      updated,
      skipped: results.filter(item => item.status === 'SKIPPED').length,
      invalidTxid: results.filter(item => item.status === 'INVALID_TXID').length,
      invalidRouteupContract: results.filter(item => item.status === 'INVALID_ROUTEUP_CONTRACT').length,
      notFound: results.filter(item => item.status === 'NOT_FOUND').length,
      ambiguous: results.filter(item => item.status === 'AMBIGUOUS').length,
      results
    }
  });
}

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
  return handleAccountApprovalTxidUpload(req, res);
}));

app.post('/api/internal/kakao/account-approvals/txid-upload', authenticateKakaoTxid, singleUpload('file'), asyncHandler(async (req, res) => {
  return handleAccountApprovalTxidUpload(req, res);
}));


app.get('/api/internal/kakao/account-approvals/tid-upload-events', authenticateKakaoTxid, (req, res) => {
  const since = String(req.query?.since || '').trim();
  const events = readKakaoTidUploadEvents();
  const start = since ? events.findIndex(event => event.id === since) : -1;
  const items = start >= 0 ? events.slice(start + 1) : events.slice(-20);
  return res.status(200).json({ success: true, data: { events: items } });
});

function kakaoNotiWon(value) {
  const num = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? `${Math.round(num).toLocaleString('ko-KR')}원` : '-';
}

function kakaoNotiText(value, fallback = '-') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function kakaoPgPayloadValue(payload = {}, ...keys) {
  for (const key of keys) {
    const value = payload?.[key]
      ?? payload?.routeupParsed?.[key]
      ?? payload?.pay?.[key]
      ?? payload?.result?.[key]
      ?? payload?.billing?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function formatKakaoPgNotificationEvent(row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const query = row.query && typeof row.query === 'object' ? row.query : {};
  const transferResult = kakaoNotiText(query.transResult, '');
  if (row.provider === 'GH Payments' && transferResult.includes('성공')) {
    return [
      '☑ 이츠페이 입금 이체 성공',
      '',
      `업체: ${kakaoNotiText(query.compNm)}`,
      `예금주: ${kakaoNotiText(query.acctNm)}`,
      `은행: ${kakaoNotiText(query.bankNm)}`,
      `입금계좌: ${kakaoNotiText(query.acctNo)}`,
      `입금금액: ${kakaoNotiWon(query.transAmt)}`,
      '',
      `입금코드: ${kakaoNotiText(query.transSeq)}`,
      `입금일시: ${kakaoNotiText(query.transReqDttm || formatKstDateTime(row.received_at))}`,
      `PG: ${kakaoNotiText(row.provider)}`
    ].join('\n');
  }
  const transactionId = kakaoNotiText(
    row.transaction_id || row.approval_no || kakaoPgPayloadValue(payload, 'trackId', 'odrno', 'ord_num', 'orderNo', 'transactionId'),
    ''
  );
  const pgTxId = kakaoNotiText(
    row.pg_transaction_id || row.pg_tx_id || kakaoPgPayloadValue(payload, 'trxId', 'tradeno', 'tid', 'trx_id', 'pgTransactionId'),
    ''
  );
  const franchiseName = kakaoNotiText(row.franchise_name || kakaoPgPayloadValue(payload, 'mc_nm', 'mchtName', 'compNm'), '');
  const paymentAmount = row.payment_amt ?? kakaoPgPayloadValue(payload, 'amount', 'amt');
  const netAmount = row.net_amt ?? kakaoPgPayloadValue(payload, 'adj_amt', 'transAmt');
  const authCode = row.auth_code || kakaoPgPayloadValue(payload, 'authCd', 'authno', 'appr_num', 'approvalNo');
  const hasUsefulPayload = transactionId || pgTxId || franchiseName || Number.isFinite(Number(paymentAmount)) || Number.isFinite(Number(netAmount));
  if (!hasUsefulPayload) return null;

  const title = row.event_type === 'CH_PAYWAY_FALLBACK_SETTLED'
    ? '☑ 이츠페이 정산 확인'
    : '☑ 이츠페이 PG 노티 수신';
  return [
    title,
    '',
    `업체: ${franchiseName || '-'}`,
    `결제금액: ${kakaoNotiWon(paymentAmount)}`,
    `정산금액: ${kakaoNotiWon(netAmount)}`,
    `승인번호: ${kakaoNotiText(authCode)}`,
    `입금코드: ${kakaoNotiText(pgTxId)}`,
    `결제코드: ${kakaoNotiText(transactionId)}`,
    `PG: ${kakaoNotiText(row.provider)}`,
    `노티: ${kakaoNotiText(row.event_type)}`,
    `수신시각: ${formatKstDateTime(row.received_at)}`
  ].join('\n');
}

function formatKakaoDepositNotificationEvent(row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const franchiseName = kakaoNotiText(payload.compNm || payload.companyName || payload.franchiseName, '');
  const resultMessage = kakaoNotiText(row.result_message || payload.transResult || payload.message, '');
  return [
    `☑ 이츠페이 입금 ${resultMessage || '알림'}`,
    '',
    `업체: ${franchiseName || '-'}`,
    `예금주: ${kakaoNotiText(row.depositor_name || payload.acctNm)}`,
    `은행: ${kakaoNotiText(row.bank_name || payload.bankNm)}`,
    `입금계좌: ${kakaoNotiText(row.account_no || payload.acctNo)}`,
    `입금금액: ${kakaoNotiWon(row.amount || payload.transAmt)}`,
    '',
    `입금코드: ${kakaoNotiText(row.txid || payload.transSeq)}`,
    `입금일시: ${formatKstDateTime(row.received_at)}`,
    `PG: ${kakaoNotiText(row.provider)}`,
    `노티: ${kakaoNotiText(row.event_type)}`
  ].join('\n');
}

app.get('/api/internal/kakao/notification-events', authenticateKakaoTxid, asyncHandler(async (req, res) => {
  const sincePg = Math.max(0, Number(req.query?.sincePg || 0) || 0);
  const sinceDeposit = Math.max(0, Number(req.query?.sinceDeposit || 0) || 0);
  const limit = Math.min(Math.max(Number(req.query?.limit || 50) || 50, 1), 100);
  const [pgResult, depositResult, maxPgResult, maxDepositResult] = await Promise.all([
    pool.query(
      `SELECT pn.id, pn.provider, pn.event_type, pn.transaction_id, pn.pg_transaction_id,
              pn.result_code, pn.result_message, pn.payload, pn.query, pn.received_at,
              ps.franchise_name, ps.payment_amt, ps.net_amt, ps.approval_no, ps.pg_tx_id,
              t.auth_code
       FROM pg_notifications pn
       LEFT JOIN pg_settlements ps
         ON ps.approval_no = COALESCE(NULLIF(pn.transaction_id, ''), pn.payload->>'odrno', pn.payload->>'trackId')
         OR ps.pg_tx_id = COALESCE(NULLIF(pn.pg_transaction_id, ''), pn.payload->>'tradeno', pn.payload->>'trxId')
       LEFT JOIN transactions t
         ON t.transaction_id = COALESCE(ps.approval_no, NULLIF(pn.transaction_id, ''), pn.payload->>'odrno', pn.payload->>'trackId')
       WHERE pn.id > $1
         AND (
           pn.event_type = 'CH_PAYWAY_FALLBACK_SETTLED'
           OR (
             pn.provider = 'GH Payments'
             AND pn.transaction_id IS NULL
             AND pn.pg_transaction_id IS NULL
             AND pn.query->>'transResult' LIKE '%성공%'
           )
         )
       ORDER BY pn.id ASC
       LIMIT $2`,
      [sincePg, limit]
    ),
    pool.query(
      `SELECT id, provider, event_type, txid, account_no, bank_name,
              depositor_name, amount, result_code, result_message, payload, received_at
       FROM deposit_notifications
       WHERE id > $1
       ORDER BY id ASC
       LIMIT $2`,
      [sinceDeposit, limit]
    ),
    pool.query(
      'SELECT COALESCE(max(id), 0)::int AS max_id FROM pg_notifications'
    ),
    pool.query(
      'SELECT COALESCE(max(id), 0)::int AS max_id FROM deposit_notifications'
    )
  ]);

  const pgEvents = pgResult.rows
    .map(row => ({
      id: row.id,
      kind: 'pg',
      receivedAt: row.received_at,
      provider: row.provider,
      eventType: row.event_type,
      text: formatKakaoPgNotificationEvent(row)
    }))
    .filter(event => event.text);
  const depositEvents = [];

  return res.status(200).json({
    success: true,
    data: {
      maxPgId: Number(maxPgResult.rows[0]?.max_id || sincePg),
      maxDepositId: Number(maxDepositResult.rows[0]?.max_id || sinceDeposit),
      events: [...pgEvents, ...depositEvents]
        .sort((a, b) => new Date(a.receivedAt || 0) - new Date(b.receivedAt || 0))
        .slice(-limit)
    }
  });
}));

app.get('/tid-upload/:token', (req, res) => {
  const payload = verifyKakaoTxidUploadToken(req.params.token);
  if (!payload) return res.status(401).send(renderKakaoTxidUploadPage('', '업로드 링크가 만료되었거나 올바르지 않습니다.'));
  return res.status(200).send(renderKakaoTxidUploadPage(req.params.token));
});

app.post('/tid-upload/:token', singleUpload('file'), asyncHandler(async (req, res) => {
  const payload = verifyKakaoTxidUploadToken(req.params.token);
  if (!payload) return res.status(401).send(renderKakaoTxidUploadPage('', '업로드 링크가 만료되었거나 올바르지 않습니다.'));
  req.user = {
    id: null,
    role: 'admin',
    adminLevel: 'SYSTEM',
    loginId: 'kakao-tid-upload-link',
    name: 'Kakao TID Upload Link'
  };
  const uploadFileName = normalizeUploadOriginalName(req.file?.originalname || 'tid-upload.xlsx');
  if (req.file && !uploadFileName.includes(payload.batchId)) {
    req.file.originalname = payload.batchId + '_' + uploadFileName;
  } else if (req.file) {
    req.file.originalname = uploadFileName;
  }
  res.json = body => {
    appendKakaoTidUploadEvent({
      batchId: payload.batchId,
      fileName: req.file?.originalname || '',
      resultBody: body
    });
    const skipped = Number(body?.data?.skipped || 0);
    const message = '업로드 완료: 전체 ' + (body?.data?.total || 0) + '건 중 ' + (body?.data?.updated || 0) + '건 반영' + (skipped ? ', ' + skipped + '건 스킵' : '');
    return res.status(200).send(renderKakaoTxidUploadPage(req.params.token, message));
  };
  return handleAccountApprovalTxidUpload(req, res);
}));


app.get('/txid-upload/:token', (req, res) => {
  return res.redirect(301, '/tid-upload/' + encodeURIComponent(req.params.token));
});

app.post('/txid-upload/:token', singleUpload('file'), asyncHandler(async (req, res) => {
  req.url = '/tid-upload/' + encodeURIComponent(req.params.token);
  return res.redirect(307, '/tid-upload/' + encodeURIComponent(req.params.token));
}));

function maskProviderKey(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= 10) return raw.replace(/.(?=.{4})/g, '*');
  return `${raw.slice(0, 7)}...${raw.slice(-4)}`;
}

function accountTidKeyDisplayFields(account = {}, includeRaw = false) {
  const manualTid = String(account.manualTid || account.manual_tid || '').trim();
  const manualKey = String(account.manualKey || account.manual_key || '').trim();
  const recurringTid = String(account.recurringTid || account.recurring_tid || account.txid || '').trim();
  const recurringKey = String(account.recurringKey || account.recurring_key || '').trim();
  const pgContracts = Array.isArray(account.pgContracts || account.pg_contracts)
    ? (account.pgContracts || account.pg_contracts).map(contract => includeRaw ? contract : maskPgContract(contract))
    : [];
  const fields = {
    manualTid,
    manualKeyMasked: maskProviderKey(manualKey),
    recurringTid,
    recurringKeyMasked: maskProviderKey(recurringKey),
    hasManualKey: Boolean(manualKey),
    hasRecurringKey: Boolean(recurringKey),
    pgContracts
  };
  if (includeRaw) {
    fields.manualKey = manualKey;
    fields.recurringKey = recurringKey;
  }
  return fields;
}

function agencySafeAccountTidKeyFields() {
  return {
    manualTid: '',
    manualKeyMasked: '',
    recurringTid: '',
    recurringKeyMasked: '',
    hasManualKey: false,
    hasRecurringKey: false,
    pgContracts: []
  };
}

function hasAccountTidKey(account = {}) {
  return hasBillablePgContract(account);
}

function hasAccountApprovalCredentials(account = {}) {
  const providerName = normalizeProviderName(account.pgProviderName || account.providerName || account.pg_provider_name || '');
  if (providerName === '위루트') return hasRouteupExternalIntegrationKeys(account);
  return hasAccountTidKey(account) || hasRouteupExternalIntegrationKeys(account);
}

function cardMatchesCurrentPg(card = {}, selectedPgProvider = null) {
  if (!selectedPgProvider?.id) return true;
  return String(card.pgProviderId || card.pg_provider_id || '') === String(selectedPgProvider.id);
}

function accountApprovalStatusIsApproved(account = {}) {
  const status = String(account.status || account.accountStatus || account.account_status || '').trim().toUpperCase();
  const label = String(account.statusLabel || account.accountStatusLabel || '').trim();
  return status === 'APPROVED' || label === '승인완료' || label === '정상승인';
}

function contractMatchesProvider(contract = {}, selectedPgProvider = null) {
  if (!selectedPgProvider) return true;
  const selectedName = String(selectedPgProvider.name || selectedPgProvider.providerName || '').trim();
  const selectedId = String(selectedPgProvider.id || selectedPgProvider.providerId || '').trim();
  const contractProviderId = String(contract.providerId || contract.pgProviderId || contract.pg_provider_id || '').trim();
  if (selectedId && contractProviderId && selectedId === contractProviderId) return true;
  if (!selectedName) return false;
  const contractName = String(contract.providerName || contract.pgProviderName || contract.pg_provider_name || '').trim();
  return normalizeProviderName(contractName) === normalizeProviderName(selectedName)
    || avicxNormalizeProvider(contractName) === avicxNormalizeProvider(selectedName);
}

function accountHasCurrentPgApprovalCredentials(account = {}, selectedPgProvider = null) {
  if (!selectedPgProvider?.name) return hasAccountApprovalCredentials(account);
  const contracts = Array.isArray(account.pgContracts || account.pg_contracts)
    ? (account.pgContracts || account.pg_contracts).filter(contract => contractMatchesProvider(contract, selectedPgProvider))
    : [];
  const providerName = selectedPgProvider.name || '';
  const providerScopedAccount = {
    ...account,
    pgContracts: contracts,
    pg_contracts: contracts,
    pgProviderName: providerName,
    providerName
  };

  if (isRouteupProviderName(providerName)) {
    return hasRouteupExternalIntegrationKeys(providerScopedAccount);
  }
  if (isGhPaymentsProviderName(providerName)) {
    if (hasBillablePgContract(providerScopedAccount)) return true;
    const recurringTid = String(account.recurringTid || account.recurring_tid || account.txid || '').trim();
    const recurringKey = String(account.recurringKey || account.recurring_key || '').trim();
    return Boolean(recurringTid && recurringKey);
  }
  return contracts.some(contract => contract.active !== false && contract.tid && contract.paymentKey);
}

function accountMatchesCurrentPgApproval(account = {}, selectedPgProvider = null) {
  if (account.active === false || account.hidden === true) return false;
  return accountApprovalStatusIsApproved(account)
    && accountHasCurrentPgApprovalCredentials(account, selectedPgProvider);
}

app.get('/api/franchise/accounts', authenticate, asyncHandler(async (req, res) => {
  const [requests, deliveryAccounts, deliveryAgencies, selectedPgProvider] = await Promise.all([
    repo.listAccountRequestsByFranchise(req.user.franchiseId),
    repo.listDeliveryAccountsByFranchise(req.user.franchiseId),
    repo.listDeliveryAgencies(),
    getUserPgProvider(req.user).catch(() => null)
  ]);
  const selectedPgProviderName = selectedPgProvider?.name || '';

  const deliveryAgencyLogoByName = new Map(
    deliveryAgencies
      .map(agency => [String(agency.name || '').trim().toLowerCase(), agency.logoUrl || ''])
      .filter(([name, logoUrl]) => name && logoUrl)
  );
  const deliveryAgencyLogoUrl = name => deliveryAgencyLogoByName.get(String(name || '').trim().toLowerCase()) || '';

  const statusLabel = (status, account = {}) => {
    if (status === 'REJECTED') return '\uBC18\uB824';
    if (hasAccountApprovalCredentials(account)) return '\uC2B9\uC778\uC644\uB8CC';
    if (status === 'APPROVED') return '\uC2B9\uC778\uB300\uAE30';
    return '\uC2B9\uC778\uB300\uAE30';
  };

  const requestItems = requests.map(request => ({
    id: request.requestId,
    source: 'account_request',
    franchiseId: request.franchiseId,
    franchiseName: request.franchiseName,
    agencyName: request.deliveryAgencyName || '',
    deliveryAgencyLogoUrl: deliveryAgencyLogoUrl(request.deliveryAgencyName),
    bankName: request.bankName || '',
    accountNo: request.accountNo || request.assignedVirtualAccount?.accountNumber || '',
    accountHolder: request.representativeName,
    fileName: request.documentOriginalName ? normalizeUploadOriginalName(request.documentOriginalName) : (request.documentUrl ? path.basename(request.documentUrl) : ''),
    status: request.status,
    statusLabel: statusLabel(request.status, { ...request, pgProviderName: selectedPgProviderName }),
    active: request.active !== false,
    hidden: request.hidden === true,
    requestedAt: request.submittedAt,
    txid: request.txid || '',
    ...accountTidKeyDisplayFields(request),
    exportedAt: request.exportedAt || '',
    exportReadyAt: request.exportReadyAt || '',
    rejectionReason: request.rejectionReason || '',
    currentPgApproved: accountMatchesCurrentPgApproval(request, selectedPgProvider)
  }));

  const deliveryItems = deliveryAccounts.map(account => ({
    id: account.id,
    source: 'delivery_account',
    franchiseId: account.franchiseId,
    agencyName: account.agencyName,
    deliveryAgencyLogoUrl: deliveryAgencyLogoUrl(account.agencyName),
    bankName: account.bankName,
    accountNo: account.accountNo,
    accountHolder: account.accountHolder,
    fileName: deliveryAccountDisplayFileName(account),
    status: account.accountStatus,
    statusLabel: statusLabel(account.accountStatus, { ...account, pgProviderName: selectedPgProviderName }),
    active: account.active !== false,
    hidden: account.hidden === true,
    requestedAt: account.reqDate,
    txid: account.txid || '',
    ...accountTidKeyDisplayFields(account),
    exportedAt: account.exportedAt || '',
    rejectionReason: account.rejectionReason || '',
    currentPgApproved: accountMatchesCurrentPgApproval(account, selectedPgProvider)
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

  const accounts = [...mergedAccounts.values()]
    .map(({ currentPgApproved, ...item }) => item)
    .sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0));

  return res.status(200).json({
    success: true,
    data: accounts
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

app.all('/api/routeup/notify', asyncHandler(async (req, res) => {
  const payload = req.method === 'GET'
    ? { ...req.query }
    : (req.body && typeof req.body === 'object' ? req.body : {});
  const source = {
    ...payload,
    ...(req.query && Object.keys(req.query).length ? { query: req.query } : {})
  };
  const pick = (...keys) => {
    for (const key of keys) {
      const value = source[key] ?? source.data?.[key] ?? source.result?.[key] ?? source.transaction?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  };
  const mid = pick('mid');
  const tid = pick('tid');
  const timestamp = pick('timestamp');
  const signature = pick('signature');
  const signResult = verifyRouteupSignature({ mid, timestamp, signature });
  if (signResult.checked && !signResult.valid) {
    return res.status(403).json({ message: '위루트 결제통지 signature 검증에 실패했습니다.' });
  }
  const transactionId = pick('ord_num', 'ordNum', 'orderNo', 'order_id', 'transactionId', 'transaction_id');
  const pgTransactionId = pick('trx_id', 'trxId', 'pgTransactionId', 'pg_transaction_id') || tid;
  const approvalNo = pick('appr_num', 'apprNum', 'approvalNo', 'approval_no', 'authCd', 'auth_code');
  const amount = Number(String(pick('amount') || '').replace(/[^0-9.-]/g, ''));
  const resultCode = pick('result_cd', 'resultCd', 'resultCode', 'code') || (pick('is_cancel') === '1' ? 'CANCEL' : '0000');
  const resultMessage = pick('result_msg', 'resultMsg', 'resultMessage', 'message', 'msg');
  const isCancel = pick('is_cancel', 'isCancel') === '1';
  const cxlSeq = pick('cxl_seq', 'cxlSeq');
  const eventType = pick('eventType', 'event_type', 'type', 'status') || (isCancel ? `CANCEL${cxlSeq ? `_${cxlSeq}` : ''}` : 'APPROVED');
  const normalizedPayload = {
    ...payload,
    routeupParsed: {
      mid,
      tid,
      trx_id: pgTransactionId,
      ord_num: transactionId,
      appr_num: approvalNo,
      amount: Number.isFinite(amount) ? amount : null,
      item_name: pick('item_name', 'itemName'),
      buyer_name: pick('buyer_name', 'buyerName'),
      buyer_phone: pick('buyer_phone', 'buyerPhone'),
      issuer: pick('issuer'),
      acquirer: pick('acquirer'),
      issuer_code: pick('issuer_code', 'issuerCode'),
      acquirer_code: pick('acquirer_code', 'acquirerCode'),
      card_num: pick('card_num', 'cardNum'),
      installment: pick('installment'),
      trx_dttm: pick('trx_dttm', 'trxDttm'),
      cxl_dttm: pick('cxl_dttm', 'cxlDttm'),
      is_cancel: isCancel ? '1' : '0',
      cxl_seq: cxlSeq,
      ori_trx_id: pick('ori_trx_id', 'oriTrxId'),
      module_type: pick('module_type', 'moduleType'),
      temp: pick('temp'),
      timestamp,
      signature_checked: signResult.checked
    }
  };
  const saved = await repo.recordPgNotification({
    provider: '위루트',
    eventType,
    transactionId,
    pgTransactionId,
    resultCode,
    resultMessage,
    approvalNo,
    payload: normalizedPayload,
    query: req.query || {},
    headers: {
      'content-type': req.get('content-type') || '',
      'user-agent': req.get('user-agent') || '',
      'x-forwarded-for': req.get('x-forwarded-for') || req.ip || '',
      'routeup-signature': signature,
      'routeup-signature-checked': signResult.checked ? 'true' : 'false',
      'routeup-timestamp': timestamp,
      'routeup-mid': mid,
      'routeup-tid': tid,
      'routeup-approval-no': approvalNo
    }
  });
  console.log(`[ROUTEUP_NOTIFY] saved=${saved.id} tx=${transactionId || '-'} pgTx=${pgTransactionId || '-'} code=${resultCode || '-'} event=${eventType || '-'}`);
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({});
}));

app.all('/api/deposits/notify', asyncHandler(async (req, res) => {
  const payload = req.method === 'GET'
    ? { ...req.query }
    : (req.body && typeof req.body === 'object' ? req.body : {});
  const source = {
    ...payload,
    ...(req.query && Object.keys(req.query).length ? { query: req.query } : {})
  };
  const pick = (...keys) => {
    for (const key of keys) {
      const value = source[key] ?? source.deposit?.[key] ?? source.account?.[key] ?? source.virtualAccount?.[key] ?? source.result?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  };
  const amountText = pick('amount', 'depositAmount', 'amt', '입금금액');
  const saved = await repo.recordDepositNotification({
    provider: pick('provider', 'pg', 'bank', 'bankName') || 'DEPOSIT',
    eventType: pick('eventType', 'event_type', 'type', 'status') || req.method,
    txid: pick('txid', 'TXID', 'depositCode', 'deposit_code', '입금코드'),
    accountNo: pick('accountNo', 'account_no', 'accountNumber', 'virtualAccountNo', '계좌번호'),
    bankName: pick('bankName', 'bank_name', 'bankCode', '은행명'),
    depositorName: pick('depositorName', 'depositor_name', 'senderName', 'remitter', '입금자명'),
    amount: amountText ? Number(String(amountText).replace(/[^0-9.-]/g, '')) : null,
    resultCode: pick('resultCode', 'resultCd', 'result_code', 'code'),
    resultMessage: pick('resultMessage', 'resultMsg', 'message', 'msg'),
    payload,
    query: req.query || {},
    headers: {
      'content-type': req.get('content-type') || '',
      'user-agent': req.get('user-agent') || '',
      'x-forwarded-for': req.get('x-forwarded-for') || req.ip || ''
    }
  });

  console.log(`[DEPOSIT_NOTIFY] saved=${saved.id} txid=${saved.txid || '-'} account=${saved.accountNo || '-'} amount=${saved.amount ?? '-'}`);
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
  const installmentMonths = Number(installment) || 0;
  if (installmentMonths < 0 || installmentMonths > MAX_INSTALLMENT_MONTH) {
    return sendError(res, 400, 'INVALID_INSTALLMENT_MONTH', '할부는 최대 6개월까지만 선택할 수 있습니다.');
  }

  const card = await repo.findCardByUserId(String(cardId), req.user.id);
  if (!card || card.active === false || card.hidden === true) {
    return sendError(res, 404, 'CARD_NOT_FOUND', '결제 가능한 등록 카드가 없습니다.');
  }
  const selectedPgProvider = await getUserPgProvider(req.user);
  if (selectedPgProvider && String(card.pgProviderId || '') !== String(selectedPgProvider.id)) {
    return sendError(res, 409, 'CARD_PG_RE_REGISTRATION_REQUIRED', 'PG사가 변경되어 기존 등록 카드를 사용할 수 없습니다. 카드를 다시 등록해 주세요.', {
      pgProviderId: selectedPgProvider.id,
      pgProviderName: selectedPgProvider.name
    });
  }

  const depositAccount = await repo.findChargeDepositAccount({
    franchiseId: req.user.franchiseId,
    accountId,
    source: accountSource
  });
  if (!depositAccount) {
    return sendError(res, 404, 'DEPOSIT_ACCOUNT_NOT_FOUND', '승인된 입금 계좌를 찾지 못했습니다.');
  }
  if (selectedPgProvider && !accountMatchesCurrentPgApproval(depositAccount, selectedPgProvider)) {
    return sendError(res, 409, 'DEPOSIT_ACCOUNT_PG_RE_REGISTRATION_REQUIRED', '현재 PG에서 승인된 입금 계좌가 아닙니다. 계좌를 다시 승인해 주세요.', {
      pgProviderId: selectedPgProvider.id,
      pgProviderName: selectedPgProvider.name
    });
  }

  if (isRouteupProviderName(selectedPgProvider?.name)) {
    const routeupContract = pickRouteupBillingContract(depositAccount, selectedPgProvider);
    if (!routeupContract) {
      return sendError(res, 409, 'ROUTEUP_ACCOUNT_CONTRACT_REQUIRED', '위루트 결제는 승인된 계좌의 MID, TID, 결제 KEY가 등록된 후 이용할 수 있습니다.');
    }
    if (String(card.id || '').startsWith('card_ref_')) {
      return sendError(res, 409, 'CARD_PROVIDER_NOT_READY', '위루트 결제가 가능한 카드가 아닙니다. 카드를 다시 등록해 주세요.');
    }

    const transactionId = generateId('TXN', 7);
    const routeupBody = buildRouteupBillPayPayload({
      contract: routeupContract,
      orderNo: transactionId,
      buyerName: card.payerName || req.user.name || req.user.franchiseName || '',
      buyerPhone: card.payerTel || req.user.phone || req.user.tel || '',
      itemName: 'eats PAY 충전',
      billKey: card.id,
      amount: Number(totalAmount),
      installment: installmentMonths
    });
    console.log(`[ROUTEUP_BILLING_PAY_REQUEST] billKey=${String(card.id).slice(0, 10)}... ordNum=${transactionId} amount=${Number(totalAmount)} installment=${installmentMonths} accountTid=${routeupContract.tid}`);
    const providerResponse = await routeupRequest('/api/v2/pay/bill-key/hand', {
      method: 'POST',
      payKey: routeupContract.paymentKey,
      body: routeupBody
    });
    const payload = await providerResponse.json().catch(() => ({}));
    if (!providerResponse.ok || !isRouteupSuccess(payload)) {
      const providerMessage = routeupMessage(payload) || 'Routeup billing payment failed.';
      console.log(`[ROUTEUP_BILLING_PAY_FAILED] ordNum=${transactionId} code=${payload?.result_cd || providerResponse.status} message=${providerMessage}`);
      return sendError(res, providerResponse.status || 502, 'ROUTEUP_BILLING_PAY_FAILED', providerMessage, payload);
    }

    const providerTid = String(payload.tid || payload.TID || '').trim();
    if (providerTid && providerTid !== routeupContract.tid) {
      console.log(`[ROUTEUP_TID_MISMATCH] billKey=${String(card.id).slice(0, 10)}... ordNum=${transactionId} expectedTid=${routeupContract.tid} providerTid=${providerTid} accountId=${depositAccount.id}`);
      return sendError(res, 502, 'ROUTEUP_TID_MISMATCH', '위루트가 선택한 입금 계좌와 요청 계좌가 일치하지 않습니다. 결제를 중단했습니다.', {
        expectedTid: routeupContract.tid,
        providerTid
      });
    }

    const cardIssuer = payload.issuer || card.cardCompany || card.cardName || 'CARD';
    const cardLast4 = String(payload.card_num || card.maskedNumber || card.masked_number || '').replace(/[^0-9]/g, '').slice(-4) || String(card.id).slice(-4);
    const cardDetails = `${cardIssuer} ****-****-****-${cardLast4}`;
    console.log(`[ROUTEUP_BILLING_PAY_SUCCESS] ordNum=${transactionId} trxId=${payload.trx_id || '-'} apprNum=${payload.appr_num || '-'} amount=${payload.amount || totalAmount} accountTid=${routeupContract.tid}${providerTid ? ` providerTid=${providerTid}` : ''}`);
    const result = await repo.recordCharge({
      userId: req.user.id,
      franchiseId: req.user.franchiseId,
      transactionId,
      amount: Number(amount),
      fee: expectedFee,
      totalAmount: Number(totalAmount),
      method: 'CARD',
      cardDetails,
      pg: '위루트',
      pgTxId: payload.trx_id || '',
      authCode: payload.appr_num || '',
      depositAccountSource: depositAccount.source || accountSource || '',
      depositAccountId: String(depositAccount.id || accountId || ''),
      depositBankName: depositAccount.bank_name || '',
      depositAccountNo: depositAccount.account_no || '',
      depositAccountHolder: depositAccount.account_holder || '',
      depositDeliveryAgency: depositAccount.agency_name || '',
      depositTxid: routeupContract.tid
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
        provider: 'ROUTEUP',
        providerResult: payload
      }
    });
  }

  if (selectedPgProvider && !isGhPaymentsProviderName(selectedPgProvider.name)) {
    return sendError(res, 409, 'PG_PROVIDER_NOT_READY', `${selectedPgProvider.name} PG 결제 연동은 아직 준비 중입니다. PG사를 GH Payments 또는 위루트으로 변경하거나 연동 완료 후 이용해 주세요.`);
  }

  const depositAccountRecurringTid = String(depositAccount.recurring_tid || depositAccount.txid || '').trim();
  const depositAccountRecurringKey = String(depositAccount.recurring_key || '').trim();
  if (!depositAccountRecurringTid || !depositAccountRecurringKey) {
    return sendError(res, 409, 'DEPOSIT_ACCOUNT_TID_KEY_REQUIRED', '해당 계좌는 정기 TID와 Key가 등록된 후 결제할 수 있습니다.');
  }

  const isProviderCard = !String(card.id).startsWith('card_ref_');
  const useProvider = hasGhPaymentsPayKey() && isProviderCard;
  if (!useProvider) {
    return sendError(res, 409, 'CARD_PROVIDER_NOT_READY', 'PG 결제가 가능한 카드가 아닙니다. 카드를 다시 등록해 주세요.');
  }

  if (useProvider) {
    const transactionId = generateId('TXN', 7);
    console.log(`[GH_PAYMENTS_BILLING_PAY_REQUEST] rebillId=${cardId} trackId=${transactionId} amount=${Number(totalAmount)} installment=${installmentMonths} accountTid=${depositAccountRecurringTid}`);
    const providerResponse = await ghPaymentsRequest('/api/billing/pay', {
      method: 'POST',
      payKey: depositAccountRecurringKey,
      body: {
        billing: {
          rebillId: cardId,
          trackId: transactionId,
          amount: Number(totalAmount),
          installment: installmentMonths,
          txid: depositAccountRecurringTid,
          key: depositAccountRecurringKey
        }
      }
    });

    const payload = await providerResponse.json().catch(() => ({}));
    if (!providerResponse.ok || payload?.result?.resultCd !== '0000') {
      const providerMessage = payload?.result?.advanceMsg || payload?.result?.resultMsg || payload?.message || 'Payment failed at payment provider.';
      console.log(`[GH_PAYMENTS_BILLING_PAY_FAILED] rebillId=${cardId} trackId=${transactionId} code=${payload?.result?.resultCd || providerResponse.status} message=${providerMessage}`);
      return sendError(res, providerResponse.status || 502, 'GH_PAYMENTS_BILLING_PAY_FAILED', providerMessage, payload);
    }

    const providerTid = String(payload?.pay?.tmnId || payload?.pay?.tid || payload?.tmnId || '').trim();
    if (providerTid && providerTid !== depositAccountRecurringTid) {
      console.log(`[GH_PAYMENTS_TID_MISMATCH] rebillId=${cardId} trackId=${transactionId} expectedTid=${depositAccountRecurringTid} providerTid=${providerTid} accountId=${depositAccount.id}`);
      return sendError(res, 502, 'GH_PAYMENTS_TID_MISMATCH', 'PG가 선택한 입금 계좌와 요청 계좌가 일치하지 않습니다. 결제를 중단했습니다.', {
        expectedTid: depositAccountRecurringTid,
        providerTid
      });
    }

    const providerCard = payload.pay?.card || {};
    console.log(`[GH_PAYMENTS_BILLING_PAY_SUCCESS] rebillId=${cardId} trackId=${transactionId} trxId=${payload.pay?.trxId || '-'} authCd=${payload.pay?.authCd || '-'} amount=${payload.pay?.amount || totalAmount} accountTid=${depositAccountRecurringTid}${providerTid ? ` providerTid=${providerTid}` : ''}`);
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
      authCode: payload.pay?.authCd || '',
      depositAccountSource: depositAccount.source || accountSource || '',
      depositAccountId: String(depositAccount.id || accountId || ''),
      depositBankName: depositAccount.bank_name || '',
      depositAccountNo: depositAccount.account_no || '',
      depositAccountHolder: depositAccount.account_holder || '',
      depositDeliveryAgency: depositAccount.agency_name || '',
      depositTxid: depositAccountRecurringTid
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
  const selectedPgProvider = await getUserPgProvider(req.user).catch(() => null);
  const cards = (await repo.listCardsByUserId(req.user.id))
    .filter(card => cardMatchesCurrentPg(card, selectedPgProvider));
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
  const beforeCard = await repo.findCardByUserId(req.params.id, req.user.id);
  const updated = await repo.updateCardByUserId(req.params.id, req.user.id, {
    maskedNumber: digits ? `****-****-****-${digits.slice(-4)}` : null,
    cardName: finalCardCompany,
    cardCompany: finalCardCompany,
    alias
  });
  if (!updated) {
    return sendError(res, 404, 'CARD_NOT_FOUND', 'Card was not found.');
  }
  await recordAuditLog(req, {
    action: 'CARD_UPDATE',
    entityType: 'card',
    entityId: req.params.id,
    entityName: updated.alias || updated.cardName || '',
    beforeData: pickCardAuditData(beforeCard),
    afterData: pickCardAuditData(updated)
  });

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

  const beforeCard = await repo.findCardByUserId(req.params.id, req.user.id);
  const updated = await repo.updateCardActiveByUserId(req.params.id, req.user.id, req.body.active);
  if (!updated) {
    return sendError(res, 404, 'CARD_NOT_FOUND', 'Card was not found.');
  }
  await recordAuditLog(req, {
    action: req.body.active ? 'CARD_SHOW' : 'CARD_HIDE',
    entityType: 'card',
    entityId: req.params.id,
    entityName: updated.alias || updated.cardName || '',
    beforeData: pickCardAuditData(beforeCard),
    afterData: pickCardAuditData(updated)
  });

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

  const beforeCard = await repo.findCardByUserId(req.params.id, req.user.id);
  const updated = await repo.updateCardHiddenByUserId(req.params.id, req.user.id, req.body.hidden);
  if (!updated) {
    return sendError(res, 404, 'CARD_NOT_FOUND', 'Card was not found.');
  }
  await recordAuditLog(req, {
    action: req.body.hidden ? 'CARD_HIDE' : 'CARD_SHOW',
    entityType: 'card',
    entityId: req.params.id,
    entityName: updated.alias || updated.cardName || '',
    beforeData: pickCardAuditData(beforeCard),
    afterData: pickCardAuditData(updated)
  });

  return res.status(200).json({
    success: true,
    message: req.body.hidden ? 'Card hidden.' : 'Card shown.',
    data: updated
  });
}));

app.patch('/api/admin/cards/:id/hidden', authenticateAdmin, asyncHandler(async (req, res) => {
  const hidden = typeof req.body.hidden === 'boolean' ? req.body.hidden : true;
  const beforeResult = await pool.query(
    'SELECT id, user_id, masked_number, card_name, card_company, alias, active, hidden FROM cards WHERE id = $1',
    [req.params.id]
  );
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
  await recordAuditLog(req, {
    action: hidden ? 'CARD_ADMIN_HIDE' : 'CARD_ADMIN_SHOW',
    entityType: 'card',
    entityId: req.params.id,
    entityName: result.rows[0].alias || result.rows[0].card_name || '',
    beforeData: pickCardAuditData(beforeResult.rows[0]),
    afterData: pickCardAuditData(result.rows[0])
  });

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

  const beforeResult = await pool.query(
    'SELECT id, user_id, masked_number, card_name, card_company, alias, active, hidden FROM cards WHERE id = $1',
    [req.params.id]
  );
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
  await recordAuditLog(req, {
    action: 'CARD_ADMIN_ALIAS_UPDATE',
    entityType: 'card',
    entityId: req.params.id,
    entityName: result.rows[0].alias || '',
    beforeData: pickCardAuditData(beforeResult.rows[0]),
    afterData: pickCardAuditData(result.rows[0])
  });

  return res.status(200).json({
    success: true,
    message: 'Card alias updated.',
    data: result.rows[0]
  });
}));

app.delete('/api/card/:id', authenticate, asyncHandler(async (req, res) => {
  const beforeCard = await repo.findCardByUserId(req.params.id, req.user.id);
  const deleted = await repo.deleteCardByUserId(req.params.id, req.user.id);
  if (!deleted) {
    return sendError(res, 404, 'CARD_NOT_FOUND', 'Card was not found.');
  }
  await recordAuditLog(req, {
    action: 'CARD_DELETE',
    entityType: 'card',
    entityId: req.params.id,
    entityName: deleted.alias || deleted.cardName || '',
    beforeData: pickCardAuditData(beforeCard || deleted),
    afterData: {},
    force: true
  });

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

  const selectedPgProvider = await getUserPgProvider(req.user);
  if (isRouteupProviderName(selectedPgProvider?.name)) {
    const routeupCardContractSource = await repo.findDefaultRouteupCardRegistrationContract({
      franchiseId: req.user.franchiseId,
      providerName: '위루트'
    });
    const routeupContract = pickRouteupCardRegistrationContract(routeupCardContractSource || {}, selectedPgProvider);
    if (!routeupContract) {
      return sendError(res, 409, 'ROUTEUP_CARD_CONTRACT_REQUIRED', '위루트 카드등록용 결제 KEY가 등록되지 않았습니다. 관리자에서 위루트 계약 정보를 먼저 저장해 주세요.');
    }
    const routeupRegistrationContract = { ...routeupContract, tid: '' };

    const registrationTrackId = generateId('CARD', 6);
    const response = await routeupRequest('/api/v2/pay/bill-key', {
      method: 'POST',
      payKey: routeupContract.paymentKey,
      body: buildRouteupBillKeyPayload({
        contract: routeupRegistrationContract,
        orderNo: registrationTrackId,
        buyerName: resolvedPayerName,
        buyerPhone: resolvedPayerTel,
        cardNumber: digits,
        expiryMonth,
        expiryYear,
        identity,
        cardPw
      })
    });

    const payload = await response.json().catch(() => ({}));
    const billKey = extractRouteupBillKey(payload);
    if (!response.ok || !isRouteupSuccess(payload) || !billKey) {
      return sendError(res, response.status || 502, 'ROUTEUP_CARD_REGISTRATION_FAILED', routeupMessage(payload) || 'Routeup card registration failed.', payload);
    }

    const cardName = normalizeProviderCardCompany(payload.issuer || payload.acquirer, resolvedCompany, digits);
    const maskedNumber = maskCardNumberForStorage(payload.card_num, digits, cardName);
    console.log(`[ROUTEUP_CARD_REGISTRATION_SUCCESS] ordNum=${registrationTrackId} billKey=${billKey.slice(0, 10)}... trxId=${payload.trx_id || '-'} issuer=${cardName} tid=`);
    const card = await repo.registerCard(req.user.id, {
      id: billKey,
      maskedNumber,
      cardName,
      cardCompany: cardName,
      alias: resolvedAlias,
      expiryMonth: String(expiryMonth || '').padStart(2, '0'),
      expiryYear: String(expiryYear || ''),
      payerName: resolvedPayerName,
      payerEmail: resolvedPayerEmail,
      payerTel: resolvedPayerTel,
      cardIdentity: resolvedCardIdentity,
      pgProviderId: selectedPgProvider?.id || null
    });
    await recordAuditLog(req, {
      action: 'CARD_CREATE',
      entityType: 'card',
      entityId: card.id,
      entityName: card.alias || card.cardName || '',
      beforeData: {},
      afterData: pickCardAuditData(card),
      force: true
    });

    return res.status(200).json({
      success: true,
      message: 'Card registered through Routeup.',
      data: {
        ...card,
        provider: 'ROUTEUP',
        billKey,
        providerResult: payload
      }
    });
  }

  if (selectedPgProvider && !isGhPaymentsProviderName(selectedPgProvider.name)) {
    return sendError(res, 409, 'PG_PROVIDER_NOT_READY', `${selectedPgProvider.name} PG 카드등록 연동은 아직 준비 중입니다. PG사를 GH Payments 또는 위루트으로 변경하거나 연동 완료 후 이용해 주세요.`);
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
    const maskedNumber = maskCardNumberForStorage(rebill.cardNumber, digits, cardName);
    console.log(`[GH_PAYMENTS_CARD_REGISTRATION_SUCCESS] trackId=${registrationTrackId} rebillId=${providerCardId} trxId=${rebill.trxId || '-'} status=${rebill.status || '-'} tmnId=${rebill.tmnId || '-'} mchtId=${rebill.mchtId || '-'} issuer=${cardName} last4=${digits.slice(-4)} raw=${JSON.stringify({
      result: payload.result || null,
      rebill: {
        rebillId: rebill.rebillId || '',
        trxId: rebill.trxId || '',
        cardType: rebill.cardType || '',
        cardNumber: maskCardNumberForStorage(rebill.cardNumber, digits, cardName),
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
      cardIdentity: resolvedCardIdentity,
      pgProviderId: selectedPgProvider?.id || null
    });
    await recordAuditLog(req, {
      action: 'CARD_CREATE',
      entityType: 'card',
      entityId: card.id,
      entityName: card.alias || card.cardName || '',
      beforeData: {},
      afterData: pickCardAuditData(card),
      force: true
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
    cardIdentity: resolvedCardIdentity,
    pgProviderId: selectedPgProvider?.id || null
  });
  await recordAuditLog(req, {
    action: 'CARD_CREATE',
    entityType: 'card',
    entityId: card.id,
    entityName: card.alias || card.cardName || '',
    beforeData: {},
    afterData: pickCardAuditData(card),
    force: true
  });

  return res.status(200).json({
    success: true,
    message: 'Card registered.',
    data: card
  });
}));

app.post('/api/admin/accounts/reset-verification', authenticateAdmin, asyncHandler(async (req, res) => {
  const { requestId, accountId, source } = req.body || {};
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
    if (account.accountStatus === 'PENDING') {
      return res.status(200).json({
        success: true,
        message: '이미 검증전 상태입니다.',
        data: { accountId: account.id, status: account.accountStatus, alreadyPending: true }
      });
    }
    const updatedAccount = await repo.resetDeliveryAccountVerification(numericAccountId);
    await recordAuditLog(req, {
      action: 'DELIVERY_ACCOUNT_REVERIFY',
      entityType: 'delivery_account',
      entityId: numericAccountId,
      entityName: account.agencyName || '',
      beforeData: pickDeliveryAccountAuditData(account),
      afterData: pickDeliveryAccountAuditData(updatedAccount)
    });
    return res.status(200).json({
      success: true,
      message: '계좌가 검증전 상태로 변경되었습니다.',
      data: { accountId: updatedAccount.id, status: updatedAccount.accountStatus }
    });
  }

  if (!requestId) {
    return sendError(res, 400, 'INVALID_REQUEST_ID', 'requestId is required.');
  }
  const request = await repo.findAccountRequest(requestId);
  if (!request) {
    return sendError(res, 404, 'REQUEST_NOT_FOUND', 'Account request was not found.');
  }
  if (request.status === 'PENDING') {
    return res.status(200).json({
      success: true,
      message: '이미 검증전 상태입니다.',
      data: { requestId: request.requestId, status: request.status, alreadyPending: true }
    });
  }
  const updated = await repo.resetAccountRequestVerification(requestId);
  await recordAuditLog(req, {
    action: 'ACCOUNT_REQUEST_REVERIFY',
    entityType: 'account_request',
    entityId: requestId,
    entityName: request.franchiseName || '',
    beforeData: pickAccountRequestAuditData(request),
    afterData: pickAccountRequestAuditData(updated)
  });

  return res.status(200).json({
    success: true,
    message: '계좌 요청이 검증전 상태로 변경되었습니다.',
    data: { requestId: updated.requestId, status: updated.status }
  });
}));
app.post('/api/admin/accounts/approve', authenticateAdmin, asyncHandler(async (req, res) => {
  const { requestId, accountId, source, action, assignedVirtualAccount } = req.body;
  const rejectionReason = String(req.body?.rejectionReason || '').trim().slice(0, 100);
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
    const accountOwner = account.franchiseId ? await repo.findUserByFranchiseId(account.franchiseId) : null;
    const accountForApproval = { ...account, pgProviderName: accountOwner?.pgProviderName || '' };
    if (account.accountStatus !== 'PENDING') {
      const sameAction = (account.accountStatus === 'APPROVED' && action === 'APPROVED')
        || (account.accountStatus === 'REJECTED' && action === 'REJECTED');
      if (sameAction) {
        if (action === 'APPROVED' && !hasAccountApprovalCredentials(accountForApproval)) {
          const requeuedAccount = await repo.updateDeliveryAccountApprovalStatus(numericAccountId, { status: 'APPROVED' });
          return res.status(200).json({
            success: true,
            message: '계좌를 내보내기 대기 상태로 다시 반영했습니다.',
            data: {
              accountId: requeuedAccount.id,
              status: requeuedAccount.accountStatus,
              requeuedForExport: true,
              txid: requeuedAccount.txid || ''
            }
          });
        }
        return res.status(200).json({
          success: true,
          message: account.accountStatus === 'APPROVED'
            ? '이미 검증 처리된 계좌입니다. PG 계약정보 등록 후 승인완료로 표시됩니다.'
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
    await recordAuditLog(req, {
      action: action === 'APPROVED' ? 'DELIVERY_ACCOUNT_VERIFY' : 'DELIVERY_ACCOUNT_REJECT',
      entityType: 'delivery_account',
      entityId: numericAccountId,
      entityName: account.agencyName || '',
      beforeData: pickDeliveryAccountAuditData(account),
      afterData: pickDeliveryAccountAuditData(updatedAccount)
    });
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
  const requestOwner = request.franchiseId ? await repo.findUserByFranchiseId(request.franchiseId) : null;
  const requestForApproval = { ...request, pgProviderName: requestOwner?.pgProviderName || '' };
  if (request.status !== 'PENDING') {
    const sameAction = request.status === action;
    if (sameAction) {
      if (action === 'APPROVED' && !hasAccountApprovalCredentials(requestForApproval)) {
        const requeued = await repo.updateAccountRequest(requestId, {
          status: 'APPROVED',
          assignedVirtualAccount: request.assignedVirtualAccount || assignedVirtualAccount || {
            bankCode: request.bankCode || '',
            bankName: request.bankName || '',
            accountNumber: request.accountNo || '',
            accountHolder: request.representativeName || request.franchiseName || ''
          }
        });
        return res.status(200).json({
          success: true,
          message: '계좌를 내보내기 대기 상태로 다시 반영했습니다.',
          data: {
            requestId: requeued.requestId,
            status: requeued.status,
            requeuedForExport: true,
            txid: requeued.txid || ''
          }
        });
      }
      return res.status(200).json({
        success: true,
        message: request.status === 'APPROVED'
          ? '이미 승인 처리된 계좌입니다. PG 계약정보 등록 후 승인완료로 표시됩니다.'
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
  await recordAuditLog(req, {
    action: action === 'APPROVED' ? 'ACCOUNT_REQUEST_VERIFY' : 'ACCOUNT_REQUEST_REJECT',
    entityType: 'account_request',
    entityId: requestId,
    entityName: request.franchiseName || '',
    beforeData: {
      requestId: request.requestId,
      franchiseId: request.franchiseId,
      franchiseName: request.franchiseName,
      deliveryAgencyName: request.deliveryAgencyName,
      bankName: request.bankName,
      accountNo: request.accountNo,
      status: request.status,
      txid: request.txid || ''
    },
    afterData: {
      requestId: updated.requestId,
      franchiseId: updated.franchiseId,
      franchiseName: updated.franchiseName,
      deliveryAgencyName: updated.deliveryAgencyName,
      bankName: updated.bankName,
      accountNo: updated.accountNo,
      status: updated.status,
      txid: updated.txid || '',
      assignedVirtualAccount: action === 'APPROVED' ? assignedVirtualAccount : null,
      rejectionReason: action === 'REJECTED' ? rejectionReason : ''
    }
  });

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
  const beforeUser = await repo.findUserByFranchiseId(franchiseId);
  const user = await repo.updateUserPasswordByFranchiseId(franchiseId, await hashPassword(temporaryPassword));
  if (!user) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', 'Franchise was not found.');
  }
  await recordAuditLog(req, {
    action: 'FRANCHISE_PASSWORD_RESET',
    entityType: 'franchise',
    entityId: franchiseId,
    entityName: user.franchiseName || user.loginId,
    beforeData: { ...pickFranchiseAuditData(beforeUser), password: 'previous' },
    afterData: { ...pickFranchiseAuditData(user), password: 'changed' },
    changedFields: ['password'],
    force: true
  });

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
  const agencies = await repo.listAgencies();
  const beforeAgency = agencies.find(item => Number(item.id) === agencyId);
  const agency = await repo.updateAgencyPasswordById(agencyId, await hashPassword(temporaryPassword));
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }
  await recordAuditLog(req, {
    action: 'AGENCY_PASSWORD_RESET',
    entityType: 'agency',
    entityId: agencyId,
    entityName: agency.name || beforeAgency?.name || '',
    beforeData: { ...pickAgencyAuditData(beforeAgency), password: 'previous' },
    afterData: { ...pickAgencyAuditData(beforeAgency), password: 'changed' },
    changedFields: ['password'],
    force: true
  });

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
  await recordAuditLog(req, {
    action: 'FRANCHISE_BIZ_DOC_UPDATE',
    entityType: 'franchise',
    entityId: franchiseId,
    entityName: user.franchiseName || currentUser?.franchiseName || '',
    beforeData: {
      franchiseId,
      bizDocFileKey: currentUser?.bizDocFileKey || '',
      bizDocFileName: currentUser?.bizDocFileName || ''
    },
    afterData: {
      franchiseId,
      bizDocFileKey: file.fileKey,
      bizDocFileName: file.originalName
    }
  });

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
  await recordAuditLog(req, {
    action: 'FRANCHISE_DELIVERY_ACCOUNT_CREATE',
    entityType: 'delivery_account',
    entityId: account.id,
    entityName: agencyName,
    beforeData: {},
    afterData: {
      franchiseId,
      agencyId: agencyId ? Number(agencyId) : null,
      agencyName,
      bankName,
      accountHolder,
      accountNo,
      fileKey: file?.fileKey || '',
      fileName: file?.originalName || ''
    },
    force: true
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

  const agencies = await repo.listAgencies();
  const beforeAgency = agencies.find(item => Number(item.id) === agencyId);
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
  await recordAuditLog(req, {
    action: 'AGENCY_SETTLE_ACCOUNT_UPDATE',
    entityType: 'agency',
    entityId: agencyId,
    entityName: beforeAgency?.name || agency.name || '',
    beforeData: {
      settleBankName: beforeAgency?.settleBankName || '',
      settleAccountNo: beforeAgency?.settleAccountNo || '',
      settleAccountHolder: beforeAgency?.settleAccountHolder || ''
    },
    afterData: {
      settleBankName: agency.settleBankName || agency.settle_bank_name || bankName,
      settleAccountNo: agency.settleAccountNo || agency.settle_account_no || accountNo,
      settleAccountHolder: agency.settleAccountHolder || agency.settle_account_holder || accountHolder,
      settleDocFileKey: agency.settleDocFileKey || agency.settle_doc_file_key || file?.fileKey || ''
    }
  });

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
  await recordAuditLog(req, {
    action: 'AGENCY_CONTRACT_FILE_UPDATE',
    entityType: 'agency',
    entityId: agencyId,
    entityName: currentAgency.name || agency.name || '',
    beforeData: {
      contractFileKey: currentAgency.contractFileKey || '',
      contractFileName: currentAgency.contractFileName || ''
    },
    afterData: {
      contractFileKey: file.fileKey,
      contractFileName: file.originalName
    }
  });

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
  const scopedAgencyIds = agencyScopeIds(agencies, req.user.agencyId);
  const agencyIds = Array.from(scopedAgencyIds).map(Number).filter(Number.isFinite);
  const agencyById = new Map(agencies.map(item => [String(item.id), item]));

  const [pageResult, allResult, franchiseUsers] = await Promise.all([
    repo.listPgSettlements({
      startDate,
      endDate,
      agencyIds,
      currentAgencyScope: true,
      limit: lNum,
      offset: (pNum - 1) * lNum
    }),
    repo.listPgSettlements({
      startDate,
      endDate,
      agencyIds,
      currentAgencyScope: true,
      limit: 5000,
      offset: 0
    }),
    repo.listFranchiseUsers()
  ]);

  const allPaymentsForSettlement = allResult.items.map(item => ({
    id: item.id,
    date: item.settledAt,
    approvalNo: item.approvalNo,
    franchiseId: item.franchiseId,
    franchise: item.franchiseName,
    amount: Number(item.paymentAmt || 0),
    agencyId: item.agencyId
  }));
  const settlementRows = calculateAgencySettlementRows({
    agencies,
    franchises: franchiseUsers.map(user => ({
      id: user.franchiseId,
      name: user.franchiseName || user.name || '',
      agencyId: user.agencyId
    })),
    payments: allPaymentsForSettlement,
    defaultFeeRate: 4.4,
    hqTransactionFee: 330,
    getEffRate: item => item.feeRate || 0,
    rowAgencyIds: [String(agency.id)],
    sortKey: item => String(item.id).padStart(5, '0')
  });
  const settlementRow = settlementRows[0] || null;
  const agencyFeeByPaymentId = new Map();
  const incomeTaxByPaymentId = new Map();
  const agencyNetByPaymentId = new Map();
  const shareRateByPaymentId = new Map();
  (settlementRow?.payments || []).forEach(payment => {
    const key = String(payment.id || '');
    agencyFeeByPaymentId.set(key, Number(payment.agencyFee || 0));
    incomeTaxByPaymentId.set(key, payment.incomeTax === null ? null : Number(payment.incomeTax || 0));
    agencyNetByPaymentId.set(key, Number(payment.agencyNet || 0));
    shareRateByPaymentId.set(key, Number(payment.shareRate || 0));
  });

  const mapSettlement = item => {
    const paymentAmount = Number(item.paymentAmt || 0);
    const serviceFee = Number(item.svcFee || 0);
    const netAmount = Number(item.netAmt || 0);
    const key = String(item.id || '');
    const agencyFee = agencyFeeByPaymentId.get(key) || 0;
    const incomeTax = incomeTaxByPaymentId.has(key) ? incomeTaxByPaymentId.get(key) : 0;
    const agencyNet = agencyNetByPaymentId.get(key) || 0;
    const shareRate = shareRateByPaymentId.get(key) || 0;
    const parentAgency = agencyById.get(String(item.agencyId || '')) || agency;
    const parentAgencyName = displayAgencyName(item.agencyName || parentAgency.name || agency.name);
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
      incomeTax,
      agencyNet,
      shareRate,
      agencyName: parentAgencyName,
      parentAgencyName,
      parentAgencyType: agencyTypeKeyForApi(parentAgency),
      parentAgencyTypeLabel: agencyTypeLabelForApi(parentAgency),
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
    return acc;
  }, {
    count: 0,
    paymentAmount: 0,
    serviceFee: 0,
    agencyFee: settlementRow?.agencyFee || 0,
    incomeTax: settlementRow?.incomeTax === null ? null : settlementRow?.incomeTax || 0,
    agencyNet: settlementRow?.agencyNet || 0
  });

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

app.get('/api/agency/me/franchises', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role !== 'AGENCY' || !req.user.agencyId) {
    return sendError(res, 403, 'ACCESS_DENIED', 'Agency account is required.');
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const offset = (page - 1) * limit;
  const agencies = await repo.listAgencies();
  const agency = agencies.find(item => Number(item.id) === Number(req.user.agencyId));
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }
  const scopedAgencyIds = agencyScopeIds(agencies, req.user.agencyId);
  const agencyIds = Array.from(scopedAgencyIds).map(Number).filter(Number.isFinite);
  const agencyById = new Map(agencies.map(item => [String(item.id), item]));
  const [users, settlements] = await Promise.all([
    repo.listFranchiseUsers(),
    repo.listPgSettlements({
      startDate: '2000-01-01',
      endDate: '2100-12-31',
      agencyIds,
      currentAgencyScope: true,
      limit: 5000,
      offset: 0
    })
  ]);

  const latestPaymentByFranchise = new Map();
  const totalPaymentByFranchise = new Map();
  for (const item of settlements.items || []) {
    const franchiseId = String(item.franchiseId || '');
    if (!franchiseId) continue;
    if (!latestPaymentByFranchise.has(franchiseId)) {
      latestPaymentByFranchise.set(franchiseId, item.settledAt || '');
    }
    totalPaymentByFranchise.set(franchiseId, (totalPaymentByFranchise.get(franchiseId) || 0) + Number(item.paymentAmt || 0));
  }

  const scopedUsers = users
    .filter(user => scopedAgencyIds.has(String(user.agencyId || '')))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const statusLabel = user => (
    user.role === 'OWNER' ? '승인완료' :
    user.role === 'OWNER_REJECTED' ? '반려' :
    '승인대기'
  );

  return res.status(200).json({
    success: true,
    data: {
      agency: {
        id: agency.id,
        name: displayAgencyName(agency.name)
      },
      summary: {
        total: scopedUsers.length,
        approved: scopedUsers.filter(user => user.role === 'OWNER').length,
        pending: scopedUsers.filter(user => user.role === 'OWNER_PENDING').length,
        rejected: scopedUsers.filter(user => user.role === 'OWNER_REJECTED').length
      },
      items: scopedUsers.slice(offset, offset + limit).map(user => {
        const parentAgency = agencyById.get(String(user.agencyId || ''));
        const lastPayment = latestPaymentByFranchise.get(String(user.franchiseId || ''));
        return {
          id: user.id,
          franchiseId: user.franchiseId,
          franchiseName: user.franchiseName || user.name || '',
          ownerName: user.name || '',
          phone: user.phone || user.tel || '',
          parentAgencyName: displayAgencyName(user.agencyName || parentAgency?.name || agency.name),
          statusLabel: statusLabel(user),
          joinedAt: user.createdAt ? formatKstDate(user.createdAt) : '',
          lastPaymentDate: lastPayment ? formatKstDate(lastPayment) : '',
          totalPaymentAmount: totalPaymentByFranchise.get(String(user.franchiseId || '')) || 0
        };
      }),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(scopedUsers.length / limit) || 1,
        totalItems: scopedUsers.length,
        limit
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
      `SELECT cards.id, cards.user_id, cards.masked_number, cards.card_name, cards.card_company, cards.alias,
              cards.active, cards.hidden, cards.pg_provider_id, pg_providers.name AS pg_provider_name, cards.created_at
       FROM cards
       JOIN users AS card_users ON card_users.id = cards.user_id
       LEFT JOIN pg_providers ON pg_providers.id = cards.pg_provider_id
       WHERE cards.user_id = ANY($1::bigint[])
         AND COALESCE(cards.hidden, false) = false
         AND COALESCE(cards.active, true) = true
         AND (
           card_users.pg_provider_id IS NULL
           OR cards.pg_provider_id = card_users.pg_provider_id
         )
       ORDER BY cards.created_at DESC`,
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
    paymentCode: tx.transactionId,
    authCode: tx.authCode || '',
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
      signupSource: user.signupSource || '',
      signupAgencyId: user.signupAgencyId || null,
      signupJoinCode: user.signupJoinCode || '',
      owner: user.name,
      phone: user.phone || '',
      address: user.address || '',
      tel: user.tel || '',
      note: user.note || '',
      bizNo: user.businessNumber || '',
      feeRate: user.franchiseFeeRate,
      pgProviderId: user.pgProviderId || null,
      pgProviderName: user.pgProviderName || '',
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
        pgProviderId: item.pg_provider_id || null,
        pgProviderName: item.pg_provider_name || '',
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

const FRANCHISE_BULK_TEMPLATE_COLUMNS = [
  { header: '로그인 ID*', key: 'loginId', width: 18 },
  { header: '비밀번호*', key: 'password', width: 18 },
  { header: '상점명*', key: 'franchiseName', width: 24 },
  { header: '대표자명*', key: 'ownerName', width: 16 },
  { header: '사업자등록번호*', key: 'businessNumber', width: 18 },
  { header: '연락처', key: 'phone', width: 18 },
  { header: '주소', key: 'address', width: 34 },
  { header: '상세주소', key: 'tel', width: 24 },
  { header: '이메일', key: 'contactEmail', width: 26 },
  { header: '상위대리점', key: 'agency', width: 20 },
  { header: 'PG사', key: 'pgProvider', width: 18 },
  { header: '가맹점 PG 수수료율(%)', key: 'feeRate', width: 18 }
];

function normalizeBulkHeader(value) {
  return String(value || '').replace(/\*/g, '').replace(/\s+/g, '').replace(/[()（）%％]/g, '').toLowerCase();
}

function bulkCellText(row, columnMap, aliases) {
  const keys = aliases.map(normalizeBulkHeader);
  const col = keys.map(key => columnMap.get(key)).find(Boolean);
  if (!col) return '';
  const cell = row.getCell(col);
  if (cell.value && typeof cell.value === 'object' && cell.value.text) return String(cell.value.text).trim();
  return String(cell.text || cell.value || '').trim();
}

function normalizeBulkName(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function findBulkAgency(value, agencies = []) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const byId = agencies.find(agency => String(agency.id) === raw);
  if (byId) return byId;
  const key = normalizeBulkName(raw.replace(/^(본사|본부|지사|지점)\s+/, ''));
  return agencies.find(agency => normalizeBulkName(agency.name) === key || normalizeBulkName(displayAgencyName(agency.name)) === key) || null;
}

function findBulkPgProvider(value, providers = []) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const byId = providers.find(provider => String(provider.id) === raw);
  if (byId) return byId;
  const key = normalizeBulkName(normalizeProviderName(raw));
  return providers.find(provider => normalizeBulkName(provider.name) === key || normalizeBulkName(normalizeProviderName(provider.name)) === key) || null;
}

async function createAdminBulkFranchise(req, item, context) {
  const defaultAgency = item.agencyId ? null : await repo.ensureDefaultAgency();
  const selectedAgency = item.agencyId ? { id: item.agencyId } : null;
  const signupAttribution = createSignupAttribution({
    source: 'admin_bulk_create',
    agency: selectedAgency,
    defaultAgency
  });
  const autoPg = item.pgProvider ? null : await resolveSignupPgProvider({
    agencyId: signupAttribution.agencyId,
    joinCode: signupAttribution.signupJoinCode
  });
  const resolvedPgProvider = item.pgProvider || autoPg?.provider || null;
  const franchiseFeeRate = item.feeRate == null ? defaultFranchiseFeeRateForPg(resolvedPgProvider) : item.feeRate;
  const user = await repo.createUser({
    email: item.loginId,
    loginId: item.loginId,
    contactEmail: item.contactEmail,
    passwordHash: await hashPassword(item.password),
    name: item.ownerName,
    franchiseName: item.franchiseName,
    phone: item.phone,
    address: item.address,
    tel: item.tel,
    businessNumber: item.businessNumber,
    agencyId: signupAttribution.agencyId,
    signupSource: signupAttribution.signupSource,
    signupAgencyId: signupAttribution.signupAgencyId,
    signupJoinCode: signupAttribution.signupJoinCode,
    franchiseFeeRate,
    pgProviderId: resolvedPgProvider?.id || null
  });
  await recordAuditLog(req, {
    action: 'FRANCHISE_BULK_CREATE',
    entityType: 'franchise',
    entityId: user.franchiseId,
    entityName: user.franchiseName,
    beforeData: {},
    afterData: pickFranchiseAuditData(user),
    force: true
  });
  context.createdLogins.add(item.loginId.toLowerCase());
  context.createdBusinessNumbers.add(item.businessNumber);
  return user;
}

app.get('/api/admin/franchises/bulk-template.xlsx', authenticateAdmin, asyncHandler(async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'eatsPay';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('가맹점 대량등록');
  worksheet.columns = FRANCHISE_BULK_TEMPLATE_COLUMNS;
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF03C75A' } };
  worksheet.addRow({
    loginId: 'sample-store',
    password: '1234',
    franchiseName: '샘플가맹점',
    ownerName: '홍길동',
    businessNumber: '1234567890',
    phone: '010-1234-5678',
    address: '서울시 강남구',
    tel: '101호',
    contactEmail: 'sample@example.com',
    agency: '이츠페이 본사',
    pgProvider: 'GH Payments',
    feeRate: '4.4'
  });
  worksheet.getRow(2).font = { italic: true, color: { argb: 'FF64748B' } };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  const guide = workbook.addWorksheet('작성안내');
  guide.addRows([
    ['필수 컬럼', '로그인 ID, 비밀번호, 상점명, 대표자명, 사업자등록번호'],
    ['상위대리점', '대리점명 또는 ID 입력. 비우면 기본 본사로 등록됩니다.'],
    ['PG사', 'PG사명 또는 ID 입력. 비우면 자동 배정 규칙을 따릅니다.'],
    ['사업자등록증', '1차 등록에서는 첨부하지 않습니다. 등록 후 상세에서 업로드합니다.']
  ]);
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('eatsPay_가맹점_대량등록_양식.xlsx')}`);
  return res.send(Buffer.from(buffer));
}));

app.post('/api/admin/franchises/bulk-upload', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    return sendError(res, 400, 'MISSING_FILE', '엑셀 파일을 선택해 주세요.');
  }
  if (!/\.xlsx$/i.test(req.file.originalname || '')) {
    return sendError(res, 400, 'INVALID_FILE_FORMAT', '가맹점 대량등록은 .xlsx 파일만 업로드할 수 있습니다.');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(req.file.buffer);
  const worksheet = workbook.getWorksheet('가맹점 대량등록') || workbook.worksheets[0];
  if (!worksheet) {
    return sendError(res, 400, 'EMPTY_WORKBOOK', '엑셀 시트를 찾지 못했습니다.');
  }
  const headerRow = worksheet.getRow(1);
  const columnMap = new Map();
  headerRow.eachCell((cell, colNumber) => {
    const key = normalizeBulkHeader(cell.text || cell.value);
    if (key) columnMap.set(key, colNumber);
  });
  const [agencies, providers] = await Promise.all([repo.listAgencies(), repo.listPgProviders()]);
  const activeProviders = providers.filter(provider => provider.status === '활성');
  const context = {
    createdLogins: new Set(),
    createdBusinessNumbers: new Set()
  };
  const seenLogins = new Set();
  const seenBusinessNumbers = new Set();
  const results = [];
  let createdCount = 0;
  let skippedEmptyRows = 0;

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values = {
      loginId: bulkCellText(row, columnMap, ['로그인 ID', '로그인ID', '아이디', 'ID']),
      password: bulkCellText(row, columnMap, ['비밀번호', 'password', 'PW']),
      franchiseName: bulkCellText(row, columnMap, ['상점명', '가맹점명', '상호']),
      ownerName: bulkCellText(row, columnMap, ['대표자명', '대표자', '예금주']),
      businessNumber: bulkCellText(row, columnMap, ['사업자등록번호', '사업자번호']),
      phone: bulkCellText(row, columnMap, ['연락처', '휴대폰번호', '전화번호']),
      address: bulkCellText(row, columnMap, ['주소']),
      tel: bulkCellText(row, columnMap, ['상세주소', '상세 주소']),
      contactEmail: bulkCellText(row, columnMap, ['이메일', 'email']),
      agencyRaw: bulkCellText(row, columnMap, ['상위대리점', '대리점', '지사', '지점']),
      pgRaw: bulkCellText(row, columnMap, ['PG사', 'PG', '결제PG']),
      feeRateRaw: bulkCellText(row, columnMap, ['가맹점 PG 수수료율', '수수료율', '가맹점수수료율'])
    };
    if (!Object.values(values).some(value => String(value || '').trim())) {
      skippedEmptyRows += 1;
      continue;
    }
    const errors = [];
    const loginId = String(values.loginId || '').trim();
    const password = String(values.password || '');
    const franchiseName = String(values.franchiseName || '').trim();
    const ownerName = String(values.ownerName || '').trim();
    const businessNumber = String(values.businessNumber || '').replace(/[^0-9]/g, '');
    const contactEmail = isEmailLike(values.contactEmail) ? String(values.contactEmail).trim() : '';
    const agency = findBulkAgency(values.agencyRaw, agencies);
    const pgProvider = findBulkPgProvider(values.pgRaw, activeProviders);
    const feeRate = values.feeRateRaw === '' ? null : Number(String(values.feeRateRaw).replace(/[^0-9.]/g, ''));

    if (!loginId) errors.push('로그인 ID 누락');
    else if (!/^[a-zA-Z0-9._-]{3,40}$/.test(loginId)) errors.push('로그인 ID 형식 오류');
    if (!password) errors.push('비밀번호 누락');
    else if (password.length < 4) errors.push('비밀번호 4자 이상 필요');
    if (!franchiseName) errors.push('상점명 누락');
    if (!ownerName) errors.push('대표자명 누락');
    if (!businessNumber) errors.push('사업자등록번호 누락');
    else if (businessNumber.length !== 10) errors.push('사업자등록번호 10자리 필요');
    if (values.contactEmail && !contactEmail) errors.push('이메일 형식 오류');
    if (values.agencyRaw && !agency) errors.push('상위대리점 매칭 실패');
    if (values.pgRaw && !pgProvider) errors.push('PG사 매칭 실패 또는 비활성');
    if (feeRate !== null && (!Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 100)) errors.push('수수료율 오류');
    const loginKey = loginId.toLowerCase();
    if (loginKey && seenLogins.has(loginKey)) errors.push('엑셀 내 로그인 ID 중복');
    if (businessNumber && seenBusinessNumbers.has(businessNumber)) errors.push('엑셀 내 사업자번호 중복');
    if (loginId && (await repo.findUserByLoginId(loginId) || context.createdLogins.has(loginKey))) errors.push('이미 사용 중인 로그인 ID');
    if (businessNumber && (await repo.findUserByBusinessNumber(businessNumber) || context.createdBusinessNumbers.has(businessNumber))) errors.push('이미 가입된 사업자등록번호');
    if (loginKey) seenLogins.add(loginKey);
    if (businessNumber) seenBusinessNumbers.add(businessNumber);

    if (errors.length) {
      results.push({ rowNumber, success: false, franchiseName, loginId, reason: errors.join(', ') });
      continue;
    }

    try {
      const user = await createAdminBulkFranchise(req, {
        loginId,
        password,
        contactEmail,
        franchiseName,
        ownerName,
        phone: String(values.phone || '').trim(),
        address: String(values.address || '').trim(),
        tel: String(values.tel || '').trim(),
        businessNumber,
        agencyId: agency?.id || null,
        pgProvider,
        feeRate
      }, context);
      createdCount += 1;
      results.push({ rowNumber, success: true, franchiseId: user.franchiseId, franchiseName: user.franchiseName, loginId: user.loginId });
    } catch (err) {
      console.error('[franchise-bulk-upload] row failed', rowNumber, err);
      results.push({ rowNumber, success: false, franchiseName, loginId, reason: err.message || '등록 실패' });
    }
  }

  return res.status(200).json({
    success: true,
    data: {
      createdCount,
      failedCount: results.filter(item => !item.success).length,
      skippedEmptyRows,
      results
    }
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
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  const businessNumber = String(req.body?.bizNo || req.body?.businessNumber || '').replace(/[^0-9]/g, '');
  const agencyId = req.body?.agencyId ? Number(req.body.agencyId) : null;
  let selectedPgProvider;
  try {
    selectedPgProvider = await resolveAdminPgProvider(req.body?.pgProviderId);
  } catch (err) {
    return sendError(res, err.statusCode || 400, err.code || 'INVALID_PG_PROVIDER', err.message);
  }
  const hasFranchiseFeeRate = Object.prototype.hasOwnProperty.call(req.body || {}, 'feeRate');
  const requestedFranchiseFeeRate = hasFranchiseFeeRate && req.body?.feeRate !== '' && req.body?.feeRate != null ? Number(req.body.feeRate) : null;
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
  if (requestedFranchiseFeeRate !== null && (!Number.isFinite(requestedFranchiseFeeRate) || requestedFranchiseFeeRate < 0 || requestedFranchiseFeeRate >= 100)) {
    return sendError(res, 400, 'INVALID_FEE_RATE', '수수료율은 0 이상 100 미만으로 입력해 주세요.');
  }
  if (await repo.findUserByLoginId(loginId)) {
    return sendError(res, 409, 'EMAIL_EXISTS', '이미 사용 중인 아이디입니다.');
  }
  if (await repo.findUserByBusinessNumber(businessNumber)) {
    return sendError(res, 409, 'BUSINESS_EXISTS', '이미 가입된 사업자등록번호입니다.');
  }

  const defaultAgency = agencyId ? null : await repo.ensureDefaultAgency();
  const selectedAgency = Number.isFinite(agencyId) ? { id: agencyId } : null;
  const signupAttribution = createSignupAttribution({
    source: 'admin_create',
    agency: selectedAgency,
    defaultAgency
  });
  const autoPg = selectedPgProvider ? null : await resolveSignupPgProvider({
    agencyId: signupAttribution.agencyId,
    joinCode: signupAttribution.signupJoinCode
  });
  const resolvedPgProvider = selectedPgProvider || autoPg?.provider || null;
  const franchiseFeeRate = requestedFranchiseFeeRate === null
    ? defaultFranchiseFeeRateForPg(resolvedPgProvider)
    : requestedFranchiseFeeRate;
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
    note,
    businessNumber,
    agencyId: signupAttribution.agencyId,
    signupSource: signupAttribution.signupSource,
    signupAgencyId: signupAttribution.signupAgencyId,
    signupJoinCode: signupAttribution.signupJoinCode,
    franchiseFeeRate,
    pgProviderId: resolvedPgProvider?.id || null
  });
  await recordAuditLog(req, {
    action: 'FRANCHISE_CREATE',
    entityType: 'franchise',
    entityId: user.franchiseId,
    entityName: user.franchiseName,
    beforeData: {},
    afterData: pickFranchiseAuditData(user),
    force: true
  });

  const savedDeliveryAccounts = [];
  for (const account of deliveryAccounts) {
    const agencyName = String(account.agencyName || account.deliveryAgencyName || '').trim();
    const accountNo = String(account.accountNo || '').trim();
    if (!agencyName || !accountNo) continue;
    const accountPg = normalizeAdminPgContractPayload({
      providerName: resolvedPgProvider?.name || '',
      manualTid: account.manualTid,
      manualKey: account.manualKey,
      recurringTid: account.recurringTid || account.txid,
      recurringKey: account.recurringKey,
      contracts: account.pgContracts
    });
    const savedAccount = await repo.addDeliveryAccount({
      franchiseId: user.franchiseId,
      agencyId: null,
      agencyName,
      bankName: String(account.bankName || '').trim(),
      accountHolder: String(account.accountHolder || account.representativeName || ownerName || agencyName).trim(),
      accountNo,
      fileKey: normalizeStoredFileKey(account.fileKey)
    });
    if (accountPg.legacy.manualTid || accountPg.legacy.manualKey || accountPg.legacy.recurringTid || accountPg.legacy.recurringKey || accountPg.contracts.length) {
      const savedContracts = await repo.updateAccountApprovalPgContracts({
        source: 'delivery_account',
        id: savedAccount.id,
        franchiseId: user.franchiseId,
        legacy: accountPg.legacy,
        contracts: accountPg.contracts
      });
      const refreshed = await repo.findDeliveryAccountById(savedAccount.id);
      if (refreshed) refreshed.pgContracts = savedContracts;
      savedDeliveryAccounts.push(refreshed || savedAccount);
    } else {
      savedDeliveryAccounts.push(savedAccount);
    }
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
      address: user.address || '',
      tel: user.tel || '',
      note: user.note || '',
      bizNo: user.businessNumber,
      bizDocFile: user.bizDocFileKey || '',
      bizDocFileName: user.bizDocFileKey
        ? normalizedBusinessDocDisplayName(user.franchiseName, user.bizDocFileName || user.bizDocFileKey)
        : '',
      feeRate: user.franchiseFeeRate,
      pgProviderId: user.pgProviderId || null,
      pgProviderName: resolvedPgProvider?.name || '',
      pgAssignmentRuleId: autoPg?.rule?.id || null,
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
        accountStatus: deliveryAccountStatusLabel(account.accountStatus, { ...account, pgProviderName: resolvedPgProvider?.name || '' }),
        approvalStatus: account.accountStatus,
        txid: account.txid || '',
        ...accountTidKeyDisplayFields(account),
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

  const beforeUser = await repo.findUserByFranchiseId(franchiseId);
  const user = await repo.updateFranchiseAgency(franchiseId, agencyId);
  if (!user) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', 'Franchise was not found.');
  }
  await recordAuditLog(req, {
    action: 'FRANCHISE_AGENCY_UPDATE',
    entityType: 'franchise',
    entityId: franchiseId,
    entityName: user.franchiseName || beforeUser?.franchiseName || '',
    beforeData: pickFranchiseAuditData(beforeUser),
    afterData: {
      ...pickFranchiseAuditData(user),
      agencyName: displayAgencyName(agency.name)
    }
  });
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

  const beforeUsers = await Promise.all(
    franchiseIds.map(id => repo.findUserByFranchiseId(Number(id))).filter(Boolean)
  );
  const beforeByFranchiseId = new Map(beforeUsers.filter(Boolean).map(user => [String(user.franchiseId), user]));
  const users = await repo.updateFranchisesAgency(franchiseIds, agencyId);
  for (const user of users) {
    const beforeUser = beforeByFranchiseId.get(String(user.franchiseId));
    await recordAuditLog(req, {
      action: 'FRANCHISE_AGENCY_BULK_UPDATE',
      entityType: 'franchise',
      entityId: user.franchiseId,
      entityName: user.franchiseName || beforeUser?.franchiseName || '',
      beforeData: pickFranchiseAuditData(beforeUser),
      afterData: {
        ...pickFranchiseAuditData(user),
        agencyName: displayAgencyName(agency.name)
      }
    });
  }
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
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  const agencyId = req.body?.agencyId ? Number(req.body.agencyId) : null;
  let selectedPgProvider;
  try {
    selectedPgProvider = await resolveAdminPgProvider(req.body?.pgProviderId);
  } catch (err) {
    return sendError(res, err.statusCode || 400, err.code || 'INVALID_PG_PROVIDER', err.message);
  }
  const hasFranchiseFeeRate = Object.prototype.hasOwnProperty.call(req.body || {}, 'feeRate');
  const requestedFranchiseFeeRate = hasFranchiseFeeRate && req.body?.feeRate !== '' && req.body?.feeRate != null ? Number(req.body.feeRate) : null;
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
  if (requestedFranchiseFeeRate !== null && (!Number.isFinite(requestedFranchiseFeeRate) || requestedFranchiseFeeRate < 0 || requestedFranchiseFeeRate >= 100)) {
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
  const beforeUser = await repo.findUserByFranchiseId(franchiseId);
  const beforeDeliveryAccounts = await repo.listDeliveryAccountsByFranchise(franchiseId);
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
    note,
    loginId,
    contactEmail,
    agencyId: agencyId || null,
    franchiseFeeRate: requestedFranchiseFeeRate === null
      ? Number(beforeUser?.franchiseFeeRate || defaultFranchiseFeeRateForPg(selectedPgProvider))
      : requestedFranchiseFeeRate,
    pgProviderId: selectedPgProvider?.id || null
  });
  if (!updated) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', '가맹점을 찾을 수 없습니다.');
  }
  if (password) {
    await repo.updateUserPasswordByFranchiseId(franchiseId, await hashPassword(password));
  }
  const pgChanged = String(beforeUser?.pgProviderId || '') !== String(updated.pgProviderId || '');
  let deactivatedCardCount = 0;
  if (pgChanged) {
    deactivatedCardCount = await repo.deactivateCardsByFranchiseId(franchiseId);
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
    .map(account => {
      const accountPg = normalizeAdminPgContractPayload({
        providerName: selectedPgProvider?.name || '',
        manualTid: account.manualTid,
        manualKey: account.manualKey,
        recurringTid: account.recurringTid || account.txid,
        recurringKey: account.recurringKey,
        contracts: account.pgContracts
      });
      const routeupExternalKeysComplete = hasRouteupExternalIntegrationKeys({ pgContracts: accountPg.contracts });
      return {
        id: account.id || account.accountId || null,
        agencyName: String(account.agencyName || account.deliveryAgencyName || '').trim(),
        bankName: String(account.bankName || '').trim(),
        accountHolder: String(account.accountHolder || account.representativeName || ownerName || account.agencyName || account.deliveryAgencyName || '').trim(),
        accountNo: String(account.accountNo || '').trim(),
        fileKey: normalizeStoredFileKey(account.fileKey),
        displayName: normalizedAccountProofDisplayName(franchiseName, account.displayName),
        accountStatus: routeupExternalKeysComplete ? 'APPROVED' : normalizeDeliveryAccountStatusForDb(account.accountStatus || account.status),
        txid: String(accountPg.legacy.txid || account.txid || '').trim(),
        manualTid: accountPg.legacy.manualTid,
        manualKey: accountPg.legacy.manualKey,
        recurringTid: accountPg.legacy.recurringTid,
        recurringKey: accountPg.legacy.recurringKey,
        pgContracts: accountPg.contracts,
        hidden: account.hidden === true,
        active: account.active !== false
      };
    })
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
  const beforeAudit = pickFranchiseAuditData(beforeUser);
  const afterAudit = pickFranchiseAuditData(updated);
  if (password) {
    beforeAudit.password = 'previous';
    afterAudit.password = 'changed';
  }
  if (agency) {
    afterAudit.agencyName = displayAgencyName(agency.name);
  }
  if (selectedPgProvider) {
    afterAudit.pgProviderName = selectedPgProvider.name;
  }
  if (pgChanged) {
    afterAudit.cardReRegistrationRequired = true;
    afterAudit.deactivatedCardCount = deactivatedCardCount;
  }
  await recordAuditLog(req, {
    action: 'FRANCHISE_UPDATE',
    entityType: 'franchise',
    entityId: franchiseId,
    entityName: updated.franchiseName || beforeUser?.franchiseName || '',
    beforeData: beforeAudit,
    afterData: afterAudit
  });
  await recordAuditLog(req, {
    action: 'FRANCHISE_DELIVERY_ACCOUNTS_REPLACE',
    entityType: 'franchise',
    entityId: franchiseId,
    entityName: updated.franchiseName || beforeUser?.franchiseName || '',
    beforeData: {
      accounts: beforeDeliveryAccounts.map(pickDeliveryAccountAuditData)
    },
    afterData: {
      accounts: savedDeliveryAccounts.map(pickDeliveryAccountAuditData)
    }
  });

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
      note: updated.note || '',
      bizDocFile: updated.bizDocFileKey || '',
      bizDocFileName: normalizedBizDocFileName,
      feeRate: updated.franchiseFeeRate,
      pgProviderId: updated.pgProviderId || null,
      pgProviderName: selectedPgProvider?.name || '',
      cardReRegistrationRequired: pgChanged,
      deactivatedCardCount,
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
        accountStatus: deliveryAccountStatusLabel(account.accountStatus, { ...account, pgProviderName: selectedPgProvider?.name || '' }),
        approvalStatus: account.accountStatus,
        txid: account.txid || '',
        ...accountTidKeyDisplayFields(account, isSystemAdminUser(req.user)),
        exportReadyAt: account.exportReadyAt || '',
        exportedAt: account.exportedAt || '',
        active: account.active !== false,
        hidden: account.hidden === true
      }))
    }
  });
}));

app.patch('/api/admin/franchises/:id/note', authenticateAdmin, asyncHandler(async (req, res) => {
  const franchiseId = Number(req.params.id);
  if (!Number.isFinite(franchiseId)) {
    return sendError(res, 400, 'BAD_REQUEST', 'franchiseId is required.');
  }
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  const beforeUser = await repo.findUserByFranchiseId(franchiseId);
  if (!beforeUser) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', '가맹점을 찾을 수 없습니다.');
  }
  const updated = await repo.updateFranchiseNote(franchiseId, note);
  if (!updated) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', '가맹점을 찾을 수 없습니다.');
  }
  await recordAuditLog(req, {
    action: 'FRANCHISE_NOTE_UPDATE',
    entityType: 'franchise',
    entityId: franchiseId,
    entityName: updated.franchiseName || beforeUser.franchiseName || '',
    beforeData: { note: beforeUser.note || '' },
    afterData: { note: updated.note || '' }
  });
  return res.status(200).json({
    success: true,
    message: '가맹점 비고가 저장되었습니다.',
    data: {
      id: updated.franchiseId,
      note: updated.note || ''
    }
  });
}));

app.delete('/api/admin/franchises/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  if (!isSystemAdminUser(req.user)) {
    return sendError(res, 403, 'ACCESS_DENIED', '시스템 관리자만 가맹점을 DB에서 삭제할 수 있습니다.');
  }
  const franchiseId = Number(req.params.id);
  if (!Number.isFinite(franchiseId)) {
    return sendError(res, 400, 'BAD_REQUEST', 'franchiseId is required.');
  }

  const beforeUser = await repo.findUserByFranchiseId(franchiseId);
  let deleted;
  try {
    deleted = await repo.deleteFranchiseById(franchiseId);
  } catch (err) {
    if (err?.code === 'FRANCHISE_HAS_TRANSACTIONS') {
      return sendError(res, 409, 'FRANCHISE_HAS_TRANSACTIONS', '결제 내역이 있는 가맹점은 DB에서 삭제할 수 없습니다.');
    }
    throw err;
  }
  if (!deleted) {
    return sendError(res, 404, 'FRANCHISE_NOT_FOUND', '가맹점을 찾을 수 없습니다.');
  }
  await recordAuditLog(req, {
    action: 'FRANCHISE_DELETE',
    entityType: 'franchise',
    entityId: franchiseId,
    entityName: deleted.franchiseName || beforeUser?.franchiseName || '',
    beforeData: pickFranchiseAuditData(beforeUser || deleted),
    afterData: {},
    force: true
  });

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
  const includeSensitiveTidKeys = req.user?.role === 'ADMIN' && isSystemAdminUser(req.user);
  const isAgencyViewer = req.user.role === 'AGENCY';
  const [users, agencies, deliveryAgencies, deliveryAccounts, accountRequests, accountRejectionReasons, transactions, settlements, installments, installmentPolicyMeta, pgProviders, pgAssignmentRules, inquiries, advanceInquiries, notices, guides, announcements, faqs, legalDocuments, banners, designSets, admins, talkPosts, bankRows] = await Promise.all([
    repo.listFranchiseUsers(),
    repo.listAgencies(),
    repo.listDeliveryAgencies(),
    repo.listDeliveryAccounts(),
    repo.listAccountRequests(),
    repo.listAccountRejectionReasons(),
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
    repo.getInstallmentPolicyMeta(),
    repo.listPgProviders(),
    repo.listPgAssignmentRules(),
    repo.listAgencyInquiries(),
    repo.listAdvanceInquiries(),
    repo.listBoardPosts('notices', { includeInactive: true }),
    repo.listBoardPosts('guides', { includeInactive: true }),
    repo.listBoardPosts('announcements', { includeInactive: true }),
    repo.listFaqs({ includeInactive: true }),
    repo.listLegalDocuments(),
    repo.listBanners({ includeInactive: true }),
    req.user.role === 'AGENCY' ? Promise.resolve([]) : repo.listDesignSets({ includeInactive: true }),
    repo.listAdminUsers(),
    req.user.role === 'AGENCY' ? Promise.resolve({ rows: [] }) : repo.listAdminTalkPosts({ limit: 10, offset: 0 }),
    pool.query(
      `SELECT code, name, sort_order, icon_url
       FROM financial_institutions
       WHERE active = true
       ORDER BY sort_order ASC, name ASC`
    )
  ]);

  const adminUserIds = users.map(user => user.id).filter(Boolean);
  const adminCardRows = adminUserIds.length
    ? (await pool.query(
      `SELECT cards.id, cards.user_id, cards.masked_number, cards.card_name, cards.card_company, cards.alias,
              cards.active, cards.hidden, cards.pg_provider_id, pg_providers.name AS pg_provider_name, cards.created_at
       FROM cards
       JOIN users AS card_users ON card_users.id = cards.user_id
       LEFT JOIN pg_providers ON pg_providers.id = cards.pg_provider_id
       WHERE cards.user_id = ANY($1::bigint[])
         AND COALESCE(cards.hidden, false) = false
         AND COALESCE(cards.active, true) = true
         AND (
           card_users.pg_provider_id IS NULL
           OR cards.pg_provider_id = card_users.pg_provider_id
         )
       ORDER BY cards.created_at DESC`,
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
      note: isAgencyViewer ? '' : (user.note || ''),
      bizNo: user.businessNumber || '',
      feeRate: user.franchiseFeeRate,
      pgProviderId: user.pgProviderId || null,
      pgProviderName: user.pgProviderName || '',
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
        pgProviderId: item.pg_provider_id || null,
        pgProviderName: item.pg_provider_name || '',
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
  const adminAccountTidFields = account => (
    isAgencyViewer ? agencySafeAccountTidKeyFields() : accountTidKeyDisplayFields(account, includeSensitiveTidKeys)
  );

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
      const rawStatus = String(item.approvalStatus || item.status || '').toUpperCase();
      if (rawStatus === 'PENDING' || item.accountStatus === '승인대기') return 4;
      if (rawStatus === 'APPROVED' || item.accountStatus === '승인완료') return 3;
      if (rawStatus === 'REJECTED' || item.accountStatus === '반려') return 1;
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
    const franchise = franchiseMap.get(request.franchiseId) || {};
    const accountForStatus = { ...request, pgProviderName: franchise.pgProviderName || '' };
    pushDeliveryAgency(request.franchiseId, {
      agency: request.deliveryAgencyName || bankLabel(request.bankCode),
      bankName: request.bankName || bankLabel(request.bankCode || request.assignedVirtualAccount?.bankCode),
      bankCode: request.bankCode || request.assignedVirtualAccount?.bankCode || '',
      accountNo: requestAccountNo,
      accountHolder: request.representativeName || '',
      businessNumber: request.businessNumber || '',
      fileName: request.documentOriginalName ? normalizeUploadOriginalName(request.documentOriginalName) : (request.documentUrl ? path.basename(request.documentUrl) : ''),
      documentUrl: request.documentUrl || '',
      accountStatus: request.status === 'REJECTED' ? '\uBC18\uB824' : hasAccountApprovalCredentials(accountForStatus) ? '승인완료' : '\uC2B9\uC778\uB300\uAE30',
      approvalStatus: request.status,
      reqDate: formatDate(request.submittedAt),
      requestId: request.requestId,
      source: 'account_request',
      hidden: request.hidden === true,
      txid: isAgencyViewer ? '' : (request.txid || ''),
      ...adminAccountTidFields(request),
      exportedAt: request.exportedAt || '',
      exportReadyAt: request.exportReadyAt || '',
      rejectReason: request.rejectionReason || ''
    });
  }

  for (const account of deliveryAccounts) {
    const franchise = franchiseMap.get(account.franchiseId) || {};
    const accountForStatus = { ...account, pgProviderName: franchise.pgProviderName || '' };
    pushDeliveryAgency(account.franchiseId, {
      id: account.id,
      agency: account.agencyName || account.bankName || '\uAC00\uC0C1\uACC4\uC88C',
      bankName: account.bankName || '',
      bankCode: account.bankCode || '',
      accountNo: account.accountNo || '',
      accountHolder: account.accountHolder || '',
      fileName: deliveryAccountDisplayFileName(account),
      fileKey: account.fileKey || '',
      documentUrl: account.fileKey ? `/uploads/${encodeURIComponent(account.fileKey)}` : '',
      accountStatus: account.accountStatus === 'REJECTED' ? '\uBC18\uB824' : hasAccountApprovalCredentials(accountForStatus) ? '승인완료' : '\uC2B9\uC778\uB300\uAE30',
      approvalStatus: account.accountStatus,
      reqDate: formatDate(account.reqDate),
      requestId: null,
      source: 'delivery_account',
      hidden: account.hidden === true,
      txid: isAgencyViewer ? '' : (account.txid || ''),
      ...adminAccountTidFields(account),
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
      paymentCode: tx.transactionId,
      authCode: tx.authCode || '',
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
  franchises = franchises.map((franchise, index) => enrichAdminFranchiseDisplay(franchise, index, paymentRows));

  const paymentNameByFranchiseId = new Map(franchises.map(f => [f.id, f.name]));
  const paymentAgencyByFranchiseId = new Map(franchises.map(f => [String(f.id), {
    id: f.agencyId || null,
    name: f.agency || f.agencyName || ''
  }]));
  const paymentDateByApprovalNo = new Map(paymentRows.map(row => [String(row.approvalNo || ''), row.date]).filter(([approvalNo, date]) => approvalNo && date));
  const pgRows = settlementItems.map(item => {
    const fallbackAgency = paymentAgencyByFranchiseId.get(String(item.franchiseId || '')) || {};
    const paymentDate = paymentDateByApprovalNo.get(String(item.approvalNo || '')) || formatKstDateTime(item.paymentDate);
    const settlementDate = item.settledAt ? formatKstDateTime(item.settledAt) : '';
    return {
      id: item.id,
      date: paymentDate,
      paymentDate,
      settlementDate,
      settledAt: settlementDate,
      approvalNo: item.approvalNo,
      authCode: item.authCode || '',
      franchiseId: item.franchiseId || null,
      pg: item.pg,
      franchise: item.franchiseName || paymentNameByFranchiseId.get(item.franchiseId) || '',
      paymentAmt: Number(item.paymentAmt),
      svcFee: Number(item.svcFee),
      netAmt: Number(item.netAmt),
      deliveryAgency: item.deliveryAgency || '',
      status: item.status || '',
      note: '',
      agencyId: item.agencyId || fallbackAgency.id || null,
      agency: item.agencyName || fallbackAgency.name || '',
      customerId: item.customerId || '',
      bankCode: item.bankCode || '',
      depositBankName: item.depositBankName || '',
      accountNo: item.accountNo || '',
      accountHolder: item.accountHolder || '',
      pgTxId: item.pgTxId || ''
    };
  });

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
  const agencySafeAccountItem = account => {
    if (!account || typeof account !== 'object') return account;
    const safe = {
      ...account,
      txid: '',
      manualTid: '',
      manualKey: '',
      manualKeyMasked: '',
      recurringTid: '',
      recurringKey: '',
      recurringKeyMasked: '',
      hasManualKey: false,
      hasRecurringKey: false,
      pgContracts: []
    };
    delete safe.manual_tid;
    delete safe.manual_key;
    delete safe.recurring_tid;
    delete safe.recurring_key;
    delete safe.pg_contracts;
    delete safe.paymentKey;
    delete safe.paymentKeyMasked;
    delete safe.signatureKey;
    delete safe.signatureKeyMasked;
    delete safe.key;
    return safe;
  };
  const agencySafeFranchiseItem = franchise => ({
    ...franchise,
    note: '',
    deliveryAgencies: Array.isArray(franchise.deliveryAgencies)
      ? franchise.deliveryAgencies.map(agencySafeAccountItem)
      : []
  });
  const responseFranchises = isAgencyViewer
    ? scopedFranchises.map(agencySafeFranchiseItem)
    : scopedFranchises;
  const responseAccountRequests = isAgencyViewer
    ? scopedAccountRequests.map(agencySafeAccountItem)
    : scopedAccountRequests;
  const responseDeliveryAccounts = isAgencyViewer
    ? scopedDeliveryAccounts.map(agencySafeAccountItem)
    : scopedDeliveryAccounts;

  const today = formatKstDate(new Date());
  const todayPaymentTotal = scopedPayments
    .filter(payment => payment.date.startsWith(today))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  return res.status(200).json({
    success: true,
    data: {
      summary: {
        pendingFranchises: scopedFranchises.filter(franchise => franchise.role === 'OWNER_PENDING').length,
        pendingAccounts: scopedAccountRequests.filter(request => request.status === 'PENDING').length + scopedDeliveryAccounts.filter(account => account.accountStatus === 'PENDING').length,
      totalFranchises: scopedFranchises.length,
      todayPaymentTotal
    },
    franchises: responseFranchises,
    agencies: scopedAgencies.map(agency => ({
      ...agency,
      name: displayAgencyName(agency.name)
    })),
    deliveryAgencies,
    accountRejectionReasons: accountRejectionReasons,
    installments,
    installmentPolicyMeta,
    pgProviders,
    pgAssignmentRules,
    inquiries,
    advanceInquiries: isAgencyViewer ? [] : advanceInquiries,
    notices,
    guides,
    announcements,
    faqs,
    legalDocuments,
    banners,
    designSets: isAgencyViewer ? [] : designSets,
    talkPosts: Array.isArray(talkPosts) ? talkPosts : (talkPosts.rows || []),
    admins: isAgencyViewer ? [] : admins.map(serializeAdminUser),
    banks: bankRows.rows.map(row => ({
      code: row.code,
      name: row.name,
      sortOrder: row.sort_order,
      iconUrl: row.icon_url || ''
    })),
    customRoles: ADMIN_ROLE_LIST,
    payments: scopedPayments,
    pgSettlements: scopedPgRows,
    accountRequests: responseAccountRequests,
      deliveryAccounts: responseDeliveryAccounts
    }
  });
}));

app.get('/api/admin/audit-logs', authenticateAdmin, asyncHandler(async (req, res) => {
  const logs = await repo.listAuditLogs({
    entityType: req.query.entityType,
    entityId: req.query.entityId,
    action: req.query.action,
    limit: req.query.limit
  });
  return res.status(200).json({
    success: true,
    data: logs.map(serializeAuditLog)
  });
}));


app.post('/api/admin/avicx/session', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
  const sessionId = await touchAvicxSession(req, req.body?.sessionId || req.query?.sessionId);
  return res.status(200).json({ success: true, data: { sessionId } });
}));

app.get('/api/admin/avicx/history', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
  const sessionId = await touchAvicxSession(req, req.query.sessionId);
  const limit = avicxLimit(req.query.limit, 50, 100);
  const rows = await pool.query(
    `SELECT id, command, status, output, created_at
     FROM admin_console_commands
     WHERE session_id = $1
     ORDER BY id DESC
     LIMIT $2`,
    [sessionId, limit]
  );
  return res.status(200).json({
    success: true,
    data: {
      sessionId,
      rows: rows.rows.reverse().map(row => ({
        id: row.id,
        command: row.command,
        status: row.status,
        output: row.output || {},
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      }))
    }
  });
}));

app.post('/api/admin/avicx/execute', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
  const sessionId = await touchAvicxSession(req, req.body?.sessionId);
  const command = String(req.body?.command || '').trim();
  let output;
  let status = 'ok';
  try {
    output = await executeAvicxCommand(req, command);
    status = output?.tone === 'warn' ? 'warn' : 'ok';
  } catch (error) {
    status = 'error';
    output = avicxLines([error?.message || 'AVICX command failed.'], 'error');
  }
  if (command && output?.type !== 'clear') await recordAvicxCommand(sessionId, req, command, status, output);
  return res.status(200).json({ success: true, data: { sessionId, command, status, output, createdAt: new Date().toISOString() } });
}));


app.post('/api/admin/ai/chat', authenticateAdmin, asyncHandler(async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    return sendError(res, 400, 'MISSING_MESSAGE', '이츠비에게 물어볼 내용을 입력해 주세요.');
  }
  if (message.length > 1000) {
    return sendError(res, 400, 'MESSAGE_TOO_LONG', '이츠비 질문은 1000자 이내로 입력해 주세요.');
  }

  const sessionId = await touchAvicxSession(req, req.body?.sessionId || `itzbi-${req.user?.id || 'admin'}`);
  const teaching = itzbiParseTeachingMessage(message);
  if (teaching) {
    let output;
    let status = 'ok';
    try {
      output = await saveItzbiLearningRule(req, teaching);
      status = output?.tone === 'warn' ? 'warn' : 'ok';
    } catch (error) {
      status = 'error';
      output = avicxLines([error?.message || '이츠비 학습 저장에 실패했어요.'], 'error');
    }
    await recordAvicxCommand(sessionId, req, `itzbi-learn: ${message}`, status, output);
    const reply = avicxOutputToChatText(output, 'learn');
    return res.status(200).json({
      success: true,
      reply,
      requiresDeveloper: false,
      developerNotified: false,
      developerEmail: SYSTEM_ADMIN_LOGIN_ID,
      sessionId,
      command: teaching.commandText,
      status
    });
  }
  const directLearnCommand = /^(learn|학습)\b/i.test(message) || /^(학습목록|학습 목록|이츠비학습목록|이츠비 학습 목록)$/.test(message.replace(/[?!？.。]+/g, '').trim())
    ? itzbiCommandFromMessage(message)
    : '';
  if (directLearnCommand && /^(learn|학습)\b/i.test(directLearnCommand)) {
    let output;
    let status = 'ok';
    try {
      output = await executeAvicxCommand(req, directLearnCommand);
      status = output?.tone === 'warn' ? 'warn' : 'ok';
    } catch (error) {
      status = 'error';
      output = avicxLines([error?.message || '이츠비 학습 명령 처리에 실패했어요.'], 'error');
    }
    await recordAvicxCommand(sessionId, req, `itzbi-learn-command: ${message} -> ${directLearnCommand}`, status, output);
    const reply = avicxOutputToChatText(output, directLearnCommand);
    return res.status(200).json({
      success: true,
      reply,
      requiresDeveloper: false,
      developerNotified: false,
      developerEmail: SYSTEM_ADMIN_LOGIN_ID,
      sessionId,
      command: directLearnCommand,
      status
    });
  }
  const requiresDeveloper = itzbiRequiresDeveloper(message);

  if (requiresDeveloper) {
    const developerNotified = await notifyItzbiDeveloper(req, message, 'operational_db_required');
    const reply = [
      '조회는 바로 도와드릴 수 있어요.',
      '다만 결제, 정산, 계좌, 관리자 권한처럼 실제 데이터를 바꾸는 작업은 여기서 바로 실행하지 않을게요.',
      `${SYSTEM_ADMIN_LOGIN_ID}에 확인 요청으로 남겨둘게요.`
    ].join('\n');
    const output = avicxLines(reply.split('\n'), 'warn');
    await recordAvicxCommand(sessionId, req, `itzbi: ${message}`, 'warn', output);
    return res.status(200).json({
      success: true,
      reply,
      requiresDeveloper: true,
      developerNotified,
      developerEmail: SYSTEM_ADMIN_LOGIN_ID,
      sessionId
    });
  }

  const learnedCommand = await findItzbiLearnedCommand(message);
  const readCommand = learnedCommand || itzbiCommandFromMessage(message);
  if (readCommand) {
    let output;
    let status = 'ok';
    try {
      output = await executeAvicxCommand(req, readCommand);
      status = output?.tone === 'warn' ? 'warn' : 'ok';
    } catch (error) {
      status = 'error';
      output = avicxLines([error?.message || '이츠비 DB 조회에 실패했어요.'], 'error');
    }
    await recordAvicxCommand(sessionId, req, `${learnedCommand ? 'itzbi-learned' : 'itzbi-db'}: ${message} -> ${readCommand}`, status, output);
    const reply = avicxOutputToChatText(output, readCommand);
    return res.status(200).json({
      success: true,
      reply,
      requiresDeveloper: false,
      developerNotified: false,
      developerEmail: SYSTEM_ADMIN_LOGIN_ID,
      sessionId,
      command: readCommand,
      status
    });
  }
  const reply = itzbiFallbackReply(message);
  const output = avicxLines(reply.split('\n'), 'warn');
  await recordAvicxCommand(sessionId, req, `itzbi-fallback: ${message}`, 'warn', output);

  return res.status(200).json({
    success: true,
    reply,
    requiresDeveloper: false,
    developerNotified: false,
    developerEmail: SYSTEM_ADMIN_LOGIN_ID,
    sessionId,
    command: 'fallback',
    status: 'warn'
  });
}));
app.get('/api/admin/pg-notifications', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
  const rows = await repo.listPgNotifications({
    limit: req.query.limit,
    provider: req.query.provider
  });
  return res.status(200).json({
    success: true,
    data: rows
  });
}));

app.get('/api/admin/deposit-notifications', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
  const rows = await repo.listDepositNotifications({
    limit: req.query.limit
  });
  return res.status(200).json({
    success: true,
    data: rows
  });
}));

async function createRouteupLoginSession() {
  if (!ROUTEUP_UID || !ROUTEUP_PW) {
    const err = new Error('ROUTEUP_CREDENTIALS_MISSING');
    err.statusCode = 503;
    throw err;
  }
  const response = await fetch(`${ROUTEUP_BASE_URL}/api/v1/auth/sign-in`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    },
    body: JSON.stringify({ user_name: ROUTEUP_UID, user_pw: ROUTEUP_PW, token: '' })
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  if (!response.ok || !data?.access_token) {
    const err = new Error(data?.message || data?.error?.message || 'ROUTEUP_LOGIN_FAILED');
    err.statusCode = response.status || 502;
    err.code = 'ROUTEUP_LOGIN_FAILED';
    err.details = [{ status: response.status, body: data || text }];
    throw err;
  }
  const tokenExpireTime = response.headers.get('token-expire-time') || '';
  const parsedExpiresAt = Date.parse(tokenExpireTime);
  const session = {
    accessToken: String(data.access_token || ''),
    user: data.user || {},
    tokenExpireTime,
    expiresAt: Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : Date.now() + (8 * 60 * 1000)
  };
  routeupSessionCache = session;
  return session;
}

function routeupLoginErrorMessage(err) {
  const upstreamStatus = Number(err?.details?.[0]?.status || 0);
  if (upstreamStatus === 403) {
    return '위루트 로그인 요청이 403으로 차단되었습니다. 위루트 연동 IP 관리에 운영 서버 IP가 허용되어 있는지 확인해 주세요.';
  }
  if (upstreamStatus === 401) {
    return '위루트 로그인 정보가 올바르지 않습니다. 아이디와 비밀번호를 확인해 주세요.';
  }
  const rawMessage = String(err?.message || '').trim();
  if (rawMessage && rawMessage !== 'ROUTEUP_LOGIN_FAILED') {
    return rawMessage;
  }
  return '위루트 로그인에 실패했습니다. 위루트 계정 정보와 연동 IP 허용 상태를 확인해 주세요.';
}

function routeupLoginHttpStatus(err) {
  const statusCode = Number(err?.statusCode || 0);
  if (statusCode >= 500) return statusCode;
  return 502;
}

function sendRouteupLoginError(res, err) {
  const upstreamStatus = Number(err?.details?.[0]?.status || 0);
  return sendError(
    res,
    routeupLoginHttpStatus(err),
    'ROUTEUP_LOGIN_FAILED',
    routeupLoginErrorMessage(err),
    [{ upstreamStatus: upstreamStatus || null, cause: 'ROUTEUP_LOGIN_FAILED' }]
  );
}

async function getRouteupLoginSession(options = {}) {
  const force = options.force === true;
  if (!force && routeupSessionCache?.accessToken && Number(routeupSessionCache.expiresAt || 0) > Date.now() + 30000) {
    return routeupSessionCache;
  }
  return createRouteupLoginSession();
}

async function routeupManagerRequest(pathSegment, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const targetPath = String(pathSegment || '').replace(/^\/+/, '');
  const targetUrl = new URL(`${ROUTEUP_BASE_URL}/api/v1/manager/${targetPath}`);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (Array.isArray(value)) value.forEach(item => targetUrl.searchParams.append(key, item));
    else if (value !== undefined && value !== null) targetUrl.searchParams.set(key, value);
  }
  const session = await getRouteupLoginSession({ force: options.forceSession === true });
  const authCandidates = Array.from(new Set([
    `Bearer ${session.accessToken}`,
    session.accessToken
  ].filter(Boolean)));
  let lastFailure = null;
  for (const authorization of authCandidates) {
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0',
      Referer: `${ROUTEUP_BASE_URL}/build/merchandises/batch`,
      Authorization: authorization
    };
    let body;
    if (!['GET', 'HEAD'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body ?? {});
    }
    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
      redirect: 'manual'
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) {}
    if (response.ok) return { status: response.status, data, text };
    lastFailure = { status: response.status, data, text };
    if (![401, 403].includes(response.status)) break;
  }
  if (!options.forceSession && [401, 403].includes(Number(lastFailure?.status || 0))) {
    routeupSessionCache = null;
    return routeupManagerRequest(pathSegment, { ...options, forceSession: true });
  }
  const message = lastFailure?.data?.message
    || lastFailure?.data?.error?.message
    || lastFailure?.text
    || '위루트 API 요청에 실패했습니다.';
  const err = new Error(message);
  err.statusCode = lastFailure?.status && lastFailure.status < 500 ? 502 : (lastFailure?.status || 502);
  err.code = 'ROUTEUP_API_ERROR';
  err.details = [{ path: targetPath, status: lastFailure?.status || 0, body: lastFailure?.data || lastFailure?.text || '' }];
  throw err;
}

function rewriteRouteupJs(js) {
  return String(js || '')
    .replace(/(["'`])\/api\/v1\//g, '$1/api/admin/routeup/api/v1/')
    .replace(/(["'`])\/build\//g, '$1/api/admin/routeup/proxy/build/')
    .replace(/function\(e\)\{return"\/build\/"\+e\}/g, 'function(e){return"/api/admin/routeup/proxy/build/"+e}');
}

function rewriteRouteupHtml(html, currentPath = '') {
  return String(html || '')
    .replace(/\b(href|src)=["']\/build\/([^"']+)["']/gi, '$1="/api/admin/routeup/proxy/build/$2"')
    .replace(/\b(href|src)=["']\/loader\.css["']/gi, '$1="/api/admin/routeup/proxy/loader.css"')
    .replace(/<head([^>]*)>/i, '<head$1><base href="/api/admin/routeup/proxy/build/">');
}

app.get('/api/admin/routeup/start-token', authenticateAdmin, requireSuperAdmin, asyncHandler(async (req, res) => {
  if (!ROUTEUP_UID || !ROUTEUP_PW) {
    return sendError(res, 503, 'ROUTEUP_CREDENTIALS_MISSING', '위루트 자동 로그인 정보가 설정되어 있지 않습니다.');
  }
  const token = issueRouteupStartToken(req);
  return res.status(200).json({
    success: true,
    data: { url: `/api/admin/routeup/start/${encodeURIComponent(token)}` }
  });
}));

app.get('/api/admin/routeup/start/:token', asyncHandler(async (req, res) => {
  const entry = consumeRouteupStartToken(req.params.token);
  if (!entry) {
    return sendError(res, 401, 'UNAUTHORIZED', '위루트 시작 링크가 만료되었습니다.');
  }
  let session;
  try {
    session = await createRouteupLoginSession();
  } catch (err) {
    if (err?.code === 'ROUTEUP_LOGIN_FAILED') return sendRouteupLoginError(res, err);
    throw err;
  }
  issueRouteupProxyToken(req, res, entry.adminId);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.send(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>위루트 결제내역 자동 로그인</title>
<style>
body{margin:0;font-family:Pretendard,Apple SD Gothic Neo,Noto Sans KR,system-ui,sans-serif;background:linear-gradient(135deg,#07140e 0%,#10351f 54%,#04110b 100%);color:#ecfff3;display:grid;place-items:center;min-height:100vh}
.box{width:min(460px,calc(100vw - 36px));background:rgba(7,20,14,.84);border:1px solid rgba(3,199,90,.32);border-radius:16px;padding:28px;box-shadow:0 22px 70px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.08)}
.eyebrow{font-size:11px;font-weight:900;letter-spacing:.14em;color:#65ff9f;margin-bottom:12px}.title{font-size:22px;font-weight:900;margin-bottom:8px}.msg{font-size:13px;color:#c6f6d5;line-height:1.65}.bar{height:9px;background:rgba(255,255,255,.1);border:1px solid rgba(3,199,90,.28);border-radius:999px;margin-top:22px;overflow:hidden}.bar span{display:block;height:100%;width:38%;background:linear-gradient(90deg,#03c75a,#8cffb7,#03c75a);border-radius:999px;box-shadow:0 0 24px rgba(3,199,90,.65);animation:load 1.05s ease-in-out infinite}@keyframes load{0%{transform:translateX(-110%)}100%{transform:translateX(270%)}}
</style>
</head>
<body>
<div class="box"><div class="eyebrow">ROUTEUP</div><div class="title">결제내역 로그인 중</div><div class="msg">위루트 보안 세션을 준비하고 있습니다.<br>잠시 후 결제 상세조회 화면으로 이동합니다.</div><div class="bar"><span></span></div></div>
<script>
localStorage.setItem('access-token', ${JSON.stringify(session.accessToken)});
localStorage.setItem('user_info', ${JSON.stringify(JSON.stringify(session.user || {}))});
localStorage.setItem('token-expire-time', ${JSON.stringify(session.tokenExpireTime || '')});
setTimeout(function(){ location.replace('/api/admin/routeup/proxy/build/transactions'); }, 850);
</script>
</body>
</html>`);
}));

app.all('/api/admin/routeup/api/v1/*', asyncHandler(async (req, res) => {
  if (!hasValidRouteupProxyToken(req)) {
    return sendError(res, 401, 'UNAUTHORIZED', '위루트 자동 로그인 세션이 만료되었습니다.');
  }
  const targetUrl = new URL(`${ROUTEUP_BASE_URL}/api/v1/${String(req.params[0] || '').replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(req.query || {})) {
    if (Array.isArray(value)) value.forEach(item => targetUrl.searchParams.append(key, item));
    else if (value !== undefined) targetUrl.searchParams.set(key, value);
  }
  const headers = {
    'Accept': req.headers.accept || 'application/json',
    'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
    'Referer': `${ROUTEUP_BASE_URL}/build/transactions`
  };
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  let body;
  if (!['GET', 'HEAD'].includes(req.method.toUpperCase())) {
    const contentType = String(req.headers['content-type'] || 'application/json');
    headers['Content-Type'] = contentType;
    body = contentType.includes('application/json') ? JSON.stringify(req.body || {}) : new URLSearchParams(req.body || {}).toString();
  }
  const upstream = await fetch(targetUrl, { method: req.method, headers, body, redirect: 'manual' });
  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.status(upstream.status);
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('Content-Type', contentType);
  const tokenExpireTime = upstream.headers.get('token-expire-time');
  if (tokenExpireTime) res.setHeader('token-expire-time', tokenExpireTime);
  return res.send(buffer);
}));

app.all('/api/admin/routeup/proxy/*', asyncHandler(async (req, res) => {
  if (!hasValidRouteupProxyToken(req)) {
    return sendError(res, 401, 'UNAUTHORIZED', '위루트 자동 로그인 세션이 만료되었습니다.');
  }
  const rawPath = String(req.params[0] || 'build/transactions').replace(/^\/+/, '') || 'build/transactions';
  const targetUrl = new URL(`${ROUTEUP_BASE_URL}/${rawPath}`);
  for (const [key, value] of Object.entries(req.query || {})) {
    if (Array.isArray(value)) value.forEach(item => targetUrl.searchParams.append(key, item));
    else if (value !== undefined) targetUrl.searchParams.set(key, value);
  }
  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers: {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
      'Referer': `${ROUTEUP_BASE_URL}/build/transactions`
    },
    redirect: 'manual'
  });
  const contentType = upstream.headers.get('content-type') || '';
  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.status(upstream.status);
  if (contentType.includes('text/html')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(rewriteRouteupHtml(buffer.toString('utf8'), rawPath));
  }
  if (contentType.includes('javascript') || /\.js$/i.test(rawPath)) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    return res.send(rewriteRouteupJs(buffer.toString('utf8')));
  }
  if (contentType) res.setHeader('Content-Type', contentType);
  return res.send(buffer);
}));

app.get('/api/admin/ch-payway/autologin', authenticateAdmin, requireSuperAdmin, asyncHandler(async (req, res) => {
  if (!CH_PAYWAY_UID || !CH_PAYWAY_PW) {
    return sendError(res, 503, 'CH_PAYWAY_CREDENTIALS_MISSING', 'CH 결제내역 자동 로그인 정보가 설정되어 있지 않습니다.');
  }
  issueChPaywayProxyToken(req, res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.send(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CH 결제내역 자동 로그인</title>
<style>
body{margin:0;font-family:Pretendard,Apple SD Gothic Neo,Noto Sans KR,system-ui,sans-serif;background:#f4faf4;color:#102010;display:grid;place-items:center;min-height:100vh}
.box{width:min(420px,calc(100vw - 32px));background:#fff;border:1px solid #d1e8d1;border-radius:10px;padding:24px;box-shadow:0 12px 30px rgba(0,0,0,.08)}
.title{font-size:18px;font-weight:900;margin-bottom:8px}.msg{font-size:13px;color:#4b5563;line-height:1.6}.bar{height:6px;background:#e8f6e8;border-radius:999px;margin-top:18px;overflow:hidden}.bar span{display:block;height:100%;width:45%;background:#03c75a;border-radius:999px;animation:load 1.2s ease-in-out infinite}@keyframes load{0%{transform:translateX(-100%)}100%{transform:translateX(240%)}}
</style>
</head>
<body>
<div class="box"><div class="title">CH 결제내역 로그인 중</div><div class="msg">PAYWAY 세션을 준비한 뒤 결제내역 화면으로 이동합니다.</div><div class="bar"><span></span></div></div>
<script>
setTimeout(function(){ location.replace('/api/admin/ch-payway/proxy/home'); }, 120);
</script>
</body>
</html>`);
}));

app.get('/api/admin/ch-payway/start-token', authenticateAdmin, requireSuperAdmin, asyncHandler(async (req, res) => {
  if (!CH_PAYWAY_UID || !CH_PAYWAY_PW) {
    return sendError(res, 503, 'CH_PAYWAY_CREDENTIALS_MISSING', 'CH 결제내역 자동 로그인 정보가 설정되어 있지 않습니다.');
  }
  const token = issueChPaywayStartToken(req);
  return res.status(200).json({
    success: true,
    data: { url: `/api/admin/ch-payway/start/${encodeURIComponent(token)}` }
  });
}));

app.get('/api/admin/ch-payway/start/:token', asyncHandler(async (req, res) => {
  const entry = consumeChPaywayStartToken(req.params.token);
  if (!entry) {
    return sendError(res, 401, 'UNAUTHORIZED', 'CH 결제내역 시작 링크가 만료되었습니다.');
  }
  issueChPaywayProxyToken(req, res, entry.adminId);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.send(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CH 결제내역 자동 로그인</title>
<style>
body{margin:0;font-family:Pretendard,Apple SD Gothic Neo,Noto Sans KR,system-ui,sans-serif;background:linear-gradient(135deg,#07140e 0%,#10351f 54%,#04110b 100%);color:#ecfff3;display:grid;place-items:center;min-height:100vh;overflow:hidden}
body:before{content:"";position:fixed;inset:auto -20% -35% -20%;height:70%;background:radial-gradient(circle at 50% 30%,rgba(3,199,90,.22),transparent 62%);filter:blur(18px)}
.box{position:relative;width:min(460px,calc(100vw - 36px));background:rgba(7,20,14,.82);border:1px solid rgba(3,199,90,.32);border-radius:16px;padding:28px;box-shadow:0 22px 70px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(10px)}
.eyebrow{font-size:11px;font-weight:900;letter-spacing:.14em;color:#65ff9f;margin-bottom:12px}.title{font-size:22px;font-weight:900;margin-bottom:8px}.msg{font-size:13px;color:#c6f6d5;line-height:1.65}.bar{height:9px;background:rgba(255,255,255,.1);border:1px solid rgba(3,199,90,.28);border-radius:999px;margin-top:22px;overflow:hidden}.bar span{display:block;height:100%;width:38%;background:linear-gradient(90deg,#03c75a,#8cffb7,#03c75a);border-radius:999px;box-shadow:0 0 24px rgba(3,199,90,.65);animation:load 1.05s ease-in-out infinite}.steps{display:flex;gap:8px;margin-top:16px}.dot{width:7px;height:7px;border-radius:50%;background:#03c75a;opacity:.4;animation:pulse 1.05s ease-in-out infinite}.dot:nth-child(2){animation-delay:.15s}.dot:nth-child(3){animation-delay:.3s}@keyframes load{0%{transform:translateX(-110%)}100%{transform:translateX(270%)}}@keyframes pulse{0%,100%{opacity:.25;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}
</style>
</head>
<body>
<div class="box"><div class="eyebrow">CH PAYWAY</div><div class="title">결제내역 로그인 중</div><div class="msg">보안 세션을 준비하고 있습니다.<br>잠시 후 CH 결제내역 화면으로 이동합니다.</div><div class="bar"><span></span></div><div class="steps"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>
<script>
setTimeout(function(){ location.replace('/api/admin/ch-payway/proxy/home'); }, 850);
</script>
</body>
</html>`);
}));

async function ensureChPaywaySession() {
  if (!CH_PAYWAY_UID || !CH_PAYWAY_PW) {
    const err = new Error('CH_PAYWAY_CREDENTIALS_MISSING');
    err.statusCode = 503;
    throw err;
  }
  const body = new URLSearchParams({
    cmd: 'LOGIN',
    jData: JSON.stringify({ uid: CH_PAYWAY_UID, pw: CH_PAYWAY_PW }),
    rtnType: 'scalar'
  });
  const response = await fetch(`${CH_PAYWAY_BASE_URL}/ajax.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body
  });
  const setCookie = response.headers.get('set-cookie') || '';
  if (setCookie) chPaywayCookieHeader = setCookie.split(';')[0];
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) {}
  if (!response.ok || parsed?.res !== 'OK' || !chPaywayCookieHeader) {
    const err = new Error('CH_PAYWAY_LOGIN_FAILED');
    err.statusCode = 502;
    throw err;
  }
}

function chPaywayProxyUrl(value, currentPath = 'home') {
  const raw = String(value || '').trim();
  if (!raw || /^(#|javascript:|mailto:|tel:|data:)/i.test(raw)) return raw;
  if (raw.startsWith('/api/admin/ch-payway/proxy/')) return raw;
  if (raw.startsWith('api/admin/ch-payway/proxy/')) return `/${raw}`;
  if (/^https?:\/\//i.test(raw) && !raw.toLowerCase().startsWith(`${CH_PAYWAY_BASE_URL}/`)) return raw;
  const base = new URL(`${CH_PAYWAY_BASE_URL}/${String(currentPath || 'home').replace(/^\/+/, '')}`);
  const target = raw.toLowerCase().startsWith(`${CH_PAYWAY_BASE_URL}/`)
    ? new URL(raw)
    : new URL(raw, base);
  if (target.origin !== CH_PAYWAY_BASE_URL) return raw;
  return `/api/admin/ch-payway/proxy/${target.pathname.replace(/^\/+/, '')}${target.search}${target.hash}`;
}

function rewriteChPaywayCss(css, currentPath = '') {
  return String(css || '').replace(/url\((["']?)([^)"']+)\1\)/gi, (match, quote, urlValue) => {
    return `url("${chPaywayProxyUrl(urlValue, currentPath)}")`;
  });
}

function rewriteChPaywayHtml(html, currentPath = 'home') {
  const proxyBase = '/api/admin/ch-payway/proxy/';
  let output = String(html || '')
    .replace(/<(head)([^>]*)>/i, `<$1$2><base href="${proxyBase}">`)
    .replace(/\b(href|src|action)=["']([^"']+)["']/gi, (match, attr, urlValue) => {
      return `${attr}="${chPaywayProxyUrl(urlValue, currentPath)}"`;
    })
    .replace(/url\((["']?)([^)"']+)\1\)/gi, (match, quote, urlValue) => {
      return `url("${chPaywayProxyUrl(urlValue, currentPath)}")`;
    });
  output = output.replace(/location\.href\s*=\s*["']([^"']+)["']/gi, (match, urlValue) => {
    return `location.href="${chPaywayProxyUrl(urlValue, currentPath)}"`;
  });
  output = output.replace(/location\.replace\(["']([^"']+)["']\)/gi, (match, urlValue) => {
    return `location.replace("${chPaywayProxyUrl(urlValue, currentPath)}")`;
  });
  return output;
}

app.all('/api/admin/ch-payway/proxy/*', asyncHandler(async (req, res) => {
  let rawPath = String(req.params[0] || 'home').replace(/^\/+/, '') || 'home';
  const nestedProxyPrefix = 'api/admin/ch-payway/proxy/';
  while (rawPath.startsWith(nestedProxyPrefix)) rawPath = rawPath.slice(nestedProxyPrefix.length) || 'home';
  const isStaticAsset = /^(css|js|img|images|image|font|fonts|assets|upload|uploads)\//i.test(rawPath)
    || /\.(css|js|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|map)$/i.test(rawPath);
  if (!isStaticAsset && !hasValidChPaywayProxyToken(req)) {
    return sendError(res, 401, 'UNAUTHORIZED', 'CH 결제내역 자동 로그인 세션이 만료되었습니다.');
  }
  if (!isStaticAsset) await ensureChPaywaySession();
  const targetUrl = new URL(`${CH_PAYWAY_BASE_URL}/${rawPath}`);
  for (const [key, value] of Object.entries(req.query || {})) {
    if (Array.isArray(value)) value.forEach(item => targetUrl.searchParams.append(key, item));
    else if (value !== undefined) targetUrl.searchParams.set(key, value);
  }
  const headers = {
    'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
    Referer: `${CH_PAYWAY_BASE_URL}/home`
  };
  if (chPaywayCookieHeader && !isStaticAsset) headers.Cookie = chPaywayCookieHeader;
  let body;
  if (!['GET', 'HEAD'].includes(req.method.toUpperCase())) {
    const contentType = String(req.headers['content-type'] || '');
    if (contentType.includes('application/json')) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.body || {});
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      body = new URLSearchParams(req.body || {}).toString();
    }
  }
  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
    redirect: 'manual'
  });
  const setCookie = upstream.headers.get('set-cookie') || '';
  if (setCookie) chPaywayCookieHeader = setCookie.split(';')[0];
  const location = upstream.headers.get('location');
  if (location && upstream.status >= 300 && upstream.status < 400) {
    const nextUrl = location.startsWith('http') ? new URL(location) : new URL(location, CH_PAYWAY_BASE_URL);
    return res.redirect(`/api/admin/ch-payway/proxy/${nextUrl.pathname.replace(/^\/+/, '')}${nextUrl.search}`);
  }
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  res.status(upstream.status);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', contentType);
  if (contentType.includes('text/html')) {
    return res.send(rewriteChPaywayHtml(await upstream.text(), rawPath));
  }
  if (contentType.includes('text/css')) {
    return res.send(rewriteChPaywayCss(await upstream.text(), rawPath));
  }
  const arrayBuffer = await upstream.arrayBuffer();
  return res.send(Buffer.from(arrayBuffer));
}));

app.get('/api/admin/audit-notification-preferences', authenticateAdmin, requireSuperAdmin, asyncHandler(async (req, res) => {
  const rows = await repo.listAuditNotificationPreferences(req.user.id);
  const byCategory = new Map(rows.map(row => [row.category, row]));
  return res.status(200).json({
    success: true,
    data: AUDIT_NOTIFICATION_CATEGORIES.map(category => {
      const saved = byCategory.get(category.key);
      return {
        ...category,
        enabled: saved ? saved.enabled !== false : true,
        updatedAt: saved?.updatedAt || null
      };
    })
  });
}));

app.put('/api/admin/audit-notification-preferences/:category', authenticateAdmin, requireSuperAdmin, asyncHandler(async (req, res) => {
  const category = normalizeAuditNotificationCategory(req.params.category);
  if (!category) {
    return sendError(res, 400, 'INVALID_AUDIT_CATEGORY', '변경 알림 카테고리가 올바르지 않습니다.');
  }
  const enabled = req.body?.enabled !== false;
  const saved = await repo.setAuditNotificationPreference(req.user.id, category, enabled);
  await recordAuditLog(req, {
    action: 'AUDIT_NOTIFICATION_PREFERENCE_UPDATE',
    entityType: 'audit_notification_preference',
    entityId: `${req.user.id}:${category}`,
    entityName: AUDIT_NOTIFICATION_CATEGORIES.find(item => item.key === category)?.label || category,
    beforeData: {},
    afterData: { category, enabled },
    changedFields: ['enabled'],
    force: true
  });
  return res.status(200).json({
    success: true,
    data: {
      ...saved,
      label: AUDIT_NOTIFICATION_CATEGORIES.find(item => item.key === category)?.label || category
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
  await recordAuditLog(req, {
    action: 'ADMIN_PASSWORD_UPDATE',
    entityType: 'admin',
    entityId: user.id,
    entityName: user.name || user.loginId,
    beforeData: { ...pickAdminAuditData(user), password: 'previous' },
    afterData: { ...pickAdminAuditData(updated), password: 'changed' },
    changedFields: ['password'],
    force: true
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
  await recordAuditLog(req, {
    action: 'ADMIN_USER_CREATE',
    entityType: 'admin',
    entityId: created.id,
    entityName: created.name || created.loginId,
    beforeData: {},
    afterData: pickAdminAuditData(created),
    force: true
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
  const beforeAudit = pickAdminAuditData(current);
  const afterAudit = pickAdminAuditData(updated);
  if (fields.passwordHash !== undefined) {
    beforeAudit.password = 'previous';
    afterAudit.password = 'changed';
  }
  await recordAuditLog(req, {
    action: 'ADMIN_USER_UPDATE',
    entityType: 'admin',
    entityId: id,
    entityName: updated.name || current.name || updated.loginId,
    beforeData: beforeAudit,
    afterData: afterAudit
  });
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
  await recordAuditLog(req, {
    action: 'ADMIN_USER_DELETE',
    entityType: 'admin',
    entityId: id,
    entityName: target.name || target.loginId,
    beforeData: pickAdminAuditData(target),
    afterData: pickAdminAuditData(deleted),
    force: true
  });
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
  const [installments, meta] = await Promise.all([
    repo.listInterestFreeInstallments({ policyMonth: req.query.policyMonth }),
    repo.getInstallmentPolicyMeta({ policyMonth: req.query.policyMonth })
  ]);
  return res.status(200).json({ success: true, data: installments, meta });
}));

app.put('/api/admin/installments', authenticateAdmin, asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const policyMonth = req.body?.policyMonth;
  const saved = await repo.replaceInterestFreeInstallments(items, { policyMonth });
  const meta = await repo.replaceInstallmentPolicyMeta(req.body?.meta || {}, { policyMonth });
  return res.status(200).json({ success: true, data: saved, meta });
}));

app.post('/api/admin/installments/copy-previous', authenticateAdmin, asyncHandler(async (req, res) => {
  const result = await repo.copyInterestFreeInstallmentsFromPreviousMonth({
    policyMonth: req.body?.policyMonth || req.query.policyMonth
  });
  if (!result.copied) {
    return sendError(res, 404, 'INSTALLMENT_SOURCE_NOT_FOUND', '복사할 전월 무이자 할부 정책이 없습니다.');
  }
  return res.status(200).json({
    success: true,
    data: result.data,
    meta: result.meta,
    policyMonth: result.policyMonth,
    sourcePolicyMonth: result.sourcePolicyMonth
  });
}));

app.get('/api/admin/pg-providers', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
  const providers = await repo.listPgProviders();
  return res.status(200).json({ success: true, data: providers });
}));

app.post('/api/admin/pg-providers', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
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

app.put('/api/admin/pg-providers/:id', authenticateAdmin, requireSystemAdminOnly, asyncHandler(savePgProviderHandler));
app.patch('/api/admin/pg-providers/:id', authenticateAdmin, requireSystemAdminOnly, asyncHandler(savePgProviderHandler));

app.patch('/api/admin/pg-providers/:id/status', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
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

app.delete('/api/admin/pg-providers/:id', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
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

app.get('/api/admin/pg-assignment-rules', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
  const rules = await repo.listPgAssignmentRules();
  return res.status(200).json({ success: true, data: rules });
}));

app.post('/api/admin/pg-assignment-rules', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
  try {
    const rule = await validatePgAssignmentRule(normalizePgAssignmentRulePayload(req.body || {}));
    const saved = await repo.createPgAssignmentRule(rule);
    await recordAuditLog(req, {
      action: 'PG_ASSIGNMENT_RULE_CREATE',
      entityType: 'pg',
      entityId: saved.id,
      entityName: saved.name || 'PG 자동 배정 규칙',
      beforeData: {},
      afterData: pickPgAssignmentRuleAuditData(saved),
      force: true
    });
    const rules = await repo.listPgAssignmentRules();
    return res.status(201).json({ success: true, data: rules });
  } catch (err) {
    return sendError(res, err.statusCode || 400, err.code || 'BAD_REQUEST', err.message || 'PG 자동 배정 규칙 저장에 실패했습니다.');
  }
}));

async function savePgAssignmentRuleHandler(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '규칙 ID가 올바르지 않습니다.');
  }
  try {
    const rule = await validatePgAssignmentRule(normalizePgAssignmentRulePayload(req.body || {}));
    const beforeRule = (await repo.listPgAssignmentRules()).find(item => Number(item.id) === id);
    const saved = await repo.updatePgAssignmentRule(id, rule);
    if (!saved) {
      return sendError(res, 404, 'PG_ASSIGNMENT_RULE_NOT_FOUND', 'PG 자동 배정 규칙을 찾을 수 없습니다.');
    }
    await recordAuditLog(req, {
      action: 'PG_ASSIGNMENT_RULE_UPDATE',
      entityType: 'pg',
      entityId: saved.id,
      entityName: saved.name || beforeRule?.name || 'PG 자동 배정 규칙',
      beforeData: pickPgAssignmentRuleAuditData(beforeRule),
      afterData: pickPgAssignmentRuleAuditData(saved)
    });
    const rules = await repo.listPgAssignmentRules();
    return res.status(200).json({ success: true, data: rules });
  } catch (err) {
    return sendError(res, err.statusCode || 400, err.code || 'BAD_REQUEST', err.message || 'PG 자동 배정 규칙 저장에 실패했습니다.');
  }
}

app.put('/api/admin/pg-assignment-rules/:id', authenticateAdmin, requireSystemAdminOnly, asyncHandler(savePgAssignmentRuleHandler));
app.patch('/api/admin/pg-assignment-rules/:id', authenticateAdmin, requireSystemAdminOnly, asyncHandler(savePgAssignmentRuleHandler));

app.delete('/api/admin/pg-assignment-rules/:id', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '규칙 ID가 올바르지 않습니다.');
  }
  const deleted = await repo.deletePgAssignmentRule(id);
  if (!deleted) {
    return sendError(res, 404, 'PG_ASSIGNMENT_RULE_NOT_FOUND', 'PG 자동 배정 규칙을 찾을 수 없습니다.');
  }
  await recordAuditLog(req, {
    action: 'PG_ASSIGNMENT_RULE_DELETE',
    entityType: 'pg',
    entityId: deleted.id,
    entityName: deleted.name || 'PG 자동 배정 규칙',
    beforeData: pickPgAssignmentRuleAuditData(deleted),
    afterData: {},
    changedFields: ['deleted'],
    force: true
  });
  const rules = await repo.listPgAssignmentRules();
  return res.status(200).json({ success: true, data: rules });
}));

function normalizeAgencyInquiryPayload(body = {}) {
  const allowedTypes = new Set(['가맹점 등록', '지점/지사 개설', '배달대행사 제휴', '기타 문의']);
  const rawInquiryType = String(body.inquiryType || body.inquiry_type || '지점/지사 개설').trim();
  return {
    inquiryType: allowedTypes.has(rawInquiryType) ? rawInquiryType : '기타 문의',
    name: String(body.name || '').trim(),
    phone: String(body.phone || '').trim(),
    deliveryAgency: String(body.deliveryAgency || body.business || body.currentBusiness || '').trim(),
    region: String(body.region || body.area || '').trim(),
    handler: String(body.handler || body.source || body.referralSource || '').trim(),
    status: String(body.status || '상담 대기').trim()
  };
}

function validateAgencyInquiryPayload(inquiry, requireAll = false) {
  if (!inquiry.name) {
    return '성함 / 회사명은 필수입니다.';
  }
  if (requireAll && (!inquiry.phone || !inquiry.deliveryAgency || !inquiry.region || !inquiry.handler)) {
    return '필수 항목을 모두 입력해주세요.';
  }
  return '';
}

function pickAgencyInquiryAuditData(inquiry) {
  if (!inquiry) return {};
  return {
    id: inquiry.id,
    inquiryType: inquiry.inquiryType || inquiry.inquiry_type || '',
    name: inquiry.name || '',
    phone: inquiry.phone || '',
    deliveryAgency: inquiry.deliveryAgency || inquiry.delivery_agency || '',
    region: inquiry.region || '',
    handler: inquiry.handler || '',
    status: inquiry.status || ''
  };
}

function pickAdvanceInquiryAuditData(inquiry) {
  if (!inquiry) return {};
  return {
    id: inquiry.id,
    userId: inquiry.userId || inquiry.user_id || null,
    franchiseId: inquiry.franchiseId || inquiry.franchise_id || null,
    franchiseName: inquiry.franchiseName || inquiry.franchise_name || '',
    phone: inquiry.phone || '',
    email: inquiry.email || '',
    deliverySalesManwon: inquiry.deliverySalesManwon || inquiry.delivery_sales_manwon || 0,
    deliveryApps: inquiry.deliveryApps || inquiry.delivery_apps || '',
    storeSalesManwon: inquiry.storeSalesManwon || inquiry.store_sales_manwon || 0,
    status: inquiry.status || ''
  };
}

app.post('/api/agency-inquiries', asyncHandler(async (req, res) => {
  const inquiryData = normalizeAgencyInquiryPayload(req.body || {});
  const validationMessage = validateAgencyInquiryPayload(inquiryData, true);
  if (validationMessage) {
    return sendError(res, 400, 'BAD_REQUEST', validationMessage);
  }
  const inquiry = await repo.createAgencyInquiry({
    ...inquiryData,
    status: '상담 대기'
  });
  await recordAuditLog(req, {
    action: 'AGENCY_INQUIRY_CREATE',
    entityType: 'agency_inquiry',
    entityId: inquiry.id,
    entityName: inquiry.name || inquiry.inquiryType || '가맹점/지점 문의',
    beforeData: {},
    afterData: pickAgencyInquiryAuditData(inquiry),
    force: true
  });
  return res.status(201).json({
    success: true,
    data: inquiry,
    message: '문의가 접수되었습니다.'
  });
}));

app.get('/api/admin/inquiries', authenticateAdmin, asyncHandler(async (req, res) => {
  const inquiries = await repo.listAgencyInquiries();
  return res.status(200).json({ success: true, data: inquiries });
}));

app.post('/api/admin/inquiries', authenticateAdmin, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const inquiryData = normalizeAgencyInquiryPayload(body);
  const validationMessage = validateAgencyInquiryPayload(inquiryData, false);
  if (validationMessage) {
    return sendError(res, 400, 'BAD_REQUEST', validationMessage);
  }
  const inquiry = await repo.createAgencyInquiry({
    name: inquiryData.name,
    inquiryType: inquiryData.inquiryType,
    phone: inquiryData.phone,
    deliveryAgency: inquiryData.deliveryAgency,
    region: inquiryData.region,
    handler: inquiryData.handler,
    status: inquiryData.status
  });
  await recordAuditLog(req, {
    action: 'AGENCY_INQUIRY_CREATE',
    entityType: 'agency_inquiry',
    entityId: inquiry.id,
    entityName: inquiry.name || inquiry.inquiryType || '가맹점/지점 문의',
    beforeData: {},
    afterData: pickAgencyInquiryAuditData(inquiry),
    force: true
  });
  return res.status(201).json({ success: true, data: inquiry });
}));

async function updateAdminInquiryHandler(req, res) {
  const id = Number(req.params.id);
  const body = req.body || {};
  const inquiryData = normalizeAgencyInquiryPayload(body);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '문의 ID가 올바르지 않습니다.');
  }
  const validationMessage = validateAgencyInquiryPayload(inquiryData, false);
  if (validationMessage) {
    return sendError(res, 400, 'BAD_REQUEST', validationMessage);
  }
  const beforeInquiry = (await repo.listAgencyInquiries()).find(item => Number(item.id) === id);
  const inquiry = await repo.updateAgencyInquiry(id, {
    name: inquiryData.name,
    inquiryType: inquiryData.inquiryType,
    phone: inquiryData.phone,
    deliveryAgency: inquiryData.deliveryAgency,
    region: inquiryData.region,
    handler: inquiryData.handler,
    status: inquiryData.status
  });
  if (!inquiry) {
    return sendError(res, 404, 'INQUIRY_NOT_FOUND', '문의를 찾을 수 없습니다.');
  }
  await recordAuditLog(req, {
    action: 'AGENCY_INQUIRY_UPDATE',
    entityType: 'agency_inquiry',
    entityId: id,
    entityName: inquiry.name || beforeInquiry?.name || '가맹점/지점 문의',
    beforeData: pickAgencyInquiryAuditData(beforeInquiry),
    afterData: pickAgencyInquiryAuditData(inquiry)
  });
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
  const beforeInquiry = (await repo.listAgencyInquiries()).find(item => Number(item.id) === id);
  const inquiry = await repo.updateAgencyInquiryStatus(id, status);
  if (!inquiry) {
    return sendError(res, 404, 'INQUIRY_NOT_FOUND', '문의를 찾을 수 없습니다.');
  }
  await recordAuditLog(req, {
    action: 'AGENCY_INQUIRY_STATUS_UPDATE',
    entityType: 'agency_inquiry',
    entityId: id,
    entityName: inquiry.name || beforeInquiry?.name || '가맹점/지점 문의',
    beforeData: pickAgencyInquiryAuditData(beforeInquiry),
    afterData: pickAgencyInquiryAuditData(inquiry)
  });
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
  await recordAuditLog(req, {
    action: 'AGENCY_INQUIRY_DELETE',
    entityType: 'agency_inquiry',
    entityId: id,
    entityName: deleted.name || deleted.inquiryType || '가맹점/지점 문의',
    beforeData: pickAgencyInquiryAuditData(deleted),
    afterData: {},
    changedFields: ['deleted'],
    force: true
  });
  return res.status(200).json({ success: true, data: deleted });
}));

function parseManwonAmount(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 0;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAdvanceInquiryPayload(body = {}, user = null) {
  const sessionFranchiseName = user?.franchiseName || user?.franchise_name || '';
  const sessionFranchiseId = user?.franchiseId || user?.franchise_id || null;
  return {
    userId: user?.id || null,
    franchiseId: body.franchiseId || sessionFranchiseId || null,
    franchiseName: String(body.franchiseName || sessionFranchiseName || '').trim(),
    phone: String(body.phone || '').trim(),
    email: String(body.email || '').trim(),
    deliverySalesManwon: parseManwonAmount(body.deliverySalesManwon ?? body.deliverySales ?? body.delivery_sales),
    deliveryApps: String(body.deliveryApps || body.delivery_apps || '').trim(),
    storeSalesManwon: parseManwonAmount(body.storeSalesManwon ?? body.storeSales ?? body.store_sales),
    status: String(body.status || '상담 대기').trim()
  };
}

function validateAdvanceInquiryPayload(inquiry) {
  if (!inquiry.phone) return '신청 전화번호를 입력해주세요.';
  if (!inquiry.deliverySalesManwon && !inquiry.storeSalesManwon) return '예상 매출을 만원 단위로 입력해주세요.';
  return '';
}

app.post('/api/advance-inquiries', authenticate, asyncHandler(async (req, res) => {
  const inquiryData = normalizeAdvanceInquiryPayload(req.body || {}, req.user);
  const validationMessage = validateAdvanceInquiryPayload(inquiryData);
  if (validationMessage) {
    return sendError(res, 400, 'BAD_REQUEST', validationMessage);
  }
  const inquiry = await repo.createAdvanceInquiry({
    ...inquiryData,
    status: '상담 대기'
  });
  await recordAuditLog(req, {
    action: 'ADVANCE_INQUIRY_CREATE',
    entityType: 'advance_inquiry',
    entityId: inquiry.id,
    entityName: inquiry.franchiseName || '선정산 문의',
    beforeData: {},
    afterData: pickAdvanceInquiryAuditData(inquiry),
    force: true
  });
  return res.status(201).json({
    success: true,
    data: inquiry,
    message: '선정산 상담 신청이 접수되었습니다.'
  });
}));

app.get('/api/advance-inquiries/me', authenticate, asyncHandler(async (req, res) => {
  const inquiries = await repo.listAdvanceInquiriesByUser(req.user.id);
  return res.status(200).json({ success: true, data: inquiries });
}));

app.delete('/api/advance-inquiries/:id', authenticate, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '문의 ID가 올바르지 않습니다.');
  }
  const deleted = await repo.deleteAdvanceInquiryByUser(id, req.user.id);
  if (!deleted) {
    return sendError(res, 404, 'ADVANCE_INQUIRY_NOT_FOUND', '취소할 선정산 문의를 찾을 수 없습니다.');
  }
  await recordAuditLog(req, {
    action: 'ADVANCE_INQUIRY_CANCEL',
    entityType: 'advance_inquiry',
    entityId: id,
    entityName: deleted.franchiseName || '선정산 문의',
    beforeData: pickAdvanceInquiryAuditData(deleted),
    afterData: {},
    changedFields: ['cancelled'],
    force: true
  });
  return res.status(200).json({ success: true, data: deleted, message: '선정산 상담 신청이 취소되었습니다.' });
}));

app.get('/api/admin/advance-inquiries', authenticateAdmin, asyncHandler(async (req, res) => {
  const inquiries = await repo.listAdvanceInquiries();
  return res.status(200).json({ success: true, data: inquiries });
}));

app.patch('/api/admin/advance-inquiries/:id/status', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '').trim();
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '문의 ID가 올바르지 않습니다.');
  }
  if (!['상담 대기', '상담중', '상담 완료', '보류'].includes(status)) {
    return sendError(res, 400, 'BAD_REQUEST', '상태는 상담 대기, 상담중, 상담 완료, 보류 중 하나여야 합니다.');
  }
  const beforeInquiry = (await repo.listAdvanceInquiries()).find(item => Number(item.id) === id);
  const inquiry = await repo.updateAdvanceInquiryStatus(id, status);
  if (!inquiry) {
    return sendError(res, 404, 'ADVANCE_INQUIRY_NOT_FOUND', '선정산 문의를 찾을 수 없습니다.');
  }
  await recordAuditLog(req, {
    action: 'ADVANCE_INQUIRY_STATUS_UPDATE',
    entityType: 'advance_inquiry',
    entityId: id,
    entityName: inquiry.franchiseName || beforeInquiry?.franchiseName || '선정산 문의',
    beforeData: pickAdvanceInquiryAuditData(beforeInquiry),
    afterData: pickAdvanceInquiryAuditData(inquiry)
  });
  return res.status(200).json({ success: true, data: inquiry });
}));

app.delete('/api/admin/advance-inquiries/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '문의 ID가 올바르지 않습니다.');
  }
  const deleted = await repo.deleteAdvanceInquiry(id);
  if (!deleted) {
    return sendError(res, 404, 'ADVANCE_INQUIRY_NOT_FOUND', '선정산 문의를 찾을 수 없습니다.');
  }
  await recordAuditLog(req, {
    action: 'ADVANCE_INQUIRY_DELETE',
    entityType: 'advance_inquiry',
    entityId: id,
    entityName: deleted.franchiseName || '선정산 문의',
    beforeData: pickAdvanceInquiryAuditData(deleted),
    afterData: {},
    changedFields: ['deleted'],
    force: true
  });
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
    designDocumentId: Number(body?.designDocumentId || body?.design_document_id) || null,
    startAt: String(body?.startAt || body?.start_at || '').trim(),
    endAt: String(body?.endAt || body?.end_at || '').trim()
  };
}

function normalizeDesignSetColors(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8);
  return String(value || '')
    .split(/[,\n]/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function parseDesignRules(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

function validateDesignSetBody(body, actor = null) {
  const name = String(body?.name || '').trim();
  if (!name) return { error: '디자인시스템 이름은 필수입니다.' };
  return {
    name,
    target: String(body?.target || 'homepage').trim() || 'homepage',
    layout: String(body?.layout || 'banner').trim() || 'banner',
    tone: String(body?.tone || '').trim(),
    colors: normalizeDesignSetColors(body?.colors),
    ctaStyle: String(body?.ctaStyle || body?.cta_style || '').trim(),
    referenceImageUrl: String(body?.referenceImageUrl || body?.reference_image_url || '').trim(),
    promptTemplate: String(body?.promptTemplate || body?.prompt_template || '').trim(),
    designRules: parseDesignRules(body?.designRules || body?.design_rules),
    active: body?.active !== false && body?.active !== 'false',
    createdBy: actor?.id || null
  };
}

function normalizeStudioHex(value, fallback) {
  const color = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : fallback;
}

function normalizeBrandKitSlug(value, fallback = '') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function normalizeStudioAssetUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (!/^\/uploads\/[A-Za-z0-9%._-]+$/.test(url)) {
    const error = new Error('브랜드 로고와 디자인 이미지는 관리자에서 업로드한 파일만 사용할 수 있습니다.');
    error.statusCode = 400;
    throw error;
  }
  return url;
}

function normalizeStudioLinkUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('/')) return url.slice(0, 500);
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    const error = new Error('CTA URL 형식이 올바르지 않습니다.');
    error.statusCode = 400;
    throw error;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const error = new Error('CTA URL은 http 또는 https 주소만 사용할 수 있습니다.');
    error.statusCode = 400;
    throw error;
  }
  return parsed.href.slice(0, 500);
}

function validateBrandKitBody(body, actor = null) {
  const name = String(body?.name || '').trim().slice(0, 80);
  if (!name) return { error: '브랜드 이름은 필수입니다.' };
  const slug = normalizeBrandKitSlug(body?.slug, name);
  if (!slug) return { error: '브랜드 식별자를 입력하세요.' };
  return {
    name,
    slug,
    logoUrl: normalizeStudioAssetUrl(body?.logoUrl || body?.logo_url),
    primaryColor: normalizeStudioHex(body?.primaryColor || body?.primary_color, '#03C75A'),
    secondaryColor: normalizeStudioHex(body?.secondaryColor || body?.secondary_color, '#3D9B35'),
    accentColor: normalizeStudioHex(body?.accentColor || body?.accent_color, '#4FA72E'),
    surfaceColor: normalizeStudioHex(body?.surfaceColor || body?.surface_color, '#FFFFFF'),
    textColor: normalizeStudioHex(body?.textColor || body?.text_color, '#12351B'),
    fontFamily: String(body?.fontFamily || body?.font_family || 'Pretendard').trim().slice(0, 80) || 'Pretendard',
    headingFontFamily: String(body?.headingFontFamily || body?.heading_font_family || body?.fontFamily || 'Pretendard').trim().slice(0, 80) || 'Pretendard',
    defaultCtaLabel: String(body?.defaultCtaLabel || body?.default_cta_label || '').trim().slice(0, 80),
    defaultCtaUrl: normalizeStudioLinkUrl(body?.defaultCtaUrl || body?.default_cta_url),
    contactText: String(body?.contactText || body?.contact_text || '').trim().slice(0, 120),
    active: body?.active !== false && body?.active !== 'false',
    createdBy: actor?.id || null
  };
}

function normalizeDesignDimension(value, fallback) {
  const number = Math.round(Number(value || fallback));
  return Math.max(120, Math.min(number || fallback, 4096));
}

function parseDesignCanvasJson(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (_) {
      const error = new Error('편집 문서 JSON 형식이 올바르지 않습니다.');
      error.statusCode = 400;
      throw error;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('편집 문서 데이터가 올바르지 않습니다.');
    error.statusCode = 400;
    throw error;
  }
  const serialized = JSON.stringify(parsed);
  if (Buffer.byteLength(serialized, 'utf8') > 2 * 1024 * 1024) {
    const error = new Error('편집 문서는 2MB 이하로 저장할 수 있습니다.');
    error.statusCode = 413;
    throw error;
  }
  const canvas = parsed.canvas && typeof parsed.canvas === 'object' ? parsed.canvas : parsed;
  const objects = Array.isArray(canvas.objects) ? canvas.objects : [];
  if (objects.length > 300) {
    const error = new Error('한 디자인에는 오브젝트를 최대 300개까지 사용할 수 있습니다.');
    error.statusCode = 400;
    throw error;
  }
  for (const object of objects) {
    const src = String(object?.src || '').trim();
    if (src && !/^\/(?:uploads|assets)\/[A-Za-z0-9%/._-]+$/.test(src)) {
      const error = new Error('외부 이미지 주소는 편집 문서에 저장할 수 없습니다. 이미지를 업로드해 주세요.');
      error.statusCode = 400;
      throw error;
    }
  }
  return parsed;
}

function validateDesignDocumentBody(body, actor = null, fallbackKind = 'banner') {
  const name = String(body?.name || '').trim().slice(0, 120);
  if (!name) return { error: '디자인 문서 이름은 필수입니다.' };
  const kind = String(body?.kind || fallbackKind || 'banner').trim().toLowerCase();
  if (!['banner', 'popup'].includes(kind)) return { error: '디자인 종류는 배너 또는 팝업이어야 합니다.' };
  const defaultSize = kind === 'popup' ? { width: 720, height: 1280 } : { width: 1440, height: 256 };
  return {
    name,
    kind,
    brandKitId: Number(body?.brandKitId || body?.brand_kit_id) || null,
    width: normalizeDesignDimension(body?.width, defaultSize.width),
    height: normalizeDesignDimension(body?.height, defaultSize.height),
    canvasJson: parseDesignCanvasJson(body?.canvasJson || body?.canvas_json || { schemaVersion: 1, canvas: { objects: [] } }),
    previewUrl: normalizeStudioAssetUrl(body?.previewUrl || body?.preview_url),
    exportUrl: normalizeStudioAssetUrl(body?.exportUrl || body?.export_url),
    exportFormat: String(body?.exportFormat || body?.export_format || '').trim().toLowerCase().slice(0, 12),
    metadata: parseDesignRules(body?.metadata),
    actorId: actor?.id || null
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

function normalizeBannerHexColor(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '';
}

function designSetPalette(style, colors = []) {
  const palette = { ...bannerPalette(style) };
  const safeColors = normalizeDesignSetColors(colors).map(normalizeBannerHexColor).filter(Boolean);
  if (safeColors[0]) {
    palette.accent = safeColors[0];
    palette.accent2 = safeColors[1] || safeColors[0];
  }
  if (safeColors[1]) palette.bg2 = safeColors[1];
  if (safeColors[2]) palette.title = safeColors[2];
  if (safeColors[3]) palette.border = safeColors[3];
  return palette;
}

function renderBannerSvg({ title, subtitle, style, logoDataUrl, colors }) {
  const safeTitle = escapeSvgText(title, 44);
  const safeSubtitle = escapeSvgText(subtitle, 70);
  const palette = designSetPalette(style, colors);
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

function parsePopupTemplate(value, fallback = {}) {
  let parsed = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    parsed = value;
  } else if (value) {
    try {
      parsed = JSON.parse(String(value));
    } catch (_) {
      parsed = {};
    }
  }
  return {
    headerLabel: String(parsed.headerLabel || '선정산').trim(),
    eventLabel: String(parsed.eventLabel || fallback.title || '일주일 이벤트').trim(),
    headlineTop: String(parsed.headlineTop || fallback.subtitle || '어제의 배민·쿠팡이츠 매출').trim(),
    headlineAccent: String(parsed.headlineAccent || '오늘 바로 입금').trim(),
    description: String(parsed.description || '배달 플랫폼 매출을 빠르게 정산받고\n가게 운영 자금 걱정을 줄여보세요.').trim(),
    benefit1Title: String(parsed.benefit1Title || '당일·익일 입금').trim(),
    benefit1Desc: String(parsed.benefit1Desc || '전날 매출을 다음날 빠르게 입금').trim(),
    benefit2Title: String(parsed.benefit2Title || '약정 없이 자유롭게').trim(),
    benefit2Desc: String(parsed.benefit2Desc || '필요한 기간만 부담 없이 이용').trim(),
    benefit3Title: String(parsed.benefit3Title || '투명한 수수료 1.1%').trim(),
    benefit3Desc: String(parsed.benefit3Desc || '부가세 포함 기준으로 안내').trim(),
    benefit4Title: String(parsed.benefit4Title || '신용등급 보호').trim(),
    benefit4Desc: String(parsed.benefit4Desc || '매출 기반으로 운영 자금 확보').trim(),
    platform1: String(parsed.platform1 || '배민').trim(),
    platform2: String(parsed.platform2 || '쿠팡').trim(),
    platform3: String(parsed.platform3 || '요기요').trim(),
    platform4: String(parsed.platform4 || '땡겨요').trim(),
    platform5: String(parsed.platform5 || '카드').trim(),
    ctaText: String(parsed.ctaText || '1분 상담 신청하기').trim(),
    customerText: String(parsed.customerText || '고객센터 1566-3558').trim(),
    hideTodayText: String(parsed.hideTodayText || '오늘 하루 보지 않기').trim(),
    closeText: String(parsed.closeText || '닫기').trim()
  };
}

function renderPopupSvg({ title, subtitle, style, logoDataUrl, colors, popupTemplate }) {
  const popup = parsePopupTemplate(popupTemplate, { title, subtitle });
  const safeTitle = escapeSvgText(popup.eventLabel, 42);
  const safeSubtitle = escapeSvgText(popup.headlineTop, 54);
  const safeAccent = escapeSvgText(popup.headlineAccent, 42);
  const safeDescription = escapeSvgText(popup.description, 90).split(/\n/).slice(0, 2);
  const palette = designSetPalette(style, colors);
  const primary = palette.accent || '#03C75A';
  const dark = palette.title || '#12351B';
  const muted = palette.subtitle || '#667085';
  const logoImage = logoDataUrl
    ? `<image href="${logoDataUrl}" x="54" y="36" width="138" height="58" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="54" y="75" font-family="Pretendard, Arial, sans-serif" font-size="34" font-weight="900" fill="#fff">eats PAY</text>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280" role="img" aria-label="${safeTitle}">
  <rect x="4" y="4" width="712" height="1272" rx="42" fill="#fff" stroke="${palette.border}" stroke-width="2"/>
  <path d="M4 46Q4 4 46 4H674Q716 4 716 46V145H4Z" fill="${primary}"/>
  <g>
    ${logoImage}
    <line x1="218" y1="34" x2="218" y2="96" stroke="#fff" stroke-opacity=".65" stroke-width="3"/>
    <text x="244" y="79" font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, Arial, sans-serif" font-size="42" font-weight="900" fill="#fff">${escapeSvgText(popup.headerLabel, 16)}</text>

    <g font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, Arial, sans-serif">
      <text x="50" y="231" font-size="30" font-weight="900" fill="${primary}">${safeTitle}</text>
      <text x="50" y="302" font-size="50" font-weight="900" fill="${dark}">${safeSubtitle}</text>
      <text x="50" y="362" font-size="50" font-weight="900" fill="${dark}">${safeAccent}</text>
      <text x="50" y="424" font-size="24" font-weight="800" fill="${muted}">${safeDescription[0] || ''}</text>
      <text x="50" y="462" font-size="24" font-weight="800" fill="${muted}">${safeDescription[1] || ''}</text>

      <rect x="50" y="514" width="620" height="354" rx="26" fill="#EEF9F1"/>
      <g font-size="22" font-weight="900" fill="${dark}">
        <circle cx="88" cy="568" r="17" fill="#fff"/><path d="M80 568l6 7 13-17" fill="none" stroke="${primary}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="122" y="575">${escapeSvgText(popup.benefit1Title, 26)}</text><text x="122" y="607" font-size="17" font-weight="800" fill="${muted}">${escapeSvgText(popup.benefit1Desc, 38)}</text>
        <circle cx="88" cy="652" r="17" fill="#fff"/><path d="M80 652l6 7 13-17" fill="none" stroke="${primary}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="122" y="659">${escapeSvgText(popup.benefit2Title, 26)}</text><text x="122" y="691" font-size="17" font-weight="800" fill="${muted}">${escapeSvgText(popup.benefit2Desc, 38)}</text>
        <circle cx="88" cy="736" r="17" fill="#fff"/><path d="M80 736l6 7 13-17" fill="none" stroke="${primary}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="122" y="743">${escapeSvgText(popup.benefit3Title, 26)}</text><text x="122" y="775" font-size="17" font-weight="800" fill="${muted}">${escapeSvgText(popup.benefit3Desc, 38)}</text>
        <circle cx="88" cy="820" r="17" fill="#fff"/><path d="M80 820l6 7 13-17" fill="none" stroke="${primary}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="122" y="827">${escapeSvgText(popup.benefit4Title, 26)}</text><text x="122" y="859" font-size="17" font-weight="800" fill="${muted}">${escapeSvgText(popup.benefit4Desc, 38)}</text>
      </g>

      <text x="50" y="928" font-size="18" font-weight="900" fill="#98A2B3">정산 대상</text>
      <g font-size="17" font-weight="900" fill="${dark}" text-anchor="middle">
        <rect x="50" y="952" width="112" height="86" rx="16" fill="#F8FAFC" stroke="#D1D5DB" stroke-dasharray="6 4"/><text x="106" y="1004">${escapeSvgText(popup.platform1, 8)}</text>
        <rect x="183" y="952" width="112" height="86" rx="16" fill="#F8FAFC" stroke="#D1D5DB" stroke-dasharray="6 4"/><text x="239" y="1004">${escapeSvgText(popup.platform2, 8)}</text>
        <rect x="316" y="952" width="112" height="86" rx="16" fill="#F8FAFC" stroke="#D1D5DB" stroke-dasharray="6 4"/><text x="372" y="1004">${escapeSvgText(popup.platform3, 8)}</text>
        <rect x="449" y="952" width="112" height="86" rx="16" fill="#F8FAFC" stroke="#D1D5DB" stroke-dasharray="6 4"/><text x="505" y="1004">${escapeSvgText(popup.platform4, 8)}</text>
        <rect x="582" y="952" width="88" height="86" rx="16" fill="#F8FAFC" stroke="#D1D5DB" stroke-dasharray="6 4"/><text x="626" y="1004">${escapeSvgText(popup.platform5, 8)}</text>
      </g>

      <rect x="50" y="1076" width="620" height="86" rx="18" fill="${primary}"/>
      <text x="360" y="1131" text-anchor="middle" font-size="27" font-weight="900" fill="#fff">${escapeSvgText(popup.ctaText, 24)}</text>
      <text x="360" y="1197" text-anchor="middle" font-size="20" font-weight="900" fill="${muted}">${escapeSvgText(popup.customerText, 34)}</text>
      <line x1="4" y1="1232" x2="716" y2="1232" stroke="#EEF0F3" stroke-width="2"/>
      <rect x="52" y="1250" width="13" height="13" fill="#fff" stroke="#94A3B8" stroke-width="2"/>
      <text x="74" y="1264" font-size="18" font-weight="800" fill="#98A2B3">${escapeSvgText(popup.hideTodayText, 22)}</text>
      <text x="672" y="1264" text-anchor="end" font-size="18" font-weight="900" fill="#98A2B3">${escapeSvgText(popup.closeText, 10)}×</text>
    </g>
  </g>
</svg>`;
}

async function saveGeneratedBannerImage({ title, subtitle, style, file, colors, layout, popupTemplate }) {
  const isImage = file && ['image/png', 'image/jpeg', 'image/jpg'].includes(String(file.mimetype || '').toLowerCase());
  if (file && !isImage) {
    const error = new Error('로고 파일은 PNG 또는 JPG만 사용할 수 있습니다.');
    error.statusCode = 400;
    throw error;
  }
  const logoDataUrl = file ? `data:${file.mimetype};base64,${file.buffer.toString('base64')}` : '';
  const isPopup = String(layout || '').trim().toLowerCase() === 'popup';
  const svg = isPopup
    ? renderPopupSvg({ title, subtitle, style, logoDataUrl, colors, popupTemplate })
    : renderBannerSvg({ title, subtitle, style, logoDataUrl, colors });
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const slug = String(title || (isPopup ? 'popup' : 'banner')).trim().toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 24) || (isPopup ? 'popup' : 'banner');
  const filename = `${isPopup ? 'popup' : 'banner'}-${Date.now()}-${crypto.randomUUID()}-${slug}.svg`;
  await fs.promises.writeFile(path.join(uploadDir, filename), svg, 'utf8');
  return `/uploads/${encodeURIComponent(filename)}`;
}

async function saveUploadedBannerImage(file) {
  const mimeType = String(file?.mimetype || '').toLowerCase();
  const isImage = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(mimeType);
  if (!file || !isImage) {
    const error = new Error('배너 이미지는 PNG, JPG, WEBP, GIF 파일만 업로드할 수 있습니다.');
    error.statusCode = 400;
    throw error;
  }
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const ext = path.extname(file.originalname || '').toLowerCase() || (
    mimeType === 'image/png' ? '.png'
      : mimeType === 'image/webp' ? '.webp'
        : mimeType === 'image/gif' ? '.gif'
          : '.jpg'
  );
  const filename = `banner-upload-${Date.now()}-${crypto.randomUUID()}${ext}`;
  await fs.promises.writeFile(path.join(uploadDir, filename), file.buffer);
  return `/uploads/${encodeURIComponent(filename)}`;
}

async function saveUploadedAnnouncementImage(file) {
  const mimeType = String(file?.mimetype || '').toLowerCase();
  const isImage = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(mimeType);
  if (!file || !isImage) {
    const error = new Error('알림장 이미지는 PNG, JPG, WEBP 파일만 업로드할 수 있습니다.');
    error.statusCode = 400;
    throw error;
  }
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const ext = path.extname(file.originalname || '').toLowerCase() || (
    mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg'
  );
  const filename = `announcement-${Date.now()}-${crypto.randomUUID()}${ext}`;
  await fs.promises.writeFile(path.join(uploadDir, filename), file.buffer);
  return `/uploads/${encodeURIComponent(filename)}`;
}

const HOMEPAGE_ANALYTICS_EVENTS = new Set([
  'page_view',
  'app_download_click',
  'partner_inquiry_submit_click',
  'partner_inquiry_submit_success',
  'naver_talk_click',
  'phone_click',
  'popup_cta_click'
]);

function limitAnalyticsText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function normalizeHomepageAnalyticsBody(body = {}, req) {
  const eventName = limitAnalyticsText(body.eventName || body.event_name, 80);
  if (!HOMEPAGE_ANALYTICS_EVENTS.has(eventName)) {
    const error = new Error('지원하지 않는 홈페이지 이벤트입니다.');
    error.statusCode = 400;
    throw error;
  }
  const referrer = limitAnalyticsText(body.referrer, 500);
  let referrerHost = limitAnalyticsText(body.referrerHost || body.referrer_host, 120).toLowerCase();
  if (!referrerHost && referrer) {
    try {
      referrerHost = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();
    } catch (_) {
      referrerHost = '';
    }
  }
  const pagePath = limitAnalyticsText(body.pagePath || body.page_path || '/', 240) || '/';
  const rawIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const ipHash = rawIp
    ? crypto.createHash('sha256').update(`${process.env.EATSPAY_HMAC_SECRET}:${rawIp}`).digest('hex')
    : '';
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  return {
    eventName,
    visitorId: limitAnalyticsText(body.visitorId || body.visitor_id, 80),
    sessionId: limitAnalyticsText(body.sessionId || body.session_id, 80),
    pagePath,
    pageTitle: limitAnalyticsText(body.pageTitle || body.page_title, 160),
    eventLabel: limitAnalyticsText(body.eventLabel || body.event_label, 160),
    linkUrl: limitAnalyticsText(body.linkUrl || body.link_url, 500),
    referrer,
    referrerHost,
    utmSource: limitAnalyticsText(body.utmSource || body.utm_source, 80),
    utmMedium: limitAnalyticsText(body.utmMedium || body.utm_medium, 80),
    utmCampaign: limitAnalyticsText(body.utmCampaign || body.utm_campaign, 120),
    deviceType: limitAnalyticsText(body.deviceType || body.device_type, 40),
    browserLanguage: limitAnalyticsText(body.browserLanguage || body.browser_language, 40),
    screenSize: limitAnalyticsText(body.screenSize || body.screen_size, 40),
    ipHash,
    userAgent: limitAnalyticsText(req.headers['user-agent'], 500),
    metadata: {
      ...metadata,
      source: limitAnalyticsText(metadata.source || 'homepage', 40)
    }
  };
}

app.post('/api/homepage/analytics/events', asyncHandler(async (req, res) => {
  const event = normalizeHomepageAnalyticsBody(req.body || {}, req);
  await repo.recordHomepageAnalyticsEvent(event);
  return res.status(201).json({ success: true });
}));

app.get('/api/admin/homepage-analytics', authenticateAdmin, asyncHandler(async (req, res) => {
  const data = await repo.getHomepageAnalyticsSummary({ days: req.query.days });
  return res.status(200).json({ success: true, data });
}));

app.get('/api/admin/banners', authenticateAdmin, asyncHandler(async (req, res) => {
  const banners = await repo.listBanners({ includeInactive: true });
  return res.status(200).json({ success: true, data: banners });
}));

app.get('/api/admin/design-sets', authenticateAdmin, asyncHandler(async (req, res) => {
  const designSets = await repo.listDesignSets({ includeInactive: true });
  return res.status(200).json({ success: true, data: designSets });
}));

app.post('/api/admin/design-sets', authenticateAdmin, asyncHandler(async (req, res) => {
  const body = validateDesignSetBody(req.body, req.user);
  if (body.error) {
    return sendError(res, 400, 'BAD_REQUEST', body.error);
  }
  const designSet = await repo.createDesignSet(body);
  return res.status(201).json({ success: true, data: designSet });
}));

async function updateAdminDesignSetHandler(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '디자인시스템 ID가 올바르지 않습니다.');
  }
  const body = validateDesignSetBody(req.body, req.user);
  if (body.error) {
    return sendError(res, 400, 'BAD_REQUEST', body.error);
  }
  const designSet = await repo.updateDesignSet(id, body);
  if (!designSet) {
    return sendError(res, 404, 'DESIGN_SET_NOT_FOUND', '디자인시스템을 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: designSet });
}

app.put('/api/admin/design-sets/:id', authenticateAdmin, asyncHandler(updateAdminDesignSetHandler));
app.patch('/api/admin/design-sets/:id', authenticateAdmin, asyncHandler(updateAdminDesignSetHandler));

app.delete('/api/admin/design-sets/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '디자인시스템 ID가 올바르지 않습니다.');
  }
  const deleted = await repo.deleteDesignSet(id);
  if (!deleted) {
    return sendError(res, 404, 'DESIGN_SET_NOT_FOUND', '디자인시스템을 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: deleted });
}));

app.post('/api/admin/design-sets/upload-reference-image', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  let imageUrl = '';
  try {
    imageUrl = await saveUploadedBannerImage(req.file);
  } catch (err) {
    return sendError(res, err.statusCode || 400, 'BAD_REQUEST', err.message || '참고 이미지 업로드에 실패했습니다.');
  }
  return res.status(201).json({
    success: true,
    data: {
      imageUrl,
      source: 'design-system-reference'
    }
  });
}));

app.get('/api/admin/brand-kits', authenticateAdmin, asyncHandler(async (req, res) => {
  const brandKits = await repo.listBrandKits({ includeInactive: true });
  return res.status(200).json({ success: true, data: brandKits });
}));

app.post('/api/admin/brand-kits', authenticateAdmin, asyncHandler(async (req, res) => {
  const body = validateBrandKitBody(req.body, req.user);
  if (body.error) return sendError(res, 400, 'BAD_REQUEST', body.error);
  let brandKit;
  try {
    brandKit = await repo.createBrandKit(body);
  } catch (err) {
    if (err?.code === '23505') return sendError(res, 409, 'BRAND_KIT_SLUG_EXISTS', '이미 사용 중인 브랜드 식별자입니다.');
    throw err;
  }
  await recordAuditLog(req, { action: 'BRAND_KIT_CREATE', entityType: 'brand_kit', entityId: brandKit.id, entityName: brandKit.name, beforeData: {}, afterData: brandKit, force: true });
  return res.status(201).json({ success: true, data: brandKit });
}));

async function updateAdminBrandKitHandler(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return sendError(res, 400, 'BAD_REQUEST', '브랜드 키트 ID가 올바르지 않습니다.');
  const before = await repo.getBrandKit(id);
  if (!before) return sendError(res, 404, 'BRAND_KIT_NOT_FOUND', '브랜드 키트를 찾을 수 없습니다.');
  const body = validateBrandKitBody(req.body, req.user);
  if (body.error) return sendError(res, 400, 'BAD_REQUEST', body.error);
  let brandKit;
  try {
    brandKit = await repo.updateBrandKit(id, body);
  } catch (err) {
    if (err?.code === '23505') return sendError(res, 409, 'BRAND_KIT_SLUG_EXISTS', '이미 사용 중인 브랜드 식별자입니다.');
    throw err;
  }
  await recordAuditLog(req, { action: 'BRAND_KIT_UPDATE', entityType: 'brand_kit', entityId: id, entityName: brandKit.name, beforeData: before, afterData: brandKit });
  return res.status(200).json({ success: true, data: brandKit });
}

app.put('/api/admin/brand-kits/:id', authenticateAdmin, asyncHandler(updateAdminBrandKitHandler));
app.patch('/api/admin/brand-kits/:id', authenticateAdmin, asyncHandler(updateAdminBrandKitHandler));

app.delete('/api/admin/brand-kits/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return sendError(res, 400, 'BAD_REQUEST', '브랜드 키트 ID가 올바르지 않습니다.');
  const usageCount = await repo.countBrandKitDesignDocuments(id);
  if (usageCount > 0) return sendError(res, 409, 'BRAND_KIT_IN_USE', `이 브랜드 키트를 사용하는 디자인 ${usageCount}개가 있어 삭제할 수 없습니다.`);
  const deleted = await repo.deleteBrandKit(id);
  if (!deleted) return sendError(res, 404, 'BRAND_KIT_NOT_FOUND', '브랜드 키트를 찾을 수 없습니다.');
  await recordAuditLog(req, { action: 'BRAND_KIT_DELETE', entityType: 'brand_kit', entityId: id, entityName: deleted.name, beforeData: deleted, afterData: {}, changedFields: ['deleted'], force: true });
  return res.status(200).json({ success: true, data: deleted });
}));

app.get('/api/admin/design-documents', authenticateAdmin, asyncHandler(async (req, res) => {
  const documents = await repo.listDesignDocuments({ kind: String(req.query.kind || '').trim(), brandKitId: Number(req.query.brandKitId) || null, includeArchived: String(req.query.includeArchived || '').toLowerCase() === 'true' });
  return res.status(200).json({ success: true, data: documents });
}));

app.get('/api/admin/design-documents/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return sendError(res, 400, 'BAD_REQUEST', '디자인 문서 ID가 올바르지 않습니다.');
  const document = await repo.getDesignDocument(id);
  if (!document) return sendError(res, 404, 'DESIGN_DOCUMENT_NOT_FOUND', '디자인 문서를 찾을 수 없습니다.');
  return res.status(200).json({ success: true, data: document });
}));

app.post('/api/admin/design-documents', authenticateAdmin, asyncHandler(async (req, res) => {
  const body = validateDesignDocumentBody(req.body, req.user);
  if (body.error) return sendError(res, 400, 'BAD_REQUEST', body.error);
  if (body.brandKitId && !(await repo.getBrandKit(body.brandKitId))) return sendError(res, 400, 'BRAND_KIT_NOT_FOUND', '선택한 브랜드 키트를 찾을 수 없습니다.');
  const document = await repo.createDesignDocument(body);
  await recordAuditLog(req, { action: 'DESIGN_DOCUMENT_CREATE', entityType: 'design_document', entityId: document.id, entityName: document.name, beforeData: {}, afterData: { name: document.name, kind: document.kind, brandKitId: document.brandKitId, version: document.version }, force: true });
  return res.status(201).json({ success: true, data: document });
}));

app.put('/api/admin/design-documents/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return sendError(res, 400, 'BAD_REQUEST', '디자인 문서 ID가 올바르지 않습니다.');
  const before = await repo.getDesignDocument(id);
  if (!before) return sendError(res, 404, 'DESIGN_DOCUMENT_NOT_FOUND', '디자인 문서를 찾을 수 없습니다.');
  const body = validateDesignDocumentBody(req.body, req.user, before.kind);
  if (body.error) return sendError(res, 400, 'BAD_REQUEST', body.error);
  if (body.brandKitId && !(await repo.getBrandKit(body.brandKitId))) return sendError(res, 400, 'BRAND_KIT_NOT_FOUND', '선택한 브랜드 키트를 찾을 수 없습니다.');
  const document = await repo.saveDesignDocument(id, body);
  if (!document) return sendError(res, 404, 'DESIGN_DOCUMENT_NOT_FOUND', '디자인 문서를 찾을 수 없습니다.');
  await recordAuditLog(req, { action: 'DESIGN_DOCUMENT_SAVE', entityType: 'design_document', entityId: id, entityName: document.name, beforeData: { name: before.name, version: before.version }, afterData: { name: document.name, version: document.version }, force: true });
  return res.status(200).json({ success: true, data: document });
}));

app.patch('/api/admin/design-documents/:id/autosave', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return sendError(res, 400, 'BAD_REQUEST', '디자인 문서 ID가 올바르지 않습니다.');
  const before = await repo.getDesignDocument(id);
  if (!before) return sendError(res, 404, 'DESIGN_DOCUMENT_NOT_FOUND', '디자인 문서를 찾을 수 없습니다.');
  const body = validateDesignDocumentBody(req.body, req.user, before.kind);
  if (body.error) return sendError(res, 400, 'BAD_REQUEST', body.error);
  const document = await repo.autosaveDesignDocument(id, body);
  return res.status(200).json({ success: true, data: document });
}));

app.delete('/api/admin/design-documents/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return sendError(res, 400, 'BAD_REQUEST', '디자인 문서 ID가 올바르지 않습니다.');
  const archived = await repo.archiveDesignDocument(id, req.user?.id || null);
  if (!archived) return sendError(res, 404, 'DESIGN_DOCUMENT_NOT_FOUND', '디자인 문서를 찾을 수 없습니다.');
  return res.status(200).json({ success: true, data: archived });
}));

app.get('/api/admin/design-documents/:id/versions', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return sendError(res, 400, 'BAD_REQUEST', '디자인 문서 ID가 올바르지 않습니다.');
  const document = await repo.getDesignDocument(id);
  if (!document) return sendError(res, 404, 'DESIGN_DOCUMENT_NOT_FOUND', '디자인 문서를 찾을 수 없습니다.');
  const versions = await repo.listDesignDocumentVersions(id);
  return res.status(200).json({ success: true, data: versions });
}));

app.post('/api/admin/design-documents/:id/restore/:version', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const version = Number(req.params.version);
  if (!Number.isFinite(id) || !Number.isFinite(version)) return sendError(res, 400, 'BAD_REQUEST', '디자인 문서 또는 버전 번호가 올바르지 않습니다.');
  const document = await repo.restoreDesignDocumentVersion(id, version, req.user?.id || null);
  if (!document) return sendError(res, 404, 'DESIGN_VERSION_NOT_FOUND', '복원할 디자인 버전을 찾을 수 없습니다.');
  await recordAuditLog(req, { action: 'DESIGN_DOCUMENT_RESTORE', entityType: 'design_document', entityId: id, entityName: document.name, beforeData: { restoredFromVersion: version }, afterData: { version: document.version }, force: true });
  return res.status(200).json({ success: true, data: document });
}));

app.post('/api/admin/design-documents/:id/export', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return sendError(res, 400, 'BAD_REQUEST', '디자인 문서 ID가 올바르지 않습니다.');
  const document = await repo.getDesignDocument(id);
  if (!document) return sendError(res, 404, 'DESIGN_DOCUMENT_NOT_FOUND', '디자인 문서를 찾을 수 없습니다.');
  const mimeType = String(req.file?.mimetype || '').toLowerCase();
  if (!['image/png', 'image/webp'].includes(mimeType)) return sendError(res, 400, 'BAD_REQUEST', '디자인 내보내기는 PNG 또는 WebP만 지원합니다.');
  const exportUrl = await saveUploadedBannerImage(req.file);
  const exportFormat = mimeType === 'image/webp' ? 'webp' : 'png';
  const updated = await repo.updateDesignDocumentExport(id, { previewUrl: exportUrl, exportUrl, exportFormat, actorId: req.user?.id || null });
  await recordAuditLog(req, { action: 'DESIGN_DOCUMENT_EXPORT', entityType: 'design_document', entityId: id, entityName: updated.name, beforeData: { exportUrl: document.exportUrl || '' }, afterData: { exportUrl, exportFormat }, force: true });
  return res.status(201).json({ success: true, data: updated });
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
    colors: normalizeDesignSetColors(req.body?.colors),
    layout: String(req.body?.layout || '').trim(),
    popupTemplate: parsePopupTemplate(req.body?.popupTemplateJson || req.body?.popup_template_json, { title, subtitle: String(req.body?.subtitle || '').trim() }),
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

app.post('/api/admin/banners/upload-image', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  let imageUrl = '';
  try {
    imageUrl = await saveUploadedBannerImage(req.file);
  } catch (err) {
    return sendError(res, err.statusCode || 400, 'BAD_REQUEST', err.message || '배너 이미지 업로드에 실패했습니다.');
  }
  return res.status(201).json({
    success: true,
    data: {
      imageUrl,
      source: 'uploaded-image'
    }
  });
}));

app.patch('/api/admin/banners/order', authenticateAdmin, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) {
    return sendError(res, 400, 'BAD_REQUEST', '배너 순서 정보가 올바르지 않습니다.');
  }
  const banners = await repo.updateBannerOrder(ids);
  return res.status(200).json({ success: true, data: banners });
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
  return ['notices', 'guides', 'announcements'].includes(type) ? type : '';
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

function normalizeBoardImageUrls(body = {}) {
  const source = Array.isArray(body.imageUrls) ? body.imageUrls : body.image_urls;
  return (Array.isArray(source) ? source : [])
    .map(value => String(value || '').trim())
    .filter(value => /^\/(?:uploads|assets\/announcements)\//.test(value))
    .slice(0, 1);
}

function validateBoardPostBody(body) {
  const title = String(body?.title || '').trim();
  const author = String(body?.author || '운영팀').trim() || '운영팀';
  const content = String(body?.content || '').trim();
  if (!title || !content) {
    return { error: '제목과 내용은 필수입니다.' };
  }
  return { title, author, content, imageUrls: normalizeBoardImageUrls(body) };
}

app.get('/api/boards/:type', optionalAuthenticate, asyncHandler(async (req, res) => {
  const boardType = normalizeBoardType(req.params.type);
  if (!boardType) {
    return sendError(res, 400, 'INVALID_BOARD_TYPE', '게시판 유형이 올바르지 않습니다.');
  }
  const posts = await repo.listBoardPosts(boardType, {
    includeInactive: false,
    limit: Math.min(Number(req.query.limit) || 50, 100),
    viewerUserId: req.user?.id || null
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

app.get('/api/announcements', optionalAuthenticate, asyncHandler(async (req, res) => {
  const posts = await repo.listBoardPosts('announcements', {
    includeInactive: false,
    limit: Math.min(Number(req.query.limit) || 50, 100),
    viewerUserId: req.user?.id || null,
    orderBy: 'recent'
  });
  return res.status(200).json({ success: true, data: posts });
}));

app.post('/api/announcements/:id/view', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '알림장 글 정보가 올바르지 않습니다.');
  }
  const post = await repo.findBoardPostById('announcements', id);
  if (!post || post.active === false) {
    return sendError(res, 404, 'BOARD_POST_NOT_FOUND', '알림장 글을 찾을 수 없습니다.');
  }
  const viewCount = await repo.incrementBoardPostView('announcements', id);
  return res.status(200).json({ success: true, data: { viewCount } });
}));

app.get('/api/announcements/:id/like', authenticate, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '알림장 글 정보가 올바르지 않습니다.');
  }
  const state = await repo.getBoardPostLikeState('announcements', id, req.user.id);
  if (!state) {
    return sendError(res, 404, 'BOARD_POST_NOT_FOUND', '알림장 글을 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: state });
}));

app.post('/api/announcements/:id/like', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role === 'AGENCY') {
    return sendError(res, 403, 'ACCESS_DENIED', '대리점 계정은 관심 등록을 이용할 수 없습니다.');
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '알림장 글 정보가 올바르지 않습니다.');
  }
  const state = await repo.toggleBoardPostLike('announcements', id, req.user.id);
  if (!state) {
    return sendError(res, 404, 'BOARD_POST_NOT_FOUND', '알림장 글을 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: state });
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

app.patch('/api/admin/boards/:type/order', authenticateAdmin, asyncHandler(async (req, res) => {
  const boardType = normalizeBoardType(req.params.type);
  const id = Number(req.body?.id);
  const direction = Number(req.body?.direction);
  if (!boardType || !Number.isFinite(id) || !Number.isFinite(direction) || direction === 0) {
    return sendError(res, 400, 'BAD_REQUEST', '게시글 순서 정보가 올바르지 않습니다.');
  }
  const post = await repo.reorderBoardPost(boardType, id, direction);
  if (!post) {
    return sendError(res, 404, 'BOARD_POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
  }
  return res.status(200).json({ success: true, data: post });
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

app.get('/api/admin/talk/posts', authenticateAdmin, asyncHandler(async (req, res) => {
  const status = String(req.query.status || 'ALL').trim().toUpperCase();
  const normalizedStatus = ['ALL', 'ACTIVE', 'DELETED', 'REPORTS'].includes(status) ? status : 'ALL';
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const offset = (page - 1) * limit;
  const result = await repo.listAdminTalkPosts({
    status: normalizedStatus,
    q: String(req.query.q || '').trim(),
    limit,
    offset
  });
  const posts = Array.isArray(result) ? result : (result.rows || []);
  const total = Array.isArray(result) ? posts.length : Number(result.total || 0);
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  return res.status(200).json({
    success: true,
    data: posts.map(post => ({
      ...post,
      createdAtLabel: formatKstDateTime(post.createdAt)
    })),
    meta: {
      page,
      pageSize: limit,
      total,
      totalPages
    }
  });
}));

app.delete('/api/admin/talk/posts/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '이츠톡 글 정보가 올바르지 않습니다.');
  }
  const beforePost = await repo.findAdminTalkPostById(id);
  if (!beforePost || beforePost.status === 'DELETED') {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', '이츠톡 글을 찾을 수 없습니다.');
  }
  const reason = String(req.body?.reason || '관리자 삭제').trim().slice(0, 200) || '관리자 삭제';
  const deleted = await repo.deleteTalkPostByAdmin(id, {
    reason,
    adminUserId: req.user?.id || null
  });
  await recordAuditLog(req, {
    action: 'TALK_POST_DELETE',
    entityType: 'talk_post',
    entityId: id,
    entityName: beforePost.title || '',
    beforeData: {
      id: beforePost.id,
      title: beforePost.title,
      franchiseName: beforePost.franchiseName,
      status: beforePost.status,
      adminDeletedReason: beforePost.adminDeletedReason || ''
    },
    afterData: {
      id: deleted.id,
      title: deleted.title,
      franchiseName: deleted.franchiseName,
      status: deleted.status,
      adminDeletedReason: deleted.adminDeletedReason || reason,
      adminDeletedAt: deleted.adminDeletedAt || null
    },
    changedFields: ['status', 'adminDeletedReason', 'adminDeletedAt']
  });
  return res.status(200).json({
    success: true,
    data: {
      ...deleted,
      createdAtLabel: formatKstDateTime(deleted.createdAt)
    }
  });
}));

app.patch('/api/admin/talk/posts/:id/restore', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '이츠톡 글 정보가 올바르지 않습니다.');
  }
  const beforePost = await repo.findAdminTalkPostById(id);
  if (!beforePost || beforePost.status !== 'DELETED') {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', '복구할 이츠톡 글을 찾을 수 없습니다.');
  }
  const restored = await repo.restoreTalkPostByAdmin(id);
  await recordAuditLog(req, {
    action: 'TALK_POST_RESTORE',
    entityType: 'talk_post',
    entityId: id,
    entityName: beforePost.title || '',
    beforeData: {
      id: beforePost.id,
      title: beforePost.title,
      franchiseName: beforePost.franchiseName,
      status: beforePost.status,
      adminDeletedReason: beforePost.adminDeletedReason || ''
    },
    afterData: {
      id: restored.id,
      title: restored.title,
      franchiseName: restored.franchiseName,
      status: restored.status,
      adminDeletedReason: restored.adminDeletedReason || ''
    },
    changedFields: ['status', 'adminDeletedReason', 'adminDeletedAt']
  });
  return res.status(200).json({
    success: true,
    data: {
      ...restored,
      createdAtLabel: formatKstDateTime(restored.createdAt)
    }
  });
}));

app.post('/api/admin/talk/posts/:id/hide-author', authenticateAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return sendError(res, 400, 'BAD_REQUEST', '이츠톡 글 정보가 올바르지 않습니다.');
  }
  const beforePost = await repo.findAdminTalkPostById(id);
  if (!beforePost || !beforePost.userId) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', '작성자를 확인할 수 없습니다.');
  }
  const reason = String(req.body?.reason || '작성자 전체 글 숨김').trim().slice(0, 200) || '작성자 전체 글 숨김';
  const affected = await repo.hideTalkPostsByAuthor({
    postId: id,
    reason,
    adminUserId: req.user?.id || null
  });
  if (!affected.length) {
    return sendError(res, 404, 'TALK_POST_NOT_FOUND', '숨김 처리할 노출 글이 없습니다.');
  }
  await recordAuditLog(req, {
    action: 'TALK_AUTHOR_HIDE',
    entityType: 'talk_author',
    entityId: beforePost.userId,
    entityName: beforePost.franchiseName || beforePost.title || '',
    beforeData: {
      userId: beforePost.userId,
      sourcePostId: beforePost.id,
      franchiseName: beforePost.franchiseName,
      reason: ''
    },
    afterData: {
      userId: beforePost.userId,
      sourcePostId: beforePost.id,
      hiddenPostIds: affected.map(post => post.id),
      hiddenCount: affected.length,
      reason
    },
    changedFields: ['status', 'adminDeletedReason', 'hiddenCount']
  });
  return res.status(200).json({
    success: true,
    data: affected.map(post => ({
      ...post,
      createdAtLabel: formatKstDateTime(post.createdAt)
    }))
  });
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
  const { name, loginId, type, level, region, owner, phone, feeRate, parentId, deliveryNote, password } = req.body || {};
  if (!String(name || '').trim()) {
    return sendError(res, 400, 'BAD_REQUEST', 'name is required.');
  }
  const initialPassword = String(password || '').trim();
  const agencyKind = normalizeAdminAgencyKind(type, level);

  let agency = await repo.createAgency({
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
    passwordHash: initialPassword ? await hashPassword(initialPassword) : null,
    joinCode: null
  });
  const friendlyJoinCode = await createUniqueFriendlyAgencyJoinCode(agency.id);
  if (friendlyJoinCode) {
    agency = await repo.updateAgencyJoinCode(agency.id, friendlyJoinCode) || {
      ...agency,
      joinCode: friendlyJoinCode
    };
  }
  await recordAuditLog(req, {
    action: 'AGENCY_CREATE',
    entityType: 'agency',
    entityId: agency.id,
    entityName: agency.name,
    beforeData: {},
    afterData: pickAgencyAuditData(agency),
    force: true
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

  const agencies = await repo.listAgencies();
  const beforeAgency = agencies.find(item => Number(item.id) === agencyId);
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
  const beforeAudit = pickAgencyAuditData(beforeAgency);
  const afterAudit = pickAgencyAuditData(agency);
  if (nextPassword) {
    beforeAudit.password = 'previous';
    afterAudit.password = 'changed';
  }
  await recordAuditLog(req, {
    action: 'AGENCY_UPDATE',
    entityType: 'agency',
    entityId: agencyId,
    entityName: agency.name || beforeAgency?.name || '',
    beforeData: beforeAudit,
    afterData: afterAudit
  });

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
  const agencies = await repo.listAgencies();
  const beforeAgency = agencies.find(item => Number(item.id) === agencyId);
  if (!beforeAgency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }
  if (isProtectedAgencyJoinCode(beforeAgency)) {
    return sendError(res, 403, 'HQ_JOIN_CODE_LOCKED', '본사 가입링크는 변경할 수 없습니다.');
  }
  const joinCode = normalizeAgencyJoinCode(bodyCode || await createUniqueFriendlyAgencyJoinCode(agencyId));
  if (!joinCode) {
    return sendError(res, 400, 'INVALID_JOIN_CODE', '가입 코드를 입력해주세요.');
  }
  const duplicate = await repo.findAgencyByJoinCode(joinCode);
  if (duplicate && Number(duplicate.id) !== agencyId) {
    return sendError(res, 409, 'JOIN_CODE_EXISTS', '이미 사용 중인 가입 코드입니다.');
  }
  const agency = await repo.updateAgencyJoinCode(agencyId, joinCode);
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }
  await recordAuditLog(req, {
    action: 'AGENCY_JOIN_CODE_UPDATE',
    entityType: 'agency',
    entityId: agencyId,
    entityName: agency.name || beforeAgency.name || '',
    beforeData: pickAgencyAuditData(beforeAgency),
    afterData: pickAgencyAuditData(agency)
  });
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
  const agencies = await repo.listAgencies();
  const beforeAgency = agencies.find(item => Number(item.id) === agencyId);

  const agency = await repo.deleteAgency(agencyId);
  if (!agency) {
    return sendError(res, 404, 'AGENCY_NOT_FOUND', 'Agency was not found.');
  }
  await recordAuditLog(req, {
    action: 'AGENCY_DELETE',
    entityType: 'agency',
    entityId: agencyId,
    entityName: agency.name || beforeAgency?.name || '',
    beforeData: {
      ...pickAgencyAuditData(beforeAgency || agency),
      assignedFranchiseCount: assignedCount
    },
    afterData: {},
    force: true
  });

  return res.status(200).json({
    success: true,
    data: {
      ...agency,
      detachedFranchiseCount: assignedCount
    }
  });
}));

app.get('/api/admin/push/status', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
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

app.post('/api/admin/push/test', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
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



app.post('/api/admin/push/broadcast', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
  const targetType = String(req.body?.targetType || 'all').trim().toLowerCase();
  const targetValue = String(req.body?.targetValue || req.body?.targetId || '').trim();
  const channel = String(req.body?.channel || 'both').trim().toLowerCase();
  const targetScreen = String(req.body?.targetScreen || 'notifications').trim() || 'notifications';
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!['all', 'bonbu', 'jisa', 'jijum', 'franchise', 'agency'].includes(targetType)) {
    return sendError(res, 400, 'BAD_REQUEST', '대상 유형이 올바르지 않습니다.');
  }
  if (targetType !== 'all' && !targetValue) {
    return sendError(res, 400, 'BAD_REQUEST', '본부/지사/지점/가맹점 ID 또는 이름을 입력해 주세요.');
  }
  if (!['both', 'inapp', 'push'].includes(channel)) {
    return sendError(res, 400, 'BAD_REQUEST', '발송 방식이 올바르지 않습니다.');
  }
  if (!title || !body) {
    return sendError(res, 400, 'BAD_REQUEST', '제목과 내용을 입력해 주세요.');
  }
  if (title.length > 80 || body.length > 800) {
    return sendError(res, 400, 'BAD_REQUEST', '제목은 80자, 내용은 800자 이내로 입력해 주세요.');
  }
  const targets = await repo.listPushAnnouncementTargets({ targetType, targetValue });
  if (!targets.length) {
    return sendError(res, 404, 'TARGET_NOT_FOUND', '발송 대상 가맹점을 찾지 못했습니다.');
  }
  const data = {
    targetScreen,
    source: 'admin_push_broadcast',
    requestedBy: req.user.id,
    requestedAt: new Date().toISOString(),
    targetType,
    targetValue
  };
  let stored = 0;
  let fcmSent = 0;
  let fcmFailed = 0;
  let webSubscriptions = 0;
  const failures = [];
  for (const target of targets) {
    try {
      if (channel === 'both' || channel === 'inapp') {
        await repo.createNotification({
          userId: target.id,
          type: 'ADMIN_ANNOUNCEMENT',
          title,
          body,
          data: {
            ...data,
            franchiseId: target.franchiseId || '',
            franchiseName: target.franchiseName || ''
          }
        });
        stored += 1;
      }
      if (channel === 'both' || channel === 'push') {
        const push = await sendUserPushNotification(target.id, { title, body, data });
        fcmSent += Number(push?.fcm?.sent || 0);
        fcmFailed += Number(push?.fcm?.failed || 0);
        webSubscriptions += Number(push?.web?.failed || 0);
      }
    } catch (err) {
      failures.push({ userId: target.id, franchiseName: target.franchiseName || target.name || '', message: err?.message || String(err) });
    }
  }
  await repo.createAuditLog({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    actorLoginId: req.user.loginId || req.user.email,
    actorName: req.user.name,
    action: 'PUSH_BROADCAST',
    entityType: 'notifications',
    entityId: targetType,
    entityName: title,
    beforeData: {},
    changedFields: ['title', 'body', 'targetType', 'targetValue', 'channel'],
    afterData: { title, body, targetType, targetValue, channel, targetCount: targets.length, stored, fcmSent, fcmFailed, webSubscriptions, failureCount: failures.length },
    requestMethod: req.method,
    requestPath: req.originalUrl,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || ''
  }).catch(err => console.warn('[PUSH_BROADCAST_AUDIT_FAILED]', err?.message || err));
  return res.status(200).json({
    success: true,
    data: {
      targetCount: targets.length,
      stored,
      push: { fcm: { sent: fcmSent, failed: fcmFailed }, web: { storedSubscriptions: webSubscriptions } },
      failures: failures.slice(0, 20)
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
    `SELECT code, name, sort_order, icon_url
     FROM financial_institutions
     WHERE active = true
     ORDER BY sort_order ASC, name ASC`
  );
  return res.status(200).json({
    success: true,
    data: result.rows.map(row => ({
      code: row.code,
      name: row.name,
      sortOrder: row.sort_order,
      iconUrl: row.icon_url || ''
    }))
  });
}));

app.get('/api/weather/current', asyncHandler(async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return sendError(res, 400, 'INVALID_LOCATION', 'latitude and longitude are required.');
  }
  const [weather, forecastWeather] = await Promise.all([
    tvKakaoLocationWeatherSnapshot(lat, lng),
    fetchCurrentWeather(lat, lng).catch(() => null)
  ]);
  if (!weather) {
    return sendError(res, 502, 'WEATHER_UNAVAILABLE', '날씨 정보를 가져오지 못했습니다.');
  }
  return res.status(200).json({
    success: true,
    data: {
      location: weather.location || '현재 위치',
      region1: weather.region1 || '',
      region2: weather.region2 || '',
      region3: weather.region3 || '',
      latitude: lat,
      longitude: lng,
      forecast: Array.isArray(weather.forecast) ? weather.forecast : (forecastWeather?.forecast || []),
      hourlyForecast: Array.isArray(weather.hourlyForecast) ? weather.hourlyForecast : (forecastWeather?.hourlyForecast || []),
      ...weather,
      precipitation: weather.precipitation ?? forecastWeather?.precipitation ?? null,
      windSpeed: weather.windSpeed ?? forecastWeather?.windSpeed ?? null
    }
  });
}));

app.post('/api/admin/boards/announcements/upload-image', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  let imageUrl = '';
  try {
    imageUrl = await saveUploadedAnnouncementImage(req.file);
  } catch (err) {
    return sendError(res, err.statusCode || 400, 'BAD_REQUEST', err.message || '알림장 이미지 업로드에 실패했습니다.');
  }
  return res.status(201).json({ success: true, data: { imageUrl } });
}));


const tvDashboardCache = {
  exchange: { value: null, expiresAt: 0 },
  news: { value: null, expiresAt: 0 },
  market: { value: null, expiresAt: 0 },
  weather: { value: null, expiresAt: 0 },
  zodiac: { value: null, expiresAt: 0 }
};

function tvKstDate(value) {
  return formatKstDate(value || new Date());
}

function tvKstHourKey(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}`;
}

function tvAddDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function tvAmount(row) {
  return Number(row?.amount ?? row?.totalAmount ?? row?.paymentAmt ?? row?.total_amount ?? 0) || 0;
}

function tvBuildDailyTrend(rows, days = 7) {
  const todayDate = new Date();
  const labels = [];
  const values = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = tvAddDays(todayDate, -offset);
    const key = tvKstDate(day);
    labels.push(key.slice(5).replace('-', '.'));
    values.push(rows.filter(row => tvKstDate(row.createdAt || row.date) === key).reduce((sum, row) => sum + tvAmount(row), 0));
  }
  return { labels, values };
}

function tvBuildHourlyTrend(rows, hours = 12) {
  const now = new Date();
  const labels = [];
  const values = [];
  for (let offset = hours - 1; offset >= 0; offset -= 1) {
    const hour = new Date(now.getTime() - offset * 60 * 60 * 1000);
    const key = tvKstHourKey(hour);
    labels.push(`${key.slice(11, 13)}시`);
    values.push(rows.filter(row => tvKstHourKey(row.createdAt || row.date) === key).reduce((sum, row) => sum + tvAmount(row), 0));
  }
  return { labels, values };
}

function tvPublicSalesIndex(todaySales, monthSales, totalSales) {
  const base = Math.max(10000, Math.round(totalSales / 30), 1);
  return {
    todayAmount: Math.round(todaySales),
    monthAmount: Math.round(monthSales),
    totalAmount: Math.round(totalSales),
    todayIndex: Math.max(1, Math.round((todaySales / base) * 100)),
    monthIndex: Math.max(1, Math.round((monthSales / Math.max(base * 15, 1)) * 100)),
    flowLabel: todaySales > 0 ? '?? ?? ??' : '?? ?? ??',
    displayMode: 'actual-amount'
  };
}

const TV_ZODIAC_META = [
  { animal: '\uC950\uB760', icon: '\uD83D\uDC2D', element: '\uAE30\uBBFC\uD568', keywords: ['\uC810\uAC80', '\uC18D\uB3C4', '\uAE30\uD68C'] },
  { animal: '\uC18C\uB760', icon: '\uD83D\uDC2E', element: '\uAFB8\uC900\uD568', keywords: ['\uC21C\uC11C', '\uC2E0\uB8B0', '\uAD00\uB9AC'] },
  { animal: '\uD638\uB791\uC774\uB760', icon: '\uD83D\uDC2F', element: '\uCD94\uC9C4\uB825', keywords: ['\uC81C\uC548', '\uACB0\uC815', '\uD65C\uB825'] },
  { animal: '\uD1A0\uB07C\uB760', icon: '\uD83D\uDC30', element: '\uADE0\uD615\uAC10', keywords: ['\uD611\uC5C5', '\uC18C\uD1B5', '\uC870\uC728'] },
  { animal: '\uC6A9\uB760', icon: '\uD83D\uDC32', element: '\uD655\uC7A5\uC131', keywords: ['\uC131\uC7A5', '\uC804\uD658', '\uC8FC\uBAA9'] },
  { animal: '\uBC40\uB760', icon: '\uD83D\uDC0D', element: '\uC9D1\uC911\uB825', keywords: ['\uBD84\uC11D', '\uC815\uB9AC', '\uC120\uD0DD'] },
  { animal: '\uB9D0\uB760', icon: '\uD83D\uDC34', element: '\uC774\uB3D9\uC6B4', keywords: ['\uC2E4\uD589', '\uC5F0\uB77D', '\uD655\uC0B0'] },
  { animal: '\uC591\uB760', icon: '\uD83D\uDC11', element: '\uC628\uD654\uD568', keywords: ['\uBC30\uB824', '\uC548\uC815', '\uD68C\uBCF5'] },
  { animal: '\uC6D0\uC22D\uC774\uB760', icon: '\uD83D\uDC35', element: '\uC21C\uBC1C\uB825', keywords: ['\uC544\uC774\uB514\uC5B4', '\uC804\uD658', '\uC7AC\uCE58'] },
  { animal: '\uB2ED\uB760', icon: '\uD83D\uDC14', element: '\uC815\uD655\uC131', keywords: ['\uAE30\uB85D', '\uD655\uC778', '\uC131\uACFC'] },
  { animal: '\uAC1C\uB760', icon: '\uD83D\uDC36', element: '\uCC45\uC784\uAC10', keywords: ['\uC2E0\uB8B0', '\uC57D\uC18D', '\uBCF4\uC644'] },
  { animal: '\uB3FC\uC9C0\uB760', icon: '\uD83D\uDC37', element: '\uD48D\uC694\uB85C\uC6C0', keywords: ['\uD750\uB984', '\uC5EC\uC720', '\uC218\uC775'] }
];

function tvDecodeHtml(value = '') {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function tvCleanFortuneText(value = '') {
  return tvDecodeHtml(String(value))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function tvShortFortuneText(value = '') {
  const cleaned = tvCleanFortuneText(value)
    .replace(/\uB124\uC774\uBC84|NAVER|\uC624\uB298\uC758 \uC6B4\uC138|\uB760\uBCC4\uC6B4\uC138|\uB760\uBCC4 \uC6B4\uC138/g, '')
    .replace(/["\u201C\u201D\u2018\u2019]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if ((cleaned.match(/\d/g) || []).length > 8) return '';
  if (!/[\uAC00-\uD7A3]/.test(cleaned)) return '';

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map(part => part.trim())
    .filter(part => part.length >= 16 && /[\uAC00-\uD7A3]/.test(part));
  const complete = sentences.find(part => /[.!?]$/.test(part));
  if (complete) return complete;

  const koreanComplete = cleaned.match(/.{16,}?(?:\uB2E4|\uC694)(?=\s|$)/);
  return koreanComplete ? koreanComplete[0].trim() : '';
}

function tvBuildFallbackZodiac(provider = 'EatsPay') {
  const messages = [
    '\uC791\uC740 \uD655\uC778\uC774 \uD070 \uD750\uB984\uC744 \uC815\uB9AC\uD569\uB2C8\uB2E4. \uC22B\uC790\uC640 \uC57D\uC18D\uC744 \uBA3C\uC800 \uCC59\uAE30\uC138\uC694.',
    '\uC11C\uB450\uB974\uAE30\uBCF4\uB2E4 \uC21C\uC11C\uB97C \uC9C0\uD0A4\uBA74 \uC88B\uC740 \uACB0\uACFC\uAC00 \uB530\uB77C\uC635\uB2C8\uB2E4.',
    '\uC0C8 \uC81C\uC548\uC740 \uC870\uAC74\uC744 \uBA3C\uC800 \uC0B4\uD53C\uBA74 \uAE30\uD68C\uAC00 \uB429\uB2C8\uB2E4.',
    '\uC775\uC219\uD55C \uC77C\uC5D0\uC11C \uC88B\uC740 \uC2E0\uD638\uAC00 \uBCF4\uC785\uB2C8\uB2E4. \uAE30\uBCF8\uAE30\uAC00 \uD798\uC744 \uB0C5\uB2C8\uB2E4.',
    '\uBBF8\uB904\uB454 \uC5F0\uB77D\uC744 \uC815\uB9AC\uD558\uAE30 \uC88B\uC740 \uB0A0\uC785\uB2C8\uB2E4.',
    '\uCC28\uBD84\uD55C \uC120\uD0DD\uC774 \uACB0\uACFC\uB97C \uB2E8\uB2E8\uD558\uAC8C \uB9CC\uB4ED\uB2C8\uB2E4.',
    '\uC6C0\uC9C1\uC784\uC774 \uB9CE\uC740 \uB9CC\uD07C \uAE30\uB85D\uACFC \uD655\uC778\uC774 \uC911\uC694\uD569\uB2C8\uB2E4.',
    '\uD611\uC5C5\uC5D0\uC11C \uB73B\uBC16\uC758 \uB3C4\uC6C0\uC774 \uB4E4\uC5B4\uC635\uB2C8\uB2E4.',
    '\uC0C8\uB85C\uC6B4 \uC815\uBCF4\uBCF4\uB2E4 \uC774\uBBF8 \uAC00\uC9C4 \uAE30\uC900\uC744 \uCC59\uAE30\uBA74 \uC88B\uC2B5\uB2C8\uB2E4.',
    '\uC791\uC740 \uC131\uACFC\uB97C \uBE60\uB974\uAC8C \uACF5\uC720\uD558\uBA74 \uD750\uB984\uC774 \uC0B4\uC544\uB0A9\uB2C8\uB2E4.',
    '\uC815\uB9AC\uC640 \uC810\uAC80\uC5D0 \uC6B4\uC774 \uB530\uB974\uB294 \uB0A0\uC785\uB2C8\uB2E4.',
    '\uAE30\uB2E4\uB9AC\uB358 \uD750\uB984\uC774 \uCC9C\uCC9C\uD788 \uC5F4\uB9BD\uB2C8\uB2E4.'
  ]; const seed = Number(tvKstDate(new Date()).replace(/-/g, ''));
  const items = TV_ZODIAC_META.map((meta, index) => ({
    ...meta,
    message: messages[(seed + index * 3) % messages.length],
    score: 72 + ((seed + index * 7) % 24),
    source: provider === 'Naver Search' ? '네이버 검색 기반' : 'EatsPay'
  }));
  return { provider, today: tvKstDate(new Date()), items, featured: items[seed % items.length], updatedAt: new Date().toISOString() };
}

function tvParseNaverZodiac(html = '') {
  const text = tvCleanFortuneText(html);
  if (!text || !text.includes('띠')) return null;
  const seed = Number(tvKstDate(new Date()).replace(/-/g, ''));
  const items = TV_ZODIAC_META.map((meta, index) => {
    const animalIndex = text.indexOf(meta.animal);
    let message = '';
    if (animalIndex >= 0) {
      const chunk = text.slice(animalIndex, animalIndex + 360);
      const nextAnimal = TV_ZODIAC_META.find(other => other.animal !== meta.animal && chunk.indexOf(other.animal, 2) > 0);
      const trimmed = nextAnimal ? chunk.slice(0, chunk.indexOf(nextAnimal.animal, 2)) : chunk;
      message = tvShortFortuneText(trimmed.replace(meta.animal, '').replace(/^(?:\s*\d{2},?)+\s*\uB144\uC0DD\s*/, ''));
    }
    const fallback = tvBuildFallbackZodiac('Naver Search').items[index].message;
    return {
      ...meta,
      message: message || fallback,
      score: 74 + ((seed + index * 11) % 23),
      source: message ? '네이버 검색 기반' : '네이버 검색 보조'
    };
  });
  if (!items.some(item => item.source === '네이버 검색 기반')) return null;
  return { provider: 'Naver Search', today: tvKstDate(new Date()), items, featured: items[seed % items.length], updatedAt: new Date().toISOString() };
}

async function tvZodiacSnapshot() {
  const now = Date.now();
  if (tvDashboardCache.zodiac.value && tvDashboardCache.zodiac.expiresAt > now) return tvDashboardCache.zodiac.value;
  const fallback = tvBuildFallbackZodiac('EatsPay');
  try {
    const url = 'https://m.search.naver.com/search.naver?query=' + encodeURIComponent('띠별운세');
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'ko-KR,ko;q=0.9',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
      }
    });
    if (!response.ok) throw new Error('NAVER_ZODIAC_FETCH_FAILED');
    const html = await response.text();
    const parsed = tvParseNaverZodiac(html);
    if (!parsed) throw new Error('NAVER_ZODIAC_PARSE_EMPTY');
    tvDashboardCache.zodiac = { value: parsed, expiresAt: now + 6 * 60 * 60 * 1000 };
    return parsed;
  } catch (err) {
    const value = { ...fallback, provider: 'EatsPay fallback', error: err.message };
    tvDashboardCache.zodiac = { value, expiresAt: now + 30 * 60 * 1000 };
    return value;
  }
}
function tvWeatherIconFromLabel(label = '') {
  const text = String(label || '');
  if (/\uBE44|\uC18C\uB098\uAE30|\uB1CC\uC6B0/.test(text)) return '\u2614';
  if (/\uB208/.test(text)) return '\u2744';
  if (/\uD750\uB9BC|\uAD6C\uB984/.test(text)) return '\u2601';
  if (/\uB9D1\uC74C/.test(text)) return '\u2600';
  return '\u26C5';
}

async function tvNaverWeatherSnapshot(locationName = '', fallbackLat = 37.5665, fallbackLng = 126.9780) {
  const now = Date.now();
  const location = String(locationName || process.env.TV_WEATHER_LOCATION || '\uC11C\uC6B8').trim() || '\uC11C\uC6B8';
  if (tvDashboardCache.weather.value && tvDashboardCache.weather.expiresAt > now && tvDashboardCache.weather.value.location === location) return tvDashboardCache.weather.value;
  try {
    const url = 'https://m.search.naver.com/search.naver?query=' + encodeURIComponent(location + ' \uB0A0\uC528');
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'ko-KR,ko;q=0.9',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
      }
    });
    if (!response.ok) throw new Error('NAVER_WEATHER_FETCH_FAILED');
    const html = await response.text();
    const text = tvCleanFortuneText(html);
    const weatherMatch = text.match(/\uC624\uB298\uC758 \uB0A0\uC528\s*([^\s]+)\s*\uD604\uC7AC \uC628\uB3C4\s*(-?\d+(?:\.\d+)?)\s*\u00B0/);
    const tempMatch = text.match(/\uD604\uC7AC \uC628\uB3C4\s*(-?\d+(?:\.\d+)?)\s*\u00B0/);
    const apparentMatch = text.match(/\uCCB4\uAC10\s*(-?\d+(?:\.\d+)?)\s*\u00B0/);
    const humidityMatch = text.match(/\uC2B5\uB3C4\s*(\d+)\s*%/);
    const label = weatherMatch?.[1] || text.match(/\uC624\uB298\uC758 \uB0A0\uC528\s*([^\s]+)/)?.[1] || text.match(/\uB0AE\uC544\uC694\s*([^\s]+)\s*\uCCB4\uAC10/)?.[1] || '\uB0A0\uC528 \uD655\uC778 \uC911';
    const temperature = Number(tempMatch?.[1] || weatherMatch?.[2]);
    if (!Number.isFinite(temperature)) throw new Error('NAVER_WEATHER_PARSE_EMPTY');
    const value = {
      provider: 'Naver Search',
      location,
      temperature,
      apparentTemperature: Number.isFinite(Number(apparentMatch?.[1])) ? Number(apparentMatch[1]) : null,
      humidity: Number.isFinite(Number(humidityMatch?.[1])) ? Number(humidityMatch[1]) : null,
      weatherLabel: label,
      weatherIcon: tvWeatherIconFromLabel(label),
      updatedAt: new Date().toISOString()
    };
    tvDashboardCache.weather = { value, expiresAt: now + 10 * 60 * 1000 };
    return value;
  } catch (err) {
    const fallback = await fetchCurrentWeather(fallbackLat, fallbackLng).catch(() => null);
    if (!fallback) return null;
    const value = { ...fallback, provider: 'Open-Meteo fallback', location };
    tvDashboardCache.weather = { value, expiresAt: now + 2 * 60 * 1000 };
    return value;
  }
}

async function tvKakaoLocationWeatherSnapshot(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return tvNaverWeatherSnapshot(process.env.TV_WEATHER_LOCATION || '\uC11C\uC6B8');
  const region = await resolveKakaoRegion(latitude, longitude).catch(() => null);
  const locationName = region?.region3 || region?.region2 || region?.addressName || process.env.TV_WEATHER_LOCATION || '\uC11C\uC6B8';
  const weather = await tvNaverWeatherSnapshot(locationName, latitude, longitude);
  return weather ? {
    ...weather,
    location: region?.addressName || weather.location || locationName,
    region1: region?.region1 || '',
    region2: region?.region2 || '',
    region3: region?.region3 || '',
    latitude,
    longitude,
    locationProvider: region ? 'Kakao Local' : 'Browser Geolocation'
  } : null;
}

async function tvExchangeSnapshot() {
  const now = Date.now();
  if (tvDashboardCache.exchange.value && tvDashboardCache.exchange.expiresAt > now) return tvDashboardCache.exchange.value;
  const fallback = {
    provider: 'fallback',
    items: [
      { code: 'USD/KRW', label: '달러', value: '대기', delta: '' },
      { code: 'JPY/KRW', label: '엔화', value: '대기', delta: '' }
    ],
    updatedAt: new Date().toISOString()
  };
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', {
      headers: { accept: 'application/json', 'user-agent': 'eats-pay-tv-dashboard/1.0' }
    });
    if (!response.ok) throw new Error('EXCHANGE_FETCH_FAILED');
    const payload = await response.json();
    const krw = Number(payload?.rates?.KRW);
    const jpy = Number(payload?.rates?.JPY);
    const value = {
      provider: 'open.er-api.com',
      items: [
        { code: 'USD/KRW', label: '달러', value: Number.isFinite(krw) ? krw.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '대기', delta: '' },
        { code: 'JPY/KRW', label: '엔화', value: Number.isFinite(krw) && Number.isFinite(jpy) ? (krw / jpy).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '대기', delta: '' }
      ],
      updatedAt: new Date().toISOString()
    };
    tvDashboardCache.exchange = { value, expiresAt: now + 10 * 60 * 1000 };
    return value;
  } catch (_) {
    tvDashboardCache.exchange = { value: fallback, expiresAt: now + 2 * 60 * 1000 };
    return fallback;
  }
}


async function tvMarketSnapshot() {
  const now = Date.now();
  if (tvDashboardCache.market.value && tvDashboardCache.market.expiresAt > now) return tvDashboardCache.market.value;
  const fallback = {
    provider: 'fallback',
    items: [
      { code: 'KOSPI', label: '\uCF54\uC2A4\uD53C', value: '\uB300\uAE30', delta: '', direction: 'flat' }
    ],
    updatedAt: new Date().toISOString()
  };
  try {
    const response = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11?range=1d&interval=5m', {
      headers: { accept: 'application/json', 'user-agent': 'eats-pay-tv-dashboard/1.0' }
    });
    if (!response.ok) throw new Error('MARKET_FETCH_FAILED');
    const payload = await response.json();
    const result = payload?.chart?.result?.[0] || {};
    const meta = result.meta || {};
    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const closes = Array.isArray(result.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
    const trendRows = timestamps.map((time, index) => ({ time, close: Number(closes[index]) })).filter(row => Number.isFinite(row.close));
    const sampled = trendRows.filter((_, index) => index % Math.max(1, Math.ceil(trendRows.length / 18)) === 0).slice(-18);
    const price = Number(meta.regularMarketPrice);
    const previous = Number(meta.previousClose);
    const diff = Number.isFinite(price) && Number.isFinite(previous) ? price - previous : null;
    const rate = Number.isFinite(diff) && previous ? (diff / previous) * 100 : null;
    const value = {
      provider: 'Yahoo Finance',
      items: [
        {
          code: 'KOSPI',
          label: '\uCF54\uC2A4\uD53C',
          value: Number.isFinite(price) ? price.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '??',
          numericValue: Number.isFinite(price) ? price : null,
          delta: Number.isFinite(diff) && Number.isFinite(rate) ? `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${rate >= 0 ? '+' : ''}${rate.toFixed(2)}%)` : '',
          direction: Number.isFinite(diff) ? (diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat') : 'flat',
          trend: {
            labels: sampled.map(row => new Date(row.time * 1000).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })),
            values: sampled.map(row => Number(row.close.toFixed(2)))
          }
        }
      ],
      updatedAt: new Date().toISOString()
    };
    tvDashboardCache.market = { value, expiresAt: now + 5 * 60 * 1000 };
    return value;
  } catch (_) {
    tvDashboardCache.market = { value: fallback, expiresAt: now + 2 * 60 * 1000 };
    return fallback;
  }
}

async function tvNewsSnapshot() {
  const now = Date.now();
  if (tvDashboardCache.news.value && tvDashboardCache.news.expiresAt > now) return tvDashboardCache.news.value;
  const fallback = {
    provider: 'EatsPay',
    breaking: [
      { headline: '속보 대기 중 - 운영 흐름 정상', source: 'EatsPay', urgency: 'normal', publishedAt: new Date().toISOString() }
    ],
    headlines: [
      { headline: '\uC624\uB298\uC758 \uC815\uC0B0 \uD750\uB984\uACFC \uAC00\uB9F9\uC810 \uC9C0\uD45C\uB97C \uD55C \uD654\uBA74\uC5D0 \uD45C\uC2DC\uD569\uB2C8\uB2E4', source: 'EatsPay', urgency: 'normal', publishedAt: new Date().toISOString() },
      { headline: '날씨와 환율 정보는 자동으로 갱신됩니다', source: 'EatsPay', urgency: 'normal', publishedAt: new Date().toISOString() },
      { headline: '공개 화면에서는 민감한 가맹점 정보가 노출되지 않습니다', source: 'EatsPay', urgency: 'normal', publishedAt: new Date().toISOString() }
    ],
    updatedAt: new Date().toISOString()
  };
  const feedUrl = String(process.env.TV_DASHBOARD_NEWS_RSS || 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko').trim();
  try {
    const response = await fetch(feedUrl, { headers: { accept: 'application/rss+xml,text/xml', 'user-agent': 'eats-pay-tv-dashboard/1.0' } });
    if (!response.ok) throw new Error('NEWS_FETCH_FAILED');
    const xml = await response.text();
    const itemBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(match => match[0]);
    const titles = itemBlocks
      .map(item => {
        const cdata = item.match(/<title>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/title>/i)?.[1];
        const plain = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
        return tvDecodeHtml(String(cdata || plain || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      })
      .filter(Boolean)
      .filter((title, index, arr) => arr.indexOf(title) === index)
      .slice(0, 8);
    if (!titles.length) throw new Error('NEWS_EMPTY');
    const value = {
      provider: 'RSS',
      breaking: titles.slice(0, 1).map(headline => ({ headline, source: 'RSS', urgency: 'breaking', publishedAt: new Date().toISOString() })),
      headlines: titles.map(headline => ({ headline, source: 'RSS', urgency: 'normal', publishedAt: new Date().toISOString() })),
      updatedAt: new Date().toISOString()
    };
    tvDashboardCache.news = { value, expiresAt: now + 10 * 60 * 1000 };
    return value;
  } catch (_) {
    tvDashboardCache.news = { value: fallback, expiresAt: now + 5 * 60 * 1000 };
    return fallback;
  }
}

app.get('/api/tv-dashboard', asyncHandler(async (req, res) => {
  const today = formatKstDate(new Date());
  const month = today.slice(0, 7);
  const latitude = Number(req.query.lat || req.query.latitude);
  const longitude = Number(req.query.lng || req.query.longitude);
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const weatherPromise = hasLocation
    ? tvKakaoLocationWeatherSnapshot(latitude, longitude).catch(() => null)
    : tvNaverWeatherSnapshot(req.query.location || req.query.weatherLocation).catch(() => null);
  const [transactions, users, agencies, inquiries, advanceInquiries, accountRequests, deliveryAccounts, weather, exchange, market, news] = await Promise.all([
    repo.listTransactions({ startDate: '2000-01-01', endDate: '2100-12-31', role: 'ADMIN', limit: 1000, offset: 0 }),
    repo.listFranchiseUsers(),
    repo.listAgencies(),
    repo.listAgencyInquiries(),
    repo.listAdvanceInquiries(),
    repo.listAccountRequests(),
    repo.listDeliveryAccounts(),
    weatherPromise,
    tvExchangeSnapshot(),
    tvMarketSnapshot(),
    tvNewsSnapshot()
  ]);
  const paymentRows = Array.isArray(transactions?.items) ? transactions.items : [];
  const merchantRows = Array.isArray(users) ? users.filter(user => user.role === 'OWNER') : [];
  const agencyRows = Array.isArray(agencies) ? agencies : [];
  const agencyCounts = agencyRows.reduce((counts, agency) => {
    const key = agencyTypeKeyForApi(agency);
    if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key] += 1;
    return counts;
  }, { hq: 0, bonbu: 0, jisa: 0, jijum: 0 });
  const todaySales = paymentRows.filter(row => tvKstDate(row.createdAt || row.date) === today).reduce((sum, row) => sum + tvAmount(row), 0);
  const monthSales = paymentRows.filter(row => tvKstDate(row.createdAt || row.date).slice(0, 7) === month).reduce((sum, row) => sum + tvAmount(row), 0);
  const totalSales = paymentRows.reduce((sum, row) => sum + tvAmount(row), 0);
  const pendingAccounts = accountRequests.filter(request => request.status === 'PENDING').length + deliveryAccounts.filter(account => account.accountStatus === 'PENDING').length;
  const pendingInquiries = inquiries.filter(item => item.status === '상담 대기').length;
  const pendingAdvance = advanceInquiries.filter(item => item.status === '상담 대기').length;
  const dailyTrend = tvBuildDailyTrend(paymentRows, 7);
  const recentDailyIndex = dailyTrend.values.map((value, index) => ({ value, label: dailyTrend.labels[index] })).filter(item => item.value > 0).pop() || { value: todaySales, label: today.slice(5).replace('-', '.') };
  const hourlyTrend = tvBuildHourlyTrend(paymentRows, 12);
  return res.status(200).json({
    success: true,
    data: {
      mode: 'public',
      generatedAt: new Date().toISOString(),
      sales: {
        ...tvPublicSalesIndex(todaySales, monthSales, totalSales),
        recentDailyAmount: Math.round(recentDailyIndex.value),
        recentDailyLabel: recentDailyIndex.label
      },
      merchants: {
        today: merchantRows.filter(user => tvKstDate(user.createdAt) === today).length,
        month: merchantRows.filter(user => tvKstDate(user.createdAt).slice(0, 7) === month).length,
        total: merchantRows.length
      },
      organization: {
        hq: agencyCounts.hq,
        bonbu: agencyCounts.bonbu,
        jisa: agencyCounts.jisa,
        jijum: agencyCounts.jijum,
        merchants: merchantRows.length,
        total: agencyCounts.hq + agencyCounts.bonbu + agencyCounts.jisa + agencyCounts.jijum + merchantRows.length
      },
      operations: {
        pendingAccounts,
        pendingInquiries,
        pendingAdvance,
        healthLabel: pendingAccounts + pendingInquiries + pendingAdvance > 0 ? '처리중' : '정상'
      },
      trends: {
        hourlySales: hourlyTrend,
        dailySales: dailyTrend,
        merchantGrowth: tvBuildDailyTrend(merchantRows.map(user => ({ createdAt: user.createdAt, amount: 1 })), 7)
      },
      weather: weather ? {
        location: weather.location || '\uC11C\uC6B8',
        temperature: weather.temperature,
        apparentTemperature: weather.apparentTemperature,
        humidity: weather.humidity,
        weatherLabel: weather.weatherLabel,
        weatherIcon: weather.weatherIcon,
        windSpeed: weather.windSpeed,
        provider: weather.provider,
        locationProvider: weather.locationProvider || '',
        region1: weather.region1 || '',
        region2: weather.region2 || '',
        region3: weather.region3 || '',
        latitude: weather.latitude || null,
        longitude: weather.longitude || null
      } : { location: '\uC11C\uC6B8', temperature: null, weatherLabel: '\uB0A0\uC528 \uB300\uAE30', weatherIcon: '\u2022', provider: 'fallback' },
      exchange,
      market,
      zodiac: await tvZodiacSnapshot(),
      news,
      brand: {
        logoUrl: '/logo.png',
        phrases: ['\uBC30\uB2EC\uB300\uD589\uBE44 \uCE74\uB4DC\uACB0\uC81C\uC758 \uC0C8\uB85C\uC6B4 \uAE30\uC900', '\uC815\uC0B0\uC758 \uD750\uB984\uC744 \uB354 \uC120\uBA85\uD558\uAC8C', '\uC6B4\uC601\uC758 \uAE30\uC900\uC744 \uB354 \uC120\uBA85\uD558\uAC8C']
      }
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

  const beforeUser = await repo.findUserByLoginId(email);
  const user = await repo.updateUserRoleByEmail(email, role);
  if (!user) {
    return sendError(res, 404, 'USER_NOT_FOUND', 'User was not found.');
  }
  await recordAuditLog(req, {
    action: action === 'APPROVED' ? 'FRANCHISE_APPROVE' : 'FRANCHISE_REJECT',
    entityType: 'franchise',
    entityId: user.franchiseId,
    entityName: user.franchiseName || user.loginId,
    beforeData: pickFranchiseAuditData(beforeUser),
    afterData: pickFranchiseAuditData(user)
  });

  return res.status(200).json({
    success: true,
    message: 'Franchise status updated.',
    data: { email: user.loginId, loginId: user.loginId, role: user.role }
  });
}));

app.get('/api/admin/accounts', authenticateAdmin, asyncHandler(async (req, res) => {
  const includeSensitiveTidKeys = isSystemAdminUser(req.user);
  const requests = await repo.listAccountRequests();
  return res.status(200).json({
    success: true,
    data: requests.map(request => {
      if (includeSensitiveTidKeys) return request;
      const { manualKey, recurringKey, manual_key, recurring_key, ...safe } = request;
      return safe;
    })
  });
}));

app.post('/api/admin/accounts/proof-ocr', authenticateAdmin, asyncHandler(async (req, res) => {
  if (accountProofOcrBusy) return sendError(res, 429, 'OCR_BUSY', '다른 증빙을 인식하고 있습니다. 잠시 후 다시 시도해주세요.');
  const accountNo = normalizeOcrAccountNo(req.body?.accountNo);
  if (accountNo.length < 8 || accountNo.length > 20) return sendError(res, 400, 'INVALID_ACCOUNT_NO', '계좌번호는 숫자 8~20자리여야 합니다.');
  let imagePath, region;
  try {
    imagePath = assertProofImageExists(resolveProofImagePath(req.body?.documentUrl, uploadDir));
    region = normalizeOcrRegion(req.body?.region);
  } catch (error) {
    return sendError(res, 400, 'INVALID_PROOF_IMAGE', error?.message || '증빙 이미지를 확인할 수 없습니다.');
  }
  accountProofOcrBusy = true;
  try {
    const result = await recognizeAccountProof(imagePath, accountNo, { region, includeCharacterBoxes: true });
    const characterBoxes=(Array.isArray(result.characterBoxes)?result.characterBoxes:[]).slice(0,20).filter(box=>/^\d$/.test(String(box?.digit||''))&&['x','y','width','height'].every(key=>Number.isFinite(Number(box?.[key]))&&Number(box[key])>=0&&Number(box[key])<=1));
    return res.status(200).json({ success: true, data: { status: result.status, registeredAccountNo: accountNo, recognizedAccountNo: result.recognizedAccountNo || '', candidates: Array.isArray(result.candidates) ? result.candidates.slice(0, 5) : [], characterBoxes } });
  } catch (error) {
    const unavailable = /설치되어 있지/.test(String(error?.message || ''));
    return sendError(res, unavailable ? 503 : 422, unavailable ? 'OCR_UNAVAILABLE' : 'OCR_FAILED', error?.message || '증빙 이미지를 인식하지 못했습니다.');
  } finally {
    accountProofOcrBusy = false;
  }
}));

function normalizeAdminPgContractPayload(body = {}) {
  const providerName = normalizeProviderName(body.providerName || body.pgProviderName || body.provider || '');
  const legacy = {
    manualTid: String(body.manualTid || body.manual_tid || '').trim(),
    manualKey: String(body.manualKey || body.manual_key || '').trim(),
    recurringTid: String(body.recurringTid || body.recurring_tid || body.txid || '').trim(),
    recurringKey: String(body.recurringKey || body.recurring_key || '').trim()
  };
  legacy.txid = legacy.recurringTid || legacy.manualTid;
  const rawContracts = Array.isArray(body.contracts) ? body.contracts : [];
  const contracts = rawContracts.map(contract => {
    const normalizedProvider = normalizeProviderName(contract.providerName || contract.pgProviderName || providerName);
    if (normalizedProvider === '위루트') {
      const metadata = {
        ...(contract.metadata && typeof contract.metadata === 'object' ? contract.metadata : {})
      };
      const routeupApiKey = String(contract.routeupApiKey || contract.apiKey || metadata.routeupApiKey || metadata.apiKey || '').trim();
      const routeupEncryptionKey = String(contract.routeupEncryptionKey || contract.encryptionKey || contract.encryptKey || metadata.routeupEncryptionKey || metadata.encryptionKey || metadata.encryptKey || '').trim();
      const initializationVector = String(contract.initializationVector || contract.iv || metadata.initializationVector || metadata.iv || '').trim();
      if (routeupApiKey) metadata.routeupApiKey = routeupApiKey;
      if (routeupEncryptionKey) metadata.routeupEncryptionKey = routeupEncryptionKey;
      if (initializationVector) metadata.initializationVector = initializationVector;
      return buildRouteupPaymentContract({
        providerId: contract.providerId || contract.pgProviderId || body.providerId || body.pgProviderId || null,
        mid: contract.mid || body.mid,
        tid: contract.tid || contract.txid,
        paymentKey: contract.paymentKey || contract.payKey || contract.key,
        signatureKey: contract.signatureKey || contract.signKey,
        contractStartDate: contract.contractStartDate || contract.startDate,
        contractEndDate: contract.contractEndDate || contract.endDate,
        deviceType: contract.deviceType || contract.terminalType,
        isDefault: contract.isDefault !== false,
        metadata
      });
    }
    return contract;
  });
  return { providerName, legacy, contracts };
}

app.put('/api/admin/accounts/pg-contracts', authenticateAdmin, requireSystemAdminOnly, asyncHandler(async (req, res) => {
  const source = String(req.body?.source || '').trim();
  const accountId = String(req.body?.accountId || req.body?.requestId || '').trim();
  if (!['delivery_account', 'account_request'].includes(source) || !accountId) {
    return sendError(res, 400, 'INVALID_ACCOUNT_TARGET', 'source and accountId are required.');
  }
  const target = source === 'delivery_account'
    ? await repo.findDeliveryAccountById(Number(accountId))
    : await repo.findAccountRequest(accountId);
  if (!target) {
    return sendError(res, 404, 'ACCOUNT_NOT_FOUND', 'Account was not found.');
  }
  const normalized = normalizeAdminPgContractPayload(req.body || {});
  await repo.updateAccountApprovalPgContracts({
    source,
    id: accountId,
    franchiseId: target.franchiseId,
    legacy: normalized.legacy,
    contracts: normalized.contracts
  });
  const updated = source === 'delivery_account'
    ? await repo.findDeliveryAccountById(Number(accountId))
    : await repo.findAccountRequest(accountId);
  await recordAuditLog(req, {
    action: 'ACCOUNT_PG_CONTRACT_UPDATE',
    entityType: source,
    entityId: accountId,
    entityName: target.agencyName || target.deliveryAgencyName || target.franchiseName || '',
    beforeData: {
      txid: target.txid || '',
      manualTid: target.manualTid || '',
      recurringTid: target.recurringTid || '',
      pgContracts: (target.pgContracts || []).map(maskPgContract)
    },
    afterData: {
      txid: updated?.txid || '',
      manualTid: updated?.manualTid || '',
      recurringTid: updated?.recurringTid || '',
      pgContracts: (updated?.pgContracts || []).map(maskPgContract)
    },
    force: true
  });
  return res.status(200).json({
    success: true,
    data: {
      source,
      accountId,
      account: {
        ...updated,
        ...accountTidKeyDisplayFields(updated || {}, isSystemAdminUser(req.user))
      }
    }
  });
}));

app.get('/api/admin/account-rejection-reasons', authenticateAdmin, asyncHandler(async (req, res) => {
  const reasons = await repo.listAccountRejectionReasons();
  return res.status(200).json({ success: true, data: reasons });
}));

app.put('/api/admin/account-rejection-reasons', authenticateAdmin, asyncHandler(async (req, res) => {
  const reasons = Array.isArray(req.body?.reasons)
    ? req.body.reasons.map(reason => String(reason || '').trim()).filter(Boolean)
    : [];
  if (!reasons.length) {
    return sendError(res, 400, 'MISSING_REJECTION_REASONS', 'At least one rejection reason is required.');
  }
  const saved = await repo.replaceAccountRejectionReasons(reasons);
  return res.status(200).json({ success: true, data: saved });
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
  let beforeAccount = null;
  if (source === 'delivery_account') {
    if (!/^\d+$/.test(id)) {
      return sendError(res, 400, 'INVALID_ACCOUNT_ID', 'delivery account id must be numeric.');
    }
    beforeAccount = await repo.findDeliveryAccountById(Number(id));
    updated = await repo.updateDeliveryAccount(Number(id), {
      agencyName: deliveryAgencyName,
      bankName,
      accountHolder,
      accountNo,
      fileKey: uploadedFile?.fileKey || null
    });
  } else {
    beforeAccount = await repo.findAccountRequest(id);
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
  await recordAuditLog(req, {
    action: 'ACCOUNT_DETAIL_UPDATE',
    entityType: source === 'delivery_account' ? 'delivery_account' : 'account_request',
    entityId: id,
    entityName: deliveryAgencyName || beforeAccount?.deliveryAgencyName || beforeAccount?.agencyName || '',
    beforeData: source === 'delivery_account' ? pickDeliveryAccountAuditData(beforeAccount) : pickAccountRequestAuditData(beforeAccount),
    afterData: source === 'delivery_account' ? pickDeliveryAccountAuditData(updated) : pickAccountRequestAuditData(updated)
  });

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
  let beforeAccount = null;
  if (source === 'delivery_account') {
    if (/^\d+$/.test(id)) {
      beforeAccount = await repo.findDeliveryAccountById(Number(id));
      updated = await repo.updateDeliveryAccountVisibility(Number(id), visibility);
    }
    if (!updated) {
      beforeAccount = beforeAccount || await repo.findAccountRequest(id);
      updated = await repo.updateAccountRequestVisibility(id, visibility);
    }
  } else {
    beforeAccount = await repo.findAccountRequest(id);
    updated = await repo.updateAccountRequestVisibility(id, visibility);
    if (!updated && /^\d+$/.test(id)) {
      beforeAccount = await repo.findDeliveryAccountById(Number(id));
      updated = await repo.updateDeliveryAccountVisibility(Number(id), visibility);
    }
  }

  if (!updated) {
    return sendError(res, 404, 'ACCOUNT_NOT_FOUND', '출금계좌를 DB에서 찾지 못했습니다.');
  }
  const resolvedSource = updated.requestId ? 'account_request' : 'delivery_account';
  await recordAuditLog(req, {
    action: req.body.hidden ? 'ACCOUNT_HIDE' : 'ACCOUNT_SHOW',
    entityType: resolvedSource,
    entityId: updated.requestId || updated.id || id,
    entityName: updated.deliveryAgencyName || updated.agencyName || '',
    beforeData: resolvedSource === 'delivery_account'
      ? pickDeliveryAccountAuditData(beforeAccount)
      : pickAccountRequestAuditData(beforeAccount),
    afterData: resolvedSource === 'delivery_account'
      ? pickDeliveryAccountAuditData(updated)
      : pickAccountRequestAuditData(updated)
  });

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
  let beforeAccount = null;
  if (source === 'delivery_account') {
    if (!/^\d+$/.test(id)) {
      beforeAccount = await repo.findAccountRequest(id);
      hiddenAccount = await repo.updateAccountRequestVisibility(id, { active: false, hidden: true });
    } else {
      beforeAccount = await repo.findDeliveryAccountById(Number(id));
      hiddenAccount = await repo.updateDeliveryAccountVisibility(Number(id), { active: false, hidden: true });
      if (!hiddenAccount) {
        beforeAccount = await repo.findAccountRequest(id);
        hiddenAccount = await repo.updateAccountRequestVisibility(id, { active: false, hidden: true });
      }
    }
  } else {
    beforeAccount = await repo.findAccountRequest(id);
    hiddenAccount = await repo.updateAccountRequestVisibility(id, { active: false, hidden: true });
    if (!hiddenAccount && /^\d+$/.test(id)) {
      beforeAccount = await repo.findDeliveryAccountById(Number(id));
      hiddenAccount = await repo.updateDeliveryAccountVisibility(Number(id), { active: false, hidden: true });
    }
  }

  if (!hiddenAccount) {
    return sendError(res, 404, 'ACCOUNT_NOT_FOUND', '숨김 처리할 출금계좌를 DB에서 찾지 못했습니다.');
  }
  const resolvedSource = hiddenAccount.requestId ? 'account_request' : 'delivery_account';
  await recordAuditLog(req, {
    action: 'ACCOUNT_DELETE',
    entityType: resolvedSource,
    entityId: hiddenAccount.requestId || hiddenAccount.id || id,
    entityName: hiddenAccount.deliveryAgencyName || hiddenAccount.agencyName || '',
    beforeData: resolvedSource === 'delivery_account'
      ? pickDeliveryAccountAuditData(beforeAccount)
      : pickAccountRequestAuditData(beforeAccount),
    afterData: resolvedSource === 'delivery_account'
      ? pickDeliveryAccountAuditData(hiddenAccount)
      : pickAccountRequestAuditData(hiddenAccount),
    force: true
  });

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

function formatKstDateInput(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
}

function numberFromPayway(value) {
  const numeric = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function paywayAdjDateToTimestamptz(value) {
  const raw = String(value || '').replace(/[^0-9]/g, '');
  if (raw.length !== 8) return new Date().toISOString();
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  if (!year || !month || !day) return new Date().toISOString();
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 9 * 60 * 60 * 1000).toISOString();
}

async function fetchChPaywayPaymentByAuthNo(authNo, paymentDate) {
  await ensureChPaywaySession();
  const day = formatKstDateInput(paymentDate);
  const form = {
    st: day,
    ed: day,
    pay_sta: 'ALL',
    pg: 'ALL',
    kf: 'authno',
    k: String(authNo || '').trim(),
    rows: '15',
    page: 1,
    pageSize: 15
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CH_PAYWAY_FALLBACK_TIMEOUT_MS);
  try {
    const response = await fetch(`${CH_PAYWAY_BASE_URL}/ajax.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0',
        Referer: `${CH_PAYWAY_BASE_URL}/pay`,
        Cookie: chPaywayCookieHeader
      },
      body: new URLSearchParams({ qry: 'asp_usr_pay_lst', jData: JSON.stringify(form), rtnType: 'json3' }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`CH_PAYWAY_LIST_FAILED ${response.status}`);
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { throw new Error('CH_PAYWAY_LIST_PARSE_FAILED'); }
    return Array.isArray(parsed?.T2) ? parsed.T2 : [];
  } finally {
    clearTimeout(timer);
  }
}

async function markSettlementConfirmedByChPayway(client, settlement, paywayRow) {
  const payload = {
    source: 'ch_payway_fallback',
    seq: paywayRow.seq || null,
    authno: paywayRow.authno || '',
    odrno: paywayRow.odrno || '',
    tradeno: paywayRow.tradeno || '',
    pay_dt: paywayRow.pay_dt || '',
    adj_sta: paywayRow.adj_sta,
    adj_dt: paywayRow.adj_dt || '',
    adj_amt: paywayRow.adj_amt || '',
    mc_nm: paywayRow.mc_nm || ''
  };
  const settledAt = paywayAdjDateToTimestamptz(paywayRow.adj_dt || paywayRow.pay_dt);
  const result = await client.query(
    `UPDATE pg_settlements
     SET status = 'SETTLED', settled_at = COALESCE(settled_at, $2::timestamptz), updated_at = now()
     WHERE id = $1
       AND settled_at IS NULL
       AND status IN ('NORMAL_APPROVED', 'PENDING', 'APPROVED')
     RETURNING id, approval_no, pg_tx_id, settled_at`,
    [settlement.id, settledAt]
  );
  if (!result.rowCount) return null;
  await client.query(
    `INSERT INTO pg_notifications (
       provider, event_type, transaction_id, pg_transaction_id,
       result_code, result_message, payload, query, headers, processed
     ) VALUES ('CH PAYWAY', 'CH_PAYWAY_FALLBACK_SETTLED', $1, $2, 'OK', 'CH PAYWAY 정산완료 자동 확인', $3::jsonb, $4::jsonb, '{}'::jsonb, true)`,
    [settlement.approval_no, settlement.pg_tx_id, JSON.stringify(payload), JSON.stringify(payload)]
  );
  await client.query(
    `INSERT INTO pg_settlement_ch_checks (settlement_id, approval_no, pg_tx_id, last_checked_at, next_check_at, check_count, last_result, confirmed_at, updated_at)
     VALUES ($1, $2, $3, now(), NULL, 1, 'CONFIRMED', now(), now())
     ON CONFLICT (settlement_id) DO UPDATE SET
       last_checked_at = now(),
       next_check_at = NULL,
       check_count = pg_settlement_ch_checks.check_count + 1,
       last_result = 'CONFIRMED',
       last_error = NULL,
       confirmed_at = now(),
       updated_at = now()`,
    [settlement.id, settlement.approval_no, settlement.pg_tx_id]
  );
  return result.rows[0];
}

async function recordChPaywayCheckResult(client, settlement, result, errorMessage = '') {
  const createdAt = settlement.payment_created_at || settlement.created_at;
  await client.query(
    `INSERT INTO pg_settlement_ch_checks (settlement_id, approval_no, pg_tx_id, last_checked_at, next_check_at, check_count, last_result, last_error, updated_at)
     VALUES (
       $1, $2, $3, now(),
       CASE
         WHEN now() < $4::timestamptz + interval '10 minutes' THEN now() + interval '1 minute'
         WHEN now() < $4::timestamptz + interval '24 hours' THEN now() + interval '10 minutes'
         ELSE NULL
       END,
       1, $5, NULLIF($6, ''), now()
     )
     ON CONFLICT (settlement_id) DO UPDATE SET
       last_checked_at = now(),
       next_check_at = CASE
         WHEN now() < $4::timestamptz + interval '10 minutes' THEN now() + interval '1 minute'
         WHEN now() < $4::timestamptz + interval '24 hours' THEN now() + interval '10 minutes'
         ELSE NULL
       END,
       check_count = pg_settlement_ch_checks.check_count + 1,
       last_result = $5,
       last_error = NULLIF($6, ''),
       updated_at = now()`,
    [settlement.id, settlement.approval_no, settlement.pg_tx_id, createdAt, result, errorMessage]
  );
}

async function getChPaywayFallbackCandidates(limit = CH_PAYWAY_FALLBACK_BATCH_SIZE) {
  const result = await pool.query(
    `SELECT ps.id, ps.approval_no, ps.pg_tx_id, ps.franchise_name, ps.payment_amt, ps.svc_fee, ps.net_amt,
            ps.status, ps.created_at, t.created_at AS payment_created_at, t.auth_code,
            chk.next_check_at, chk.check_count
     FROM pg_settlements ps
     JOIN transactions t ON t.transaction_id = ps.approval_no
     LEFT JOIN pg_settlement_ch_checks chk ON chk.settlement_id = ps.id
     WHERE ps.settled_at IS NULL
       AND ps.status IN ('NORMAL_APPROVED', 'PENDING', 'APPROVED')
       AND t.created_at <= now() - interval '5 minutes'
       AND t.created_at >= now() - interval '24 hours'
       AND NULLIF(t.auth_code, '') IS NOT NULL
       AND (chk.confirmed_at IS NULL)
       AND (chk.next_check_at IS NULL OR chk.next_check_at <= now())
     ORDER BY t.created_at ASC, ps.id ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function checkOneSettlementWithChPayway(settlement) {
  const rows = await fetchChPaywayPaymentByAuthNo(settlement.auth_code, settlement.payment_created_at || settlement.created_at);
  const matched = rows.find(row => {
    const approved = Number(row.cancel_yn || 0) === 0;
    const settled = Number(row.adj_sta || 0) !== 0 && Number(row.adj_sta || 0) !== 9;
    const sameApproval = String(row.odrno || '') === String(settlement.approval_no || '');
    const samePgTx = String(row.tradeno || '') === String(settlement.pg_tx_id || '');
    const sameAuth = String(row.authno || '') === String(settlement.auth_code || '');
    const samePayment = numberFromPayway(row.amt) === Number(settlement.payment_amt || 0);
    const sameNet = Math.abs(numberFromPayway(row.adj_amt) - Number(settlement.net_amt || 0)) <= 1;
    return approved && settled && sameApproval && samePgTx && sameAuth && samePayment && sameNet;
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (matched) {
      const confirmed = await markSettlementConfirmedByChPayway(client, settlement, matched);
      await client.query('COMMIT');
      return { confirmed: Boolean(confirmed), row: matched };
    }
    await recordChPaywayCheckResult(client, settlement, rows.length ? 'NOT_SETTLED' : 'NOT_FOUND');
    await client.query('COMMIT');
    return { confirmed: false, row: null };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

let chPaywayFallbackRunning = false;
async function runChPaywayFallbackCheck() {
  if (!CH_PAYWAY_FALLBACK_ENABLED || !CH_PAYWAY_UID || !CH_PAYWAY_PW) return;
  if (chPaywayFallbackRunning) return;
  chPaywayFallbackRunning = true;
  try {
    const candidates = await getChPaywayFallbackCandidates();
    for (const settlement of candidates) {
      try {
        const result = await checkOneSettlementWithChPayway(settlement);
        if (result.confirmed) {
          console.log(`[ch-payway-fallback] confirmed approval=${settlement.approval_no} pgTx=${settlement.pg_tx_id}`);
        }
      } catch (err) {
        const client = await pool.connect();
        try {
          await recordChPaywayCheckResult(client, settlement, 'ERROR', err.message || String(err));
        } finally {
          client.release();
        }
        console.error(`[ch-payway-fallback] failed approval=${settlement.approval_no}:`, err.message || err);
      }
    }
  } finally {
    chPaywayFallbackRunning = false;
  }
}

function scheduleChPaywayFallbackCheck() {
  if (!CH_PAYWAY_FALLBACK_ENABLED) {
    console.log('[ch-payway-fallback] disabled');
    return;
  }
  if (!CH_PAYWAY_UID || !CH_PAYWAY_PW) {
    console.warn('[ch-payway-fallback] skipped: CH PAYWAY credentials missing');
    return;
  }
  setTimeout(() => void runChPaywayFallbackCheck(), 15 * 1000);
  setInterval(() => void runChPaywayFallbackCheck(), 60 * 1000);
  console.log('[ch-payway-fallback] scheduled every 60 seconds; per-settlement cadence 5-10m=1m, 10m+=10m');
}
app.use((err, req, res, next) => {
  handleError(err, res);
});

if (require.main === module) {
  dbBootstrapPromise
    .then(() => {
      scheduleCardGorillaDailyUpdate();
      scheduleChPaywayFallbackCheck();
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

function authenticateKakaoTxid(req, res, next) {
  const expected = String(process.env.KAKAO_TXID_TOKEN || '').trim();
  const provided = String(req.get('x-kakao-txid-token') || req.query?.token || '').trim();
  if (!expected || !provided) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Kakao TID token is required.');
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Kakao TID token is invalid.');
  }
  req.user = {
    id: null,
    role: 'admin',
    adminLevel: 'SYSTEM',
    loginId: 'kakao-txid-bot',
    name: 'Kakao TID Bot'
  };
  return next();
}


function auditActorFromRequest(req) {
  const user = req.user || {};
  const loginId = user.loginId || user.email || '';
  return {
    actorUserId: user.id || null,
    actorRole: user.role || user.adminLevel || '',
    actorLoginId: loginId,
    actorName: user.name || user.franchiseName || user.agencyName || loginId || ''
  };
}

function auditRequestMeta(req) {
  const forwardedFor = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return {
    requestMethod: req.method || '',
    requestPath: req.originalUrl || req.url || '',
    ipAddress: forwardedFor || req.ip || '',
    userAgent: String(req.headers?.['user-agent'] || '')
  };
}

function normalizeAuditNotificationCategory(category) {
  const key = String(category || '').trim();
  return AUDIT_NOTIFICATION_CATEGORY_SET.has(key) ? key : '';
}

function auditNotificationCategory(log = {}) {
  const entityType = String(log.entityType || log.entity_type || '').toLowerCase();
  const action = String(log.action || '').toUpperCase();
  if (entityType.includes('banner') || action.includes('BANNER')) return 'banners';
  if (entityType.includes('account') || action.includes('ACCOUNT')) return 'accounts';
  if (entityType.includes('inquiry') || action.includes('INQUIRY')) return 'inquiries';
  if (entityType.includes('franchise') || action.includes('FRANCHISE')) return 'franchises';
  if (entityType.includes('agency') || action.includes('AGENCY')) return 'agencies';
  if (entityType.includes('talk') || action.includes('TALK')) return 'talk';
  if (entityType.includes('notice') || entityType.includes('guide') || entityType.includes('faq') || action.includes('NOTICE') || action.includes('GUIDE') || action.includes('FAQ')) return 'boards';
  if (entityType.includes('installment') || action.includes('INSTALLMENT')) return 'installments';
  if (entityType.includes('admin') || action.includes('ADMIN_USER') || action.includes('ADMIN_PASSWORD')) return 'admins';
  if (entityType.includes('pg') || action.includes('PG_')) return 'pg';
  return 'system';
}

function auditNotificationTitle(log = {}) {
  const category = AUDIT_NOTIFICATION_CATEGORIES.find(item => item.key === auditNotificationCategory(log));
  return category ? `${category.label} 알림` : '관리자 변경 알림';
}

function auditNotificationBody(log = {}) {
  const actor = log.actorName || log.actorLoginId || '관리자';
  const target = log.entityName || log.entityId || log.entityType || '대상';
  const fields = Array.isArray(log.changedFields) && log.changedFields.length
    ? ` (${log.changedFields.slice(0, 3).join(', ')} 변경)`
    : '';
  return `${actor}님이 ${target} 항목을 변경했습니다.${fields}`;
}

async function notifyAuditLogRecipients(log) {
  if (!log?.id) return;
  const category = auditNotificationCategory(log);
  const actorLoginIdLower = String(log.actorLoginId || '').trim().toLowerCase();
  const recipientLoginId = (recipient) => String(recipient?.loginId || recipient?.email || '').trim().toLowerCase();
  let recipients = await repo.listAuditNotificationRecipients({
    category,
    actorUserId: actorLoginIdLower === SYSTEM_ADMIN_LOGIN_ID ? null : (log.actorUserId || null)
  });
  if (actorLoginIdLower === SYSTEM_ADMIN_LOGIN_ID) {
    recipients = recipients.filter(recipient => recipientLoginId(recipient) === SYSTEM_ADMIN_LOGIN_ID);
  }
  if (!recipients.length) return;
  const title = auditNotificationTitle(log);
  const body = auditNotificationBody(log);
  const data = {
    source: 'admin_audit',
    category,
    auditLogId: String(log.id),
    action: log.action || '',
    entityType: log.entityType || '',
    entityId: String(log.entityId || ''),
    targetScreen: 'admin-audit-logs'
  };
  for (const recipient of recipients) {
    try {
      await repo.createNotification({
        userId: recipient.id,
        type: 'ADMIN_AUDIT_LOG',
        title,
        body,
        data
      });
      await sendUserPushNotification(recipient.id, { title, body, data });
    } catch (err) {
      console.warn('[AUDIT_LOG_NOTIFICATION_FAILED]', {
        auditLogId: log.id,
        recipientId: recipient.id,
        message: err?.message || String(err)
      });
    }
  }
}

async function recordAuditLog(req, {
  action,
  entityType,
  entityId,
  entityName = '',
  beforeData = {},
  afterData = {},
  changedFields = null,
  force = false
}) {
  if (!action || !entityType) return null;
  const changeSet = Array.isArray(changedFields)
    ? {
        beforeData: sanitizeAuditData(beforeData || {}),
        afterData: sanitizeAuditData(afterData || {}),
        changedFields: changedFields.map(String)
      }
    : buildAuditChangeSet(beforeData || {}, afterData || {});
  if (!force && changeSet.changedFields.length === 0) return null;
  try {
    const log = await repo.createAuditLog({
      ...auditActorFromRequest(req),
      action,
      entityType,
      entityId,
      entityName,
      beforeData: changeSet.beforeData,
      afterData: changeSet.afterData,
      changedFields: changeSet.changedFields,
      ...auditRequestMeta(req)
    });
    notifyAuditLogRecipients(log).catch(err => {
      console.warn('[AUDIT_LOG_NOTIFICATION_FANOUT_FAILED]', {
        auditLogId: log?.id,
        message: err?.message || String(err)
      });
    });
    return log;
  } catch (err) {
    console.warn('[AUDIT_LOG_WRITE_FAILED]', {
      action,
      entityType,
      entityId,
      message: err?.message || String(err)
    });
    return null;
  }
}

function pickFranchiseAuditData(user) {
  if (!user) return {};
  return {
    id: user.id,
    franchiseId: user.franchiseId,
    loginId: user.loginId,
    contactEmail: user.contactEmail || '',
    franchiseName: user.franchiseName || '',
    ownerName: user.name || '',
    phone: user.phone || '',
    address: user.address || '',
    tel: user.tel || '',
    note: user.note || '',
    businessNumber: user.businessNumber || '',
    agencyId: user.agencyId || null,
    agencyName: user.agencyName || '',
    franchiseFeeRate: user.franchiseFeeRate == null ? null : Number(user.franchiseFeeRate),
    role: user.role || '',
    bizDocFileKey: user.bizDocFileKey || '',
    signupSource: user.signupSource || '',
    signupAgencyId: user.signupAgencyId || null,
    signupJoinCode: user.signupJoinCode || '',
    pgProviderId: user.pgProviderId || null,
    pgProviderName: user.pgProviderName || ''
  };
}

function pickAgencyAuditData(agency) {
  if (!agency) return {};
  return {
    id: agency.id,
    type: agency.type || '',
    level: agency.level == null ? null : Number(agency.level),
    parentId: agency.parentId || null,
    name: displayAgencyName(agency.name),
    loginId: agency.loginId || '',
    owner: agency.owner || '',
    phone: agency.phone || '',
    region: agency.region || agency.address || '',
    feeRate: agency.feeRate == null ? 0 : Number(agency.feeRate),
    deliveryNote: agency.deliveryNote || '',
    joinCode: agency.joinCode || ''
  };
}

function pickPgAssignmentRuleAuditData(rule) {
  if (!rule) return {};
  return {
    id: rule.id,
    name: rule.name || '',
    pgProviderId: rule.pgProviderId || null,
    pgProviderName: rule.pgProviderName || '',
    agencyId: rule.agencyId || null,
    agencyName: rule.agencyName || '',
    joinCode: rule.joinCode || '',
    startDate: rule.startDate || '',
    endDate: rule.endDate || '',
    weekdays: Array.isArray(rule.weekdays) ? rule.weekdays : [],
    priority: Number(rule.priority || 100),
    active: rule.active !== false,
    note: rule.note || ''
  };
}

function pickDeliveryAccountAuditData(account) {
  if (!account) return {};
  return {
    id: account.id,
    franchiseId: account.franchiseId,
    agencyId: account.agencyId || null,
    agencyName: account.agencyName || '',
    bankName: account.bankName || '',
    accountHolder: account.accountHolder || '',
    accountNo: account.accountNo || '',
    fileKey: account.fileKey || '',
    fileName: deliveryAccountDisplayFileName(account),
    accountStatus: account.accountStatus || account.status || '',
    txid: account.txid || '',
    active: account.active !== false,
    hidden: account.hidden === true
  };
}

function pickAccountRequestAuditData(request) {
  if (!request) return {};
  return {
    requestId: request.requestId,
    franchiseId: request.franchiseId,
    franchiseName: request.franchiseName || '',
    businessNumber: request.businessNumber || '',
    bankName: request.bankName || '',
    deliveryAgencyName: request.deliveryAgencyName || '',
    accountNo: request.accountNo || '',
    accountHolder: request.representativeName || '',
    status: request.status || '',
    documentUrl: request.documentUrl || '',
    documentOriginalName: request.documentOriginalName || '',
    assignedVirtualAccount: request.assignedVirtualAccount || null,
    txid: request.txid || '',
    active: request.active !== false,
    hidden: request.hidden === true
  };
}

function pickCardAuditData(card) {
  if (!card) return {};
  return {
    id: card.id,
    userId: card.userId || card.user_id || null,
    maskedNumber: card.maskedNumber || card.masked_number || '',
    cardName: card.cardName || card.card_name || '',
    cardCompany: card.cardCompany || card.card_company || '',
    alias: card.alias || '',
    pgProviderId: card.pgProviderId || card.pg_provider_id || null,
    active: card.active !== false,
    hidden: card.hidden === true
  };
}

function normalizePgNameForRouting(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function isGhPaymentsProviderName(value) {
  const normalized = normalizePgNameForRouting(value);
  return normalized === 'ghpayments' || normalized === 'ghpayment' || normalized === 'gh';
}

function isRouteupProviderName(value) {
  return avicxNormalizeProvider(value) === '위루트';
}

function pickRouteupBillingContract(account = {}, pgProvider = {}) {
  const contracts = sanitizePgContracts(account.pgContracts || account.pg_contracts || []);
  const contract = contracts.find(item =>
    normalizeProviderName(item.providerName) === '위루트' &&
    item.active !== false &&
    item.isDefault !== false &&
    item.tid &&
    item.paymentKey
  ) || contracts.find(item =>
    normalizeProviderName(item.providerName) === '위루트' &&
    item.active !== false &&
    item.tid &&
    item.paymentKey
  );
  if (!contract) return null;
  const mid = String(contract.mid || pgProvider?.mid || '').trim();
  if (!mid || !contract.tid || !contract.paymentKey) return null;
  return { ...contract, mid };
}

function pickRouteupCardRegistrationContract(account = {}, pgProvider = {}) {
  const contracts = (Array.isArray(account.pgContracts || account.pg_contracts) ? (account.pgContracts || account.pg_contracts) : [])
    .map(normalizePgContract);
  const contract = contracts.find(item =>
    normalizeProviderName(item.providerName) === '위루트' &&
    item.active !== false &&
    item.paymentKey
  );
  if (!contract) return null;
  const mid = String(contract.mid || pgProvider?.mid || '').trim();
  if (!mid || !contract.paymentKey) return null;
  return { ...contract, mid, tid: '' };
}

async function resolveAdminPgProvider(pgProviderId) {
  const raw = String(pgProviderId || '').trim();
  if (!raw) return null;
  const id = Number(raw);
  if (!Number.isFinite(id)) {
    const err = new Error('PG사 선택값이 올바르지 않습니다.');
    err.statusCode = 400;
    err.code = 'INVALID_PG_PROVIDER';
    throw err;
  }
  const providers = await repo.listPgProviders();
  const provider = providers.find(item => Number(item.id) === id);
  if (!provider) {
    const err = new Error('선택한 PG사를 찾을 수 없습니다.');
    err.statusCode = 404;
    err.code = 'PG_PROVIDER_NOT_FOUND';
    throw err;
  }
  if (provider.status !== '활성') {
    const err = new Error('활성 상태의 PG사만 가맹점에 지정할 수 있습니다.');
    err.statusCode = 409;
    err.code = 'PG_PROVIDER_NOT_ACTIVE';
    throw err;
  }
  return provider;
}

async function getUserPgProvider(user) {
  if (!user?.pgProviderId) return null;
  const providers = await repo.listPgProviders();
  return providers.find(item => Number(item.id) === Number(user.pgProviderId)) || null;
}

function currentKstDateInfo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).formatToParts(new Date());
  const year = parts.find(part => part.type === 'year')?.value || '1970';
  const month = parts.find(part => part.type === 'month')?.value || '01';
  const day = parts.find(part => part.type === 'day')?.value || '01';
  const date = `${year}-${month}-${day}`;
  const weekday = new Date(`${date}T00:00:00+09:00`).getDay();
  return { date, weekday };
}

function normalizePgAssignmentRulePayload(body = {}) {
  const weekdays = Array.isArray(body.weekdays)
    ? body.weekdays.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  return {
    name: String(body.name || '').trim(),
    pgProviderId: Number(body.pgProviderId),
    agencyId: body.agencyId ? Number(body.agencyId) : null,
    joinCode: String(body.joinCode || '').trim(),
    startDate: String(body.startDate || '').trim(),
    endDate: String(body.endDate || '').trim(),
    weekdays: [...new Set(weekdays)].sort((a, b) => a - b),
    priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100,
    active: body.active !== false,
    note: String(body.note || '').trim()
  };
}

async function validatePgAssignmentRule(rule) {
  if (!rule.name) {
    const error = new Error('규칙명은 필수입니다.');
    error.statusCode = 400;
    error.code = 'BAD_REQUEST';
    throw error;
  }
  if (!Number.isFinite(rule.pgProviderId)) {
    const error = new Error('PG사를 선택해 주세요.');
    error.statusCode = 400;
    error.code = 'INVALID_PG_PROVIDER';
    throw error;
  }
  const providers = await repo.listPgProviders();
  const provider = providers.find(item => Number(item.id) === Number(rule.pgProviderId));
  if (!provider) {
    const error = new Error('PG사를 찾을 수 없습니다.');
    error.statusCode = 404;
    error.code = 'PG_PROVIDER_NOT_FOUND';
    throw error;
  }
  if (rule.agencyId && !Number.isFinite(rule.agencyId)) {
    const error = new Error('대리점 선택값이 올바르지 않습니다.');
    error.statusCode = 400;
    error.code = 'INVALID_AGENCY_ID';
    throw error;
  }
  if (rule.startDate && rule.endDate && rule.startDate > rule.endDate) {
    const error = new Error('종료일은 시작일보다 빠를 수 없습니다.');
    error.statusCode = 400;
    error.code = 'INVALID_DATE_RANGE';
    throw error;
  }
  return rule;
}

async function resolveSignupPgProvider({ agencyId = null, joinCode = '' } = {}) {
  const [providers, rules] = await Promise.all([
    repo.listPgProviders(),
    repo.listPgAssignmentRules({ onlyActive: true })
  ]);
  const activeProviders = providers.filter(provider => provider.status === '활성');
  const providerById = new Map(activeProviders.map(provider => [String(provider.id), provider]));
  const { date, weekday } = currentKstDateInfo();
  const normalizedJoinCode = String(joinCode || '').trim().toLowerCase();
  const matchedRule = rules.find(rule => {
    if (!providerById.has(String(rule.pgProviderId))) return false;
    if (rule.agencyId && String(rule.agencyId) !== String(agencyId || '')) return false;
    if (rule.joinCode && rule.joinCode.toLowerCase() !== normalizedJoinCode) return false;
    if (rule.startDate && date < rule.startDate) return false;
    if (rule.endDate && date > rule.endDate) return false;
    if (Array.isArray(rule.weekdays) && rule.weekdays.length && !rule.weekdays.includes(weekday)) return false;
    return true;
  });
  const fallback = activeProviders
    .slice()
    .sort((a, b) => (Number(a.displayOrder || 0) - Number(b.displayOrder || 0)) || String(a.name || '').localeCompare(String(b.name || '')))[0] || null;
  const provider = matchedRule ? providerById.get(String(matchedRule.pgProviderId)) : fallback;
  return {
    provider: provider || null,
    rule: matchedRule || null,
    date,
    weekday
  };
}

function pickAdminAuditData(user) {
  if (!user) return {};
  return {
    id: user.id,
    loginId: user.loginId || user.email || '',
    name: user.name || '',
    adminLevel: normalizeAdminLevel(user.adminLevel),
    adminPermissions: normalizeAdminPermissions(user.adminPermissions, user.adminLevel),
    adminActive: user.adminActive !== false
  };
}

function serializeAuditLog(log) {
  return {
    id: log.id,
    actorUserId: log.actorUserId,
    actorRole: log.actorRole,
    actorLoginId: log.actorLoginId,
    actorName: log.actorName,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    entityName: log.entityName,
    beforeData: log.beforeData || {},
    afterData: log.afterData || {},
    changedFields: log.changedFields || [],
    requestMethod: log.requestMethod,
    requestPath: log.requestPath,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    createdAt: log.createdAt
  };
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
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weather_code,is_day');
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
  const hourly = payload?.hourly || {};
  const daily = payload?.daily || {};
  const code = current.weather_code;
  const hourlyForecast = Array.isArray(hourly.time) ? hourly.time.map((time, index) => {
    const hourlyCode = hourly.weather_code?.[index];
    return {
      time,
      weatherCode: Number.isFinite(Number(hourlyCode)) ? Number(hourlyCode) : null,
      weatherLabel: weatherCodeLabel(hourlyCode),
      weatherIcon: weatherCodeIcon(hourlyCode, hourly.is_day?.[index]),
      temperature: Number.isFinite(Number(hourly.temperature_2m?.[index])) ? Number(hourly.temperature_2m[index]) : null,
      precipitationProbability: Number.isFinite(Number(hourly.precipitation_probability?.[index])) ? Number(hourly.precipitation_probability[index]) : null
    };
  }).filter(item => item.time) : [];
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
    hourlyForecast,
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
  const storedCardName = String(enriched.cardCompany || '').trim();
  const hasRealStoredCard = Boolean(storedCardName && !['카드', '등록카드'].includes(storedCardName));
  const hasCard = Boolean(enriched.cardRegistered || hasRealStoredCard || enriched.cardLast4);

  if (hasCard) {
    enriched.cardRegistered = true;
    enriched.cardCompany = hasRealStoredCard ? storedCardName : enriched.cardCompany || '';
    enriched.cardLast4 = enriched.cardLast4 || '';
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

function isSystemAdminUser(user) {
  const login = String(user?.loginId || user?.email || '').trim().toLowerCase();
  return login === SYSTEM_ADMIN_LOGIN_ID;
}

function requireSystemAdminOnly(req, res, next) {
  if (!isSystemAdminUser(req.user)) {
    return sendError(res, 403, 'ACCESS_DENIED', '시스템 관리자 전용 메뉴입니다.');
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
  return String(value || '').replace(/[^0-9]/g, '') === TEST_BUSINESS_NUMBER;
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

function deliveryAccountStatusLabel(status, account = {}) {
  if (status === 'REJECTED') return '반려';
  if (hasAccountApprovalCredentials(account)) return '승인완료';
  if (status === 'APPROVED') return '승인대기';
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
    pgProviderId: user.pgProviderId || null,
    pgProviderName: user.pgProviderName || '',
    settleBankName: user.role === 'AGENCY' ? user.settleBankName || '' : '',
    settleAccountNo: user.role === 'AGENCY' ? user.settleAccountNo || '' : '',
    settleAccountHolder: user.role === 'AGENCY' ? user.settleAccountHolder || '' : '',
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
    .filter(item => ADMIN_MENU_PERMISSION_SET.has(item) && !SYSTEM_ADMIN_ONLY_MENU_PERMISSIONS.has(item));
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

function agencyTypeKeyForApi(agency = {}) {
  const raw = String(agency.type || agency.agencyType || '').trim().toLowerCase();
  if (raw === 'hq' || raw === 'head' || raw === 'headquarters' || raw === '본사') return 'hq';
  if (raw === 'bonbu' || raw === 'division' || raw === '본부') return 'bonbu';
  if (raw === 'branch' || raw === 'jisa' || raw === '지사') return 'jisa';
  if (raw === 'office' || raw === 'agency' || raw === 'jijum' || raw === '지점') {
    return Number(agency.level || 0) >= 3 ? 'jijum' : 'jisa';
  }
  const level = Number(agency.level || 0);
  if (level <= 1) return 'hq';
  if (level === 2) return 'bonbu';
  if (level === 3) return 'jisa';
  return 'jijum';
}

function agencyTypeLabelForApi(agency = {}) {
  const key = agencyTypeKeyForApi(agency);
  return ({ hq: '본사', bonbu: '본부', jisa: '지사', jijum: '지점' })[key] || '대리점';
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
  if (/^(419803|621003)/.test(value)) return 'IBK기업 BC카드';
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

function maskCardNumberForStorage(value, fallbackDigits = '', label = '카드') {
  const raw = String(value || '').trim();
  const fallback = String(fallbackDigits || '').replace(/[^0-9]/g, '');
  const rawDigits = raw.replace(/[^0-9]/g, '');
  const last4 = (rawDigits || fallback).slice(-4);
  const safeLabel = String(label || '카드').trim() || '카드';
  if (raw && /[*xX]/.test(raw) && rawDigits.length <= 8) return raw;
  return last4 ? `${safeLabel} (****-****-${last4})` : `${safeLabel} (****-****-****)`;
}

function normalizeProviderCardCompany(providerName, fallbackName, digits = '') {
  const inferred = inferCardName(digits);
  const raw = String(providerName || '').trim();
  const fallback = String(fallbackName || '').trim();
  const compact = raw.replace(/\s+/g, '').toLowerCase();
  if (inferred.startsWith('IBK기업')) return inferred;
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
  await pool.query("UPDATE financial_institutions SET active = false, updated_at = now() WHERE name = '저축은행'");
  const institutions = [...DEFAULT_FINANCIAL_INSTITUTIONS, ...ROUTEUP_FINANCIAL_INSTITUTIONS];
  for (const [index, item] of institutions.entries()) {
    await pool.query(
      `INSERT INTO financial_institutions (code, name, sort_order, active, icon_url)
       VALUES ($1, $2, $3, true, $4)
       ON CONFLICT (name) DO UPDATE SET
         code = EXCLUDED.code,
         sort_order = EXCLUDED.sort_order,
         active = true,
         icon_url = EXCLUDED.icon_url,
         updated_at = now()`,
      [item.code, item.name, index + 1, item.iconUrl || '']
    );
  }
  await pool.query("UPDATE financial_institutions SET active = false, updated_at = now() WHERE name = '저축은행'");
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

async function ghPaymentsRequest(pathname, { method = 'GET', body, payKey: payKeyOverride } = {}) {
  if (!hasGhPaymentsPayKey()) {
    throw new Error('GH_PAYMENTS_PAY_KEY is required for GH Payments integration.');
  }

  const payKey = String(payKeyOverride || getGhPaymentsPayKey(pathname)).trim();
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

async function routeupRequest(pathname, { method = 'GET', body, payKey } = {}) {
  const authorization = String(payKey || '').trim();
  if (!authorization) {
    const err = new Error('ROUTEUP_PAYMENT_KEY_REQUIRED');
    err.code = 'ROUTEUP_PAYMENT_KEY_REQUIRED';
    throw err;
  }
  const headers = {
    Authorization: authorization,
    Accept: 'application/json'
  };
  const init = { method, headers };
  if (body !== undefined && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return fetch(`${ROUTEUP_API_BASE_URL}${pathname}`, init);
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








































































































































































