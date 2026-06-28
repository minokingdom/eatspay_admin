(function () {
  'use strict';

  const root = window.EatsAdminAdmins || {};

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
      getRoles: ctx?.getRoles || window.getRoles || (() => []),
      roleClassKey: ctx?.roleClassKey || window.roleClassKey || (() => 'customer'),
      adminActionChip: ctx?.adminActionChip || window.adminActionChip,
    };
  }

  function pgAdmins(ctx) {
    const c = context(ctx);
    const esc = c.esc;
    const roles = c.getRoles();
    const admins = Array.isArray(c.data.admins) ? c.data.admins : [];

    return `
  <div class="admin-action-top"><button class="btn bg2" type="button" data-admin-action="adm-add">+ 관리자 생성</button></div>
  <div class="card"><div class="tw"><table><thead><tr><th>아이디</th><th>이름</th><th>권한 레벨</th><th>마지막 로그인</th><th>관리</th></tr></thead><tbody>
  ${admins.map((admin) => `<tr><td class="admin-mono admin-text-small">${esc(admin.loginId || admin.email || '-')}</td><td class="admin-text-semi">${esc(admin.name || '-')}</td><td>${c.bdg(admin.adminRoleLabel || admin.role || '총괄 관리자')}</td><td class="admin-empty-muted">${esc(admin.lastLogin || '-')}</td><td><div class="admin-action-group">${c.adminActionChip('수정', 'adm-edit', `data-adm-id="${esc(admin.id)}"`)}${c.adminActionChip('삭제', 'adm-delete', `data-adm-id="${esc(admin.id)}"`, 'danger')}</div></td></tr>`).join('') || '<tr><td colspan="5" class="emp">등록된 관리자 계정이 없습니다.</td></tr>'}
  </tbody></table></div></div>
  <div class="card"><div class="ch"><span class="admin-section-head-text">권한 레벨 정의 &amp; 이름 수정</span><button class="btn bg2 sm" type="button" data-admin-action="roles-edit">이름 수정</button></div>
  <div class="admin-role-grid">
  ${roles.map((role) => `<div class="role-card"><div class="role-head role-head-${esc(c.roleClassKey(role))}">${esc(role.name)}</div><div class="role-body">${esc(role.desc)}</div></div>`).join('')}
  </div></div>`;
  }

  root.pgAdmins = pgAdmins;
  window.EatsAdminAdmins = root;
}());
