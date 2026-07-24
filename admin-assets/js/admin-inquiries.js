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
      dateTimeHtml: ctx?.dateTimeHtml || window.EatsAdminDateTime?.html || ((value) => fallbackEsc(value || '-')),
      formatPhone: ctx?.formatPhone || window.EatsAdminPhone?.formatAdminPhone || ((value) => String(value || '').trim()),
    };
  }

  function memoCellHtml(inquiry, esc) {
    const memo = String(inquiry?.adminMemo || '').trim();
    if (!memo) {
      return '<td class="admin-inquiry-memo-cell is-empty"><span class="admin-inquiry-memo-state">메모 없음</span></td>';
    }
    return `<td class="admin-inquiry-memo-cell has-memo"><span class="admin-inquiry-memo-state">메모 있음</span><span class="admin-inquiry-memo-preview">${esc(memo)}</span></td>`;
  }

  function pgInquiries(ctx) {
    const c = context(ctx);
    const esc = c.esc;
    const rows = (Array.isArray(c.data.inquiries) ? c.data.inquiries : [])
      .slice()
      .sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')));

    return `
  <div class="card">
    <div class="ch"><span class="admin-section-head-text">가맹점/지점 문의 <span class="tg">${rows.length}건</span></span><button class="btn bg2 sm" type="button" data-admin-action="inquiry-add">+ 문의 등록</button></div>
    <div class="tw"><table><thead><tr><th>상태</th><th>문의 유형</th><th>성함 / 회사명</th><th>연락처</th><th>매장/희망지역</th><th>현 업종 / 상호명</th><th>알게된경로</th><th>관리자 메모</th><th>접수일시</th><th>처리</th></tr></thead><tbody>
    ${rows.map((inquiry) => `<tr><td>${c.bdg(inquiry.status || '상담 대기')}</td><td>${esc(inquiry.inquiryType || '지점/지사 개설')}</td><td class="admin-text-bold">${esc(inquiry.name || '-')}</td><td>${esc(c.formatPhone(inquiry.phone || '-'))}</td><td>${esc(inquiry.region || '-')}</td><td>${esc(inquiry.deliveryAgency || '-')}</td><td>${esc(inquiry.handler || '-')}</td>${memoCellHtml(inquiry, esc)}<td class="payment-date-cell">${c.dateTimeHtml(inquiry.createdAt || inquiry.date)}</td>
    <td class="admin-inquiry-actions-cell"><div class="admin-action-group admin-inquiry-action-grid">
      ${inquiry.status === '상담 대기' ? c.adminActionChip('완료', 'inquiry-complete', `data-inquiry-id="${esc(inquiry.id)}"`, 'primary') : '<span class="admin-action-chip is-static">완료됨</span>'}
      ${c.adminActionChip(String(inquiry.adminMemo || '').trim() ? '메모 수정' : '메모 작성', 'inquiry-memo-open', `data-inquiry-kind="agency" data-inquiry-id="${esc(inquiry.id)}"`, String(inquiry.adminMemo || '').trim() ? 'primary' : '')}
      ${c.adminActionChip('수정', 'inquiry-edit', `data-inquiry-id="${esc(inquiry.id)}"`)}
      ${c.adminActionChip('삭제', 'inquiry-delete', `data-inquiry-id="${esc(inquiry.id)}"`, 'danger')}
    </div></td></tr>`).join('') || '<tr><td colspan="10" class="emp">등록된 가맹점/지점 문의가 없습니다.</td></tr>'}
    </tbody></table></div>
  </div>`;
  }

  root.pgInquiries = pgInquiries;
  window.EatsAdminInquiries = root;
}());
