(function () {
  const root = window.EatsAdminFranchiseUtils || {};
  const INVALID_CARD_NAMES = new Set(['카드', '등록카드', '카드사 확인중', '확인중', '카드사확인중']);

  function normalizeReceiptCardInfo(payment = {}, franchise = {}) {
    const rawName = String(payment.cardCompany || payment.cardName || payment.cardAlias || franchise?.cardCompany || '').trim();
    const rawNumber = String(payment.maskedNumber || payment.cardNumber || payment.cardNo || '').trim();
    const fallbackLast4 = String(franchise?.cardLast4 || '').replace(/[^0-9]/g, '').slice(-4);
    const maskedPattern = /(\*{2,4}[-\s]?\*{2,4}[-\s]?\*{2,4}[-\s]?\d{2,4})/;
    let cardName = rawName;
    let cardNo = rawNumber;
    const numberMatch = rawNumber.match(maskedPattern);
    if (numberMatch) {
      cardNo = numberMatch[1].replace(/\s+/g, '-');
      const prefix = rawNumber.slice(0, numberMatch.index).trim();
      if ((!cardName || cardName === '카드' || cardName === '등록카드') && prefix) cardName = prefix;
    }
    const nameMatch = rawName.match(maskedPattern);
    if (nameMatch) {
      cardNo = nameMatch[1].replace(/\s+/g, '-');
      cardName = rawName.slice(0, nameMatch.index).trim() || '카드';
    }
    const last4 = String(cardNo || rawNumber || rawName || fallbackLast4).match(/(\d{4})(?!.*\d)/)?.[1] || fallbackLast4;
    if (last4) cardNo = '****-' + last4;
    if (!cardNo) cardNo = '****-****';
    if (!cardName || cardName === '등록카드') cardName = '카드';
    return { cardName, cardNo };
  }

  function isWithdrawnFranchise(franchise) {
    const roleText = String(franchise?.role || '').toUpperCase();
    const statusText = String(franchise?.status || '');
    return roleText === 'OWNER_WITHDRAWN' || statusText.includes('탈퇴');
  }

  function accountStatus(franchise) {
    if (isWithdrawnFranchise(franchise)) return '탈퇴';
    const accounts = franchise?.deliveryAgencies || [];
    if (!accounts.length) return '미등록';
    if (accounts.some(account => account.accountStatus === '승인대기')) return '승인대기';
    if (accounts.some(account => account.accountStatus === '반려')) return '반려';
    if (accounts.some(account => account.accountStatus === '승인완료' && String(account.txid || '').trim())) return '승인완료';
    if (accounts.some(account => account.accountStatus === '승인완료')) return '승인대기';
    return accounts[0]?.accountStatus || '미등록';
  }

  function cardItems(franchise) {
    const items = Array.isArray(franchise?.cardList) ? franchise.cardList.filter(Boolean) : [];
    if (items.length) return items;
    if (franchise?.cardRegistered || franchise?.cardCompany || franchise?.cardLast4) {
      return [{
        cardCompany: franchise.cardCompany,
        cardName: franchise.cardName,
        alias: franchise.cardAlias,
        maskedNumber: franchise.maskedNumber || franchise.cardNumber,
        cardLast4: franchise.cardLast4,
        registeredDate: franchise.cardRegisteredDate
      }];
    }
    return [];
  }

  function deliveryAccountVisibleKey(account) {
    return [
      String(account?.agencyId || ''),
      String(account?.agency || account?.agencyName || '').trim().toLowerCase(),
      String(account?.bankName || '').trim().toLowerCase(),
      String(account?.accountNo || account?.virtualAccountNo || '').replace(/[^0-9A-Za-z]/g, '')
    ].join('|');
  }

  function uniqueVisibleAccounts(accounts) {
    const seen = new Set();
    return (Array.isArray(accounts) ? accounts : []).filter(account => {
      if (account?.hidden === true) return false;
      const key = deliveryAccountVisibleKey(account);
      if (key && seen.has(key)) return false;
      if (key) seen.add(key);
      return true;
    });
  }

  function visibleCardItems(franchise) {
    return cardItems(franchise).filter(card => card?.hidden !== true);
  }

  function visibleAccounts(franchise) {
    return uniqueVisibleAccounts(franchise?.deliveryAgencies);
  }

  function visibleAccountEntries(franchise) {
    const accounts = Array.isArray(franchise?.deliveryAgencies) ? franchise.deliveryAgencies : [];
    const seen = new Set();
    return accounts.map((account, idx) => ({ account, idx })).filter(entry => {
      if (entry.account?.hidden === true) return false;
      const key = deliveryAccountVisibleKey(entry.account);
      if (key && seen.has(key)) return false;
      if (key) seen.add(key);
      return true;
    });
  }

  function normalizeCardMatchName(value) {
    return String(value || '').replace(/\s+/g, '').replace(/^KB/, '').replace(/^케이비/, '').replace(/카드$/, '').toLowerCase();
  }

  window.EatsAdminFranchiseUtils = Object.assign(root, {
    version: '2026-06-26.franchise-utils.1',
    INVALID_CARD_NAMES,
    normalizeReceiptCardInfo,
    isWithdrawnFranchise,
    accountStatus,
    cardItems,
    deliveryAccountVisibleKey,
    uniqueVisibleAccounts,
    visibleCardItems,
    visibleAccounts,
    visibleAccountEntries,
    normalizeCardMatchName
  });
})();
