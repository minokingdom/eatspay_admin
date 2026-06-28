(function () {
  const root = window.EatsAdminFranchiseListUtils || {};
  const INVALID_CARD_NAMES = new Set(['카드', '등록카드', '카드사 확인중', '확인중', '카드사확인중']);
  const FALLBACK_CARD_NAMES = ['신한카드', '삼성카드', 'KB국민카드', '현대카드', '우리카드', '롯데카드', '하나카드'];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function displayLineDate(line) {
    return String(line?.matchedPaymentDate || '').slice(0, 10);
  }

  function lineStack(lines, center = false) {
    const safeLines = (Array.isArray(lines) && lines.length ? lines : ['-']).map(line => line || '-');
    return `<div class="franchise-line-stack">${safeLines.map(line => `<div class="franchise-line ${center ? 'center' : ''}">${line}</div>`).join('')}</div>`;
  }

  function repeatedLines(value, count, center = false) {
    return lineStack(Array.from({ length: Math.max(1, Number(count) || 0) }, () => value || '-'), center);
  }

  function lineAccountKey(line, accountKeyFn) {
    const account = line?.accountEntry?.account || null;
    if (!account) return '__no_account__';
    return typeof accountKeyFn === 'function' ? accountKeyFn(account) : String(account.id || account.accountId || account.accountNo || '');
  }

  function dedupedAccountLines(displayLines, render, accountKeyFn) {
    const seen = new Set();
    return (Array.isArray(displayLines) ? displayLines : []).map((line, index) => {
      const key = lineAccountKey(line, accountKeyFn);
      if (seen.has(key)) return '<span class="franchise-line-blank"></span>';
      seen.add(key);
      return render(line, index);
    });
  }

  function cardPaymentClass(paymentDate = '') {
    return String(paymentDate || '').trim() ? 'franchise-card-paid' : 'franchise-card-unpaid';
  }

  function cardChipHtml(franchise = {}, card = {}, index = 0, paymentDate = '') {
    const rawName = String(card.cardCompany || card.cardName || card.alias || '').trim();
    const seed = Math.abs((Number(franchise.id) || 0) + Number(index || 0));
    const name = rawName && !INVALID_CARD_NAMES.has(rawName) ? rawName : FALLBACK_CARD_NAMES[seed % FALLBACK_CARD_NAMES.length];
    const rawLast = String(card.cardLast4 || card.maskedNumber || card.cardNumber || '').replace(/[^0-9]/g, '');
    const last = rawLast.slice(-4) || String((Number(franchise.id) || 1000) * 37 + Number(index || 0)).slice(-4).padStart(4, '0');
    return `<span class="bdg ${cardStatusClass(card)} ${cardPaymentClass(paymentDate)} franchise-card-chip"><span>${esc(name)}</span><span>${esc(last)}</span></span>`;
  }

  function cardAliasHtml(card = {}, paymentDate = '') {
    const alias = String(card.alias || card.cardAlias || '').trim();
    return alias ? `<span class="bdg ${cardStatusClass(card)} ${cardPaymentClass(paymentDate)}">${esc(alias)}</span>` : '<span class="franchise-muted-strong">-</span>';
  }

  function badgeClassForStatus(label) {
    const value = String(label || '').trim();
    if (['승인완료', '승인', '보이기', '정상승인', '정상 승인', '활성'].includes(value)) return 'bg';
    if (['승인대기', '승인 대기', '숨기기', '숨김', '비활성'].includes(value)) return 'by';
    if (['반려', '승인 거절', '삭제', '취소', '탈퇴'].includes(value)) return 'br';
    return 'bgr';
  }

  function accountStatusClass(account = {}, franchise = {}, context = {}) {
    return badgeClassForStatus(accountDisplayStatus(account, franchise, context));
  }

  function cardStatusClass(card = {}) {
    return badgeClassForStatus(card.hidden === true || card.active === false ? '숨기기' : '보이기');
  }

  function chipButton(label, action, variant = '') {
    const cls = `franchise-status-chip ${variant}`.trim();
    return `<button type="button" class="${esc(cls)}" data-chip-action="${esc(action || '')}">${esc(label)}</button>`;
  }

  function visibilityChip(label, type, franchiseId, targetId, hidden = true, variant = '') {
    const cls = `franchise-status-chip ${variant}`.trim();
    return `<button type="button" class="${esc(cls)}" data-admin-action="fr-visibility" data-fr-vis-type="${esc(type)}" data-fr-id="${esc(franchiseId)}" data-fr-target-id="${esc(targetId)}" data-fr-hidden="${hidden ? 'true' : 'false'}">${esc(label)}</button>`;
  }

  function accountActionChip(label, action, franchiseId, index, variant = '') {
    const cls = `franchise-status-chip ${variant}`.trim();
    return `<button type="button" class="${esc(cls)}" data-admin-action="fr-account-action" data-fr-action="${esc(action)}" data-fr-id="${esc(franchiseId)}" data-fr-account-idx="${Number(index)}">${esc(label)}</button>`;
  }

  function paymentDateForCard(franchise = {}, card = null, context = {}) {
    if (!card) return '';
    const normalize = typeof context.normalizeCardMatchName === 'function'
      ? context.normalizeCardMatchName
      : value => String(value || '').replace(/\s+/g, '').replace(/^KB/, '').replace(/^케이비/, '').replace(/카드$/, '').toLowerCase();
    const dateOnly = typeof context.dateOnly === 'function'
      ? context.dateOnly
      : value => String(value || '').slice(0, 10);
    const visibleCardItems = typeof context.visibleCardItems === 'function'
      ? context.visibleCardItems
      : () => [];
    const paymentName = typeof context.paymentFranchiseName === 'function'
      ? context.paymentFranchiseName
      : payment => payment?.franchiseName || payment?.merchantName || '';
    const cardLast = String(card.cardLast4 || card.maskedNumber || card.cardNumber || '').replace(/[^0-9]/g, '').slice(-4);
    if (!cardLast) return '';
    const cardName = normalize(card.cardCompany || card.cardName || card.alias || '');
    const payments = (Array.isArray(context.payments) ? context.payments : [])
      .filter(payment => String(payment.franchiseId || '') === String(franchise.id) || paymentName(payment) === franchise.name)
      .map(payment => ({
        date: dateOnly(payment.date || payment.createdAt || payment.paymentDate || ''),
        last: String(payment.cardLast4 || payment.maskedNumber || payment.cardNumber || '').replace(/[^0-9]/g, '').slice(-4),
        name: normalize(payment.cardCompany || payment.cardName || payment.cardAlias || '')
      }))
      .filter(payment => payment.date && payment.last === cardLast);
    if (!payments.length) return '';
    const exact = payments.filter(payment => payment.name && cardName && (payment.name === cardName || payment.name.includes(cardName) || cardName.includes(payment.name)));
    const cardSameLastCount = visibleCardItems(franchise)
      .filter(item => String(item.cardLast4 || item.maskedNumber || item.cardNumber || '').replace(/[^0-9]/g, '').slice(-4) === cardLast)
      .length;
    const candidates = exact.length ? exact : (cardSameLastCount === 1 ? payments : []);
    return candidates.map(payment => payment.date).sort().pop() || '';
  }

  function sortedDisplayLines(franchise = {}, context = {}) {
    const allCardItems = typeof context.cardItems === 'function'
      ? context.cardItems
      : () => [];
    const visibleAccountEntries = typeof context.visibleAccountEntries === 'function'
      ? context.visibleAccountEntries
      : () => [];
    const cards = allCardItems(franchise)
      .map((card, index) => ({
        card,
        index,
        matchedPaymentDate: paymentDateForCard(franchise, card, context)
      }))
      .sort((a, b) => {
        const aDate = String(a.matchedPaymentDate || '0000-00-00');
        const bDate = String(b.matchedPaymentDate || '0000-00-00');
        if (aDate !== bDate) return bDate.localeCompare(aDate);
        return a.index - b.index;
      });
    const accounts = visibleAccountEntries(franchise);
    const count = Math.max(1, cards.length, accounts.length);
    const lastCard = cards[cards.length - 1] || null;
    return Array.from({ length: count }, (_, index) => ({
      index,
      card: (cards[index] || lastCard)?.card || null,
      accountEntry: accounts[index] || accounts[accounts.length - 1] || null,
      matchedPaymentDate: (cards[index] || lastCard)?.matchedPaymentDate || ''
    }));
  }

  function visibleAccountStatus(franchise = {}, context = {}) {
    const visibleAccounts = typeof context.visibleAccounts === 'function'
      ? context.visibleAccounts
      : () => [];
    const accounts = visibleAccounts(franchise);
    if (!accounts.length) return '미등록';
    if (accounts.some(account => account.accountStatus === '반려')) return '반려';
    if (accounts.some(account => account.accountStatus === '승인대기')) return '승인대기';
    if (accounts.some(account => account.accountStatus === '승인완료' && String(account.txid || '').trim())) return '승인완료';
    if (accounts.some(account => account.accountStatus === '승인완료')) return '승인대기';
    return accounts[0]?.accountStatus || '미등록';
  }

  function accountDisplayStatus(account, franchise = {}, context = {}) {
    const raw = String(account?.accountStatus || visibleAccountStatus(franchise, context) || '미등록');
    if (raw === '승인완료' && !String(account?.txid || '').trim()) return '승인대기';
    return raw;
  }

  function deliveryNames(franchise = {}, context = {}, includeHidden = false) {
    const bankWords = ['은행', '국토다이스', '가상계좌', '기업은행', '국민은행', '농협은행', '우리은행', '하나은행', '신한은행', '카카오뱅크', '케이뱅크', '토스뱅크'];
    const visibleAccounts = typeof context.visibleAccounts === 'function'
      ? context.visibleAccounts
      : () => [];
    const accounts = includeHidden
      ? (Array.isArray(franchise.deliveryAgencies) ? franchise.deliveryAgencies : [])
      : visibleAccounts(franchise);
    const rawNames = (accounts.length ? accounts.map(account => account.agency) : [franchise.deliveryAgency || franchise.deliveryCompany]).filter(Boolean);
    return [...new Set(rawNames
      .map(name => String(name).trim())
      .filter(name => name && !bankWords.some(word => name.includes(word))))];
  }

  function deliveryChips(franchise = {}, context = {}) {
    const visibleAccounts = typeof context.visibleAccounts === 'function'
      ? context.visibleAccounts(franchise)
      : [];
    const names = deliveryNames(franchise, context);
    if (!names.length) return '<span class="franchise-muted-strong">미등록</span>';
    return names.map(name => {
      const account = visibleAccounts.find(item => String(item?.agency || '').trim() === name) || {};
      return `<span class="bdg ${accountStatusClass(account, franchise, context)}">${esc(name)}</span>`;
    }).join(' ');
  }

  function statusBadgeHtml(label, context = {}) {
    if (typeof context.statusBadgeHtml === 'function') return context.statusBadgeHtml(label);
    return `<span class="bdg">${esc(label || '-')}</span>`;
  }

  function listDeliveryStack(franchise = {}, lineCount = 1, lines = null, context = {}) {
    const displayLines = Array.isArray(lines) ? lines : sortedDisplayLines(franchise, context);
    const fallbackNames = deliveryNames(franchise, context);
    if (!displayLines.length && !fallbackNames.length) {
      return repeatedLines('<span class="franchise-muted-strong">미등록</span>', lineCount);
    }
    return lineStack(dedupedAccountLines(displayLines, (line, index) => {
      const name = line.accountEntry?.account?.agency || fallbackNames[index] || fallbackNames[fallbackNames.length - 1] || '미등록';
      return name === '미등록'
        ? '<span class="franchise-muted-strong">미등록</span>'
        : `<span class="bdg ${accountStatusClass(line.accountEntry?.account, franchise, context)}">${esc(name)}</span>`;
    }, context.accountKeyFn));
  }

  function listAccountStatusStack(franchise = {}, lineCount = 1, lines = null, context = {}) {
    const displayLines = Array.isArray(lines) ? lines : sortedDisplayLines(franchise, context);
    return lineStack(dedupedAccountLines(displayLines, line => {
      const account = line.accountEntry?.account || null;
      const accountStatus = accountDisplayStatus(account, franchise, context);
      const status = statusBadgeHtml(accountStatus, context);
      if (accountStatus === '승인대기' && line.accountEntry) {
        return `<div class="franchise-status-chips">${status}${accountActionChip('검증', 'approve', franchise.id, line.accountEntry.idx)}${accountActionChip('반려', 'reject', franchise.id, line.accountEntry.idx, 'danger')}</div>`;
      }
      return `<div class="franchise-status-chips">${status}</div>`;
    }, context.accountKeyFn), false);
  }

  function listAccountNoStack(franchise = {}, lineCount = 1, lines = null, context = {}) {
    const displayLines = Array.isArray(lines) ? lines : sortedDisplayLines(franchise, context);
    return lineStack(dedupedAccountLines(displayLines, line => {
      const account = line.accountEntry?.account || {};
      return `<span class="franchise-mono-sm">${esc(account.accountNo || account.virtualAccountNo || '-')}</span>`;
    }, context.accountKeyFn));
  }

  function listTxidStack(franchise = {}, lineCount = 1, lines = null, context = {}) {
    const displayLines = Array.isArray(lines) ? lines : sortedDisplayLines(franchise, context);
    return lineStack(dedupedAccountLines(displayLines, line => {
      const account = line.accountEntry?.account || {};
      return `<span class="franchise-mono-sm">${esc(account.txid || '-')}</span>`;
    }, context.accountKeyFn));
  }

  function listCardAliasStack(franchise = {}, lineCount = 1, lines = null, context = {}) {
    const displayLines = Array.isArray(lines) ? lines : sortedDisplayLines(franchise, context);
    return lineStack(displayLines.map(line => line.card ? cardAliasHtml(line.card, line.matchedPaymentDate) : '<span class="franchise-muted-strong">미등록</span>'));
  }

  function listCardStack(franchise = {}, lineCount = 1, lines = null, context = {}) {
    const displayLines = Array.isArray(lines) ? lines : sortedDisplayLines(franchise, context);
    return lineStack(displayLines.map((line, index) => line.card ? cardChipHtml(franchise, line.card, index, line.matchedPaymentDate) : '<span class="franchise-muted-strong">미등록</span>'));
  }

  function recentPaymentStack(franchise = {}, lineCount = 1, lines = null, context = {}) {
    const displayLines = Array.isArray(lines) ? lines : sortedDisplayLines(franchise, context);
    return lineStack(displayLines.map(line => esc(displayLineDate(line) || '-')), false);
  }

  function statusCheckLine(franchise = {}, card = null, accountEntry = null, context = {}) {
    if (!card) return '<span class="franchise-muted-strong">미등록</span>';
    const hidden = card.hidden === true || card.active === false;
    if ((context.role === 'hq' || context.isHq === true) && card.id) {
      return `<div class="franchise-status-chips">${visibilityChip(hidden ? '보이기' : '숨기기', 'card', franchise.id, card.id, !hidden, hidden ? '' : 'warn')}</div>`;
    }
    return statusBadgeHtml(hidden ? '숨기기' : '보이기', context);
  }

  function statusCheckStack(franchise = {}, lineCount = 1, lines = null, context = {}) {
    const displayLines = Array.isArray(lines) ? lines : sortedDisplayLines(franchise, context);
    return lineStack(displayLines.map(line => statusCheckLine(franchise, line.card, line.accountEntry, context)), false);
  }

  function infoRow(label, value, html = false) {
    const content = value === null || value === undefined || value === '' ? '-' : value;
    return `<div class="franchise-info-row"><span class="franchise-info-label">${esc(label)}</span><span class="franchise-info-value">${html ? content : esc(content)}</span></div>`;
  }

  function fallbackBizDocButton(franchise = {}) {
    const file = franchise.bizDocFile || franchise.bizDocFileKey || '';
    if (!file) return '-';
    return `<button type="button" class="file-pill" data-file-preview-key="${esc(file)}" data-file-preview-name="${esc(file)}">${esc(file)}</button>`;
  }

  function fallbackDetailAddress(franchise = {}) {
    const base = String(franchise.address || '').trim();
    const detail = String(franchise.tel || '').trim();
    if (base && detail) return `${esc(base)} <span class="franchise-detail-address-extra">${esc(detail)}</span>`;
    return esc(base || detail || '-');
  }

  function fallbackFeeRate(franchise = {}) {
    const rate = franchise.feeRate ?? franchise.franchiseFeeRate;
    if (rate === null || rate === undefined || rate === '') return '-';
    const value = Number(rate);
    if (!Number.isFinite(value)) return '-';
    return `${String(Number(value.toFixed(2))).replace(/\.0$/, '')}%`;
  }

  function fallbackFormatMoney(value) {
    const amount = Number(value || 0);
    return `${Number.isFinite(amount) ? amount.toLocaleString() : '0'}원`;
  }

  function validEmailValue(value) {
    const email = String(value || '').trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  }

  function basicDetailHtml(franchise = {}, context = {}) {
    const displayEmail = typeof context.displayEmail === 'function'
      ? context.displayEmail(franchise)
      : esc(validEmailValue(franchise.email) || validEmailValue(franchise.contactEmail) || validEmailValue(franchise.payerEmail) || '-');
    const bizDoc = typeof context.bizDocButton === 'function'
      ? context.bizDocButton(franchise)
      : fallbackBizDocButton(franchise);
    const address = typeof context.detailAddress === 'function'
      ? context.detailAddress(franchise)
      : fallbackDetailAddress(franchise);
    const agencyName = typeof context.agencyName === 'function'
      ? context.agencyName(franchise)
      : (franchise.agency || '-');
    const memberEmail = validEmailValue(franchise.email) || validEmailValue(franchise.contactEmail);
    const memberId = typeof context.displayMemberId === 'function'
      ? context.displayMemberId(memberEmail)
      : String(memberEmail || '').split('@')[0];
    const loginId = franchise.loginId || franchise.customerId || memberId || '-';
    return `<div class="card"><div class="ch"><span class="admin-card-heading">기본 정보</span></div><div class="franchise-basic-body">
        ${infoRow('대표자', franchise.owner || '-')}
        ${infoRow('연락처', franchise.phone || '-')}
        ${infoRow('이메일', displayEmail, true)}
        ${infoRow('로그인 ID', loginId)}
        ${infoRow('사업자등록번호', franchise.bizNo || '-')}
        ${infoRow('사업자등록증', bizDoc, true)}
        ${infoRow('주소', address, true)}
        ${infoRow('상위대리점', agencyName || '-')}
        ${infoRow('가입일', franchise.joinDate || '-')}
        ${infoRow('최근 결제', franchise.lastPaymentDate || '-')}
        ${infoRow('비고', franchise.note || '-')}
      </div></div>`;
  }

  function cardDetailHtml(franchise = {}, context = {}) {
    const cardItems = typeof context.cardItems === 'function'
      ? context.cardItems(franchise)
      : (Array.isArray(franchise.cardList) ? franchise.cardList.filter(Boolean) : []);
    if (!cardItems.length) return '<div class="franchise-empty-detail">등록된 카드 없음</div>';

    const isHq = context.role === 'hq' || context.isHq === true;
    return `<table class="franchise-card-detail-table">
    <colgroup><col class="admin-col-86"><col class="admin-col-150"><col class="admin-col-94"><col class="admin-col-70"><col><col class="admin-col-104"></colgroup>
    <thead><tr><th>카드명</th><th>카드번호</th><th>등록일</th><th>상태</th><th>카드별칭</th><th>관리</th></tr></thead>
    <tbody>${cardItems.map(card => {
      const name = String(card.cardCompany || card.cardName || card.alias || '카드').trim();
      const rawLast = String(card.cardLast4 || card.maskedNumber || card.cardNumber || '').replace(/[^0-9]/g, '');
      const last = rawLast.slice(-4) || '????';
      const date = card.registeredDate || card.cardRegisteredDate || String(card.createdAt || '').slice(0, 10) || '-';
      const hidden = card.hidden === true;
      const toggleLabel = hidden ? '보이기' : '숨기기';
      const status = statusBadgeHtml(hidden ? '숨기기' : '보이기', context);
      const actionChips = isHq && card.id
        ? `<div class="franchise-card-detail-actions"><button type="button" class="franchise-status-chip" data-admin-action="fr-card-alias-save" data-fr-card-id="${esc(card.id)}" data-fr-id="${esc(franchise.id)}">저장</button>${visibilityChip(toggleLabel, 'card', franchise.id, card.id, !hidden, hidden ? '' : 'warn')}</div>`
        : '-';
      const aliasCell = isHq && card.id
        ? `<input class="fi admin-card-alias-input" value="${esc(card.alias || '')}" placeholder="카드별칭">`
        : esc(card.alias || '-');
      return `<tr>
      <td class="franchise-detail-name">${esc(name)}</td>
      <td class="card-no">****-****-****-${esc(last)}</td>
      <td class="franchise-card-detail-date">${esc(date)}</td>
      <td>${status}</td>
      <td>${aliasCell}</td>
      <td>${actionChips}</td>
    </tr>`;
    }).join('')}</tbody></table>`;
  }

  function accountDetailHtml(franchise = {}, context = {}) {
    const accounts = Array.isArray(franchise.deliveryAgencies) ? franchise.deliveryAgencies : [];
    const role = context.role || '';
    const accountStatus = typeof context.accountStatus === 'function'
      ? context.accountStatus(franchise)
      : visibleAccountStatus(franchise, context);
    const accountRows = accounts.length
      ? accounts.map((account, index) => {
        const hidden = account.hidden === true;
        const statusChips = [
          statusBadgeHtml(accountDisplayStatus(account, franchise, context), context),
          role === 'hq' && accountDisplayStatus(account, franchise, context) === '승인대기'
            ? `${accountActionChip('승인', 'approve', franchise.id, index)}${accountActionChip('반려', 'reject', franchise.id, index, 'danger')}`
            : '',
          role === 'hq'
            ? visibilityChip(hidden ? '보이기' : '숨김', 'account', franchise.id, index, hidden !== true, hidden ? '' : 'warn')
            : ''
        ].filter(Boolean).join('');
        const proof = account.fileName
          ? `<button type="button" class="file-pill" data-admin-action="fr-account-detail" data-fr-account-idx="${Number(index)}" data-fr-id="${esc(franchise.id)}">${esc(account.fileName)}</button>`
          : '미첨부';
        return `<div class="franchise-account-item">
          <div class="franchise-account-head"><span class="franchise-account-name">${esc(account.agency || '-')}</span><div class="franchise-detail-chip-row">${statusChips}</div></div>
          <div class="franchise-account-meta">
            <div>은행: ${esc(account.bankName || '-')} | 예금주: ${esc(account.accountHolder || '-')}</div>
            <div class="admin-mono">계좌: ${esc(account.accountNo || '미입력')}</div>
            <div class="admin-mono">TXID: ${account.txid ? esc(account.txid) : '<span class="franchise-muted-strong">미등록</span>'}</div>
            <div>증빙: ${proof}</div>
          </div>
        </div>`;
      }).join('')
      : '<div class="emp">등록된 계좌 없음</div>';
    return `<div class="card"><div class="ch"><span class="admin-card-heading">배달대행사 계좌</span><span>${statusBadgeHtml(accountStatus, context)}</span></div><div class="franchise-account-list">${accountRows}</div></div>`;
  }

  function paymentDetailHtml(franchise = {}, context = {}) {
    const settlements = Array.isArray(context.settlementRows) ? context.settlementRows : [];
    const payments = Array.isArray(context.payments) ? context.payments : [];
    const formatMoney = typeof context.formatMoney === 'function' ? context.formatMoney : fallbackFormatMoney;
    const resolvePaymentCardLabel = typeof context.resolvePaymentCardLabel === 'function'
      ? context.resolvePaymentCardLabel
      : () => '-';
    const rows = settlements.slice(0, 50).map(settlement => {
      const depositAt = settlement.settlementDate || settlement.settledAt || settlement.depositDate || settlement.paymentDate || settlement.date || '-';
      const account = [settlement.bankCode || '', settlement.accountNo || ''].filter(Boolean).join(' ') || '-';
      const payment = payments.find(item => String(item.approvalNo || item.id || '') === String(settlement.approvalNo || ''));
      const cardLabel = resolvePaymentCardLabel(franchise, settlement, payment);
      return `<tr><td class="franchise-payment-date">${esc(depositAt)}</td><td class="franchise-payment-card">${esc(cardLabel)}</td><td>${esc(settlement.deliveryAgency || '-')}</td><td class="admin-mono admin-text-small">${esc(account)}</td><td class="tg franchise-payment-amount">${formatMoney(settlement.paymentAmt || 0)}</td><td><button type="button" class="link-chip" data-settle-detail-id="${esc(settlement.id)}">${esc(settlement.approvalNo || '-')}</button></td><td>${statusBadgeHtml(settlement.status || '정상승인', context)}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="emp">입금 내역 없음</td></tr>';
    return `<div class="card"><div class="ch"><span class="admin-card-heading">결제·충전 내역</span><span class="admin-text-small admin-text-muted">총 ${settlements.length}건</span></div>
        <div class="franchise-payment-scroll"><table><thead><tr><th>결제일시</th><th>결제카드</th><th>배달대행사</th><th>입금계좌</th><th class="admin-right">결제금액</th><th>승인번호</th><th>입금상태</th></tr></thead><tbody>
          ${rows}
        </tbody></table></div>
      </div>`;
  }

  window.EatsAdminFranchiseListUtils = Object.assign(root, {
    version: '2026-06-27.franchise-list-utils.7',
    displayLineDate,
    lineStack,
    repeatedLines,
    lineAccountKey,
    dedupedAccountLines,
    cardChipHtml,
    cardAliasHtml,
    chipButton,
    visibilityChip,
    accountActionChip,
    paymentDateForCard,
    sortedDisplayLines,
    visibleAccountStatus,
    deliveryNames,
    deliveryChips,
    listDeliveryStack,
    listAccountStatusStack,
    listAccountNoStack,
    listTxidStack,
    listCardAliasStack,
    listCardStack,
    recentPaymentStack,
    statusCheckLine,
    statusCheckStack,
    basicDetailHtml,
    cardDetailHtml,
    accountDetailHtml,
    paymentDetailHtml
  });
})();
