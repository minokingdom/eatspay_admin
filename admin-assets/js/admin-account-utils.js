(function () {
  const root = window.EatsAdminAccountUtils || {};

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function accountDocumentUrl(account = {}) {
    const fileName = String(account.fileName || '').trim();
    const fileKey = String(account.fileKey || '').trim();
    if (account.documentUrl) return String(account.documentUrl);
    if (fileKey) return `/uploads/${encodeURIComponent(fileKey)}`;
    if (!fileName || fileName === '미첨부') return '';
    return `/api/files/${encodeURIComponent(fileName)}`;
  }

  function proofZoomButton(documentUrl, displayName = '증빙 이미지', imageClass = 'account-proof-img', altText = '증빙 이미지') {
    const safeUrl = esc(documentUrl);
    const safeName = esc(displayName || '증빙 이미지');
    return `<button type="button" class="proof-thumb-button" data-proof-zoom-open="1" data-proof-zoom-url="${safeUrl}" data-proof-zoom-name="${safeName}" title="확대/축소">
      <img src="${safeUrl}" alt="${esc(altText || displayName || '증빙 이미지')}" class="${esc(imageClass)}">
    </button>`;
  }

  function accountProofPreview(account = {}) {
    const fileName = String(account.fileName || '').trim();
    const documentUrl = accountDocumentUrl(account);
    const safeUrl = esc(documentUrl);
    const isImage = /\.(png|jpe?g|gif|webp)$/i.test(documentUrl || fileName);
    if (!documentUrl) {
      return '<div class="account-proof-preview-empty">포스 사진 미첨부</div>';
    }
    return `<div class="account-proof-preview">
      ${isImage
        ? proofZoomButton(documentUrl, fileName || '포스 증빙 사진', 'account-proof-preview-img', '포스 증빙 사진')
        : '<div class="account-proof-preview-note">이미지 미리보기를 지원하지 않는 파일입니다.</div>'}
      <a class="btn bo xs" href="${safeUrl}" target="_blank" rel="noopener">원본 열기</a>
    </div>`;
  }

  function accountEditForm(franchise = {}, account = {}) {
    const canReupload = account.accountStatus === '승인대기';
    return `
      <div class="fr2"><div class="fg"><label class="fl">가맹점명</label><input class="fi" value="${esc(franchise.name || '')}" disabled></div><div class="fg"><label class="fl">현재 상태</label><input class="fi" value="${esc(account.accountStatus || '-')}" disabled></div></div>
      <div class="fr2"><div class="fg"><label class="fl">배달대행사</label><input class="fi" id="mae-agency" value="${esc(account.agency || '')}"></div><div class="fg"><label class="fl">은행</label><input class="fi" id="mae-bank" value="${esc(account.bankName || account.agency || '')}"></div></div>
      <div class="fr2"><div class="fg"><label class="fl">가상계좌번호 *</label><input class="fi" id="mae-account" value="${esc(account.accountNo || '')}" placeholder="숫자 또는 하이픈"></div><div class="fg"><label class="fl">예금주/대표자</label><input class="fi" id="mae-holder" value="${esc(account.accountHolder || franchise.owner || '')}"></div></div>
      <div class="fg"><label class="fl">증빙파일명</label><input class="fi" value="${esc(account.fileName || '미첨부')}" disabled></div>
      <div class="fg"><label class="fl">포스 사진 확인</label>${accountProofPreview(account)}</div>
      ${canReupload ? '<div class="fg"><label class="fl">포스 사진 재업로드</label><input class="fi" id="mae-document-file" type="file" accept=".jpg,.jpeg,.png,.pdf,image/*,application/pdf"><div class="account-proof-reupload-note">승인대기 상태에서만 증빙 사진을 교체할 수 있습니다.</div></div>' : ''}`;
  }

  function getManagedAccountIdentity(account = {}) {
    const source = account.source || 'account_request';
    const id = source === 'delivery_account' ? (account.id || account.accountId) : account.requestId;
    return { id, source };
  }

  window.EatsAdminAccountUtils = Object.assign(root, {
    version: '2026-06-26.account-utils.1',
    accountDocumentUrl,
    proofZoomButton,
    accountProofPreview,
    accountEditForm,
    getManagedAccountIdentity
  });
})();
