(function(){
  const api = window.EatsAdminAccounts || {};
  const fallbackEsc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[ch]));

  function pgAccounts(ctx = {}){
    const fRow = typeof ctx.fRow === 'function' ? ctx.fRow : ((label, html) => `<div class="fg"><label class="fl">${label}</label>${html}</div>`);
    const makeSdd = typeof ctx.makeSdd === 'function' ? ctx.makeSdd : (() => '<select class="fs" id="acda" data-sdd-id="acda"></select>');
    const deliveryAgencies = Array.isArray(ctx.deliveryAgencies) ? ctx.deliveryAgencies : [];
    const exportPendingCount = Number(ctx.exportPendingCount || 0);
    const deliveryOptions = deliveryAgencies
      .filter(a => a && a.status !== 'deleted')
      .map(a => ({ val: a.name, label: a.name }));

    return `
  <div class="accounts-list-layout">
    <div class="card">
      <div class="ch"><span class="admin-card-heading">계좌 검증 내보내기</span><span class="admin-card-tools"><span class="bdg bg" id="account-export-count">${exportPendingCount}건</span><button type="button" class="btn bg2 xs" data-account-export="1">내보내기</button><button type="button" class="btn bo xs" data-account-txid-upload-open="account-txid-upload">TXID 업로드</button><input type="file" id="account-txid-upload" accept=".xlsx,.xls" class="admin-hidden-input" data-account-txid-upload-input="1"></span></div>
      <div class="tw"><table class="accounts-table accounts-table-wide"><colgroup><col class="admin-col-120"><col class="admin-col-130"><col class="admin-col-170"><col class="admin-col-130"><col class="admin-col-110"><col class="admin-col-160"><col class="admin-col-120"><col class="admin-col-110"><col class="admin-col-76"></colgroup><thead><tr><th>상태</th><th>회원 아이디</th><th>가맹점명</th><th>배달대행사</th><th>은행</th><th>계좌번호</th><th>예금주명</th><th>등록일시</th><th>확인</th></tr></thead><tbody id="acb"></tbody></table></div>
    </div>
    <div class="accounts-filter-panel">
      <div class="card accounts-filter-card">
        ${fRow('상태',`<select class="fs" id="acst" data-account-filter="1"><option value="">전체</option><option value="승인완료">정상 승인</option><option value="승인대기">승인 대기</option><option value="반려">반려</option></select>`)}
        ${fRow('회원 아이디',`<input class="fi" id="acuid" placeholder="회원 아이디" data-account-filter="1">`)}
        ${fRow('가맹점명',`<input class="fi" id="acfn" placeholder="가맹점명" data-account-filter="1">`)}
        ${fRow('배달대행사',makeSdd('acda',deliveryOptions,'rAcc()'))}
        ${fRow('계좌번호/예금주명',`<input class="fi" id="acacct" placeholder="계좌번호 또는 예금주" data-account-filter="1">`)}
        <button type="button" class="btn bg2 accounts-filter-action accounts-filter-action-main" data-account-search="1">검색</button>
        <button type="button" class="btn bo accounts-filter-action" data-account-clear="1">초기화</button>
      </div>
    </div>
  </div></div>`;
  }

  function renderAccountRows(rows = [], ctx = {}){
    const esc = typeof ctx.esc === 'function' ? ctx.esc : fallbackEsc;
    const bdg = typeof ctx.bdg === 'function' ? ctx.bdg : value => `<span class="bdg">${esc(value || '-')}</span>`;

    if(!Array.isArray(rows) || !rows.length){
      return '<tr><td colspan="9" class="emp">검색 결과 없음</td></tr>';
    }

    return rows.map(a => `<tr>
    <td>${bdg(a.accountStatus)}</td>
    <td class="accounts-member-id">${esc(a.memberId)}</td>
    <td class="accounts-franchise-name">${esc(a.fname)}</td>
    <td>${esc(a.agency||'-')}</td>
    <td>${esc(a.bankName||'-')}</td>
    <td class="admin-mono admin-text-small">${esc(a.accountNo||'미입력')}</td>
    <td>${esc(a.accountHolder||a.owner||'-')}</td>
    <td class="accounts-date-cell">${esc(a.reqDate||a.createdAt||'-')}</td>
    <td><button type="button" class="btn bo xs" data-admin-action="fr-account-detail" data-fr-account-idx="${a.idx}" data-fr-id="${esc(a.fid)}">확인</button></td>
  </tr>`).join('');
  }

  function filterAccountRows(franchises = [], filters = {}){
    const status = String(filters.status || '');
    const userQ = String(filters.userQ || '').toLowerCase();
    const nameQ = String(filters.nameQ || '').toLowerCase();
    const accountQ = String(filters.accountQ || '').toLowerCase();
    const agencyQ = String(filters.agencyQ || '');
    const rows = [];

    (Array.isArray(franchises) ? franchises : []).forEach(f => {
      (f.deliveryAgencies || []).forEach((da, i) => {
        const memberId = String(f.customerId || f.email || '-');
        const accountText = `${da.accountNo || ''} ${da.accountHolder || f.owner || ''}`.toLowerCase();
        if(status && da.accountStatus !== status)return;
        if(userQ && !memberId.toLowerCase().includes(userQ))return;
        if(nameQ && !String(f.name || '').toLowerCase().includes(nameQ))return;
        if(agencyQ && String(da.agency || '') !== agencyQ)return;
        if(accountQ && !accountText.includes(accountQ))return;
        rows.push({fid:f.id,fname:f.name,fagency:f.agency,memberId,owner:f.owner,idx:i,...da});
      });
    });

    return rows;
  }

  function safeDocumentRoot(){
    return typeof document !== 'undefined'
      ? document
      : { getElementById: () => null };
  }

  function collectAccountFilters(options = {}){
    const root = options.root && typeof options.root.getElementById === 'function'
      ? options.root
      : safeDocumentRoot();
    const valueOf = id => String(root.getElementById(id)?.value || '');

    return {
      status: valueOf('acst'),
      userQ: valueOf('acuid'),
      nameQ: valueOf('acfn'),
      accountQ: valueOf('acacct'),
      agencyQ: String(options.agencyQ || '')
    };
  }

  function clearAccountFilterFields(options = {}){
    const root = options.root && typeof options.root.getElementById === 'function'
      ? options.root
      : safeDocumentRoot();

    ['acst', 'acuid', 'acfn', 'acacct'].forEach(id => {
      const field = root.getElementById(id);
      if(field) field.value = '';
    });

    if(options.selection && typeof options.selection === 'object'){
      options.selection.acda = '';
    }

    return collectAccountFilters({ root, agencyQ: '' });
  }

  function accountExportPendingCount(franchises = []){
    let count = 0;
    (Array.isArray(franchises) ? franchises : []).forEach(franchise => {
      (franchise.deliveryAgencies || []).forEach(account => {
        if(
          account.accountStatus === '승인완료' &&
          account.hidden !== true &&
          account.exportReadyAt &&
          !account.exportedAt
        ){
          count += 1;
        }
      });
    });
    return count;
  }

  function renderAccountDetailModal(params = {}, ctx = {}){
    const esc = typeof ctx.esc === 'function' ? ctx.esc : fallbackEsc;
    const bdg = typeof ctx.bdg === 'function' ? ctx.bdg : value => `<span class="bdg">${esc(value || '-')}</span>`;
    const adminModalButton = typeof ctx.adminModalButton === 'function'
      ? ctx.adminModalButton
      : ((label, attrs = '', variant = 'secondary') => `<button type="button" class="btn ${variant === 'primary' ? 'bg2' : variant === 'danger' ? 'bd' : 'bo'}" ${attrs}>${esc(label)}</button>`);

    const f = params.franchise || {};
    const da = params.account || {};
    const fid = params.fid;
    const idx = Number(params.idx || 0);
    const readOnlyAccount = da.readonly === true || da.source === 'pg_settlement';
    const documentUrl = da.documentUrl || (da.fileKey ? `/uploads/${encodeURIComponent(da.fileKey)}` : '');
    const isImage = /\.(png|jpe?g|gif|webp)$/i.test(documentUrl || da.fileName || '');
    const filePreview = documentUrl
      ? (isImage
        ? `<img src="${esc(documentUrl)}" alt="증빙 이미지" class="account-proof-img">`
        : `<a class="btn bo" href="${esc(documentUrl)}" target="_blank" rel="noopener">증빙 파일 열기</a>`)
      : `<div class="account-proof-empty"><span>파일 없음</span><small>업로드된 증빙 파일이 없습니다.</small></div>`;
    const footerButtons = [];

    if(!readOnlyAccount){
      if(da.accountStatus !== '승인완료'){
        footerButtons.push(adminModalButton('검증', `data-admin-action="fr-account-action" data-fr-action="approve" data-fr-id="${esc(fid)}" data-fr-account-idx="${idx}"`, 'primary'));
      }
      if(da.accountStatus !== '반려'){
        footerButtons.push(adminModalButton('반려', `data-admin-action="fr-account-action" data-fr-action="reject" data-fr-id="${esc(fid)}" data-fr-account-idx="${idx}"`, 'danger'));
      }
      footerButtons.push(adminModalButton('숨김', `data-admin-action="fr-visibility" data-fr-vis-type="account" data-fr-id="${esc(fid)}" data-fr-target-id="${idx}" data-fr-hidden="true"`, 'danger'));
    }
    footerButtons.push(adminModalButton('닫기', 'data-modal-close="1"'));

    return {
      title: `계좌 등록 확인 — ${f.name || ''}`,
      body: `
    <div class="account-check-modal">
      <div class="account-check-head">
        <div class="account-check-title">
          <strong>${esc(f.name)}</strong>
          <span>${esc(da.agency || '-')} · ${esc(da.reqDate || '요청일 미확인')}</span>
        </div>
        <div>${bdg(da.accountStatus)}</div>
      </div>
      <div class="account-check-grid">
        <div class="account-check-item"><span class="k">가맹점</span><span class="v">${esc(f.name)}</span></div>
        <div class="account-check-item"><span class="k">상위대리점</span><span class="v">${esc(f.agency || f.agencyName || '-')}</span></div>
        <div class="account-check-item"><span class="k">배달대행사</span><span class="v">${esc(da.agency || '-')}</span></div>
        <div class="account-check-item full"><span class="k">가상계좌번호</span><span class="v mono">${esc(da.accountNo || '미입력')}</span></div>
        <div class="account-check-item full"><span class="k">증빙 파일명</span><span class="v">${esc(da.fileName || '파일 미첨부')}</span></div>
      </div>
      <div class="account-proof-box">${filePreview}</div>
    </div>
    ${da.rejectReason ? `<div class="aw aw-w admin-modal-spaced">반려 사유: ${esc(da.rejectReason)}</div>` : ''}
    ${readOnlyAccount ? `<div class="aw aw-g admin-modal-spaced">실제 결제/정산내역에서 확인된 계좌입니다. 수정은 계좌 승인 내역에서 처리해주세요.</div>` : ''}`,
      footerButtons
    };
  }

  api.pgAccounts = pgAccounts;
  api.collectAccountFilters = collectAccountFilters;
  api.clearAccountFilterFields = clearAccountFilterFields;
  api.accountExportPendingCount = accountExportPendingCount;
  api.filterAccountRows = filterAccountRows;
  api.renderAccountRows = renderAccountRows;
  api.renderAccountDetailModal = renderAccountDetailModal;
  window.EatsAdminAccounts = api;
})();
