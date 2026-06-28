(function () {
  'use strict';

  const root = window.EatsAdminPG || {};

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
      esc: ctx?.esc || window.esc || fallbackEsc,
      bdg: ctx?.bdg || window.bdg || ((value) => `<span>${fallbackEsc(value)}</span>`),
      adminActionChip: ctx?.adminActionChip || window.adminActionChip,
    };
  }

  function pgPG(ctx) {
    const c = context(ctx);
    const esc = c.esc;
    const providers = (Array.isArray(c.data.pgProviders) ? c.data.pgProviders : [])
      .slice()
      .sort((a, b) => (
        Number(a.displayOrder || 0) - Number(b.displayOrder || 0)
      ) || String(a.name || '').localeCompare(String(b.name || '')));
    const active = providers.filter((provider) => provider.status === '활성').length;
    const ready = providers.filter((provider) => provider.status === '준비중').length;
    const inactive = providers.filter((provider) => provider.status === '비활성').length;
    const configured = providers.filter((provider) => provider.mid || provider.apiKey || provider.callbackUrl).length;

    return `<div class="aw aw-b">PG사는 결제 연동 설정을 DB에 저장해 관리합니다. 현재 메인 PG는 GH Payments이며 빌링결제 TMN026063, 수기결제 TMN026062 기준입니다. 넥스트페이는 2차 PG로 유지합니다.</div>
  <div class="payment-summary-grid">
    <div class="payment-summary-card"><div class="payment-summary-label">전체 PG사</div><div class="payment-summary-value">${providers.length.toLocaleString()}개</div></div>
    <div class="payment-summary-card"><div class="payment-summary-label">활성</div><div class="payment-summary-value">${active.toLocaleString()}개</div></div>
    <div class="payment-summary-card"><div class="payment-summary-label">준비/비활성</div><div class="payment-summary-value">${(ready + inactive).toLocaleString()}개</div></div>
    <div class="payment-summary-card"><div class="payment-summary-label">연동값 등록</div><div class="payment-summary-value">${configured.toLocaleString()}개</div></div>
  </div>
  <div class="admin-toolbar">
    <div class="admin-section-title">PG사 연동 목록</div>
    <button type="button" class="btn bg2" data-admin-action="pg-add">+ PG사 추가</button>
  </div>
  <div class="card"><div class="tw"><table><thead><tr><th>PG사</th><th>터미널/MID</th><th>온라인 결제 Key</th><th>콜백 URL</th><th>상태</th><th>순서</th><th>비고</th><th>관리</th></tr></thead><tbody>
  ${providers.map((provider) => {
    const nextStatus = provider.status === '활성' ? '비활성' : '활성';
    const roleLabel = Number(provider.displayOrder || 0) === 1 ? '메인 PG' : Number(provider.displayOrder || 0) === 2 ? '2차 PG' : '';
    return `<tr><td><div class="admin-name-strong">${esc(provider.name)}</div><div class="admin-meta-small">ID ${esc(provider.id)}${roleLabel ? ` · ${roleLabel}` : ''}</div></td><td class="admin-mono admin-text-small">${esc(provider.mid || '-')}</td><td class="admin-mono admin-text-small">${esc(provider.apiKey || '-')}</td><td class="admin-cell-long">${esc(provider.callbackUrl || '-')}</td><td>${c.bdg(provider.status)}</td><td>${Number(provider.displayOrder || 0)}</td><td class="admin-text-muted admin-text-small">${esc(provider.note || '')}</td><td><div class="admin-action-group">${c.adminActionChip('수정', 'pg-edit', `data-pg-id="${esc(provider.id)}"`)}${c.adminActionChip(nextStatus, 'pg-toggle', `data-pg-id="${esc(provider.id)}" data-pg-status="${esc(nextStatus)}"`, provider.status === '활성' ? 'warn' : 'primary')}</div></td></tr>`;
  }).join('') || '<tr><td colspan="8" class="emp">등록된 PG사가 없습니다.</td></tr>'}
  </tbody></table></div></div>`;
  }

  root.pgPG = pgPG;
  window.EatsAdminPG = root;
}());
