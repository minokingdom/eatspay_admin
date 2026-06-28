(function () {
  'use strict';

  const root = window.EatsAdminBoard || {};

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
      openM: ctx?.openM || window.openM,
      adminActionChip: ctx?.adminActionChip || window.adminActionChip,
      adminModalButton: ctx?.adminModalButton || window.adminModalButton,
      adminModalFooter: ctx?.adminModalFooter || window.adminModalFooter,
    };
  }

  function boardLabel(type) {
    return type === 'guides' ? '이용가이드' : '공지사항';
  }

  function boardAuthorDefault(type) {
    return type === 'guides' ? 'CS팀' : '운영팀';
  }

  function pgBoard(type, ctx) {
    const c = context(ctx);
    const esc = c.esc;
    const rows = Array.isArray(c.data[type]) ? c.data[type] : [];
    const label = boardLabel(type);

    return `<div class="admin-action-top"><button class="btn bg2" type="button" data-admin-action="board-add" data-board-type="${esc(type)}">+ ${label} 작성</button></div>
  <div class="card"><div class="tw"><table><thead><tr><th>제목</th><th>작성자</th><th>작성일시</th><th>관리</th></tr></thead><tbody>
  ${rows.map((item) => `<tr><td><button type="button" class="btn-link-text admin-board-link" data-admin-action="board-view" data-board-type="${esc(type)}" data-board-id="${esc(item.id)}">${esc(item.title)}</button></td><td>${esc(item.author || '운영팀')}</td><td>${esc(item.date || String(item.updatedAt || '').slice(0, 10) || '-')}</td><td><div class="admin-action-group">${c.adminActionChip('수정', 'board-edit', `data-board-type="${esc(type)}" data-board-id="${esc(item.id)}"`)}${c.adminActionChip('삭제', 'board-delete', `data-board-type="${esc(type)}" data-board-id="${esc(item.id)}"`, 'danger')}</div></td></tr>`).join('') || `<tr><td colspan="4" class="emp">게시글 없음</td></tr>`}
  </tbody></table></div></div>`;
  }

  function viewPost(type, id, ctx) {
    const c = context(ctx);
    const esc = c.esc;
    const item = (Array.isArray(c.data[type]) ? c.data[type] : []).find((entry) => String(entry.id) === String(id));
    if (!item || !c.openM) return;

    c.openM(
      esc(item.title),
      `<div class="admin-post-meta">${esc(item.author || '운영팀')} | ${esc(item.date || String(item.updatedAt || '').slice(0, 10) || '-')}</div><div class="admin-post-content">${esc(item.content)}</div>`,
      c.adminModalFooter(
        c.adminModalButton('수정', `data-admin-action="board-edit" data-board-type="${esc(type)}" data-board-id="${esc(id)}" data-modal-reopen="1"`),
        c.adminModalButton('확인', 'data-modal-close="1"', 'primary'),
      ),
    );
  }

  function pForm(item = {}, type = 'notices', ctx) {
    const c = context(ctx);
    const esc = c.esc;
    const label = boardLabel(type);
    const authorDefault = boardAuthorDefault(type);

    return `<div class="aw aw-g">${label}은 앱 고객센터의 ${label} 화면에 노출됩니다. 제목을 누르면 상세 내용이 표시됩니다.</div>
  <div class="fr2">
    <div class="fg"><label class="fl">게시판</label><input class="fi" value="${label}" disabled><div class="admin-modal-note">앱 고객센터 메뉴와 연결됩니다.</div></div>
    <div class="fg"><label class="fl">작성자</label><input class="fi" id="pa" value="${esc(item.author || authorDefault)}" placeholder="${authorDefault}"><div class="admin-modal-note">앱 상세 화면의 작성자 영역에 표시됩니다.</div></div>
  </div>
  <div class="fg"><label class="fl">제목 *</label><input class="fi" id="pt" value="${esc(item.title || '')}" placeholder="${label} 제목 입력"></div>
  <div class="fg"><label class="fl">내용 *</label><textarea class="fta" id="pc" rows="10" placeholder="앱에 표시할 본문을 입력하세요.">${esc(item.content || '')}</textarea><div class="admin-modal-note">줄바꿈은 앱 상세 화면에 그대로 반영됩니다.</div></div>`;
  }

  root.boardLabel = boardLabel;
  root.boardAuthorDefault = boardAuthorDefault;
  root.pgBoard = pgBoard;
  root.viewPost = viewPost;
  root.pForm = pForm;

  window.EatsAdminBoard = root;
}());
