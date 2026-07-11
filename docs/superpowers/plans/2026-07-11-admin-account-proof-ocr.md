# Admin Account Proof OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side OCR that lets an authenticated administrator compare an uploaded account-proof image with the registered account number without automatically approving it.

**Architecture:** A focused CommonJS module validates upload paths, invokes the local Tesseract binary with bounded arguments and timeout, extracts numeric candidates, and compares them with the registered number. `server.js` exposes one authenticated endpoint, while the existing account modal starts OCR and renders transient matched, mismatched, or not-found results.

**Tech Stack:** Node.js, Express, `child_process.execFile`, Tesseract OCR, Node test runner, existing admin HTML/CSS/JavaScript.

---

## File map

- Create `lib/account-proof-ocr.js`: normalization, candidate ranking, safe upload path resolution, bounded Tesseract execution.
- Create `test/account-proof-ocr.test.js`: pure module tests and fake-runner OCR tests.
- Create `test/admin-account-proof-ocr-api.test.js`: endpoint/auth/path contract assertions.
- Create `test/admin-account-proof-ocr-ui.test.js`: modal button, delegated action, and result-state assertions.
- Modify `server.js`: authenticated OCR endpoint and module wiring.
- Modify `admin-assets/js/admin-accounts.js`: OCR button and result container.
- Modify `이츠페이_관리자_시스템_10.html`: delegated OCR request handler and cache versions.
- Modify `admin-assets/css/admin-main.css`: loading and result styles.

### Task 1: OCR number extraction and comparison

**Files:**
- Create: `lib/account-proof-ocr.js`
- Create: `test/account-proof-ocr.test.js`

- [ ] **Step 1: Write failing normalization and candidate tests**

```js
test('normalizes separators and compares the exact account candidate', () => {
  assert.equal(normalizeAccountNo('562-169754-32139'), '56216975432139');
  assert.deepEqual(compareAccountText('입금계좌 562-169754-32139', '56216975432139'), {
    status: 'matched', recognizedAccountNo: '56216975432139', candidates: ['56216975432139']
  });
});

test('returns the nearest candidate when no exact candidate exists', () => {
  const result = compareAccountText('계좌 562 169754 32138', '56216975432139');
  assert.equal(result.status, 'mismatched');
  assert.equal(result.recognizedAccountNo, '56216975432138');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/account-proof-ocr.test.js`
Expected: FAIL because `lib/account-proof-ocr.js` does not exist.

- [ ] **Step 3: Implement pure helpers**

Implement and export `normalizeAccountNo(value)`, `extractAccountCandidates(text)`, and `compareAccountText(text, registeredAccountNo)`. Candidate extraction joins digits separated by spaces or hyphens, keeps 8-20 digit results, removes duplicates, prefers exact matches, then smallest length and per-position difference.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test test/account-proof-ocr.test.js`
Expected: all extraction and comparison tests pass.

- [ ] **Step 5: Commit**

```powershell
git add lib/account-proof-ocr.js test/account-proof-ocr.test.js
git commit -m "feat: add account proof OCR comparison"
```

### Task 2: Safe Tesseract execution

**Files:**
- Modify: `lib/account-proof-ocr.js`
- Modify: `test/account-proof-ocr.test.js`

- [ ] **Step 1: Write failing path and runner tests**

```js
test('resolves only image files inside uploads', () => {
  assert.equal(resolveProofImagePath('/uploads/proof.jpg', uploadDir), path.join(uploadDir, 'proof.jpg'));
  assert.throws(() => resolveProofImagePath('/uploads/../.env', uploadDir), /허용되지 않는/);
  assert.throws(() => resolveProofImagePath('/uploads/proof.pdf', uploadDir), /이미지/);
});

test('runs tesseract with a timeout and numeric whitelist', async () => {
  const calls = [];
  await recognizeAccountProof('/tmp/proof.jpg', '12345678', { runner: async (...args) => { calls.push(args); return '1234-5678'; } });
  assert.match(JSON.stringify(calls), /tessedit_char_whitelist=0123456789/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/account-proof-ocr.test.js`
Expected: FAIL because safe resolver and OCR runner are missing.

- [ ] **Step 3: Implement safe execution**

Use `path.resolve`, `path.relative`, an image extension allowlist, `fs.stat`, and `execFile('tesseract', [imagePath, 'stdout', '--psm', '6', '-l', 'eng', '-c', 'tessedit_char_whitelist=0123456789- '], { timeout: 20000, maxBuffer: 1024 * 1024 })`. Map missing binary, timeout, and unreadable output to stable Korean errors without returning filesystem paths.

- [ ] **Step 4: Run and verify GREEN**

Run: `node --test test/account-proof-ocr.test.js`
Expected: all module tests pass.

- [ ] **Step 5: Commit**

```powershell
git add lib/account-proof-ocr.js test/account-proof-ocr.test.js
git commit -m "feat: run account OCR safely"
```

### Task 3: Authenticated OCR API

**Files:**
- Modify: `server.js`
- Create: `test/admin-account-proof-ocr-api.test.js`

- [ ] **Step 1: Write failing API contract tests**

Assert that `server.js` imports `recognizeAccountProof` and defines `app.post('/api/admin/accounts/proof-ocr', authenticateAdmin, asyncHandler(...))`; assert account number validation, `/uploads/` restriction, and no automatic approval call in the route body.

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/admin-account-proof-ocr-api.test.js`
Expected: FAIL because the route is absent.

- [ ] **Step 3: Implement the endpoint**

Validate `accountNo` as 8-20 digits after normalization, resolve `documentUrl` against `uploadDir`, call `recognizeAccountProof`, and return only `status`, normalized registered and recognized numbers, and at most five candidates. Protect a module-level single-flight guard and return HTTP 429 while another OCR job is running.

- [ ] **Step 4: Verify server syntax and tests**

Run: `node --check server.js; node --test test/admin-account-proof-ocr-api.test.js test/account-proof-ocr.test.js`
Expected: syntax valid and tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server.js test/admin-account-proof-ocr-api.test.js
git commit -m "feat: expose admin account proof OCR API"
```

### Task 4: Account modal OCR interaction

**Files:**
- Modify: `admin-assets/js/admin-accounts.js`
- Modify: `이츠페이_관리자_시스템_10.html`
- Modify: `admin-assets/css/admin-main.css`
- Create: `test/admin-account-proof-ocr-ui.test.js`

- [ ] **Step 1: Write failing UI tests**

Assert the modal contains `data-admin-action="account-proof-ocr"`, document URL and normalized registered number data attributes, plus a stable `data-account-proof-ocr-result` container. Assert the HTML registers the action, posts to `/api/admin/accounts/proof-ocr`, and renders `matched`, `mismatched`, `not_found`, loading, and failure messages.

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/admin-account-proof-ocr-ui.test.js`
Expected: FAIL because the button and action are absent.

- [ ] **Step 3: Implement modal markup and delegated action**

Add `계좌번호 자동 인식` beside the existing copy and zoom controls only for image proofs with a valid account number. The action disables itself, posts JSON through the existing authenticated API helper, updates the result container, and re-enables itself in `finally`. Escape every displayed server value and never trigger approve/reject actions.

- [ ] **Step 4: Add scoped styles**

Add `.account-proof-ocr-result` plus `.is-loading`, `.is-matched`, `.is-mismatched`, `.is-not-found`, and `.is-error`. Preserve the current desktop workbench and mobile stacked order.

- [ ] **Step 5: Verify UI tests and guardrails**

Run: `node --test test/admin-account-proof-ocr-ui.test.js test/admin-account-proof-workbench.test.js test/admin-account-detail-bank.test.js; npm.cmd run check:ui`
Expected: OCR and existing account UI tests pass; guardrail counts do not increase for inline event attributes.

- [ ] **Step 6: Commit**

```powershell
git add admin-assets/js/admin-accounts.js admin-assets/css/admin-main.css 이츠페이_관리자_시스템_10.html test/admin-account-proof-ocr-ui.test.js
git commit -m "feat: add account proof OCR verification UI"
```

### Task 5: Production installation and verification

**Files:**
- Deploy: `server.js`, `lib/account-proof-ocr.js`, administrator HTML, account JS, and admin CSS.

- [ ] **Step 1: Verify production before mutation**

Run `systemctl is-active eatspay`, verify `/opt/eatspay/uploads`, and record `tesseract --version` result.

- [ ] **Step 2: Install Tesseract**

Run `sudo apt-get update` and `sudo apt-get install -y tesseract-ocr`. Verify `tesseract --version` and `tesseract --list-langs` include `eng`.

- [ ] **Step 3: Deploy scoped files with timestamped backups**

Copy only the five runtime files to `/tmp`, back up matching `/opt/eatspay` files, install them with mode `0644`, and restart `eatspay`.

- [ ] **Step 4: Verify production runtime**

Confirm `systemctl is-active eatspay`, `node --check /opt/eatspay/server.js`, public assets contain the OCR action and cache versions, and unauthenticated `POST /api/admin/accounts/proof-ocr` returns 401/403 rather than running OCR.

- [ ] **Step 5: Verify a real proof through the administrator UI**

Open an approval modal with an image proof, click `계좌번호 자동 인식`, confirm loading state, a terminal result state, copy and zoom controls remain available, and approve/reject are unchanged. Repeat at a mobile viewport.

- [ ] **Step 6: Commit deployment notes if any durable operational detail changed**

Do not commit secrets, OCR output, account numbers, or uploaded proof images.
