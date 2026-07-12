(function () {
  'use strict';
  let timer = null;

  function pgMessageQueue() {
    return `<div class="kgrid admin-kpi-grid-4">
      <div class="kpi"><div class="kl">대기</div><div class="kv" id="message-queue-waiting">-</div><div class="ks">발송 대기 작업</div></div>
      <div class="kpi"><div class="kl">처리 중</div><div class="kv" id="message-queue-running">-</div><div class="ks">현재 워커 작업</div></div>
      <div class="kpi"><div class="kl">오늘 완료</div><div class="kv" id="message-queue-completed">-</div><div class="ks">정상 종료 작업</div></div>
      <div class="kpi"><div class="kl">실패</div><div class="kv" id="message-queue-failed">-</div><div class="ks">확인·재시도 필요</div></div>
    </div>
    <div class="card"><div class="ch"><span class="admin-section-head-text">메시지 작업</span><button class="btn bo sm" type="button" data-message-queue-action="refresh">새로고침</button></div>
      <div class="tw"><table><thead><tr><th>접수 시각</th><th>제목</th><th>대상</th><th>진행률</th><th>상태</th><th>관리</th></tr></thead><tbody id="message-queue-rows"><tr><td colspan="6" class="emp">불러오는 중입니다.</td></tr></tbody></table></div>
    </div>`;
  }

  const text = value => String(value == null ? '' : value);
  const esc = value => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const statusLabel = status => ({ queued: '대기', retry_wait: '재시도 대기', running: '처리 중', completed: '완료', failed: '실패', cancelled: '취소' })[status] || status;

  async function request(url, options = {}) {
    const requestOptions = {
      ...options,
      headers: typeof window.adminAuthHeaders === 'function'
        ? window.adminAuthHeaders(options.headers || {})
        : (options.headers || {})
    };
    const response = await fetch(url, requestOptions);
    if (typeof window.handleAdminUnauthorized === 'function' && await window.handleAdminUnauthorized(response)) {
      throw new Error('관리자 로그인이 만료되었습니다. 다시 로그인해 주세요.');
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = json.error?.code === 'ACCESS_DENIED'
        ? '메시지 작업은 시스템 관리자만 확인할 수 있습니다.'
        : (json.error?.message || json.message || '메시지 큐를 불러오지 못했습니다.');
      throw new Error(message);
    }
    return json.data;
  }

  async function loadMessageQueue() {
    const [summary, jobs] = await Promise.all([request('/api/admin/message-jobs/summary'), request('/api/admin/message-jobs?limit=50')]);
    for (const key of ['waiting', 'running', 'completed', 'failed']) {
      const node = document.getElementById(`message-queue-${key}`);
      if (node) node.textContent = Number(summary[key] || 0).toLocaleString();
    }
    const rows = document.getElementById('message-queue-rows');
    if (!rows) return;
    rows.innerHTML = jobs.length ? jobs.map(job => {
      const total = Number(job.total_count || 0);
      const done = Number(job.processed_count || 0);
      const percent = total ? Math.round(done / total * 100) : 0;
      const retry = job.status === 'failed' ? `<button class="btn bo xs" type="button" data-message-queue-action="retry" data-job-id="${esc(job.id)}">재시도</button>` : '';
      return `<tr><td>${esc(job.created_at ? new Date(job.created_at).toLocaleString('ko-KR') : '-')}</td><td>${esc(job.title)}</td><td>${total.toLocaleString()}명</td><td>${done.toLocaleString()} / ${total.toLocaleString()} (${percent}%)</td><td>${esc(statusLabel(job.status))}</td><td>${retry || '-'}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="emp">등록된 메시지 작업이 없습니다.</td></tr>';
  }

  function startMessageQueueMonitor() {
    stopMessageQueueMonitor();
    loadMessageQueue().catch(error => window.adminAlert?.(error.message));
    timer = setInterval(() => {
      loadMessageQueue().catch(() => {});
    }, 5000);
  }

  function stopMessageQueueMonitor() { if (timer) clearInterval(timer); timer = null; }

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-message-queue-action]');
    if (!button) return;
    if (button.dataset.messageQueueAction === 'refresh') return loadMessageQueue();
    if (button.dataset.messageQueueAction === 'retry') {
      button.disabled = true;
      try { await request(`/api/admin/message-jobs/${encodeURIComponent(button.dataset.jobId)}/retry`, { method: 'POST' }); await loadMessageQueue(); }
      catch (error) { await window.adminAlert?.(error.message); }
      finally { button.disabled = false; }
    }
  });

  window.EatsAdminMessageQueue = { pgMessageQueue, loadMessageQueue, startMessageQueueMonitor, stopMessageQueueMonitor };
}());
