const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('reference card replaces redundant proof zoom with OCR beside copy', () => {
  const code = fs.readFileSync(path.join(root, 'admin-assets/js/admin-accounts.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'admin-assets/css/admin-main.css'), 'utf8');
  const context = { window: { EatsAdminAccounts: {}, EatsAdminAccountUtils: { proofZoomButton: () => '<button>proof</button>' } } };
  vm.createContext(context);
  vm.runInContext(code, context);
  const modal = context.window.EatsAdminAccounts.renderAccountDetailModal({
    franchise: { id: 1, name: '테스트 가맹점' },
    account: { accountNo: '56216975432139', bankName: '신한은행', documentUrl: '/uploads/proof.jpg', fileName: 'proof.jpg' },
    fid: 1,
    idx: 0
  }, { role: 'hq' });
  assert.doesNotMatch(modal.body, /증빙 크게 보기/);
  assert.match(modal.body, /계좌번호 복사/);
  assert.match(modal.body, /계좌번호 자동 인식/);
  assert.match(modal.body, /data-account-proof-crop-preview/);
  assert.match(modal.body, /data-account-proof-crop-ocr/);
  assert.match(modal.body, /data-account-proof-character-layer/);
  assert.match(css, /account-proof-reference-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('proof OCR uses explicit navigation, selection, and pinch states', () => {
  const html = fs.readFileSync(path.join(root, '이츠페이_관리자_시스템_10.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'admin-assets/css/admin-main.css'), 'utf8');
  assert.match(html, /data-proof-mode="navigate"/);
  assert.match(html, /data-proof-mode="select"/);
  assert.match(html, /function setProofInteractionMode/);
  assert.match(html, /function resetProofOcrSelection/);
  assert.match(html, /proofInteractionMode==='select'/);
  assert.match(html, /proofTouchPointers/);
  assert.match(html, /function updateProofPinchZoom/);
  assert.match(html, /function renderAccountProofCropPreview/);
  assert.match(html, /addEventListener\('contextmenu'/);
  assert.match(html, /drawImage\(/);
  assert.match(html, /function showProofModeTooltip/);
  assert.match(html, /오른쪽 마우스/);
  assert.match(html, /영역 선택 모드/);
  assert.match(html, /이동·확대 모드/);
  assert.match(html, /1200/);
  assert.match(html, /계좌번호를 인식하지 못했습니다\.\\n증빙을 직접 확인하세요\./);
  assert.match(css, /is-result-animated/);
  assert.match(css, /account-proof-match-pulse/);
  assert.match(css, /account-proof-mismatch-pulse/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(html, /proof-mobile-mode-bar/);
  assert.match(html, /function startProofLongPress/);
  assert.match(html, /function cancelProofLongPress/);
  assert.match(html, /500/);
  assert.match(html, /10/);
  assert.match(html, /anchorX/);
  assert.match(html, /anchorY/);
  assert.match(html, /proofTouchGestureLocked/);
  assert.match(css, /proof-mobile-mode-bar/);
  assert.match(html, /function setAccountProofCropOcrOverlay/);
  assert.match(html, /recognizedAccountNo/);
  assert.match(html, /숫자 인식 중…/);
  assert.match(html, /번호 인식 실패/);
  assert.match(css, /account-proof-crop-ocr/);
  assert.match(html, /characterBoxes/);
  assert.match(html, /is-correct/);
  assert.match(html, /위치 인식 실패/);
  assert.match(css, /proof-zoom-stage\.is-selecting/);
});
