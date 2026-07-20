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
    const rejectionReasons = normalizeRejectionReasons(ctx.accountRejectionReasons);
    const deliveryOptions = deliveryAgencies
      .filter(a => a && a.status !== 'deleted')
      .map(a => ({ val: a.name, label: a.name }));

    return `
  <div class="accounts-list-layout">
    <div class="accounts-filter-panel">
      <div class="card accounts-filter-card">
        ${fRow('상태',`<select class="fs" id="acst" data-account-filter="1"><option value="">전체</option><option value="승인완료">정상 승인</option><option value="승인대기">승인 대기</option><option value="반려">반려</option></select>`)}
        ${fRow('회원 아이디',`<input class="fi" id="acuid" placeholder="회원 아이디" data-account-filter="1">`)}
        ${fRow('가맹점명',`<input class="fi" id="acfn" placeholder="가맹점명" data-account-filter="1">`)}
        ${fRow('배달대행사',makeSdd('acda',deliveryOptions,'rAcc()'))}
        ${fRow('계좌번호/예금주명',`<input class="fi" id="acacct" placeholder="계좌번호 또는 예금주" data-account-filter="1">`)}
        <button type="button" class="btn bg2 accounts-filter-action accounts-filter-action-main" data-account-search="1">검색</button>
        <button type="button" class="btn bo accounts-filter-action" data-account-clear="1">초기화</button>
        ${renderRejectionReasonManager(rejectionReasons)}
      </div>
    </div>
    <div class="card accounts-list-main">
      <div class="ch"><span class="admin-card-heading">출금계좌 목록</span><span class="admin-card-tools payment-list-tools"><span id="account-result-count" class="bdg bg payment-result-count">0건</span><label class="admin-inline-select payment-page-size-label">표시 <select class="fs" id="account-page-size"><option value="20">20개</option><option value="50">50개</option><option value="100">100개</option></select></label><span class="payment-list-pager"><button type="button" class="btn bo xs" data-account-page="prev">이전</button><span id="account-page-label" class="admin-table-subhead">1 / 1</span><button type="button" class="btn bo xs" data-account-page="next">다음</button></span><button type="button" class="btn bg2 xs" data-account-list-export="1">전체 계좌 내보내기</button><button type="button" class="btn bo xs" data-account-pg-migration-export="gh">건흥 양식 내보내기</button><button type="button" class="btn bo xs" data-account-txid-upload-open="account-migration-txid-upload">건흥 결과 업로드</button><input type="file" id="account-migration-txid-upload" class="admin-hidden-input" accept=".xlsx,.xls" data-account-txid-upload-input="1"><button type="button" class="btn bo xs" data-account-pg-migration-export="routeup">위루트 양식 내보내기</button><button type="button" class="btn bo xs" data-account-pg-migration-upload="routeup">위루트 서버 업로드</button></span></div>
      <div class="tw"><table class="accounts-table accounts-table-wide"><colgroup><col class="admin-col-120"><col class="admin-col-130"><col class="admin-col-170"><col class="admin-col-130"><col class="admin-col-130"><col class="admin-col-110"><col class="admin-col-160"><col class="admin-col-120"><col class="admin-col-110"><col class="admin-col-76"></colgroup><thead><tr><th>상태</th><th>회원 아이디</th><th>가맹점명</th><th>배달대행사</th><th>활성 PG</th><th>은행</th><th>계좌번호</th><th>예금주명</th><th>등록일시</th><th>확인</th></tr></thead><tbody id="acb"></tbody></table></div>
    </div>
  </div>`;
  }

  function normalizeRejectionReasons(reasons = []) {
    const values = (Array.isArray(reasons) ? reasons : [])
      .map(item => typeof item === 'string' ? item : item?.reason)
      .map(reason => String(reason || '').trim())
      .filter(Boolean);
    return values.length ? values : ['계좌번호 확인 불가', '예금주 불일치', '증빙 사진 식별 불가', '배달대행사 정보 불일치', '기타'];
  }

  function renderRejectionReasonManager(reasons = []) {
    const rows = normalizeRejectionReasons(reasons).map((reason, index) => `
      <div class="account-rejection-reason-row">
        <input class="fi" value="${fallbackEsc(reason)}" data-account-rejection-reason-input="${index}">
        <button type="button" class="btn bd xs" data-account-rejection-reason-delete="${index}">삭제</button>
      </div>
    `).join('');
    return `
      <section class="account-rejection-reasons-panel" aria-label="반려 사유 관리">
        <div class="account-rejection-reasons-head">
          <span class="admin-card-heading">반려 사유 관리</span>
          <button type="button" class="btn bo xs" data-account-rejection-reason-add="1">추가</button>
        </div>
        <div class="account-rejection-reason-list" data-account-rejection-reason-list="1">${rows}</div>
        <div class="account-rejection-reason-actions">
          <button type="button" class="btn bg2 xs" data-account-rejection-reason-save="1">저장</button>
        </div>
      </section>
    `;
  }

  function normalizeProviderName(value = '') {
    const raw = String(value || '').trim();
    const key = raw.replace(/\s+/g, '').toLowerCase();
    if (['routeup', 'route', '위루트'].includes(key)) return '위루트';
    if (['ghpayments', 'ghpayment', 'gh', '건흥', '건흥페이먼츠'].includes(key)) return 'GH Payments';
    return raw;
  }

  function pgSecretLabel(contract = {}, field) {
    const raw = field === 'signature'
      ? (contract.signatureKey || contract.signatureKeyMasked || '')
      : (contract.paymentKey || contract.paymentKeyMasked || contract.key || '');
    return fallbackEsc(raw || '미등록');
  }

  function routeupExternalKeyStatus(contract = {}, field = 'api') {
    const metadata = contract.metadata && typeof contract.metadata === 'object' ? contract.metadata : {};
    const values = {
      api: contract.routeupApiKey || contract.routeupApiKeyMasked || contract.hasRouteupApiKey || metadata.routeupApiKey || metadata.routeupApiKeyMasked || metadata.apiKey || metadata.apiKeyMasked || '',
      encryption: contract.routeupEncryptionKey || contract.routeupEncryptionKeyMasked || contract.hasRouteupEncryptionKey || metadata.routeupEncryptionKey || metadata.routeupEncryptionKeyMasked || metadata.encryptionKey || metadata.encryptionKeyMasked || metadata.encryptKey || metadata.encryptKeyMasked || '',
      iv: contract.initializationVector || contract.initializationVectorMasked || contract.hasInitializationVector || metadata.initializationVector || metadata.initializationVectorMasked || metadata.hasInitializationVector || metadata.iv || metadata.ivMasked || ''
    };
    return values[field] ? '등록완료' : '미등록';
  }

  function hasRegisteredValue(...values) {
    return values.some(value => value === true || String(value || '').trim());
  }

  function hasContractTidKey(contract = {}) {
    return contract.active !== false && Boolean(
      String(contract.tid || contract.txid || '').trim() &&
      hasRegisteredValue(contract.paymentKey, contract.paymentKeyMasked, contract.payKey, contract.key, contract.hasPaymentKey)
    );
  }

  function hasCompleteRouteupKeys(contract = {}) {
    if (contract.active === false) return false;
    const metadata = contract.metadata && typeof contract.metadata === 'object' ? contract.metadata : {};
    return Boolean(
      hasRegisteredValue(contract.routeupApiKey, contract.routeupApiKeyMasked, contract.apiKey, contract.apiKeyMasked, contract.hasRouteupApiKey, metadata.routeupApiKey, metadata.routeupApiKeyMasked, metadata.apiKey, metadata.apiKeyMasked, metadata.hasRouteupApiKey) &&
      hasRegisteredValue(contract.routeupEncryptionKey, contract.routeupEncryptionKeyMasked, contract.encryptionKey, contract.encryptionKeyMasked, contract.encryptKey, contract.encryptKeyMasked, contract.hasRouteupEncryptionKey, metadata.routeupEncryptionKey, metadata.routeupEncryptionKeyMasked, metadata.encryptionKey, metadata.encryptionKeyMasked, metadata.encryptKey, metadata.encryptKeyMasked, metadata.hasRouteupEncryptionKey) &&
      hasRegisteredValue(contract.initializationVector, contract.initializationVectorMasked, contract.iv, contract.ivMasked, contract.hasInitializationVector, metadata.initializationVector, metadata.initializationVectorMasked, metadata.iv, metadata.ivMasked, metadata.hasInitializationVector)
    );
  }

  function getActivePgProviderNames(account = {}) {
    const contracts = Array.isArray(account.pgContracts) ? account.pgContracts : [];
    const ghLegacyActive = Boolean(
      (String(account.recurringTid || account.txid || '').trim() && hasRegisteredValue(account.recurringKey, account.recurringKeyMasked, account.hasRecurringKey)) ||
      (String(account.manualTid || '').trim() && hasRegisteredValue(account.manualKey, account.manualKeyMasked, account.hasManualKey))
    );
    const ghContractActive = contracts.some(contract =>
      normalizeProviderName(contract.providerName) === 'GH Payments' && hasContractTidKey(contract)
    );
    const routeupActive = contracts.some(contract =>
      normalizeProviderName(contract.providerName) === '위루트' &&
      (hasContractTidKey(contract) || hasCompleteRouteupKeys(contract))
    );
    const providers = [];
    if (ghLegacyActive || ghContractActive) providers.push('GH Payments');
    if (routeupActive) providers.push('위루트');
    return providers;
  }

  function renderActivePgBadges(account = {}, esc = fallbackEsc) {
    const providers = getActivePgProviderNames(account);
    if (!providers.length) return '<span class="bdg">미활성</span>';
    return `<span class="account-export-group account-active-pg" aria-label="활성 PG">${providers.map(provider => {
      const isRouteup = provider === '위루트';
      return `<span class="bdg ${isRouteup ? 'account-provider-routeup' : 'account-provider-gh'}">${isRouteup ? '위루트' : '건흥'}</span>`;
    }).join('')}</span>`;
  }

  function renderPgContractGridItems(account = {}, franchise = {}, ctx = {}) {
    if ((ctx.role || '') !== 'hq' && ctx.isHq !== true) return '';
    const contracts = Array.isArray(account.pgContracts) ? account.pgContracts : [];
    const selectedProvider = normalizeProviderName(franchise.pgProviderName);
    const routeup = contracts.find(item => normalizeProviderName(item.providerName) === '위루트');
    if (routeup || selectedProvider === '위루트') {
      const contract = routeup || {};
      const optionalTid = contract.tid ? `<div class="account-check-item"><span class="k">TID</span><span class="v mono">${fallbackEsc(contract.tid)}</span></div>` : '';
      const optionalPaymentKey = contract.paymentKey || contract.paymentKeyMasked || contract.key || contract.hasPaymentKey
        ? '<div class="account-check-item"><span class="k">결제 KEY</span><span class="v mono">등록완료</span></div>'
        : '';
      return `
        <div class="account-check-item"><span class="k">PG사</span><span class="v">위루트</span></div>
        <div class="account-check-item"><span class="k">API KEY</span><span class="v mono">${routeupExternalKeyStatus(contract, 'api')}</span></div>
        <div class="account-check-item"><span class="k">암호화 KEY</span><span class="v mono">${routeupExternalKeyStatus(contract, 'encryption')}</span></div>
        <div class="account-check-item"><span class="k">IV</span><span class="v mono">${routeupExternalKeyStatus(contract, 'iv')}</span></div>
        ${optionalTid}${optionalPaymentKey}
      `;
    }
    return `
        <div class="account-check-item"><span class="k">PG사</span><span class="v">${fallbackEsc(normalizeProviderName(franchise.pgProviderName) || 'GH Payments')}</span></div>
        <div class="account-check-item"><span class="k">정기 TID</span><span class="v mono">${fallbackEsc(account.recurringTid || account.txid || '미등록')}</span></div>
        <div class="account-check-item"><span class="k">정기 Key</span><span class="v mono">${fallbackEsc(account.recurringKey || account.recurringKeyMasked || '미등록')}</span></div>
        <div class="account-check-item"><span class="k">수기 TID</span><span class="v mono">${fallbackEsc(account.manualTid || '미등록')}</span></div>
        <div class="account-check-item"><span class="k">수기 Key</span><span class="v mono">${fallbackEsc(account.manualKey || account.manualKeyMasked || '미등록')}</span></div>
    `;
  }

  function renderAccountRows(rows = [], ctx = {}){
    const esc = typeof ctx.esc === 'function' ? ctx.esc : fallbackEsc;
    const bdg = typeof ctx.bdg === 'function' ? ctx.bdg : value => `<span class="bdg">${esc(value || '-')}</span>`;

    if(!Array.isArray(rows) || !rows.length){
      return '<tr><td colspan="10" class="emp">검색 결과 없음</td></tr>';
    }

    return rows.map(a => `<tr>
    <td>${bdg(a.accountStatus)}</td>
    <td class="accounts-member-id">${esc(a.memberId)}</td>
    <td class="accounts-franchise-name">${esc(a.fname)}</td>
    <td>${esc(a.agency||'-')}</td>
    <td>${renderActivePgBadges(a, esc)}</td>
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
        rows.push({fid:f.id,fname:f.name,fagency:f.agency,memberId,owner:f.owner,pgProviderName:f.pgProviderName,idx:i,...da});
      });
    });

    return rows;
  }

  function buildAccountListExportRows(rows = []){
    return (Array.isArray(rows) ? rows : []).map(account => ({
      status: account.accountStatus || account.approvalStatus || '-',
      memberId: account.memberId || '',
      franchiseName: account.fname || account.franchiseName || '',
      deliveryAgency: account.agency || '',
      pgProvider: normalizeProviderName(account.pgProviderName) || 'GH Payments',
      activePgProviders: getActivePgProviderNames(account).map(provider => provider === 'GH Payments' ? '건흥' : provider).join(', ') || '미활성',
      bankName: account.bankName || '',
      accountNo: account.accountNo || '',
      accountHolder: account.accountHolder || account.owner || '',
      registeredAt: account.submittedAt || account.createdAt || account.reqDate || '',
      verifiedAt: account.exportReadyAt || account.approvedAt || ''
    }));
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
    const isHq = (ctx.role || '') === 'hq' || ctx.isHq === true;
    const readOnlyAccount = da.readonly === true || da.source === 'pg_settlement';
    const accountNo = String(da.accountNo || '').trim();
    const bankName = String(da.bankName || '').trim();
    const documentUrl = da.documentUrl || (da.fileKey ? `/uploads/${encodeURIComponent(da.fileKey)}` : '');
    const isImage = /\.(png|jpe?g|gif|webp)$/i.test(documentUrl || da.fileName || '');
    const proofZoomButton = window.EatsAdminAccountUtils?.proofZoomButton;
    const filePreview = documentUrl
      ? (isImage
        ? (typeof proofZoomButton === 'function'
          ? proofZoomButton(documentUrl, da.fileName || '증빙 이미지', 'account-proof-img', '증빙 이미지', accountNo)
          : `<button type="button" class="proof-thumb-button" data-proof-zoom-open="1" data-proof-zoom-url="${esc(documentUrl)}" data-proof-zoom-name="${esc(da.fileName || '증빙 이미지')}" data-proof-zoom-reference="${esc(accountNo)}" title="확대/축소"><img src="${esc(documentUrl)}" alt="증빙 이미지" class="account-proof-img"></button>`)
        : `<a class="btn bo" href="${esc(documentUrl)}" target="_blank" rel="noopener">증빙 파일 열기</a>`)
      : `<div class="account-proof-empty"><span>파일 없음</span><small>업로드된 증빙 파일이 없습니다.</small></div>`;
    const footerButtons = [];

    if(isHq && !readOnlyAccount){
      const canReverify = da.accountStatus === '승인완료' || da.approvalStatus === 'APPROVED' || String(da.exportReadyAt || '').trim();
      if(canReverify){
        footerButtons.push(adminModalButton('재검증', `data-admin-action="fr-account-action" data-fr-action="reverify" data-fr-id="${esc(fid)}" data-fr-account-idx="${idx}"`, 'secondary'));
      }else{
        footerButtons.push(adminModalButton('검증', `data-admin-action="fr-account-action" data-fr-action="approve" data-fr-id="${esc(fid)}" data-fr-account-idx="${idx}"`, 'primary'));
      }
      if(da.accountStatus !== '반려'){
        footerButtons.push(adminModalButton('반려', `data-admin-action="fr-account-action" data-fr-action="reject" data-fr-id="${esc(fid)}" data-fr-account-idx="${idx}"`, 'danger'));
      }
      footerButtons.push(adminModalButton('PG 계약 수정', `data-admin-action="account-pg-contract-edit" data-fr-id="${esc(fid)}" data-fr-account-idx="${idx}"`, 'secondary'));
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
        <div class="account-check-item"><span class="k">은행명</span><span class="v">${esc(bankName || '-')}</span></div>
        <div class="account-check-item full"><span class="k">가상계좌번호</span><span class="v mono">${esc(accountNo || '미입력')}</span></div>
      </div>
      <div class="account-proof-workbench">
        <aside class="account-proof-reference" aria-label="계좌 검증 기준">
          <span class="account-proof-reference-label">비교할 등록 계좌</span>
          <strong class="account-proof-reference-bank">${esc(bankName || '은행 미입력')}</strong>
          <code>${esc(accountNo || '미입력')}</code>
          <p>증빙 이미지의 계좌번호와 위 번호가 같은지 확인하세요.</p>
          <div class="account-proof-crop-preview" data-account-proof-crop-preview hidden>
            <span>선택한 계좌 영역</span>
            <div class="account-proof-crop-frame">
              <canvas data-account-proof-crop-canvas aria-label="선택한 계좌번호 영역 미리보기"></canvas>
              <div class="account-proof-crop-ocr" data-account-proof-crop-ocr hidden></div>
              <div class="account-proof-character-layer" data-account-proof-character-layer aria-hidden="true"></div>
            </div>
          </div>
          <div class="account-proof-reference-actions">
            ${accountNo ? `<button type="button" class="btn bo" data-copy-text="${esc(accountNo)}">계좌번호 복사</button>` : ''}
            ${documentUrl && isImage && accountNo ? `<button type="button" class="btn bg2 account-proof-ocr-button" data-admin-action="account-proof-ocr" data-proof-document-url="${esc(documentUrl)}" data-proof-account-no="${esc(accountNo)}">계좌번호 자동 인식</button>` : ''}
          </div>
          <div class="account-proof-ocr-result" data-account-proof-ocr-result aria-live="polite" hidden></div>
        </aside>
        <div class="account-proof-box">${filePreview}</div>
      </div>
      <section class="account-pg-contract-section" aria-label="PG 계약 정보">
        <div class="account-pg-contract-heading">
          <strong>PG 계약 정보</strong>
          <span>계좌 확인 후 등록하거나 수정하는 정보입니다.</span>
        </div>
        <div class="account-check-grid account-pg-contract-grid">
          ${renderPgContractGridItems(da, f, ctx)}
          <div class="account-check-item full"><span class="k">증빙 파일명</span><span class="v">${esc(da.fileName || '파일 미첨부')}</span></div>
        </div>
      </section>
    </div>
    ${da.rejectReason ? `<div class="aw aw-w admin-modal-spaced">반려 사유: ${esc(da.rejectReason)}</div>` : ''}
    ${readOnlyAccount ? `<div class="aw aw-g admin-modal-spaced">실제 결제/정산내역에서 확인된 계좌입니다. 수정은 계좌 승인 내역에서 처리해주세요.</div>` : ''}`,
      footerButtons
    };
  }

  api.pgAccounts = pgAccounts;
  api.normalizeRejectionReasons = normalizeRejectionReasons;
  api.renderRejectionReasonManager = renderRejectionReasonManager;
  api.collectAccountFilters = collectAccountFilters;
  api.clearAccountFilterFields = clearAccountFilterFields;
  api.accountExportPendingCount = accountExportPendingCount;
  api.getActivePgProviderNames = getActivePgProviderNames;
  api.filterAccountRows = filterAccountRows;
  api.buildAccountListExportRows = buildAccountListExportRows;
  api.renderAccountRows = renderAccountRows;
  api.renderAccountDetailModal = renderAccountDetailModal;
  window.EatsAdminAccounts = api;
})();


