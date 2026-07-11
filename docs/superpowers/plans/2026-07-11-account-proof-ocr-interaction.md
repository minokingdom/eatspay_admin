# Account Proof OCR Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate proof-image navigation from OCR region selection, remove the redundant zoom button, and keep copy/OCR actions side by side.

**Architecture:** Keep the existing reusable proof overlay and add an explicit `navigate`/`select` interaction mode. Pointer and wheel handlers dispatch by mode; crop coordinates remain normalized against the rendered image. The account card markup changes only in `admin-accounts.js`.

**Tech Stack:** Vanilla JavaScript, CSS, Node.js built-in test runner, Express OCR endpoint unchanged.

---

### Task 1: Lock the account-card layout with a failing test

**Files:**
- Modify: `test/admin-account-proof-ocr-ui.test.js`
- Modify: `admin-assets/js/admin-accounts.js:294-298`
- Modify: `admin-assets/css/admin-main.css:776-777`

- [ ] **Step 1: Write the failing layout assertions**

Add assertions that rendered modal HTML contains copy and OCR buttons in `.account-proof-reference-actions`, does not contain `증빙 크게 보기`, and CSS uses a two-column grid.

```js
assert.doesNotMatch(modal.body, /증빙 크게 보기/);
assert.match(modal.body, /계좌번호 복사/);
assert.match(modal.body, /계좌번호 자동 인식/);
assert.match(css, /account-proof-reference-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/admin-account-proof-ocr-ui.test.js`

Expected: FAIL because the redundant button exists and actions use flex.

- [ ] **Step 3: Implement the card layout**

Remove the `data-proof-zoom-open` action button from the reference card, retain thumbnail zoom behavior, and use:

```css
.account-proof-reference-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;width:100%;margin-top:auto}
.account-proof-reference-actions .btn{width:100%;min-height:34px}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/admin-account-proof-ocr-ui.test.js`

Expected: all tests PASS.

### Task 2: Add explicit navigation and selection modes

**Files:**
- Modify: `test/admin-proof-image-zoom.test.js`
- Modify: `test/admin-account-proof-ocr-ui.test.js`
- Modify: `이츠페이_관리자_시스템_10.html:810-925,10483-10525,7116-7145`
- Modify: `admin-assets/css/admin-main.css:813-820`

- [ ] **Step 1: Write failing interaction assertions**

Assert the overlay exposes `data-proof-mode="navigate"`, `data-proof-mode="select"`, mode labels, `setProofInteractionMode`, and `resetProofOcrSelection`; assert selection startup initially sets navigate mode.

```js
assert.match(html, /data-proof-mode="navigate"/);
assert.match(html, /data-proof-mode="select"/);
assert.match(html, /function setProofInteractionMode/);
assert.match(html, /function resetProofOcrSelection/);
assert.match(html, /proofInteractionMode==='select'/);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/admin-proof-image-zoom.test.js test/admin-account-proof-ocr-ui.test.js`

Expected: FAIL because explicit modes do not exist.

- [ ] **Step 3: Implement mode controls and dispatch**

Add toolbar buttons `이동·확대` and `계좌 영역 선택`. Implement `setProofInteractionMode(mode)` to toggle active classes, title guidance, stage classes, and selection action visibility. Allow `startProofImagePan` only in navigate mode and `beginProofOcrSelection` only in select mode. Add `다시 선택` and `이동·확대로 돌아가기` actions beside the floating confirmation.

- [ ] **Step 4: Preserve normalized coordinates**

Continue calculating region values from `image.getBoundingClientRect()`:

```js
state.region={x:(left-rect.left)/rect.width,y:(top-rect.top)/rect.height,width:width/rect.width,height:height/rect.height};
```

Clear selection state when zoom changes or the user requests reselection so no stale rectangle survives a changed image geometry.

- [ ] **Step 5: Run interaction tests and verify GREEN**

Run: `node --test test/admin-proof-image-zoom.test.js test/admin-account-proof-ocr-ui.test.js`

Expected: all tests PASS.

### Task 3: Add wheel and touch-friendly behavior

**Files:**
- Modify: `test/admin-proof-image-zoom.test.js`
- Modify: `이츠페이_관리자_시스템_10.html:7116-7145`
- Modify: `admin-assets/css/admin-main.css:817-820`

- [ ] **Step 1: Add failing assertions for touch state and mode CSS**

```js
assert.match(html, /proofTouchPointers/);
assert.match(html, /function updateProofPinchZoom/);
assert.match(css, /proof-zoom-stage\.is-selecting/);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/admin-proof-image-zoom.test.js`

Expected: FAIL because pinch state is absent.

- [ ] **Step 3: Implement pinch zoom without changing OCR selection**

Track two active pointers in navigate mode, calculate distance ratio, call `setProofImageZoom(startScale * ratio)`, and suppress pan while two pointers are active. Keep `touch-action:none` and distinct `grab`, `grabbing`, and `crosshair` cursors.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/admin-proof-image-zoom.test.js`

Expected: all tests PASS.

### Task 4: Regression, production deployment, and verification

**Files:**
- Modify: `이츠페이_관리자_시스템_10.html` cache key

- [ ] **Step 1: Run OCR and viewer regression tests**

Run: `node --test test/admin-proof-image-zoom.test.js test/admin-account-proof-ocr-ui.test.js test/account-proof-ocr.test.js test/admin-account-proof-ocr-api.test.js`

Expected: all tests PASS.

- [ ] **Step 2: Check production before deployment**

Run remote `systemctl is-active eatspay` and `curl -fsS http://127.0.0.1:3000/healthz`.

Expected: `active` and JSON with `"ok":true`.

- [ ] **Step 3: Deploy only the admin HTML, account module, and admin CSS**

Upload the three files to `/opt/eatspay`, restart `eatspay`, and poll `/healthz`.

- [ ] **Step 4: Verify deployed markers**

Confirm production files contain `setProofInteractionMode`, no reference-card `증빙 크게 보기` action, and the new CSS cache key.

- [ ] **Step 5: Commit scoped implementation files**

```bash
git add test/admin-proof-image-zoom.test.js test/admin-account-proof-ocr-ui.test.js admin-assets/js/admin-accounts.js admin-assets/css/admin-main.css 이츠페이_관리자_시스템_10.html
git commit -m "fix: streamline account proof OCR controls"
```

### Task 5: Preview the selected crop and support right-click mode swapping

**Files:**
- Modify: `test/admin-account-proof-ocr-interaction.test.js`
- Modify: `admin-assets/js/admin-accounts.js`
- Modify: `admin-assets/css/admin-main.css`
- Modify: `이츠페이_관리자_시스템_10.html`

- [ ] **Step 1: Write failing assertions**

Assert the account card contains a hidden crop-preview canvas, the viewer contains a `contextmenu` mode handler, and crop rendering uses `drawImage` with normalized region coordinates.

```js
assert.match(modal.body, /data-account-proof-crop-preview/);
assert.match(html, /function renderAccountProofCropPreview/);
assert.match(html, /addEventListener\('contextmenu'/);
assert.match(html, /drawImage\(/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/admin-account-proof-ocr-interaction.test.js`

Expected: FAIL because crop preview and right-click swapping are absent.

- [ ] **Step 3: Implement the crop preview**

Add a hidden preview block to the reference card. Before closing the proof overlay, copy the selected original-image pixels into its canvas using `naturalWidth`, `naturalHeight`, and normalized `region`. Unhide the block after drawing and preserve it through OCR result rendering.

- [ ] **Step 4: Implement right-click mode swapping**

On `contextmenu` inside `[data-proof-zoom-stage]`, call `preventDefault()` and toggle with:

```js
setProofInteractionMode(proofInteractionMode==='select'?'navigate':'select');
```

Reset an unfinished selection only when switching into selection mode. Keep toolbar controls for touch and keyboard use.

- [ ] **Step 5: Run regression tests and deploy**

Run: `node --test test/admin-account-proof-ocr-interaction.test.js test/admin-proof-image-zoom.test.js test/admin-account-proof-ocr-ui.test.js test/account-proof-ocr.test.js test/admin-account-proof-ocr-api.test.js`

Expected: all tests PASS. Check production health, deploy the admin HTML, account module, and admin CSS, restart, and verify deployed markers.

### Task 6: Show right-click mode feedback and force the not-found result to two lines

**Files:**
- Modify: `test/admin-account-proof-ocr-interaction.test.js`
- Modify: `이츠페이_관리자_시스템_10.html`
- Modify: `admin-assets/css/admin-main.css`

- [ ] Add failing assertions for `showProofModeTooltip`, both Korean mode labels, `1200`, and a newline in the not-found message.
- [ ] Implement a fixed tooltip near `clientX/clientY`, clamp it to `window.innerWidth/window.innerHeight`, replace any previous tooltip, and fade it after 1.2 seconds.
- [ ] Call the tooltip from the proof-stage `contextmenu` handler after changing modes.
- [ ] Change the not-found message to `계좌번호를 인식하지 못했습니다.\n증빙을 직접 확인하세요.` and set `white-space:pre-line` on the result box.
- [ ] Run the OCR interaction regression tests, verify production health, deploy the admin HTML and CSS, and verify the deployed markers.
