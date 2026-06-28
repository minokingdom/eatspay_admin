// ==========================================
// eats PAY - App Navigation & Interaction
// ==========================================

'use strict';

// --- State ---
const state = {
  currentScreen: 'splash',
  history: [],
  splashTimer: null,
  smsTimer: null,
  smsCountdown: 180,
  smsVerificationPhone: '',
  legalDocumentsReady: false,
  formData: {
    bizNumber: '',
    userId: '',
    password: '',
    phone: '',
    storeName: '',
    ceoName: '',
    address: '',
    tel: '',
    terms: { all: false, usage: false, privacy: false }
  }
};

// --- DOM Helpers ---
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const API_BASE_URL = ((window.EATSPAY_CONFIG && window.EATSPAY_CONFIG.API_BASE_URL) || '').replace(/\/$/, '');
const KAKAO_MAP_JS_KEY = (window.EATSPAY_CONFIG && window.EATSPAY_CONFIG.KAKAO_MAP_JS_KEY) || '';
const CHARGE_DEPOSIT_RATE = 0.956;
function normalizeSelectedAgency(value) {
  const name = String(value || '').trim();
  return (!name || name === '직접입력' || name === 'more') ? '생각대로' : name;
}
let selectedAgency = normalizeSelectedAgency(sessionStorage.getItem('selectedDeliveryAgency'));
sessionStorage.setItem('selectedDeliveryAgency', selectedAgency);
let agencySettlementPage = 1;
let deliveryAgencyCache = [];
let friendlyDeliveryCache = [];
let friendlyDeliveryMetaCache = null;
let friendlyDeliveryCacheAt = 0;
let friendlyDeliveryPrefetchPromise = null;
let friendlyDeliveryPrefetchKey = '';
let benefitCardSearchCache = [];
let appBannerCache = [];
let weatherCache = null;
let weatherCacheKey = '';
let weatherCacheAt = 0;
let installmentPolicyCache = [];
let faqCache = [];
let activeFaqCategory = '';
let noticeCache = [];
let noticePage = 1;
let guideCache = [];
let paymentHistoryCache = [];
let pendingChargePaymentDraft = null;
const chargeRequirementAlertShown = {
  card: false,
  vaccount: false,
  pendingVaccount: false
};
let installmentBannerIndex = 0;
let installmentBannerTimer = null;
let partnerBannerIndex = 0;
let partnerBannerTimer = null;
let daumPostcodeScriptPromise = null;
let kakaoMapScriptPromise = null;
let leafletMapScriptPromise = null;
let cardEditDraft = null;
let cardManageFilter = 'visible';
let vaccountManageFilter = 'visible';
let talkPostCache = [];
let talkImageFiles = [];
let selectedTalkPostId = null;
let selectedTalkChatId = null;
let activeTalkStatusFilter = 'ALL';
let talkBoardPage = 1;
let homeTalkPage = 1;
const TALK_BOARD_PAGE_SIZE = 5;
const talkCommentCache = new Map();
let talkReplyTargetComment = null;
const HOME_PARTNER_AD_ITEMS = [
  ['배달대행사 가맹점 모집', '사장님 매장에 맞는 대행사를 연결해드려요'],
  ['사장님 전용 사업자카드 혜택', '배달대행비 결제에 맞춘 카드 혜택 안내'],
  ['홈택스 사업용 카드 등록 안내', '매입 내역 관리를 더 편하게 준비하세요'],
  ['배달앱 매출 정산/세무 상담', '배달앱 매출과 정산 흐름을 함께 점검해요'],
  ['포스/키오스크 렌탈', '매장 운영 장비를 합리적으로 비교하세요'],
  ['배달 포장재/봉투/용기', '매장에 필요한 소모품을 제휴가로 안내'],
  ['배달 오토바이 보험/렌탈', '라이더 운영에 필요한 상품을 확인하세요'],
  ['노무/4대보험 상담', '직원 관리와 신고 업무를 전문가와 상담']
];
let talkViewerPosition = null;
let talkLocationRequestStarted = false;
let certifiedLocationRequestPromise = null;
let talkChatPollTimer = null;
let talkChatAudioContext = null;
let lastTalkMessageSignature = '';
let talkMessageSoundUnlocked = false;
let pushRegistrationStarted = false;
let inAppNotificationTimer = null;
let notificationPollTimer = null;
let notificationPollingStarted = false;
const REGISTER_DRAFT_KEY = 'eatspay.registerDraft';
const AGENCY_INVITE_SESSION_KEY = 'eatspay.agencyInvite';
const APP_LAST_ACTIVE_KEY = 'eatspay.lastActiveAt';
const APP_STANDARD_RESUME_HOME_MS = 10 * 60 * 1000;
const APP_RESUME_HOME_EXCLUDE_SCREENS = new Set(['splash', 'location-setup', 'login', 'account-status', 'reg-step1', 'reg-step2', 'reg-step3', 'reg-step4']);
const EXTERNAL_FLOW_KEY = 'eatspay.externalFlow';
const PENDING_PUSH_ROUTE_KEY = 'eatspay.pendingPushRoute';
const GLOBAL_CERTIFIED_LOCATION_KEY = 'eatspay.certifiedLocation';
let pendingLocationGateTarget = 'home';
let lastHapticAt = 0;

function appHaptic(type = 'tap') {
  const now = Date.now();
  if (now - lastHapticAt < 70) return;
  lastHapticAt = now;
  const patterns = {
    tap: 12,
    soft: 8,
    medium: 18,
    success: [12, 36, 18],
    warning: [18, 42, 18]
  };
  const pattern = patterns[type] || patterns.tap;
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (_) {
    // Haptic feedback is optional and must never block app interactions.
  }
}

function getHapticTypeForElement(element) {
  const target = element?.closest?.(
    'button, .btn-primary, .btn-secondary, .nav-item, .talk-status-filter-chip, .talk-page-btn, .talk-board-card, .talk-chat-row, .talk-item, .card-item, .app-chip, [data-haptic]'
  );
  if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return '';
  const explicit = target.getAttribute('data-haptic');
  if (explicit) return explicit;
  if (target.matches('.btn-primary, #btn-talk-chat-send, #btn-login, #btn-register-complete')) return 'medium';
  if (target.matches('.nav-item, .talk-status-filter-chip, .talk-page-btn, .app-chip')) return 'soft';
  return 'tap';
}

function loadDaumPostcodeScript() {
  if (window.daum?.Postcode) return Promise.resolve();
  if (daumPostcodeScriptPromise) return daumPostcodeScriptPromise;
  daumPostcodeScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('주소 검색 서비스를 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
  return daumPostcodeScriptPromise;
}

function loadKakaoMapScript() {
  if (window.kakao?.maps) {
    return new Promise(resolve => window.kakao.maps.load(resolve));
  }
  if (!KAKAO_MAP_JS_KEY) {
    return Promise.reject(new Error('카카오 지도 키가 설정되지 않았습니다.'));
  }
  if (kakaoMapScriptPromise) return kakaoMapScriptPromise;
  kakaoMapScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => reject(new Error('카카오 지도 응답 시간이 초과되었습니다.')), 6000);
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_MAP_JS_KEY)}&libraries=services&autoload=false`;
    script.async = true;
    script.onload = () => {
      clearTimeout(timeout);
      if (window.kakao?.maps) window.kakao.maps.load(resolve);
      else reject(new Error('카카오 지도를 불러오지 못했습니다.'));
    };
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('카카오 지도를 불러오지 못했습니다.'));
    };
    document.head.appendChild(script);
  });
  return kakaoMapScriptPromise;
}

function loadLeafletMapAssets() {
  if (window.L?.map) return Promise.resolve();
  if (leafletMapScriptPromise) return leafletMapScriptPromise;
  leafletMapScriptPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet-map]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.setAttribute('data-leaflet-map', 'true');
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    const timeout = setTimeout(() => reject(new Error('지도를 불러오는 시간이 초과되었습니다.')), 7000);
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.onload = () => {
      clearTimeout(timeout);
      if (window.L?.map) resolve();
      else reject(new Error('지도를 불러오지 못했습니다.'));
    };
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('지도를 불러오지 못했습니다.'));
    };
    document.head.appendChild(script);
  });
  return leafletMapScriptPromise;
}

function renderFriendlyMapFallback(container, agency, lat, lng, message = '카카오 지도 JavaScript 키가 필요합니다.') {
  if (!container) return;
  container.innerHTML = `
    ${buildFriendlyMapTilePreview(lat, lng, agency?.name || '배달대행사')}
    ${message ? `
      <div style="position:absolute; left:10px; top:10px; right:10px; background:rgba(255,255,255,.94); border:1px solid var(--card-border); border-radius:var(--radius); padding:7px 9px; font-size:11px; font-weight:900; color:#2f7d32; line-height:1.35; box-shadow:var(--card-shadow);">
        ${escapeHtml(message)}
      </div>
    ` : ''}
  `;
}

async function renderFriendlyInteractiveMap(container, agency, lat, lng) {
  if (!container) return;
  container.innerHTML = '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#6f7d6b; font-size:12px; font-weight:900;">지도를 불러오는 중입니다.</div>';
  try {
    await loadLeafletMapAssets();
    container.innerHTML = '';
    const map = window.L.map(container, {
      center: [lat, lng],
      zoom: 16,
      zoomControl: true,
      attributionControl: false
    });
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);
    const marker = window.L.divIcon({
      className: '',
      html: `
        <div class="friendly-map-marker-pulse" aria-hidden="true">
          <span class="friendly-map-pulse-ring"></span>
          <span class="friendly-map-pulse-ring friendly-map-pulse-ring-delay"></span>
          <span class="friendly-map-pin"></span>
        </div>
      `,
      iconSize: [42, 42],
      iconAnchor: [21, 21]
    });
    window.L.marker([lat, lng], { icon: marker })
      .addTo(map)
      .bindTooltip(agency?.name || '배달대행사', {
        permanent: false,
        direction: 'top',
        offset: [0, -18]
      });
    setTimeout(() => map.invalidateSize(), 120);
  } catch (error) {
    renderFriendlyMapFallback(container, agency, lat, lng, error.message || '지도를 표시하지 못했습니다.');
  }
}

async function resolveFriendlyLocationAddress(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return '';
  await loadKakaoMapScript();
  return new Promise(resolve => {
    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.coord2Address(Number(lng), Number(lat), (result, status) => {
      if (status !== window.kakao.maps.services.Status.OK || !result?.length) {
        resolve('');
        return;
      }
      const road = result[0]?.road_address?.address_name || '';
      const jibun = result[0]?.address?.address_name || '';
      resolve(road || jibun || '');
    });
  });
}

let legalDocumentCache = null;

function setLegalDocumentContent(type, doc) {
  const target = type === 'terms' ? $('#term-usage-content') : $('#term-privacy-content');
  if (!target) return;
  if (!doc?.content) return;
  const title = doc.title ? `${doc.title}\n\n` : '';
  target.textContent = `${title}${doc.content}`;
}

async function loadActiveLegalDocuments() {
  const usageBox = $('#term-usage-content');
  const privacyBox = $('#term-privacy-content');
  state.legalDocumentsReady = false;
  if (usageBox && !legalDocumentCache) usageBox.textContent = '서비스 이용약관을 불러오는 중입니다.';
  if (privacyBox && !legalDocumentCache) privacyBox.textContent = '개인정보처리방침을 불러오는 중입니다.';

  try {
    if (!legalDocumentCache) {
      const response = await fetch(apiUrl(`/api/legal-documents/active?_=${Date.now()}`), { cache: 'no-store' });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(getFriendlyErrorMessage(err, '약관을 불러오지 못했습니다.'));
      }
      const payload = await response.json();
      legalDocumentCache = Array.isArray(payload.data) ? payload.data : [];
    }
    const terms = legalDocumentCache.find(doc => doc.type === 'terms');
    const privacy = legalDocumentCache.find(doc => doc.type === 'privacy');
    setLegalDocumentContent('terms', terms);
    setLegalDocumentContent('privacy', privacy);
    if (!terms && usageBox) usageBox.textContent = '현재 적용된 서비스 이용약관이 없습니다. 관리자페이지에서 약관을 활성화해주세요.';
    if (!privacy && privacyBox) privacyBox.textContent = '현재 적용된 개인정보처리방침이 없습니다. 관리자페이지에서 문서를 활성화해주세요.';
    state.legalDocumentsReady = !!(terms?.content && privacy?.content);
  } catch (error) {
    console.error('Failed to load legal documents:', error);
    state.legalDocumentsReady = false;
    if (usageBox) usageBox.textContent = '서비스 이용약관을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
    if (privacyBox) privacyBox.textContent = '개인정보처리방침을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
    showToast(error.message || '약관을 불러오지 못했습니다.');
  }
}

async function renderFriendlyKakaoMap(container, agency, lat, lng) {
  if (!container) return;
  if (isNativeApp()) {
    await renderFriendlyInteractiveMap(container, agency, lat, lng);
    return;
  }
  container.innerHTML = '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#6f7d6b; font-size:12px; font-weight:900;">카카오 지도를 불러오는 중입니다.</div>';
  try {
    await loadKakaoMapScript();
    const center = new window.kakao.maps.LatLng(lat, lng);
    const map = new window.kakao.maps.Map(container, {
      center,
      level: 3
    });
    const markerPulse = new window.kakao.maps.CustomOverlay({
      position: center,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 3,
      content: `
        <div class="friendly-map-marker-pulse" aria-hidden="true">
          <span class="friendly-map-pulse-ring"></span>
          <span class="friendly-map-pulse-ring friendly-map-pulse-ring-delay"></span>
          <span class="friendly-map-pin"></span>
        </div>
      `
    });
    markerPulse.setMap(map);
    setTimeout(() => {
      window.kakao.maps.event.trigger(map, 'resize');
      map.setCenter(center);
    }, 80);
  } catch (error) {
    await renderFriendlyInteractiveMap(container, agency, lat, lng);
  }
}

async function openAddressSearch(input) {
  if (!input) return;
  persistRegisterDraft(true);
  try {
    await loadDaumPostcodeScript();
    new window.daum.Postcode({
      oncomplete(data) {
        const road = data.roadAddress || '';
        const jibun = data.jibunAddress || '';
        const zonecode = data.zonecode ? `(${data.zonecode}) ` : '';
        input.value = `${zonecode}${road || jibun}`.trim();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        $('#reg-address-detail')?.focus();
        persistRegisterDraft(false);
      }
    }).open();
  } catch (err) {
    input.removeAttribute('readonly');
    input.focus();
    showToast('주소 검색을 불러오지 못했습니다. 주소를 직접 입력해 주세요.');
  }
}
let vaccountPhotoState = {
  name: '',
  url: '',
  source: '',
  file: null
};
let bizLicenseFileState = {
  name: '',
  url: '',
  source: '',
  file: null
};
let photoSheetTarget = 'vaccount';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CARD_COMPANY_LOGOS = [
  { keys: ['롯데', 'lotte'], file: '롯데카드.jpg' },
  { keys: ['삼성', 'samsung'], file: '삼성카드.jpg' },
  { keys: ['신한', 'shinhan'], file: '신한카드.jpg' },
  { keys: ['우리', 'woori'], file: '우리카드.jpg' },
  { keys: ['하나', 'hana'], file: '하나카드.jpg' },
  { keys: ['현대', 'hyundai'], file: '현대카드.jpg' },
  { keys: ['국민', 'kb', 'kb국민'], file: '국민카드.jpg' },
  { keys: ['농협', 'nh'], file: '농협카드.png' },
  { keys: ['비씨', 'bc'], file: '비씨카드.jpg' },
  { keys: ['비자', 'visa'], file: '비자.jpg' },
  { keys: ['마스터', 'master'], file: '마스터카드.jpg' }
];
const CARD_COMPANY_LOGO_VERSION = '20260623_crop';

function normalizeCardCompanyName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/카드/g, '')
    .replace(/card/g, '');
}

function getCardCompanyLogoUrl(value) {
  const normalized = normalizeCardCompanyName(value);
  if (!normalized) return '';
  const matched = CARD_COMPANY_LOGOS.find(item => item.keys.some(key => normalized.includes(normalizeCardCompanyName(key))));
  return matched ? `assets/cards/${encodeURIComponent(matched.file)}?v=${CARD_COMPANY_LOGO_VERSION}` : '';
}

function renderCardCompanyLogo(value, options = {}) {
  const label = String(value || '카드').trim();
  const src = getCardCompanyLogoUrl(label);
  const width = options.width || 76;
  const height = options.height || 32;
  const radius = options.radius || 6;
  if (!src) {
    return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:${width}px;height:${height}px;border:1px solid #d7ead9;background:#fff;border-radius:${radius}px;padding:0 8px;font-size:12px;font-weight:900;color:#1554a8;line-height:1;white-space:nowrap;">${escapeHtml(label.replace(/\s+/g, ''))}</span>`;
  }
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${width}px;height:${height}px;border:1px solid #d7ead9;background:#fff;border-radius:${radius}px;padding:1px 0 1px 3px;overflow:hidden;vertical-align:middle;"><img src="${src}" alt="${escapeHtml(label)}" style="width:100%;height:100%;object-fit:contain;display:block;"></span>`;
}

const API_ERROR_MESSAGES = {
  INVALID_CREDENTIALS: '아이디 또는 비밀번호가 올바르지 않습니다.',
  UNAUTHORIZED: '로그인이 필요합니다. 다시 로그인해 주세요.',
  ACCESS_DENIED: '접근 권한이 없습니다.',
  BAD_REQUEST: '입력값을 다시 확인해 주세요.',
  USER_NOT_FOUND: '사용자 정보를 찾을 수 없습니다.',
  CARD_NOT_FOUND: '카드 정보를 찾을 수 없습니다.',
  MISSING_CARD_COMPANY: '카드사를 선택해 주세요.',
  MISSING_ALIAS: '카드 별칭을 입력해 주세요.',
  INVALID_CARD_NUMBER: '카드가 등록되지 않았습니다. 카드번호를 다시 입력해 주세요.',
  GH_PAYMENTS_CARD_REGISTRATION_FAILED: '카드 정보를 다시 확인해주세요.\n카드번호, 유효기간, 비밀번호 앞 2자리, CVC 정보가 올바른지 확인 후 다시 등록해주세요.',
  GH_PAYMENTS_BILLING_PAY_FAILED: '결제를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  ACCOUNT_NOT_FOUND: '가상계좌 정보를 찾을 수 없습니다.',
  ACCOUNT_LIMIT_EXCEEDED: '가상계좌 등록 제한을 확인해 주세요.',
  DOCUMENT_FILE_REQUIRED: '포스 사진을 첨부해 주세요.',
  MISSING_FIELDS: '필수 항목을 모두 입력해 주세요.',
  INVALID_CURRENT_PASSWORD: '현재 비밀번호가 일치하지 않습니다.'
};

function getFriendlyErrorMessage(payload, fallback = '요청을 처리하지 못했습니다.') {
  const code = payload?.error?.code || payload?.code || '';
  if (code && API_ERROR_MESSAGES[code]) return API_ERROR_MESSAGES[code];

  const raw = String(payload?.error?.message || payload?.message || payload || '').trim();
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('load failed') ||
    normalized.includes('fetch failed')
  ) {
    return '서버 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (normalized.includes('invalid email or password')) return API_ERROR_MESSAGES.INVALID_CREDENTIALS;
  if (normalized.includes('valid bearer token') || normalized.includes('unauthorized')) return API_ERROR_MESSAGES.UNAUTHORIZED;
  if (normalized.includes('card details')) return '카드 정보를 모두 입력해 주세요.';
  if (normalized.includes('card company')) return API_ERROR_MESSAGES.MISSING_CARD_COMPANY;
  if (normalized.includes('card was not found')) return API_ERROR_MESSAGES.CARD_NOT_FOUND;
  if (normalized.includes('virtual account') && normalized.includes('not found')) return API_ERROR_MESSAGES.ACCOUNT_NOT_FOUND;
  if (normalized.includes('required') || normalized.includes('missing')) return API_ERROR_MESSAGES.MISSING_FIELDS;
  if (/^[\x00-\x7F\s.,'":;!?()/-]+$/.test(raw)) return fallback;
  return raw;
}

function renderChargeCards(selector, cards) {
  const safeCards = (Array.isArray(cards) ? cards : []).filter(card => card?.active !== false && card?.hidden !== true);
  if (safeCards.length === 0) {
    selector.innerHTML = `
      <div class="charge-empty-box full-grid">
        <span>등록된 카드가 없습니다.</span>
        <button type="button" id="charge-card-empty-add" class="charge-empty-action">카드등록</button>
      </div>
    `;
    $('#charge-card-empty-add', selector)?.addEventListener('click', () => navigate('card-add'));
    return;
  }
  selector.innerHTML = safeCards.map((card, index) => {
    const isPrimary = index === 0;
    const borderColor = isPrimary ? '#3a9430' : 'var(--border-color)';
    const label = card.cardCompany || card.cardName || card.alias || '\uCE74\uB4DC';
    const logo = renderCardCompanyLogo(label, { width: 62, height: 26, radius: 7 });
    const alias = String(card.alias || '').trim();
    const aliasLabel = alias && alias !== label && !['카드', 'Card', 'card'].includes(alias) ? alias : '';
    const masked = card.maskedNumber || '****-****-****-0000';
    return `
      <div class="charge-card-option${isPrimary ? ' active' : ''}" data-card="${escapeHtml(card.id)}" style="border-color:${borderColor};">
        <div class="charge-card-head">
          <span class="charge-card-dot"></span>
          ${logo}
          ${aliasLabel ? `<span class="charge-card-alias">${escapeHtml(aliasLabel)}</span>` : ''}
        </div>
        <div class="charge-card-number">${escapeHtml(masked)}</div>
      </div>
    `;
  }).join('');

  const cardOptions = $$('.charge-card-option', selector);
  cardOptions.forEach(opt => {
    opt.addEventListener('click', function() {
      cardOptions.forEach(o => {
        o.classList.remove('active');
        o.style.borderColor = 'var(--border-color)';
      });
      this.classList.add('active');
      this.style.borderColor = '#3a9430';
    });
  });
}

function renderChargeVaccounts(selector, accounts) {
  const approvedAccounts = (Array.isArray(accounts) ? accounts : []).filter(isApprovedVaccount);

  if (approvedAccounts.length === 0) {
    selector.innerHTML = `
      <div class="charge-empty-box">
        <span>승인완료된 가상계좌가 없습니다.</span>
        <button type="button" id="charge-vaccount-empty-add" class="charge-empty-action">계좌등록</button>
      </div>
    `;
    $('#charge-vaccount-empty-add', selector)?.addEventListener('click', () => navigate('vaccount-add'));
    return;
  }

  selector.innerHTML = approvedAccounts.map((account, index) => {
    const isPrimary = index === 0;
    const agency = account.agencyName || account.agency || '배달대행사';
    const bank = account.bankName || '은행 미입력';
    const accountNo = account.accountNo || '계좌번호 미입력';
    const holder = account.accountHolder || account.franchiseName || getLoginDisplayName();
    return `
      <div class="charge-vaccount-option${isPrimary ? ' active' : ''}" data-account-id="${escapeHtml(account.id)}" data-account-source="${escapeHtml(account.source || 'account_request')}" data-account-txid="${escapeHtml(account.txid || '')}" data-agency="${escapeHtml(agency)}" data-bank="${escapeHtml(bank)}" data-account="${escapeHtml(accountNo)}" style="border-color:${isPrimary ? '#3a9430' : 'var(--card-border)'};">
        <div class="charge-vaccount-agency">
          <span>${escapeHtml(agency)}</span>
        </div>
        <div class="charge-vaccount-info">
          <span class="charge-vaccount-bank">${escapeHtml(bank)}</span>
          <span class="charge-vaccount-number">${escapeHtml(accountNo)}</span>
          <span class="charge-vaccount-holder">${escapeHtml(holder)}</span>
        </div>
      </div>
    `;
  }).join('');

  const vaccountOptions = $$('.charge-vaccount-option', selector);
  vaccountOptions.forEach(opt => {
    opt.addEventListener('click', function() {
      vaccountOptions.forEach(o => {
        o.classList.remove('active');
        o.style.borderColor = 'var(--border-color)';
      });
      this.classList.add('active');
      this.style.borderColor = '#3a9430';
    });
  });
}

function normalizeCardDisplay(card) {
  const rawMasked = String(card.maskedNumber || '****-****-****-0000').trim();
  const match = rawMasked.match(/^(.+?)\s*\(([^)]+)\)$/);
  const name = String(card.cardCompany || card.cardName || (match ? match[1] : '') || '카드').trim();
  const masked = match ? match[2].trim() : rawMasked;
  return { name, masked };
}

async function showCardViewDialog(card) {
  const display = normalizeCardDisplay(card);
  const expiryMonth = String(card.expiryMonth || '').padStart(2, '0').slice(-2);
  const expiryYear = String(card.expiryYear || '').slice(-2);
  const expiryLabel = expiryMonth && expiryYear ? `${expiryMonth}/${expiryYear}` : '등록 정보 없음';
  const activeLabel = card.active === false ? '비활성' : '활성';
  const activeColor = card.active === false ? '#777' : '#2e7d32';
  const logo = renderCardCompanyLogo(display.name, { width: 84, height: 34, radius: 8 });
  await showAppHtmlAlert(`
    <div class="app-info-dialog">
      <div class="app-info-summary-card">
        <div class="app-info-summary-head">
          <span class="app-info-type-chip">카드</span>
          <span class="app-info-state-chip" style="color:${activeColor};">${activeLabel}</span>
        </div>
        <div class="app-info-title-row">${logo}<span>${escapeHtml(display.name)}</span></div>
        <div class="app-info-subtitle">${escapeHtml(card.alias || display.name)}</div>
        <div class="app-info-mono">${escapeHtml(display.masked)}</div>
      </div>
      <div class="app-info-grid">
        <span>카드별칭</span><strong>${escapeHtml(card.alias || display.name)}</strong>
        <span>카드번호</span><strong class="mono">${escapeHtml(display.masked)}</strong>
        <span>유효기간</span><strong>${escapeHtml(expiryLabel)}</strong>
        <span>상태</span><strong style="color:${activeColor};">${activeLabel}</strong>
      </div>
    </div>
  `, '카드 확인');
}

function startCardAliasEdit(card) {
  if (!card) return;
  cardEditDraft = { ...card, aliasOnly: true };
  navigate('card-add');
  setTimeout(applyCardEditDraftToForm, 0);
}

function sortManageItems(items, dateKey = 'createdAt') {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    if ((a.active !== false) !== (b.active !== false)) return a.active === false ? 1 : -1;
    return new Date(b[dateKey] || b.requestedAt || 0) - new Date(a[dateKey] || a.requestedAt || 0);
  });
}

async function toggleCardActive(cardId, active) {
  const response = await fetch(apiUrl(`/api/card/${encodeURIComponent(cardId)}/active`), {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ active })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(getFriendlyErrorMessage(payload, '카드 상태 변경에 실패했습니다.'));
  }
}

async function toggleCardHidden(cardId, hidden) {
  const response = await fetch(apiUrl(`/api/card/${encodeURIComponent(cardId)}/hidden`), {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ hidden })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(getFriendlyErrorMessage(payload, '카드 숨김 상태 변경에 실패했습니다.'));
  }
}

function renderManageFilterChips(kind, currentFilter) {
  const labels = [
    ['all', '전체'],
    ['visible', '보이기'],
    ['hidden', '숨기기']
  ];
  return `
    <div class="${kind}-manage-filter manage-filter">
      ${labels.map(([value, label]) => `
        <button type="button" class="manage-filter-chip${currentFilter === value ? ' active' : ''}" data-${kind}-filter="${value}">${label}</button>
      `).join('')}
    </div>
  `;
}

function filterManageItems(items, filter) {
  const list = Array.isArray(items) ? items : [];
  if (filter === 'hidden') return list.filter(item => item.hidden === true);
  if (filter === 'visible') return list.filter(item => item.hidden !== true);
  return list;
}

function bindManageFilterChips(container, kind) {
  $$(`[data-${kind}-filter]`, container).forEach(btn => {
    btn.addEventListener('click', async () => {
      const value = btn.getAttribute(`data-${kind}-filter`) || 'visible';
      if (kind === 'card') {
        cardManageFilter = value;
        await refreshCardList();
      } else {
        vaccountManageFilter = value;
        await refreshVaccountList();
      }
    });
  });
}

function renderCardList(cards) {
  const container = $('#card-items-container');
  if (!container) return;
  const filteredCards = filterManageItems(cards, cardManageFilter);

  if (!Array.isArray(cards) || cards.length === 0) {
    container.innerHTML = `
      ${renderManageFilterChips('card', cardManageFilter)}
      <div class="manage-empty-danger">
        <span>등록된 카드가 없습니다.</span>
        <button type="button" id="card-list-empty-add" class="manage-empty-action">카드등록</button>
      </div>
    `;
    $('#card-list-empty-add', container)?.addEventListener('click', () => navigate('card-add'));
    bindManageFilterChips(container, 'card');
    return;
  }

  if (!filteredCards.length) {
    container.innerHTML = `
      ${renderManageFilterChips('card', cardManageFilter)}
      <div class="manage-empty-muted">선택한 조건의 카드가 없습니다.</div>
    `;
    bindManageFilterChips(container, 'card');
    return;
  }

  const sortedCards = sortManageItems(filteredCards, 'createdAt');
  container.innerHTML = renderManageFilterChips('card', cardManageFilter) + sortedCards.map(card => {
    const display = normalizeCardDisplay(card);
    const aliasText = String(card.alias || '').trim();
    const cardName = escapeHtml(display.name);
    const primaryName = escapeHtml(aliasText || display.name);
    const logo = renderCardCompanyLogo(display.name, { width: 74, height: 30, radius: 8 });
    const masked = escapeHtml(display.masked);
    const isActive = card.active !== false;
    const isHidden = card.hidden === true;
    return `
      <div class="card-list-item manage-item${isHidden ? ' is-hidden' : (!isActive ? ' is-disabled' : '')}" data-card-id="${escapeHtml(card.id)}">
        <button class="btn-card-view manage-view-btn" type="button" aria-label="카드 확인">
          <div class="manage-main-row">
            ${logo}
            <div class="manage-text-stack">
              <span class="manage-name">${primaryName}</span>
              <span class="manage-mono">${masked}</span>
              <span class="manage-sub">${cardName}</span>
            </div>
          </div>
        </button>
        <div class="manage-actions">
          <button class="btn-card-active-toggle manage-mini-btn${isActive ? ' is-active' : ''}" type="button" data-next-active="${isActive ? 'false' : 'true'}">${isActive ? '활성' : '비활성'}</button>
          <button class="btn-card-hidden-toggle manage-mini-btn${isHidden ? ' is-active' : ' is-danger'}" type="button" data-next-hidden="${isHidden ? 'false' : 'true'}">${isHidden ? '보이기' : '숨기기'}</button>
        </div>
      </div>
    `;
  }).join('');

  bindManageFilterChips(container, 'card');
  $$('.btn-card-view', container).forEach((btn, index) => {
    btn.addEventListener('click', () => {
      const card = sortedCards[index];
      if (card) startCardAliasEdit(card);
    });
  });
  $$('.btn-card-active-toggle', container).forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = btn.closest('.card-list-item');
      const cardId = item?.getAttribute('data-card-id');
      if (!cardId) return;
      const nextActive = btn.getAttribute('data-next-active') === 'true';
      const message = nextActive
        ? '이 카드를 활성으로 변경합니다.\n충전 화면에 다시 노출됩니다.'
        : '이 카드를 비활성으로 변경합니다.\n충전 화면에는 노출되지 않습니다.';
      if (!(await showAppConfirm(message, '카드 상태 변경'))) return;

      try {
        await toggleCardActive(cardId, nextActive);
        showToast(nextActive ? '카드가 활성화되었습니다.' : '카드가 비활성화되었습니다.');
        await refreshCardList();
      } catch (err) {
        showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
      }
    });
  });
  $$('.btn-card-hidden-toggle', container).forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = btn.closest('.card-list-item');
      const cardId = item?.getAttribute('data-card-id');
      if (!cardId) return;
      const nextHidden = btn.getAttribute('data-next-hidden') === 'true';
      const message = nextHidden
        ? '이 카드를 숨깁니다.\n관리 화면에서는 숨기기 필터에서 다시 볼 수 있고, 충전 화면에는 노출되지 않습니다.'
        : '이 카드를 다시 보이게 합니다.';
      if (!(await showAppConfirm(message, '카드 숨김 변경'))) return;

      try {
        await toggleCardHidden(cardId, nextHidden);
        showToast(nextHidden ? '카드가 숨김 처리되었습니다.' : '카드가 다시 표시됩니다.');
        await refreshCardList();
      } catch (err) {
        showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
      }
    });
  });
}

async function refreshCardList() {
  const container = $('#card-items-container');
  if (!container) return;
  if (!isAuthenticated()) {
    container.innerHTML = '<div class="inline-status">로그인이 필요합니다.</div>';
    return;
  }
  container.innerHTML = '<div class="inline-spinner-wrap"><div class="spinner" style="border-top-color: var(--green-primary); width: 28px; height: 28px; margin: 0 auto;"></div></div>';
  try {
    const response = await fetch(apiUrl('/api/card/list'), {
      headers: { 'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}` }
    });
    if (!response.ok) throw new Error('카드 목록을 불러오지 못했습니다.');
    const payload = await response.json();
    renderCardList(Array.isArray(payload.data) ? payload.data : []);
  } catch (err) {
    container.innerHTML = `<div class="inline-status error">${escapeHtml(err.message)}</div>`;
  }
}

function getVaccountStatusMeta(account) {
  const raw = String(account.status || account.accountStatus || account.statusLabel || '').trim();
  const reason = String(account.rejectReason || account.rejectionReason || account.memo || '').trim();
  const normalized = raw.toUpperCase();
  const hasTxid = Boolean(String(account.txid || '').trim());
  if (normalized.includes('REJECT') || raw.includes('반려') || raw.includes('거절')) {
    return {
      key: 'rejected',
      label: reason ? `반려 · ${reason}` : '반려'
    };
  }
  if (normalized.includes('APPROV') || raw.includes('승인완료') || raw.includes('정상승인')) {
    return hasTxid ? { key: 'approved', label: '승인완료' } : { key: 'pending', label: '승인대기' };
  }
  return { key: 'pending', label: '승인대기' };
}

function renderVaccountList(accounts) {
  const container = $('#vaccount-items-container');
  if (!container) return;
  const filteredAccounts = filterManageItems(accounts, vaccountManageFilter);

  if (!Array.isArray(accounts) || accounts.length === 0) {
    container.innerHTML = `
      ${renderManageFilterChips('vaccount', vaccountManageFilter)}
      <div class="manage-empty-danger">
        <span>등록된 가상계좌가 없습니다.</span>
        <button type="button" id="vaccount-list-empty-add" class="manage-empty-action">계좌등록</button>
      </div>
    `;
    $('#vaccount-list-empty-add', container)?.addEventListener('click', () => navigate('vaccount-add'));
    bindManageFilterChips(container, 'vaccount');
    return;
  }

  if (!filteredAccounts.length) {
    container.innerHTML = `
      ${renderManageFilterChips('vaccount', vaccountManageFilter)}
      <div class="manage-empty-muted">선택한 조건의 가상계좌가 없습니다.</div>
    `;
    bindManageFilterChips(container, 'vaccount');
    return;
  }

  const sortedAccounts = sortManageItems(filteredAccounts, 'requestedAt');
  container.innerHTML = renderManageFilterChips('vaccount', vaccountManageFilter) + sortedAccounts.map(account => {
    const agency = escapeHtml(account.agencyName || '미등록');
    const bank = escapeHtml(account.bankName || '은행 미입력');
    const accountNo = escapeHtml(account.accountNo || '미입력');
    const holder = escapeHtml(account.accountHolder || account.franchiseName || getLoginDisplayName());
    const statusMeta = getVaccountStatusMeta(account);
    const isActive = account.active !== false;
    const isHidden = account.hidden === true;
    return `
      <div class="vaccount-list-item manage-item${isHidden ? ' is-hidden' : (!isActive ? ' is-disabled' : '')}" data-account-id="${escapeHtml(account.id)}" data-account-source="${escapeHtml(account.source || 'account_request')}">
        <button class="btn-vaccount-view manage-view-btn" type="button" aria-label="가상계좌 확인">
          <span class="manage-kicker">배달대행사명</span>
          <div class="manage-main-row">
            <div class="manage-agency-stack">
              <span class="manage-agency-badge">${agency}</span>
            </div>
            <div class="manage-text-stack">
              <span class="manage-name-row">
                <span class="manage-name">${bank}</span>
                <span class="manage-status-chip ${statusMeta.key}">${escapeHtml(statusMeta.label)}</span>
              </span>
              <span class="manage-mono">${accountNo}</span>
              <span class="manage-sub">${holder}</span>
            </div>
          </div>
        </button>
        <div class="manage-actions">
          <button class="btn-vaccount-active-toggle manage-mini-btn${isActive ? ' is-active' : ''}" type="button" data-next-active="${isActive ? 'false' : 'true'}">${isActive ? '활성' : '비활성'}</button>
          <button class="btn-vaccount-hidden-toggle manage-mini-btn${isHidden ? ' is-active' : ' is-danger'}" type="button" data-next-hidden="${isHidden ? 'false' : 'true'}">${isHidden ? '보이기' : '숨기기'}</button>
        </div>
      </div>
    `;
  }).join('');

  bindManageFilterChips(container, 'vaccount');
  $$('.btn-vaccount-view', container).forEach((btn, index) => {
    btn.addEventListener('click', () => {
      const account = sortedAccounts[index];
      if (account) void showVaccountViewDialog(account);
    });
  });
  $$('.btn-vaccount-active-toggle', container).forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = btn.closest('.vaccount-list-item');
      const accountId = item?.getAttribute('data-account-id');
      const source = item?.getAttribute('data-account-source') || 'account_request';
      if (!accountId) return;
      const nextActive = btn.getAttribute('data-next-active') === 'true';
      const message = nextActive
        ? '이 가상계좌를 활성으로 변경합니다.\n충전 화면에 다시 노출됩니다.'
        : '이 가상계좌를 비활성으로 변경합니다.\n충전 화면에는 노출되지 않습니다.';
      if (!(await showAppConfirm(message, '가상계좌 상태 변경'))) return;

      try {
        await toggleVaccountActive(accountId, source, nextActive);
        showToast(nextActive ? '가상계좌가 활성화되었습니다.' : '가상계좌가 비활성화되었습니다.');
        await refreshVaccountList();
      } catch (err) {
        showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
      }
    });
  });
  $$('.btn-vaccount-hidden-toggle', container).forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = btn.closest('.vaccount-list-item');
      const accountId = item?.getAttribute('data-account-id');
      const source = item?.getAttribute('data-account-source') || 'account_request';
      if (!accountId) return;
      const nextHidden = btn.getAttribute('data-next-hidden') === 'true';
      const message = nextHidden
        ? '이 가상계좌를 숨깁니다.\n관리 화면에서는 숨기기 필터에서 다시 볼 수 있고, 충전 화면에는 노출되지 않습니다.'
        : '이 가상계좌를 다시 보이게 합니다.';
      if (!(await showAppConfirm(message, '가상계좌 숨김 변경'))) return;

      try {
        await toggleVaccountHidden(accountId, source, nextHidden);
        showToast(nextHidden ? '가상계좌가 숨김 처리되었습니다.' : '가상계좌가 다시 표시됩니다.');
        await refreshVaccountList();
      } catch (err) {
        showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
      }
    });
  });
}

async function refreshVaccountList() {
  const container = $('#vaccount-items-container');
  if (!container) return;
  if (!isAuthenticated()) {
    container.innerHTML = '<div class="inline-status">로그인이 필요합니다.</div>';
    return;
  }
  container.innerHTML = '<div class="inline-spinner-wrap"><div class="spinner" style="border-top-color: var(--green-primary); width: 28px; height: 28px; margin: 0 auto;"></div></div>';
  try {
    const response = await fetch(apiUrl('/api/franchise/accounts'), {
      headers: { 'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}` }
    });
    if (!response.ok) throw new Error('가상계좌 목록을 불러오지 못했습니다.');
    const payload = await response.json();
    renderVaccountList(Array.isArray(payload.data) ? payload.data : []);
  } catch (err) {
    container.innerHTML = `<div class="inline-status error">${escapeHtml(err.message)}</div>`;
  }
}

async function fetchVaccountsFromDb() {
  const response = await fetch(apiUrl('/api/franchise/accounts'), {
    headers: { 'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}` }
  });
  if (!response.ok) throw new Error('가상계좌 목록을 확인하지 못했습니다.');
  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

async function showVaccountViewDialog(account) {
  const agency = account.agencyName || '미등록';
  const bank = account.bankName || '은행 미입력';
  const accountNo = account.accountNo || '미입력';
  const holder = account.accountHolder || account.franchiseName || getLoginDisplayName();
  const statusMeta = getVaccountStatusMeta(account);
  const activeLabel = account.active === false ? '비활성' : '활성';
  const activeColor = account.active === false ? '#777' : '#2e7d32';
  await showAppHtmlAlert(`
    <div class="app-info-dialog">
      <div class="app-info-summary-card">
        <div class="app-info-summary-head">
          <span class="app-info-type-chip danger">${escapeHtml(agency)}</span>
          <span class="app-info-state-chip" style="color:${activeColor};">${activeLabel}</span>
        </div>
        <div class="app-info-title-row">${escapeHtml(bank)}</div>
        <div class="app-info-mono break">${escapeHtml(accountNo)}</div>
        <div class="app-info-subtitle">${escapeHtml(holder)}</div>
      </div>
      <div class="app-info-grid">
        <span>배달대행사</span><strong>${escapeHtml(agency)}</strong>
        <span>은행</span><strong>${escapeHtml(bank)}</strong>
        <span>계좌번호</span><strong class="mono break">${escapeHtml(accountNo)}</strong>
        <span>예금주/상호</span><strong>${escapeHtml(holder)}</strong>
        <span>승인상태</span><strong>${escapeHtml(statusMeta.label)}</strong>
        <span>노출상태</span><strong style="color:${activeColor};">${activeLabel}</strong>
      </div>
    </div>
  `, '가상계좌 확인');
}

async function toggleVaccountActive(accountId, source, active) {
  const response = await fetch(apiUrl(`/api/franchise/accounts/${encodeURIComponent(accountId)}/active?source=${encodeURIComponent(source || 'account_request')}`), {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ active })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(getFriendlyErrorMessage(payload, '가상계좌 상태 변경에 실패했습니다.'));
  }
}

async function toggleVaccountHidden(accountId, source, hidden) {
  const response = await fetch(apiUrl(`/api/franchise/accounts/${encodeURIComponent(accountId)}/hidden?source=${encodeURIComponent(source || 'account_request')}`), {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ hidden })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(getFriendlyErrorMessage(payload, '가상계좌 숨김 상태 변경에 실패했습니다.'));
  }
}

function isApprovedVaccount(account) {
  const hasTxid = Boolean(String(account?.txid || '').trim());
  return (
    account.active !== false &&
    account.hidden !== true &&
    hasTxid &&
    (account.status === 'APPROVED' || account.accountStatus === 'APPROVED' || account.statusLabel === '승인완료')
  );
}

function isPendingVaccount(account) {
  return (
    account.status === 'PENDING' ||
    account.accountStatus === 'PENDING' ||
    account.statusLabel === '승인대기' ||
    account.statusLabel === '승인 대기'
  );
}

async function fetchApprovedVaccountsFromDb() {
  const accounts = await fetchVaccountsFromDb();
  return accounts.filter(isApprovedVaccount);
}

async function refreshChargeCardOptions() {
  const selector = $('#charge-card-selector');
  if (!selector) return [];

  const accessToken = getAuthToken();
  try {
    const response = await fetch(apiUrl('/api/card/list'), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error('card list request failed');
    }

    const payload = await response.json();
    const cards = Array.isArray(payload.data) ? payload.data : [];
    renderChargeCards(selector, cards);
    return cards.filter(card => card.active !== false);
  } catch (err) {
    selector.innerHTML = '<div style="grid-column:1 / -1; padding:18px 14px; text-align:center; color:#e53935; font-weight:800;">카드 목록을 불러오지 못했습니다.</div>';
    return [];
  }
}

async function refreshChargeVaccountOptions() {
  const selector = $('#charge-vaccount-selector');
  if (!selector) return [];

  const accessToken = sessionStorage.getItem('accessToken') || '';
  try {
    const response = await fetch(apiUrl('/api/franchise/accounts'), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error('virtual account list request failed');
    }

    const payload = await response.json();
    const accounts = Array.isArray(payload.data) ? payload.data : [];
    renderChargeVaccounts(selector, accounts);
    return accounts.filter(isApprovedVaccount);
  } catch (err) {
    selector.innerHTML = '<div style="padding:18px 14px; text-align:center; color:#e53935; font-weight:800;">가상계좌 목록을 불러오지 못했습니다.</div>';
    return [];
  }
}

async function refreshChargePaymentOptions() {
  const cardSelector = $('#charge-card-selector');
  const accountSelector = $('#charge-vaccount-selector');
  if (cardSelector) {
    cardSelector.innerHTML = '<div style="grid-column:1 / -1; padding:18px 14px; text-align:center;"><div class="spinner" style="border-top-color: var(--green-primary); width: 26px; height: 26px; margin: 0 auto;"></div></div>';
  }
  if (accountSelector) {
    accountSelector.innerHTML = '<div style="padding:18px 14px; text-align:center;"><div class="spinner" style="border-top-color: var(--green-primary); width: 26px; height: 26px; margin: 0 auto;"></div></div>';
  }

  const [cards, approvedAccounts] = await Promise.all([
    refreshChargeCardOptions(),
    refreshChargeVaccountOptions()
  ]);

  if (!isAuthenticated() || state.currentScreen !== 'charge') return;

  if (!(cards || []).length) {
    if (!chargeRequirementAlertShown.card) {
      chargeRequirementAlertShown.card = true;
      await showAppAlert('등록된 카드가 없습니다. 카드등록을 먼저 진행해주세요.', '카드 등록 필요');
      if (state.currentScreen === 'charge') navigate('card-add');
    }
    return;
  }
  chargeRequirementAlertShown.card = false;

  if (!approvedAccounts.length) {
    const accounts = await fetchVaccountsFromDb();
    if (accounts.some(isPendingVaccount)) {
      if (!chargeRequirementAlertShown.pendingVaccount) {
        chargeRequirementAlertShown.pendingVaccount = true;
        await showAppAlert('가상계좌 승인 대기중입니다. 관리자 승인 후 결제를 진행할 수 있습니다.', '승인 대기중');
      }
      return;
    }
    if (!chargeRequirementAlertShown.vaccount) {
      chargeRequirementAlertShown.vaccount = true;
      await showAppAlert('승인완료된 가상계좌가 없습니다. 계좌등록을 먼저 진행해주세요.', '가상계좌 등록 필요');
      if (state.currentScreen === 'charge') navigate('vaccount-add');
    }
  } else {
    chargeRequirementAlertShown.vaccount = false;
    chargeRequirementAlertShown.pendingVaccount = false;
  }
}

function apiUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function getActiveAppBanner(type) {
  const now = Date.now();
  return (appBannerCache || [])
    .filter(banner => (banner.type || '메인') === type && (banner.status || '활성') === '활성')
    .filter(banner => {
      const start = banner.startAt ? new Date(banner.startAt).getTime() : null;
      const end = banner.endAt ? new Date(banner.endAt).getTime() : null;
      return (!Number.isFinite(start) || start <= now) && (!Number.isFinite(end) || end >= now);
    })
    .sort((a, b) => Number((a.order ?? a.displayOrder) || 0) - Number((b.order ?? b.displayOrder) || 0))[0] || null;
}

function ensureAppBannerSlot(type) {
  const id = `app-banner-${type}`;
  let slot = $(`#${id}`);
  if (slot) return slot;
  slot = document.createElement('div');
  slot.id = id;
  slot.className = 'app-managed-banner-slot';
  slot.dataset.bannerType = type;
  const place = {
    '메인': { parent: '#screen-home .scrollable-content', before: '#home-coway-banner' },
    '결제': { parent: '#screen-charge .scrollable-content', before: '#screen-charge .scrollable-content > div:first-child' },
    '이츠톡': { parent: '#screen-talk .screen-content', before: '.talk-screen-panel' },
    '고객센터': { parent: '#screen-cs-main .cs-main-content', before: '.cs-main-contact' }
  }[type];
  const parent = place ? $(place.parent) : null;
  if (!parent) return null;
  const before = place.before ? $(place.before, parent) || $(place.before) : null;
  if (before && before.parentNode === parent) parent.insertBefore(slot, before);
  else parent.prepend(slot);
  return slot;
}

function renderAppBanner(type) {
  const slot = ensureAppBannerSlot(type);
  if (!slot) return;
  const banner = getActiveAppBanner(type);
  const defaultHomeBenefitBanner = type === '메인' ? $('#home-coway-banner') : null;
  if (!banner) {
    slot.innerHTML = '';
    slot.style.display = 'none';
    if (defaultHomeBenefitBanner) defaultHomeBenefitBanner.style.display = '';
    return;
  }
  slot.style.display = 'block';
  if (defaultHomeBenefitBanner) defaultHomeBenefitBanner.style.display = 'none';
  if (banner.imageUrl) {
    slot.innerHTML = `
      <button type="button" class="app-managed-banner app-managed-banner-image-card" data-banner-url="${escapeHtml(banner.url || '')}" data-banner-image-url="${escapeHtml(banner.imageUrl || '')}" data-banner-detail-image-url="${escapeHtml(banner.detailImageUrl || '')}" data-banner-title="${escapeHtml(banner.title || '')}" data-banner-detail-title="${escapeHtml(banner.detailTitle || banner.title || '')}" style="width:calc(100% - 32px); margin:0 16px 16px; border:1.5px solid var(--card-border); border-radius:var(--radius); background:#fff; box-shadow:var(--card-shadow); padding:0; display:block; text-align:left; cursor:pointer; overflow:hidden;">
        <img class="app-managed-banner-image app-managed-banner-full-image" src="${escapeHtml(banner.imageUrl)}" alt="${escapeHtml(banner.title || '')}" style="width:100%; aspect-ratio:45/8; display:block; object-fit:cover;">
      </button>`;
    return;
  }
  const hasBannerUrl = !!String(banner.url || '').trim();
  slot.innerHTML = `
    <button type="button" class="app-managed-banner" data-banner-url="${escapeHtml(banner.url || '')}" data-banner-title="${escapeHtml(banner.detailTitle || banner.title || '')}" data-banner-subtitle="${escapeHtml(banner.detailSubtitle || banner.subtitle || '')}" data-banner-detail-image-url="${escapeHtml(banner.detailImageUrl || '')}" style="width:calc(100% - 32px); margin:0 16px 16px; border:1.5px solid var(--card-border); border-radius:var(--radius); background:linear-gradient(135deg,#f8fff6 0%,#eaf8e8 100%); box-shadow:var(--card-shadow); padding:13px 14px; display:flex; align-items:center; gap:12px; text-align:left; cursor:pointer; overflow:hidden;">
      <span style="width:42px;height:42px;border-radius:14px;background:#3a9430;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;flex:0 0 42px;">EP</span>
      <span style="min-width:0; flex:1; display:flex; flex-direction:column; gap:3px;">
        <span style="font-size:14px;font-weight:900;color:#12351b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(banner.title || '')}</span>
        <span style="font-size:11px;font-weight:800;color:var(--text-secondary);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(banner.subtitle || '')}</span>
      </span>
      ${hasBannerUrl ? '<span style="color:#3a9430;font-size:18px;font-weight:900;">›</span>' : ''}
    </button>`;
}

function renderAppBanners() {
  ['메인', '결제', '이츠톡', '고객센터'].forEach(renderAppBanner);
}

async function fetchAppBanners() {
  try {
    const response = await fetch(apiUrl(`/api/banners?_=${Date.now()}`), { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw new Error('배너를 불러오지 못했습니다.');
    appBannerCache = Array.isArray(payload.data) ? payload.data : [];
  } catch (err) {
    appBannerCache = [];
  }
  renderAppBanners();
}

function restoreAppBannerImage(button) {
  if (!button) return;
  if (button._bannerFlipTimer) {
    clearTimeout(button._bannerFlipTimer);
    button._bannerFlipTimer = null;
  }
  const image = button.querySelector('.app-managed-banner-full-image');
  const defaultUrl = String(button.dataset.bannerImageUrl || '').trim();
  if (image && defaultUrl) {
    image.src = defaultUrl;
    image.alt = button.dataset.bannerTitle || '';
  }
  button.classList.remove('is-detail');
}

function toggleAppBannerDetail(button) {
  if (!button) return;
  if (button.classList.contains('is-detail')) {
    restoreAppBannerImage(button);
    return;
  }
  const image = button.querySelector('.app-managed-banner-full-image');
  const detailUrl = String(button.dataset.bannerDetailImageUrl || '').trim();
  if (!image || !detailUrl) return;
  image.src = detailUrl;
  image.alt = button.dataset.bannerDetailTitle || button.dataset.bannerTitle || '';
  button.classList.add('is-detail');
  if (button._bannerFlipTimer) clearTimeout(button._bannerFlipTimer);
  button._bannerFlipTimer = setTimeout(() => restoreAppBannerImage(button), 10000);
}

function openAppBannerUrl(url) {
  const target = String(url || '').trim();
  if (!target) return;
  const normalized = target.replace(/^https?:\/\/[^/]+/i, '');
  const routeMap = {
    '/charge': 'charge',
    '/benefit-cards': 'benefit-cards',
    '/card-benefit-search': 'card-benefit-search',
    '/talk': 'talk',
    '/cs-main': 'cs-main',
    '/cs': 'cs-main',
    '/payment-history': 'payment-history',
    '/friendly-delivery': 'friendly-delivery'
  };
  const hashTarget = normalized.startsWith('/#') ? normalized.slice(2) : '';
  const route = routeMap[normalized] || routeMap[`/${hashTarget}`];
  if (route) {
    navigate(route);
    return;
  }
  if (/^https?:\/\//i.test(target)) {
    window.open(target, '_blank', 'noopener');
  }
}

function refreshKakaoAdFitBanner() {
  const slot = $('#home-kakao-adfit-banner .kakao_ad_area');
  if (!slot) return;
  try {
    if (window.kakao_ad_area && typeof window.kakao_ad_area.reload === 'function') {
      window.kakao_ad_area.reload();
      return;
    }
    const existing = document.querySelector('script[data-eatspay-kakao-adfit]');
    if (!existing) {
      const script = document.createElement('script');
      script.async = true;
      script.dataset.eatspayKakaoAdfit = '1';
      script.src = 'https://t1.kakaocdn.net/kas/static/ba.min.js';
      document.body.appendChild(script);
    }
  } catch (error) {
    console.warn('Kakao AdFit refresh skipped', error);
  }
}

function renderHomePartnerAd(index = partnerBannerIndex) {
  const item = HOME_PARTNER_AD_ITEMS[index % HOME_PARTNER_AD_ITEMS.length];
  const node = $('#home-partner-flip-item');
  const title = $('#home-partner-flip-title');
  const desc = $('#home-partner-flip-desc');
  if (title) title.textContent = item[0];
  if (desc) desc.textContent = item[1];
  if (node) {
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';
  }
}

function startHomePartnerAdRotation() {
  const item = $('#home-partner-flip-item');
  if (!item) return;
  renderHomePartnerAd();
  if (partnerBannerTimer) return;
  partnerBannerTimer = setInterval(() => {
    item.classList.add('is-changing');
    window.setTimeout(() => {
      partnerBannerIndex = (partnerBannerIndex + 1) % HOME_PARTNER_AD_ITEMS.length;
      renderHomePartnerAd();
      item.classList.remove('is-changing');
    }, 180);
  }, 3000);
}

function renderHomeWeather(data = null, { loading = false } = {}) {
  const icon = $('#home-weather-icon');
  const title = $('#home-weather-title');
  const desc = $('#home-weather-desc');
  const temp = $('#home-weather-temp');
  if (!icon || !title || !desc || !temp) return;
  if (loading) {
    icon.textContent = '⛅';
    title.textContent = '현재 위치 날씨를 확인 중입니다';
    desc.textContent = '잠시만 기다려주세요';
    temp.textContent = '--°';
    return;
  }
  if (!data) {
    icon.textContent = '⛅';
    title.textContent = '현재 위치 날씨를 준비 중입니다';
    desc.textContent = '위치 확인 후 오늘 날씨를 보여드릴게요';
    temp.textContent = '--°';
    return;
  }
  const location = String(data.location || '현재 위치').replace(/\s+/g, ' ').trim();
  const label = data.weatherLabel || '날씨 확인';
  const temperature = Number(data.temperature);
  const apparent = Number(data.apparentTemperature);
  const rain = Number(data.precipitation);
  icon.textContent = data.weatherIcon || '⛅';
  title.textContent = `${location} ${label}`;
  const apparentText = Number.isFinite(apparent) ? `체감 ${Math.round(apparent)}°` : '';
  const rainText = Number.isFinite(rain) && rain > 0 ? `강수 ${rain}mm` : '강수 없음';
  desc.textContent = [apparentText, rainText].filter(Boolean).join(' · ') || '현재 위치 기준 날씨입니다';
  temp.textContent = Number.isFinite(temperature) ? `${Math.round(temperature)}°` : '--°';
}

function formatWeatherDateLabel(value, index = 0) {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return index === 0 ? '오늘' : String(value || '-');
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const label = `${date.getMonth() + 1}/${date.getDate()}(${weekdays[date.getDay()]})`;
  return index === 0 ? `오늘 ${label}` : label;
}

function formatWeatherDegree(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number)}°` : '--°';
}

async function openHomeWeatherDetail() {
  let data = weatherCache;
  if (!data) {
    data = await fetchHomeWeather();
  }
  if (!data) {
    await showAppAlert('현재 위치 날씨를 아직 가져오지 못했습니다. 잠시 후 다시 눌러주세요.', '날씨');
    return;
  }
  const forecast = Array.isArray(data.forecast) ? data.forecast.slice(0, 7) : [];
  const currentRows = [
    ['현재 기온', formatWeatherDegree(data.temperature)],
    ['체감 온도', formatWeatherDegree(data.apparentTemperature)],
    ['강수량', Number.isFinite(Number(data.precipitation)) ? `${Number(data.precipitation)}mm` : '강수 없음'],
    ['풍속', Number.isFinite(Number(data.windSpeed)) ? `${Number(data.windSpeed).toFixed(1)}m/s` : '-']
  ];
  const forecastHtml = forecast.length ? forecast.map((item, index) => `<div class="weather-detail-day"><span class="weather-detail-day-icon">${escapeHtml(item.weatherIcon || '⛅')}</span><span class="weather-detail-day-main"><strong>${escapeHtml(formatWeatherDateLabel(item.date, index))}</strong><em>${escapeHtml(item.weatherLabel || '날씨 확인')}</em></span><span class="weather-detail-day-sub"><strong>${escapeHtml(formatWeatherDegree(item.minTemperature))} / ${escapeHtml(formatWeatherDegree(item.maxTemperature))}</strong><em>강수 ${Number.isFinite(Number(item.precipitationProbability)) ? `${Math.round(Number(item.precipitationProbability))}%` : '-'}</em></span></div>`).join('') : '<div class="weather-detail-empty">주간 예보를 준비 중입니다.</div>';

  await showAppHtmlAlert(`
    <div class="weather-detail-dialog">
      <div class="weather-detail-hero">
        <span class="weather-detail-icon">${escapeHtml(data.weatherIcon || '⛅')}</span>
        <div>
          <strong>${escapeHtml(data.location || '현재 위치')}</strong>
          <em>${escapeHtml(data.weatherLabel || '날씨 확인')} · ${escapeHtml(formatWeatherDegree(data.temperature))}</em>
        </div>
      </div>
      <div class="weather-detail-grid">
        ${currentRows.map(([label, value]) => `
          <div class="weather-detail-stat">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </div>
        `).join('')}
      </div>
      <div class="weather-detail-title">일주일 예보</div>
      <div class="weather-detail-list">${forecastHtml}</div>
    </div>
  `, '오늘 날씨');
}

async function fetchHomeWeather(position = getSavedFriendlyDeliveryPosition()) {
  const lat = Number(position?.coords?.latitude);
  const lng = Number(position?.coords?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    renderHomeWeather({
      location: '현재 위치',
      weatherLabel: '위치 확인 필요',
      weatherIcon: '⌖',
      temperature: null,
      apparentTemperature: null,
      precipitation: null
    });
    return null;
  }
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (weatherCache && weatherCacheKey === key && Date.now() - weatherCacheAt < 10 * 60 * 1000) {
    renderHomeWeather(weatherCache);
    return weatherCache;
  }
  renderHomeWeather(null, { loading: true });
  try {
    const response = await fetch(apiUrl(`/api/weather/current?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`), { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw new Error(getFriendlyErrorMessage(payload, '날씨 정보를 가져오지 못했습니다.'));
    weatherCache = payload.data || null;
    weatherCacheKey = key;
    weatherCacheAt = Date.now();
    renderHomeWeather(weatherCache);
    return weatherCache;
  } catch (err) {
    renderHomeWeather({
      location: position?.savedAddress || '현재 위치',
      weatherLabel: '날씨 준비 중',
      weatherIcon: '⛅',
      temperature: null,
      apparentTemperature: null,
      precipitation: null
    });
    return null;
  }
}

function renderInstallmentBanner(items) {
  const policies = (Array.isArray(items) ? items : [])
    .filter(item => item && item.active !== false && Array.isArray(item.months) && item.months.length)
    .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
  installmentPolicyCache = policies;
  installmentBannerIndex = 0;
  renderCurrentInstallmentBanner();
  startInstallmentBannerRotation();
}

function renderCurrentInstallmentBanner() {
  const bannerName = $('#home-banner-name');
  const bannerSubtitle = $('#home-banner-subtitle');
  const logoWrap = $('#home-banner-card-logos');
  const slide = $('#home-installment-slide');

  if (!installmentPolicyCache.length) {
    stopInstallmentBannerRotation();
    if (logoWrap) logoWrap.innerHTML = '';
    if (bannerName) bannerName.textContent = '무이자할부 정책이 없습니다.';
    if (bannerSubtitle) bannerSubtitle.textContent = '관리자에서 이번 달 무이자 할부 정책을 설정해주세요.';
    return;
  }

  const item = installmentPolicyCache[installmentBannerIndex % installmentPolicyCache.length];
  const months = [...item.months].map(Number).sort((a, b) => a - b);
  const maxMonth = months[months.length - 1];
  const name = String(item.cardCompany || '카드').trim();
  if (logoWrap) {
    logoWrap.innerHTML = renderCardCompanyLogo(name, { width: 100, height: 34, radius: 4 });
  }
  if (bannerName) {
    bannerName.textContent = item.cardCompany || name;
  }
  if (bannerSubtitle) {
    bannerSubtitle.textContent = `무이자할부 최대 ${maxMonth}개월`;
  }
  if (slide) {
    slide.classList.remove('installment-slide-enter');
    void slide.offsetWidth;
    slide.classList.add('installment-slide-enter');
  }
}

function startInstallmentBannerRotation() {
  stopInstallmentBannerRotation();
  if (installmentPolicyCache.length <= 1) return;
  installmentBannerTimer = setInterval(() => {
    installmentBannerIndex = (installmentBannerIndex + 1) % installmentPolicyCache.length;
    renderCurrentInstallmentBanner();
  }, 3200);
}

function stopInstallmentBannerRotation() {
  if (installmentBannerTimer) {
    clearInterval(installmentBannerTimer);
    installmentBannerTimer = null;
  }
}

function renderBenefitCardList() {
  const container = $('#benefit-card-list');
  if (!container) return;

  if (!installmentPolicyCache.length) {
    container.innerHTML = `
      <div style="border:1.5px dashed var(--border-color); border-radius:var(--radius); padding:28px 18px; background:var(--bg-white); text-align:center;">
        <div style="font-size:15px; font-weight:900; color:var(--text-primary); margin-bottom:8px;">무이자할부 정책이 없습니다.</div>
        <div style="font-size:12px; font-weight:700; color:var(--text-secondary); line-height:1.5;">관리자 페이지에서 이번 달 카드사별 무이자 할부 정책을 설정해주세요.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = installmentPolicyCache.map((item, index) => {
    const months = [...item.months].map(Number).sort((a, b) => a - b);
    const maxMonth = months[months.length - 1];
    const company = item.cardCompany || '카드';
    const chipColor = ['#1554a8', '#1a1a5e', '#0f8a3a', '#7c3aed'][index % 4];
    const companyLogo = renderCardCompanyLogo(company, { width: 92, height: 36, radius: 8 });
    return `
      <div style="position:relative; overflow:hidden; border:1.5px solid var(--card-border); border-radius:var(--radius); background:linear-gradient(135deg,#ffffff 0%,#f5fff6 100%); padding:16px; box-shadow:var(--card-shadow);">
        <div style="position:absolute; inset:-70% auto auto -40%; width:50%; height:220%; background:linear-gradient(110deg, transparent 15%, rgba(255,255,255,.8) 50%, transparent 82%); transform:rotate(18deg); animation:eatspay-shine 3.6s ease-in-out infinite; pointer-events:none;"></div>
        <button type="button" class="btn-benefit-card-select" data-card-company="${escapeHtml(company)}" style="position:absolute; top:14px; right:14px; z-index:2; border:none; background:var(--green-primary); color:white; border-radius:var(--radius); padding:9px 12px; font-size:12px; font-weight:900; cursor:pointer;">선택</button>
        <div style="position:relative; padding-right:62px;">
          <div style="min-width:0;">
            <div style="margin-bottom:10px;">${companyLogo}</div>
            <div style="font-size:16px; font-weight:900; color:var(--text-primary); margin-bottom:6px;">${escapeHtml(company)} 무이자 할부</div>
            <div style="display:flex; align-items:center; gap:5px; overflow-x:auto; white-space:nowrap; scrollbar-width:none; max-width:100%; padding-bottom:1px;">
              ${months.map(month => `<span style="display:inline-flex; align-items:center; flex:0 0 auto; border:1px solid #d7ead9; background:#fff; border-radius:999px; padding:3px 7px; font-size:11px; font-weight:900; color:var(--text-secondary); line-height:1;">${month}개월</span>`).join('')}
            </div>
            <div style="font-size:12px; font-weight:900; color:var(--green-dark); margin-top:6px;">최대 ${maxMonth}개월 무이자</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderCsInstallmentList() {
  const container = $('#cs-installment-list');
  if (!container) return;

  if (!installmentPolicyCache.length) {
    container.innerHTML = `
      <div style="padding: 26px 8px; text-align:center;">
        <div style="font-size:14px; font-weight:900; color:var(--text-primary); margin-bottom:6px;">무이자할부 정책이 없습니다.</div>
        <div style="font-size:12px; font-weight:700; color:var(--text-secondary); line-height:1.5;">관리자 페이지에서 이번 달 무이자 할부 정책을 설정해주세요.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = installmentPolicyCache.map((item, index) => {
    const months = [...item.months].map(Number).sort((a, b) => a - b);
    const maxMonth = months[months.length - 1];
    const border = index === installmentPolicyCache.length - 1 ? 'none' : '1px solid var(--border-light)';
    const companyLogo = renderCardCompanyLogo(item.cardCompany, { width: 82, height: 32, radius: 8 });
    return `
      <div style="padding: 15px 0; border-bottom: ${border}; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="display:flex; flex-direction:column; gap:4px; min-width:0;">
          <span style="display:flex; align-items:center; gap:7px; font-size:14px; font-weight:900; color:var(--text-primary);">${companyLogo}<span>${escapeHtml(item.cardCompany)}</span></span>
          <div class="cs-installment-months" aria-label="가능 개월">
            <span class="cs-installment-label">가능 개월</span>
            ${months.map(month => `<span class="cs-installment-chip month-${month}">${month}개월</span>`).join('')}
          </div>
        </div>
        <span style="font-size:13px; font-weight:900; color:var(--green-dark); flex-shrink:0;">최대 ${maxMonth}개월</span>
      </div>
    `;
  }).join('');
}

function getFaqCategories(items = faqCache) {
  const categories = [...new Set(items.map(item => item.category || '서비스 안내'))];
  return ['전체', ...(categories.length ? categories : ['서비스 안내'])];
}

function syncCsFaqActiveTab() {
  const tabs = $('#cs-faq-tabs');
  if (!tabs) return;
  $$('.cs-faq-tab', tabs).forEach(tab => {
    const category = tab.dataset.faqCategory || tab.textContent.trim();
    tab.classList.toggle('active', category === activeFaqCategory);
    tab.setAttribute('aria-selected', category === activeFaqCategory ? 'true' : 'false');
  });
}

function renderCsFaqList(items = faqCache) {
  const tabs = $('#cs-faq-tabs');
  const list = $('#cs-faq-list');
  if (!tabs || !list) return;

  const categories = getFaqCategories(items);
  if (!activeFaqCategory || !categories.includes(activeFaqCategory)) {
    activeFaqCategory = categories[0];
  }

  tabs.innerHTML = categories.map(category => `
    <button type="button" class="cs-faq-tab${category === activeFaqCategory ? ' active' : ''}" data-faq-category="${escapeHtml(category)}" aria-selected="${category === activeFaqCategory ? 'true' : 'false'}">
      ${escapeHtml(category)}
    </button>
  `).join('');
  syncCsFaqActiveTab();

  if (!items.length) {
    list.innerHTML = `
      <div class="cs-faq-empty">
        <div class="cs-empty-title">등록된 FAQ가 없습니다.</div>
        <div class="cs-empty-desc">관리자페이지에서 FAQ를 추가하면 이곳에 표시됩니다.</div>
      </div>
    `;
    return;
  }

  const filtered = activeFaqCategory === '전체'
    ? items
    : items.filter(item => (item.category || '서비스 안내') === activeFaqCategory);
  list.innerHTML = filtered.map((item, index) => `
    <div class="cs-faq-item${index === 0 ? ' open' : ''}">
      <button type="button" class="cs-faq-question" data-faq-id="${escapeHtml(String(item.id || index))}">
        <span class="cs-faq-q">Q</span>
        <span class="cs-faq-question-text">${escapeHtml(item.question || '')}</span>
        <span class="cs-faq-chevron" aria-hidden="true"></span>
      </button>
      <div class="cs-faq-answer">
        <div class="cs-faq-answer-inner">
          <span class="cs-faq-a">A</span>
          <div class="cs-faq-answer-text">${escapeHtml(item.answer || '').replace(/\n/g, '<br>')}</div>
        </div>
      </div>
    </div>
  `).join('');
  syncCsFaqActiveTab();
}

async function fetchCsFaqs() {
  const list = $('#cs-faq-list');
  const tabs = $('#cs-faq-tabs');
  if (tabs) tabs.innerHTML = '';
  if (list) {
    list.innerHTML = `
      <div class="cs-faq-empty">
        <div class="spinner cs-empty-spinner"></div>
        <div class="cs-empty-loading">FAQ를 불러오고 있습니다.</div>
      </div>
    `;
  }
  try {
    const response = await fetch(apiUrl(`/api/faqs?_=${Date.now()}`), { cache: 'no-store' });
    if (!response.ok) throw new Error('FAQ를 불러오지 못했습니다.');
    const payload = await response.json().catch(() => null);
    faqCache = Array.isArray(payload?.data) ? payload.data : [];
    renderCsFaqList(faqCache);
  } catch (err) {
    faqCache = [];
    if (list) {
      list.innerHTML = `
        <div class="cs-faq-empty">
          <div class="cs-empty-title">FAQ를 불러오지 못했습니다.</div>
          <button type="button" id="cs-faq-retry" class="cs-empty-retry">다시 불러오기</button>
        </div>
      `;
    }
  }
}

function renderCsNotices(items = noticeCache) {
  const list = $('#cs-notice-list');
  if (!list) return;
  const pageSize = 10;

  if (!items.length) {
    list.innerHTML = `
      <div class="cs-notice-empty">
        <div class="cs-empty-title">등록된 공지사항이 없습니다.</div>
        <div class="cs-empty-desc">관리자페이지에서 공지사항을 등록하면 이곳에 표시됩니다.</div>
      </div>
    `;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  noticePage = Math.min(Math.max(1, noticePage), totalPages);
  const startIndex = (noticePage - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);
  const pagination = totalPages > 1
    ? `<div class="cs-notice-pagination" aria-label="공지사항 페이지">
        ${Array.from({ length: totalPages }, (_, index) => {
          const page = index + 1;
          return `<button type="button" class="cs-notice-page${page === noticePage ? ' active' : ''}" data-notice-page="${page}" aria-label="${page}페이지">${page}</button>`;
        }).join('')}
      </div>`
    : '';

  list.innerHTML = `
    <div class="cs-notice-table" role="table" aria-label="공지사항 목록">
      <div class="cs-notice-table-head" role="row">
        <span role="columnheader">번호</span>
        <span role="columnheader">제목</span>
        <span role="columnheader">작성일</span>
      </div>
      ${pageItems.map((item, index) => {
        const rowNumber = items.length - (startIndex + index);
        const date = item.date || String(item.updatedAt || '').slice(0, 10) || '-';
        return `
          <button type="button" class="cs-notice-row" data-notice-id="${escapeHtml(String(item.id || ''))}" role="row">
            <span class="cs-notice-no" role="cell">${rowNumber}</span>
            <span class="cs-notice-row-title" role="cell">${escapeHtml(item.title || '')}</span>
            <span class="cs-notice-row-date" role="cell">${escapeHtml(date)}</span>
          </button>
        `;
      }).join('')}
    </div>
    ${pagination}
  `;
}

async function fetchCsNotices() {
  const list = $('#cs-notice-list');
  if (list) {
    list.innerHTML = `
      <div class="cs-notice-empty">
        <div class="spinner cs-empty-spinner"></div>
        <div class="cs-empty-loading">공지사항을 불러오고 있습니다.</div>
      </div>
    `;
  }
  try {
    const response = await fetch(apiUrl(`/api/notices?_=${Date.now()}`), { cache: 'no-store' });
    if (!response.ok) throw new Error('공지사항을 불러오지 못했습니다.');
    const payload = await response.json().catch(() => null);
    noticeCache = Array.isArray(payload?.data) ? payload.data : [];
    noticePage = 1;
    renderCsNotices(noticeCache);
  } catch (err) {
    noticeCache = [];
    noticePage = 1;
    if (list) {
      list.innerHTML = `
        <div class="cs-notice-empty">
          <div class="cs-empty-title">공지사항을 불러오지 못했습니다.</div>
          <button type="button" id="cs-notice-retry" class="cs-empty-retry">다시 불러오기</button>
        </div>
      `;
    }
  }
}

function showCsNoticeDetail(id) {
  const notice = noticeCache.find(item => String(item.id) === String(id));
  if (!notice) return;
  const date = notice.date || String(notice.updatedAt || '').slice(0, 10) || '-';
  showAppHtmlAlert(`
    <div class="cs-notice-detail">
      <div class="cs-notice-detail-meta">${escapeHtml(notice.author || '운영팀')} · ${escapeHtml(date)}</div>
      <div class="cs-notice-detail-body">${escapeHtml(notice.content || '').replace(/\n/g, '<br>')}</div>
    </div>
  `, notice.title || '공지사항');
}

function renderCsGuides(items = guideCache) {
  const list = $('#cs-guide-list');
  if (!list) return;

  if (!items.length) {
    list.innerHTML = `
      <div class="cs-guide-empty">
        <div class="cs-empty-title">등록된 이용가이드가 없습니다.</div>
        <div class="cs-empty-desc">관리자페이지에서 이용가이드를 등록하면 이곳에 표시됩니다.</div>
      </div>
    `;
    return;
  }

  list.innerHTML = `
    <div class="cs-guide-grid">
      ${items.map(item => `
        <button type="button" class="cs-guide-card" data-guide-id="${escapeHtml(String(item.id || ''))}">
          <span class="cs-guide-chip">GUIDE</span>
          <div class="cs-guide-card-title">${escapeHtml(item.title || '')}</div>
          <div class="cs-guide-card-meta">${escapeHtml(item.author || 'CS팀')} · ${escapeHtml(item.date || String(item.updatedAt || '').slice(0, 10) || '-')}</div>
          <span class="cs-guide-arrow" aria-hidden="true"></span>
        </button>
      `).join('')}
    </div>
  `;
}

async function fetchCsGuides() {
  const list = $('#cs-guide-list');
  if (list) {
    list.innerHTML = `
      <div class="cs-guide-empty">
        <div class="spinner cs-empty-spinner"></div>
        <div class="cs-empty-loading">이용가이드를 불러오고 있습니다.</div>
      </div>
    `;
  }
  try {
    const response = await fetch(apiUrl(`/api/guides?_=${Date.now()}`), { cache: 'no-store' });
    if (!response.ok) throw new Error('이용가이드를 불러오지 못했습니다.');
    const payload = await response.json().catch(() => null);
    guideCache = Array.isArray(payload?.data) ? payload.data : [];
    renderCsGuides(guideCache);
  } catch (err) {
    guideCache = [];
    if (list) {
      list.innerHTML = `
        <div class="cs-guide-empty">
          <div class="cs-empty-title">이용가이드를 불러오지 못했습니다.</div>
          <button type="button" id="cs-guide-retry" class="cs-empty-retry">다시 불러오기</button>
        </div>
      `;
    }
  }
}

function showCsGuideDetail(id) {
  const guide = guideCache.find(item => String(item.id) === String(id));
  if (!guide) return;
  const date = guide.date || String(guide.updatedAt || '').slice(0, 10) || '-';
  showAppHtmlAlert(`
    <div class="cs-guide-detail">
      <div class="cs-guide-detail-meta">${escapeHtml(guide.author || 'CS팀')} · ${escapeHtml(date)}</div>
      <div class="cs-guide-detail-body">${escapeHtml(guide.content || '').replace(/\n/g, '<br>')}</div>
    </div>
  `, guide.title || '이용가이드');
}

function applySelectedBenefitCardToForm() {
  const selectedCompany = sessionStorage.getItem('selectedBenefitCardCompany') || '';
  const select = $('#add-card-company');
  const customWrap = $('#add-card-company-custom-wrap');
  const customInput = $('#add-card-company-custom');
  if (!select) return;
  select.value = selectedCompany || '';
  select.readOnly = true;
  if (customWrap) customWrap.style.display = 'none';
  if (customInput) customInput.value = '';
  sessionStorage.removeItem('selectedBenefitCardCompany');
}

function setCardCompanyFormValue(company) {
  const select = $('#add-card-company');
  const customWrap = $('#add-card-company-custom-wrap');
  const customInput = $('#add-card-company-custom');
  const value = String(company || '').trim();
  if (!select) return;
  select.value = value;
  select.readOnly = true;
  if (customWrap) customWrap.style.display = 'none';
  if (customInput) customInput.value = '';
}

function resetCardFormForAdd() {
  const screen = $('#screen-card-add');
  const title = screen?.querySelector('.auth-headline');
  const submit = $('#add-card-submit');
  const cardNumber = $('#add-card-number');
  const pw = $('#add-card-pw');
  const cvc = $('#add-card-cvc');
  const month = $('#add-card-month');
  const year = $('#add-card-year');
  const identity = $('#add-card-identity');
  const payerName = $('#add-card-payer-name');
  const payerEmail = $('#add-card-payer-email');
  const payerTel = $('#add-card-payer-tel');
  const alias = $('#add-card-alias');
  if (title) title.textContent = '카드 정보를 입력해주세요';
  if (submit) submit.textContent = '카드등록';
  [cardNumber, pw, cvc, month, year, identity, payerName, payerEmail, payerTel].forEach(input => {
    if (!input) return;
    input.disabled = false;
    input.style.background = '';
    input.style.color = '';
  });
  if (cardNumber) {
    cardNumber.placeholder = '카드번호 전체를 입력해주세요';
    cardNumber.value = '';
  }
  clearPasswordValue('#add-card-pw');
  clearPasswordValue('#add-card-cvc');
  if (month) month.value = '';
  if (year) year.value = '';
  if (identity) identity.value = '';
  if (payerName) payerName.value = '';
  if (payerEmail) payerEmail.value = '';
  if (payerTel) payerTel.value = '';
  if (alias) alias.value = '';
  unlockCardAddFormControls();
  const company = $('#add-card-company');
  if (company) {
    company.value = '';
    company.readOnly = true;
    company.style.background = '#F8FAF8';
    company.style.color = '';
  }
}

function fillCardPayerFieldsFromUser(user = getSessionUser(), { force = false } = {}) {
  if (!user) return;
  const payerName = $('#add-card-payer-name');
  const payerEmail = $('#add-card-payer-email');
  const payerTel = $('#add-card-payer-tel');
  if (payerName && (force || !payerName.value.trim())) payerName.value = resolveUserPayerName(user);
  if (payerEmail && (force || !payerEmail.value.trim())) payerEmail.value = resolveUserContactEmail(user);
  if (payerTel && (force || !payerTel.value.trim())) payerTel.value = resolveUserPhone(user);
}

async function hydrateCardPayerFields() {
  fillCardPayerFieldsFromUser(getSessionUser());
  if (!sessionStorage.getItem('accessToken')) {
    restoreKeptAuthSession();
  }
  const token = sessionStorage.getItem('accessToken') || localStorage.getItem('eatspay.accessToken') || '';
  if (!token) return;
  try {
    const response = await fetch(apiUrl('/api/auth/me'), {
      headers: { 'Authorization': `Bearer ${token}` },
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    const user = payload?.data?.user;
    if (response.ok && user) {
      persistSessionUserProfile(user);
      fillCardPayerFieldsFromUser(user, { force: true });
    }
  } catch (_) {
    // 기존 세션값으로 채운 상태를 유지합니다.
  }
}

async function prefillCardPayerFields(refreshFromServer = true) {
  fillCardPayerFieldsFromUser(getSessionUser(), { force: true });
  if (!refreshFromServer || !isAuthenticated()) return getSessionUser();
  const freshUser = await refreshSessionUserProfile();
  if (freshUser) {
    fillCardPayerFieldsFromUser(freshUser, { force: true });
  }
  return freshUser || getSessionUser();
}

function startCardPayerPrefillWatcher() {
  const screen = $('#screen-card-add');
  if (!screen || screen.dataset.payerWatcher === '1') return;
  screen.dataset.payerWatcher = '1';

  const run = () => {
    if (state.currentScreen !== 'card-add') return;
    if (screen.dataset.payerTouched === '1') return;
    const nameInput = $('#add-card-payer-name');
    const emailInput = $('#add-card-payer-email');
    const telInput = $('#add-card-payer-tel');
    if (!nameInput || !emailInput || !telInput) return;
    const missing = !nameInput.value.trim() || !emailInput.value.trim() || !telInput.value.trim();
    if (missing) void prefillCardPayerFields(true);
  };

  const observer = new MutationObserver(run);
  observer.observe(screen, { attributes: true, attributeFilter: ['class'] });
  ['focusin', 'click', 'touchstart'].forEach(eventName => {
    screen.addEventListener(eventName, run, { passive: true });
  });
  ['#add-card-payer-name', '#add-card-payer-email', '#add-card-payer-tel'].forEach(selector => {
    $(selector)?.addEventListener('input', () => {
      screen.dataset.payerTouched = '1';
    });
  });
  setInterval(run, 1200);
}

function installCardPayerPrefillFallback() {
  return;
  const screen = $('#screen-card-add');
  if (screen) screen.dataset.payerTouched = '';
  $('#screen-card-add .scrollable-content')?.scrollTo?.({ top: 0, behavior: 'auto' });
  startCardPayerPrefillWatcher();
  setTimeout(() => {
    if (state.currentScreen === 'card-add' && screen?.dataset.payerTouched !== '1') void prefillCardPayerFields(true);
  }, 250);
}

function clearFieldError(input) {
  if (!input) return;
  input.style.borderColor = '';
  input.style.background = '';
  input.style.boxShadow = '';
}

function markFieldError(input) {
  if (!input) return false;
  input.style.borderColor = '#efb4ad';
  input.style.background = '#fff7f5';
  input.style.boxShadow = '0 0 0 3px rgba(239, 180, 173, .22)';
  return false;
}

function resetCardFieldErrors() {
  [
    '#add-card-number',
    '#add-card-company',
    '#add-card-company-custom',
    '#add-card-pw',
    '#add-card-cvc',
    '#add-card-month',
    '#add-card-year',
    '#add-card-identity',
    '#add-card-payer-name',
    '#add-card-payer-email',
    '#add-card-payer-tel',
    '#add-card-alias'
  ].forEach(selector => clearFieldError($(selector)));
}

function unlockCardAddFormControls() {
  $$('#screen-card-add input, #screen-card-add select, #screen-card-add button').forEach(control => {
    if (!control) return;
    control.disabled = false;
    control.removeAttribute('disabled');
    control.removeAttribute('readonly');
    control.removeAttribute('tabindex');
    control.style.pointerEvents = '';
    control.style.opacity = '';
  });
}

function lockCardAliasOnlyControls(card, display) {
  const user = getSessionUser();
  const fixedEmptyText = '저장된 정보 없음';
  const readOnlyValues = {
    '#add-card-number': display.masked,
    '#add-card-pw': '',
    '#add-card-cvc': '',
    '#add-card-identity': card.cardIdentity || fixedEmptyText,
    '#add-card-payer-name': card.payerName || resolveUserPayerName(user) || fixedEmptyText,
    '#add-card-payer-email': card.payerEmail || resolveUserContactEmail(user) || fixedEmptyText,
    '#add-card-payer-tel': card.payerTel || resolveUserPhone(user) || fixedEmptyText
  };
  const freezeControl = input => {
    if (!input) return;
    input.readOnly = true;
    input.disabled = true;
    input.tabIndex = -1;
    input.style.pointerEvents = 'none';
    input.style.background = '#F8FAF8';
    input.style.color = '#6B7280';
  };
  Object.entries(readOnlyValues).forEach(([selector, value]) => {
    const input = $(selector);
    if (!input) return;
    input.value = value;
    freezeControl(input);
  });
  const month = $('#add-card-month');
  const year = $('#add-card-year');
  if (month) {
    month.value = String(card.expiryMonth || '').padStart(2, '0').slice(-2);
    syncExpiryPlaceholderSelect(month);
    freezeControl(month);
  }
  if (year) {
    year.value = String(card.expiryYear || '').slice(-2);
    syncExpiryPlaceholderSelect(year);
    freezeControl(year);
  }
  const company = $('#add-card-company');
  const custom = $('#add-card-company-custom');
  const btnPersonal = $('#btn-card-type-personal');
  const btnCorp = $('#btn-card-type-corp');
  if (company) {
    freezeControl(company);
  }
  if (custom) {
    freezeControl(custom);
  }
  [btnPersonal, btnCorp].forEach(btn => {
    if (!btn) return;
    btn.disabled = true;
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '.72';
  });
}

function applyCardEditDraftToForm() {
  if (!cardEditDraft) {
    resetCardFormForAdd();
    applySelectedBenefitCardToForm();
    setTimeout(unlockCardAddFormControls, 0);
    return;
  }

  const screen = $('#screen-card-add');
  const title = screen?.querySelector('.auth-headline');
  const submit = $('#add-card-submit');
  const cardNumber = $('#add-card-number');
  const pw = $('#add-card-pw');
  const cvc = $('#add-card-cvc');
  const month = $('#add-card-month');
  const year = $('#add-card-year');
  const identity = $('#add-card-identity');
  const payerName = $('#add-card-payer-name');
  const payerEmail = $('#add-card-payer-email');
  const payerTel = $('#add-card-payer-tel');
  const alias = $('#add-card-alias');
  const display = normalizeCardDisplay(cardEditDraft);

  if (title) title.textContent = cardEditDraft.aliasOnly ? '카드별칭을 수정해주세요' : '카드 정보를 수정해주세요';
  if (submit) submit.textContent = cardEditDraft.aliasOnly ? '저장' : '카드수정';
  if (cardNumber) {
    cardNumber.value = '';
    cardNumber.placeholder = `현재 ${display.masked} · 변경 시 전체 카드번호 입력`;
  }
  setCardCompanyFormValue(display.name);
  if (alias) alias.value = cardEditDraft.alias || display.name;
  if (cardEditDraft.aliasOnly) {
    lockCardAliasOnlyControls(cardEditDraft, display);
    alias?.focus?.();
    return;
  }
  [cardNumber, pw, cvc, month, year, identity, payerName, payerEmail, payerTel].forEach(input => {
    if (!input) return;
    input.disabled = false;
    input.style.background = '';
    input.style.color = '';
  });
  clearPasswordValue('#add-card-pw');
  clearPasswordValue('#add-card-cvc');
  if (month) {
    month.value = '';
    syncExpiryPlaceholderSelect(month);
  }
  if (year) {
    year.value = '';
    syncExpiryPlaceholderSelect(year);
  }
  if (identity) identity.value = '';
  if (payerName) payerName.value = '';
  if (payerEmail) payerEmail.value = '';
  if (payerTel) payerTel.value = '';
  unlockCardAddFormControls();
  const company = $('#add-card-company');
  if (company) {
    company.readOnly = true;
    company.style.background = '#F8FAF8';
  }
}

async function loadInstallmentBanner() {
  try {
    const response = await fetch(apiUrl(`/api/installments/current?_=${Date.now()}`), { cache: 'no-store' });
    if (!response.ok) throw new Error('installment policy request failed');
    const json = await response.json();
    renderInstallmentBanner(json.data || []);
    renderCsInstallmentList();
    renderBenefitCardList();
  } catch (error) {
    console.error(error);
    renderInstallmentBanner([]);
    renderCsInstallmentList();
    renderBenefitCardList();
  }
}

let bankInstitutionCache = [];

async function loadBankInstitutions() {
  try {
    const response = await fetch(apiUrl(`/api/banks?_=${Date.now()}`), { cache: 'no-store' });
    if (!response.ok) throw new Error('bank institution request failed');
    const payload = await response.json().catch(() => ({}));
    bankInstitutionCache = Array.isArray(payload.data) ? payload.data : [];
    renderBankSelectOptions();
  } catch (error) {
    console.warn('은행 목록 DB 로딩 실패, 기본 목록을 사용합니다.', error);
    bankInstitutionCache = [];
  }
}

function renderBankSelectOptions() {
  const select = $('#add-vaccount-bank');
  if (!select || !bankInstitutionCache.length) return;
  const currentValue = select.value;
  select.innerHTML = '<option value="">은행을 선택하세요</option>' + bankInstitutionCache.map(item => {
    const name = escapeHtml(item.name || '');
    const code = escapeHtml(item.code || '');
    return `<option value="${name}" data-bank-code="${code}">${name}</option>`;
  }).join('');
  if (currentValue && Array.from(select.options).some(option => option.value === currentValue)) {
    select.value = currentValue;
  }
}

function bankCodeFromName(bankName) {
  const bankCodes = {
    '산업은행': '002',
    '기업은행': '003',
    '국민은행': '004',
    '수협중앙회': '007',
    '농협은행': '011',
    '지역농축협': '012',
    '우리은행': '020',
    'SC은행': '023',
    '한국씨티은행': '027',
    '대구은행': '031',
    '부산은행': '032',
    '광주은행': '034',
    '제주은행': '035',
    '전북은행': '037',
    '경남은행': '039',
    '새마을금고중앙회': '045',
    '신협중앙회': '048',
    '저축은행': '050',
    'HSBC은행': '054',
    '도이치은행': '055',
    '제이피모간체이스은행': '057',
    'BOA은행': '060',
    '비엔피파리바은행': '061',
    '산림조합': '064',
    '우체국': '071',
    '하나은행': '081',
    '신한은행': '088',
    '케이뱅크': '089',
    '카카오뱅크': '090',
    '토스뱅크': '092',
    '교보증권': '261',
    '대신증권': '267',
    '메리츠증권': '287',
    '미래에셋증권': '238',
    '삼성증권': '240',
    '신한금융투자': '278',
    '유안타증권': '209',
    '유진투자증권': '280',
    '카카오페이증권': '288',
    '키움증권': '264',
    '하나금융투자': '270',
    '한국투자증권': '243',
    '한화투자증권': '269',
    '현대차증권': '263',
    'DB금융투자': '279',
    'KB증권': '218',
    'LIG투자증권': '292',
    'NH투자증권': '247',
    'SK증권': '266'
  };
  const name = String(bankName || '').trim();
  const fromDb = bankInstitutionCache.find(item => String(item.name || '').trim() === name);
  return fromDb?.code || bankCodes[name] || name;
}

function currentUserBusinessNumber(user) {
  const digits = String(user?.businessNumber || '').replace(/[^0-9]/g, '');
  if (digits.length >= 10) {
    const businessDigits = digits.slice(0, 10);
    return `${businessDigits.slice(0, 3)}-${businessDigits.slice(3, 5)}-${businessDigits.slice(5)}`;
  }
  return user?.businessNumber || '120-00-12345';
}

function syncVaccountAgencyButtons() {
  const agencyBtns = $$('.btn-delivery-agency');
  if (!agencyBtns.length) return;

  agencyBtns.forEach(btn => {
    const agency = btn.getAttribute('data-agency') || '';
    const isSelected = agency !== 'more' && agency === selectedAgency;
    if (isSelected) {
      btn.classList.add('active');
      btn.style.borderColor = '#3a9430';
      btn.style.color = '#3a9430';
    } else if (agency !== 'more') {
      btn.classList.remove('active');
      btn.style.borderColor = 'var(--border-color)';
      btn.style.color = 'var(--text-secondary)';
    }
  });

  const selectedLabel = $('#selected-agency-label');
  if (selectedLabel) {
    selectedLabel.textContent = `선택된 배달대행사: ${selectedAgency || '없음'}`;
  }
}

function setSelectedAgency(name) {
  selectedAgency = normalizeSelectedAgency(name);
  sessionStorage.setItem('selectedDeliveryAgency', selectedAgency);
  syncVaccountAgencyButtons();
}

function openDeliveryAgencyList(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  navigate('delivery-agency-list');
}

function handleDeliveryAgencyButtonClick(btn) {
  const agency = btn.getAttribute('data-agency');
  if (agency === 'more') {
    openDeliveryAgencyList();
    return;
  }

  $$('.btn-delivery-agency').forEach(b => {
    b.classList.remove('active');
    b.style.borderColor = 'var(--border-color)';
    b.style.color = 'var(--text-secondary)';
  });
  btn.classList.add('active');
  btn.style.borderColor = '#3a9430';
  btn.style.color = '#3a9430';
  setSelectedAgency(agency);
}

function syncVaccountPhotoPreview() {
  const wrap = $('#vaccount-photo-preview');
  const img = $('#vaccount-photo-preview-img');
  const nameEl = $('#vaccount-photo-preview-name');
  if (!wrap || !img || !nameEl) return;

  if (vaccountPhotoState.url) {
    wrap.style.display = 'block';
    img.style.display = 'block';
    img.src = vaccountPhotoState.url;
    nameEl.textContent = `${vaccountPhotoState.source === 'camera' ? '카메라' : '갤러리'}: ${vaccountPhotoState.name}`;
  } else {
    wrap.style.display = 'none';
    img.removeAttribute('src');
    img.style.display = 'none';
    nameEl.textContent = '아직 선택된 사진이 없습니다.';
  }
}

function syncBizLicensePreview() {
  const wrap = $('#biz-license-preview');
  const img = $('#biz-license-preview-img');
  const nameEl = $('#biz-license-preview-name');
  if (!wrap || !img || !nameEl) return;

  if (bizLicenseFileState.file) {
    wrap.style.display = 'block';
    nameEl.textContent = `${bizLicenseFileState.source === 'camera' ? '카메라' : '파일'}: ${bizLicenseFileState.name}`;
    if (bizLicenseFileState.url && bizLicenseFileState.file.type?.startsWith('image/')) {
      img.style.display = 'block';
      img.src = bizLicenseFileState.url;
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
  } else {
    wrap.style.display = 'none';
    img.removeAttribute('src');
    img.style.display = 'none';
    nameEl.textContent = '아직 선택된 파일이 없습니다.';
  }
}

function clearVaccountPhotoSelection() {
  if (vaccountPhotoState.url) {
    URL.revokeObjectURL(vaccountPhotoState.url);
  }
  vaccountPhotoState = { name: '', url: '', source: '', file: null };
  syncVaccountPhotoPreview();
}

function clearBizLicenseSelection() {
  if (bizLicenseFileState.url) {
    URL.revokeObjectURL(bizLicenseFileState.url);
  }
  bizLicenseFileState = { name: '', url: '', source: '', file: null };
  const input = $('#reg-biz-license-file');
  if (input) input.value = '';
  syncBizLicensePreview();
}

function openVaccountPhotoSheet(target = 'vaccount') {
  photoSheetTarget = target;
  const title = $('#vaccount-photo-sheet-title');
  const galleryBtn = $('#btn-vaccount-photo-gallery');
  const cameraInput = $('#vaccount-photo-camera-input');
  const galleryInput = $('#vaccount-photo-gallery-input');

  if (title) title.textContent = target === 'bizLicense' ? '사업자등록증 등록' : '사진 등록';
  if (galleryBtn) galleryBtn.textContent = target === 'bizLicense' ? '파일/갤러리에서 선택' : '갤러리에서 선택';
  if (cameraInput) {
    cameraInput.setAttribute('accept', 'image/*');
    cameraInput.setAttribute('capture', 'environment');
  }
  if (galleryInput) {
    galleryInput.setAttribute('accept', target === 'bizLicense' ? '.pdf,.jpg,.jpeg,.png,image/*,application/pdf' : 'image/*');
    galleryInput.removeAttribute('capture');
  }

  $('#vaccount-photo-backdrop')?.classList.add('show');
  $('#vaccount-photo-sheet')?.classList.add('show');
}

function closeVaccountPhotoSheet() {
  $('#vaccount-photo-backdrop')?.classList.remove('show');
  $('#vaccount-photo-sheet')?.classList.remove('show');
}

function handleVaccountPhotoSelection(file, source) {
  if (!file) return;
  if (photoSheetTarget === 'bizLicense') {
    handleBizLicenseSelection(file, source);
    return;
  }
  if (vaccountPhotoState.url) {
    URL.revokeObjectURL(vaccountPhotoState.url);
  }
  vaccountPhotoState = {
    name: getVaccountPhotoDisplayName(file),
    url: URL.createObjectURL(file),
    source,
    file
  };
  syncVaccountPhotoPreview();
  closeVaccountPhotoSheet();
  showToast(source === 'camera' ? '카메라 사진이 선택되었습니다.' : '갤러리 사진이 선택되었습니다.');
}

function handleBizLicenseSelection(file, source) {
  if (!file) return;
  if (bizLicenseFileState.url) {
    URL.revokeObjectURL(bizLicenseFileState.url);
  }
  const displayName = getBizLicenseDisplayName(file);
  bizLicenseFileState = {
    name: displayName,
    url: file.type?.startsWith('image/') ? URL.createObjectURL(file) : '',
    source,
    file
  };
  syncBizLicensePreview();
  closeVaccountPhotoSheet();
  persistRegisterDraft(false);
  showToast(`${displayName} 파일이 첨부되었습니다.`);
}

async function loadDeliveryAgencyList() {
  const container = $('#delivery-agency-list-container');
  if (!container) return [];

  container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-weight: 700;">諛곕떖??됱궗 紐⑸줉??遺덈윭?ㅻ뒗 以묒엯?덈떎...</div>';

  try {
    const response = await fetch(apiUrl('/api/delivery-agencies'), {
      method: 'GET'
    });
    if (!response.ok) throw new Error('delivery agency list request failed');
    const payload = await response.json().catch(() => null);
    deliveryAgencyCache = Array.isArray(payload?.data) ? payload.data : [];
  } catch (err) {
    deliveryAgencyCache = [];
  }

  renderDeliveryAgencyList();
  return deliveryAgencyCache;
}

function normalizeDeliveryAgencyListText() {
  const screen = $('#screen-delivery-agency-list');
  if (!screen) return;

  const backBtn = screen.querySelector('.btn-back');
  if (backBtn && backBtn.childNodes[1]) backBtn.childNodes[1].nodeValue = ' \uC774\uC804';

  const titleEl = screen.querySelector('.scrollable-content > div > div');
  const subtitleEl = titleEl ? titleEl.nextElementSibling : null;
  if (titleEl) titleEl.textContent = '\uBC30\uB2EC\uB300\uD589\uC0AC \uBAA9\uB85D';
  if (subtitleEl) subtitleEl.textContent = '\uAC00\uC785 \uAC00\uB2A5 \uC5EC\uBD80\uB97C \uD655\uC778\uD558\uACE0 \uC120\uD0DD\uD574\uC8FC\uC138\uC694.';

  const searchInput = $('#delivery-agency-search');
  if (searchInput) searchInput.placeholder = '\uBC30\uB2EC\uB300\uD589\uC0AC \uAC80\uC0C9';

  const navLabels = screen.querySelectorAll('.nav-label');
  if (navLabels[0]) navLabels[0].textContent = '\uD648';
  if (navLabels[1]) navLabels[1].textContent = '\uB0B4\uC815\uBCF4';
  if (navLabels[2]) navLabels[2].textContent = '\uACE0\uAC1D\uC13C\uD130';
}

function normalizeBackButtons() {
  $$('.btn-back').forEach(btn => {
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6"></path>
      </svg>
      <span>이전</span>
    `;
    btn.setAttribute('aria-label', '이전 화면으로 이동');
  });
}

function renderDeliveryAgencyList() {
  const container = $('#delivery-agency-list-container');
  if (!container) return;

  const searchValue = String($('#delivery-agency-search')?.value || '').trim().toLowerCase();
  const agencies = deliveryAgencyCache.filter(item => {
    const name = String(item.name || '').toLowerCase();
    return !searchValue || name.includes(searchValue);
  }).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));

  if (!agencies.length) {
    container.innerHTML = '<div style="padding: 24px 20px; text-align: center; color: var(--text-secondary); font-weight: 700;">\uD45C\uC2DC\uD560 \uBC30\uB2EC\uB300\uD589\uC0AC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';
    return;
  }

  container.innerHTML = agencies.map(agency => {
    const isActive = agency.status === 'active';
    const statusLabel = isActive ? '\uAC00\uC785 \uAC00\uB2A5' : '\uAC00\uC785 \uBD88\uAC00';
    const statusColor = isActive ? '#2e7d32' : '#b45309';
    const selectedMark = agency.name === selectedAgency ? '\uC120\uD0DD\uB428' : '';
    return `
      <button type="button" class="delivery-agency-item" data-agency="${escapeHtml(agency.name)}" data-status="${escapeHtml(agency.status)}" style="width: 100%; text-align: left; border: 1.5px solid ${isActive ? '#cce8c8' : 'var(--border-color)'}; background: ${isActive ? '#fbfff8' : '#fff'}; border-radius: var(--radius); padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; cursor: ${isActive ? 'pointer' : 'not-allowed'}; margin-bottom: 10px;">
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 15px; font-weight: 800; color: var(--text-primary);">${escapeHtml(agency.name)}</span>
            ${selectedMark ? '<span style="font-size: 10px; font-weight: 800; color: #3a9430; border: 1px solid #bfe6b8; background: #edf9ea; border-radius: 999px; padding: 2px 6px;">\uC120\uD0DD\uB428</span>' : ''}
          </div>
          <span style="font-size: 12px; color: ${statusColor}; font-weight: 800;">${statusLabel}</span>
        </div>
        <span style="font-size: 12px; color: var(--text-secondary); font-weight: 700;">${isActive ? '\uC120\uD0DD\uD558\uAE30' : '\uC774\uC6A9 \uBD88\uAC00'}</span>
      </button>
    `;
  }).join('');

  $$('.delivery-agency-item', container).forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.getAttribute('data-status');
      const agency = btn.getAttribute('data-agency');
      if (status !== 'active') {
        showToast('\uAC00\uC785 \uAC00\uB2A5\uD55C \uBC30\uB2EC\uB300\uD589\uC0AC\uB9CC \uC120\uD0DD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.');
        return;
      }
      setSelectedAgency(agency);
      syncVaccountAgencyButtons();
      navigate('vaccount-add');
    });
  });
}

function resolveUserContactEmail(user) {
  if (!user) return '';
  return [
    user.contactEmail,
    user.contact_email,
    user.businessEmail,
    user.ownerEmail,
    user.emailAddress,
    user.email,
    user.loginEmail,
    user.loginId
  ].find(value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) || '';
}

function resolveUserPayerName(user) {
  if (!user) return '';
  return [
    user.name,
    user.ownerName,
    user.ceoName,
    user.representativeName,
    user.franchiseName
  ].find(value => typeof value === 'string' && value.trim()) || '';
}

function resolveUserPhone(user) {
  if (!user) return '';
  const raw = [
    user.phone,
    user.mobile,
    user.tel,
    user.contactPhone,
    user.ownerPhone
  ].find(value => typeof value === 'string' && value.replace(/\D/g, '').length >= 10) || '';
  return raw ? formatPhone(String(raw)) : '';
}

function prefillAdvanceSettlementForm(refreshIfMissing = true) {
  const user = getSessionUser();
  if (!user) return;
  const email = resolveUserContactEmail(user);
  const values = {
    '#advance-phone': user.phone ? formatPhone(String(user.phone)) : '',
    '#advance-email': email
  };
  Object.entries(values).forEach(([selector, value]) => {
    const input = $(selector);
    if (input && !input.value) input.value = value;
  });
  const deliveryAppsInput = $('#advance-delivery-apps');
  if (deliveryAppsInput?.value === '배달의민족, 쿠팡이츠, 요기요, 땡겨요') {
    deliveryAppsInput.value = '';
  }
  if (refreshIfMissing && !email && isAuthenticated()) {
    refreshSessionUserProfile().then(freshUser => {
      if (resolveUserContactEmail(freshUser)) {
        prefillAdvanceSettlementForm(false);
      }
    });
  }
}

function openAdvanceSettlement() {
  if (!isAuthenticated() || !getSessionUser()) {
    showAppAlert('선정산 신청은 회원가입 후 이용할 수 있습니다.', '회원가입 필요');
    return;
  }
  navigate('advance-settlement');
}

function renderBenefitCardSearchList(items = benefitCardSearchCache) {
  const list = $('#benefit-card-search-list');
  if (!list) return;
  const cards = Array.isArray(items) ? items : [];
  if (!cards.length) {
    list.innerHTML = '<div style="border:1.5px dashed var(--border-color); border-radius:var(--radius); padding:28px 16px; text-align:center; color:var(--text-muted); font-size:13px; font-weight:800;">검색 결과가 없습니다.</div>';
    return;
  }
  list.innerHTML = cards.map(card => {
    const rate = Number(card.discountRate || 0);
    const rateLabel = rate > 0 ? `최대 ${rate.toFixed(rate % 1 === 0 ? 0 : 1)}%` : '혜택 확인';
    const tags = (Array.isArray(card.tags) ? card.tags : []).slice(0, 3);
    const company = card.cardCompany || '카드사';
    const companyLogo = renderCardCompanyLogo(company, { width: 86, height: 34, radius: 8 });
    return `
      <article style="border:1.5px solid var(--card-border); border-radius:var(--radius); background:linear-gradient(145deg,#ffffff,#f7fff6); padding:16px; box-shadow:var(--card-shadow);">
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start; margin-bottom:10px;">
          <div>
            <div style="margin-bottom:7px;">${companyLogo}</div>
            <div style="font-size:16px; font-weight:900; color:var(--text-primary); line-height:1.35;">${escapeHtml(card.cardName || '카드')}</div>
          </div>
          <span style="flex-shrink:0; background:#eaf7e8; color:#2e7d32; border:1px solid #bfe6b8; border-radius:var(--radius); padding:6px 9px; font-size:12px; font-weight:900;">${escapeHtml(rateLabel)}</span>
        </div>
        <p style="font-size:12px; font-weight:700; color:var(--text-secondary); line-height:1.5; margin:0 0 10px;">${escapeHtml(card.summary || '')}</p>
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
          ${tags.map(tag => `<span style="font-size:10px; font-weight:900; color:#3a5f95; background:#eef6ff; border-radius:4px; padding:4px 6px;">#${escapeHtml(tag)}</span>`).join('')}
        </div>
        <div style="font-size:11px; font-weight:700; color:var(--text-muted);">연회비 ${escapeHtml(card.annualFee || '확인 필요')}</div>
      </article>
    `;
  }).join('');
}

async function fetchBenefitCardSearch(query = '') {
  const list = $('#benefit-card-search-list');
  const source = $('#benefit-card-search-source');
  if (list) list.innerHTML = '<div style="padding:24px;text-align:center;"><div class="spinner" style="border-top-color: var(--green-primary); width: 26px; height: 26px; margin: 0 auto;"></div></div>';
  try {
    const response = await fetch(apiUrl(`/api/benefit-cards/search?q=${encodeURIComponent(query)}&limit=100&_=${Date.now()}`), { cache: 'no-store' });
    if (!response.ok) throw new Error('카드 검색 정보를 불러오지 못했습니다.');
    const payload = await response.json().catch(() => null);
    benefitCardSearchCache = Array.isArray(payload?.data?.items) ? payload.data.items : [];
    if (source) source.textContent = '';
  } catch (err) {
    benefitCardSearchCache = [];
    if (source) source.textContent = '';
    showToast(err.message || '카드 검색 정보를 불러오지 못했습니다.');
  }
  renderBenefitCardSearchList(benefitCardSearchCache);
}

function renderFriendlyDeliveryList(items = friendlyDeliveryCache) {
  const list = $('#friendly-delivery-list');
  if (!list) return;
  const agencies = Array.isArray(items) ? items : [];
  if (!agencies.length) {
    list.innerHTML = '<div style="border:1.5px dashed var(--border-color); border-radius:var(--radius); padding:28px 16px; text-align:center; color:var(--text-muted); font-size:13px; font-weight:800;">표시할 배달대행사가 없습니다.</div>';
    return;
  }
  const visibleAgencies = agencies.slice(0, 20);
  list.innerHTML = visibleAgencies.map((agency, index) => {
    const isExternalPlace = agency.source === 'kakao-local' || agency.source === 'naver-local';
    const isActive = agency.status === 'active' || isExternalPlace;
    const distance = agency.distanceKm == null ? '거리 계산 대기' : `${Number(agency.distanceKm).toLocaleString('ko-KR')}km`;
    const hasMapCoords = Number.isFinite(Number(agency.latitude)) && Number.isFinite(Number(agency.longitude));
    const placeLink = agency.placeUrl && hasMapCoords
      ? `<button type="button" class="btn-friendly-map" data-friendly-map-index="${index}" style="display:inline-flex; align-items:center; justify-content:center; border:1px solid #bfe6b8; border-radius:var(--radius); background:#fff; color:var(--green-dark); padding:6px 8px; font-size:11px; font-weight:900; cursor:pointer;">지도보기</button>`
      : '';
    return `
      <article style="border:1.5px solid ${isActive ? 'var(--card-border)' : 'var(--border-color)'}; border-radius:var(--radius); background:${isActive ? 'linear-gradient(145deg,#ffffff,#f7fff6)' : '#f7f7f7'}; padding:16px; opacity:${isActive ? '1' : '.62'}; box-shadow:${isActive ? 'var(--card-shadow)' : 'none'};">
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start; margin-bottom:10px;">
          <div>
            <div style="font-size:12px; font-weight:900; color:var(--green-dark); margin-bottom:3px;">${escapeHtml(agency.coverageArea || '지역 정보 확인 중')}</div>
            <div style="font-size:16px; font-weight:900; color:var(--text-primary); line-height:1.35;">${escapeHtml(agency.name || '배달대행사')}</div>
          </div>
          <span style="flex-shrink:0; background:#eaf7e8; color:#2e7d32; border:1px solid #bfe6b8; border-radius:var(--radius); padding:6px 9px; font-size:12px; font-weight:900;">${escapeHtml(distance)}</span>
        </div>
        <p style="font-size:12px; font-weight:700; color:var(--text-secondary); line-height:1.5; margin:0 0 10px;">${escapeHtml(agency.description || '가맹점 상담 가능 여부를 확인해보세요.')}</p>
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; align-items:center;">
          <span style="font-size:10px; font-weight:900; color:#3a5f95; background:#eef6ff; border-radius:4px; padding:4px 6px;">#${escapeHtml(agency.phone || '연락처확인')}</span>
          <span style="font-size:10px; font-weight:900; color:#3a5f95; background:#eef6ff; border-radius:4px; padding:4px 6px;">#${isActive ? '가입가능' : '가입대기'}</span>
          ${placeLink}
        </div>
        <div style="font-size:11px; font-weight:700; color:var(--text-muted);">
          ${escapeHtml(agency.coverageArea || '지역 정보 확인 중')}
        </div>
      </article>
    `;
  }).join('');
  $$('.btn-friendly-map', list).forEach(btn => {
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(btn.getAttribute('data-friendly-map-index'));
      openFriendlyMapModal(visibleAgencies[index]);
    });
  });
}

function buildFriendlyMapTilePreview(lat, lng, label = '배달대행사') {
  const zoom = 16;
  const tileSize = 256;
  const scale = 2 ** zoom;
  const latRad = lat * Math.PI / 180;
  const centerX = (lng + 180) / 360 * scale;
  const centerY = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * scale;
  const centerTileX = Math.floor(centerX);
  const centerTileY = Math.floor(centerY);
  const offsetX = Math.round((centerX - centerTileX) * tileSize);
  const offsetY = Math.round((centerY - centerTileY) * tileSize);
  const left = 165 - tileSize - offsetX;
  const top = 95 - tileSize - offsetY;
  const tiles = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const x = centerTileX + dx;
      const y = centerTileY + dy;
      tiles.push(`<img alt="" src="https://tile.openstreetmap.org/${zoom}/${x}/${y}.png" loading="lazy" style="position:absolute; left:${left + (dx + 1) * tileSize}px; top:${top + (dy + 1) * tileSize}px; width:${tileSize}px; height:${tileSize}px;">`);
    }
  }
  return `
    <div style="position:absolute; inset:0; overflow:hidden; background:#dfeadd;">
      ${tiles.join('')}
      <div style="position:absolute; left:50%; top:50%; transform:translate(-50%,-100%); width:30px; height:30px; border-radius:50% 50% 50% 0; background:#e84646; transform-origin:center; rotate:-45deg; box-shadow:0 4px 10px rgba(0,0,0,.25);"></div>
      <div style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:11px; height:11px; border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.18);"></div>
      <div style="position:absolute; left:10px; right:10px; bottom:10px; background:rgba(255,255,255,.94); border:1px solid var(--card-border); border-radius:var(--radius); padding:8px 10px; font-size:12px; font-weight:900; color:#1f3d1e; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(label)}</div>
    </div>
  `;
}

function openFriendlyMapModal(agency) {
  if (!agency) return;
  const old = $('#friendly-map-modal');
  if (old) old.remove();
  const distance = agency.distanceKm == null ? '거리 계산 대기' : `${Number(agency.distanceKm).toLocaleString('ko-KR')}km`;
  const lat = Number(agency.latitude);
  const lng = Number(agency.longitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const modal = document.createElement('div');
  modal.id = 'friendly-map-modal';
  modal.style.cssText = 'position:absolute; inset:0; z-index:70; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; padding:18px;';
  modal.innerHTML = `
    <div style="width:100%; max-width:330px; background:#fff; border-radius:var(--radius); box-shadow:0 14px 34px rgba(0,0,0,.22); overflow:hidden;">
      <div style="padding:18px; border-bottom:1px solid #e5eee2; display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
        <div>
          <div style="font-size:17px; font-weight:900; color:#1f3d1e; line-height:1.3;">${escapeHtml(agency.name || '배달대행사')}</div>
        </div>
        <button type="button" id="friendly-map-close" aria-label="닫기" style="border:none; background:#f1f7ef; color:#2f7d32; border-radius:8px; width:32px; height:32px; font-size:22px; line-height:1; cursor:pointer;">×</button>
      </div>
      <div style="padding:18px;">
        <div id="friendly-kakao-map" style="height:220px; border:1.5px solid var(--card-border); border-radius:var(--radius); overflow:hidden; background:#eef6ed; margin-bottom:12px; position:relative;">
          ${hasCoords
            ? `<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#6f7d6b; font-size:12px; font-weight:900;">카카오 지도를 준비하고 있습니다.</div>`
            : `<div style="height:100%; display:flex; align-items:center; justify-content:center; text-align:center; padding:16px; color:#6f7d6b; font-size:13px; font-weight:900; line-height:1.45;">지도 좌표가 없어<br>지도앱에서 확인해주세요.</div>`}
        </div>
        <div style="border:1.5px solid var(--card-border); border-radius:var(--radius); background:linear-gradient(145deg,#f8fff7,#ffffff); padding:14px; margin-bottom:14px;">
          <div style="font-size:12px; font-weight:900; color:#2f7d32; margin-bottom:8px;">지도 위치 정보</div>
          <div style="font-size:14px; font-weight:900; color:#111; line-height:1.45;">${escapeHtml(agency.coverageArea || '주소 확인 중')}</div>
          <div style="font-size:12px; font-weight:800; color:#6f7d6b; margin-top:8px;">거리 ${escapeHtml(distance)}</div>
          ${agency.phone ? `<div style="font-size:12px; font-weight:800; color:#6f7d6b; margin-top:4px;">연락처 ${escapeHtml(agency.phone)}</div>` : ''}
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <button type="button" id="friendly-map-cancel" class="btn-secondary" style="height:42px; font-size:13px;">닫기</button>
          <button type="button" id="friendly-map-refresh" class="btn-primary" style="height:42px; font-size:13px;">새로고침</button>
        </div>
      </div>
    </div>
  `;
  const shell = $('#app-shell') || document.body;
  shell.appendChild(modal);
  const close = () => modal.remove();
  $('#friendly-map-close', modal)?.addEventListener('click', close);
  $('#friendly-map-cancel', modal)?.addEventListener('click', close);
  const mapContainer = $('#friendly-kakao-map', modal);
  if (hasCoords) void renderFriendlyKakaoMap(mapContainer, agency, lat, lng);
  $('#friendly-map-refresh', modal)?.addEventListener('click', () => {
    if (hasCoords) void renderFriendlyKakaoMap(mapContainer, agency, lat, lng);
  });
  modal.addEventListener('click', event => {
    if (event.target === modal) close();
  });
}

function friendlyDeliveryPositionKey(position) {
  const lat = Number(position?.coords?.latitude);
  const lng = Number(position?.coords?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'default';
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function renderFriendlyDeliveryPreparedState(position = null) {
  const status = $('#friendly-delivery-status');
  const summary = $('#friendly-delivery-location-summary');
  if (friendlyDeliveryCache.length) {
    if (status) status.textContent = '현재 위치 기준 배달대행사 정보를 준비해두었습니다.';
    renderFriendlyDeliveryList(friendlyDeliveryCache);
  }
  if (!summary || !friendlyDeliveryMetaCache) return;
  const meta = friendlyDeliveryMetaCache;
  if (meta.hasLocation) {
    const area = meta.nearestCoverageArea || '가까운 권역 확인 중';
    const agency = meta.nearestAgencyName || '배달대행사';
    const distance = meta.nearestDistanceKm == null ? '' : ` · 약 ${Number(meta.nearestDistanceKm).toLocaleString('ko-KR')}km`;
    const locationAddress = position?.savedAddress || meta.locationAddress || '';
    summary.innerHTML = `
      <div>현재위치 : ${escapeHtml(locationAddress || '확인 중')}</div>
      <div style="margin-top:4px;">가까운권역 : ${escapeHtml(area)} · ${escapeHtml(agency)}${escapeHtml(distance)}</div>
    `;
    summary.style.display = 'block';
  }
}

function prefetchFriendlyDeliveryAgencies(position = getSavedFriendlyDeliveryPosition(), { force = false } = {}) {
  const targetPosition = position || getSavedFriendlyDeliveryPosition();
  const key = friendlyDeliveryPositionKey(targetPosition);
  const fresh = Date.now() - friendlyDeliveryCacheAt < 5 * 60 * 1000;
  if (!force && friendlyDeliveryCache.length && fresh && key === friendlyDeliveryPrefetchKey) {
    return Promise.resolve(friendlyDeliveryCache);
  }
  if (!force && friendlyDeliveryPrefetchPromise && key === friendlyDeliveryPrefetchKey) {
    return friendlyDeliveryPrefetchPromise;
  }
  friendlyDeliveryPrefetchKey = key;
  friendlyDeliveryPrefetchPromise = fetchFriendlyDeliveryAgencies(targetPosition, { silent: true })
    .catch(() => friendlyDeliveryCache)
    .finally(() => {
      friendlyDeliveryPrefetchPromise = null;
    });
  return friendlyDeliveryPrefetchPromise;
}

async function fetchFriendlyDeliveryAgencies(position = null, options = {}) {
  const silent = !!options.silent;
  const status = $('#friendly-delivery-status');
  const summary = $('#friendly-delivery-location-summary');
  const list = $('#friendly-delivery-list');
  const lat = position?.coords?.latitude;
  const lng = position?.coords?.longitude;
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
  if (!silent && status) status.textContent = hasLocation ? '현재 위치 기준 가까운 배달대행사를 정렬했습니다.' : '위치 권한 없이 기본 추천 순서로 표시합니다.';
  if (!silent && summary) {
    summary.style.display = 'none';
    summary.textContent = '';
  }
  if (!silent && list) list.innerHTML = '<div style="padding:24px;text-align:center;"><div class="spinner" style="border-top-color: var(--green-primary); width: 26px; height: 26px; margin: 0 auto;"></div></div>';
  const resolvedAddress = hasLocation
    ? (position?.savedAddress || await resolveFriendlyLocationAddress(lat, lng).catch(() => ''))
    : '';
  const url = hasLocation
    ? `/api/delivery-agencies/nearby?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&address=${encodeURIComponent(resolvedAddress)}&_=${Date.now()}`
    : `/api/delivery-agencies/nearby?_=${Date.now()}`;
  try {
    const response = await fetch(apiUrl(url), { cache: 'no-store' });
    if (!response.ok) throw new Error('배달대행사 정보를 불러오지 못했습니다.');
    const payload = await response.json().catch(() => null);
    friendlyDeliveryCache = Array.isArray(payload?.data?.items)
      ? payload.data.items
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
    const meta = payload?.meta || payload?.data?.meta || {};
    friendlyDeliveryMetaCache = meta;
    friendlyDeliveryCacheAt = Date.now();
    if (hasLocation && meta.hasLocation) {
      saveFriendlyDeliveryLocation({
        latitude: lat,
        longitude: lng,
        address: resolvedAddress || meta.locationAddress || '',
        savedAt: Date.now()
      });
    }
    if (summary && (!silent || state.currentScreen === 'friendly-delivery')) {
      if (meta.hasLocation) {
        const area = meta.nearestCoverageArea || '가까운 권역 확인 중';
        const agency = meta.nearestAgencyName || '배달대행사';
        const distance = meta.nearestDistanceKm == null ? '' : ` · 약 ${Number(meta.nearestDistanceKm).toLocaleString('ko-KR')}km`;
        const locationAddress = resolvedAddress || meta.locationAddress || '';
        const addressLine = locationAddress
          ? `현재위치 : ${locationAddress}`
          : '현재위치 : 확인 중';
        summary.innerHTML = `
          <div>${escapeHtml(addressLine)}</div>
          <div style="margin-top:4px;">가까운권역 : ${escapeHtml(area)} · ${escapeHtml(agency)}${escapeHtml(distance)}</div>
        `;
        summary.style.display = 'block';
      } else {
        summary.innerHTML = '현재위치 : 위치 권한을 허용해주세요<br><span style="color:var(--text-muted);">가까운권역 : 위치 확인 후 표시됩니다.</span>';
        summary.style.display = 'block';
      }
    }
  } catch (err) {
    if (!silent) friendlyDeliveryCache = [];
    if (!silent && summary) {
      summary.textContent = '현재위치 : 확인 실패, 가까운권역 : 확인 대기';
      summary.style.display = 'block';
    }
    if (!silent) showToast(err.message || '배달대행사 정보를 불러오지 못했습니다.');
  }
  if (!silent || state.currentScreen === 'friendly-delivery') {
    renderFriendlyDeliveryList(friendlyDeliveryCache);
  }
  return friendlyDeliveryCache;
}

function getFriendlyDeliveryLocationStorageKey() {
  const user = getSessionUser();
  const userId = user?.id || user?.email || user?.loginId || 'guest';
  return `eatspay.friendlyDeliveryLocation.${userId}`;
}

function saveFriendlyDeliveryLocation(location) {
  if (!location) return;
  try {
    const payload = JSON.stringify(location);
    localStorage.setItem(GLOBAL_CERTIFIED_LOCATION_KEY, payload);
    if (isAuthenticated()) {
      localStorage.setItem(getFriendlyDeliveryLocationStorageKey(), payload);
    }
  } catch (err) {
    // 저장 실패 시에도 위치 기반 검색 자체는 그대로 동작해야 합니다.
  }
}

function getSavedFriendlyDeliveryPosition() {
  try {
    const raw = isAuthenticated()
      ? (localStorage.getItem(getFriendlyDeliveryLocationStorageKey()) || localStorage.getItem(GLOBAL_CERTIFIED_LOCATION_KEY))
      : localStorage.getItem(GLOBAL_CERTIFIED_LOCATION_KEY);
    const saved = JSON.parse(raw || 'null');
    const lat = Number(saved?.latitude);
    const lng = Number(saved?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      coords: {
        latitude: lat,
        longitude: lng,
        accuracy: null
      },
      savedAddress: saved.address || saved.savedAddress || saved.addressName || '',
      savedAt: saved.savedAt || null
    };
  } catch (err) {
    return null;
  }
}

function getCertifiedLocationPosition() {
  return getSavedFriendlyDeliveryPosition();
}

function hasCertifiedStartupLocation() {
  return Boolean(getCertifiedLocationPosition()?.coords);
}

function resolveStartupTargetAfterLocation() {
  return pendingLocationGateTarget || (isAuthenticated() && getApprovalState() === 'approved' ? 'home' : 'home');
}

function getGeoErrorMessage(error) {
  const code = Number(error?.code || 0);
  if (code === 1) return '위치 권한이 차단되어 있습니다. 앱 권한 설정에서 위치를 허용해 주세요.';
  if (code === 2) return '현재 위치를 확인하지 못했습니다. GPS 또는 네트워크 위치를 켠 뒤 다시 시도해 주세요.';
  if (code === 3) return '위치 확인 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.';
  return '현재 위치를 확인하지 못했습니다. 위치 권한과 GPS 상태를 확인해 주세요.';
}

function getBrowserCurrentPosition({ force = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('이 기기에서는 위치 인증을 사용할 수 없습니다.'));
      return;
    }
    const highAccuracyOptions = { enableHighAccuracy: true, timeout: 12000, maximumAge: force ? 0 : 300000 };
    const fallbackOptions = { enableHighAccuracy: false, timeout: 10000, maximumAge: force ? 0 : 300000 };
    navigator.geolocation.getCurrentPosition(
      resolve,
      firstError => {
        if (firstError?.code === 1) {
          reject(firstError);
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, fallbackOptions);
      },
      highAccuracyOptions
    );
  });
}

function saveCertifiedLocationFromPosition(position, address = '') {
  const lat = Number(position?.coords?.latitude);
  const lng = Number(position?.coords?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const savedAddress = address || position?.savedAddress || '';
  saveFriendlyDeliveryLocation({
    latitude: lat,
    longitude: lng,
    address: savedAddress,
    savedAt: Date.now()
  });
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy: position?.coords?.accuracy ?? null
    },
    savedAddress,
    savedAt: Date.now()
  };
}

async function certifyCurrentLocation({ force = false, silent = false } = {}) {
  const saved = getCertifiedLocationPosition();
  if (saved?.coords && !force) return saved;
  if (!navigator.geolocation) {
    if (!silent) showToast('이 기기에서는 위치 인증을 사용할 수 없습니다.');
    return saved;
  }
  if (certifiedLocationRequestPromise) return certifiedLocationRequestPromise;
  certifiedLocationRequestPromise = getBrowserCurrentPosition({ force })
    .then(async position => {
      const lat = Number(position?.coords?.latitude);
      const lng = Number(position?.coords?.longitude);
      const address = Number.isFinite(lat) && Number.isFinite(lng)
        ? await resolveFriendlyLocationAddress(lat, lng).catch(() => '')
        : '';
      const certified = saveCertifiedLocationFromPosition(position, address);
      if (certified) {
        talkViewerPosition = certified;
        void prefetchFriendlyDeliveryAgencies(certified);
        if (!silent) showToast('현재 위치 인증이 완료되었습니다.');
      }
      return certified || saved;
    })
    .catch(error => {
      if (!silent) showToast(getGeoErrorMessage(error));
      return saved;
    })
    .finally(() => {
      certifiedLocationRequestPromise = null;
    });
  return certifiedLocationRequestPromise;
}

function renderLocationSetupState(message = '') {
  const status = $('#location-setup-status');
  const summary = $('#location-setup-summary');
  const saved = getCertifiedLocationPosition();
  if (summary) {
    if (saved?.coords) {
      const address = saved.savedAddress || '현재 위치 인증 완료';
      summary.innerHTML = `현재위치 : ${escapeHtml(address)}<br><span style="color:var(--text-muted);">이 위치를 기준으로 이츠톡과 배달대행사 정보를 보여드립니다.</span>`;
      summary.style.display = 'block';
    } else {
      summary.style.display = 'none';
      summary.textContent = '';
    }
  }
  if (status) status.textContent = message || (saved?.coords ? '위치 인증이 완료되었습니다.' : '위치 권한 팝업이 뜨면 허용을 눌러주세요.');
}

async function requestStartupLocationPermission() {
  const btn = $('#location-setup-request');
  const recheck = $('#location-setup-recheck');
  if (hasCertifiedStartupLocation()) {
    void prefetchFriendlyDeliveryAgencies(getCertifiedLocationPosition());
    renderLocationSetupState('저장된 현재 위치를 확인했습니다.');
    navigate(resolveStartupTargetAfterLocation(), 'replace');
    if (isAuthenticated()) handlePendingPushRoute();
    return;
  }
  if (!navigator.geolocation) {
    renderLocationSetupState('이 기기에서는 위치 기능을 사용할 수 없습니다. 브라우저 또는 앱 권한 설정을 확인해주세요.');
    showToast('이 기기에서는 위치 인증을 사용할 수 없습니다.');
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = '현재 위치 확인 중...';
  }
  if (recheck) recheck.disabled = true;
  renderLocationSetupState('현재 위치를 확인하고 있습니다.');
  const certified = await certifyCurrentLocation({ force: true, silent: true });
  if (btn) {
    btn.disabled = false;
    btn.textContent = '현재 위치 인증하기';
  }
  if (recheck) recheck.disabled = false;
  if (certified?.coords) {
    talkViewerPosition = certified;
    void prefetchFriendlyDeliveryAgencies(certified, { force: true });
    renderLocationSetupState('현재 위치 인증이 완료되었습니다.');
    setTimeout(() => {
      navigate(resolveStartupTargetAfterLocation(), 'replace');
      if (isAuthenticated()) handlePendingPushRoute();
    }, 450);
    return;
  }
  renderLocationSetupState('위치 권한이 꺼져 있습니다. 기기 설정에서 이츠페이 위치 권한을 허용한 뒤 다시 확인해주세요.');
}

function requestFriendlyDeliveryLocation() {
  const status = $('#friendly-delivery-status');
  if (status) status.textContent = '현재 위치를 확인하고 있습니다.';
  void certifyCurrentLocation({ force: true, silent: false }).then(position => {
    if (position?.coords) {
      talkViewerPosition = position;
      void fetchFriendlyDeliveryAgencies(position);
      if (state.currentScreen === 'talk') void fetchTalkPosts(30);
      return;
    }
    if (status) status.textContent = '위치 확인이 필요합니다. 기기 설정에서 위치 권한과 GPS를 확인해 주세요.';
    void fetchFriendlyDeliveryAgencies();
  });
}

// --- Screen Navigation ---
function navigate(screenId, direction = 'forward') {
  const restrictedScreens = ['my', 'payment-history', 'card-list', 'card-add', 'vaccount-list', 'vaccount-add', 'edit-myinfo', 'charge', 'agency', 'advance-settlement', 'talk-write', 'talk-chats', 'talk-chat'];
  const approvalRequiredScreens = ['charge', 'agency', 'advance-settlement', 'talk-write', 'talk-chats', 'talk-chat'];
  const approvalState = getApprovalState();

  if (restrictedScreens.includes(screenId)) {
    if (!isAuthenticated()) {
      showToast('로그인이 필요합니다.');
      screenId = 'login';
    } else if (screenId === 'talk-write' && isAgencyAccount()) {
      showToast('가맹점 계정으로 로그인해야 등록할 수 있습니다.');
      screenId = 'talk';
    } else if (screenId === 'agency' && !isAgencyAccount()) {
      showToast('대리점 계정으로 로그인해야 이용할 수 있습니다.');
      screenId = 'home';
    } else if (approvalRequiredScreens.includes(screenId) && approvalState !== 'approved') {
      showToast(approvalState === 'pending' ? '승인 대기중입니다.' : '승인이 반려된 계정입니다.');
      screenId = 'account-status';
    }
  }

  const current = $(`#screen-${state.currentScreen}`);
  const next = $(`#screen-${screenId}`);
  if (!next || screenId === state.currentScreen) return;

  if (screenId === 'payment-history' && typeof syncPaymentHistoryDateRange === 'function') {
    syncPaymentHistoryDateRange();
  }

  if (direction === 'forward') {
    state.history.push(state.currentScreen);
    current.classList.remove('active');
    next.classList.add('active', 'slide-in-right');
    setTimeout(() => next.classList.remove('slide-in-right'), 350);
    window.history.pushState({ screen: screenId }, '');
  } else {
    current.classList.remove('active');
    next.classList.add('active', 'slide-in-left');
    setTimeout(() => next.classList.remove('slide-in-left'), 350);
  }

  state.currentScreen = screenId;
  normalizeBackButtons();
  renderAgencyInviteNotice();
  if (screenId !== 'card-add') {
    cardEditDraft = null;
  }
  updateBottomNav(screenId);
  if (['home', 'payment-history', 'login', 'account-status'].includes(screenId)) {
    syncLoggedInViews();
  }
  if (screenId === 'login') {
    resetLoginForm();
  }
  if (screenId === 'location-setup') {
    renderLocationSetupState();
  }
  if (screenId === 'charge') {
    void refreshChargePaymentOptions();
  }
  if (screenId === 'friendly-delivery') {
    const savedPosition = getSavedFriendlyDeliveryPosition();
    renderFriendlyDeliveryPreparedState(savedPosition);
    if (savedPosition?.coords) {
      void fetchFriendlyDeliveryAgencies(savedPosition, { silent: friendlyDeliveryCache.length > 0 });
    } else {
      const status = $('#friendly-delivery-status');
      if (status) status.textContent = '현재 위치를 확인하고 있습니다.';
      void certifyCurrentLocation({ force: true, silent: true }).then(position => {
        if (position?.coords) void fetchFriendlyDeliveryAgencies(position);
        else {
          if (status) status.textContent = '위치 확인이 필요합니다. 현재 위치로 찾기를 눌러 다시 시도해 주세요.';
          void fetchFriendlyDeliveryAgencies();
        }
      });
    }
  }
  if (screenId === 'home') {
    const savedPosition = getSavedFriendlyDeliveryPosition();
    if (savedPosition?.coords) void prefetchFriendlyDeliveryAgencies(savedPosition);
    if (savedPosition?.coords) void fetchHomeWeather(savedPosition);
    else renderHomeWeather(null);
    void certifyCurrentLocation({ silent: true }).then(position => {
      if (position?.coords) void fetchHomeWeather(position);
    });
    renderAppBanner('메인');
    startHomePartnerAdRotation();
    renderCurrentInstallmentBanner();
    startInstallmentBannerRotation();
  void fetchTalkPosts(30);
  }
  if (screenId === 'charge') {
    renderAppBanner('결제');
  }
  if (screenId === 'talk') {
    renderAppBanner('이츠톡');
    requestTalkViewerLocation();
    renderTalkBoard(talkPostCache);
    void fetchTalkPosts(30);
  }
  if (screenId === 'cs-main') {
    renderAppBanner('고객센터');
  }
  if (screenId === 'talk-detail') {
    requestTalkViewerLocation();
    renderTalkDetail();
  }
  if (screenId === 'talk-write') {
    renderTalkImagePreview();
  }
  if (screenId === 'talk-chats') {
    void fetchTalkChats();
  }
  if (screenId === 'talk-chat') {
    stopTalkChatPolling();
    void fetchTalkMessages();
    talkChatPollTimer = setInterval(() => fetchTalkMessages({ silent: true }), 3000);
  } else {
    stopTalkChatPolling();
  }
  if (screenId === 'card-list') {
    void refreshCardList();
  }
  if (screenId === 'card-add') {
    applyCardEditDraftToForm();
    if (!cardEditDraft?.aliasOnly) {
      setTimeout(unlockCardAddFormControls, 50);
    }
  }
  if (screenId === 'vaccount-list') {
    void refreshVaccountList();
  }
  if (screenId === 'vaccount-add') {
    syncVaccountAgencyButtons();
    syncVaccountPhotoPreview();
  } else {
    closeVaccountPhotoSheet();
  }
  if (screenId === 'reg-step3') {
    syncBizLicensePreview();
  }
  if (screenId === 'reg-step4') {
    void loadActiveLegalDocuments();
  }
  if (screenId === 'delivery-agency-list') {
    normalizeDeliveryAgencyListText();
    void loadDeliveryAgencyList();
  }
  if (screenId === 'benefit-cards') {
    renderBenefitCardList();
  }
  if (screenId === 'advance-settlement') {
    prefillAdvanceSettlementForm();
  }
  if (screenId === 'card-benefit-search') {
    if (!benefitCardSearchCache.length) void fetchBenefitCardSearch('');
    else renderBenefitCardSearchList(benefitCardSearchCache);
  }
  if (screenId === 'agency') {
    syncAgencyDateRange();
    void fetchAgencySettlement();
  }
  if (screenId === 'cs-promo') {
    renderCsInstallmentList();
    void loadInstallmentBanner();
  }
  if (screenId === 'cs-faq') {
    if (!faqCache.length) void fetchCsFaqs();
    else renderCsFaqList(faqCache);
  }
  if (screenId === 'cs-notices') {
    if (!noticeCache.length) void fetchCsNotices();
    else renderCsNotices(noticeCache);
  }
  if (screenId === 'cs-guide') {
    if (!guideCache.length) void fetchCsGuides();
    else renderCsGuides(guideCache);
  }
}

function goBack() {
  if (state.history.length === 0) return;
  const prev = state.history.pop();
  navigate(prev, 'backward');
}

function handleAndroidBackButton() {
  if (state.history.length > 0) {
    goBack();
    return;
  }

  if (state.currentScreen === 'home') {
    showToast('이전 화면이 없습니다.');
    return;
  }

  if (state.currentScreen !== 'login' && state.currentScreen !== 'splash') {
    navigate('login', 'backward');
    return;
  }

  showToast('이전 화면이 없습니다.');
}

window.EATSPAY_HANDLE_ANDROID_BACK = handleAndroidBackButton;

function updateBottomNav(screenId) {
  renderBottomNavs(screenId);
  $$('.nav-item').forEach(btn => btn.classList.remove('active'));
  const isHome = ['home', 'charge', 'benefit-cards', 'card-benefit-search', 'friendly-delivery', 'advance-settlement', 'talk', 'talk-detail', 'talk-write', 'talk-chats', 'talk-chat'].includes(screenId);
  const isAgencyFlow = ['agency'].includes(screenId);
  const isMyFlow = ['my', 'find-id', 'find-pw', 'card-list', 'card-add', 'payment-history', 'vaccount-list', 'vaccount-add', 'delivery-agency-list', 'edit-myinfo', 'login'].includes(screenId);
  const isCsFlow = ['cs-main', 'cs-guide', 'cs-promo', 'cs-faq', 'cs-notices'].includes(screenId);
  const showMyNav = isAuthenticated();
  
  if (isHome) {
    $$('[id^="nav-home"]').forEach(el => el.classList.add('active'));
  } else if (isAgencyFlow) {
    $$('[id^="nav-agency"]').forEach(el => el.classList.add('active'));
  } else if (isMyFlow) {
    if (showMyNav) {
      $$('[id^="nav-my"]').forEach(el => el.classList.add('active'));
    }
  } else if (isCsFlow) {
    $$('[id^="nav-cs"]').forEach(el => el.classList.add('active'));
  }
}

function bottomNavIcon(type) {
  const iconType = ['home', 'agency', 'my', 'cs'].includes(type) ? type : 'home';
  return `<span class="bottom-nav-icon bottom-nav-icon-${iconType}" aria-hidden="true"></span>`;
}

function renderBottomNavs(activeScreen = state.currentScreen) {
  const user = getSessionUser();
  const items = [{ id: 'home', label: '홈' }];
  if (isAgencyAccount(user)) items.push({ id: 'agency', label: '대리점' });
  items.push({ id: 'my', label: '내정보' });
  items.push({ id: 'cs', label: '고객센터' });
  const active = activeScreen === 'agency'
    ? 'agency'
    : ['cs-main', 'cs-guide', 'cs-promo', 'cs-faq', 'cs-notices'].includes(activeScreen)
      ? 'cs'
      : ['my', 'find-id', 'find-pw', 'card-list', 'card-add', 'payment-history', 'vaccount-list', 'vaccount-add', 'delivery-agency-list', 'edit-myinfo', 'login'].includes(activeScreen)
        ? 'my'
        : 'home';
  $$('.bottom-nav').forEach((nav, index) => {
    nav.classList.remove('nav-hovering');
    const screenId = nav.closest('.screen')?.id?.replace(/^screen-/, '') || `nav-${index}`;
    const html = items.map(item => `
    <button type="button" class="nav-item${active === item.id ? ' active' : ''}" id="nav-${item.id}-${screenId}" data-nav-target="${item.id}">
      ${bottomNavIcon(item.id)}
      <span class="nav-label">${item.label}</span>
    </button>
  `).join('');
    nav.innerHTML = html;
    $$('.nav-item', nav).forEach(button => {
      const activateNav = event => {
        const now = Date.now();
        if (now - Number(button.dataset.lastNavAt || 0) < 320) {
          event?.preventDefault?.();
          return;
        }
        button.dataset.lastNavAt = String(now);
        const target = button.dataset.navTarget || '';
        if (!target) return;
        event?.preventDefault?.();
        if (target === 'home') navigate('home');
        else if (target === 'agency') navigate('agency');
        else if (target === 'my') navigate('my');
        else if (target === 'cs') navigate('cs-main');
      };
      button.addEventListener('click', activateNav);
      button.addEventListener('pointerup', activateNav);
      button.addEventListener('touchend', activateNav, { passive: false });
    });
  });
}

let appDialogQueue = Promise.resolve();

function showToast(msg) {
  const message = getFriendlyErrorMessage({ message: msg }, String(msg || '알림'));
  if (message !== msg) console.warn('[app-alert] normalized message', { original: msg, message });
  return showAppAlert(message, '알림');
}

function showInAppNotification({ title = '새 알림', body = '내용을 확인해 주세요.', data = {}, icon = '톡', duration = 5200 } = {}) {
  const banner = $('#in-app-notification');
  const titleEl = $('#in-app-notification-title');
  const bodyEl = $('#in-app-notification-body');
  const iconEl = $('.in-app-notification-icon', banner || document);
  if (!banner || !titleEl || !bodyEl || !iconEl) {
    return showAppAlert(body, title);
  }

  clearTimeout(inAppNotificationTimer);
  titleEl.textContent = title;
  bodyEl.textContent = body;
  iconEl.textContent = icon;
  banner.dataset.payload = JSON.stringify(data || {});
  banner.setAttribute('aria-hidden', 'false');
  banner.classList.add('show');
  inAppNotificationTimer = setTimeout(() => {
    banner.classList.remove('show');
    banner.setAttribute('aria-hidden', 'true');
  }, duration);
}

function showAppDialog({ title = '알림', message = '', html = '', confirmText = '확인', cancelText = '취소', showCancel = false } = {}) {
  appDialogQueue = appDialogQueue.then(() => openAppDialog({ title, message, html, confirmText, cancelText, showCancel }));
  return appDialogQueue;
}

function openAppDialog({ title = '알림', message = '', html = '', confirmText = '확인', cancelText = '취소', showCancel = false } = {}) {
  const backdrop = $('#app-dialog-backdrop');
  const dialog = $('#app-dialog');
  const titleEl = $('#app-dialog-title');
  const messageEl = $('#app-dialog-message');
  const confirmBtn = $('#app-dialog-confirm');
  const cancelBtn = $('#app-dialog-cancel');

  if (!backdrop || !dialog || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
    return Promise.resolve(true);
  }

  titleEl.textContent = title;
  if (html) {
    messageEl.innerHTML = html;
  } else {
    messageEl.textContent = message;
  }
  confirmBtn.textContent = confirmText;
  cancelBtn.textContent = cancelText;
  cancelBtn.style.display = showCancel ? '' : 'none';
  backdrop.classList.add('show');
  dialog.classList.add('show');
  backdrop.setAttribute('aria-hidden', 'false');
  dialog.setAttribute('aria-hidden', 'false');

  return new Promise(resolve => {
    const close = value => {
      backdrop.classList.remove('show');
      dialog.classList.remove('show');
      backdrop.setAttribute('aria-hidden', 'true');
      dialog.setAttribute('aria-hidden', 'true');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKeydown);
      messageEl.textContent = '';
      resolve(value);
    };
    const onConfirm = () => close(true);
    const onCancel = () => close(false);
    const onKeydown = event => {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Enter') close(true);
    };

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeydown);
    setTimeout(() => confirmBtn.focus(), 0);
  });
}

const showAppAlert = (message, title = '알림') => showAppDialog({ title, message });
const showAppHtmlAlert = (html, title = '알림') => showAppDialog({ title, html });
const showAppConfirm = (message, title = '확인') => showAppDialog({
  title,
  message,
  showCancel: true,
  confirmText: '확인',
  cancelText: '취소'
});

function playSignupCelebration() {
  const host = $('.screen-container') || $('#app-shell') || document.body;
  const old = $('.signup-celebration', host);
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.className = 'signup-celebration';
  overlay.innerHTML = `
    <div class="signup-celebration-card">
      <div class="signup-celebration-badge">✓</div>
      <div class="signup-celebration-title">가입이 완료되었습니다</div>
      <div class="signup-celebration-text">이츠페이가 대표님의 시작을 응원합니다.</div>
    </div>
  `;

  const colors = ['#3db43a', '#2ac1bc', '#ffd34d', '#ff6b6b', '#377dff', '#ffffff'];
  for (let i = 0; i < 46; i += 1) {
    const piece = document.createElement('span');
    piece.className = `signup-confetti${i % 5 === 0 ? ' round' : ''}`;
    const angle = (Math.PI * 2 * i) / 46;
    const distance = 110 + Math.random() * 150;
    piece.style.setProperty('--confetti-x', `${Math.cos(angle) * distance}px`);
    piece.style.setProperty('--confetti-y', `${Math.sin(angle) * distance + 38}px`);
    piece.style.setProperty('--confetti-color', colors[i % colors.length]);
    piece.style.setProperty('--confetti-rotate', `${Math.round(Math.random() * 240)}deg`);
    piece.style.setProperty('--confetti-delay', `${(i % 9) * 0.018}s`);
    overlay.appendChild(piece);
  }

  [
    ['50%', '44%', '#3db43a', '0s'],
    ['34%', '36%', '#2ac1bc', '.08s'],
    ['66%', '38%', '#ffd34d', '.14s'],
    ['45%', '57%', '#ff6b6b', '.2s'],
    ['58%', '56%', '#377dff', '.24s']
  ].forEach(([x, y, color, delay]) => {
    const ring = document.createElement('span');
    ring.className = 'signup-firework-ring';
    ring.style.setProperty('--ring-x', x);
    ring.style.setProperty('--ring-y', y);
    ring.style.setProperty('--ring-color', color);
    ring.style.setProperty('--ring-delay', delay);
    overlay.appendChild(ring);
  });

  host.appendChild(overlay);

  return new Promise(resolve => {
    setTimeout(() => {
      overlay.remove();
      resolve();
    }, 1850);
  });
}

function resetAppToSplash() {
  clearTimeout(state.splashTimer);
  state.currentScreen = 'splash';
  state.history = [];

  $$('.screen').forEach(screen => {
    screen.classList.remove('active', 'slide-in-right', 'slide-in-left', 'slide-out-right');
  });

  const splash = $('#screen-splash');
  if (splash) {
    splash.classList.add('active');
  }

  window.history.replaceState({ screen: 'splash' }, '');
  updateBottomNav('splash');
}

function resetLoginForm() {
  const idInput = $('#login-id');
  const pwInput = $('#login-pw');
  const keepLogin = $('#keep-login-cb');
  if (idInput) idInput.value = '';
  if (pwInput) pwInput.value = '';
  if (keepLogin) {
    keepLogin.classList.toggle('checked', isNativeApp() || localStorage.getItem('eatspay.keepLogin') === '1');
  }
}

function getRegisterAddressDetail() {
  return $('#reg-address-detail')?.value || $('#reg-tel')?.value || '';
}

function getRegisterFullAddress() {
  const baseAddress = $('#reg-address')?.value?.trim() || '';
  const detailAddress = getRegisterAddressDetail().trim();
  return [baseAddress, detailAddress].filter(Boolean).join(' ');
}

function safeUploadBaseName(value) {
  return String(value || '사업장').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_') || '사업장';
}

function getUploadExtension(file, fallback = '.jpg') {
  return file?.name?.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : fallback;
}

function getSessionStoreUploadName() {
  const user = getSessionUser();
  return safeUploadBaseName(user?.franchiseName || user?.storeName || user?.name || '사업장');
}

function getVaccountPhotoDisplayName(file) {
  return `${getSessionStoreUploadName()}_포스사진${getUploadExtension(file, '.jpg')}`;
}

function getBizLicenseDisplayName(file) {
  const storeName = safeUploadBaseName($('#reg-store-name')?.value || '사업장');
  return `${storeName}_사업자등록증${getUploadExtension(file, '')}`;
}

function getRegisterBizLicenseFile() {
  return bizLicenseFileState.file || $('#reg-biz-license-file')?.files?.[0] || null;
}

function getDraftInputValue(selector) {
  const input = $(selector);
  return input?.dataset?.actualValue || input?.value || '';
}

function persistRegisterDraft(markExternal = false) {
  const draft = {
    screen: state.currentScreen || 'reg-step3',
    businessNumber: $('#reg-biz-no')?.value || '',
    contactEmail: $('#reg-email')?.value || '',
    id: $('#reg-id')?.value || '',
    idAutoFilled: $('#reg-id')?.dataset.autoFilled || '0',
    password: getDraftInputValue('#reg-pw'),
    passwordConfirm: getDraftInputValue('#reg-pw-confirm'),
    phone: $('#reg-phone')?.value || '',
    sms: $('#reg-sms-input')?.value || '',
    smsCode: state.smsCode || '',
    storeName: $('#reg-store-name')?.value || '',
    ceoName: $('#reg-ceo-name')?.value || '',
    address: $('#reg-address')?.value || '',
    addressDetail: getRegisterAddressDetail(),
    agencyInvite: getStoredAgencyInvite()
  };
  sessionStorage.setItem(REGISTER_DRAFT_KEY, JSON.stringify(draft));
  if (markExternal) sessionStorage.setItem(EXTERNAL_FLOW_KEY, '1');
}

function restoreRegisterDraft() {
  const raw = sessionStorage.getItem(REGISTER_DRAFT_KEY);
  if (!raw) return null;
  let draft = null;
  try {
    draft = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  const currentInvite = getStoredAgencyInvite();
  const draftInvite = draft.agencyInvite && {
    agencyId: String(draft.agencyInvite.agencyId || '').trim(),
    agencyName: String(draft.agencyInvite.agencyName || '').trim(),
    joinCode: String(draft.agencyInvite.joinCode || '').trim()
  };
  if (draftInvite?.joinCode && currentInvite?.joinCode && draftInvite.joinCode !== currentInvite.joinCode) {
    sessionStorage.removeItem(REGISTER_DRAFT_KEY);
    return null;
  }
  if (draftInvite?.joinCode && !currentInvite) {
    saveAgencyInvite(draftInvite);
  }
  const values = {
    '#reg-biz-no': draft.businessNumber,
    '#reg-email': draft.contactEmail,
    '#reg-id': draft.id,
    '#reg-pw': draft.password,
    '#reg-pw-confirm': draft.passwordConfirm,
    '#reg-phone': draft.phone,
    '#reg-sms-input': draft.sms,
    '#reg-store-name': draft.storeName,
    '#reg-ceo-name': draft.ceoName,
    '#reg-address': draft.address,
    '#reg-address-detail': draft.addressDetail,
    '#reg-tel': draft.addressDetail
  };
  Object.entries(values).forEach(([selector, value]) => {
    const input = $(selector);
    if (input && value != null) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  const regId = $('#reg-id');
  if (regId) regId.dataset.autoFilled = draft.idAutoFilled || '0';
  if (draft.smsCode) state.smsCode = draft.smsCode;
  return draft;
}

function startInitialFlow() {
  clearTimeout(state.splashTimer);
  const hadSessionAuth = Boolean(sessionStorage.getItem('accessToken'));
  const restoredAuth = restoreKeptAuthSession();
  const hasAuthSession = restoredAuth || hadSessionAuth || isAuthenticated();
  if (!hasAuthSession) {
    clearSessionAuth();
    resetLoginForm();
  }
  syncLoggedInViews();
  if (hasAuthSession) {
    void refreshSessionUserProfile().then(() => {
      registerDevicePushToken();
      startNotificationPolling();
    });
  }
  const externalDraft = sessionStorage.getItem(EXTERNAL_FLOW_KEY) === '1' ? restoreRegisterDraft() : null;
  let targetScreen = externalDraft?.screen && externalDraft.screen !== 'splash'
    ? externalDraft.screen
    : (hasAuthSession && getApprovalState() === 'approved' ? 'home' : 'home');
  sessionStorage.removeItem(EXTERNAL_FLOW_KEY);
  if (!hasCertifiedStartupLocation()) {
    pendingLocationGateTarget = targetScreen;
    targetScreen = 'location-setup';
  }
  state.splashTimer = setTimeout(() => {
    navigate(targetScreen);
    if (targetScreen === 'location-setup') renderLocationSetupState();
  }, 2500);
}

function rememberAppBackgroundTime() {
  try {
    localStorage.setItem(APP_LAST_ACTIVE_KEY, String(Date.now()));
  } catch (err) {
    // 백그라운드 시간 저장 실패는 화면 복귀 자체를 막지 않습니다.
  }
}

function getAppBackgroundElapsedMs() {
  const lastActiveAt = Number(localStorage.getItem(APP_LAST_ACTIVE_KEY) || 0);
  return Number.isFinite(lastActiveAt) && lastActiveAt > 0 ? Date.now() - lastActiveAt : 0;
}

function restoreFreshLaunch({ forceStandardResume = false } = {}) {
  if (sessionStorage.getItem(EXTERNAL_FLOW_KEY) === '1') {
    const draft = restoreRegisterDraft();
    sessionStorage.removeItem(EXTERNAL_FLOW_KEY);
    if (draft?.screen && draft.screen !== state.currentScreen) {
      navigate(draft.screen, 'replace');
    }
    return;
  }
  restoreRegisterDraft();
  if (!hasCertifiedStartupLocation() && state.currentScreen !== 'location-setup' && state.currentScreen !== 'splash') {
    pendingLocationGateTarget = state.currentScreen || 'home';
    state.history = [];
    navigate('location-setup', 'replace');
    renderLocationSetupState();
    return;
  }
  if (!forceStandardResume || !isAuthenticated()) return;
  const elapsedMs = getAppBackgroundElapsedMs();
  if (
    elapsedMs >= APP_STANDARD_RESUME_HOME_MS &&
    !APP_RESUME_HOME_EXCLUDE_SCREENS.has(state.currentScreen)
  ) {
    state.history = [];
    navigate('home', 'replace');
  }
}

function formatPhone(val) {
  const cleaned = val.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{3})(\d{3,4})(\d{4})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return cleaned;
}

function getPasswordValue(inputId) {
  const input = $(inputId);
  return input?.value ?? input?.dataset.realPassword ?? '';
}

function clearPasswordValue(inputId) {
  const input = $(inputId);
  if (!input) return;
  input.dataset.realPassword = '';
  input.value = '';
}

function getSessionUser() {
  try {
    const current = sessionStorage.getItem('userProfile');
    if (!current && localStorage.getItem('eatspay.keepLogin') === '1') {
      restoreKeptAuthSession();
    }
    return JSON.parse(sessionStorage.getItem('userProfile') || 'null');
  } catch (err) {
    return null;
  }
}

function isKeepLoginChecked() {
  return $('#keep-login-cb')?.classList.contains('checked') || localStorage.getItem('eatspay.keepLogin') === '1';
}

function setAuthCookie(accessToken) {
  if (!accessToken) return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const domain = window.location.hostname === 'eatspay.kr' || window.location.hostname.endsWith('.eatspay.kr')
    ? '; Domain=.eatspay.kr'
    : '';
  document.cookie = `eatspay_access_token=${encodeURIComponent(accessToken)}; Path=/; Max-Age=2592000; SameSite=Lax${secure}${domain}`;
}

function clearAuthCookie() {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const domain = window.location.hostname === 'eatspay.kr' || window.location.hostname.endsWith('.eatspay.kr')
    ? '; Domain=.eatspay.kr'
    : '';
  document.cookie = `eatspay_access_token=; Path=/; Max-Age=0; SameSite=Lax${secure}${domain}`;
  document.cookie = `eatspay_access_token=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function persistAuthSession(accessToken, user, keepLogin = false) {
  sessionStorage.setItem('accessToken', accessToken);
  sessionStorage.setItem('userProfile', JSON.stringify(user || null));
  setAuthCookie(accessToken);
  startNotificationPolling();
  if (keepLogin) {
    localStorage.setItem('eatspay.keepLogin', '1');
    localStorage.setItem('eatspay.accessToken', accessToken);
    localStorage.setItem('eatspay.userProfile', JSON.stringify(user || null));
  } else {
    localStorage.removeItem('eatspay.keepLogin');
    localStorage.removeItem('eatspay.accessToken');
    localStorage.removeItem('eatspay.userProfile');
  }
}

function persistSessionUserProfile(user) {
  if (!user) return;
  const serialized = JSON.stringify(user);
  sessionStorage.setItem('userProfile', serialized);
  if (localStorage.getItem('eatspay.keepLogin') === '1') {
    localStorage.setItem('eatspay.userProfile', serialized);
  }
}

function restoreKeptAuthSession() {
  const keepLogin = localStorage.getItem('eatspay.keepLogin') === '1';
  const accessToken = localStorage.getItem('eatspay.accessToken') || '';
  const userProfile = localStorage.getItem('eatspay.userProfile') || '';
  if (!keepLogin || !accessToken || !userProfile) return false;
  try {
    JSON.parse(userProfile);
  } catch (err) {
    localStorage.removeItem('eatspay.keepLogin');
    localStorage.removeItem('eatspay.accessToken');
    localStorage.removeItem('eatspay.userProfile');
    return false;
  }
  sessionStorage.setItem('accessToken', accessToken);
  sessionStorage.setItem('userProfile', userProfile);
  const keepLoginCb = $('#keep-login-cb');
  if (keepLoginCb) keepLoginCb.classList.add('checked');
  return true;
}

function getAuthToken() {
  if (!sessionStorage.getItem('accessToken')) {
    restoreKeptAuthSession();
  }
  const token = sessionStorage.getItem('accessToken') || localStorage.getItem('eatspay.accessToken') || '';
  if (token) setAuthCookie(token);
  return token;
}

function getApprovalState(user = getSessionUser()) {
  if (!user) return 'guest';
  if (user.role === 'ADMIN') return 'approved';
  if (user.role === 'AGENCY') return 'approved';
  if (user.role === 'OWNER') return 'approved';
  if (user.role === 'OWNER_REJECTED') return 'rejected';
  if (user.role === 'OWNER_PENDING') return 'pending';
  return 'guest';
}

function isAgencyAccount(user = getSessionUser()) {
  return Boolean(user && user.role === 'AGENCY' && user.agencyId);
}

function getLoginDisplayName() {
  const user = getSessionUser();
  const approvalState = getApprovalState(user);
  if (!user) return '로그인을 해주세요';
  if (approvalState === 'pending') return '승인 대기중';
  if (approvalState === 'rejected') return '승인이 반려되었습니다';
  return user.franchiseName || user.storeName || user.name || '회원';
}

function getChargeOwnerLabel() {
  const user = getSessionUser() || {};
  const storeName = user.franchiseName || user.storeName || user.businessName || user.name || getLoginDisplayName();
  const memberId = user.loginId || user.userId || user.email || user.id || '';
  return memberId ? `${storeName} / ${memberId}` : storeName;
}

function isAuthenticated() {
  return Boolean(getAuthToken());
}

function isApprovedAccount() {
  return isAuthenticated() && getApprovalState() === 'approved';
}

function clearSessionAuth() {
  sessionStorage.removeItem('accessToken');
  sessionStorage.removeItem('userProfile');
  sessionStorage.removeItem('selectedDeliveryAgency');
  selectedAgency = '생각대로';
  sessionStorage.setItem('selectedDeliveryAgency', selectedAgency);
}

function clearAllAuth() {
  stopNotificationPolling();
  clearSessionAuth();
  clearAgencyInviteSession();
  clearAuthCookie();
  localStorage.removeItem('eatspay.keepLogin');
  localStorage.removeItem('eatspay.accessToken');
  localStorage.removeItem('eatspay.userProfile');
}

function syncLoggedInViews() {
  const storedUser = getSessionUser();
  if (isAuthenticated() && !storedUser) {
    clearSessionAuth();
  }
  const user = isAuthenticated() && storedUser ? storedUser : null;
  const approvalState = getApprovalState(user);
  const displayName = getLoginDisplayName();
  const authAction = $('#home-auth-action');
  const homeTitle = $('#home-identity-title');
  const bannerTitle = $('#home-banner-title');
  const bannerCaption = $('#home-banner-caption');
  const bannerName = $('#home-banner-name');
  const bannerSubtitle = $('#home-banner-subtitle');
  const paymentOwner = $('#payment-history-owner');
  const banner = $('#home-login-banner');
  const storeLabels = $$('.session-store-name');
  const editMyInfoPhone = $('#edit-myinfo-phone');
  const agencyOnly = isAgencyAccount(user);

  if (homeTitle) {
    homeTitle.textContent = user ? displayName : '로그인을 해주세요';
  }

  storeLabels.forEach(label => {
    label.textContent = user ? displayName : '로그인이 필요합니다.';
  });

  if (editMyInfoPhone && user?.phone && !editMyInfoPhone.value) {
    editMyInfoPhone.value = formatPhone(user.phone);
  }

  if (authAction) {
    authAction.textContent = user ? '로그아웃' : '로그인';
  }

  if (bannerTitle) {
    bannerTitle.textContent = 'eatspay';
  }
  if (bannerCaption) {
    bannerCaption.textContent = '배당대행비 카드결제의 새로운 기준';
  }

  if (paymentOwner) {
    if (!user) {
      paymentOwner.textContent = '로그인이 필요합니다.';
    } else if (approvalState === 'pending') {
      paymentOwner.textContent = '승인 대기중입니다.';
    } else if (approvalState === 'rejected') {
      paymentOwner.textContent = '승인이 반려되었습니다.';
    } else {
      paymentOwner.textContent = displayName;
    }
  }

  if (banner) {
    banner.dataset.loggedIn = user ? '1' : '0';
    banner.dataset.approvalState = approvalState;
  }

  const showMyNav = Boolean(user);
  renderBottomNavs(state.currentScreen);

  ['#my-card-manage-btn', '#my-payment-history-btn', '#my-vaccount-manage-btn'].forEach(selector => {
    const el = $(selector);
    if (el) el.style.display = agencyOnly ? 'none' : 'flex';
  });
  const agencySettlementBtn = $('#my-agency-settlement-btn');
  if (agencySettlementBtn) agencySettlementBtn.style.display = agencyOnly ? 'flex' : 'none';

  const statusChip = $('#account-status-chip');
  const statusTitle = $('#account-status-title');
  const statusMessage = $('#account-status-message');
  const statusUser = $('#account-status-user');

  if (statusChip && statusTitle && statusMessage && statusUser) {
    if (!user) {
      statusChip.textContent = '로그인 필요';
      statusChip.style.background = '#f0f0f0';
      statusChip.style.color = '#555';
      statusTitle.textContent = '로그인이 필요합니다.';
      statusMessage.textContent = '서비스 이용을 위해 먼저 로그인을 해주세요.';
      statusUser.textContent = '-';
    } else if (approvalState === 'pending') {
      statusChip.textContent = '승인 대기';
      statusChip.style.background = '#eef8e8';
      statusChip.style.color = '#2e7d32';
      statusTitle.textContent = '승인 대기중입니다.';
      statusMessage.textContent = '회원가입은 완료되었지만 관리자 승인 후 서비스를 이용하실 수 있습니다.';
      statusUser.textContent = `${displayName} / ${user.approvalLabel || '승인대기'}`;
    } else if (approvalState === 'rejected') {
      statusChip.textContent = '승인 반려';
      statusChip.style.background = '#fff1f2';
      statusChip.style.color = '#be123c';
      statusTitle.textContent = '승인이 반려되었습니다.';
      statusMessage.textContent = '관리자가 반려 처리한 상태입니다. 고객센터로 문의해 주세요.';
      statusUser.textContent = `${displayName} / ${user.approvalLabel || '승인반려'}`;
    } else {
      statusChip.textContent = '승인 완료';
      statusChip.style.background = '#eef8e8';
      statusChip.style.color = '#2e7d32';
      statusTitle.textContent = '정상 이용이 가능합니다.';
      statusMessage.textContent = '관리자 승인 완료 후 모든 서비스를 이용하실 수 있습니다.';
      statusUser.textContent = `${displayName} / ${user.approvalLabel || '승인완료'}`;
    }
  }
}

function logoutAndGoToLogin() {
  clearAllAuth();
  state.history = [];
  syncLoggedInViews();
  navigate('home');
  showToast('로그아웃되었습니다.');
}

async function refreshSessionUserProfile() {
  if (!isAuthenticated()) return null;

  const accessToken = sessionStorage.getItem('accessToken') || '';
  try {
    const response = await fetch(apiUrl('/api/auth/me'), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const user = payload?.data?.user || null;
    if (user) {
      persistSessionUserProfile(user);
      syncLoggedInViews();
    }
    return user;
  } catch (err) {
    return null;
  }
}

async function fetchUnreadNotifications() {
  if (!isAuthenticated()) return [];
  try {
    const response = await fetch(apiUrl('/api/notifications/unread'), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => null);
    return Array.isArray(payload?.data) ? payload.data : [];
  } catch (err) {
    return [];
  }
}

async function markNotificationsRead(ids) {
  const cleanIds = (Array.isArray(ids) ? ids : []).filter(Boolean);
  if (!isAuthenticated() || cleanIds.length === 0) return;
  try {
    await fetch(apiUrl('/api/notifications/read'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({ ids: cleanIds })
    });
  } catch (err) {
    // 알림 읽음 처리 실패는 화면 흐름을 막지 않습니다.
  }
}

async function showUnreadNotifications() {
  const notifications = await fetchUnreadNotifications();
  if (!notifications.length) return;
  const unseen = notifications.filter(item => {
    const id = item.id ? String(item.id) : '';
    return !id || sessionStorage.getItem(`notificationShown:${id}`) !== '1';
  });
  const targetItems = unseen.length ? unseen : notifications;
  const latest = targetItems[targetItems.length - 1];
  if (!latest) return;
  const ids = notifications.map(item => item.id).filter(Boolean);
  const latestId = latest.id ? String(latest.id) : '';
  const count = targetItems.length;
  const latestData = latest.data || {};
  const isTalk = latestData.targetScreen === 'talk-chat' || latestData.talkChatId || latestData.chatId;
  showInAppNotification({
    title: count > 1 ? `${latest.title || '새 알림'} 외 ${count - 1}개` : (latest.title || '새 알림'),
    body: latest.body || '내용을 확인해 주세요.',
    data: { ...latestData, unreadCount: count },
    icon: isTalk ? '톡' : 'EP',
    duration: 6200
  });
  ids.forEach(id => sessionStorage.setItem(`notificationShown:${id}`, '1'));
  if (latestId) sessionStorage.setItem(`notificationShown:${latestId}`, '1');
  await markNotificationsRead(ids);
}

function startNotificationPolling() {
  if (notificationPollingStarted) return;
  notificationPollingStarted = true;
  clearInterval(notificationPollTimer);
  void showUnreadNotifications();
  notificationPollTimer = setInterval(() => {
    if (!isAuthenticated()) {
      stopNotificationPolling();
      return;
    }
    void showUnreadNotifications();
  }, 10000);
}

function stopNotificationPolling() {
  notificationPollingStarted = false;
  clearInterval(notificationPollTimer);
  notificationPollTimer = null;
}

function getPushNotificationsPlugin() {
  return window.Capacitor?.Plugins?.PushNotifications || null;
}

function getDevicePlatform() {
  return window.Capacitor?.getPlatform?.() || 'web';
}

function isNativeApp() {
  const platform = getDevicePlatform();
  return platform === 'android' || platform === 'ios';
}

function parsePushDataValue(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

function getPushPayload(notification = {}) {
  const data = {
    ...parsePushDataValue(notification.data),
    ...parsePushDataValue(notification.notification?.data)
  };
  ['targetScreen', 'screen', 'route', 'target', 'talkPostId', 'postId', 'talkChatId', 'chatId', 'url'].forEach(key => {
    if (notification[key] != null && data[key] == null) data[key] = notification[key];
  });
  if (typeof data.payload === 'string') Object.assign(data, parsePushDataValue(data.payload));
  if (typeof data.data === 'string') Object.assign(data, parsePushDataValue(data.data));
  return data;
}

function hasPushNavigationTarget(data = {}) {
  const payload = getPushPayload(data);
  return Boolean(payload.targetScreen || payload.screen || payload.route || payload.target || payload.talkPostId || payload.postId || payload.talkChatId || payload.chatId || payload.url);
}

function getPushTargetScreen(payload = {}) {
  const rawTarget = String(payload.targetScreen || payload.screen || payload.route || payload.target || '').trim();
  if (rawTarget) {
    const normalized = rawTarget.replace(/^#?screen-/, '').replace(/^\//, '');
    const aliases = {
      'customer-center': 'cs-main',
      customerCenter: 'cs-main',
      cs: 'cs-main',
      faq: 'cs-faq',
      notices: 'cs-notices',
      notice: 'cs-notices',
      guide: 'cs-guide',
      guides: 'cs-guide',
      talkBoard: 'talk',
      talkDetail: 'talk-detail',
      talkChat: 'talk-chat',
      myInfo: 'my'
    };
    return aliases[normalized] || normalized;
  }
  if (payload.talkChatId || payload.chatId) return 'talk-chat';
  if (payload.talkPostId || payload.postId) return 'talk-detail';
  if (payload.url) {
    try {
      const url = new URL(payload.url, window.location.origin);
      return url.searchParams.get('targetScreen') || url.searchParams.get('pushTarget') || '';
    } catch (_) {
      return '';
    }
  }
  return '';
}

function rememberPushRoute(data) {
  try {
    sessionStorage.setItem(PENDING_PUSH_ROUTE_KEY, JSON.stringify(data || {}));
  } catch (_) {
    // Storage failures should not block normal app usage.
  }
}

function takePendingPushRoute() {
  const raw = sessionStorage.getItem(PENDING_PUSH_ROUTE_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_PUSH_ROUTE_KEY);
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function getAgencyJoinCodeFromUrl() {
  const pathMatch = String(window.location.pathname || '').match(/\/join\/([^/?#]+)/i);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]).trim();
  const params = new URLSearchParams(window.location.search || '');
  return String(params.get('ref') || params.get('joinCode') || params.get('agencyJoinCode') || '').trim();
}

function getStoredAgencyInvite() {
  const raw = sessionStorage.getItem(AGENCY_INVITE_SESSION_KEY);
  if (!raw) return null;
  try {
    const invite = JSON.parse(raw);
    const agencyId = String(invite?.agencyId || '').trim();
    const agencyName = String(invite?.agencyName || '').trim();
    const joinCode = String(invite?.joinCode || '').trim();
    if (!agencyId || !agencyName || !joinCode) return null;
    return { agencyId, agencyName, joinCode };
  } catch (err) {
    return null;
  }
}

function saveAgencyInvite(invite) {
  const agencyId = String(invite?.agencyId || '').trim();
  const agencyName = String(invite?.agencyName || '').trim();
  const joinCode = String(invite?.joinCode || '').trim();
  if (!agencyId || !agencyName || !joinCode) {
    clearAgencyInviteSession();
    return null;
  }
  const safeInvite = { agencyId, agencyName, joinCode };
  sessionStorage.setItem(AGENCY_INVITE_SESSION_KEY, JSON.stringify(safeInvite));
  return safeInvite;
}

function clearAgencyInviteSession() {
  sessionStorage.removeItem(AGENCY_INVITE_SESSION_KEY);
  renderAgencyInviteNotice();
}

function renderAgencyInviteNotice() {
  $$('.agency-invite-notice').forEach(node => node.remove());
  const invite = getStoredAgencyInvite();
  if (!invite || !/^reg-step\d$/.test(state.currentScreen || '')) return;
  const screen = $(`#screen-${state.currentScreen}`);
  const content = $('.auth-content', screen);
  if (!content) return;
  const notice = document.createElement('div');
  notice.className = 'agency-invite-notice';
  const title = document.createElement('div');
  title.className = 'agency-invite-title';
  title.textContent = '대리점 가입 링크';
  const body = document.createElement('div');
  body.className = 'agency-invite-body';
  body.textContent = `${invite.agencyName} 가입 링크로 접속했습니다.`;
  notice.append(title, body);
  const headline = $('.auth-headline', content);
  if (headline?.parentNode === content) {
    headline.insertAdjacentElement('afterend', notice);
  } else {
    content.prepend(notice);
  }
}

async function fetchAgencyInviteByJoinCode(joinCode) {
  const response = await fetch(apiUrl(`/api/public/agency-invites/${encodeURIComponent(joinCode)}`), {
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false || !payload.data) {
    throw new Error(getFriendlyErrorMessage(payload, '유효하지 않은 가입 링크입니다.'));
  }
  return payload.data;
}

async function handleAgencyInviteStartup() {
  const joinCode = getAgencyJoinCodeFromUrl();
  if (!joinCode) {
    renderAgencyInviteNotice();
    return;
  }
  try {
    const invite = saveAgencyInvite(await fetchAgencyInviteByJoinCode(joinCode));
    if (!invite) throw new Error('유효하지 않은 가입 링크입니다.');
    const rawDraft = sessionStorage.getItem(REGISTER_DRAFT_KEY);
    let draftInviteJoinCode = '';
    if (rawDraft) {
      try {
        draftInviteJoinCode = String(JSON.parse(rawDraft)?.agencyInvite?.joinCode || '').trim();
      } catch (err) {
        draftInviteJoinCode = '';
      }
    }
    if (rawDraft && draftInviteJoinCode !== invite.joinCode) {
      sessionStorage.removeItem(REGISTER_DRAFT_KEY);
      if (typeof clearBizLicenseSelection === 'function') clearBizLicenseSelection();
    }
    if (isAuthenticated()) {
      clearAgencyInviteSession();
      void showAppAlert('이미 로그인된 계정에는 가입 링크를 적용할 수 없습니다. 로그아웃 후 다시 접속해 주세요.', '가입 링크 안내');
      return;
    }
    clearTimeout(state.splashTimer);
    pendingLocationGateTarget = 'reg-step1';
    const targetScreen = hasCertifiedStartupLocation() ? 'reg-step1' : 'location-setup';
    navigate(targetScreen, 'replace');
    if (targetScreen === 'location-setup') {
      renderLocationSetupState('회원가입 전 현재 위치 확인이 필요합니다.');
    }
    renderAgencyInviteNotice();
    showToast(`${invite.agencyName} 가입 링크로 접속했습니다.`);
  } catch (err) {
    clearAgencyInviteSession();
    sessionStorage.removeItem(REGISTER_DRAFT_KEY);
    const message = getFriendlyErrorMessage(err, '유효하지 않은 가입 링크입니다.');
    showToast(message);
    void showAppAlert(`${message}\n가입 링크를 다시 확인해 주세요.`, '가입 링크 확인');
  }
}

function getPushRouteFromUrl() {
  const params = new URLSearchParams(window.location.search || '');
  const route = {};
  ['targetScreen', 'pushTarget', 'screen', 'talkPostId', 'postId', 'talkChatId', 'chatId'].forEach(key => {
    const value = params.get(key);
    if (value) route[key === 'pushTarget' ? 'targetScreen' : key] = value;
  });
  if (!Object.keys(route).length) return null;
  const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
  window.history.replaceState(window.history.state || { screen: state.currentScreen }, '', cleanUrl);
  return route;
}

async function handlePushNavigation(rawData = {}) {
  const payload = getPushPayload(rawData);
  const targetScreen = getPushTargetScreen(payload);
  console.info('[push] navigation request', { payload, targetScreen, authenticated: isAuthenticated() });
  if (!targetScreen) return false;

  if (!isAuthenticated()) {
    rememberPushRoute(payload);
    navigate('login');
    return true;
  }

  const talkChatId = payload.talkChatId || payload.chatId;
  const talkPostId = payload.talkPostId || payload.postId;
  if (targetScreen === 'talk-chat' && talkChatId) {
    selectedTalkChatId = String(talkChatId);
    navigate('talk-chat');
    console.info('[push] navigated talk-chat', talkChatId);
    return true;
  }
  if ((targetScreen === 'talk-detail' || talkPostId) && talkPostId) {
    await fetchTalkPosts(30);
    openTalkDetail(talkPostId);
    console.info('[push] navigated talk-detail', talkPostId);
    return true;
  }
  if (targetScreen === 'talk' || targetScreen === 'talk-board') {
    await fetchTalkPosts(30);
    navigate('talk');
    console.info('[push] navigated talk');
    return true;
  }
  if (targetScreen === 'talk-chats') {
    navigate('talk-chats');
    console.info('[push] navigated talk-chats');
    return true;
  }

  if ($(`#screen-${targetScreen}`)) {
    navigate(targetScreen);
    console.info('[push] navigated screen', targetScreen);
    return true;
  }
  console.warn('[push] target screen not found', targetScreen, payload);
  return false;
}

function handlePendingPushRoute() {
  const pending = takePendingPushRoute() || getPushRouteFromUrl();
  if (!pending) return false;
  void handlePushNavigation(pending);
  return true;
}

window.EATSPAY_HANDLE_PUSH_ROUTE = (data) => {
  console.info('[push] native route received', data);
  void handlePushNavigation(data || {});
};

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

async function registerWebPushSubscription() {
  if (!isAuthenticated()) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.isSecureContext) return;

  const keyResponse = await fetch(apiUrl('/api/web-push/public-key')).catch(() => null);
  if (!keyResponse?.ok) return;
  const keyJson = await keyResponse.json().catch(() => null);
  const publicKey = keyJson?.data?.publicKey || '';
  if (!keyJson?.data?.configured || !publicKey) return;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  await fetch(apiUrl('/api/web-push-subscription'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`
    },
    body: JSON.stringify({
      subscription,
      platform: 'web'
    })
  }).catch(() => {});
}

async function registerDevicePushToken() {
  if (!isAuthenticated()) return;
  const pushNotifications = getPushNotificationsPlugin();
  if (!pushNotifications) {
    registerWebPushSubscription().catch(err => console.warn('Web push registration failed:', err));
    return;
  }
  if (pushRegistrationStarted) return;
  pushRegistrationStarted = true;

  try {
    const permission = await pushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return;

    await pushNotifications.addListener('registration', async (token) => {
      const value = token?.value || '';
      if (!value) return;
      await fetch(apiUrl('/api/push-token'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`
        },
        body: JSON.stringify({
          token: value,
          platform: getDevicePlatform()
        })
      }).catch(() => {});
    });

    await pushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.info('[push] received', notification);
      const payload = getPushPayload(notification || {});
      const title = notification?.title || payload.title || '알림';
      const body = notification?.body || payload.body || '새 알림이 있습니다.';
      const icon = payload.targetScreen === 'talk-chat' || payload.talkChatId || payload.chatId ? '톡' : 'EP';
      if (icon === '톡') playTalkMessageSound('receive');
      showInAppNotification({ title, body, data: payload, icon });
    });

    await pushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.info('[push] action performed', action);
      const payload = getPushPayload(action?.notification || action || {});
      void handlePushNavigation(payload);
    });

    await pushNotifications.register();
  } catch (err) {
    pushRegistrationStarted = false;
    console.warn('Push registration failed:', err);
  }
}

function todayYMD() {
  const now = new Date();
  const koreaTime = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
  const year = koreaTime.getFullYear();
  const month = String(koreaTime.getMonth() + 1).padStart(2, '0');
  const day = String(koreaTime.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateToYMD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getKoreaDate() {
  const now = new Date();
  return new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
}

function setPaymentPeriodChipActive(mode) {
  $$('.payment-period-chip').forEach(btn => {
    const key = btn.dataset.days ? `${btn.dataset.days}d` : `${btn.dataset.months}m`;
    const active = key === mode;
    btn.classList.toggle('active', active);
    btn.style.background = active ? 'var(--green-primary)' : '#fff';
    btn.style.borderColor = active ? 'var(--green-primary)' : 'var(--card-border)';
    btn.style.color = active ? '#fff' : 'var(--green-dark)';
  });
}

function applyPaymentHistoryQuickRange({ days = 7, months = 0 } = {}) {
  const startInput = $('#filter-start-date');
  const endInput = $('#filter-end-date');
  if (!startInput || !endInput) return;
  const end = getKoreaDate();
  const start = new Date(end);
  if (months) {
    start.setMonth(start.getMonth() - Number(months));
  } else {
    start.setDate(start.getDate() - Math.max(Number(days || 7) - 1, 0));
  }
  startInput.value = dateToYMD(start);
  endInput.value = dateToYMD(end);
  setPaymentPeriodChipActive(months ? `${months}m` : `${days}d`);
}

function syncPaymentHistoryDateRange(forceToday = false) {
  const startInput = $('#filter-start-date');
  const endInput = $('#filter-end-date');
  if (!startInput || !endInput) return;

  if (forceToday || !startInput.value || startInput.value === '2026-05-01' || !endInput.value || endInput.value === '2026-05-30') {
    applyPaymentHistoryQuickRange({ days: 7 });
    return;
  }
  const today = todayYMD();
  if (forceToday || !startInput.value || startInput.value === '2026-05-01') {
    startInput.value = today;
  }
  if (forceToday || !endInput.value || endInput.value === '2026-05-30') {
    endInput.value = today;
  }
}

function formatWon(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

function formatCurrencyInputValue(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? Number(digits).toLocaleString('ko-KR') : '';
}

function bindCurrencyInput(selector) {
  const input = $(selector);
  if (!input) return;
  input.value = formatCurrencyInputValue(input.value);
  input.addEventListener('input', () => {
    input.value = formatCurrencyInputValue(input.value);
  });
}

function getPaymentReceiptAmount(item) {
  return Number(item?.totalAmount || item?.payAmount || item?.amount || 0);
}

function parseReceiptCardInfo(item = {}) {
  const rawDetails = item.cardDetails || item.card_details || item.card || item.method || '';
  const detailText = typeof rawDetails === 'string' ? rawDetails : JSON.stringify(rawDetails || {});
  const companyCandidates = [
    item.cardCompany,
    item.card_company,
    item.cardName,
    item.card_name,
    rawDetails?.issuer,
    rawDetails?.cardCompany,
    rawDetails?.cardName
  ].filter(Boolean).map(String);
  const inferredCompany = companyCandidates[0]
    || (detailText.match(/([가-힣A-Za-z0-9]+카드)/)?.[1])
    || (detailText.includes('CARD') ? '카드' : '카드사 확인');
  const maskedCandidate = [
    item.maskedNumber,
    item.masked_number,
    item.cardNumber,
    item.card_number,
    rawDetails?.maskedNumber,
    rawDetails?.cardNumber
  ].filter(Boolean).map(String)[0];
  const last4 = String(maskedCandidate || detailText).match(/(\d{4})(?!.*\d)/)?.[1] || '';
  const maskedNumber = last4 ? `****-${last4}` : '****-****';
  return {
    company: inferredCompany,
    maskedNumber,
    installment: Number(item.installment || item.quota || 0) > 0
      ? `${Number(item.installment || item.quota)}개월`
      : (item.installmentText || '일시불')
  };
}

function formatReceiptDate(value) {
  const text = String(value || '').trim();
  if (!text) return '-';
  return text.replace('T', ' ').slice(0, 16);
}

function showPaymentReceipt(item) {
  if (!item) return;
  const total = getPaymentReceiptAmount(item);
  const supplyAmount = Math.round(Number(total || 0) / 1.1);
  const vatAmount = Math.max(0, Number(total || 0) - supplyAmount);
  const receiptNo = item.transactionId || item.approvalNo || item.id || '-';
  const dateStr = item.paymentDate || item.createdAt || item.date || '';
  const user = getSessionUser();
  const franchiseName = item.franchiseName || item.franchise || user?.franchiseName || user?.storeName || user?.name || '가맹점';
  const cardInfo = parseReceiptCardInfo(item);
  const receiptContent = `${franchiseName}_배달대행비`;
  const old = $('#payment-receipt-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'payment-receipt-modal';
  modal.style.cssText = 'position:absolute; inset:0; z-index:60; background:rgba(0,0,0,.58); display:flex; align-items:center; justify-content:center; padding:18px;';
  modal.innerHTML = `
    <div style="width:100%; max-width:340px; max-height:88%; overflow:auto; background:#fff; border-radius:var(--radius); box-shadow:0 14px 34px rgba(0,0,0,.24); font-family:inherit; border:1px solid #bfe6c2;">
      <div style="position:relative; background:#339b31; color:#fff; text-align:center; padding:20px 36px 18px;">
        <button type="button" id="payment-receipt-close" aria-label="닫기" style="position:absolute; right:10px; top:8px; border:none; background:transparent; width:28px; height:28px; font-size:22px; font-weight:300; line-height:1; color:#fff; cursor:pointer;">×</button>
        <div style="font-size:18px; font-weight:900; letter-spacing:-.5px;">카드 매출전표</div>
        <div style="font-size:12px; font-weight:900; margin-top:8px;">eatsPay 결제전표</div>
      </div>
      <div style="padding:18px;">
        <div style="font-size:13px; line-height:1.45;">
          ${[
            ['승인번호', receiptNo],
            ['거래일시', formatReceiptDate(dateStr)],
            ['가맹점명', franchiseName],
            ['카드사', cardInfo.company],
            ['카드번호', cardInfo.maskedNumber],
            ['할부', cardInfo.installment],
            ['내용', receiptContent]
          ].map(([label, value]) => `
            <div style="display:grid; grid-template-columns:92px 1fr; gap:10px; align-items:center; min-height:34px; border-bottom:1px solid #e7efe7;">
              <div style="color:#7a8793; font-weight:900;">${escapeHtml(label)}</div>
              <div style="text-align:right; color:#111; font-weight:900; word-break:break-all;">${escapeHtml(value)}</div>
            </div>
          `).join('')}
        </div>
        <div style="height:1px; background:#bfe6c2; margin:16px 0 12px;"></div>
        <div style="display:grid; grid-template-columns:92px 1fr; gap:10px; align-items:center; min-height:34px; font-size:13px;">
          <div style="color:#7a8793; font-weight:900;">공급가액</div><div style="text-align:right; font-weight:900;">${formatWon(supplyAmount)}</div>
          <div style="color:#7a8793; font-weight:900;">부가세</div><div style="text-align:right; font-weight:900;">${formatWon(vatAmount)}</div>
        </div>
        <div style="display:grid; grid-template-columns:92px 1fr; gap:10px; align-items:center; background:#eef9ee; border-radius:4px; margin-top:10px; padding:11px 10px;">
          <div style="font-size:13px; font-weight:900; color:#111;">합계</div>
          <div style="text-align:right; font-size:18px; font-weight:900; color:#20a83a;">${formatWon(total)}</div>
        </div>
      </div>
      <div style="border-top:1px solid #e7efe7; color:#9aa3ad; font-size:10px; font-weight:900; text-align:center; padding:12px 8px;">운영시간 | 월 ~ 목 : 10:00 - 18:00 | 금 : 10:00 - 15:00</div>
    </div>
  `;
  const shell = $('#app-shell') || document.body;
  shell.appendChild(modal);
  $('#payment-receipt-close', modal)?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', event => {
    if (event.target === modal) modal.remove();
  });
}

function normalizeTalkImage(url) {
  const value = String(url || '').trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/uploads/')) return apiUrl(value);
  return '';
}

function getTalkImages(post) {
  const images = Array.isArray(post?.imageUrls) ? post.imageUrls : [];
  const normalized = images.map(normalizeTalkImage).filter(Boolean);
  const fallback = normalizeTalkImage(post?.imageUrl);
  if (!normalized.length && fallback) normalized.push(fallback);
  return normalized.slice(0, 10);
}

function getTalkTradeStatus(post) {
  const raw = String(post?.tradeStatus || post?.trade_status || 'SALE').toUpperCase();
  if (raw === 'ACTIVE') return 'SALE';
  if (raw === 'COMPLETED' || raw === 'DONE') return 'SOLD';
  return raw;
}

function getTalkTradeStatusLabel(status) {
  const normalized = String(status || 'SALE').toUpperCase();
  if (normalized === 'SOLD') return '판매완료';
  if (normalized === 'RESERVED') return '예약중';
  return '판매중';
}

function getTalkTradeStatusStyle(status) {
  const normalized = String(status || 'SALE').toUpperCase();
  if (normalized === 'SOLD') {
    return { bg: '#eef0ee', color: '#687268', border: '#d8ded8' };
  }
  if (normalized === 'RESERVED') {
    return { bg: '#fff7dc', color: '#a56a00', border: '#f4df9c' };
  }
  return { bg: '#eef8e8', color: 'var(--green-dark)', border: '#cfe8c8' };
}

function renderTalkTradeChip(status, extraStyle = '') {
  const style = getTalkTradeStatusStyle(status);
  return `<span style="display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:999px;border:1px solid ${style.border};background:${style.bg};color:${style.color};font-size:11px;font-weight:900;white-space:nowrap;${extraStyle}">${getTalkTradeStatusLabel(status)}</span>`;
}

function renderTalkStatusFilter() {
  $$('.talk-status-filter-chip').forEach(btn => {
    const active = btn.getAttribute('data-status') === activeTalkStatusFilter;
    btn.classList.toggle('active', active);
  });
}

function isMyTalkPost(post, user = getSessionUser()) {
  if (!post || !user) return false;
  if (post.userId && user.id && String(post.userId) === String(user.id)) return true;
  return Boolean(post.franchiseId && user.franchiseId && String(post.franchiseId) === String(user.franchiseId));
}

function getTalkDisplayArea(address) {
  const cleaned = String(address || '')
    .replace(/\(\d{5}\)/g, '')
    .replace(/\b\d{5}\b/g, '')
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(' ') || '위치 정보 없음';
}

function formatTalkTimeLabel(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return '방금 전';
  if (diffMs < hour) return `${Math.max(Math.floor(diffMs / minute), 1)}분 전`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}시간 전`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}일 전`;
  return String(value || '').replace('T', ' ').slice(0, 10);
}

function getTalkDistanceLabel(post) {
  try {
    const serverDistanceKm = Number(post?.distanceKm);
    if (Number.isFinite(serverDistanceKm)) {
      return serverDistanceKm < 1
        ? `${Math.round(serverDistanceKm * 1000)}m`
        : `${serverDistanceKm.toLocaleString('ko-KR')}km`;
    }
    const lat = Number(post?.sellerLatitude);
    const lng = Number(post?.sellerLongitude);
    const saved = talkViewerPosition || getCertifiedLocationPosition();
    const originLat = Number(saved?.coords?.latitude);
    const originLng = Number(saved?.coords?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(originLat) || !Number.isFinite(originLng)) {
      return '';
    }
    const km = calculateDistanceKm(originLat, originLng, lat, lng);
    return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toLocaleString('ko-KR')}km`;
  } catch (err) {
    return '';
  }
}

function requestTalkViewerLocation() {
  const saved = getCertifiedLocationPosition();
  if (saved?.coords) {
    talkViewerPosition = saved;
  }
  if (talkLocationRequestStarted || !navigator.geolocation) return;
  talkLocationRequestStarted = true;
  void certifyCurrentLocation({ silent: true }).then(position => {
    talkLocationRequestStarted = false;
    if (position?.coords) {
      talkViewerPosition = position;
      if (state.currentScreen === 'talk') void fetchTalkPosts(30);
      if (state.currentScreen === 'talk-detail') {
        void fetchTalkPosts(30);
        renderTalkDetail();
      }
    }
  });
}

function renderTalkMetaLine(post) {
  const parts = [
    getTalkDisplayArea(post?.sellerAddress),
    formatTalkTimeLabel(post?.createdAt)
  ].filter(Boolean);
  return parts.join(' · ');
}

function renderTalkDistanceLine(post) {
  const distance = getTalkDistanceLabel(post);
  return distance ? `거리 ${distance}` : '';
}

async function renderTalkSellerMap(post) {
  const container = $('#talk-seller-map');
  if (!container) return;
  const lat = Number(post?.sellerLatitude);
  const lng = Number(post?.sellerLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    container.innerHTML = `
      <div style="height:100%;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--text-muted);font-size:12px;font-weight:900;line-height:1.45;padding:14px;">
        판매자 주소 좌표를 확인하지 못했습니다.
      </div>
    `;
    return;
  }
  await renderFriendlyInteractiveMap(container, { name: post?.franchiseName || '거래 위치' }, lat, lng);
}

function renderTalkStats(post) {
  return `
    <div class="talk-stats">
      <span>조회 ${Number(post.viewCount || 0).toLocaleString('ko-KR')}</span>
      <span>좋아요 ${Number(post.likeCount || 0).toLocaleString('ko-KR')}</span>
      <span>채팅 ${Number(post.chatCount || 0).toLocaleString('ko-KR')}</span>
    </div>
  `;
}

function getTalkCafeBadge(post) {
  const status = getTalkTradeStatus(post);
  if (post?.isNotice || post?.category === 'NOTICE') return '필독';
  if (status === 'SOLD') return '완료';
  if (status === 'RESERVED') return '예약';
  return '필독';
}

function getTalkCafeScore(post) {
  return Number(post.commentCount || 0) * 8
    + Number(post.likeCount || 0) * 5
    + Number(post.chatCount || 0) * 4
    + Number(post.viewCount || 0);
}

function renderTalkCafeMeta(post) {
  const author = post?.franchiseName || '이츠페이 가맹점';
  const time = formatTalkTimeLabel(post?.createdAt);
  const views = Number(post?.viewCount || 0).toLocaleString('ko-KR');
  return `${author}${time ? ` · ${time}` : ''} · 조회 ${views}`;
}

function formatTalkDetailDateTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day}. ${hour}:${minute}`;
}

function renderTalkHome(posts = talkPostCache) {
  const list = $('#home-talk-list');
  if (!list) return;
  const sourceItems = Array.isArray(posts) ? posts : [];
  const totalPages = Math.max(Math.ceil(sourceItems.length / 5), 1);
  if (homeTalkPage > totalPages) homeTalkPage = totalPages;
  const items = sourceItems.slice((homeTalkPage - 1) * 5, homeTalkPage * 5);
  if (!items.length) {
    list.innerHTML = '<div class="talk-empty">등록된 Talk 글이 없습니다.</div>';
    return;
  }
  list.innerHTML = `
    <div class="home-talk-board home-talk-cafe">
      ${items.map(post => {
        const image = getTalkImages(post)[0] || '';
        return `
          <button type="button" class="home-talk-row home-talk-row-card" data-talk-id="${escapeHtml(post.id)}">
            <span class="home-talk-main">
              <strong>${escapeHtml(post.title || '')}</strong>
              <em>${escapeHtml(renderTalkCafeMeta(post))}</em>
            </span>
            <span class="home-talk-thumb${image ? ' has-image' : ''}">
              ${image ? `<img src="${escapeHtml(image)}" alt="">` : ''}
            </span>
            <span class="home-talk-counts">
              <strong>${Number(post.commentCount || 0).toLocaleString('ko-KR')}</strong>
              <em>댓글</em>
            </span>
          </button>
        `;
      }).join('')}
    </div>
    ${totalPages > 1 ? `
      <div class="home-talk-pagination">
        ${Array.from({ length: totalPages }, (_, index) => {
          const page = index + 1;
          return `<button type="button" class="home-talk-page${page === homeTalkPage ? ' active' : ''}" data-page="${page}">${page}</button>`;
        }).join('')}
      </div>
    ` : ''}
  `;
}

function renderTalkPagination(totalItems) {
  const pagination = $('#talk-pagination');
  if (!pagination) return;
  const totalPages = Math.max(Math.ceil(Number(totalItems || 0) / TALK_BOARD_PAGE_SIZE), 1);
  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }
  if (talkBoardPage > totalPages) talkBoardPage = totalPages;
  pagination.innerHTML = Array.from({ length: totalPages }, (_, index) => {
    const page = index + 1;
    const active = page === talkBoardPage;
    return `
      <button type="button" class="talk-page-btn" data-page="${page}" style="
        width:34px;height:34px;border-radius:10px;border:1.5px solid ${active ? 'var(--green-primary)' : 'var(--card-border)'};
        background:${active ? 'var(--green-primary)' : '#fff'};color:${active ? '#fff' : 'var(--green-dark)'};
        font-size:13px;font-weight:900;box-shadow:${active ? '0 8px 16px rgba(47,143,47,.14)' : 'none'};">
        ${page}
      </button>
    `;
  }).join('');
}

function renderTalkBoard(posts = talkPostCache) {
  const list = $('#talk-board-list');
  if (!list) return;
  renderTalkStatusFilter();
  const sourceItems = Array.isArray(posts) ? posts : [];
  const normalizedFilter = String(activeTalkStatusFilter || 'ALL').toUpperCase();
  const user = getSessionUser();
  const items = normalizedFilter === 'ALL'
    ? sourceItems
    : normalizedFilter === 'POPULAR'
      ? [...sourceItems].sort((a, b) => getTalkCafeScore(b) - getTalkCafeScore(a))
      : normalizedFilter === 'NOTICE'
        ? sourceItems.filter(post => post.isNotice || post.category === 'NOTICE')
    : normalizedFilter === 'LIKED'
      ? sourceItems.filter(post => post.likedByMe === true)
      : normalizedFilter === 'MINE'
        ? sourceItems.filter(post => isMyTalkPost(post, user))
        : sourceItems.filter(post => getTalkTradeStatus(post) === normalizedFilter);
  if (!items.length) {
    list.innerHTML = '<div class="talk-board-empty">조건에 맞는 Talk 글이 없습니다.</div>';
    renderTalkPagination(0);
    return;
  }
  const totalPages = Math.max(Math.ceil(items.length / TALK_BOARD_PAGE_SIZE), 1);
  if (talkBoardPage > totalPages) talkBoardPage = totalPages;
  const pagedItems = items.slice((talkBoardPage - 1) * TALK_BOARD_PAGE_SIZE, talkBoardPage * TALK_BOARD_PAGE_SIZE);
  list.innerHTML = pagedItems.map(post => {
    const image = getTalkImages(post)[0] || '';
    const tradeStatus = getTalkTradeStatus(post);
    const views = Number(post.viewCount || 0).toLocaleString('ko-KR');
    const likes = Number(post.likeCount || 0).toLocaleString('ko-KR');
    return `
      <article class="talk-board-card talk-cafe-post${tradeStatus === 'SOLD' ? ' is-sold' : ''}" data-talk-id="${escapeHtml(post.id)}">
        <div class="talk-cafe-main">
          <div class="talk-cafe-title-row">
            <span class="talk-cafe-badge">${escapeHtml(getTalkCafeBadge(post))}</span>
            <strong>${escapeHtml(post.title || '')}</strong>
          </div>
          <div class="talk-cafe-preview">${escapeHtml(post.body || '')}</div>
          <div class="talk-cafe-meta">${escapeHtml(renderTalkCafeMeta(post))}</div>
          <div class="talk-cafe-stats">
            <span class="talk-cafe-stat">조회 ${escapeHtml(views)}</span>
            <span class="talk-cafe-stat">관심 ${escapeHtml(likes)}</span>
          </div>
        </div>
        ${image ? `<div class="talk-cafe-thumb"><img src="${escapeHtml(image)}" alt=""></div>` : ''}
        <div class="talk-cafe-comment-box">
          <strong>${Number(post.commentCount || 0).toLocaleString('ko-KR')}</strong>
          <span>댓글</span>
        </div>
      </article>
    `;
  }).join('');
  renderTalkPagination(items.length);
}

function renderTalkImagePreview() {
  const preview = $('#talk-image-preview');
  if (!preview) return;
  if (!talkImageFiles.length) {
    preview.innerHTML = '<div style="font-size:11px;color:var(--text-muted);font-weight:700;">선택된 이미지가 없습니다.</div>';
    return;
  }
  preview.innerHTML = talkImageFiles.map((file, index) => `
    <div style="position:relative;flex:0 0 auto;width:72px;height:72px;border-radius:var(--radius);overflow:hidden;border:1px solid var(--border-light);background:#f5f5f5;">
      <img src="${escapeHtml(URL.createObjectURL(file))}" alt="" style="width:100%;height:100%;object-fit:cover;">
      <button type="button" class="talk-image-remove" data-index="${index}" style="position:absolute;top:4px;right:4px;width:20px;height:20px;border:none;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:12px;font-weight:900;">×</button>
    </div>
  `).join('');
}

function openTalkDetail(id) {
  selectedTalkPostId = String(id || '');
  renderTalkDetail();
  navigate('talk-detail');
  void incrementTalkView(selectedTalkPostId);
  void refreshTalkLikeState(selectedTalkPostId);
  void fetchTalkComments(selectedTalkPostId);
}

function getTalkComments(postId = selectedTalkPostId) {
  return talkCommentCache.get(String(postId || '')) || [];
}

function setTalkReplyTarget(commentId) {
  const comment = getTalkComments(selectedTalkPostId).find(item => String(item.id) === String(commentId));
  if (!comment) return;
  talkReplyTargetComment = {
    id: comment.id,
    userName: comment.userName || '이츠페이 가맹점'
  };
  renderTalkDetail();
  setTimeout(() => $('#talk-comment-input')?.focus(), 60);
}

function clearTalkReplyTarget() {
  talkReplyTargetComment = null;
  renderTalkDetail();
  setTimeout(() => $('#talk-comment-input')?.focus(), 60);
}

function renderTalkCommentsSection(post) {
  const comments = getTalkComments(post.id);
  const user = getSessionUser();
  const currentUserId = getSessionUserId(user);
  const commentById = new Map(comments.map(comment => [String(comment.id), comment]));
  return `
    <section class="talk-comments-card">
      <div class="talk-comments-head">
        <strong>댓글 ${Number(post.commentCount || comments.length || 0).toLocaleString('ko-KR')}</strong>
        <span>›</span>
      </div>
      <div id="talk-comments-list" class="talk-comments-list">
        ${comments.length ? comments.map(comment => {
          const isReply = Boolean(comment.parentCommentId);
          const parent = isReply ? commentById.get(String(comment.parentCommentId)) : null;
          const isMine = currentUserId && String(comment.userId) === String(currentUserId);
          return `
          <div class="talk-comment-item${isReply ? ' is-reply' : ''}" data-comment-id="${escapeHtml(comment.id)}">
            <div class="talk-comment-avatar">${escapeHtml(String(comment.userName || 'E').slice(0, 1))}</div>
            <div class="talk-comment-main">
              <div class="talk-comment-author-row">
                <strong>${escapeHtml(comment.userName || '이츠페이 가맹점')}</strong>
                ${String(comment.userId) === String(post.userId) ? '<span>작성자</span>' : ''}
              </div>
              ${parent ? `<div class="talk-comment-reply-target">@${escapeHtml(parent.userName || '이츠페이 가맹점')}</div>` : ''}
              <div class="talk-comment-text">${escapeHtml(comment.comment || '')}</div>
              <div class="talk-comment-meta">
                <span>${escapeHtml(formatTalkDetailDateTime(comment.createdAt) || formatTalkTimeLabel(comment.createdAt))}</span>
                <button type="button" class="talk-comment-reply-btn" data-comment-id="${escapeHtml(comment.id)}" data-comment-name="${escapeHtml(comment.userName || '이츠페이 가맹점')}">답글쓰기</button>
                ${isMine ? `<button type="button" class="talk-comment-delete-btn" data-comment-id="${escapeHtml(comment.id)}">삭제</button>` : ''}
              </div>
            </div>
            <button type="button" class="talk-comment-heart" aria-label="댓글 관심">♡</button>
          </div>
        `;
        }).join('') : '<div class="talk-comment-empty">아직 댓글이 없습니다.</div>'}
      </div>
      <div class="talk-comment-form">
        <div id="talk-reply-target" class="talk-reply-target" style="${talkReplyTargetComment ? '' : 'display:none;'}">
          <span>${talkReplyTargetComment ? `${escapeHtml(talkReplyTargetComment.userName || '이츠페이 가맹점')}에게 답글` : ''}</span>
          <button type="button" id="btn-talk-reply-cancel">취소</button>
        </div>
        <span class="talk-comment-form-avatar">👤</span>
        <textarea id="talk-comment-input" maxlength="500" placeholder="댓글을 입력해주세요."></textarea>
        <button id="btn-talk-comment-submit" type="button">등록</button>
      </div>
    </section>
  `;
}

function renderTalkDetail() {
  const wrap = $('#talk-detail-body');
  if (!wrap) return;
  const post = talkPostCache.find(item => String(item.id) === String(selectedTalkPostId));
  if (!post) {
    wrap.innerHTML = '<div style="padding:32px 0;color:var(--text-muted);font-weight:800;text-align:center;">게시글을 찾을 수 없습니다.</div>';
    return;
  }
  const images = getTalkImages(post);
  const user = getSessionUser();
  const isOwnPost = isMyTalkPost(post, user);
  const tradeStatus = getTalkTradeStatus(post);
  const isSold = tradeStatus === 'SOLD';
  const comments = getTalkComments(post.id);
  const author = post.franchiseName || '이츠페이 가맹점';
  const detailDate = formatTalkDetailDateTime(post.createdAt);
  const viewCount = Number(post.viewCount || 0).toLocaleString('ko-KR');
  const likeCount = Number(post.likeCount || 0).toLocaleString('ko-KR');
  const commentCount = Number(post.commentCount || comments.length || 0).toLocaleString('ko-KR');
  wrap.innerHTML = `
    <article class="talk-detail-cafe">
      <h1 class="talk-detail-title">${escapeHtml(post.title || '')}</h1>
      <div class="talk-detail-author-row">
        <div class="talk-detail-avatar">${escapeHtml(String(author).slice(0, 1) || 'E')}</div>
        <div class="talk-detail-author-main">
          <strong>${escapeHtml(author)}</strong>
          <span>${escapeHtml(detailDate)} · 조회 ${escapeHtml(viewCount)}</span>
        </div>
        <button id="btn-talk-start-chat" type="button" class="talk-detail-chat-chip">1:1톡</button>
      </div>
      <div class="talk-detail-body-text">${escapeHtml(post.body || '')}</div>
      ${images.length ? `
        <div class="talk-detail-images">
          ${images.map(src => `<img src="${escapeHtml(src)}" alt="">`).join('')}
        </div>
      ` : ''}
      <div class="talk-detail-inline-stats">
        <span>관심 ${escapeHtml(likeCount)}</span>
        <span>댓글 ${escapeHtml(commentCount)}</span>
        <span>조회 ${escapeHtml(viewCount)}</span>
      </div>
    </article>
    ${renderTalkCommentsSection({ ...post, commentCount: Number(post.commentCount || comments.length || 0) })}
  `;
  const chatButton = $('#btn-talk-start-chat');
  const likeBtn = $('#btn-talk-like');
  const likeCountEl = $('#talk-detail-like-count');
  const commentCountEl = $('#talk-detail-comment-count');
  if (likeBtn) {
    likeBtn.classList.toggle('liked', post.likedByMe === true);
    likeBtn.firstChild && (likeBtn.firstChild.textContent = post.likedByMe ? '♥ ' : '♡ ');
  }
  if (likeCountEl) likeCountEl.textContent = likeCount;
  if (commentCountEl) commentCountEl.textContent = commentCount;
  if (chatButton) {
    if (isOwnPost) {
      chatButton.disabled = false;
      chatButton.classList.remove('is-disabled');
      chatButton.textContent = '채팅보기';
      chatButton.onclick = () => openTalkChatsForPost(post.id);
    } else {
      chatButton.disabled = Boolean(isSold);
      chatButton.classList.toggle('is-disabled', isSold);
      chatButton.textContent = isSold ? '완료' : '1:1톡';
      chatButton.onclick = isSold ? null : () => startTalkChat(post.id);
    }
  }
}

async function fetchTalkComments(postId) {
  if (!postId) return [];
  try {
    const response = await fetch(apiUrl(`/api/talk/posts/${encodeURIComponent(postId)}/comments?_=${Date.now()}`), {
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '댓글을 불러오지 못했습니다.'));
    const comments = Array.isArray(payload?.data) ? payload.data : [];
    talkCommentCache.set(String(postId), comments);
    if (state.currentScreen === 'talk-detail' && String(selectedTalkPostId) === String(postId)) renderTalkDetail();
    return comments;
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function submitTalkComment() {
  if (!selectedTalkPostId) return;
  if (!isApprovedAccount() || isAgencyAccount()) {
    showToast('승인된 가맹점 계정만 댓글을 등록할 수 있습니다.');
    return;
  }
  const input = $('#talk-comment-input');
  const comment = String(input?.value || '').trim();
  if (!comment) {
    showToast('댓글을 입력해주세요.');
    input?.focus();
    return;
  }
  const btn = $('#btn-talk-comment-submit');
  const originalText = btn?.textContent || '등록';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '등록 중';
  }
  try {
    const parentCommentId = talkReplyTargetComment?.id || null;
    const response = await fetch(apiUrl(`/api/talk/posts/${encodeURIComponent(selectedTalkPostId)}/comments`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({ comment, parentCommentId })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '댓글 등록에 실패했습니다.'));
    if (input) input.value = '';
    talkReplyTargetComment = null;
    const nextComments = [...getTalkComments(selectedTalkPostId), payload.data].filter(Boolean);
    talkCommentCache.set(String(selectedTalkPostId), nextComments);
    talkPostCache = talkPostCache.map(post => String(post.id) === String(selectedTalkPostId)
      ? { ...post, commentCount: nextComments.length }
      : post);
    renderTalkDetail();
    renderTalkBoard(talkPostCache);
    renderTalkHome(talkPostCache);
    showToast('댓글이 등록되었습니다.');
  } catch (err) {
    showToast(err.message || '댓글 등록에 실패했습니다.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

async function deleteTalkComment(commentId) {
  if (!selectedTalkPostId || !commentId) return;
  if (!isApprovedAccount() || isAgencyAccount()) {
    showToast('로그인이 필요합니다.');
    return;
  }
  const ok = await showAppConfirm('이 댓글을 삭제하시겠습니까?', '댓글 삭제');
  if (!ok) return;
  try {
    const response = await fetch(apiUrl(`/api/talk/posts/${encodeURIComponent(selectedTalkPostId)}/comments/${encodeURIComponent(commentId)}`), {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '댓글 삭제에 실패했습니다.'));
    const nextComments = getTalkComments(selectedTalkPostId).filter(comment => String(comment.id) !== String(commentId));
    talkCommentCache.set(String(selectedTalkPostId), nextComments);
    talkPostCache = talkPostCache.map(post => String(post.id) === String(selectedTalkPostId)
      ? { ...post, commentCount: Math.max(Number(post.commentCount || 0) - 1, nextComments.length) }
      : post);
    if (talkReplyTargetComment && String(talkReplyTargetComment.id) === String(commentId)) talkReplyTargetComment = null;
    renderTalkDetail();
    renderTalkBoard(talkPostCache);
    renderTalkHome(talkPostCache);
    showToast('댓글이 삭제되었습니다.');
  } catch (err) {
    showToast(err.message || '댓글 삭제에 실패했습니다.');
  }
}

async function updateTalkTradeStatus(postId, tradeStatus) {
  const post = talkPostCache.find(item => String(item.id) === String(postId));
  if (!post) return;
  const previousStatus = post.tradeStatus || 'SALE';
  post.tradeStatus = tradeStatus;
  renderTalkDetail();
  renderTalkBoard(talkPostCache);
  renderTalkHome(talkPostCache);
  try {
    const response = await fetch(apiUrl(`/api/talk/posts/${encodeURIComponent(postId)}/trade-status`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({ tradeStatus })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '거래 상태 변경에 실패했습니다.'));
    const updated = payload?.data;
    if (updated?.id) {
      talkPostCache = talkPostCache.map(item => String(item.id) === String(updated.id) ? { ...item, ...updated } : item);
      renderTalkDetail();
      renderTalkBoard(talkPostCache);
      renderTalkHome(talkPostCache);
    }
    showToast(`${getTalkTradeStatusLabel(tradeStatus)}으로 변경되었습니다.`);
  } catch (err) {
    post.tradeStatus = previousStatus;
    renderTalkDetail();
    renderTalkBoard(talkPostCache);
    renderTalkHome(talkPostCache);
    showToast(err.message || '거래 상태 변경에 실패했습니다.');
  }
}

async function refreshTalkLikeState(postId) {
  if (!isAuthenticated()) return;
  try {
    const response = await fetch(apiUrl(`/api/talk/posts/${encodeURIComponent(postId)}/like?_=${Date.now()}`), {
      headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return;
    const stateData = payload?.data || {};
    talkPostCache = talkPostCache.map(item => String(item.id) === String(postId)
      ? { ...item, likeCount: Number(stateData.likeCount || 0), likedByMe: stateData.likedByMe === true }
      : item);
    if (state.currentScreen === 'talk-detail' && String(selectedTalkPostId) === String(postId)) renderTalkDetail();
    if (state.currentScreen === 'talk') renderTalkBoard(talkPostCache);
    renderTalkHome(talkPostCache);
  } catch (err) {
    // 관심 상태 조회 실패는 게시글 보기 흐름을 막지 않습니다.
  }
}

async function toggleTalkLike(postId) {
  if (!isApprovedAccount() || isAgencyAccount()) {
    showToast('승인된 가맹점 계정만 관심 등록을 이용할 수 있습니다.');
    return;
  }
  const post = talkPostCache.find(item => String(item.id) === String(postId));
  if (post?.userId && String(post.userId) === String(getSessionUser()?.id)) {
    showToast('내가 등록한 글은 관심 등록할 수 없습니다.');
    return;
  }
  try {
    const response = await fetch(apiUrl(`/api/talk/posts/${encodeURIComponent(postId)}/like`), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '관심 등록에 실패했습니다.'));
    const stateData = payload?.data || {};
    talkPostCache = talkPostCache.map(item => String(item.id) === String(postId)
      ? { ...item, likeCount: Number(stateData.likeCount || 0), likedByMe: stateData.likedByMe === true }
      : item);
    renderTalkDetail();
    renderTalkBoard(talkPostCache);
    renderTalkHome(talkPostCache);
    showToast(stateData.likedByMe ? '관심 목록에 추가되었습니다.' : '관심이 해제되었습니다.');
  } catch (err) {
    showToast(err.message || '관심 등록에 실패했습니다.');
  }
}

async function reportTalkPost(postId) {
  if (!isAuthenticated()) {
    showToast('로그인이 필요합니다.');
    return;
  }
  const ok = await showAppConfirm('이 게시글을 신고하시겠습니까?\n운영자가 내용을 확인합니다.', '게시글 신고');
  if (!ok) return;
  try {
    const response = await fetch(apiUrl(`/api/talk/posts/${encodeURIComponent(postId)}/report`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({ reason: '부적절한 게시글' })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '신고 접수에 실패했습니다.'));
    showToast('신고가 접수되었습니다.');
  } catch (err) {
    showToast(err.message || '신고 접수에 실패했습니다.');
  }
}

async function reportTalkChat(chatId) {
  if (!isAuthenticated()) {
    showToast('로그인이 필요합니다.');
    return;
  }
  const ok = await showAppConfirm('이 채팅방을 신고하시겠습니까?\n최근 대화와 거래글을 운영자가 확인합니다.', '채팅 신고');
  if (!ok) return;
  try {
    const response = await fetch(apiUrl(`/api/talk/chats/${encodeURIComponent(chatId)}/report`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({ reason: '부적절한 채팅' })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '신고 접수에 실패했습니다.'));
    showToast('신고가 접수되었습니다.');
  } catch (err) {
    showToast(err.message || '신고 접수에 실패했습니다.');
  }
}

async function incrementTalkView(postId) {
  if (!postId) return;
  try {
    const response = await fetch(apiUrl(`/api/talk/posts/${encodeURIComponent(postId)}/view`), {
      method: 'POST',
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return;
    const nextViewCount = Number(payload?.data?.viewCount);
    if (!Number.isFinite(nextViewCount)) return;
    talkPostCache = talkPostCache.map(item => String(item.id) === String(postId)
      ? { ...item, viewCount: nextViewCount }
      : item);
    if (state.currentScreen === 'talk-detail' && String(selectedTalkPostId) === String(postId)) renderTalkDetail();
    if (state.currentScreen === 'talk') renderTalkBoard(talkPostCache);
    renderTalkHome(talkPostCache);
  } catch (err) {
    // 조회수 반영 실패는 게시글 보기 흐름을 막지 않습니다.
  }
}

async function fetchTalkPosts(limit = 20) {
  try {
    const params = new URLSearchParams({
      limit: String(limit),
      _: String(Date.now())
    });
    const certified = talkViewerPosition || getCertifiedLocationPosition();
    const lat = Number(certified?.coords?.latitude);
    const lng = Number(certified?.coords?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      params.set('lat', String(lat));
      params.set('lng', String(lng));
    }
    if (String(activeTalkStatusFilter || '').toUpperCase() === 'LIKED') {
      params.set('liked', '1');
    }
    const token = getAuthToken();
    const response = await fetch(apiUrl(`/api/talk/posts?${params.toString()}`), {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('Talk 목록을 불러오지 못했습니다.');
    const payload = await response.json().catch(() => null);
    talkPostCache = Array.isArray(payload?.data?.items) ? payload.data.items : [];
  } catch (err) {
    console.error(err);
    talkPostCache = [];
  }
  renderTalkHome(talkPostCache);
  if (state.currentScreen === 'talk') renderTalkBoard(talkPostCache);
  if (state.currentScreen === 'talk-detail') renderTalkDetail();
  return talkPostCache;
}

async function submitTalkPost() {
  if (!isApprovedAccount() || isAgencyAccount()) {
    showToast('승인된 가맹점 계정만 Talk 글을 등록할 수 있습니다.');
    navigate(isAuthenticated() ? 'home' : 'login');
    return;
  }
  const title = ($('#talk-title-input')?.value || '').trim();
  const body = ($('#talk-body-input')?.value || '').trim();
  const price = Number(($('#talk-price-input')?.value || '0').replace?.(/[^\d]/g, '') || $('#talk-price-input')?.value || 0);
  if (!title || !body) {
    showToast('제목과 내용을 입력해주세요.');
    return;
  }
  const btn = $('#btn-talk-submit');
  const originalText = btn?.textContent || '등록하기';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '등록 중...';
  }
  try {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('body', body);
    formData.append('price', String(price || 0));
    talkImageFiles.slice(0, 10).forEach(file => formData.append('images', file));
    const response = await fetch(apiUrl('/api/talk/posts'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: formData
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, 'Talk 글 등록에 실패했습니다.'));
    ['#talk-title-input', '#talk-body-input', '#talk-price-input'].forEach(sel => {
      const el = $(sel);
      if (el) el.value = '';
    });
    const input = $('#talk-image-input');
    if (input) input.value = '';
    talkImageFiles = [];
    renderTalkImagePreview();
    showToast('Talk 글이 등록되었습니다.');
    await fetchTalkPosts(30);
    navigate('talk');
  } catch (err) {
    showToast(err.message || 'Talk 글 등록에 실패했습니다.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

async function startTalkChat(postId) {
  if (!isApprovedAccount() || isAgencyAccount()) {
    showToast('승인된 가맹점 계정만 채팅할 수 있습니다.');
    navigate(isAuthenticated() ? 'home' : 'login');
    return;
  }
  const post = talkPostCache.find(item => String(item.id) === String(postId));
  const user = getSessionUser();
  if (getTalkTradeStatus(post) === 'SOLD') {
    showToast('판매완료된 글은 새 채팅을 시작할 수 없습니다.');
    return;
  }
  if (post?.franchiseId && user?.franchiseId && String(post.franchiseId) === String(user.franchiseId)) {
    showToast('내가 등록한 글에는 채팅을 시작할 수 없습니다.');
    return;
  }
  try {
    const response = await fetch(apiUrl(`/api/talk/posts/${encodeURIComponent(postId)}/chats`), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '채팅방을 열 수 없습니다.'));
    selectedTalkChatId = payload?.data?.id;
    navigate('talk-chat');
  } catch (err) {
    showToast(err.message || '채팅방을 열 수 없습니다.');
  }
}

function showTalkChatPicker(chats = []) {
  const old = $('#talk-chat-picker-modal');
  if (old) old.remove();
  const user = getSessionUser();
  const modal = document.createElement('div');
  modal.id = 'talk-chat-picker-modal';
  modal.style.cssText = 'position:absolute; inset:0; z-index:10020; background:rgba(0,0,0,.45); display:flex; align-items:flex-end; justify-content:center; padding:18px;';
  modal.innerHTML = `
    <div style="width:100%; max-width:390px; max-height:74%; overflow:hidden; background:#fff; border-radius:18px 18px 12px 12px; box-shadow:0 -10px 32px rgba(0,0,0,.18); border:1px solid var(--card-border);">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:16px 18px 12px; border-bottom:1px solid var(--border-light);">
        <div>
          <div style="font-size:16px; font-weight:900; color:var(--text-primary);">문의 채팅 선택</div>
          <div style="font-size:11px; font-weight:800; color:var(--text-muted); margin-top:3px;">채팅할 상대를 선택해주세요</div>
        </div>
        <button type="button" id="talk-chat-picker-close" aria-label="닫기" style="border:none; background:#f4f8f2; color:var(--green-dark); width:32px; height:32px; border-radius:10px; font-size:22px; line-height:1; font-weight:800;">×</button>
      </div>
      <div style="overflow:auto; max-height:calc(74vh - 74px); padding:4px 18px 14px;">
        ${chats.map(chat => {
          const unread = Number(chat.unreadCount || 0);
          return `
            <button type="button" class="talk-chat-picker-row" data-chat-id="${escapeHtml(chat.id)}" style="width:100%; border:none; background:#fff; text-align:left; padding:14px 0; border-bottom:1px solid var(--border-light); display:block;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <div style="min-width:0;">
                  <div style="font-size:14px; font-weight:900; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(getTalkChatPeerName(chat, user))}</div>
                  <div style="font-size:12px; font-weight:${unread ? '900' : '800'}; color:${unread ? 'var(--text-primary)' : 'var(--text-muted)'}; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(chat.lastMessage || '아직 메시지가 없습니다.')}</div>
                </div>
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:5px; flex-shrink:0;">
                  ${unread ? `<span style="min-width:20px; height:20px; padding:0 6px; border-radius:999px; background:#ef4444; color:#fff; font-size:10px; font-weight:900; display:inline-flex; align-items:center; justify-content:center;">${unread > 99 ? '99+' : unread}</span>` : ''}
                  <span style="font-size:10px; color:var(--text-muted); font-weight:800;">${escapeHtml(chat.lastMessageAtLabel || '')}</span>
                </div>
              </div>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
  const close = () => modal.remove();
  ($('#app-shell') || document.body).appendChild(modal);
  $('#talk-chat-picker-close', modal)?.addEventListener('click', close);
  modal.addEventListener('click', event => {
    if (event.target === modal) close();
    const row = event.target.closest('.talk-chat-picker-row');
    if (!row) return;
    selectedTalkChatId = row.getAttribute('data-chat-id');
    close();
    navigate('talk-chat');
  });
}

async function openTalkChatsForPost(postId) {
  if (!isApprovedAccount() || isAgencyAccount()) {
    showToast('승인된 가맹점 계정만 채팅을 이용할 수 있습니다.');
    return;
  }
  try {
    const response = await fetch(apiUrl(`/api/talk/chats?_=${Date.now()}`), {
      headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '채팅 목록을 불러오지 못했습니다.'));
    const chats = Array.isArray(payload?.data) ? payload.data : [];
    const relatedChats = chats.filter(chat => String(chat.postId) === String(postId));
    if (relatedChats.length === 1) {
      selectedTalkChatId = relatedChats[0].id;
      navigate('talk-chat');
      return;
    }
    if (relatedChats.length > 1) {
      showTalkChatPicker(relatedChats);
      return;
    }
    showToast('아직 이 글에 들어온 문의 채팅이 없습니다.');
  } catch (err) {
    showToast(err.message || '채팅 목록을 불러오지 못했습니다.');
  }
}

async function fetchTalkChats() {
  const list = $('#talk-chat-list');
  if (!list) return;
  if (!isApprovedAccount() || isAgencyAccount()) {
    list.innerHTML = '<div style="padding:28px 0;text-align:center;color:var(--text-muted);font-weight:800;">승인된 가맹점 계정만 채팅을 이용할 수 있습니다.</div>';
    return;
  }
  try {
    const response = await fetch(apiUrl(`/api/talk/chats?_=${Date.now()}`), {
      headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '채팅 목록을 불러오지 못했습니다.'));
    const chats = Array.isArray(payload?.data) ? payload.data : [];
    if (!chats.length) {
      list.innerHTML = '<div style="padding:28px 0;text-align:center;color:var(--text-muted);font-weight:800;">아직 Talk 채팅이 없습니다.</div>';
      return;
    }
    const user = getSessionUser();
    list.innerHTML = chats.map(chat => {
      const unreadCount = Number(chat.unreadCount || 0);
      return `
        <div class="talk-chat-row" data-chat-id="${escapeHtml(chat.id)}" style="padding:14px 0;border-bottom:1px solid var(--border-light);cursor:pointer;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="font-size:15px;font-weight:900;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(chat.postTitle || 'Talk')}</div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
              ${unreadCount > 0 ? `<span style="min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#ef4444;color:#fff;font-size:10px;font-weight:900;display:inline-flex;align-items:center;justify-content:center;line-height:1;">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}
              <div style="font-size:10px;color:var(--text-muted);font-weight:800;white-space:nowrap;">${escapeHtml(chat.lastMessageAtLabel || '')}</div>
            </div>
          </div>
          <div style="font-size:11px;color:var(--green-dark);font-weight:900;margin-top:4px;">${escapeHtml(getTalkChatPeerName(chat, user))}</div>
          <div style="font-size:12px;color:${unreadCount > 0 ? 'var(--text-primary)' : 'var(--text-muted)'};font-weight:${unreadCount > 0 ? '900' : '800'};margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(chat.lastMessage || '아직 메시지가 없습니다.')}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = '<div style="padding:28px 0;text-align:center;color:var(--text-muted);font-weight:800;">채팅 목록을 불러오지 못했습니다.</div>';
  }
}

function getTalkChatPeerName(chat, user = getSessionUser()) {
  if (!chat) return '상대 가맹점';
  const isSeller = String(chat.sellerUserId) === String(user?.id);
  const peerName = isSeller ? chat.buyerName : chat.sellerName;
  return peerName || chat.franchiseName || '상대 가맹점';
}

function getTalkMessageSignature(messages = []) {
  const last = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;
  return last ? `${last.id || ''}:${getTalkMessageSenderId(last) || ''}:${last.createdAt || ''}` : '';
}

function normalizeEntityId(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

function getSessionUserId(user = getSessionUser()) {
  return normalizeEntityId(user?.id || user?.userId || user?.user_id);
}

function getTalkMessageSenderId(message) {
  return normalizeEntityId(message?.senderUserId || message?.sender_user_id || message?.userId || message?.user_id || message?.senderId || message?.sender_id);
}

function isMyTalkMessage(message, user = getSessionUser()) {
  const currentUserId = getSessionUserId(user);
  const senderUserId = getTalkMessageSenderId(message);
  return Boolean(currentUserId && senderUserId && currentUserId === senderUserId);
}

function unlockTalkMessageSound() {
  talkMessageSoundUnlocked = true;
  if (!window.AudioContext && !window.webkitAudioContext) return;
  if (!talkChatAudioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    talkChatAudioContext = new AudioContextClass();
  }
  if (talkChatAudioContext.state === 'suspended') {
    talkChatAudioContext.resume().catch(() => {});
  }
}

function playTalkMessageSound(type = 'receive') {
  try {
    unlockTalkMessageSound();
    if (!talkChatAudioContext) return;
    const now = talkChatAudioContext.currentTime;
    const gain = talkChatAudioContext.createGain();
    gain.connect(talkChatAudioContext.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(type === 'send' ? 0.075 : 0.095, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    const first = talkChatAudioContext.createOscillator();
    first.type = 'sine';
    first.frequency.setValueAtTime(type === 'send' ? 660 : 820, now);
    first.connect(gain);
    first.start(now);
    first.stop(now + 0.13);

    if (type === 'receive') {
      const second = talkChatAudioContext.createOscillator();
      second.type = 'sine';
      second.frequency.setValueAtTime(1040, now + 0.07);
      second.connect(gain);
      second.start(now + 0.07);
      second.stop(now + 0.19);
    }
  } catch (_) {
    // Chat sound is a convenience feature and should never block messaging.
  }
}

async function fetchTalkMessages({ silent = false } = {}) {
  if (!selectedTalkChatId) return;
  try {
    const response = await fetch(apiUrl(`/api/talk/chats/${encodeURIComponent(selectedTalkChatId)}/messages?_=${Date.now()}`), {
      headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error('채팅을 불러오지 못했습니다.');
    const chat = payload?.data?.chat || {};
    const messages = Array.isArray(payload?.data?.messages) ? payload.data.messages : [];
    const user = getSessionUser();
    $('#talk-chat-title') && ($('#talk-chat-title').textContent = chat.postTitle || 'Talk 채팅');
    const peerEl = $('#talk-chat-peer');
    if (peerEl) {
      peerEl.innerHTML = `
        <span>${escapeHtml(getTalkChatPeerName(chat, user))}</span>
        <span style="display:flex;align-items:center;gap:6px;">
          <button type="button" id="btn-talk-chat-leave" style="border:1px solid #d8ead8;background:#fff;color:var(--text-muted);border-radius:9px;padding:5px 8px;font-size:10px;font-weight:900;">나가기</button>
          <button type="button" id="btn-talk-chat-report" style="border:none;background:#fff7f7;color:#c24141;border-radius:9px;padding:5px 8px;font-size:10px;font-weight:900;">신고</button>
        </span>
      `;
      peerEl.style.display = 'flex';
      peerEl.style.alignItems = 'center';
      peerEl.style.justifyContent = 'space-between';
      peerEl.style.gap = '8px';
    }
    const wrap = $('#talk-chat-messages');
    if (!wrap) return;
    const scroller = $('#talk-chat-scroll');
    const previousCount = Number(wrap.dataset.messageCount || 0);
    const previousSignature = wrap.dataset.lastMessageSignature || lastTalkMessageSignature || '';
    const nextCount = messages.length;
    const nextSignature = getTalkMessageSignature(messages);
    const lastMessage = messages.length ? messages[messages.length - 1] : null;
    const lastMessageIsMine = lastMessage && isMyTalkMessage(lastMessage, user);
    const wasNearBottom = scroller
      ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
      : true;
    wrap.innerHTML = messages.map(msg => {
      const mine = isMyTalkMessage(msg, user);
      const readLabel = mine ? (msg.readAt ? '읽음' : '안읽음') : '';
      return `
        <div style="display:flex;justify-content:${mine ? 'flex-end' : 'flex-start'};align-items:flex-end;gap:5px;">
          ${readLabel ? `<span style="font-size:10px;color:${msg.readAt ? 'var(--green-dark)' : '#ef8a00'};font-weight:900;margin-bottom:3px;">${readLabel}</span>` : ''}
          <div style="max-width:78%;background:${mine ? 'var(--green-primary)' : '#f1f3f1'};color:${mine ? '#fff' : 'var(--text-primary)'};border-radius:16px;padding:10px 12px;font-size:14px;font-weight:700;line-height:1.45;white-space:pre-wrap;">${escapeHtml(msg.message || '')}</div>
        </div>
      `;
    }).join('') || '<div style="padding:28px 0;text-align:center;color:var(--text-muted);font-weight:800;">첫 메시지를 보내보세요.</div>';
    wrap.dataset.messageCount = String(nextCount);
    wrap.dataset.lastMessageSignature = nextSignature;
    lastTalkMessageSignature = nextSignature;
    if (silent && previousCount > 0 && nextCount > previousCount && nextSignature !== previousSignature && !lastMessageIsMine) {
      playTalkMessageSound('receive');
    }
    if (wasNearBottom || nextCount > previousCount) {
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
    }
  } catch (err) {
    if (!silent) showToast('채팅을 불러오지 못했습니다.');
  }
}

async function sendTalkMessage() {
  const input = $('#talk-chat-input');
  const message = (input?.value || '').trim();
  if (!selectedTalkChatId || !message) return;
  const btn = $('#btn-talk-chat-send');
  if (btn) btn.disabled = true;
  try {
    const response = await fetch(apiUrl(`/api/talk/chats/${encodeURIComponent(selectedTalkChatId)}/messages`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({ message })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '메시지 전송에 실패했습니다.'));
    if (input) input.value = '';
    playTalkMessageSound('send');
    await fetchTalkMessages({ silent: true });
  } catch (err) {
    showToast(err.message || '메시지 전송에 실패했습니다.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function leaveTalkChat() {
  if (!selectedTalkChatId) return;
  const confirmed = await showAppConfirm(
    '이 채팅방을 나가시겠습니까?\n내 채팅 목록에서만 사라지고 대화 기록은 보존됩니다.',
    '채팅방 나가기'
  );
  if (!confirmed) return;
  try {
    const response = await fetch(apiUrl(`/api/talk/chats/${encodeURIComponent(selectedTalkChatId)}/leave`), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '채팅방 나가기에 실패했습니다.'));
    selectedTalkChatId = null;
    stopTalkChatPolling();
    showToast('채팅방에서 나갔습니다.');
    navigate('talk-chats');
  } catch (err) {
    showToast(err.message || '채팅방 나가기에 실패했습니다.');
  }
}

function stopTalkChatPolling() {
  if (talkChatPollTimer) {
    clearInterval(talkChatPollTimer);
    talkChatPollTimer = null;
  }
}

function syncAgencyDateRange(forceToday = false) {
  const startInput = $('#agency-start-date');
  const endInput = $('#agency-end-date');
  if (!startInput || !endInput) return;
  const today = todayYMD();
  if (forceToday || !startInput.value) startInput.value = today;
  if (forceToday || !endInput.value) endInput.value = today;
}

function renderAgencySettlement(data = {}) {
  const user = getSessionUser();
  const agencyName = $('#agency-screen-name');
  const summary = data.summary || {};
  if (agencyName) {
    agencyName.textContent = data.agency?.name || user?.agencyName || user?.franchiseName || '대리점';
  }
  $('#agency-summary-count') && ($('#agency-summary-count').textContent = `${Number(summary.count || 0).toLocaleString('ko-KR')}건`);
  $('#agency-summary-payment') && ($('#agency-summary-payment').textContent = formatWon(summary.paymentAmount));
  $('#agency-summary-service') && ($('#agency-summary-service').textContent = formatWon(summary.serviceFee));
  $('#agency-summary-net') && ($('#agency-summary-net').textContent = formatWon(summary.agencyNet));
  $('#agency-fee-rate') && ($('#agency-fee-rate').textContent = `수수료율 ${Number(data.agency?.feeRate || user?.feeRate || 0.3).toFixed(2)}%`);

  const list = $('#agency-settlement-list');
  const items = Array.isArray(data.items) ? data.items : [];
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px 10px;color:var(--text-muted);">해당 기간의 결제내역이 없습니다.</td></tr>';
    renderAgencyPagination(data.pagination || { currentPage: 1, totalPages: 1 });
    return;
  }
  list.innerHTML = items.map(item => `
    <tr>
      <td>
        <div style="white-space:nowrap;">${escapeHtml(item.date || '')}</div>
        <div style="font-size:10px;color:${item.status === '취소' ? '#e53935' : 'var(--green-primary)'};margin-top:3px;">${escapeHtml(item.status || '-')}</div>
      </td>
      <td>
        <div style="max-width:130px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.franchiseName || '-')}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:3px;">${escapeHtml(item.approvalNo || '-')}</div>
      </td>
      <td style="text-align:right;">${formatWon(item.paymentAmount)}</td>
      <td style="text-align:right;color:var(--green-primary);">${formatWon(item.agencyFee)}</td>
      <td style="text-align:right;color:var(--green-dark);">${formatWon(item.agencyNet)}</td>
    </tr>
  `).join('');
  renderAgencyPagination(data.pagination || { currentPage: 1, totalPages: 1 });
}

function renderAgencyPagination(pagination = {}) {
  const wrap = $('#agency-pagination');
  if (!wrap) return;
  const current = Number(pagination.currentPage || 1);
  const total = Math.max(Number(pagination.totalPages || 1), 1);
  if (total <= 1) {
    wrap.innerHTML = '';
    return;
  }
  const pages = [];
  const start = Math.max(1, current - 2);
  const end = Math.min(total, start + 4);
  for (let page = start; page <= end; page += 1) pages.push(page);
  wrap.innerHTML = [
    `<button class="agency-page-btn" data-page="${Math.max(1, current - 1)}" ${current <= 1 ? 'disabled' : ''}>‹</button>`,
    ...pages.map(page => `<button class="agency-page-btn${page === current ? ' active' : ''}" data-page="${page}">${page}</button>`),
    `<button class="agency-page-btn" data-page="${Math.min(total, current + 1)}" ${current >= total ? 'disabled' : ''}>›</button>`
  ].join('');
  $$('.agency-page-btn', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      agencySettlementPage = Number(btn.dataset.page || 1);
      void fetchAgencySettlement(agencySettlementPage);
    });
  });
}

async function fetchAgencySettlement(page = agencySettlementPage) {
  if (!isAgencyAccount()) return;
  syncAgencyDateRange();
  agencySettlementPage = Math.max(Number(page || 1), 1);
  const startDate = $('#agency-start-date')?.value;
  const endDate = $('#agency-end-date')?.value;
  const list = $('#agency-settlement-list');
  if (!startDate || !endDate) {
    showToast('조회 기간을 선택해주세요.');
    return;
  }
  if (list) {
    list.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;"><div class="spinner" style="border-top-color:var(--green-primary);width:28px;height:28px;margin:0 auto;"></div></td></tr>';
  }
  try {
    const response = await fetch(apiUrl(`/api/agency/me/settlements?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&page=${agencySettlementPage}&limit=10&_=${Date.now()}`), {
      headers: {
        'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`
      },
      cache: 'no-store'
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(getFriendlyErrorMessage(err, '대리점 정산 내역을 불러오지 못했습니다.'));
    }
    const payload = await response.json();
    renderAgencySettlement(payload.data || {});
  } catch (error) {
    console.error(error);
    renderAgencySettlement({ items: [], summary: {} });
    showToast(error.message || '대리점 정산 내역을 불러오지 못했습니다.');
  }
}

function startSmsCountdown(el) {
  if (!el) return;
  clearInterval(state.smsTimer);
  state.smsCountdown = 180;
  el.style.display = 'block';
  
  state.smsTimer = setInterval(() => {
    state.smsCountdown--;
    const m = Math.floor(state.smsCountdown / 60);
    const s = state.smsCountdown % 60;
    el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    if (state.smsCountdown <= 0) {
      clearInterval(state.smsTimer);
      el.textContent = '0:00';
    }
  }, 1000);
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
    const serviceWorkerVersion = '20260628_upload_name_fix';
    navigator.serviceWorker.register(`/sw.js?v=${serviceWorkerVersion}`).then(registration => {
      if (typeof registration.update === 'function') registration.update().catch(() => {});
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const reloadKey = `eatspay-sw-reloaded-${serviceWorkerVersion}`;
      if (sessionStorage.getItem(reloadKey)) return;
      sessionStorage.setItem(reloadKey, '1');
      window.location.reload();
    });
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'EATSPAY_PUSH_CLICK') {
        void handlePushNavigation(event.data.data || {});
      }
    });
  }
  if (isAuthenticated()) {
    registerDevicePushToken();
  }

  loadBankInstitutions();
  resetAppToSplash();
  startInitialFlow();
  void handleAgencyInviteStartup();
  const startupPushRoute = getPushRouteFromUrl();
  if (startupPushRoute) rememberPushRoute(startupPushRoute);
  if (isAuthenticated()) {
    setTimeout(() => handlePendingPushRoute(), 2800);
  }
  loadInstallmentBanner();
  void fetchAppBanners();
  normalizeBackButtons();
    void fetchTalkPosts(30);

  // Hardware/Virtual Device back button history bindings
  window.history.replaceState({ screen: 'splash' }, '');
  window.addEventListener('popstate', (event) => {
    if (state.history.length > 0) {
      goBack();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      persistRegisterDraft(false);
      rememberAppBackgroundTime();
      return;
    }
    if (document.visibilityState === 'visible') {
      restoreFreshLaunch({ forceStandardResume: true });
      if (isAuthenticated()) registerDevicePushToken();
    }
  });

  document.addEventListener('resume', () => {
    restoreFreshLaunch({ forceStandardResume: true });
    if (isAuthenticated()) registerDevicePushToken();
  });
  window.addEventListener('pagehide', () => {
    persistRegisterDraft(false);
    rememberAppBackgroundTime();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      restoreFreshLaunch({ forceStandardResume: true });
    }
  });

  // Global Back Buttons
  $$('.btn-back').forEach(btn => btn.addEventListener('click', goBack));

  // Bottom Nav & Home Banner Click Bindings
  function clearBottomNavHover(exceptNav = null, exceptItem = null) {
    $$('.bottom-nav.nav-hovering').forEach(nav => {
      if (nav !== exceptNav) nav.classList.remove('nav-hovering');
    });
    $$('.bottom-nav .nav-item.nav-hover').forEach(item => {
      if (item !== exceptItem) item.classList.remove('nav-hover');
    });
  }

  function setBottomNavHoverByPoint(clientX, clientY) {
    let hoveredNav = null;
    let hoveredItem = null;
    $$('.bottom-nav').some(nav => {
      const navRect = nav.getBoundingClientRect();
      if (clientX < navRect.left || clientX > navRect.right || clientY < navRect.top || clientY > navRect.bottom) {
        return false;
      }
      hoveredNav = nav;
      hoveredItem = $$('.nav-item', nav).find(item => {
        const rect = item.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      }) || null;
      return true;
    });
    clearBottomNavHover(hoveredNav, hoveredItem);
    document.documentElement.classList.toggle('nav-cursor-pointer', Boolean(hoveredItem));
    if (hoveredNav && hoveredItem) {
      hoveredNav.classList.add('nav-hovering');
      hoveredItem.classList.add('nav-hover');
    }
  }

  document.addEventListener('pointermove', event => {
    setBottomNavHoverByPoint(event.clientX, event.clientY);
  }, { passive: true });
  document.addEventListener('mousemove', event => {
    setBottomNavHoverByPoint(event.clientX, event.clientY);
  }, { passive: true });
  document.addEventListener('pointerover', event => {
    const navItem = event.target.closest('.bottom-nav .nav-item');
    if (!navItem) return;
    const nav = navItem.closest('.bottom-nav');
    clearBottomNavHover(nav, navItem);
    nav?.classList.add('nav-hovering');
    navItem.classList.add('nav-hover');
  });
  document.addEventListener('pointerout', event => {
    const navItem = event.target.closest('.bottom-nav .nav-item');
    if (!navItem) return;
    const next = event.relatedTarget;
    if (next && navItem.contains(next)) return;
    const nav = navItem.closest('.bottom-nav');
    navItem.classList.remove('nav-hover');
    if (!next || !nav?.contains(next)) {
      nav?.classList.remove('nav-hovering');
      document.documentElement.classList.remove('nav-cursor-pointer');
    }
  });

  function getBottomNavItemFromEvent(event) {
    const fromPath = event.target.closest?.('.bottom-nav .nav-item');
    if (fromPath) return fromPath;
    const fromPoint = document.elementFromPoint(event.clientX, event.clientY);
    return fromPoint?.closest?.('.bottom-nav .nav-item') || null;
  }

  function navigateBottomNavItem(navItem, event) {
    if (!navItem) return false;
    const id = navItem.id || '';
    const target = navItem.dataset.navTarget
      || (id.startsWith('nav-home') ? 'home' : '')
      || (id.startsWith('nav-agency') ? 'agency' : '')
      || (id.startsWith('nav-my') ? 'my' : '')
      || (id.startsWith('nav-cs') ? 'cs' : '');
    if (!target) return false;
    event?.preventDefault?.();
    if (target === 'home') navigate('home');
    else if (target === 'agency') navigate('agency');
    else if (target === 'my') navigate('my');
    else if (target === 'cs') navigate('cs-main');
    return true;
  }

  document.addEventListener('pointerup', event => {
    const navItem = getBottomNavItemFromEvent(event);
    if (!navItem) return;
    navigateBottomNavItem(navItem, event);
  }, { capture: true });

  document.addEventListener('pointerover', event => {
    const writeBtn = event.target.closest?.('.talk-write-floating');
    if (writeBtn) writeBtn.classList.add('is-expanded');
  }, { passive: true });
  document.addEventListener('pointerout', event => {
    const writeBtn = event.target.closest?.('.talk-write-floating');
    const next = event.relatedTarget;
    if (writeBtn && next && writeBtn.contains(next)) return;
    if (writeBtn) writeBtn.classList.remove('is-expanded');
  }, { passive: true });
  document.addEventListener('click', event => {
    const managedBanner = event.target.closest('.app-managed-banner');
    if (managedBanner) {
      event.preventDefault();
      const bannerUrl = String(managedBanner.dataset.bannerUrl || '').trim();
      if (bannerUrl) openAppBannerUrl(bannerUrl);
      else toggleAppBannerDetail(managedBanner);
      return;
    }
    const navItem = getBottomNavItemFromEvent(event);
    if (navigateBottomNavItem(navItem, event)) return;
    if (!navItem) return;
    const id = navItem.id || '';
    if (id.startsWith('nav-home')) {
      event.preventDefault();
      navigate('home');
    } else if (id.startsWith('nav-agency')) {
      event.preventDefault();
      navigate('agency');
    } else if (id.startsWith('nav-my')) {
      event.preventDefault();
      navigate('my');
    } else if (id.startsWith('nav-cs')) {
      event.preventDefault();
      navigate('cs-main');
    }
  });
  $$('img[src*="logo.png"]').forEach(logo => {
    logo.style.cursor = 'pointer';
    logo.setAttribute('role', 'button');
    logo.setAttribute('tabindex', '0');
    logo.setAttribute('aria-label', '홈으로 이동');
  });
  document.addEventListener('click', event => {
    const logo = event.target.closest('img[src*="logo.png"]');
    if (!logo) return;
    event.preventDefault();
    navigate('home');
  });
  document.addEventListener('keydown', event => {
    const logo = event.target.closest('img[src*="logo.png"]');
    if (!logo || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    navigate('home');
  });
  $('#home-auth-action')?.addEventListener('click', () => {
    if (isAuthenticated() && getSessionUser()) {
      logoutAndGoToLogin();
    } else {
      navigate('login');
    }
  });
  $('#home-login-banner')?.addEventListener('click', () => {
    renderBenefitCardList();
    navigate('benefit-cards');
  });
  $('#home-menu-advance')?.addEventListener('click', openAdvanceSettlement);
  $('#home-menu-mall')?.addEventListener('click', () => navigate('card-benefit-search'));
  $('#home-menu-delivery')?.addEventListener('click', () => navigate('friendly-delivery'));
  $('#home-weather-card')?.addEventListener('click', () => {
    void openHomeWeatherDetail();
  });
  $('#location-setup-request')?.addEventListener('click', requestStartupLocationPermission);
  $('#location-setup-recheck')?.addEventListener('click', requestStartupLocationPermission);
  $('#btn-advance-submit')?.addEventListener('click', () => {
    showAppAlert('선정산 상담 신청은 현재 대기중입니다.', '대기중');
  });
  $('#benefit-card-search-btn')?.addEventListener('click', () => {
    void fetchBenefitCardSearch($('#benefit-card-search-input')?.value || '');
  });
  $('#benefit-card-search-input')?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void fetchBenefitCardSearch(event.currentTarget.value || '');
  });
  $('#friendly-delivery-location-btn')?.addEventListener('click', requestFriendlyDeliveryLocation);
  $('#btn-talk-write')?.addEventListener('click', () => navigate('talk-write'));
  $('#btn-home-talk-write-floating')?.addEventListener('click', () => navigate('talk-write'));
  $('#btn-talk-write-floating')?.addEventListener('click', () => navigate('talk-write'));
  $('#btn-talk-chats')?.addEventListener('click', () => navigate('talk-chats'));
  $('#btn-talk-submit')?.addEventListener('click', submitTalkPost);
  $('#btn-talk-image-pick')?.addEventListener('click', () => $('#talk-image-input')?.click());
  $('#talk-image-input')?.addEventListener('change', event => {
    const files = Array.from(event.target.files || []).filter(file => file.type.startsWith('image/'));
    talkImageFiles = [...talkImageFiles, ...files].slice(0, 10);
    if (files.length > 10 || talkImageFiles.length >= 10) showToast('이미지는 최대 10개까지 첨부할 수 있습니다.');
    renderTalkImagePreview();
  });
  $('#talk-image-preview')?.addEventListener('click', event => {
    const btn = event.target.closest('.talk-image-remove');
    if (!btn) return;
    talkImageFiles.splice(Number(btn.getAttribute('data-index')), 1);
    renderTalkImagePreview();
  });
  $('#talk-status-filter')?.addEventListener('click', event => {
    const btn = event.target.closest('.talk-status-filter-chip');
    if (!btn) return;
    activeTalkStatusFilter = btn.getAttribute('data-status') || 'ALL';
    talkBoardPage = 1;
    if (String(activeTalkStatusFilter).toUpperCase() === 'LIKED') {
      void fetchTalkPosts(50);
    } else {
      void fetchTalkPosts(50);
      renderTalkBoard(talkPostCache);
    }
  });
  $('#talk-pagination')?.addEventListener('click', event => {
    const btn = event.target.closest('.talk-page-btn');
    if (!btn) return;
    talkBoardPage = Math.max(Number(btn.getAttribute('data-page')) || 1, 1);
    renderTalkBoard(talkPostCache);
    $('#screen-talk .screen-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#home-talk-list')?.addEventListener('click', event => {
    const pageBtn = event.target.closest('.home-talk-page');
    if (pageBtn) {
      event.preventDefault();
      homeTalkPage = Math.max(Number(pageBtn.getAttribute('data-page')) || 1, 1);
      renderTalkHome(talkPostCache);
      return;
    }
    const item = event.target.closest('.home-talk-row');
    if (!item) return;
    openTalkDetail(item.getAttribute('data-talk-id'));
  });
  $('#talk-detail-body')?.addEventListener('click', event => {
    const replyBtn = event.target.closest('.talk-comment-reply-btn');
    if (replyBtn && selectedTalkPostId) {
      event.preventDefault();
      setTalkReplyTarget(replyBtn.getAttribute('data-comment-id'));
      return;
    }
    if (event.target.closest('#btn-talk-reply-cancel')) {
      event.preventDefault();
      clearTalkReplyTarget();
      return;
    }
    const deleteBtn = event.target.closest('.talk-comment-delete-btn');
    if (deleteBtn && selectedTalkPostId) {
      event.preventDefault();
      void deleteTalkComment(deleteBtn.getAttribute('data-comment-id'));
      return;
    }
    const statusBtn = event.target.closest('.talk-trade-status-btn');
    if (statusBtn && selectedTalkPostId) {
      event.preventDefault();
      void updateTalkTradeStatus(selectedTalkPostId, statusBtn.getAttribute('data-status') || 'SALE');
      return;
    }
    if (event.target.closest('#btn-talk-like') && selectedTalkPostId) {
      event.preventDefault();
      void toggleTalkLike(selectedTalkPostId);
      return;
    }
    if (event.target.closest('#btn-talk-report') && selectedTalkPostId) {
      event.preventDefault();
      void reportTalkPost(selectedTalkPostId);
      return;
    }
    if (event.target.closest('#btn-talk-comment-submit') && selectedTalkPostId) {
      event.preventDefault();
      void submitTalkComment();
    }
  });
  $('#talk-detail-body')?.addEventListener('keydown', event => {
    if (!event.target.closest('#talk-comment-input') || event.key !== 'Enter' || !event.ctrlKey) return;
    event.preventDefault();
    void submitTalkComment();
  });
  $('#btn-talk-detail-list')?.addEventListener('click', () => navigate('talk'));
  $('#btn-talk-like')?.addEventListener('click', event => {
    event.preventDefault();
    if (selectedTalkPostId) void toggleTalkLike(selectedTalkPostId);
  });
  $('#btn-talk-detail-comment')?.addEventListener('click', event => {
    event.preventDefault();
    $('#talk-comment-input')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => $('#talk-comment-input')?.focus(), 240);
  });
  $('#talk-board-list')?.addEventListener('click', event => {
    const card = event.target.closest('.talk-board-card');
    if (!card) return;
    openTalkDetail(card.getAttribute('data-talk-id'));
  });
  $('#talk-chat-list')?.addEventListener('click', event => {
    const row = event.target.closest('.talk-chat-row');
    if (!row) return;
    selectedTalkChatId = row.getAttribute('data-chat-id');
    navigate('talk-chat');
  });
  document.addEventListener('click', event => {
    if (event.target.closest('#btn-talk-chat-leave')) {
      event.preventDefault();
      void leaveTalkChat();
      return;
    }
    if (!event.target.closest('#btn-talk-chat-report')) return;
    event.preventDefault();
    if (selectedTalkChatId) void reportTalkChat(selectedTalkChatId);
  });
  $('#btn-talk-chat-send')?.addEventListener('click', sendTalkMessage);
  $('#talk-chat-input')?.addEventListener('focus', unlockTalkMessageSound);
  $('#talk-chat-input')?.addEventListener('pointerdown', unlockTalkMessageSound);
  $('#talk-chat-input')?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void sendTalkMessage();
  });
  document.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') return;
    const hapticType = getHapticTypeForElement(event.target);
    if (hapticType) appHaptic(hapticType);
  }, { passive: true });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const hapticType = getHapticTypeForElement(event.target);
    if (hapticType) appHaptic(hapticType);
  });
  document.addEventListener('click', event => {
    const btn = event.target.closest('.btn-benefit-card-select');
    if (!btn) return;
    event.preventDefault();
    cardEditDraft = null;
    sessionStorage.setItem('selectedBenefitCardCompany', btn.getAttribute('data-card-company') || '');
    navigate('card-add');
  });
  
  // --------- LOGIN SCREEN ---------
  $('#to-register')?.addEventListener('click', () => navigate('reg-step1'));
  $('#to-find-id')?.addEventListener('click', () => navigate('find-id'));
  $('#to-find-pw')?.addEventListener('click', () => navigate('find-pw'));
  $('#my-agency-settlement-btn')?.addEventListener('click', () => navigate('agency'));
  $('#agency-search-btn')?.addEventListener('click', () => {
    agencySettlementPage = 1;
    void fetchAgencySettlement(1);
  });
  
  $('#login-submit-btn')?.addEventListener('click', async () => {
    const btn = $('#login-submit-btn');
    const idInput = $('#login-id');
    const username = idInput ? idInput.value.trim() : '';
    const password = getPasswordValue('#login-pw');

    if (!username || !password) {
      showToast('아이디와 비밀번호를 입력해주세요.');
      return;
    }

    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<div class="spinner" style="border-top-color: white; width: 16px; height: 16px;"></div>';
    btn.disabled = true;

    try {
      const keepLogin = isNativeApp() || $('#keep-login-cb')?.classList.contains('checked') === true;
      const response = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: username, password, keepLogin })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(getFriendlyErrorMessage(errData, '로그인에 실패했습니다.'));
      }

      const resPayload = await response.json();
      if (resPayload.success && resPayload.data && resPayload.data.accessToken) {
        persistAuthSession(
          resPayload.data.accessToken,
          resPayload.data.user || null,
          keepLogin
        );
        clearAgencyInviteSession();
        syncLoggedInViews();
        registerDevicePushToken();
        const approvalState = getApprovalState(resPayload.data.user || null);
        if (approvalState === 'approved') {
          if (!isAgencyAccount(resPayload.data.user || null) && typeof fetchPaymentHistory === 'function') {
            fetchPaymentHistory();
          }
          if (!handlePendingPushRoute()) navigate('home');
        } else if (approvalState === 'pending') {
          showToast('가입이 완료되었습니다.');
          navigate('account-status');
        } else if (approvalState === 'rejected') {
          showToast('승인이 반려되었습니다. 고객센터를 확인해 주세요.');
          navigate('account-status');
        } else {
          showToast('로그인 상태를 확인할 수 없습니다.');
          navigate('login');
        }
        state.history = [];
        setTimeout(() => {
          showUnreadNotifications();
        }, 350);
      } else {
        throw new Error('토큰 정보가 없습니다.');
      }
    } catch (err) {
      const message = err instanceof TypeError
        ? `서버 연결 실패: ${API_BASE_URL || '현재 주소'}`
        : err.message;
      showToast(message);
    } finally {
      btn.innerHTML = '로그인';
      btn.disabled = false;
    }
  });
  ['#login-id', '#login-pw'].forEach(selector => {
    $(selector)?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      $('#login-submit-btn')?.click();
    });
  });

  const getPasswordValue = (inputId) => {
    const input = $(inputId);
    return input?.value ?? input?.dataset.realPassword ?? '';
  };

  const clearPasswordValue = (inputId) => {
    const input = $(inputId);
    if (!input) return;
    input.dataset.realPassword = '';
    input.value = '';
  };

  const bindMaskedPasswordInput = (inputId, toggleId, options = {}) => {
    const input = $(inputId);
    const toggle = toggleId ? $(toggleId) : null;
    if (!input) return;
    const maxLength = Number(options.maxLength || 0);
    const digitsOnly = !!options.digitsOnly;
    let isVisible = false;

    const syncInputMode = () => {
      input.type = 'text';
      input.classList.toggle('password-mask', !isVisible);
      input.style.color = '#111827';
      input.style.webkitTextFillColor = '#111827';
      input.style.caretColor = '#111827';
      if (toggle) {
        toggle.textContent = isVisible ? '숨김' : '보기';
        toggle.setAttribute('aria-label', isVisible ? '비밀번호 숨기기' : '비밀번호 보기');
      }
    };

    input.addEventListener('input', () => {
      let nextValue = digitsOnly ? input.value.replace(/\D/g, '') : input.value;
      if (maxLength > 0) nextValue = nextValue.slice(0, maxLength);
      if (input.value !== nextValue) input.value = nextValue;
    });

    toggle?.addEventListener('click', () => {
      isVisible = !isVisible;
      syncInputMode();
      input.focus();
    });

    syncInputMode();
  };

  const bindNativePasswordToggle = (inputId, toggleId) => {
    const input = $(inputId);
    const toggle = $(toggleId);
    if (!input || !toggle) return;
    input.classList.remove('password-mask');
    input.type = 'password';
    input.style.color = '';
    input.style.webkitTextFillColor = '';
    input.style.caretColor = '';
    toggle.textContent = '보기';
    toggle.setAttribute('aria-label', '비밀번호 보기');

    toggle.addEventListener('click', event => {
      event.preventDefault();
      const selectionStart = input.selectionStart;
      const selectionEnd = input.selectionEnd;
      const nextVisible = input.type === 'password';
      input.type = nextVisible ? 'text' : 'password';
      toggle.textContent = nextVisible ? '숨김' : '보기';
      toggle.setAttribute('aria-label', nextVisible ? '비밀번호 숨기기' : '비밀번호 보기');
      input.focus();
      if (selectionStart !== null && selectionEnd !== null) {
        try {
          input.setSelectionRange(selectionStart, selectionEnd);
        } catch (err) {
          // Some mobile keyboards do not allow restoring selection after type changes.
        }
      }
    });
  };

  bindMaskedPasswordInput('#login-pw', '#login-pw-toggle');
  bindMaskedPasswordInput('#reg-pw', '#reg-pw-toggle');
  bindMaskedPasswordInput('#reg-pw-confirm', '#reg-pw-confirm-toggle');
  bindMaskedPasswordInput('#add-card-pw', null, { maxLength: 2, digitsOnly: true });
  bindMaskedPasswordInput('#add-card-cvc', null, { maxLength: 4, digitsOnly: true });
  bindMaskedPasswordInput('#find-pw-new', null);
  bindMaskedPasswordInput('#find-pw-new2', null);
  bindNativePasswordToggle('#edit-myinfo-current-pw', '#edit-myinfo-current-pw-toggle');
  bindNativePasswordToggle('#edit-myinfo-new-pw', '#edit-myinfo-new-pw-toggle');
  bindNativePasswordToggle('#edit-myinfo-new-pw-confirm', '#edit-myinfo-new-pw-confirm-toggle');
  bindCurrencyInput('#advance-delivery-sales');
  bindCurrencyInput('#advance-store-sales');

  // --------- REG STEP 1 ---------
  // Disable next button initially until query check
  const nextBtn = $('#reg-to-step2');
  if (nextBtn) nextBtn.disabled = true;

  $('#reg-biz-query')?.addEventListener('click', async () => {
    const bizNo = $('#reg-biz-no')?.value;
    if (!bizNo || bizNo.replace(/[^0-9]/g, '').length < 10) {
      showToast('사업자등록번호 10자리를 입력해 주세요.');
      return;
    }

    const queryBtn = $('#reg-biz-query');
    queryBtn.innerHTML = '<div class="spinner" style="border-top-color: var(--green-primary); width:16px; height:16px;"></div>';
    queryBtn.disabled = true;

    try {
      const response = await fetch(apiUrl('/api/auth/verify-business'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessNumber: bizNo })
      });

      const result = await response.json();
      if (response.ok) {
        queryBtn.textContent = '조회 완료';
        showToast('사업자등록번호가 확인되었습니다.');
        
        state.formData.bizNumber = bizNo;
        if (nextBtn) nextBtn.disabled = false;
      } else {
        queryBtn.textContent = '조회하기';
        queryBtn.disabled = false;
        const errorCode = result.error?.code;
        const errorMessage = errorCode === 'ALREADY_EXISTS'
          ? '이미 가입된 사업자등록번호입니다.'
          : '유효하지 않은 사업자등록번호입니다.';
        showToast(errorMessage);
        if (nextBtn) nextBtn.disabled = true;
      }
    } catch (err) {
      console.error(err);
      queryBtn.textContent = '조회하기';
      queryBtn.disabled = false;
      showToast('네트워크 오류가 발생했습니다. 다시 시도해 주세요.');
      if (nextBtn) nextBtn.disabled = true;
    }
  });

  $('#reg-to-step2')?.addEventListener('click', () => {
    const bizNo = $('#reg-biz-no')?.value;
    if (!bizNo || bizNo.length < 10) {
      showToast('사업자등록번호 10자리를 입력해주세요.');
      return;
    }
    navigate('reg-step2');
  });

  // --------- REG STEP 2 ---------
  const regEmailInput = $('#reg-email');
  const regIdInput = $('#reg-id');
  regEmailInput?.addEventListener('input', function() {
    const email = this.value.trim();
    const suggestedId = email.includes('@') ? email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '') : '';
    const shouldFill = regIdInput && (!regIdInput.value.trim() || regIdInput.dataset.autoFilled === '1');
    if (shouldFill) {
      regIdInput.value = suggestedId;
      regIdInput.dataset.autoFilled = suggestedId ? '1' : '0';
    }
    persistRegisterDraft(false);
  });
  regIdInput?.addEventListener('input', function() {
    this.dataset.autoFilled = '0';
    persistRegisterDraft(false);
  });

  const phoneInput = $('#reg-phone');
  phoneInput?.addEventListener('input', function() {
    this.value = formatPhone(this.value);
    persistRegisterDraft(false);
  });

  $('#reg-send-sms')?.addEventListener('click', async () => {
    const btn = $('#reg-send-sms');
    const phone = $('#reg-phone')?.value;
    if (!phone || phone.length < 10) {
      showToast('휴대번호를 올바르게 입력해주세요.');
      return;
    }
    const prevText = btn?.textContent || '인증번호 발송';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div>';
    }
    try {
      const response = await fetch(apiUrl('/api/auth/sms/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(getFriendlyErrorMessage(payload, '인증번호 발송에 실패했습니다.'));
      }
      state.smsVerificationPhone = String(payload.data?.phone || phone).replace(/[^0-9]/g, '');
      state.smsCode = '';
      const smsInput = $('#reg-sms-input');
      if (smsInput) smsInput.value = '';
      startSmsCountdown($('#reg-sms-timer'));
      showToast('인증번호가 발송되었습니다.');
    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '인증번호 발송에 실패했습니다.'));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevText;
      }
    }
  });

  async function verifyRegisterSmsCode(phone, code) {
    const response = await fetch(apiUrl('/api/auth/sms/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(getFriendlyErrorMessage(payload, '인증번호가 일치하지 않습니다.'));
    }
    return payload;
  }

  async function ensureRegisterLoginIdAvailable(loginId) {
    const response = await fetch(apiUrl('/api/auth/check-login-id'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ loginId })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(getFriendlyErrorMessage(payload, '사용할 수 없는 아이디입니다.'));
    }
    return true;
  }

  // --------- REG STEP 3 ---------
  $('#reg-step2-next')?.addEventListener('click', async () => {
    const btn = $('#reg-step2-next');
    const contactEmail = $('#reg-email')?.value?.trim() || '';
    const id = $('#reg-id')?.value?.trim() || '';
    const pw = getPasswordValue('#reg-pw');
    const pwConfirm = getPasswordValue('#reg-pw-confirm');
    const phone = $('#reg-phone')?.value;
    const sms = $('#reg-sms-input')?.value;

    if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      showToast('연락받을 이메일을 올바르게 입력해주세요.');
      return;
    }
    if (!id || !/^[a-zA-Z0-9._-]{3,40}$/.test(id)) {
      showToast('로그인 ID는 영문, 숫자, ., _, - 조합 3자 이상으로 입력해주세요.');
      return;
    }
    if (!pw || pw.length < 4) {
      showToast('비밀번호를 4자리 이상 입력해주세요.');
      return;
    }
    if (pw !== pwConfirm) {
      showToast('비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    if (!phone || phone.length < 10) {
      showToast('휴대번호를 올바르게 입력해주세요.');
      return;
    }
    if (!sms) {
      showToast('인증번호를 입력해주세요.');
      return;
    }
    const prevText = btn?.textContent || '다음';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div>';
    }
    try {
      await ensureRegisterLoginIdAvailable(id);
      await verifyRegisterSmsCode(phone, sms);
      persistRegisterDraft(false);
      navigate('reg-step3');
    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '회원정보를 확인해 주세요.'));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevText;
      }
    }
  });

  const promptRegisterFileRequired = async ({ title, message, inputId }) => {
    await showAppAlert(message, title);
    if (inputId === '#reg-biz-license-file') {
      openVaccountPhotoSheet('bizLicense');
      return;
    }
    const input = $(inputId);
    if (input) input.click();
  };

  $('#reg-step3-next')?.addEventListener('click', async () => {
    const storeName = $('#reg-store-name')?.value;
    const ceoName = $('#reg-ceo-name')?.value;
    const address = $('#reg-address')?.value;
    const addressDetail = getRegisterAddressDetail();
    const bizLicenseFile = getRegisterBizLicenseFile();

    if (!storeName) {
      showToast('상호명을 입력해주세요.');
      return;
    }
    if (!ceoName) {
      showToast('대표자명을 입력해주세요.');
      return;
    }
    if (!address) {
      showToast('사업장주소를 입력해주세요.');
      return;
    }
    if (!addressDetail) {
      showToast('세부주소를 입력해주세요.');
      return;
    }
    if (!bizLicenseFile) {
      await promptRegisterFileRequired({
        title: '사업자등록증 첨부 필요',
        message: '사업자등록증 파일을 첨부해야 다음 단계로 이동할 수 있습니다.',
        inputId: '#reg-biz-license-file'
      });
      return;
    }
    navigate('reg-step4');
  });

  $('#reg-address-search')?.addEventListener('click', () => {
    persistRegisterDraft(true);
    openAddressSearch($('#reg-address'));
  });

  $('#reg-address')?.addEventListener('click', event => {
    // 주소 입력칸은 직접 입력 전용입니다. 외부 주소검색은 옆의 주소검색 버튼에서만 실행합니다.
    event.stopPropagation();
  });

  ['#reg-store-name', '#reg-ceo-name', '#reg-address', '#reg-address-detail'].forEach(selector => {
    $(selector)?.addEventListener('input', () => persistRegisterDraft(false));
  });

  const bindRegisterFilePicker = (buttonId, inputId, emptyLabel) => {
    const button = $(buttonId);
    const input = $(inputId);
    if (!button || !input) return;
    button.addEventListener('click', event => {
      event.preventDefault();
      persistRegisterDraft(true);
      openVaccountPhotoSheet('bizLicense');
    });
    button.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        button.click();
      }
    });
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) {
        clearBizLicenseSelection();
        return;
      }
      handleBizLicenseSelection(file, 'file');
    });
  };

  bindRegisterFilePicker('#upload-biz-license', '#reg-biz-license-file', '사업자등록증을 업로드해주세요');
  syncBizLicensePreview();

  // --------- REG STEP 4 ---------
  $('#term-all')?.addEventListener('change', function() {
    const isChecked = this.checked;
    $$('.term-checkbox').forEach(cb => cb.checked = isChecked);
  });

  $$('.term-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const allChecked = $$('.term-checkbox').every(c => c.checked);
      $('#term-all').checked = allChecked;
    });
  });

  // --------- REG STEP 4 checkbox bindings ---------
  const toggleCb = (el, force = null) => {
    if (force !== null) {
      if (force) el.classList.add('checked');
      else el.classList.remove('checked');
    } else {
      el.classList.toggle('checked');
    }
  };

  $('#term-all-row')?.addEventListener('click', () => {
    if (!state.legalDocumentsReady) {
      showToast('서비스 이용약관과 개인정보처리방침을 먼저 불러와야 합니다.');
      void loadActiveLegalDocuments();
      return;
    }
    const cb = $('#term-all-cb');
    cb.classList.toggle('checked');
    const isChecked = cb.classList.contains('checked');
    toggleCb($('#term-usage-cb'), isChecked);
    toggleCb($('#term-privacy-cb'), isChecked);
  });

  const updateTermAll = () => {
    const usage = $('#term-usage-cb').classList.contains('checked');
    const privacy = $('#term-privacy-cb').classList.contains('checked');
    toggleCb($('#term-all-cb'), usage && privacy);
  };

  $('#term-usage-row')?.addEventListener('click', () => {
    if (!state.legalDocumentsReady) {
      showToast('서비스 이용약관을 불러오지 못했습니다. 관리자페이지에서 활성 문서를 확인해주세요.');
      void loadActiveLegalDocuments();
      return;
    }
    toggleCb($('#term-usage-cb'));
    updateTermAll();
  });

  $('#term-privacy-row')?.addEventListener('click', () => {
    if (!state.legalDocumentsReady) {
      showToast('개인정보처리방침을 불러오지 못했습니다. 관리자페이지에서 활성 문서를 확인해주세요.');
      void loadActiveLegalDocuments();
      return;
    }
    toggleCb($('#term-privacy-cb'));
    updateTermAll();
  });

  // Keep Login checkbox binding on login screen
  if (isNativeApp() || localStorage.getItem('eatspay.keepLogin') === '1') {
    $('#keep-login-cb')?.classList.add('checked');
  }
  $('#keep-login-row')?.addEventListener('click', () => {
    if (isNativeApp()) {
      $('#keep-login-cb')?.classList.add('checked');
      showToast('앱에서는 푸시 알림 유지를 위해 로그인 유지가 기본 적용됩니다.');
      return;
    }
    toggleCb($('#keep-login-cb'));
  });

  $('#register-submit')?.addEventListener('click', async () => {
    if (!state.legalDocumentsReady) {
      showToast('서비스 이용약관과 개인정보처리방침을 불러온 뒤 가입할 수 있습니다.');
      void loadActiveLegalDocuments();
      return;
    }
    const usage = $('#term-usage-cb').classList.contains('checked');
    const privacy = $('#term-privacy-cb').classList.contains('checked');
    if (!usage || !privacy) {
      showToast('필수 약관에 모두 동의하셔야 합니다.');
      return;
    }

    const businessNumber = $('#reg-biz-no')?.value;
    const contactEmail = $('#reg-email')?.value?.trim() || '';
    const loginId = $('#reg-id')?.value?.trim() || '';
    const password = getPasswordValue('#reg-pw');
    const passwordConfirm = getPasswordValue('#reg-pw-confirm');
    const phone = $('#reg-phone')?.value;
    const storeName = $('#reg-store-name')?.value;
    const ceoName = $('#reg-ceo-name')?.value;
    const address = getRegisterFullAddress();
    const tel = '';
    const bizLicenseFile = getRegisterBizLicenseFile();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      showToast('연락받을 이메일을 올바르게 입력해 주세요.');
      return;
    }
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(loginId)) {
      showToast('로그인 ID를 올바르게 입력해 주세요.');
      return;
    }
    if (!password || password !== passwordConfirm) {
      showToast('비밀번호와 비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    if (!address) {
      showToast('사업장주소를 검색하거나 입력해 주세요.');
      return;
    }
    if (!bizLicenseFile) {
      showToast('사업자등록증 파일을 첨부해 주세요.');
      return;
    }
    const btn = $('#register-submit');
    btn.innerHTML = '<div class="spinner"></div>';
    btn.disabled = true;

    try {
      const formData = new FormData();
      formData.append('email', loginId || '');
      formData.append('loginId', loginId || '');
      formData.append('contactEmail', contactEmail || '');
      formData.append('password', password || '');
      formData.append('phone', phone || '');
      formData.append('storeName', storeName || '');
      formData.append('ceoName', ceoName || '');
      formData.append('address', address || '');
      formData.append('tel', tel || '');
      formData.append('businessNumber', businessNumber || '');
      const urlAgencyJoinCode = getAgencyJoinCodeFromUrl();
      const agencyInvite = getStoredAgencyInvite();
      if (urlAgencyJoinCode && !agencyInvite) {
        showToast('가입 링크 확인이 끝난 뒤 다시 시도해 주세요.');
        return;
      }
      if (agencyInvite?.joinCode) formData.append('agencyJoinCode', agencyInvite.joinCode);
      formData.append('bizLicenseFile', bizLicenseFile, getBizLicenseDisplayName(bizLicenseFile));

      const response = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(getFriendlyErrorMessage(err, '회원가입에 실패했습니다.'));
      }

      await playSignupCelebration();
      clearBizLicenseSelection();
      clearAgencyInviteSession();
      sessionStorage.removeItem(REGISTER_DRAFT_KEY);
      state.history = [];
      navigate('login');
    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
    } finally {
      btn.textContent = '가입하기';
      btn.disabled = false;
    }
  });

  // --------- FIND ID ---------
  const findIdPhone = $('#find-id-phone');
  findIdPhone?.addEventListener('input', function() {
    this.value = formatPhone(this.value);
  });

  async function sendFindSms(phone, btn, smsContainerSelector, smsInputSelector, smsTimerSelector) {
    const originalText = btn?.textContent || '인증번호 발송';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner" style="border-top-color:white;width:16px;height:16px;"></div>';
    }
    try {
      const response = await fetch(apiUrl('/api/auth/sms/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(getFriendlyErrorMessage(payload, '인증번호 발송에 실패했습니다.'));
      }
      const smsContainer = $(smsContainerSelector);
      const smsInput = $(smsInputSelector);
      if (smsContainer) smsContainer.style.display = 'block';
      if (smsInput) smsInput.value = '';
      startSmsCountdown($(smsTimerSelector));
      showToast('인증번호가 발송되었습니다.');
    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '인증번호 발송에 실패했습니다.'));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
  }

  async function verifyFindSms(phone, code) {
    const response = await fetch(apiUrl('/api/auth/sms/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      throw new Error(getFriendlyErrorMessage(payload, '인증번호가 일치하지 않습니다.'));
    }
    return payload;
  }

  $('#find-id-send-sms')?.addEventListener('click', async () => {
    const phone = findIdPhone?.value;
    if (!phone || phone.length < 10) {
      showToast('휴대번호를 올바르게 입력해주세요.');
      return;
    }
    await sendFindSms(phone, $('#find-id-send-sms'), '#find-id-sms-container', '#find-id-sms-input', '#find-id-sms-timer');
  });

  $('#find-id-submit')?.addEventListener('click', async () => {
    const phone = findIdPhone?.value;
    const sms = $('#find-id-sms-input')?.value;
    if (!phone || phone.length < 10) {
      showToast('휴대번호를 올바르게 입력해주세요.');
      return;
    }
    if (!sms || sms.length < 6) {
      showToast('인증번호 6자리를 올바르게 입력해주세요.');
      return;
    }
    const btn = $('#find-id-submit');
    const originalText = btn?.textContent || '아이디 찾기';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div>';
    }
    try {
      await verifyFindSms(phone, sms);
      const response = await fetch(apiUrl('/api/auth/find-id'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(getFriendlyErrorMessage(payload, '등록된 아이디를 찾지 못했습니다.'));
      }
      const ids = Array.isArray(payload.data?.loginIds) ? payload.data.loginIds.filter(Boolean) : [];
      showToast(ids.length ? `등록된 아이디는 ${ids.join(', ')} 입니다.` : '등록된 아이디를 찾지 못했습니다.');
      await showAppHtmlAlert(
        `<div style="line-height:1.7;font-weight:800;">${ids.map(escapeHtml).join('<br>') || '등록된 아이디가 없습니다.'}</div>`,
        '아이디 찾기'
      );
      state.history = [];
      navigate('login');
    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '아이디 찾기에 실패했습니다.'));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
  });

  // --------- FIND PW ---------
  const findPwPhone = $('#find-pw-phone');
  findPwPhone?.addEventListener('input', function() {
    this.value = formatPhone(this.value);
  });

  $('#find-pw-send-sms')?.addEventListener('click', async () => {
    const id = $('#find-pw-id')?.value;
    const phone = findPwPhone?.value;
    if (!id) { showToast('아이디를 입력해주세요.'); return; }
    if (!phone || phone.length < 10) { showToast('휴대번호를 입력해주세요.'); return; }
    await sendFindSms(phone, $('#find-pw-send-sms'), '#find-pw-sms-container', '#find-pw-sms-input', '#find-pw-sms-timer');
  });

  $('#find-pw-submit')?.addEventListener('click', async () => {
    const id = $('#find-pw-id')?.value;
    const phone = findPwPhone?.value;
    const sms = $('#find-pw-sms-input')?.value;
    const pw = getPasswordValue('#find-pw-new');
    const pw2 = getPasswordValue('#find-pw-new2');
    
    if (!id) { showToast('아이디를 입력해주세요.'); return; }
    if (!phone) { showToast('휴대번호를 입력해주세요.'); return; }
    if (!sms || sms.length < 6) {
      showToast('인증번호 6자리를 올바르게 입력해주세요.');
      return;
    }
    if (!pw) { showToast('새 비밀번호를 입력해주세요.'); return; }
    if (pw !== pw2) { showToast('비밀번호가 일치하지 않습니다.'); return; }
    
    const btn = $('#find-pw-submit');
    const originalText = btn?.textContent || '비밀번호 재설정';
    if (btn) {
      btn.innerHTML = '<div class="spinner"></div>';
      btn.disabled = true;
    }
    try {
      await verifyFindSms(phone, sms);
      const response = await fetch(apiUrl('/api/auth/reset-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId: id, phone, password: pw })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(getFriendlyErrorMessage(payload, '비밀번호 재설정에 실패했습니다.'));
      }
      showToast('비밀번호가 안전하게 재설정되었습니다.');
      state.history = [];
      navigate('login');
    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '비밀번호 재설정에 실패했습니다.'));
    } finally {
      if (btn) {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }
  });

  // --------- CARD MANAGEMENT ---------
  // Navigations
  $('#my-card-manage-btn')?.addEventListener('click', () => navigate('card-list'));
  $('#btn-to-card-add')?.addEventListener('click', () => {
    cardEditDraft = null;
    sessionStorage.removeItem('selectedBenefitCardCompany');
    navigate('card-add');
  });
  $('#btn-open-hometax-card')?.addEventListener('click', () => {
    openAppBannerUrl('https://www.hometax.go.kr/');
  });

  // Card screen sub navs are covered by dynamic bindings

  // Card Type Toggles
  const btnPersonal = $('#btn-card-type-personal');
  const btnCorp = $('#btn-card-type-corp');
  const labelIdentity = $('#label-card-identity');
  const inputIdentity = $('#add-card-identity');

  btnPersonal?.addEventListener('click', () => {
    btnPersonal.classList.add('active');
    btnPersonal.style.borderColor = '#3a9430';
    btnPersonal.style.color = '#3a9430';
    btnCorp.classList.remove('active');
    btnCorp.style.borderColor = 'var(--border-color)';
    btnCorp.style.color = 'var(--text-secondary)';
    
    labelIdentity.textContent = '생년월일';
    inputIdentity.placeholder = '6자리(예:940403)';
  });

  btnCorp?.addEventListener('click', () => {
    btnCorp.classList.add('active');
    btnCorp.style.borderColor = '#3a9430';
    btnCorp.style.color = '#3a9430';
    btnPersonal.classList.remove('active');
    btnPersonal.style.borderColor = 'var(--border-color)';
    btnPersonal.style.color = 'var(--text-secondary)';
    
    labelIdentity.textContent = '법인등록번호 / 사업자번호';
    inputIdentity.placeholder = '10자리 또는 13자리 입력';
  });

  function inferCardCompanyFromNumber(value) {
    const digits = String(value || '').replace(/\D/g, '');
    const first2 = Number(digits.slice(0, 2));
    const first4 = Number(digits.slice(0, 4));
    const first6 = Number(digits.slice(0, 6));
    if (digits.length < 6) return '';
    if (/^(419803)/.test(digits)) return 'IBK기업은행';
    if (digits.startsWith('34') || digits.startsWith('37')) return '아멕스카드';
    if (/^(356316|356317|356901|404825|438676|457973|515594|524353|540926|552220|558526|625804)/.test(digits)) return '신한카드';
    if (/^(356416|356417|356418|404678|457047|464942|515954|516574|524144|540447|552070|558526)/.test(digits)) return '삼성카드';
    if (/^(356312|356415|356516|404681|457048|457973|515949|524242|540416|552576|558526)/.test(digits)) return '현대카드';
    if (/^(356311|356511|356912|404669|438676|457047|515936|524040|540926|552070|558526)/.test(digits)) return 'KB국민카드';
    if (/^(356315|356516|404668|457973|515937|524148|540447|552576|558526)/.test(digits)) return '롯데카드';
    if (/^(356910|404671|457047|515954|524335|540926|552220|558526)/.test(digits)) return '하나카드';
    if (/^(356901|404825|457973|515954|524353|540447|552070|558526)/.test(digits)) return '우리카드';
    if (/^(356912|404825|457973|515954|524242|540926|552576|558526|9410)/.test(digits)) return 'BC카드';
    if (/^(356317|404825|457047|515954|524353|540926|552220|558526)/.test(digits)) return 'NH농협카드';
    if (digits.startsWith('4')) return '비자카드';
    if ((first2 >= 51 && first2 <= 55) || (first4 >= 2221 && first4 <= 2720)) return '마스터카드';
    if (digits.startsWith('35')) return 'JCB카드';
    if (digits.startsWith('62')) return '은련카드';
    return '';
  }
  function formatCardNumberForInput(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 16);
    if ((digits.startsWith('34') || digits.startsWith('37')) && digits.length > 10) {
      return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)].filter(Boolean).join('-');
    }
    const formatted = [];
    for (let i = 0; i < digits.length; i += 4) formatted.push(digits.substring(i, i + 4));
    return formatted.join('-');
  }
  function syncInferredCardCompany() {
    if (!cardCompanySelect) return '';
    const inferred = inferCardCompanyFromNumber(cardNumInput?.value || '');
    cardCompanySelect.value = inferred;
    cardCompanySelect.dataset.inferred = inferred;
    return inferred;
  }
  function isSupportedCardNumberLength(value) {
    const len = String(value || '').replace(/\D/g, '').length;
    return len === 15 || len === 16;
  }

  function syncExpiryPlaceholderSelect(select) {
    if (!select) return;
    select.classList.toggle('placeholder-select', !select.value);
  }

  function bindExpiryPlaceholderSelects() {
    ['#add-card-month', '#add-card-year'].forEach(selector => {
      const select = $(selector);
      if (!select) return;
      syncExpiryPlaceholderSelect(select);
      if (select.dataset.placeholderBound === '1') return;
      select.dataset.placeholderBound = '1';
      select.addEventListener('change', () => syncExpiryPlaceholderSelect(select));
    });
  }

  // Card Number Auto Formatting (15~16 digits)
  const cardNumInput = $('#add-card-number');
  const cardCompanySelect = $('#add-card-company');
  const cardCompanyCustomWrap = $('#add-card-company-custom-wrap');
  const cardCompanyCustomInput = $('#add-card-company-custom');

  function syncCardCompanyCustomField() {
    if (cardCompanyCustomWrap) cardCompanyCustomWrap.style.display = 'none';
    if (cardCompanyCustomInput) cardCompanyCustomInput.value = '';
    syncInferredCardCompany();
  }

  cardNumInput?.addEventListener('input', function() {
    this.value = formatCardNumberForInput(this.value);
    syncInferredCardCompany();
  });

  cardCompanySelect?.addEventListener('change', syncCardCompanyCustomField);
  syncCardCompanyCustomField();
  bindExpiryPlaceholderSelects();

  [
    '#add-card-number',
    '#add-card-company',
    '#add-card-company-custom',
    '#add-card-pw',
    '#add-card-cvc',
    '#add-card-month',
    '#add-card-year',
    '#add-card-identity',
    '#add-card-payer-name',
    '#add-card-payer-email',
    '#add-card-payer-tel',
    '#add-card-alias'
  ].forEach(selector => {
    const input = $(selector);
    input?.addEventListener('input', () => clearFieldError(input));
    input?.addEventListener('change', () => clearFieldError(input));
  });

  // Add Card Submission
  $('#add-card-submit')?.addEventListener('click', async () => {
    const cardNum = $('#add-card-number')?.value;
    const cardCompany = inferCardCompanyFromNumber(cardNum) || $('#add-card-company')?.value || '';
    const cardPw = getPasswordValue('#add-card-pw');
    const cardCvc = getPasswordValue('#add-card-cvc');
    const month = $('#add-card-month')?.value;
    const year = $('#add-card-year')?.value;
    const identity = $('#add-card-identity')?.value;
    const payerName = $('#add-card-payer-name')?.value?.trim() || '';
    const payerEmail = $('#add-card-payer-email')?.value?.trim() || '';
    const payerTel = $('#add-card-payer-tel')?.value?.trim() || '';
    const alias = $('#add-card-alias')?.value || '카드';
    resetCardFieldErrors();

    if (cardEditDraft) {
      if (!alias.trim()) { showToast('카드 별칭을 입력해주세요.'); return; }
      const isAliasOnlyEdit = cardEditDraft.aliasOnly === true;
      const editCardDigits = isAliasOnlyEdit ? '' : String(cardNum || '').replace(/\D/g, '');
      const isReplacingCardNumber = !isAliasOnlyEdit && editCardDigits.length > 0;
      if (isReplacingCardNumber) {
        if (editCardDigits.length !== 15 && editCardDigits.length !== 16) { showToast('변경할 카드번호는 15자리 또는 16자리로 입력해주세요.'); return; }
        if (!cardPw || cardPw.length < 2) { showToast('비밀번호 앞 2자리를 입력해주세요.'); return; }
        if (!month || !year) { showToast('유효기간을 선택해주세요.'); return; }
        if (!identity) { showToast('본인확인 정보를 입력해주세요.'); return; }
      }
      const btn = $('#add-card-submit');
      btn.innerHTML = '<div class="spinner"></div>';
      btn.disabled = true;
      try {
        const response = await fetch(apiUrl(`/api/card/${encodeURIComponent(cardEditDraft.id)}`), {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            cardCompany,
            alias: alias.trim(),
            cardNumber: isReplacingCardNumber ? editCardDigits : '',
            cardPw: isReplacingCardNumber ? cardPw : '',
            expiryMonth: isReplacingCardNumber ? month : '',
            expiryYear: isReplacingCardNumber ? year : '',
            identity: isReplacingCardNumber ? identity : ''
          })
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(getFriendlyErrorMessage(err, '카드 수정에 실패했습니다.'));
        }
        cardEditDraft = null;
        showToast(isAliasOnlyEdit ? '카드별칭이 수정되었습니다.' : '카드 정보가 수정되었습니다.');
        navigate('card-list');
        await refreshCardList();
      } catch (err) {
        showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
      } finally {
        btn.textContent = '카드수정';
        btn.disabled = false;
      }
      return;
    }

    const invalidFields = [];
    if (!isSupportedCardNumberLength(cardNum)) invalidFields.push(['#add-card-number', '카드번호는 15자리 또는 16자리로 입력해주세요.']);
    if (!cardPw || cardPw.length < 2) invalidFields.push(['#add-card-pw', '비밀번호 앞 2자리를 입력해주세요.']);
    if (!cardCvc || cardCvc.length < 3) invalidFields.push(['#add-card-cvc', 'CVC 3자리 또는 4자리를 입력해주세요.']);
    if (!month) invalidFields.push(['#add-card-month', '유효기간 월을 선택해주세요.']);
    if (!year) invalidFields.push(['#add-card-year', '유효기간 연도를 선택해주세요.']);
    if (!identity) invalidFields.push(['#add-card-identity', '본인확인 정보를 입력해주세요.']);
    if (!payerName) invalidFields.push(['#add-card-payer-name', '카드 명의자 이름을 입력해주세요.']);
    if (!payerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) invalidFields.push(['#add-card-payer-email', '카드 명의자 이메일을 올바르게 입력해주세요.']);
    if (!payerTel || payerTel.replace(/\D/g, '').length < 10) invalidFields.push(['#add-card-payer-tel', '카드 명의자 연락처를 올바르게 입력해주세요.']);
    if (invalidFields.length) {
      invalidFields.forEach(([selector]) => markFieldError($(selector)));
      const first = $(invalidFields[0][0]);
      first?.focus?.();
      showToast(invalidFields[0][1]);
      return;
    }

    const btn = $('#add-card-submit');
    btn.innerHTML = '<div class="spinner"></div>';
    btn.disabled = true;

    try {
      const accessToken = sessionStorage.getItem('accessToken') || '';
      const response = await fetch(apiUrl('/api/card/register'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cardNumber: cardNum.replace(/-/g, ''),
          cardPw,
          cardCvc,
          expiryMonth: month,
          expiryYear: year,
          identity,
          payerName,
          payerEmail,
          payerTel,
          cardCompany,
          alias
        })
      });

      const resJson = await response.json();
      if (!response.ok || resJson?.success !== true) {
        throw new Error(getFriendlyErrorMessage(resJson, '카드가 등록되지 않았습니다. 카드정보를 다시 입력해 주세요.'));
      }
      showToast('카드가 등록되었습니다. 확인용 100원 결제는 바로 취소됩니다.');

      if (cardNumInput) cardNumInput.value = '';
      clearPasswordValue('#add-card-pw');
      clearPasswordValue('#add-card-cvc');
      if ($('#add-card-month')) {
        $('#add-card-month').value = '';
        syncExpiryPlaceholderSelect($('#add-card-month'));
      }
      if ($('#add-card-year')) {
        $('#add-card-year').value = '';
        syncExpiryPlaceholderSelect($('#add-card-year'));
      }
      if (inputIdentity) inputIdentity.value = '';
      if ($('#add-card-payer-name')) $('#add-card-payer-name').value = '';
      if ($('#add-card-payer-email')) $('#add-card-payer-email').value = '';
      if ($('#add-card-payer-tel')) $('#add-card-payer-tel').value = '';
      if ($('#add-card-company')) $('#add-card-company').value = '';
      if ($('#add-card-company-custom')) $('#add-card-company-custom').value = '';
      if ($('#add-card-company-custom-wrap')) $('#add-card-company-custom-wrap').style.display = 'none';
      if ($('#add-card-alias')) $('#add-card-alias').value = '';
      btn.textContent = '\uCE74\uB4DC\uB4F1\uB85D';
      const accounts = await fetchVaccountsFromDb();
      const approvedAccounts = accounts.filter(isApprovedVaccount);
      if (!approvedAccounts.length) {
        if (accounts.some(isPendingVaccount)) {
          await showAppAlert('가상계좌 승인 대기중입니다. 관리자 승인 후 결제를 진행할 수 있습니다.', '승인 대기중');
          navigate('card-list');
          await refreshCardList();
          return;
        }
        await showAppAlert('승인완료된 가상계좌가 없습니다. 계좌등록을 먼저 진행해주세요.', '가상계좌 등록 필요');
        navigate('vaccount-add');
      } else {
        navigate('card-list');
        await refreshCardList();
      }
    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '카드가 등록되지 않았습니다. 카드정보를 다시 입력해 주세요.'));
    } finally {
      btn.textContent = '\uCE74\uB4DC\uB4F1\uB85D';
      btn.disabled = false;
    }
  });
  // --------- PAYMENT HISTORY ---------
  // Helper to fetch and render history
  const fetchPaymentHistory = async () => {
    const historyContainer = $('#payment-items-container');
    if (!historyContainer) return;

    if (!isAuthenticated()) {
      showToast('로그인이 필요합니다.');
      navigate('login');
      return;
    }

    historyContainer.innerHTML = `
      <div style="display:flex; justify-content:center; align-items:center; padding:40px 0;">
        <div class="spinner" style="border-top-color: var(--green-primary); width:32px; height:32px;"></div>
      </div>
    `;

    try {
      syncPaymentHistoryDateRange();
      let startDate = $('#filter-start-date')?.value || todayYMD();
      let endDate = $('#filter-end-date')?.value || todayYMD();

      const accessToken = sessionStorage.getItem('accessToken') || '';
      const response = await fetch(apiUrl(`/api/payment/history?startDate=${startDate}&endDate=${endDate}&type=ALL&_=${Date.now()}`), {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('결제 내역을 불러오지 못했습니다.');
      }

      const data = await response.json();
      const items = data.data?.items || data.items || [];
      paymentHistoryCache = Array.isArray(items) ? items : [];

      if (items.length === 0) {
        historyContainer.innerHTML = `
          <div style="text-align:center; padding:40px 20px; color:#888; font-weight:700; font-size:14px;">
            조회된 결제 내역이 없습니다.
          </div>
        `;
        return;
      }

      historyContainer.innerHTML = items.map(item => {
        const dateStr = item.paymentDate || item.createdAt || item.date || '';
        const agencyName = item.agencyName || item.agency || item.title || '가맹점';
        const bankInfo = item.bankInfo || item.bank || item.account || item.method || '카드결제';
        const depositVal = item.amount || item.depositAmount || 0;
        const totalVal = item.totalAmount || item.payAmount || 0;
        const receiptId = item.transactionId || item.id || '';

        return `
          <div class="payment-card" data-receipt-id="${escapeHtml(receiptId)}" style="border: 1.5px solid var(--card-border); border-radius: var(--radius); padding: 16px; background: var(--bg-white); display: flex; flex-direction: column; gap: 6px; cursor:pointer; box-shadow: var(--card-shadow);">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light); padding-bottom: 8px; margin-bottom: 4px;">
              <span style="font-size: 13px; font-weight: 800; color: #333;">결제일 : ${escapeHtml(String(dateStr).replace('T', ' ').slice(0, 19))}</span>
            </div>
            <div style="font-size: 13px; font-weight: 700; color: #555;">${escapeHtml(agencyName)}</div>
            <div style="font-size: 13px; color: #777;">${escapeHtml(bankInfo)}</div>
            <div style="font-size: 13px; color: #555;">입금금액 <span style="font-weight: 800;">${Number(depositVal).toLocaleString('ko-KR')}원</span></div>
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 4px;">
              <span style="font-size: 14px; font-weight: 800; color: var(--green-dark);">결제액 ${Number(totalVal).toLocaleString('ko-KR')}원</span>
              <span style="font-size:11px; font-weight:900; color:#3a9430;">전표보기</span>
            </div>
          </div>
        `;
      }).join('');
      $$('.payment-card', historyContainer).forEach(card => {
        card.addEventListener('click', () => {
          const receiptId = card.getAttribute('data-receipt-id') || '';
          const item = paymentHistoryCache.find(row => String(row.transactionId || row.id || '') === receiptId);
          showPaymentReceipt(item);
        });
      });

    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
      historyContainer.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:#e53935; font-weight:700; font-size:14px;">
          데이터를 불러오지 못했습니다.
        </div>
      `;
    }
  };

  // Navigations
  $('#my-payment-history-btn')?.addEventListener('click', () => {
    syncPaymentHistoryDateRange(true);
    navigate('payment-history');
    if (isAuthenticated()) {
      fetchPaymentHistory();
    }
  });

  $('#account-status-refresh')?.addEventListener('click', async () => {
    const user = await refreshSessionUserProfile();
    syncLoggedInViews();
    await showUnreadNotifications();
    if (user && getApprovalState(user) === 'approved') {
      showToast('승인 완료되었습니다.');
      navigate('home');
    } else if (user && getApprovalState(user) === 'pending') {
      showToast('아직 승인 대기중입니다.');
      navigate('account-status');
    } else if (user && getApprovalState(user) === 'rejected') {
      showToast('승인이 반려되었습니다.');
      navigate('account-status');
    } else {
      showToast('상태를 확인할 수 없습니다.');
    }
  });

  $('#account-status-logout')?.addEventListener('click', () => {
    logoutAndGoToLogin();
  });

  $('#btn-tax-doc')?.addEventListener('click', async () => {
    if (!isAuthenticated()) {
      showToast('로그인이 필요합니다.');
      navigate('login');
      return;
    }
    try {
      syncPaymentHistoryDateRange();
      const startDate = $('#filter-start-date')?.value || todayYMD();
      const endDate = $('#filter-end-date')?.value || todayYMD();
      const response = await fetch(apiUrl(`/api/payment/history/export?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&type=ALL&_=${Date.now()}`), {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`
        }
      });
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(getFriendlyErrorMessage(err, '부가세 신고자료를 다운로드하지 못했습니다.'));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `이츠페이_부가세신고자료_${startDate}_${endDate}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('부가세 신고자료를 다운로드했습니다.');
    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '부가세 신고자료를 다운로드하지 못했습니다.'));
    }
  });

  $('#btn-date-search')?.addEventListener('click', () => {
    fetchPaymentHistory();
  });
  $('#payment-period-filter')?.addEventListener('click', event => {
    const btn = event.target.closest('.payment-period-chip');
    if (!btn) return;
    const months = Number(btn.dataset.months || 0);
    const days = Number(btn.dataset.days || 7);
    applyPaymentHistoryQuickRange(months ? { months } : { days });
    fetchPaymentHistory();
  });



  // --------- VIRTUAL ACCOUNT MANAGEMENT ---------
  // Navigations
  $('#my-vaccount-manage-btn')?.addEventListener('click', () => navigate('vaccount-list'));
  $('#btn-to-vaccount-add')?.addEventListener('click', () => navigate('vaccount-add'));
  $('#delivery-agency-search')?.addEventListener('input', renderDeliveryAgencyList);
  $('#delivery-agency-search-clear')?.addEventListener('click', () => {
    const input = $('#delivery-agency-search');
    if (!input) return;
    input.value = '';
    renderDeliveryAgencyList();
    input.focus();
  });

  // Virtual Account screen sub navs are covered by dynamic bindings

  document.addEventListener('click', event => {
    const btn = event.target.closest('.btn-delivery-agency');
    if (!btn) return;
    event.preventDefault();
    handleDeliveryAgencyButtonClick(btn);
  });
  syncVaccountAgencyButtons();
  syncVaccountPhotoPreview();

  $('#add-vaccount-number')?.addEventListener('input', function() {
    this.value = this.value.replace(/[^\d-]/g, '');
  });

  // Photo Upload Trigger
  $('#btn-vaccount-upload-photo')?.addEventListener('click', () => {
    openVaccountPhotoSheet();
  });

  $('#vaccount-photo-backdrop')?.addEventListener('click', closeVaccountPhotoSheet);
  $('#btn-vaccount-photo-cancel')?.addEventListener('click', closeVaccountPhotoSheet);
  $('#btn-vaccount-photo-camera')?.addEventListener('click', () => {
    closeVaccountPhotoSheet();
    $('#vaccount-photo-camera-input')?.click();
  });
  $('#btn-vaccount-photo-gallery')?.addEventListener('click', () => {
    closeVaccountPhotoSheet();
    $('#vaccount-photo-gallery-input')?.click();
  });
  $('#vaccount-photo-camera-input')?.addEventListener('change', function() {
    const file = this.files && this.files[0];
    handleVaccountPhotoSelection(file, 'camera');
    this.value = '';
  });
  $('#vaccount-photo-gallery-input')?.addEventListener('change', function() {
    const file = this.files && this.files[0];
    handleVaccountPhotoSelection(file, 'gallery');
    this.value = '';
  });

  // Add Virtual Account Submission
  $('#add-vaccount-submit')?.addEventListener('click', async () => {
    const bank = $('#add-vaccount-bank')?.value;
    const accountNum = $('#add-vaccount-number')?.value;
    const user = getSessionUser();

    if (!isAuthenticated() || !user) { showToast('로그인이 필요합니다.'); navigate('login'); return; }
    if (!bank) { showToast('은행을 선택해주세요.'); return; }
    if (!accountNum || accountNum.length < 8) { showToast('가상계좌번호를 올바르게 입력해주세요.'); return; }
    if (!selectedAgency) { showToast('배달대행사를 선택해주세요.'); return; }
    if (!vaccountPhotoState.file) {
      await showAppAlert('포스상의 가상계좌번호가 보이도록 사진을 등록해주세요.', '사진 등록 필요');
      $('#btn-vaccount-upload-photo')?.focus();
      return;
    }

    const btn = $('#add-vaccount-submit');
    btn.innerHTML = '<div class="spinner"></div>';
    btn.disabled = true;

    try {
      const accessToken = sessionStorage.getItem('accessToken') || '';
      const formData = new FormData();
      const franchiseName = user.franchiseName || user.storeName || user.name || '가맹점';
      formData.append('franchiseName', franchiseName);
      formData.append('businessNumber', currentUserBusinessNumber(user));
      formData.append('bankCode', bankCodeFromName(bank));
      formData.append('bankName', bank);
      formData.append('deliveryAgencyName', selectedAgency);
      formData.append('accountNo', accountNum);
      formData.append('representativeName', user.name || franchiseName);
      if (vaccountPhotoState.file) {
        formData.append('documentFile', vaccountPhotoState.file, vaccountPhotoState.name || 'account-proof.jpg');
      }

      const response = await fetch(apiUrl('/api/franchise/accounts'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        body: formData
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(getFriendlyErrorMessage(err, '가상계좌 등록요청에 실패했습니다.'));
      }

      const payload = await response.json().catch(() => null);
      const savedRequest = payload?.data || {};
      showToast('가상계좌 등록요청이 접수되었습니다.');

      const newAccountHtml = `
        <div style="border: 1.5px solid var(--card-border); border-radius: var(--radius); padding: 16px 20px; background: var(--bg-white); display: flex; justify-content: space-between; align-items: center; height: 110px; opacity: 0; transform: translateY(10px); transition: all 0.4s; position: relative; box-shadow: var(--card-shadow);">
          <!-- 가상계좌 정보 -->
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <span style="font-size: 11px; font-weight: 800; color: #888;">배달대행사 가상계좌정보</span>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 2px;">
              <span style="background: #e53935; color: white; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 3px; line-height: 1;">${selectedAgency}</span>
              <div style="display: flex; flex-direction: column; line-height: 1.35;">
                <span style="font-size: 14px; font-weight: 800; color: #333;">${bank}</span>
                <span style="font-size: 13px; font-weight: 700; color: #555; font-family: monospace;">${accountNum}</span>
                <span style="font-size: 12px; color: #777; font-weight: 700;">${escapeHtml(savedRequest.franchiseName || franchiseName)} / 승인대기</span>
              </div>
            </div>
          </div>
          <span style="border:1.5px solid #3a9430;color:#2e7d32;padding:3px 10px;border-radius:var(--radius);font-size:11px;font-weight:800;align-self:flex-end;">활성</span>
        </div>
      `;

      const container = $('#vaccount-items-container');
      if (container) {
        container.insertAdjacentHTML('afterbegin', newAccountHtml);
        const addedEl = container.firstElementChild;
        setTimeout(() => {
          addedEl.style.opacity = '1';
          addedEl.style.transform = 'translateY(0)';
        }, 50);
      }

      // Reset inputs
      if ($('#add-vaccount-bank')) $('#add-vaccount-bank').value = '';
      if ($('#add-vaccount-number')) $('#add-vaccount-number').value = '';
      clearVaccountPhotoSelection();

      navigate('vaccount-list');
      await refreshVaccountList();
    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
    } finally {
      btn.textContent = '계좌등록요청';
      btn.disabled = false;
    }
  });

  // --------- MEMBER INFO EDIT ---------
  // Navigations
  $('#my-edit-info-btn')?.addEventListener('click', () => navigate('edit-myinfo'));

  // Edit My Info screen sub navs are covered by dynamic bindings

  // Phone input formatting
  const editPhoneInput = $('#edit-myinfo-phone');
  editPhoneInput?.addEventListener('input', function() {
    this.value = formatPhone(this.value);
  });

  const editSmsInput = $('#edit-myinfo-sms-input');
  editSmsInput?.addEventListener('input', function() {
    this.value = this.value.replace(/[^0-9]/g, '').slice(0, 6);
  });

  function getNormalizedEditMyInfoPhone() {
    return String(editPhoneInput?.value || '').replace(/[^0-9]/g, '');
  }

  function isEditMyInfoPhoneChanged() {
    const currentPhone = resolveUserPhone(getSessionUser()).replace(/[^0-9]/g, '');
    const nextPhone = getNormalizedEditMyInfoPhone();
    return Boolean(nextPhone && nextPhone !== currentPhone);
  }

  async function verifyEditMyInfoPhoneCode() {
    const phone = editPhoneInput?.value || '';
    const code = editSmsInput?.value || '';
    if (!phone || phone.replace(/[^0-9]/g, '').length < 10) {
      showToast('휴대번호를 올바르게 입력해주세요.');
      return false;
    }
    if (!code || code.length < 6) {
      showToast('인증번호 6자리를 입력해주세요.');
      return false;
    }
    const response = await fetch(apiUrl('/api/auth/sms/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(getFriendlyErrorMessage(payload, '인증번호가 일치하지 않습니다.'));
    }
    state.smsVerificationPhone = String(payload.data?.phone || phone).replace(/[^0-9]/g, '');
    return true;
  }

  async function updateMyInfo(payload, successMessage) {
    if (!isAuthenticated()) {
      showToast('로그인이 필요합니다.');
      navigate('login');
      return false;
    }
    const accessToken = sessionStorage.getItem('accessToken') || '';
    const response = await fetch(apiUrl('/api/auth/me'), {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.code === 'INVALID_CURRENT_PASSWORD'
        ? '현재 비밀번호가 일치하지 않습니다.'
        : getFriendlyErrorMessage(err, '회원정보 변경에 실패했습니다.'));
    }
    const data = await response.json().catch(() => null);
    const user = data?.data?.user;
    if (user) {
      sessionStorage.setItem('userProfile', JSON.stringify(user));
    } else {
      await refreshSessionUserProfile();
    }
    syncLoggedInViews();
    showToast(successMessage);
    return true;
  }

  $('#edit-myinfo-send-sms')?.addEventListener('click', async () => {
    const btn = $('#edit-myinfo-send-sms');
    const phone = editPhoneInput?.value || '';
    if (!phone || phone.replace(/[^0-9]/g, '').length < 10) {
      showToast('휴대번호를 올바르게 입력해주세요.');
      return;
    }
    const prevText = btn?.textContent || '인증번호 발송';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div>';
    }
    try {
      const response = await fetch(apiUrl('/api/auth/sms/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(getFriendlyErrorMessage(payload, '인증번호 발송에 실패했습니다.'));
      }
      state.smsVerificationPhone = String(payload.data?.phone || phone).replace(/[^0-9]/g, '');
      if (editSmsInput) editSmsInput.value = '';
      startSmsCountdown($('#edit-myinfo-sms-timer'));
      showToast('인증번호가 발송되었습니다.');
    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '인증번호 발송에 실패했습니다.'));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevText;
      }
    }
  });

  // Submit phone change
  $('#btn-edit-myinfo-phone-submit')?.addEventListener('click', async () => {
    const phone = editPhoneInput?.value;
    if (!phone || phone.length < 10) {
      showToast('휴대번호를 올바르게 입력해주세요.');
      return;
    }
    if (!isEditMyInfoPhoneChanged()) {
      showToast('현재 등록된 휴대번호와 동일합니다.');
      return;
    }
    const btn = $('#btn-edit-myinfo-phone-submit');
    const prevText = btn?.textContent || '인증확인/변경';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '확인 중...';
    }
    try {
      await verifyEditMyInfoPhoneCode();
      await updateMyInfo({ phone }, '휴대번호가 성공적으로 변경되었습니다.');
      if (editSmsInput) editSmsInput.value = '';
      clearInterval(state.smsTimer);
      const timer = $('#edit-myinfo-sms-timer');
      if (timer) timer.style.display = 'none';
    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevText;
      }
    }
  });

  $('#edit-myinfo-submit')?.addEventListener('click', async () => {
    const phone = editPhoneInput?.value || undefined;
    const currentPassword = getPasswordValue('#edit-myinfo-current-pw');
    const newPassword = getPasswordValue('#edit-myinfo-new-pw');
    const confirmPassword = getPasswordValue('#edit-myinfo-new-pw-confirm');

    if (phone && phone.length < 10) {
      showToast('휴대번호를 올바르게 입력해주세요.');
      return;
    }
    if (newPassword || confirmPassword || currentPassword) {
      if (!currentPassword) { showToast('현재 비밀번호를 입력해주세요.'); return; }
      if (!newPassword) { showToast('새로운 비밀번호를 입력해주세요.'); return; }
      if (newPassword.length < 4) { showToast('비밀번호는 4자리 이상 입력해주세요.'); return; }
      if (newPassword !== confirmPassword) { showToast('새 비밀번호가 일치하지 않습니다.'); return; }
    }

    const btn = $('#edit-myinfo-submit');
    const prevText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = '수정 중...'; }
    try {
      const payload = {};
      if (phone && isEditMyInfoPhoneChanged()) {
        await verifyEditMyInfoPhoneCode();
        payload.phone = phone;
      }
      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }
      if (!Object.keys(payload).length) {
        showToast('변경할 정보를 입력해주세요.');
        return;
      }
      const ok = await updateMyInfo(payload, '회원정보가 수정되었습니다.');
      if (ok) {
        ['#edit-myinfo-current-pw','#edit-myinfo-new-pw','#edit-myinfo-new-pw-confirm'].forEach(clearPasswordValue);
      }
    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prevText || '회원정보 수정'; }
    }
  });

  // Member Withdrawal
  $('#btn-edit-myinfo-withdraw')?.addEventListener('click', async () => {
    if (await showAppConfirm('이츠페이를 정말로 탈퇴하시겠습니까?\n거래내역은 보존되며, 탈퇴 후에는 동일 계정으로 로그인할 수 없습니다.', '회원 탈퇴')) {
      try {
        const response = await fetch(apiUrl('/api/auth/withdraw'), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`,
            'Content-Type': 'application/json'
          }
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(getFriendlyErrorMessage(payload, '탈퇴 처리에 실패했습니다.'));
        }
        clearAllAuth();
        showToast('탈퇴 처리가 완료되었습니다. 이용해 주셔서 감사합니다.');
        setTimeout(() => {
          state.history = [];
          navigate('login');
        }, 1200);
      } catch (err) {
        showToast(getFriendlyErrorMessage(err, '탈퇴 처리에 실패했습니다.'));
      }
    }
  });

  // --------- CUSTOMER CENTER ---------
  $('#btn-cs-to-guide')?.addEventListener('click', () => navigate('cs-guide'));
  $('#btn-cs-to-promo')?.addEventListener('click', () => navigate('cs-promo'));
  $('#btn-cs-announcement')?.addEventListener('click', () => navigate('cs-notices'));
  $('#btn-cs-kakao')?.addEventListener('click', () => showToast('카카오톡 채널 추가 화면으로 연결됩니다.'));
  $('#btn-cs-faq')?.addEventListener('click', () => navigate('cs-faq'));
  $('#in-app-notification')?.addEventListener('click', () => {
    const banner = $('#in-app-notification');
    let payload = {};
    try {
      payload = JSON.parse(banner?.dataset.payload || '{}');
    } catch (_) {
      payload = {};
    }
    banner?.classList.remove('show');
    banner?.setAttribute('aria-hidden', 'true');
    void handlePushNavigation(payload);
  });
  $('#cs-faq-tabs')?.addEventListener('click', event => {
    const tab = event.target.closest('.cs-faq-tab');
    if (!tab) return;
    activeFaqCategory = tab.dataset.faqCategory || tab.textContent.trim();
    syncCsFaqActiveTab();
    renderCsFaqList(faqCache);
    requestAnimationFrame(syncCsFaqActiveTab);
  });
  $('#cs-faq-list')?.addEventListener('click', event => {
    const retry = event.target.closest('#cs-faq-retry');
    if (retry) {
      void fetchCsFaqs();
      return;
    }
    const question = event.target.closest('.cs-faq-question');
    if (!question) return;
    const item = question.closest('.cs-faq-item');
    if (!item) return;
    const wasOpen = item.classList.contains('open');
    $$('.cs-faq-item', $('#cs-faq-list')).forEach(el => el.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
  });
  $('#cs-notice-list')?.addEventListener('click', event => {
    const retry = event.target.closest('#cs-notice-retry');
    if (retry) {
      void fetchCsNotices();
      return;
    }
    const pageButton = event.target.closest('.cs-notice-page');
    if (pageButton) {
      noticePage = Number(pageButton.dataset.noticePage || '1') || 1;
      renderCsNotices(noticeCache);
      return;
    }
    const item = event.target.closest('.cs-notice-row');
    if (!item) return;
    showCsNoticeDetail(item.dataset.noticeId || '');
  });
  $('#cs-guide-list')?.addEventListener('click', event => {
    const retry = event.target.closest('#cs-guide-retry');
    if (retry) {
      void fetchCsGuides();
      return;
    }
    const item = event.target.closest('.cs-guide-card');
    if (!item) return;
    showCsGuideDetail(item.dataset.guideId || '');
  });

  // --------- DELIVERY AGENCY CHARGE ---------
  // Navigations to Charge screen
  $('#home-promo-btn')?.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent home login banner click
    navigate('charge');
  });
  $('#btn-menu-charge')?.addEventListener('click', () => navigate('charge'));

  // Card Option Selector Toggle
  const cardOptions = $$('.charge-card-option');
  cardOptions.forEach(opt => {
    opt.addEventListener('click', function() {
      cardOptions.forEach(o => {
        o.classList.remove('active');
        o.style.borderColor = 'var(--border-color)';
      });
      this.classList.add('active');
      this.style.borderColor = '#3a9430';
    });
  });

  // Virtual Account Option Selector Toggle
  const vaccountOptions = $$('.charge-vaccount-option');
  vaccountOptions.forEach(opt => {
    opt.addEventListener('click', function() {
      vaccountOptions.forEach(o => {
        o.classList.remove('active');
        o.style.borderColor = 'var(--border-color)';
      });
      this.classList.add('active');
      this.style.borderColor = '#3a9430';
    });
  });

  // Real-time fee calculator. Keep this in sync with /api/payment/charge.
  const depositInput = $('#charge-deposit-amount');
  const payInput = $('#charge-pay-amount');

  depositInput?.addEventListener('input', function() {
    let cleanVal = this.value.replace(/\D/g, '');
    if (!cleanVal) {
      this.value = '';
      payInput.value = '0';
      return;
    }
    const numVal = parseInt(cleanVal, 10);
    this.value = numVal.toLocaleString('ko-KR');

    const totalAmount = Math.round(numVal / CHARGE_DEPOSIT_RATE);
    const calculatedFee = totalAmount - numVal;
    payInput.value = totalAmount.toLocaleString('ko-KR');
  });

  function getChargePaymentDraft() {
    const depositVal = depositInput?.value;
    if (!depositVal || depositVal === '0') {
      showToast('입금할 금액을 입력해주세요.');
      return null;
    }

    const activeCard = $('.charge-card-option.active');
    const activeVaccount = $('.charge-vaccount-option.active');
    if (!activeCard) {
      showToast('결제할 신용카드를 선택해주세요.');
      return null;
    }
    if (!activeVaccount) {
      showToast('입금받을 가상계좌를 선택해주세요.');
      return null;
    }

    const cleanDeposit = depositVal.replace(/,/g, '');
    const amount = parseInt(cleanDeposit, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('입금할 금액을 입력해주세요.');
      return null;
    }

    const totalAmount = Math.round(amount / CHARGE_DEPOSIT_RATE);
    const calculatedFee = totalAmount - amount;
    const cardId = activeCard.getAttribute('data-card') || 'bc';
    const cardName = activeCard.querySelector('img')?.getAttribute('alt')?.trim() || '카드';
    const cardNumber = activeCard.querySelector('div[style*="monospace"]')?.textContent?.trim() || '';
    const installmentSelect = $('#charge-installment');
    const installmentValue = installmentSelect?.value || '0';
    const installment = installmentValue === '0' ? '일시불' : `${installmentValue}개월`;
    const agencyName = activeVaccount.getAttribute('data-agency') || '배달대행사';
    const accountId = activeVaccount.getAttribute('data-account-id') || '';
    const accountSource = activeVaccount.getAttribute('data-account-source') || 'account_request';
    const bankName = activeVaccount.getAttribute('data-bank') || '';
    const accountNumber = activeVaccount.getAttribute('data-account') || '';
    const accountHolder = activeVaccount.querySelector('div:last-child')?.textContent?.trim() || '';
    const bankInfo = `${bankName} ${accountNumber}`.trim() || '가상계좌';
    const accountTitle = [agencyName, bankName].filter(Boolean).join(' ') || '가상계좌';
    const cleanAccountNumber = String(accountNumber || '').replace(/[^\d]/g, '') || accountNumber;

    function formatChargeCardLabel(name, numberText) {
      const digits = String(numberText || '').replace(/\D/g, '');
      const last4 = digits.slice(-4);
      if (last4) return `${name} ****-${last4}`;
      return `${name} ${String(numberText || '').trim()}`.trim();
    }

    return {
      amount,
      calculatedFee,
      totalAmount,
      ownerLabel: getChargeOwnerLabel(),
      cardId,
      accountId,
      accountSource,
      cardLabel: formatChargeCardLabel(cardName, cardNumber),
      installment,
      agencyName,
      bankInfo,
      accountTitle,
      accountNumber: cleanAccountNumber,
      accountHolder
    };
  }

  function closeChargeConfirmSheet() {
    $('#charge-confirm-backdrop')?.classList.remove('show');
    $('#charge-confirm-backdrop')?.setAttribute('aria-hidden', 'true');
    $('#charge-confirm-sheet')?.classList.remove('show');
    pendingChargePaymentDraft = null;
  }

  function openChargeConfirmSheet() {
    const draft = getChargePaymentDraft();
    if (!draft) return;

    pendingChargePaymentDraft = draft;
    const summary = $('#charge-confirm-summary');
    if (summary) {
      summary.innerHTML = `
        <div class="charge-confirm-row">
          <span class="charge-confirm-label">가맹점</span>
          <span class="charge-confirm-value">${escapeHtml(draft.ownerLabel)}</span>
        </div>
        <div class="charge-confirm-row">
          <span class="charge-confirm-label">결제 카드</span>
          <span class="charge-confirm-value">${escapeHtml(draft.cardLabel)}</span>
        </div>
        <div class="charge-confirm-row">
          <span class="charge-confirm-label">할부</span>
          <span class="charge-confirm-value">${escapeHtml(draft.installment)}</span>
        </div>
        <div class="charge-confirm-row">
          <span class="charge-confirm-label">입금 계좌</span>
          <span class="charge-confirm-account">
            <strong>${escapeHtml(draft.accountTitle)}</strong>
            <em>${escapeHtml(draft.accountNumber || '')}</em>
          </span>
        </div>
        <div class="charge-confirm-row">
          <span class="charge-confirm-label">결제 금액</span>
          <span class="charge-confirm-value">${formatWon(draft.totalAmount)}</span>
        </div>
        <div class="charge-confirm-row">
          <span class="charge-confirm-label">입금 금액</span>
          <span class="charge-confirm-value positive">${formatWon(draft.amount)}</span>
        </div>
      `;
    }

    $('#charge-confirm-backdrop')?.classList.add('show');
    $('#charge-confirm-backdrop')?.setAttribute('aria-hidden', 'false');
    $('#charge-confirm-sheet')?.classList.add('show');
  }

  async function processChargePayment(draft) {
    const paymentDraft = draft || pendingChargePaymentDraft || getChargePaymentDraft();
    if (!paymentDraft) return;

    const btn = $('#btn-charge-confirm-pay');
    const originalHtml = btn?.innerHTML || '결제하기';
    if (btn) {
      btn.innerHTML = '<div class="spinner" style="border-top-color: white; width: 16px; height: 16px;"></div>';
      btn.disabled = true;
    }

    try {
      const paymentGateway = 'EATSPAY';

      const accessToken = getAuthToken();
      const response = await fetch(apiUrl('/api/payment/charge'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          amount: paymentDraft.amount,
          calculatedFee: paymentDraft.calculatedFee,
          totalAmount: paymentDraft.totalAmount,
          cardId: paymentDraft.cardId,
          accountId: paymentDraft.accountId,
          accountSource: paymentDraft.accountSource,
          installment: Number($('#charge-installment')?.value || 0),
          paymentGateway
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(getFriendlyErrorMessage(errData, '결제 처리에 실패했습니다.'));
      }

      showToast('결제가 성공적으로 완료되었습니다.');
      if (depositInput) depositInput.value = '';
      if (payInput) payInput.value = '0';

      const today = new Date();
      const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      const timeStr = String(today.getHours()).padStart(2, '0') + ':' + String(today.getMinutes()).padStart(2, '0');

      const newHistoryHtml = `
        <div class="payment-card" style="border: 1.5px solid var(--card-border); border-radius: var(--radius); padding: 16px; background: var(--bg-white); display: flex; flex-direction: column; gap: 6px; box-shadow: var(--card-shadow);">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light); padding-bottom: 8px; margin-bottom: 4px;">
            <span style="font-size: 13px; font-weight: 800; color: #333;">결제일 : ${dateStr} ${timeStr}</span>
          </div>
          <div style="font-size: 13px; font-weight: 700; color: #555;">${escapeHtml(paymentDraft.agencyName)}</div>
          <div style="font-size: 13px; color: #777;">${escapeHtml(paymentDraft.bankInfo)}</div>
          <div style="font-size: 13px; color: #555;">입금금액 <span style="font-weight: 800;">${paymentDraft.amount.toLocaleString('ko-KR')}원</span></div>
          <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 4px;">
            <span style="font-size: 14px; font-weight: 800; color: var(--green-dark);">결제액 ${paymentDraft.totalAmount.toLocaleString('ko-KR')}원</span>
          </div>
        </div>
      `;

      const historyContainer = $('#payment-items-container');
      if (historyContainer) {
        historyContainer.insertAdjacentHTML('afterbegin', newHistoryHtml);
      }

      closeChargeConfirmSheet();
      state.history = [];
      navigate('home');

    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
    } finally {
      if (btn) {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }
    }
  }

  // Submit charge payment after bottom-sheet confirmation.
  $('#charge-submit')?.addEventListener('click', openChargeConfirmSheet);
  $('#charge-confirm-backdrop')?.addEventListener('click', closeChargeConfirmSheet);
  $('#btn-charge-confirm-cancel')?.addEventListener('click', closeChargeConfirmSheet);
  $('#btn-charge-confirm-pay')?.addEventListener('click', () => processChargePayment(pendingChargePaymentDraft));

  // Removed Interactive Calendar Date Picker code block since separate input elements are now used.

});


