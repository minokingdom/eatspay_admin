(function(){
  'use strict';

  const api = window.EatsAdminAgencySettlements || {};

  function fallbackFmt(value){
    const amount = Math.round(Number(value || 0));
    return `${amount.toLocaleString('ko-KR')}원`;
  }

  function fallbackEsc(value){
    return String(value ?? '').replace(/[&<>"']/g, mark => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[mark]));
  }

  function resolveContext(ctx){
    const safe = ctx || {};
    return {
      rows: Array.isArray(safe.rows) ? safe.rows : [],
      total: Number(safe.total || 0),
      agencyOptions: safe.agencyOptions || '',
      sd: safe.sd || '',
      ed: safe.ed || '',
      fmt: typeof safe.fmt === 'function' ? safe.fmt : (window.fmt || fallbackFmt),
      esc: typeof safe.esc === 'function' ? safe.esc : fallbackEsc,
      agencyTreeDepth: typeof safe.agencyTreeDepth === 'function' ? safe.agencyTreeDepth : (() => 0),
      agencyTypeKey: typeof safe.agencyTypeKey === 'function' ? safe.agencyTypeKey : (() => ''),
      agencyTypeLabel: typeof safe.agencyTypeLabel === 'function' ? safe.agencyTypeLabel : (() => '-'),
      agencyIndentMark: typeof safe.agencyIndentMark === 'function' ? safe.agencyIndentMark : (() => '')
    };
  }

  function renderRows(ctx){
    const {rows, fmt, esc, agencyTreeDepth, agencyTypeKey, agencyTypeLabel, agencyIndentMark} = ctx;
    if(!rows.length) return '<tr><td colspan="12" class="emp">정산 내역 없음</td></tr>';

    return rows.map(row => {
      const agency = row.agency || {};
      const indent = Number(agencyTreeDepth(agency)) || 0;
      const rowType = agencyTypeKey(agency);
      const indentLevel = Math.max(0, Math.min(6, indent));
      const typeClass = rowType === 'hq' ? 'settlement-type-hq' : rowType === 'jijum' ? 'settlement-type-jijum' : '';
      const strengthClass = indent === 0 ? 'settlement-row-strong' : 'settlement-row-normal';

      return `<tr class="settle-click-row" data-agency-payments-id="${esc(agency.id)}" data-agency-payments-name="${esc(agency.name)}">
      <td class="settlement-agency-cell settlement-indent-${indentLevel} ${typeClass} ${strengthClass}">${agencyIndentMark(indent)} ${esc(agency.name)} <span class="settlement-link-hint">상세</span></td>
      <td>${esc(agencyTypeLabel(agency))}</td>
      <td class="payment-amount-cell">${Number(row.count || 0)}건</td>
      <td class="tg payment-amount-cell">${fmt(row.amount)}</td>
      <td class="payment-amount-cell">${fmt(row.merchantNet)}</td>
      <td class="payment-amount-cell settle-number-danger">${fmt(row.serviceFee)}</td>
      <td class="payment-amount-cell settlement-cell-success">${fmt(row.agencyFee)}</td>
      <td class="payment-amount-cell">${fmt(row.transactionFee || 0)}</td>
      <td class="payment-amount-cell">${fmt(row.settlementTotal ?? row.agencyFee)}</td>
      <td class="tg payment-amount-cell settlement-cell-total">${fmt(row.agencyNet)}</td>
      <td>${esc(agency.settleBankName || '-')}</td>
      <td class="admin-mono admin-text-small">${esc(agency.settleAccountNo || '-')}</td>
    </tr>`;
    }).join('');
  }

  function pgSettle(ctx){
    const resolved = resolveContext(ctx);
    return `
  <div class="settlement-toolbar">
    <div class="settlement-controls">
      <label class="settlement-label">정산 대상</label>
      <select class="fs settlement-select" data-settlement-agency-filter="1"><option value="">전체 (모든 대리점)</option>${resolved.agencyOptions}</select>
    </div>
    <button type="button" class="btn bg2" data-agency-settlement-export="1">엑셀 다운로드</button>
  </div>
  <div class="settlement-controls settlement-controls-spaced">
    <label class="settlement-label">정산 기간</label>
    <input type="date" class="fi settlement-date" value="${resolved.esc(resolved.sd)}" data-settlement-date="sd">
    <span class="admin-range-separator">~</span>
    <input type="date" class="fi settlement-date" value="${resolved.esc(resolved.ed)}" data-settlement-date="ed">
    <button type="button" class="btn bo sm" data-settlement-range="thisMonth">이번 달</button>
    <button type="button" class="btn bo sm" data-settlement-range="lastMonth">지난 달</button>
    <button type="button" class="btn bo sm" data-settlement-range="all">전체</button>
  </div>
  <div class="settlement-total-card">합계 <strong class="settlement-total-amount">${resolved.fmt(resolved.total)}</strong></div>
  <div class="card"><div class="ch"><span class="settlement-section-title">대리점별 정산 현황</span><span class="settlement-section-sub">행 클릭 시 해당 대리점 결제 내역 확인</span></div><div class="tw"><table><thead><tr><th>지점명</th><th>유형</th><th class="payment-amount-cell">전체건</th><th class="payment-amount-cell">전체금액</th><th class="payment-amount-cell">가맹입금액</th><th class="payment-amount-cell">가맹입금수수료</th><th class="payment-amount-cell">배분수수료</th><th class="payment-amount-cell">건당수수료</th><th class="payment-amount-cell">지급예정액</th><th class="payment-amount-cell">실지급액</th><th>입금은행</th><th>계좌번호</th></tr></thead><tbody>
  ${renderRows(resolved)}
  </tbody></table></div></div>
  <div class="settlement-rule-note">
    <div class="settlement-rule-note-title">정산 기준</div>
    <div class="settlement-rule-note-grid">
      <span>조직 경로</span><b>가맹점 → 지점 → 지사 → 본부 → 본사</b>
      <span>배분수수료</span><b>상위 수수료율에서 바로 아래 조직 수수료율을 뺀 차액</b>
      <span>본사 건당수수료</span><b>결제 1건당 300원</b>
      <span>실지급액</span><b>배분수수료에서 3.3% 제외 후 건당수수료 합산</b>
    </div>
  </div>`;
  }

  api.pgSettle = pgSettle;
  window.EatsAdminAgencySettlements = api;
}());
