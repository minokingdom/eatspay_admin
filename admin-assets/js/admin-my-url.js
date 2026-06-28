(function(){
  'use strict';

  const api = window.EatsAdminMyUrl || {};

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
      agency: safe.agency || null,
      url: safe.url || '',
      esc: typeof safe.esc === 'function' ? safe.esc : fallbackEsc
    };
  }

  function pgMyUrl(ctx){
    const {agency, url, esc} = resolveContext(ctx);
    if(!agency) return '<div class="aw aw-w">선택된 영업대리점이 없습니다.</div>';

    return `
  <div class="admin-url-page">
    <div class="admin-url-icon">🔗</div>
    <div class="admin-url-title">내 가맹점 가입 URL</div>
    <div class="admin-url-desc">이 URL을 가맹점에 전달하면 내 하위 가맹점으로 자동 등록됩니다</div>
    <div class="urlbox admin-url-box">
      <div class="admin-url-label">가입 URL</div>
      <div class="admin-url-value">${esc(url)}</div>
      <div class="admin-url-actions">
        <button class="btn bg2" type="button" data-copy-text="${esc(url)}">URL 복사</button>
        <button class="btn bo" type="button" data-admin-action="ag-join-qr" data-ag-target-id="${esc(agency.id)}">QR 보기</button>
      </div>
    </div>
    <div class="admin-url-help">
      <div class="admin-url-help-title">ⓘ 안내</div>
      <div class="admin-url-help-body">• 가맹점이 이 URL로 가입하면 자동으로 내 하위 가맹점이 됩니다<br>• URL을 카카오톡, 문자 등으로 가맹점에 전달해 주세요<br>• URL은 최초 발급 후 변경되지 않습니다</div>
    </div>
  </div>`;
  }

  api.pgMyUrl = pgMyUrl;
  window.EatsAdminMyUrl = api;
}());
