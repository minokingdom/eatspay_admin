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
function normalizeSelectedAgency(value) {
  const name = String(value || '').trim();
  return (!name || name === '직접입력' || name === 'more') ? '생각대로' : name;
}
let selectedAgency = normalizeSelectedAgency(sessionStorage.getItem('selectedDeliveryAgency'));
sessionStorage.setItem('selectedDeliveryAgency', selectedAgency);
let agencySettlementPage = 1;
let deliveryAgencyCache = [];
let installmentPolicyCache = [];
let installmentBannerIndex = 0;
let installmentBannerTimer = null;
let daumPostcodeScriptPromise = null;
let cardEditDraft = null;
let talkPostCache = [];
let talkImageFiles = [];
let selectedTalkPostId = null;
let selectedTalkChatId = null;
let talkChatPollTimer = null;

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

async function openAddressSearch(input) {
  if (!input) return;
  try {
    await loadDaumPostcodeScript();
    new window.daum.Postcode({
      oncomplete(data) {
        const road = data.roadAddress || '';
        const jibun = data.jibunAddress || '';
        const zonecode = data.zonecode ? `(${data.zonecode}) ` : '';
        input.value = `${zonecode}${road || jibun}`.trim();
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  INVALID_CARD_NUMBER: '카드번호를 다시 확인해 주세요.',
  GH_PAYMENTS_CARD_REGISTRATION_FAILED: '카드 등록을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  GH_PAYMENTS_BILLING_PAY_FAILED: '결제를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  ACCOUNT_NOT_FOUND: '가상계좌 정보를 찾을 수 없습니다.',
  ACCOUNT_LIMIT_EXCEEDED: '가맹점당 출금계좌는 최대 2개까지 등록할 수 있습니다.',
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
  const safeCards = Array.isArray(cards) ? cards : [];
  if (safeCards.length === 0) {
    selector.innerHTML = `
      <button type="button" id="charge-card-empty-add" style="grid-column: 1 / -1; border: 1.5px dashed var(--border-color); border-radius: var(--radius); padding: 18px 14px; background: var(--bg-white); color: #555; font-weight: 800; cursor: pointer;">
        등록된 카드가 없습니다. 카드등록으로 이동
      </button>
    `;
    $('#charge-card-empty-add', selector)?.addEventListener('click', () => navigate('card-add'));
    return;
  }
  selector.innerHTML = safeCards.map((card, index) => {
    const isPrimary = index === 0;
    const borderColor = isPrimary ? '#3a9430' : 'var(--border-color)';
    const label = card.cardCompany || card.cardName || card.alias || '\uCE74\uB4DC';
    const alias = String(card.alias || '').trim();
    const aliasLabel = alias && alias !== label && !['카드', 'Card', 'card'].includes(alias) ? alias : '';
    const masked = card.maskedNumber || '****-****-****-0000';
    return `
      <div class="charge-card-option${isPrimary ? ' active' : ''}" data-card="${escapeHtml(card.id)}" style="border: 1.5px solid ${borderColor}; border-radius: var(--radius); padding: 12px; background: var(--bg-white); cursor: pointer; display: flex; flex-direction: column; gap: 6px; box-shadow: 1px 1px 4px rgba(0,0,0,0.05); transition: border-color 0.2s;">
        <div style="display: flex; align-items: center; gap: 4px;">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isPrimary ? '#3a9430' : '#bbb'}; display: inline-block;"></span>
          <span style="font-size: 11px; font-weight: 800; color: #333;">${escapeHtml(label)}</span>
          ${aliasLabel ? `<span style="font-size: 10px; font-weight: 700; color: #777;">${escapeHtml(aliasLabel)}</span>` : ''}
        </div>
        <div style="font-size: 10px; font-family: monospace; color: #555; letter-spacing: 0.5px;">${escapeHtml(masked)}</div>
      </div>
    `;
  }).join('');

  const cardOptions = $$('.charge-card-option', selector);
  cardOptions.forEach(opt => {
    opt.addEventListener('click', function() {
      cardOptions.forEach(o => {
        o.classList.remove('active');
        o.style.borderColor = 'var(--border-color)';
        const dot = o.querySelector('span');
        if (dot) dot.style.background = '#bbb';
      });
      this.classList.add('active');
      this.style.borderColor = '#3a9430';
      const dot = this.querySelector('span');
      if (dot) dot.style.background = '#3a9430';
    });
  });
}

function renderChargeVaccounts(selector, accounts) {
  const approvedAccounts = (Array.isArray(accounts) ? accounts : []).filter(account => (
    account.status === 'APPROVED' || account.accountStatus === 'APPROVED' || account.statusLabel === '승인완료'
  ));

  if (approvedAccounts.length === 0) {
    selector.innerHTML = `
      <button type="button" id="charge-vaccount-empty-add" style="width: 100%; border: 1.5px dashed var(--border-color); border-radius: var(--radius); padding: 18px 14px; background: var(--bg-white); color: #555; font-weight: 800; cursor: pointer;">
        승인완료된 가상계좌가 없습니다. 계좌등록으로 이동
      </button>
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
      <div class="charge-vaccount-option${isPrimary ? ' active' : ''}" data-account-id="${escapeHtml(account.id)}" data-agency="${escapeHtml(agency)}" data-bank="${escapeHtml(bank)}" data-account="${escapeHtml(accountNo)}" style="border: 1.5px solid ${isPrimary ? '#3a9430' : 'var(--border-color)'}; border-radius: var(--radius); padding: 12px 16px; background: var(--bg-white); cursor: pointer; display: flex; align-items: center; gap: 12px; box-shadow: 1px 1px 4px rgba(0,0,0,0.05); transition: border-color 0.2s;">
        <div style="display: flex; align-items: center; justify-content: center; background: #fff; padding: 4px 6px; border: 1px solid #ddd; border-radius: 4px; width: 85px; min-height: 26px;">
          <span style="font-size: 11px; font-weight: 800; color: #e53935; letter-spacing: -0.5px;">${escapeHtml(agency)}</span>
        </div>
        <div style="display: flex; flex-direction: column; line-height: 1.35; flex: 1; min-width: 0;">
          <span style="font-size: 13px; font-weight: 800; color: #333;">${escapeHtml(bank)}</span>
          <span style="font-size: 12px; font-weight: 700; color: #555; font-family: monospace; word-break: break-all;">${escapeHtml(accountNo)}</span>
          <span style="font-size: 11px; color: #777; font-weight: 700;">${escapeHtml(holder)}</span>
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

function showCardEditDialog(card) {
  const backdrop = $('#app-dialog-backdrop');
  const dialog = $('#app-dialog');
  const titleEl = $('#app-dialog-title');
  const messageEl = $('#app-dialog-message');
  const confirmBtn = $('#app-dialog-confirm');
  const cancelBtn = $('#app-dialog-cancel');
  if (!backdrop || !dialog || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
    return Promise.resolve(null);
  }

  const display = normalizeCardDisplay(card);
  titleEl.textContent = '카드 정보 수정';
  messageEl.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;text-align:left;">
      <div style="font-size:12px;color:#666;font-weight:700;">카드번호는 보안을 위해 수정할 수 없습니다. 변경이 필요하면 삭제 후 다시 등록해주세요.</div>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:800;color:#333;">
        카드사
        <input id="card-edit-company" value="${escapeHtml(display.name)}" style="height:44px;border:1px solid var(--border-color);border-radius:6px;padding:0 12px;font-size:14px;font-weight:700;">
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:800;color:#333;">
        카드 별칭
        <input id="card-edit-alias" value="${escapeHtml(card.alias || display.name)}" style="height:44px;border:1px solid var(--border-color);border-radius:6px;padding:0 12px;font-size:14px;font-weight:700;">
      </label>
      <div style="font-family:monospace;font-size:12px;color:#666;">${escapeHtml(display.masked)}</div>
    </div>
  `;
  confirmBtn.textContent = '저장';
  cancelBtn.textContent = '취소';
  cancelBtn.style.display = '';
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
    const onConfirm = () => {
      const cardCompany = $('#card-edit-company')?.value?.trim() || '';
      const alias = $('#card-edit-alias')?.value?.trim() || '';
      if (!cardCompany || !alias) {
        const target = !cardCompany ? $('#card-edit-company') : $('#card-edit-alias');
        if (target) {
          target.style.borderColor = '#e53935';
          target.focus();
        }
        return;
      }
      close({ cardCompany, alias });
    };
    const onCancel = () => close(null);
    const onKeydown = event => {
      if (event.key === 'Escape') close(null);
      if (event.key === 'Enter') onConfirm();
    };
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeydown);
    setTimeout(() => $('#card-edit-company')?.focus(), 0);
  });
}

async function handleCardEdit(card) {
  cardEditDraft = { ...card };
  sessionStorage.removeItem('selectedBenefitCardCompany');
  navigate('card-add');
}

function renderCardList(cards) {
  const container = $('#card-items-container');
  if (!container) return;

  if (!Array.isArray(cards) || cards.length === 0) {
    container.innerHTML = '<div style="padding: 32px 16px; text-align: center; color: #777; font-size: 13px; font-weight: 700;">등록된 카드가 없습니다.</div>';
    return;
  }

  container.innerHTML = cards.map(card => {
    const display = normalizeCardDisplay(card);
    const cardName = escapeHtml(display.name);
    const alias = escapeHtml(card.alias || cardName);
    const masked = escapeHtml(display.masked);
    return `
      <div class="card-list-item" data-card-id="${escapeHtml(card.id)}" style="border: 1.5px solid var(--border-color); border-radius: var(--radius); padding: 16px; background: var(--bg-white); display: flex; justify-content: space-between; align-items: center; min-height: 110px;">
        <div style="width: 140px; height: 80px; border: 1px solid #ccc; border-radius: 6px; padding: 10px; display: flex; flex-direction: column; justify-content: space-between; background: #fafafa; box-shadow: 1px 1px 4px rgba(0,0,0,0.05);">
          <div style="display: flex; align-items: center; gap: 4px;">
            <span style="font-size: 11px; font-weight: 800; color: #333;">${cardName}</span>
          </div>
          <div style="font-size: 10px; font-family: monospace; color: #555; letter-spacing: 0.5px;">${masked}</div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 12px;">
          <span style="border: 1.5px solid #999; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 800; color: #555;">${alias}</span>
          <div style="display: flex; gap: 6px;">
            <button class="btn-card-edit" type="button" style="background: white; border: 1px solid var(--border-color); padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; color: var(--text-secondary); cursor: pointer;">수정</button>
            <button class="btn-card-delete" type="button" style="background: white; border: 1px solid var(--border-color); padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #e53935; cursor: pointer;">삭제</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  $$('.btn-card-edit', container).forEach((btn, index) => {
    btn.addEventListener('click', () => {
      const card = cards[index];
      if (card) void handleCardEdit(card);
    });
  });
  $$('.btn-card-delete', container).forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = btn.closest('.card-list-item');
      const cardId = item?.getAttribute('data-card-id');
      if (!cardId) return;
      if (!(await showAppConfirm('이 카드를 삭제하시겠습니까?', '카드 삭제'))) return;

      try {
        const response = await fetch(apiUrl(`/api/card/${encodeURIComponent(cardId)}`), {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}` }
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(getFriendlyErrorMessage(payload, '카드 삭제에 실패했습니다.'));
        }
        showToast('카드가 삭제되었습니다.');
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
    container.innerHTML = '<div style="padding: 32px 16px; text-align:center; color:#777; font-weight:700;">로그인이 필요합니다.</div>';
    return;
  }
  container.innerHTML = '<div style="padding: 32px 16px; text-align:center;"><div class="spinner" style="border-top-color: var(--green-primary); width: 28px; height: 28px; margin: 0 auto;"></div></div>';
  try {
    const response = await fetch(apiUrl('/api/card/list'), {
      headers: { 'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}` }
    });
    if (!response.ok) throw new Error('카드 목록을 불러오지 못했습니다.');
    const payload = await response.json();
    renderCardList(Array.isArray(payload.data) ? payload.data : []);
  } catch (err) {
    container.innerHTML = `<div style="padding: 32px 16px; text-align:center; color:#e53935; font-weight:700;">${escapeHtml(err.message)}</div>`;
  }
}

function renderVaccountList(accounts) {
  const container = $('#vaccount-items-container');
  if (!container) return;

  if (!Array.isArray(accounts) || accounts.length === 0) {
    container.innerHTML = '<div style="padding: 32px 16px; text-align: center; color: #777; font-size: 13px; font-weight: 700;">등록된 가상계좌 요청이 없습니다.</div>';
    return;
  }

  container.innerHTML = accounts.map(account => {
    const agency = escapeHtml(account.agencyName || '미등록');
    const bank = escapeHtml(account.bankName || '은행 미입력');
    const accountNo = escapeHtml(account.accountNo || '미입력');
    const holder = escapeHtml(account.accountHolder || account.franchiseName || getLoginDisplayName());
    const status = escapeHtml(account.statusLabel || '승인대기');
    return `
      <div class="vaccount-list-item" data-account-id="${escapeHtml(account.id)}" data-account-source="${escapeHtml(account.source || 'account_request')}" style="border: 1.5px solid var(--border-color); border-radius: var(--radius); padding: 16px 20px; background: var(--bg-white); display: flex; justify-content: space-between; align-items: center; min-height: 110px; position: relative;">
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <span style="font-size: 11px; font-weight: 800; color: #888;">배달대행사 가상계좌정보</span>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 2px;">
            <span style="background: #e53935; color: white; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 3px; line-height: 1;">${agency}</span>
            <div style="display: flex; flex-direction: column; line-height: 1.35;">
              <span style="font-size: 14px; font-weight: 800; color: #333;">${bank}</span>
              <span style="font-size: 13px; font-weight: 700; color: #555; font-family: monospace;">${accountNo}</span>
              <span style="font-size: 12px; color: #777; font-weight: 700;">${holder} / ${status}</span>
            </div>
          </div>
        </div>
        <button class="btn-vaccount-delete" type="button" style="background: #e53935; border: none; color: white; font-size: 12px; font-weight: 800; padding: 8px 16px; border-radius: 6px; cursor: pointer; align-self: flex-end;">삭제</button>
      </div>
    `;
  }).join('');

  $$('.btn-vaccount-delete', container).forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = btn.closest('.vaccount-list-item');
      const accountId = item?.getAttribute('data-account-id');
      const source = item?.getAttribute('data-account-source') || 'account_request';
      if (!accountId) return;
      if (!(await showAppConfirm('이 가상계좌를 삭제하시겠습니까?', '가상계좌 삭제'))) return;

      try {
        const response = await fetch(apiUrl(`/api/franchise/accounts/${encodeURIComponent(accountId)}?source=${encodeURIComponent(source)}`), {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}` }
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(getFriendlyErrorMessage(payload, '가상계좌 삭제에 실패했습니다.'));
        }
        showToast('가상계좌가 삭제되었습니다.');
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
    container.innerHTML = '<div style="padding: 32px 16px; text-align:center; color:#777; font-weight:700;">로그인이 필요합니다.</div>';
    return;
  }
  container.innerHTML = '<div style="padding: 32px 16px; text-align:center;"><div class="spinner" style="border-top-color: var(--green-primary); width: 28px; height: 28px; margin: 0 auto;"></div></div>';
  try {
    const response = await fetch(apiUrl('/api/franchise/accounts'), {
      headers: { 'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}` }
    });
    if (!response.ok) throw new Error('가상계좌 목록을 불러오지 못했습니다.');
    const payload = await response.json();
    renderVaccountList(Array.isArray(payload.data) ? payload.data : []);
  } catch (err) {
    container.innerHTML = `<div style="padding: 32px 16px; text-align:center; color:#e53935; font-weight:700;">${escapeHtml(err.message)}</div>`;
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

function isApprovedVaccount(account) {
  return (
    account.status === 'APPROVED' || account.accountStatus === 'APPROVED' || account.statusLabel === '승인완료'
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

  const accessToken = sessionStorage.getItem('accessToken') || '';
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
    return cards;
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
    return accounts.filter(account => (
      account.status === 'APPROVED' || account.accountStatus === 'APPROVED' || account.statusLabel === '승인완료'
    ));
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
    await showAppAlert('등록된 카드가 없습니다. 카드등록을 먼저 진행해주세요.', '카드 등록 필요');
    if (state.currentScreen === 'charge') navigate('card-add');
    return;
  }

  if (!approvedAccounts.length) {
    const accounts = await fetchVaccountsFromDb();
    if (accounts.some(isPendingVaccount)) {
      await showAppAlert('가상계좌 승인 대기중입니다. 관리자 승인 후 결제를 진행할 수 있습니다.', '승인 대기중');
      return;
    }
    await showAppAlert('승인완료된 가상계좌가 없습니다. 계좌등록을 먼저 진행해주세요.', '가상계좌 등록 필요');
    if (state.currentScreen === 'charge') navigate('vaccount-add');
  }
}

function apiUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
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
  const name = String(item.cardCompany || '카드').replace(/\s+/g, '');
  if (logoWrap) {
    logoWrap.innerHTML = `<div style="border:1px solid #1554a8;background:#fff;padding:5px 8px;border-radius:6px;font-size:10px;font-weight:900;color:#1554a8;font-family:sans-serif;line-height:1;white-space:nowrap;">${escapeHtml(name)}</div>`;
  }
  if (bannerName) {
    bannerName.textContent = `${item.cardCompany} 최대 ${maxMonth}개월 무이자`;
  }
  if (bannerSubtitle) {
    bannerSubtitle.textContent = '배달대행비 카드결제 혜택';
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
    return `
      <div style="position:relative; overflow:hidden; border:1.5px solid #c5e6cb; border-radius:var(--radius); background:linear-gradient(135deg,#ffffff 0%,#f5fff6 100%); padding:16px; box-shadow:0 2px 8px rgba(16,80,24,.06);">
        <div style="position:absolute; inset:-70% auto auto -40%; width:50%; height:220%; background:linear-gradient(110deg, transparent 15%, rgba(255,255,255,.8) 50%, transparent 82%); transform:rotate(18deg); animation:eatspay-shine 3.6s ease-in-out infinite; pointer-events:none;"></div>
        <button type="button" class="btn-benefit-card-select" data-card-company="${escapeHtml(company)}" style="position:absolute; top:14px; right:14px; z-index:2; border:none; background:var(--green-primary); color:white; border-radius:var(--radius-sm); padding:9px 12px; font-size:12px; font-weight:900; cursor:pointer;">선택</button>
        <div style="position:relative; padding-right:62px;">
          <div style="min-width:0;">
            <div style="display:inline-flex; border:1px solid ${chipColor}; color:${chipColor}; background:#fff; border-radius:5px; padding:4px 7px; font-size:10px; font-weight:900; margin-bottom:10px;">${escapeHtml(company)}</div>
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
    return `
      <div style="padding: 14px 0; border-bottom: ${border}; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="display:flex; flex-direction:column; gap:4px; min-width:0;">
          <span style="font-size:14px; font-weight:900; color:var(--text-primary);">${escapeHtml(item.cardCompany)}</span>
          <span style="font-size:11px; font-weight:700; color:var(--text-secondary);">가능 개월: ${months.map(month => `${month}개월`).join(' · ')}</span>
        </div>
        <span style="font-size:13px; font-weight:900; color:var(--green-dark); flex-shrink:0;">최대 ${maxMonth}개월</span>
      </div>
    `;
  }).join('');
}

function applySelectedBenefitCardToForm() {
  const selectedCompany = sessionStorage.getItem('selectedBenefitCardCompany') || '';
  const select = $('#add-card-company');
  const customWrap = $('#add-card-company-custom-wrap');
  const customInput = $('#add-card-company-custom');
  if (!select) return;
  if (!selectedCompany) {
    select.value = '';
    if (customWrap) customWrap.style.display = 'none';
    if (customInput) customInput.value = '';
    return;
  }

  const option = [...select.options].find(item => item.value === selectedCompany || item.textContent.trim() === selectedCompany);
  if (option) {
    select.value = option.value;
    if (customWrap) customWrap.style.display = 'none';
    if (customInput) customInput.value = '';
  } else {
    select.selectedIndex = select.options.length - 1;
    if (customWrap) customWrap.style.display = 'block';
    if (customInput) customInput.value = selectedCompany;
  }
  sessionStorage.removeItem('selectedBenefitCardCompany');
}

function setCardCompanyFormValue(company) {
  const select = $('#add-card-company');
  const customWrap = $('#add-card-company-custom-wrap');
  const customInput = $('#add-card-company-custom');
  const value = String(company || '').trim();
  if (!select) return;
  if (!value) {
    select.value = '';
    if (customWrap) customWrap.style.display = 'none';
    if (customInput) customInput.value = '';
    return;
  }
  const option = [...select.options].find(item => item.value === value || item.textContent.trim() === value);
  if (option) {
    select.value = option.value;
    if (customWrap) customWrap.style.display = 'none';
    if (customInput) customInput.value = '';
  } else {
    select.selectedIndex = select.options.length - 1;
    if (customWrap) customWrap.style.display = 'block';
    if (customInput) customInput.value = value;
  }
}

function resetCardFormForAdd() {
  const screen = $('#screen-card-add');
  const title = screen?.querySelector('.auth-headline');
  const submit = $('#add-card-submit');
  const cardNumber = $('#add-card-number');
  const pw = $('#add-card-pw');
  const month = $('#add-card-month');
  const year = $('#add-card-year');
  const identity = $('#add-card-identity');
  const alias = $('#add-card-alias');
  if (title) title.textContent = '카드 정보를 입력해주세요';
  if (submit) submit.textContent = '카드등록';
  [cardNumber, pw, month, year, identity].forEach(input => {
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
  if (month) month.value = '';
  if (year) year.value = '';
  if (identity) identity.value = '';
  if (alias) alias.value = '';
}

function applyCardEditDraftToForm() {
  if (!cardEditDraft) {
    resetCardFormForAdd();
    applySelectedBenefitCardToForm();
    return;
  }

  const screen = $('#screen-card-add');
  const title = screen?.querySelector('.auth-headline');
  const submit = $('#add-card-submit');
  const cardNumber = $('#add-card-number');
  const pw = $('#add-card-pw');
  const month = $('#add-card-month');
  const year = $('#add-card-year');
  const identity = $('#add-card-identity');
  const alias = $('#add-card-alias');
  const display = normalizeCardDisplay(cardEditDraft);

  if (title) title.textContent = '카드 정보를 수정해주세요';
  if (submit) submit.textContent = '카드수정';
  if (cardNumber) {
    cardNumber.value = '';
    cardNumber.placeholder = `현재 ${display.masked} · 변경 시 전체 카드번호 입력`;
  }
  setCardCompanyFormValue(display.name);
  if (alias) alias.value = cardEditDraft.alias || display.name;
  [cardNumber, pw, month, year, identity].forEach(input => {
    if (!input) return;
    input.disabled = false;
    input.style.background = '';
    input.style.color = '';
  });
  clearPasswordValue('#add-card-pw');
  if (month) month.value = '';
  if (year) year.value = '';
  if (identity) identity.value = '';
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

function bankCodeFromName(bankName) {
  const bankCodes = {
    '기업은행': '003',
    '국민은행': '004',
    '농협은행': '011',
    '우리은행': '020',
    '하나은행': '081',
    '신한은행': '088'
  };
  return bankCodes[bankName] || '020';
}

function currentUserBusinessNumber(user) {
  const digits = String(user?.businessNumber || '').replace(/[^0-9]/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
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

function clearVaccountPhotoSelection() {
  if (vaccountPhotoState.url) {
    URL.revokeObjectURL(vaccountPhotoState.url);
  }
  vaccountPhotoState = { name: '', url: '', source: '', file: null };
  syncVaccountPhotoPreview();
}

function openVaccountPhotoSheet() {
  $('#vaccount-photo-backdrop')?.classList.add('show');
  $('#vaccount-photo-sheet')?.classList.add('show');
}

function closeVaccountPhotoSheet() {
  $('#vaccount-photo-backdrop')?.classList.remove('show');
  $('#vaccount-photo-sheet')?.classList.remove('show');
}

function handleVaccountPhotoSelection(file, source) {
  if (!file) return;
  if (vaccountPhotoState.url) {
    URL.revokeObjectURL(vaccountPhotoState.url);
  }
  vaccountPhotoState = {
    name: file.name || '선택된 사진',
    url: URL.createObjectURL(file),
    source,
    file
  };
  syncVaccountPhotoPreview();
  closeVaccountPhotoSheet();
  showToast(source === 'camera' ? '카메라 사진이 선택되었습니다.' : '갤러리 사진이 선택되었습니다.');
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
    btn.textContent = '‹ 이전';
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

// --- Screen Navigation ---
function navigate(screenId, direction = 'forward') {
  const restrictedScreens = ['my', 'payment-history', 'card-list', 'card-add', 'vaccount-list', 'vaccount-add', 'edit-myinfo', 'charge', 'agency', 'talk-write', 'talk-chats', 'talk-chat'];
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
    } else if (approvalState !== 'approved') {
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
  if (screenId === 'charge') {
    void refreshChargePaymentOptions();
  }
  if (screenId === 'home') {
    renderCurrentInstallmentBanner();
    startInstallmentBannerRotation();
    void fetchTalkPosts(5);
  }
  if (screenId === 'talk') {
    renderTalkBoard(talkPostCache);
    void fetchTalkPosts(20);
  }
  if (screenId === 'talk-detail') {
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
    talkChatPollTimer = setInterval(fetchTalkMessages, 3000);
  } else {
    stopTalkChatPolling();
  }
  if (screenId === 'card-list') {
    void refreshCardList();
  }
  if (screenId === 'card-add') {
    applyCardEditDraftToForm();
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
  if (screenId === 'delivery-agency-list') {
    normalizeDeliveryAgencyListText();
    void loadDeliveryAgencyList();
  }
  if (screenId === 'benefit-cards') {
    renderBenefitCardList();
  }
  if (screenId === 'agency') {
    syncAgencyDateRange();
    void fetchAgencySettlement();
  }
  if (screenId === 'cs-promo') {
    renderCsInstallmentList();
    void loadInstallmentBanner();
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
  const isHome = ['home', 'charge', 'benefit-cards', 'talk', 'talk-detail', 'talk-write', 'talk-chats', 'talk-chat'].includes(screenId);
  const isAgencyFlow = ['agency'].includes(screenId);
  const isMyFlow = ['my', 'find-id', 'find-pw', 'card-list', 'card-add', 'payment-history', 'vaccount-list', 'vaccount-add', 'delivery-agency-list', 'edit-myinfo', 'login'].includes(screenId);
  const isCsFlow = ['cs-main', 'cs-guide', 'cs-promo'].includes(screenId);
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

function bottomNavSvg(type) {
  const icons = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9.5L12 3l9 6.5V21a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 22V12h6v10"/></svg>',
    agency: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V8l8-4 8 4v12"/><path d="M8 20v-6h8v6"/><path d="M9 9h.01M15 9h.01"/></svg>',
    my: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    cs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>'
  };
  return icons[type] || '';
}

function renderBottomNavs(activeScreen = state.currentScreen) {
  const user = getSessionUser();
  const items = [{ id: 'home', label: '홈' }];
  if (isAgencyAccount(user)) items.push({ id: 'agency', label: '대리점' });
  if (isAuthenticated() && user) items.push({ id: 'my', label: '내정보' });
  items.push({ id: 'cs', label: '고객센터' });
  const active = activeScreen === 'agency'
    ? 'agency'
    : ['cs-main', 'cs-guide', 'cs-promo'].includes(activeScreen)
      ? 'cs'
      : ['my', 'find-id', 'find-pw', 'card-list', 'card-add', 'payment-history', 'vaccount-list', 'vaccount-add', 'delivery-agency-list', 'edit-myinfo', 'login'].includes(activeScreen)
        ? 'my'
        : 'home';
  const html = items.map(item => `
    <div class="nav-item${active === item.id ? ' active' : ''}" id="nav-${item.id}" data-nav-target="${item.id}">
      ${bottomNavSvg(item.id)}
      <span class="nav-label">${item.label}</span>
    </div>
  `).join('');
  $$('.bottom-nav').forEach(nav => {
    nav.innerHTML = html;
  });
}

let appDialogQueue = Promise.resolve();

function showToast(msg) {
  return showAppAlert(msg, '알림');
}

function showAppDialog({ title = '알림', message = '', confirmText = '확인', cancelText = '취소', showCancel = false } = {}) {
  appDialogQueue = appDialogQueue.then(() => openAppDialog({ title, message, confirmText, cancelText, showCancel }));
  return appDialogQueue;
}

function openAppDialog({ title = '알림', message = '', confirmText = '확인', cancelText = '취소', showCancel = false } = {}) {
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
  messageEl.textContent = message;
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
const showAppConfirm = (message, title = '확인') => showAppDialog({
  title,
  message,
  showCancel: true,
  confirmText: '확인',
  cancelText: '취소'
});

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
  if (keepLogin) keepLogin.classList.remove('checked');
}

function startInitialFlow() {
  clearTimeout(state.splashTimer);
  clearSessionAuth();
  resetLoginForm();
  syncLoggedInViews();
  state.splashTimer = setTimeout(() => {
    navigate('home');
  }, 2500);
}

function restoreFreshLaunch() {
  if (state.currentScreen !== 'splash') {
    resetAppToSplash();
    startInitialFlow();
  }
}

function formatPhone(val) {
  const cleaned = val.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{3})(\d{3,4})(\d{4})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return cleaned;
}

function getSessionUser() {
  try {
    return JSON.parse(sessionStorage.getItem('userProfile') || 'null');
  } catch (err) {
    return null;
  }
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

function isAuthenticated() {
  return Boolean(sessionStorage.getItem('accessToken'));
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
    bannerTitle.textContent = '무이자 할부 가능 카드 안내';
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
  clearSessionAuth();
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
      sessionStorage.setItem('userProfile', JSON.stringify(user));
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
        'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`
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
        'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`
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
  for (const item of notifications) {
    const id = item.id ? String(item.id) : '';
    if (id && sessionStorage.getItem(`notificationShown:${id}`) === '1') {
      await markNotificationsRead([id]);
      continue;
    }
    await showAppAlert(item.body || item.title || '새 알림이 있습니다.', item.title || '알림');
    if (id) sessionStorage.setItem(`notificationShown:${id}`, '1');
    await markNotificationsRead([item.id]);
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

function syncPaymentHistoryDateRange(forceToday = false) {
  const startInput = $('#filter-start-date');
  const endInput = $('#filter-end-date');
  if (!startInput || !endInput) return;

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

function normalizeTalkImage(url) {
  const value = String(url || '').trim();
  if (/^https?:\/\//i.test(value) || value.startsWith('/uploads/')) return value;
  return '';
}

function getTalkImages(post) {
  const images = Array.isArray(post?.imageUrls) ? post.imageUrls : [];
  const normalized = images.map(normalizeTalkImage).filter(Boolean);
  const fallback = normalizeTalkImage(post?.imageUrl);
  if (!normalized.length && fallback) normalized.push(fallback);
  return normalized.slice(0, 10);
}

function renderTalkHome(posts = talkPostCache) {
  const list = $('#home-talk-list');
  if (!list) return;
  const items = (Array.isArray(posts) ? posts : []).slice(0, 5);
  if (!items.length) {
    list.innerHTML = '<div style="padding: 12px 0 18px; color: var(--text-muted); font-size: 12px; font-weight: 700;">등록된 Talk 글이 없습니다.</div>';
    return;
  }
  list.innerHTML = items.map((post, index) => `
    <div class="talk-item" data-talk-id="${escapeHtml(post.id)}" style="padding: 10px 0; border-bottom: ${index === items.length - 1 ? 'none' : '1px solid var(--border-light)'}; cursor: pointer;">
      <div class="talk-title" style="font-size: 13px; font-weight: 800; color: var(--text-primary); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(post.title || '')}</div>
      <div class="talk-meta" style="font-size: 11px; color: var(--text-muted); font-weight: 700;">${escapeHtml(post.franchiseName || '이츠페이 가맹점')}</div>
    </div>
  `).join('');
}

function renderTalkBoard(posts = talkPostCache) {
  const list = $('#talk-board-list');
  if (!list) return;
  const items = Array.isArray(posts) ? posts : [];
  if (!items.length) {
    list.innerHTML = '<div style="border:1.5px solid var(--border-color); border-radius:var(--radius); padding:32px 16px; text-align:center; color:var(--text-muted); font-size:13px; font-weight:800;">등록된 Talk 글이 없습니다.</div>';
    return;
  }
  list.innerHTML = items.map(post => {
    const image = getTalkImages(post)[0] || '';
    return `
      <article class="talk-board-card" data-talk-id="${escapeHtml(post.id)}" style="display:flex; gap:12px; border-bottom:1px solid var(--border-light); padding:12px 0; cursor:pointer;">
        <div style="width:92px; height:92px; border-radius:12px; background:${image ? '#f5f5f5' : 'linear-gradient(135deg,#e8f5e9,#d9f2d4)'}; flex-shrink:0; overflow:hidden; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-light);">
          ${image ? `<img src="${escapeHtml(image)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : '<span style="font-size:28px;">🥕</span>'}
        </div>
        <div style="min-width:0; flex:1; display:flex; flex-direction:column; gap:4px;">
          <div style="font-size:15px; font-weight:900; color:var(--text-primary); line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(post.title || '')}</div>
          <div style="font-size:11px; color:var(--text-muted); font-weight:800;">${escapeHtml(post.franchiseName || '이츠페이 가맹점')} · ${escapeHtml(post.createdAtLabel || '')}</div>
          <div style="font-size:12px; color:var(--text-secondary); line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(post.body || '')}</div>
          <div style="font-size:14px; font-weight:900; color:var(--text-primary); margin-top:auto;">${Number(post.price || 0) > 0 ? formatWon(post.price) : '나눔'}</div>
        </div>
      </article>
    `;
  }).join('');
}

function renderTalkImagePreview() {
  const preview = $('#talk-image-preview');
  if (!preview) return;
  if (!talkImageFiles.length) {
    preview.innerHTML = '<div style="font-size:11px;color:var(--text-muted);font-weight:700;">선택된 이미지가 없습니다.</div>';
    return;
  }
  preview.innerHTML = talkImageFiles.map((file, index) => `
    <div style="position:relative;flex:0 0 auto;width:72px;height:72px;border-radius:10px;overflow:hidden;border:1px solid var(--border-light);background:#f5f5f5;">
      <img src="${escapeHtml(URL.createObjectURL(file))}" alt="" style="width:100%;height:100%;object-fit:cover;">
      <button type="button" class="talk-image-remove" data-index="${index}" style="position:absolute;top:4px;right:4px;width:20px;height:20px;border:none;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:12px;font-weight:900;">×</button>
    </div>
  `).join('');
}

function openTalkDetail(id) {
  selectedTalkPostId = String(id || '');
  renderTalkDetail();
  navigate('talk-detail');
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
  wrap.innerHTML = `
    <div style="display:flex;gap:8px;overflow-x:auto;margin:4px -24px 18px;padding:0 24px 4px;">
      ${images.length ? images.map(src => `<img src="${escapeHtml(src)}" alt="" style="width:260px;height:240px;object-fit:cover;border-radius:18px;border:1px solid var(--border-light);flex:0 0 auto;">`).join('') : '<div style="width:100%;height:190px;border-radius:18px;background:linear-gradient(135deg,#e8f5e9,#d9f2d4);display:flex;align-items:center;justify-content:center;font-size:42px;">🥕</div>'}
    </div>
    <div style="font-size:13px;color:var(--text-muted);font-weight:800;margin-bottom:6px;">${escapeHtml(post.franchiseName || '이츠페이 가맹점')} · ${escapeHtml(post.createdAtLabel || '')}</div>
    <h2 style="font-size:22px;line-height:1.35;font-weight:900;color:var(--text-primary);margin:0 0 8px;">${escapeHtml(post.title || '')}</h2>
    <div style="font-size:19px;font-weight:900;color:var(--text-primary);margin-bottom:18px;">${Number(post.price || 0) > 0 ? formatWon(post.price) : '나눔'}</div>
    <div style="white-space:pre-wrap;font-size:14px;line-height:1.65;color:var(--text-secondary);font-weight:700;border-top:1px solid var(--border-light);padding-top:18px;">${escapeHtml(post.body || '')}</div>
  `;
  $('#btn-talk-start-chat')?.addEventListener('click', () => startTalkChat(post.id));
}

async function fetchTalkPosts(limit = 20) {
  try {
    const response = await fetch(apiUrl(`/api/talk/posts?limit=${encodeURIComponent(limit)}&_=${Date.now()}`), { cache: 'no-store' });
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
        'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`
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
    await fetchTalkPosts(20);
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
  try {
    const response = await fetch(apiUrl(`/api/talk/posts/${encodeURIComponent(postId)}/chats`), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}` }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '채팅방을 열 수 없습니다.'));
    selectedTalkChatId = payload?.data?.id;
    navigate('talk-chat');
  } catch (err) {
    showToast(err.message || '채팅방을 열 수 없습니다.');
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
      headers: { 'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}` },
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => null);
    const chats = Array.isArray(payload?.data) ? payload.data : [];
    if (!chats.length) {
      list.innerHTML = '<div style="padding:28px 0;text-align:center;color:var(--text-muted);font-weight:800;">아직 Talk 채팅이 없습니다.</div>';
      return;
    }
    list.innerHTML = chats.map(chat => `
      <div class="talk-chat-row" data-chat-id="${escapeHtml(chat.id)}" style="padding:14px 0;border-bottom:1px solid var(--border-light);cursor:pointer;">
        <div style="font-size:15px;font-weight:900;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(chat.postTitle || 'Talk')}</div>
        <div style="font-size:12px;color:var(--text-muted);font-weight:800;margin-top:4px;">${escapeHtml(chat.lastMessage || '메시지가 없습니다.')}</div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = '<div style="padding:28px 0;text-align:center;color:var(--text-muted);font-weight:800;">채팅 목록을 불러오지 못했습니다.</div>';
  }
}

async function fetchTalkMessages() {
  if (!selectedTalkChatId) return;
  try {
    const response = await fetch(apiUrl(`/api/talk/chats/${encodeURIComponent(selectedTalkChatId)}/messages?_=${Date.now()}`), {
      headers: { 'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}` },
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error('채팅을 불러오지 못했습니다.');
    const chat = payload?.data?.chat || {};
    const messages = Array.isArray(payload?.data?.messages) ? payload.data.messages : [];
    const user = getSessionUser();
    $('#talk-chat-title') && ($('#talk-chat-title').textContent = chat.postTitle || 'Talk 채팅');
    const wrap = $('#talk-chat-messages');
    if (!wrap) return;
    wrap.innerHTML = messages.map(msg => {
      const mine = String(msg.senderUserId) === String(user?.id);
      return `
        <div style="display:flex;justify-content:${mine ? 'flex-end' : 'flex-start'};">
          <div style="max-width:78%;background:${mine ? 'var(--green-primary)' : '#f1f3f1'};color:${mine ? '#fff' : 'var(--text-primary)'};border-radius:16px;padding:10px 12px;font-size:14px;font-weight:700;line-height:1.45;white-space:pre-wrap;">${escapeHtml(msg.message || '')}</div>
        </div>
      `;
    }).join('') || '<div style="padding:28px 0;text-align:center;color:var(--text-muted);font-weight:800;">첫 메시지를 보내보세요.</div>';
  } catch (err) {
    showToast('채팅을 불러오지 못했습니다.');
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
        'Authorization': `Bearer ${sessionStorage.getItem('accessToken') || ''}`
      },
      body: JSON.stringify({ message })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getFriendlyErrorMessage(payload, '메시지 전송에 실패했습니다.'));
    if (input) input.value = '';
    await fetchTalkMessages();
  } catch (err) {
    showToast(err.message || '메시지 전송에 실패했습니다.');
  } finally {
    if (btn) btn.disabled = false;
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
  resetAppToSplash();
  startInitialFlow();
  loadInstallmentBanner();
  normalizeBackButtons();
  void fetchTalkPosts(5);

  // Hardware/Virtual Device back button history bindings
  window.history.replaceState({ screen: 'splash' }, '');
  window.addEventListener('popstate', (event) => {
    if (state.history.length > 0) {
      goBack();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      restoreFreshLaunch();
    }
  });

  document.addEventListener('resume', restoreFreshLaunch);
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      restoreFreshLaunch();
    }
  });

  // Global Back Buttons
  $$('.btn-back').forEach(btn => btn.addEventListener('click', goBack));

  // Bottom Nav & Home Banner Click Bindings
  document.addEventListener('click', event => {
    const navItem = event.target.closest('.bottom-nav .nav-item');
    if (!navItem) return;
    const target = navItem.dataset.navTarget || '';
    if (target) {
      event.preventDefault();
      if (target === 'home') navigate('home');
      else if (target === 'agency') navigate('agency');
      else if (target === 'my') navigate('my');
      else if (target === 'cs') navigate('cs-main');
      return;
    }
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
  $('#btn-talk-more')?.addEventListener('click', () => navigate('talk'));
  $('#btn-talk-write')?.addEventListener('click', () => navigate('talk-write'));
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
  $('#home-talk-list')?.addEventListener('click', event => {
    const item = event.target.closest('.talk-item');
    if (!item) return;
    openTalkDetail(item.getAttribute('data-talk-id'));
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
  $('#btn-talk-chat-send')?.addEventListener('click', sendTalkMessage);
  $('#talk-chat-input')?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void sendTalkMessage();
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
      const response = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: username, password })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(getFriendlyErrorMessage(errData, '로그인에 실패했습니다.'));
      }

      const resPayload = await response.json();
      if (resPayload.success && resPayload.data && resPayload.data.accessToken) {
        sessionStorage.setItem('accessToken', resPayload.data.accessToken);
        sessionStorage.setItem('userProfile', JSON.stringify(resPayload.data.user || null));
        syncLoggedInViews();
        const approvalState = getApprovalState(resPayload.data.user || null);
        if (approvalState === 'approved') {
          if (!isAgencyAccount(resPayload.data.user || null) && typeof fetchPaymentHistory === 'function') {
            fetchPaymentHistory();
          }
          navigate('home');
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

  const getPasswordValue = (inputId) => {
    const input = $(inputId);
    return input?.dataset.realPassword ?? input?.value ?? '';
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
    let realPassword = input.dataset.realPassword || '';
    let isVisible = false;

    const render = (cursor = realPassword.length) => {
      input.dataset.realPassword = realPassword;
      input.type = 'text';
      input.value = isVisible ? realPassword : '*'.repeat(realPassword.length);
      if (toggle) {
        toggle.textContent = isVisible ? '숨김' : '보기';
        toggle.setAttribute('aria-label', isVisible ? '비밀번호 숨기기' : '비밀번호 보기');
      }
      requestAnimationFrame(() => {
        const pos = Math.max(0, Math.min(cursor, input.value.length));
        input.setSelectionRange(pos, pos);
      });
    };

    input.addEventListener('beforeinput', (event) => {
      if (isVisible) return;
      event.preventDefault();
      const start = input.selectionStart ?? realPassword.length;
      const end = input.selectionEnd ?? start;
      let nextCursor = start;

      if (event.inputType === 'deleteContentBackward') {
        if (start === end && start > 0) {
          realPassword = realPassword.slice(0, start - 1) + realPassword.slice(end);
          nextCursor = start - 1;
        } else {
          realPassword = realPassword.slice(0, start) + realPassword.slice(end);
        }
      } else if (event.inputType === 'deleteContentForward') {
        realPassword = realPassword.slice(0, start) + realPassword.slice(start === end ? end + 1 : end);
      } else {
        let inserted = event.data || event.clipboardData?.getData('text') || '';
        if (digitsOnly) inserted = inserted.replace(/\D/g, '');
        if (maxLength > 0) inserted = inserted.slice(0, Math.max(0, maxLength - (realPassword.length - (end - start))));
        realPassword = realPassword.slice(0, start) + inserted + realPassword.slice(end);
        if (maxLength > 0) realPassword = realPassword.slice(0, maxLength);
        nextCursor = start + inserted.length;
      }

      render(nextCursor);
    });

    input.addEventListener('input', () => {
      if (!isVisible) return;
      realPassword = digitsOnly ? input.value.replace(/\D/g, '') : input.value;
      if (maxLength > 0) realPassword = realPassword.slice(0, maxLength);
      input.dataset.realPassword = realPassword;
      if (input.value !== realPassword) input.value = realPassword;
    });

    toggle?.addEventListener('click', () => {
      if (isVisible) realPassword = input.value;
      isVisible = !isVisible;
      render(realPassword.length);
      input.focus();
    });

    render(0);
  };

  bindMaskedPasswordInput('#login-pw', '#login-pw-toggle');
  bindMaskedPasswordInput('#reg-pw', '#reg-pw-toggle');
  bindMaskedPasswordInput('#add-card-pw', null, { maxLength: 2, digitsOnly: true });
  bindMaskedPasswordInput('#find-pw-new', null);
  bindMaskedPasswordInput('#find-pw-new2', null);
  bindMaskedPasswordInput('#edit-myinfo-current-pw', null);
  bindMaskedPasswordInput('#edit-myinfo-new-pw', null);
  bindMaskedPasswordInput('#edit-myinfo-new-pw-confirm', null);

  // --------- SOCIAL LOGINS ---------
  const handleSocialLogin = (btnId, name) => {
    const btn = $(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '<div class="spinner" style="border-top-color: var(--green-primary); width: 16px; height: 16px;"></div>';
      showToast(`${name} 간편 인증을 진행합니다.`);
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        showToast(`${name} 인증이 완료되었습니다.`);
        navigate('home');
        state.history = [];
      }, 1200);
    });
  };

  handleSocialLogin('#btn-naver', '네이버');
  handleSocialLogin('#btn-kakao', '카카오');
  handleSocialLogin('#btn-google', '구글');

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
  const phoneInput = $('#reg-phone');
  phoneInput?.addEventListener('input', function() {
    this.value = formatPhone(this.value);
  });

  $('#reg-send-sms')?.addEventListener('click', () => {
    const phone = $('#reg-phone')?.value;
    if (!phone || phone.length < 10) {
      showToast('휴대번호를 올바르게 입력해주세요.');
      return;
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    state.smsCode = code;
    showToast(`[이츠페이] 인증번호 [${code}]가 발송되었습니다.`);
    
    // Automatically autofill the input field and pop a browser alert so the user never misses the test code!
    const smsInput = $('#reg-sms-input');
    if (smsInput) smsInput.value = code;
    
    void showAppAlert(`인증번호가 발송되었습니다.\n인증번호: ${code}\n\n테스트를 위해 인증번호가 입력창에 자동으로 입력되었습니다.`, '이츠페이 테스트 안내');
  });

  // --------- REG STEP 3 ---------
  $('#reg-step2-next')?.addEventListener('click', () => {
    const id = $('#reg-id')?.value;
    const pw = getPasswordValue('#reg-pw');
    const phone = $('#reg-phone')?.value;
    const sms = $('#reg-sms-input')?.value;

    if (!id || !id.includes('@')) {
      showToast('올바른 이메일 형식의 아이디를 입력해주세요.');
      return;
    }
    if (!pw || pw.length < 4) {
      showToast('비밀번호를 4자리 이상 입력해주세요.');
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
    if (sms !== state.smsCode) {
      showToast('인증번호가 일치하지 않습니다.');
      return;
    }
    navigate('reg-step3');
  });

  const promptRegisterFileRequired = async ({ title, message, inputId }) => {
    await showAppAlert(message, title);
    const input = $(inputId);
    if (input) input.click();
  };

  $('#reg-step3-next')?.addEventListener('click', async () => {
    const storeName = $('#reg-store-name')?.value;
    const ceoName = $('#reg-ceo-name')?.value;
    const address = $('#reg-address')?.value;
    const tel = $('#reg-tel')?.value;
    const bizLicenseFile = $('#reg-biz-license-file')?.files?.[0];

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
    if (!tel) {
      showToast('전화번호를 입력해주세요.');
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
    openAddressSearch($('#reg-address'));
  });

  $('#reg-address')?.addEventListener('click', function() {
    if (this.hasAttribute('readonly')) {
      openAddressSearch(this);
    }
  });

  const bindRegisterFilePicker = (buttonId, inputId, emptyLabel) => {
    const button = $(buttonId);
    const input = $(inputId);
    if (!button || !input) return;
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) {
        button.textContent = emptyLabel;
        return;
      }
      button.textContent = file.name;
      button.style.background = '#f4fff4';
      button.style.color = '#1d7f28';
      showToast(`${file.name} 파일이 첨부되었습니다.`);
    });
  };

  bindRegisterFilePicker('#upload-biz-license', '#reg-biz-license-file', '사업자등록증을 업로드해주세요');

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
    toggleCb($('#term-usage-cb'));
    updateTermAll();
  });

  $('#term-privacy-row')?.addEventListener('click', () => {
    toggleCb($('#term-privacy-cb'));
    updateTermAll();
  });

  // Keep Login checkbox binding on login screen
  $('#keep-login-row')?.addEventListener('click', () => {
    toggleCb($('#keep-login-cb'));
  });

  $('#register-submit')?.addEventListener('click', async () => {
    const usage = $('#term-usage-cb').classList.contains('checked');
    const privacy = $('#term-privacy-cb').classList.contains('checked');
    if (!usage || !privacy) {
      showToast('필수 약관에 모두 동의하셔야 합니다.');
      return;
    }

    const businessNumber = $('#reg-biz-no')?.value;
    const email = $('#reg-id')?.value;
    const password = getPasswordValue('#reg-pw');
    const phone = $('#reg-phone')?.value;
    const storeName = $('#reg-store-name')?.value;
    const ceoName = $('#reg-ceo-name')?.value;
    const address = $('#reg-address')?.value;
    const tel = $('#reg-tel')?.value;
    const bizLicenseFile = $('#reg-biz-license-file')?.files?.[0];

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
      formData.append('email', email || '');
      formData.append('password', password || '');
      formData.append('phone', phone || '');
      formData.append('storeName', storeName || '');
      formData.append('ceoName', ceoName || '');
      formData.append('address', address || '');
      formData.append('tel', tel || '');
      formData.append('businessNumber', businessNumber || '');
      formData.append('bizLicenseFile', bizLicenseFile);

      const response = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(getFriendlyErrorMessage(err, '회원가입에 실패했습니다.'));
      }

      showToast('가입이 완료되었습니다.');
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

  $('#find-id-send-sms')?.addEventListener('click', () => {
    const phone = findIdPhone?.value;
    if (!phone || phone.length < 10) {
      showToast('휴대번호를 올바르게 입력해주세요.');
      return;
    }
    showToast('인증번호가 발송되었습니다.');
    $('#find-id-sms-container').style.display = 'block';
  });

  $('#find-id-submit')?.addEventListener('click', () => {
    const sms = $('#find-id-sms-input')?.value;
    if (!sms || sms.length < 6) {
      showToast('인증번호 6자리를 올바르게 입력해주세요.');
      return;
    }
    showToast('등록된 아이디는 eats***r 입니다.');
    setTimeout(() => {
      navigate('login');
    }, 2000);
  });

  // --------- FIND PW ---------
  const findPwPhone = $('#find-pw-phone');
  findPwPhone?.addEventListener('input', function() {
    this.value = formatPhone(this.value);
  });

  $('#find-pw-send-sms')?.addEventListener('click', () => {
    const id = $('#find-pw-id')?.value;
    const phone = findPwPhone?.value;
    if (!id) { showToast('아이디를 입력해주세요.'); return; }
    if (!phone || phone.length < 10) { showToast('휴대번호를 입력해주세요.'); return; }
    showToast('인증번호가 발송되었습니다.');
    $('#find-pw-sms-container').style.display = 'block';
  });

  $('#find-pw-submit')?.addEventListener('click', () => {
    const id = $('#find-pw-id')?.value;
    const phone = findPwPhone?.value;
    const sms = $('#find-pw-sms-input')?.value;
    const pw = getPasswordValue('#find-pw-new');
    const pw2 = getPasswordValue('#find-pw-new2');
    
    if (!id) { showToast('아이디를 입력해주세요.'); return; }
    if (!phone) { showToast('휴대번호를 입력해주세요.'); return; }
    if ($('#find-pw-sms-container').style.display !== 'none' && (!sms || sms.length < 6)) {
      showToast('인증번호를 입력해주세요.');
      return;
    }
    if (!pw) { showToast('새 비밀번호를 입력해주세요.'); return; }
    if (pw !== pw2) { showToast('비밀번호가 일치하지 않습니다.'); return; }
    
    const btn = $('#find-pw-submit');
    btn.innerHTML = '<div class="spinner"></div>';
    setTimeout(() => {
      btn.textContent = '비밀번호 재설정';
      showToast('비밀번호가 안전하게 재설정되었습니다.');
      state.history = [];
      navigate('login');
    }, 1500);
  });

  // --------- CARD MANAGEMENT ---------
  // Navigations
  $('#my-card-manage-btn')?.addEventListener('click', () => navigate('card-list'));
  $('#btn-to-card-add')?.addEventListener('click', () => {
    cardEditDraft = null;
    sessionStorage.removeItem('selectedBenefitCardCompany');
    navigate('card-add');
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

  // Card Number Auto Formatting (xxxx-xxxx-xxxx-xxxx)
  const cardNumInput = $('#add-card-number');
  const cardCompanySelect = $('#add-card-company');
  const cardCompanyCustomWrap = $('#add-card-company-custom-wrap');
  const cardCompanyCustomInput = $('#add-card-company-custom');

  function syncCardCompanyCustomField() {
    const isCustom = Boolean(cardCompanySelect && cardCompanySelect.selectedIndex === cardCompanySelect.options.length - 1);
    if (cardCompanyCustomWrap) cardCompanyCustomWrap.style.display = isCustom ? 'block' : 'none';
    if (cardCompanyCustomInput) {
      if (isCustom) {
        cardCompanyCustomInput.focus();
      } else {
        cardCompanyCustomInput.value = '';
      }
    }
  }

  cardNumInput?.addEventListener('input', function() {
    let val = this.value.replace(/\D/g, '');
    let formatted = [];
    for (let i = 0; i < val.length && i < 16; i += 4) {
      formatted.push(val.substring(i, i + 4));
    }
    this.value = formatted.join('-');
  });

  cardCompanySelect?.addEventListener('change', syncCardCompanyCustomField);
  syncCardCompanyCustomField();

  // Add Card Submission
  $('#add-card-submit')?.addEventListener('click', async () => {
    const cardNum = $('#add-card-number')?.value;
    const cardCompanyValue = $('#add-card-company')?.value;
    const cardCompanyCustom = $('#add-card-company-custom')?.value?.trim();
    const cardCompany = cardCompanySelect && cardCompanySelect.selectedIndex === cardCompanySelect.options.length - 1
      ? (cardCompanyCustom || '')
      : cardCompanyValue;
    const cardPw = getPasswordValue('#add-card-pw');
    const month = $('#add-card-month')?.value;
    const year = $('#add-card-year')?.value;
    const identity = $('#add-card-identity')?.value;
    const alias = $('#add-card-alias')?.value || '카드';

    if (cardEditDraft) {
      if (!cardCompany) { showToast(cardCompanySelect && cardCompanySelect.selectedIndex === cardCompanySelect.options.length - 1 ? '카드사명을 직접 입력해주세요.' : '카드사를 선택해주세요.'); return; }
      if (!alias.trim()) { showToast('카드 별칭을 입력해주세요.'); return; }
      const editCardDigits = String(cardNum || '').replace(/\D/g, '');
      const isReplacingCardNumber = editCardDigits.length > 0;
      if (isReplacingCardNumber) {
        if (editCardDigits.length !== 16) { showToast('변경할 카드번호 전체를 입력해주세요.'); return; }
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
        showToast('카드 정보가 수정되었습니다.');
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

    if (!cardNum || cardNum.length < 19) { showToast('카드번호 전체를 입력해주세요.'); return; }
    if (!cardCompany) { showToast(cardCompanySelect && cardCompanySelect.selectedIndex === cardCompanySelect.options.length - 1 ? '카드사명을 직접 입력해주세요.' : '카드사를 선택해주세요.'); return; }
    if (!cardPw || cardPw.length < 2) { showToast('비밀번호 앞 2자리를 입력해주세요.'); return; }
    if (!month || !year) { showToast('유효기간을 선택해주세요.'); return; }
    if (!identity) { showToast('본인확인 정보를 입력해주세요.'); return; }

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
          expiryMonth: month,
          expiryYear: year,
          identity,
          cardCompany,
          alias
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(getFriendlyErrorMessage(err, '카드 등록에 실패했습니다.'));
      }

      const resJson = await response.json();
      showToast('카드가 성공적으로 등록되었습니다.');

      if (cardNumInput) cardNumInput.value = '';
      clearPasswordValue('#add-card-pw');
      if ($('#add-card-month')) $('#add-card-month').value = '';
      if ($('#add-card-year')) $('#add-card-year').value = '';
      if (inputIdentity) inputIdentity.value = '';
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
      showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
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

        return `
          <div class="payment-card" style="border: 1.5px solid var(--border-color); border-radius: var(--radius); padding: 16px; background: var(--bg-white); display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light); padding-bottom: 8px; margin-bottom: 4px;">
              <span style="font-size: 13px; font-weight: 800; color: #333;">결제일 : ${escapeHtml(String(dateStr).replace('T', ' ').slice(0, 19))}</span>
            </div>
            <div style="font-size: 13px; font-weight: 700; color: #555;">${escapeHtml(agencyName)}</div>
            <div style="font-size: 13px; color: #777;">${escapeHtml(bankInfo)}</div>
            <div style="font-size: 13px; color: #555;">입금금액 <span style="font-weight: 800;">${Number(depositVal).toLocaleString('ko-KR')}원</span></div>
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 4px;">
              <span style="font-size: 14px; font-weight: 800; color: var(--green-dark);">결제액 ${Number(totalVal).toLocaleString('ko-KR')}원</span>
            </div>
          </div>
        `;
      }).join('');

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

  // Tax document and search mock actions
  $('#btn-tax-doc')?.addEventListener('click', () => {
    showToast('부가세 신고자료 다운로드가 시작됩니다.');
  });

  $('#btn-date-search')?.addEventListener('click', () => {
    showToast('검색 결과가 성공적으로 반영되었습니다.');
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
    try {
      const accounts = await fetchVaccountsFromDb();
      if (accounts.length >= 2) {
        await showAppAlert('가맹점당 출금계좌는 최대 2개까지 등록할 수 있습니다. 기존 계좌를 삭제한 뒤 다시 등록해 주세요.', '계좌 등록 제한');
        navigate('vaccount-list');
        return;
      }
    } catch (error) {
      console.warn('Failed to check account count before submit:', error);
    }
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
        <div style="border: 1.5px solid var(--border-color); border-radius: var(--radius); padding: 16px 20px; background: var(--bg-white); display: flex; justify-content: space-between; align-items: center; height: 110px; opacity: 0; transform: translateY(10px); transition: all 0.4s; position: relative;">
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
          <button class="btn-vaccount-delete" style="background: #e53935; border: none; color: white; font-size: 12px; font-weight: 800; padding: 8px 16px; border-radius: 6px; cursor: pointer; align-self: flex-end;">삭제</button>
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

        // Bind delete action to new element
        addedEl.querySelector('.btn-vaccount-delete')?.addEventListener('click', async function() {
          if (await showAppConfirm('이 가상계좌를 삭제하시겠습니까?', '가상계좌 삭제')) {
            addedEl.remove();
            showToast('가상계좌가 삭제되었습니다.');
          }
        });
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

  // Bind existing virtual accounts delete
  $$('.btn-vaccount-delete').forEach(btn => {
    btn.addEventListener('click', async function() {
      const card = this.closest('div[style*="border"]');
      if (await showAppConfirm('이 가상계좌를 삭제하시겠습니까?', '가상계좌 삭제')) {
        card.remove();
        showToast('가상계좌가 삭제되었습니다.');
      }
    });
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

  // Submit phone change
  $('#btn-edit-myinfo-phone-submit')?.addEventListener('click', async () => {
    const phone = editPhoneInput?.value;
    if (!phone || phone.length < 10) {
      showToast('휴대번호를 올바르게 입력해주세요.');
      return;
    }
    try {
      await updateMyInfo({ phone }, '휴대번호가 성공적으로 변경되었습니다.');
    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
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
      if (phone) payload.phone = phone;
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
    if (await showAppConfirm('이츠페이를 정말로 탈퇴하시겠습니까?\n탈퇴 시 모든 결제내역 및 카드 정보가 삭제됩니다.', '회원 탈퇴')) {
      showToast('탈퇴 처리가 완료되었습니다. 이용해 주셔서 감사합니다.');
      setTimeout(() => {
        state.history = [];
        navigate('login');
      }, 1500);
    }
  });

  // --------- CUSTOMER CENTER ---------
  $('#btn-cs-to-guide')?.addEventListener('click', () => navigate('cs-guide'));
  $('#btn-cs-to-promo')?.addEventListener('click', () => navigate('cs-promo'));
  $('#btn-cs-announcement')?.addEventListener('click', () => showToast('공지사항은 준비 중입니다.'));
  $('#btn-cs-kakao')?.addEventListener('click', () => showToast('카카오톡 채널 추가 화면으로 연결됩니다.'));
  $('#btn-cs-faq')?.addEventListener('click', () => showToast('자주 묻는 질문(FAQ) 화면으로 연결됩니다.'));

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

  // Real-time fee calculator (4.602% fee)
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

    // 4.602% fee calculation
    const calculatedPay = Math.round(numVal * 1.04602);
    payInput.value = calculatedPay.toLocaleString('ko-KR');
  });

  // Submit charge payment
  $('#charge-submit')?.addEventListener('click', async () => {
    const depositVal = depositInput?.value;
    if (!depositVal || depositVal === '0') {
      showToast('입금할 금액을 입력해주세요.');
      return;
    }

    const activeCard = $('.charge-card-option.active');
    const activeVaccount = $('.charge-vaccount-option.active');
    if (!activeCard) { showToast('결제할 신용카드를 선택해주세요.'); return; }
    if (!activeVaccount) { showToast('입금받을 가상계좌를 선택해주세요.'); return; }

    const btn = $('#charge-submit');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<div class="spinner" style="border-top-color: white; width: 16px; height: 16px;"></div>';
    btn.disabled = true;

    try {
      const cleanDeposit = depositVal.replace(/,/g, '');
      const amount = parseInt(cleanDeposit, 10);
      const calculatedFee = Math.floor(amount * 0.04602);
      const totalAmount = amount + calculatedFee;
      const cardId = activeCard.getAttribute('data-card') || 'bc';
      const paymentGateway = 'EATSPAY';

      const accessToken = sessionStorage.getItem('accessToken') || '';
      const response = await fetch(apiUrl('/api/payment/charge'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          amount,
          calculatedFee,
          totalAmount,
          cardId,
          paymentGateway
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(getFriendlyErrorMessage(errData, '결제 처리에 실패했습니다.'));
      }

      showToast('결제가 성공적으로 완료되어 충전되었습니다.');
      
      // Dynamic payment history insert
      const agencyName = activeVaccount.getAttribute('data-agency');
      
      const bankInfo = `${activeVaccount.getAttribute('data-bank') || ''} ${activeVaccount.getAttribute('data-account') || ''}`.trim() || '가상계좌';

      const today = new Date();
      const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      const timeStr = String(today.getHours()).padStart(2, '0') + ':' + String(today.getMinutes()).padStart(2, '0');

      const newHistoryHtml = `
        <div class="payment-card" style="border: 1.5px solid var(--border-color); border-radius: var(--radius); padding: 16px; background: var(--bg-white); display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light); padding-bottom: 8px; margin-bottom: 4px;">
            <span style="font-size: 13px; font-weight: 800; color: #333;">결제일 : ${dateStr} ${timeStr}</span>
          </div>
          <div style="font-size: 13px; font-weight: 700; color: #555;">${agencyName}</div>
          <div style="font-size: 13px; color: #777;">${bankInfo}</div>
          <div style="font-size: 13px; color: #555;">입금금액 <span style="font-weight: 800;">${amount.toLocaleString('ko-KR')}원</span></div>
          <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 4px;">
            <span style="font-size: 14px; font-weight: 800; color: var(--green-dark);">결제액 ${totalAmount.toLocaleString('ko-KR')}원</span>
          </div>
        </div>
      `;

      const historyContainer = $('#payment-items-container');
      if (historyContainer) {
        historyContainer.insertAdjacentHTML('afterbegin', newHistoryHtml);
      }

      state.history = [];
      navigate('home');

    } catch (err) {
      showToast(getFriendlyErrorMessage(err, '요청을 처리하지 못했습니다.'));
    } finally {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }
  });

  // Removed Interactive Calendar Date Picker code block since separate input elements are now used.

});
