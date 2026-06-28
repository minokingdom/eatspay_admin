(function () {
  'use strict';

  const root = window.EatsAdminPush || {};

  function pgPush() {
    return `
  <div class="aw aw-b">앱 푸시는 Firebase FCM 기준으로 확인합니다. Web Push는 브라우저 PWA용 선택 기능이라 미설정이어도 앱 푸시 발송에는 영향이 없습니다.</div>
  <div class="kgrid admin-kpi-grid-5">
    <div class="kpi"><div class="kl">Firebase 서버 키</div><div class="kv" id="push-firebase-status">확인중</div><div class="ks" id="push-firebase-detail">-</div></div>
    <div class="kpi"><div class="kl">Web Push 선택 기능</div><div class="kv" id="push-web-status">확인중</div><div class="ks" id="push-web-detail">-</div></div>
    <div class="kpi"><div class="kl">활성 토큰</div><div class="kv" id="push-enabled-count">-</div><div class="ks">푸시 수신 가능 기기</div></div>
    <div class="kpi"><div class="kl">웹 구독</div><div class="kv" id="push-web-enabled-count">-</div><div class="ks" id="push-web-users">-</div></div>
    <div class="kpi"><div class="kl">전체 토큰</div><div class="kv" id="push-total-count">-</div><div class="ks" id="push-token-users">-</div></div>
  </div>
  <div class="card"><div class="ch"><span class="admin-section-head-text">계정별 푸시 확인/테스트</span><button class="btn bo sm" type="button" data-admin-action="push-status-all">전체 새로고침</button></div>
  <div class="admin-card-pad">
    <div class="fr3">
      <div class="fg"><label class="fl">대상 이메일</label><input class="fi" id="push-target-email" placeholder="예: admin@eatspay.co.kr"></div>
      <div class="fg"><label class="fl">알림 제목</label><input class="fi" id="push-test-title" value="eats PAY 테스트 알림"></div>
      <div class="fg"><label class="fl">알림 내용</label><input class="fi" id="push-test-body" value="푸시알림 연결이 정상적으로 동작합니다."></div>
    </div>
    <div class="ab admin-flex-end">
      <button class="btn bo" type="button" data-admin-action="push-status-target">대상 상태 확인</button>
      <button class="btn bg2" type="button" data-admin-action="push-test">테스트 발송</button>
    </div>
    <div id="push-target-result" class="admin-push-target-result"></div>
  </div></div>
  <div class="card"><div class="ch"><span class="admin-section-head-text">최근 등록 기기 토큰</span><span class="admin-table-subhead">토큰은 보안을 위해 일부만 표시됩니다.</span></div>
  <div class="tw"><table><thead><tr><th>사용자 ID</th><th>플랫폼</th><th>상태</th><th>토큰</th><th>갱신일시</th></tr></thead><tbody id="push-token-rows"><tr><td colspan="5" class="emp">불러오는 중입니다.</td></tr></tbody></table></div></div>`;
  }

  root.pgPush = pgPush;
  window.EatsAdminPush = root;
}());
