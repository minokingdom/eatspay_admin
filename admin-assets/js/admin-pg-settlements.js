(function(){
  'use strict';

  const api = window.EatsAdminPgSettlements || {};

  function fallbackFmt(value){
    const amount = Math.round(Number(value || 0));
    return `${amount.toLocaleString('ko-KR')}원`;
  }

  function resolveContext(ctx){
    return {
      data: ctx && ctx.data ? ctx.data : {},
      fmt: ctx && typeof ctx.fmt === 'function' ? ctx.fmt : (window.fmt || fallbackFmt)
    };
  }

  function pgPGSettle(ctx){
    const {data, fmt} = resolveContext(ctx);
    const settlements = Array.isArray(data.pgSettlements) ? data.pgSettlements : [];
    const total = settlements.reduce((sum, item) => sum + Number(item.netAmt || 0), 0);

    return `
  <div class="aw aw-b">ℹ️ 즉시정산 구조: 결제 승인 후 3~10분 내 가상계좌 자동 입금. 고객 취소 요청 시 취소 처리. 정산 행 클릭 시 상세 확인 가능.</div>
  <div class="sb2">
    <input class="si" id="gss" placeholder="가맹점명 또는 결제코드..." data-pg-filter="1">
    <input class="si admin-date-sm" id="gsd" type="date" data-pg-filter="1">
    <span class="admin-range-separator">~</span>
    <input class="si admin-date-sm" id="ged" type="date" data-pg-filter="1">
    <select class="fs admin-select-sm" id="gsst" data-pg-filter="1"><option value="">전체</option><option>정상승인</option><option>취소</option><option>롤백</option><option>ROLLED_BACK</option></select>
    <input type="hidden" id="gsan"><input type="hidden" id="gscid"><input type="hidden" id="gspg">
  </div>
  <div class="card">
    <div class="ch admin-card-pad-x">
      <span class="admin-total-title">정산 합계 <strong id="gs-total" class="admin-total-amount">${fmt(total)}</strong></span>
      <button type="button" class="btn bg2 xs" data-pg-settle-export="1">엑셀 다운로드</button>
    </div>
    <div class="tw"><table><thead><tr><th>결제일시</th><th>결제코드</th><th>정산일시</th><th>입금코드</th><th>고객 ID</th><th>대리점</th><th>가맹점명</th><th class="payment-amount-cell">결제금액</th><th class="payment-amount-cell">수수료(4.4%)</th><th class="payment-amount-cell">정산금액</th><th>배달대행사</th><th>PG사</th><th>상태</th><th></th></tr></thead><tbody id="gsb"></tbody></table></div>
  </div>`;
  }

  api.pgPGSettle = pgPGSettle;
  window.EatsAdminPgSettlements = api;
}());
