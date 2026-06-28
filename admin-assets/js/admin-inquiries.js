(function () {
  'use strict';

  const root = window.EatsAdminInquiries || {};

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

  function pgInquiries(ctx) {
    const c = context(ctx);
    const esc = c.esc;
    const rows = (Array.isArray(c.data.inquiries) ? c.data.inquiries : [])
      .slice()
      .sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || '')));

    return `
  <div class="card">
    <div class="ch"><span class="admin-section-head-text">영업대리점 개설문의 <span class="tg">${rows.length}건</span></span><button class="btn bg2 sm" type="button" data-admin-action="inquiry-add">+ 문의 등록</button></div>
    <div class="tw"><table><thead><tr><th>상태</th><th>이름</th><th>휴대폰번호</th><th>배달대행사</th><th>희망지역</th><th>담당자</th><th>접수일시</th><th>처리</th></tr></thead><tbody>
    ${rows.map((inquiry) => `<tr><td>${c.bdg(inquiry.status || '상담 대기')}</td><td class="admin-text-bold">${esc(inquiry.name || '-')}</td><td>${esc(inquiry.phone || '-')}</td><td>${esc(inquiry.deliveryAgency || '-')}</td><td>${esc(inquiry.region || '-')}</td><td>${inquiry.handler ? esc(inquiry.handler) : '<span class="admin-empty-muted">미배정</span>'}</td><td>${esc(inquiry.date || String(inquiry.createdAt || '').slice(0, 10) || '-')}</td>
    <td><div class="admin-action-group">
      ${inquiry.status === '상담 대기' ? c.adminActionChip('완료', 'inquiry-complete', `data-inquiry-id="${esc(inquiry.id)}"`, 'primary') : ''}
      ${c.adminActionChip('수정', 'inquiry-edit', `data-inquiry-id="${esc(inquiry.id)}"`)}
      ${c.adminActionChip('삭제', 'inquiry-delete', `data-inquiry-id="${esc(inquiry.id)}"`, 'danger')}
    </div></td></tr>`).join('') || '<tr><td colspan="8" class="emp">등록된 개설문의가 없습니다.</td></tr>'}
    </tbody></table></div>
  </div>`;
  }

  root.pgInquiries = pgInquiries;
  window.EatsAdminInquiries = root;
}());
