(function () {
  'use strict';

  const root = window.EatsAdminBanners || {};

  function fallbackEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (match) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[match]));
  }

  function context(ctx) {
    return {
      data: ctx?.data || {},
      bannerTab: ctx?.bannerTab || '메인',
      esc: ctx?.esc || window.esc || fallbackEsc,
      jsArg: ctx?.jsArg || window.jsArg || ((value) => `'${fallbackEsc(value)}'`),
      adminActionChip: ctx?.adminActionChip || window.adminActionChip,
    };
  }

  function bannerStatusBadge(status) {
    const s = status || '활성';
    if (s === '활성') return '<span class="admin-banner-status-pill is-active">노출중</span>';
    if (s === '예약') return '<span class="admin-banner-status-pill is-wait">예약</span>';
    return '<span class="admin-banner-status-pill is-off">비노출</span>';
  }

  function bannerPeriodText(banner) {
    const start = String(banner.startAt || '').slice(0, 10);
    const end = String(banner.endAt || '').slice(0, 10);
    if (start && end) return `${start} ~ ${end}`;
    if (start) return `${start} 시작`;
    if (end) return `${end} 종료`;
    return '상시 노출';
  }

  function pgBanners(ctx) {
    const c = context(ctx);
    const esc = c.esc;
    const tabs = ['메인', '결제', '이츠톡', '고객센터'];
    const list = (Array.isArray(c.data.banners) ? c.data.banners : [])
      .slice()
      .sort((a, b) => (
        Number((a.order ?? a.displayOrder) || 0) - Number((b.order ?? b.displayOrder) || 0)
      ) || String(b.id || '').localeCompare(String(a.id || '')));
    const filtered = list.filter((banner) => (banner.type || '메인') === c.bannerTab);
    const active = list.filter((banner) => (banner.status || '활성') === '활성').length;
    const inactive = list.filter((banner) => (banner.status || '활성') !== '활성').length;

    return `
  <div class="admin-page-head">
    <div>
      <div class="admin-page-title-lg">배너 관리</div>
      <div class="admin-page-subtitle">앱 홈/결제/이츠톡/고객센터에 노출할 안내 배너를 관리합니다.</div>
    </div>
    <button class="btn bg2" type="button" data-admin-action="banner-add">+ 배너 추가</button>
  </div>
  <div class="admin-summary-grid-3">
    <div class="card admin-card-pad"><div class="admin-summary-label">전체 배너</div><div class="admin-summary-value">${list.length}개</div></div>
    <div class="card admin-card-pad"><div class="admin-summary-label">활성</div><div class="admin-summary-value admin-summary-value-success">${active}개</div></div>
    <div class="card admin-card-pad"><div class="admin-summary-label">비활성/예약</div><div class="admin-summary-value admin-summary-value-warning">${inactive}개</div></div>
  </div>
  <div class="admin-toolbar">
    <div class="tabs admin-tab-strip">${tabs.map((tab) => `<div class="tab ${c.bannerTab === tab ? 'on' : ''}" data-admin-action="banner-tab" data-banner-tab-key="${esc(tab)}">${esc(tab)}</div>`).join('')}</div>
    <div class="admin-page-subtitle">현재 탭 ${filtered.length}개</div>
  </div>
  <div class="admin-banner-placement-guide">
    <span><b>메인</b> 앱 홈</span>
    <span><b>결제</b> 배달대행비 결제/충전 화면</span>
    <span><b>이츠톡</b> 이츠톡 목록 상단</span>
    <span><b>고객센터</b> 고객센터 메인</span>
  </div>
  <div class="card"><div class="tw"><table class="admin-banner-table"><thead><tr><th>순서</th><th>미리보기</th><th>제목/내용</th><th>클릭 이동</th><th>노출 기간</th><th>상태</th><th>관리</th></tr></thead><tbody>
  ${filtered.map((banner) => {
    const isActive = (banner.status || '활성') === '활성';
    const nextStatus = isActive ? '비활성' : '활성';
    return `<tr>
      <td class="admin-text-soft admin-fw-800">${Number((banner.order ?? banner.displayOrder) || 0)}</td>
      <td><div class="admin-banner-preview">
        ${banner.imageUrl ? `<img src="${esc(banner.imageUrl)}" alt="" class="admin-banner-preview-img">` : ''}
        <div class="admin-banner-preview-title">${esc(banner.title || '-')}</div>
      </div></td>
      <td><div class="admin-banner-title">${esc(banner.title || '-')}</div><div class="admin-banner-subtitle">${esc(banner.subtitle || '설명 없음')}</div></td>
      <td class="admin-link-cell">${esc(banner.url || '이동 없음')}</td>
      <td class="admin-period-cell">${esc(bannerPeriodText(banner))}</td>
      <td><button type="button" class="admin-banner-switch ${isActive ? 'is-on' : 'is-off'}" data-admin-action="banner-status" data-banner-id="${esc(banner.id)}" data-banner-next-status="${nextStatus}" aria-pressed="${isActive ? 'true' : 'false'}"><span class="admin-banner-switch-track"><span class="admin-banner-switch-thumb"></span></span><span class="admin-banner-switch-label">${isActive ? '노출' : '숨김'}</span></button></td>
      <td><div class="admin-action-group">${c.adminActionChip('수정', 'banner-edit', `data-banner-id="${esc(banner.id)}"`)}${c.adminActionChip('삭제', 'banner-delete', `data-banner-id="${esc(banner.id)}"`, 'danger')}</div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="emp">등록된 배너가 없습니다.</td></tr>'}
  </tbody></table></div></div>`;
  }

  root.pgBanners = pgBanners;
  root.bannerStatusBadge = bannerStatusBadge;
  root.bannerPeriodText = bannerPeriodText;
  window.EatsAdminBanners = root;
}());
