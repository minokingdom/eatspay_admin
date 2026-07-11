# Eats Pay Announcement Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Eats Pay announcements use consistent full-list numbering, content-specific thumbnails, image-led detail dialogs, and admin-managed representative images.

**Architecture:** Extend `board_posts` with one JSON image array, expose it through the existing board repository and APIs, and reuse the existing authenticated upload storage. Port the proven Eats GO worker-news presentation into both root web and Capacitor `www` copies while preserving Eats Pay views, likes, and detail dialog behavior.

**Tech Stack:** Node.js, Express, PostgreSQL JSONB, Multer, vanilla JavaScript, CSS, Node test runner, Codex ImageGen.

---

### Task 1: Lock the board image contract with tests

**Files:**
- Create: `test/announcement-image-news.test.js`
- Inspect: `db/repository.js`
- Inspect: `server.js`
- Inspect: `js/app.js`
- Inspect: `www/js/app.js`

- [ ] **Step 1: Write the failing contract test**

Assert that the schema adds `image_urls`, `toBoardPost` returns both property spellings, create/update queries persist JSONB, the client uses the full source length for numbering, and both clients render image thumbnails and detail images.

```js
test('announcement image contract is shared by server, web, and webview', () => {
  assert.match(server, /ADD COLUMN IF NOT EXISTS image_urls JSONB/);
  assert.match(repository, /imageUrls:\s*Array\.isArray\(row\.image_urls\)/);
  assert.match(repository, /image_urls:\s*Array\.isArray\(row\.image_urls\)/);
  assert.match(web, /sourceItems\.length - index/);
  assert.match(web, /home-announcement-thumb/);
  assert.match(web, /announcement-detail-image/);
  assert.equal(webBlock, webviewBlock);
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `node --test test/announcement-image-news.test.js`

Expected: FAIL because `board_posts.image_urls` and the image renderers do not exist.

### Task 2: Persist announcement representative images

**Files:**
- Modify: `server.js:3161-3175`
- Modify: `server.js:11741-11749`
- Modify: `db/repository.js:460-482`
- Modify: `db/repository.js:5516-5594`
- Modify: `db/schema.sql`
- Test: `test/announcement-image-news.test.js`

- [ ] **Step 1: Add the idempotent schema migration**

```js
await pool.query("ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb");
```

- [ ] **Step 2: Normalize API input**

Add a helper that accepts `imageUrls` or `image_urls`, keeps only local `/uploads/` and `/assets/announcements/` URLs, and returns at most one URL.

```js
function normalizeBoardImageUrls(body = {}) {
  const source = Array.isArray(body.imageUrls) ? body.imageUrls : body.image_urls;
  return (Array.isArray(source) ? source : [])
    .map(value => String(value || '').trim())
    .filter(value => /^\/(?:uploads|assets\/announcements)\//.test(value))
    .slice(0, 1);
}
```

- [ ] **Step 3: Return both client property spellings**

```js
const imageUrls = Array.isArray(row.image_urls) ? row.image_urls : [];
return { ...existing, imageUrls, image_urls: imageUrls };
```

- [ ] **Step 4: Persist JSONB in create and update**

Extend both queries with `image_urls = $n::jsonb` and pass `JSON.stringify(post.imageUrls || [])`.

- [ ] **Step 5: Run server and contract tests**

Run: `node --check server.js && node --test test/announcement-image-news.test.js`

Expected: server image contract assertions PASS; client assertions remain FAIL.

### Task 3: Add authenticated announcement image upload management

**Files:**
- Modify: `server.js:11311-11329`
- Modify: `server.js:11830-11883`
- Modify: `admin-assets/js/admin-board.js`
- Modify: `이츠페이_관리자_시스템_10.html:7389-7400`
- Test: `test/announcement-image-news.test.js`

- [ ] **Step 1: Add a board-specific image saver**

Use the existing image MIME allowlist, generate `announcement-<timestamp>-<uuid>.<ext>`, and write it under `uploads`.

- [ ] **Step 2: Add the authenticated upload endpoint**

```js
app.post('/api/admin/boards/announcements/upload-image', authenticateAdmin, singleUpload('file'), asyncHandler(async (req, res) => {
  const imageUrl = await saveUploadedAnnouncementImage(req.file);
  return res.status(201).json({ success: true, data: { imageUrl } });
}));
```

- [ ] **Step 3: Add admin preview and controls**

In `pForm`, add one image panel only for `announcements`: preview, file picker, paste target, replace, and remove controls. Store the current URL in `#p-image-url`.

- [ ] **Step 4: Upload before saving the post**

In `savPost`, upload a newly selected or pasted file first, then send `imageUrls: imageUrl ? [imageUrl] : []` with the existing JSON body. Keep entered title and content in place on upload errors.

- [ ] **Step 5: Verify admin script syntax**

Run the documented admin inline-script parser and `node --check admin-assets/js/admin-board.js`.

Expected: both checks PASS.

### Task 4: Port the Eats GO image-news presentation

**Files:**
- Modify: `js/app.js:2373-2555`
- Modify: `www/js/app.js:2373-2555`
- Modify: `css/style.css`
- Modify: `www/css/style.css`
- Modify: `index.html`
- Modify: `www/index.html`
- Test: `test/announcement-image-news.test.js`

- [ ] **Step 1: Add one image URL resolver**

```js
function getAnnouncementImage(item = {}) {
  const values = Array.isArray(item.imageUrls) ? item.imageUrls : item.image_urls;
  return normalizeTalkImage(Array.isArray(values) ? values[0] : '') || '/logo.png';
}
```

- [ ] **Step 2: Fix home numbering**

Use `sourceItems.length - index` before slicing so 20 total items render as 20 through 16 on home.

- [ ] **Step 3: Render home image rows**

Each row contains the number, title and metadata block, and a fixed right thumbnail with `loading="lazy"`.

- [ ] **Step 4: Paginate the full board at five rows**

Add `announcementPage`, calculate `startIndex`, and use `rows.length - (startIndex + index)` so numbering remains stable across pages.

- [ ] **Step 5: Render the detail image**

Place a 16:9 `<img class="announcement-detail-image">` before metadata while preserving the existing view and like controls.

- [ ] **Step 6: Add image error fallback**

Use delegated `error` handlers on home, board, and dialog images. Apply the fallback only once with `data-fallback-applied="1"`.

- [ ] **Step 7: Add shared layout CSS**

Use 56px square thumbnails in lists, one-line title ellipsis, stable row heights, and a full-width 16:9 detail image with `object-fit: cover`.

- [ ] **Step 8: Bump root and webview asset versions**

Use `20260711-announcement-images` for both CSS and JavaScript query strings.

- [ ] **Step 9: Run client tests**

Run: `node --check js/app.js && node --check www/js/app.js && node --test test/announcement-image-news.test.js`

Expected: all contract tests PASS.

### Task 5: Generate and connect all 20 production images

**Files:**
- Create: `assets/announcements/announcement-67.webp` through `announcement-48.webp`
- Create: `scripts/assign-announcement-images.js`

- [ ] **Step 1: Generate one unique image per production title**

Use built-in ImageGen once per post with a 16:9 editorial-photo prompt. Keep every image text-free, logo-free, privacy-safe, and visually tied to its title.

- [ ] **Step 2: Copy generated outputs into the project**

Save selected outputs under `assets/announcements/announcement-<post-id>.webp`; do not leave production assets only under the Codex generated-image directory.

- [ ] **Step 3: Add an idempotent assignment script**

The script updates only announcement IDs 67 through 48 and assigns `/assets/announcements/announcement-<id>.webp` without changing title, body, views, likes, or display order.

- [ ] **Step 4: Verify all assets**

Check that 20 files exist, every file is a decodable image, every filename has a matching post ID, and no file is zero bytes.

### Task 6: Full verification and production deployment

**Files:**
- Modify: `graphify-out/*` through Graphify update
- Deploy: changed server, repository, admin, root web, webview, tests excluded, and 20 assets

- [ ] **Step 1: Run focused and UI tests**

Run:

```powershell
node --check server.js
node --check js/app.js
node --check www/js/app.js
node --test test/announcement-image-news.test.js test/popup-checkbox-style.test.js test/home-weather-eatsgo.test.js
npm.cmd run check:ui
```

Expected: all tests PASS and UI guardrail counts do not increase for inline events.

- [ ] **Step 2: Browser-test locally at 430px**

Verify home numbers 20-16, five distinct thumbnails, full-board pagination, detail image, content line breaks, fallback image, and no horizontal overflow.

- [ ] **Step 3: Back up production files and database rows**

Create a timestamped `/opt/eatspay/backups/announcement-images-*` directory and export the 20 affected `board_posts` rows before applying schema or data changes.

- [ ] **Step 4: Deploy and restart**

Copy only the listed files, run the assignment script once, restart `eatspay.service`, and confirm it is active.

- [ ] **Step 5: Verify production**

At `https://eatspay.kr`, confirm the API returns 20 image arrays, home shows numbers 20-16 with thumbnails, page two continues 15-11, and the first and last details show their matched images.

- [ ] **Step 6: Refresh the code graph**

Run: `graphify.cmd update . --no-cluster --force`

