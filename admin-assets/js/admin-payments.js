(function () {
  'use strict';

  const root = window.EatsAdminPayments || {};

  function fallbackEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (match) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[match]));
  }

  function fallbackFRow(label, inner) {
    return `<div class="fg"><label class="fl">${fallbackEsc(label)}</label>${inner}</div>`;
  }

  function fallbackMakeSdd(id, options) {
    const opts = Array.isArray(options) ? options : [];
    return `<select class="fs payment-filter-full" id="${fallbackEsc(id)}" data-payment-filter="1"><option value="">전체</option>${opts.map((option) => `<option value="${fallbackEsc(option.val)}">${fallbackEsc(option.label)}</option>`).join('')}</select>`;
  }

  function context(ctx) {
    return {
      data: ctx?.data || {},
      role: ctx?.role || window.role || 'hq',
      fRow: ctx?.fRow || window.fRow || fallbackFRow,
      makeSdd: ctx?.makeSdd || window.makeSdd || fallbackMakeSdd,
    };
  }

  function pgPay(ctx) {
    const c = context(ctx);
    const data = c.data;
    const fRow = c.fRow;
    const makeSdd = c.makeSdd;
    const role = c.role;
    const pgOptions = [...new Set((Array.isArray(data.payments) ? data.payments : []).map((payment) => payment.pg).filter(Boolean))];
    const deliveryOptions = (Array.isArray(data.deliveryAgencyList) ? data.deliveryAgencyList : [])
      .filter((agency) => agency.status !== 'deleted')
      .map((agency) => ({ val: agency.name, label: agency.name }));
    const agencyOptions = (Array.isArray(data.agencies) ? data.agencies : [])
      .map((agency) => ({ val: agency.id, label: agency.name }));

    return `
  <div class="aw aw-b">결제내역은 조회 전용입니다. 승인번호를 클릭하면 eats PAY 결제 전표를 확인할 수 있습니다.</div>
  <div class="payment-summary-grid">
    <div class="payment-summary-card"><div class="payment-summary-label">검색 건수</div><div class="payment-summary-value" id="pay-count">0건</div></div>
    <div class="payment-summary-card"><div class="payment-summary-label">검색 합계</div><div class="payment-summary-value" id="pay-total">0원</div></div>
    <div class="payment-summary-card"><div class="payment-summary-label">결제완료 금액</div><div class="payment-summary-value" id="pay-success-total">0원</div></div>
    <div class="payment-summary-card"><div class="payment-summary-label">취소/실패 건수</div><div class="payment-summary-value" id="pay-cancel-count">0건</div></div>
  </div>
  <div class="payment-list-layout">
    <div>
      <div class="card"><div class="ch"><span class="payment-table-title">결제내역 목록</span><span class="payment-table-subtitle">최신 결제가 위로 정렬됩니다.</span></div><div class="tw"><table><thead><tr><th>거래일시</th><th>대리점</th><th>가맹점명</th><th>구분</th><th class="payment-amount-cell">금액</th><th>할부</th><th>승인번호</th><th>결제 상태</th><th>회원 아이디</th><th>PG</th><th></th></tr></thead><tbody id="pb"></tbody></table></div></div>
    </div>
    <div class="payment-filter-sticky">
      <div class="card payment-filter-card">
        <div class="payment-filter-title">검색 조건</div>
        ${fRow('결제 상태', '<select class="fs payment-filter-full" id="pst" data-payment-filter="1"><option value="">전체</option><option>결제완료</option><option>취소</option></select>')}
        ${fRow('가맹점명', '<input class="fi" id="ps" placeholder="가맹점명/대표자 검색" data-payment-filter="1">')}
        ${fRow('거래일시', '<div class="payment-filter-date-stack"><input class="fi" id="psd" type="date" data-payment-filter="1"><input class="fi" id="ped" type="date" data-payment-filter="1"></div>')}
        ${role === 'hq' ? `
          ${fRow('회원 아이디', '<input class="fi" id="pcid" placeholder="회원 아이디" data-payment-filter="1">')}
          ${fRow('대리점', makeSdd('pag', agencyOptions))}
          ${fRow('결제 구분', '<select class="fs payment-filter-full" id="ptype" data-payment-filter="1"><option value="">전체</option><option>충전</option><option>결제</option></select>')}
          ${fRow('PG사', `<select class="fs payment-filter-full" id="ppg" data-payment-filter="1"><option value="">전체</option>${pgOptions.map((pg) => `<option>${fallbackEsc(pg)}</option>`).join('')}</select>`)}
          ${fRow('배달대행사', makeSdd('pda', deliveryOptions))}
          ${fRow('결제 금액', '<div class="payment-filter-range"><input class="fi" id="pamin" placeholder="최소" type="number" data-payment-filter="1"><input class="fi" id="pamax" placeholder="최대" type="number" data-payment-filter="1"></div>')}
          ${fRow('승인번호', '<input class="fi" id="pan" placeholder="승인번호" data-payment-filter="1">')}
        ` : ''}
        <button type="button" class="btn bo payment-filter-full admin-btn-center" data-payment-filter-clear="1">초기화</button>
      </div>
    </div>
  </div>
  `;
  }

  root.pgPay = pgPay;
  window.EatsAdminPayments = root;
}());
