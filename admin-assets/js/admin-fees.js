(function(){
  const api = window.EatsAdminFees || {};
  const fallbackEsc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[ch]));

  function pgFees(ctx = {}){
    const role = ctx.role || 'hq';
    const agencies = Array.isArray(ctx.agencies) ? ctx.agencies : [];
    const esc = typeof ctx.esc === 'function' ? ctx.esc : fallbackEsc;
    const getEffRate = typeof ctx.getEffRate === 'function' ? ctx.getEffRate : (() => 0);

    if(role === 'agent'){
      return '<div class="aw aw-w admin-denied-note">⛔ 수수료율 설정은 본사 관리자만 접근 가능합니다.</div>';
    }

    return `
  <div class="admin-fee-layout">
  <div><div class="card"><div class="ch"><span class="admin-section-head-text">기준 수수료율</span></div><div class="admin-card-pad-lg">
    <div class="fg"><label class="fl">서비스 기본 수수료율 (%)</label><div class="admin-inline-row"><input class="fi admin-input-sm" id="dfr" type="number" value="4.4" disabled><span class="bdg bg">운영 고정</span></div><div class="admin-help-text">서비스 기본 수수료율은 운영 정책상 4.4% 고정입니다. 결제금액에서 역산 차감 방식 (÷0.956)으로 계산합니다.</div></div>
    <div class="dv"></div>
    <div class="fcalc"><div class="admin-calc-title">💡 역산 계산기</div>
      <div class="fg admin-form-mb-sm"><label class="fl">입금 목표 금액 (원)</label><input class="fi" id="ca" placeholder="1000000" data-fee-calc></div>
      <div class="admin-calc-label">→ 카드 청구금액</div>
      <div class="fcr" id="cr">—</div>
      <div class="admin-calc-foot" id="cf"></div>
    </div>
  </div></div></div>
  <div><div class="card"><div class="ch"><span class="admin-section-head-text">영업대리점별 수수료율</span></div><div class="admin-card-pad">
    <div class="aw aw-w">※ 영업대리점은 영업수수료 외 별도 수수료 수취 불가. 본사에서만 설정합니다.</div>
    ${agencies.map(a=>`<div class="admin-fee-row">
      <span class="admin-fee-name">${esc(a.name)}</span>
      <input class="fi admin-fee-rate-input" type="number" step="0.01" value="${Number(getEffRate(a)||0).toFixed(2)}" data-ag-fee-id="${esc(a.id)}">
      <span class="admin-calc-label">%</span>
    </div>`).join('')}
  </div></div></div>
  </div>`;
  }

  api.pgFees = pgFees;
  window.EatsAdminFees = api;
})();
