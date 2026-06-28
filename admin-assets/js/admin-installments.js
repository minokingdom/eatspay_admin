(function(){
  const api = window.EatsAdminInstallments || {};
  const fallbackEsc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[ch]));

  function pgInst(ctx = {}){
    const months = Array.isArray(ctx.months) ? ctx.months : [];
    const cards = Array.isArray(ctx.cards) ? ctx.cards : [];
    const esc = typeof ctx.esc === 'function' ? ctx.esc : fallbackEsc;
    const label = ctx.label || '';
    const isMinMonth = !!ctx.isMinMonth;

    return `
  <div class="admin-installment-toolbar">
    <div class="admin-installment-nav">
      <button class="btn bo sm ${isMinMonth?'admin-installment-disabled':''}" type="button" data-admin-action="inst-month" data-inst-month="-1" ${isMinMonth?'disabled':''}>◀ 이전</button>
      <span class="admin-installment-label">${esc(label)} 무이자 설정</span>
      <button class="btn bo sm" type="button" data-admin-action="inst-month" data-inst-month="1">다음 ▶</button>
    </div>
    <button class="btn bg2 sm" type="button" data-admin-action="inst-save">전체 저장</button>
  </div>
  <div class="aw aw-w">💡 카드사별 무이자 할부 이벤트를 월별로 설정합니다. 현재 선택한 ${esc(label)} 정책으로 저장되며, 앱에는 체크된 개월만 노출됩니다.</div>
  <div class="card"><div class="ch"><span class="admin-section-head-text">${esc(label)} 카드사별 무이자 할부</span></div>
  <div class="admin-installment-scroll">
    <div class="inst-grid">
      <div class="inst-hdr admin-text-left">카드사</div>
      ${months.map(m=>`<div class="inst-hdr">${m}개월</div>`).join('')}
      ${cards.map((item,idx)=>{
        const card = item.cardCompany || '';
        const checkedMonths = Array.isArray(item.months) ? item.months.map(Number) : [];
        return `
        <div class="inst-cell admin-inst-card-name">${esc(card)}</div>
        ${months.map(month=>`
          <div class="inst-cell admin-inst-center">
            <label class="ci admin-check-tight">
              <input type="checkbox" class="ci-month" data-card="${esc(card)}" data-order="${item.displayOrder||idx+1}" value="${month}" ${checkedMonths.includes(Number(month))?'checked':''}>
            </label>
          </div>`).join('')}`;
      }).join('')}
    </div>
  </div></div>`;
  }

  api.pgInst = pgInst;
  window.EatsAdminInstallments = api;
})();
