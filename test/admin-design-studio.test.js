const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const server = read('server.js');
const repository = read('db', 'repository.js');
const adminHtml = read('이츠페이_관리자_시스템_10.html');
const bannerModule = read('admin-assets', 'js', 'admin-banners.js');

test('design studio persists brand kits, editable documents, versions, and banner links', () => {
  assert.match(server, /CREATE TABLE IF NOT EXISTS brand_kits/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS design_documents/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS design_document_versions/);
  assert.match(server, /ALTER TABLE banners ADD COLUMN IF NOT EXISTS design_document_id/);
  assert.match(repository, /async listBrandKits\(/);
  assert.match(repository, /async createDesignDocument\(/);
  assert.match(repository, /async autosaveDesignDocument\(/);
  assert.match(repository, /async listDesignDocumentVersions\(/);
  assert.match(repository, /async restoreDesignDocumentVersion\(/);
});

test('design studio routes are authenticated and exports use a dedicated document endpoint', () => {
  for (const route of [
    "app.get('/api/admin/brand-kits'",
    "app.post('/api/admin/brand-kits'",
    "app.get('/api/admin/design-documents'",
    "app.post('/api/admin/design-documents'",
    "app.patch('/api/admin/design-documents/:id/autosave'",
    "app.get('/api/admin/design-documents/:id/versions'",
    "app.post('/api/admin/design-documents/:id/export'",
  ]) {
    assert.ok(server.includes(route), `missing route: ${route}`);
  }
  assert.match(server, /design-documents[^\n]+authenticateAdmin/);
  assert.match(server, /brand-kits[^\n]+authenticateAdmin/);
});

test('admin loads a local Fabric module and exposes the studio from banner management', () => {
  assert.match(adminHtml, /admin-design-studio\.css/);
  assert.match(adminHtml, /admin-design-studio-loader\.js/);
  assert.match(read('admin-assets', 'js', 'admin-design-studio-loader.js'), /admin-design-studio\.mjs/);
  assert.match(adminHtml, /admin-assets\/vendor\/fabric\.min\.mjs/);
  assert.match(adminHtml, /EatsAdminDesignStudioReady/);
  assert.match(adminHtml, /EatsAdminDesignStudio\?\.open/);
  assert.match(bannerModule, /data-admin-action="design-studio-open"/);
  assert.match(bannerModule, /디자인 스튜디오/);
});

test('studio keeps legacy popup rich-text styles inline', () => {
  const css = read('admin-assets', 'css', 'admin-main.css');
  assert.match(css, /\.popup-editor-preview-benefits\s*>\s*span\s*\{/);
  assert.doesNotMatch(css, /\.popup-editor-preview-benefits\s+span\s*\{[^}]*display:flex/s);
});

test('studio core provides presets and bounded undo redo history', async () => {
  const modulePath = path.join(root, 'admin-assets', 'js', 'admin-design-studio-core.mjs');
  let core = null;
  try {
    core = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`);
  } catch (_) {
    // The assertion below reports the missing implementation as a test failure.
  }
  assert.ok(core, 'design studio core module is missing');
  assert.deepEqual(core.DESIGN_PRESETS.popup, { width: 720, height: 1280, label: '세로 팝업' });
  const history = core.createHistory(3);
  history.push('one');
  history.push('two');
  history.push('three');
  history.push('four');
  assert.equal(history.undo(), 'three');
  assert.equal(history.undo(), 'two');
  assert.equal(history.undo(), 'two');
  assert.equal(history.redo(), 'three');
});

test('studio core applies text color to the selected character range', async () => {
  const core = await import(`${pathToFileURL(path.join(root, 'admin-assets', 'js', 'admin-design-studio-core.mjs')).href}?style=${Date.now()}`);
  const calls = [];
  const text = {
    type: 'textbox',
    isEditing: true,
    selectionStart: 6,
    selectionEnd: 8,
    setSelectionStyles(style, start, end) {
      calls.push({ style, start, end });
    },
    set() {
      throw new Error('whole-object style must not be used for a selected range');
    },
  };
  core.applyTextStyle(text, { fill: '#03C75A' });
  assert.deepEqual(calls, [{ style: { fill: '#03C75A' }, start: 6, end: 8 }]);
});

test('studio core replaces stale character colors when styling the whole text object', async () => {
  const core = await import(`${pathToFileURL(path.join(root, 'admin-assets', 'js', 'admin-design-studio-core.mjs')).href}?wholeStyle=${Date.now()}`);
  const calls = [];
  const text = {
    isEditing: false,
    selectionStart: 2,
    selectionEnd: 7,
    removeStyle(property) { calls.push(['removeStyle', property]); },
    set(style) { calls.push(['set', style]); },
  };

  core.applyTextStyle(text, { fill: '#03C75A' });

  assert.deepEqual(calls, [['removeStyle', 'fill'], ['set', { fill: '#03C75A' }]]);
});

test('studio normalizes Fabric objects to the top-left coordinate system', async () => {
  const core = await import(`${pathToFileURL(path.join(root, 'admin-assets', 'js', 'admin-design-studio-core.mjs')).href}?origin=${Date.now()}`);
  const calls = [];
  const object = {
    originX: 'center',
    originY: 'center',
    set(values) {
      calls.push(values);
      Object.assign(this, values);
    },
    setCoords() {
      calls.push('coords');
    },
  };

  core.ensureTopLeftOrigin(object);

  assert.equal(object.originX, 'left');
  assert.equal(object.originY, 'top');
  assert.deepEqual(calls, [{ originX: 'left', originY: 'top' }, 'coords']);
});

test('studio keeps canvas scrolling and zoom controls inside the viewport', () => {
  const studio = read('admin-assets', 'js', 'admin-design-studio.mjs');
  const css = read('admin-assets', 'css', 'admin-design-studio.css');

  assert.match(studio, /data-ds-canvas-scroll/);
  assert.match(css, /\.ds-overlay>\[data-ds-shell\]\{[^}]*display:flex[^}]*min-height:0[^}]*overflow:hidden/);
  assert.match(css, /\.ds-canvas-scroll\{[^}]*overflow:auto/);
  assert.match(css, /\.ds-zoom-bar\{[^}]*position:absolute/);
  assert.doesNotMatch(css, /\.ds-zoom-bar\{[^}]*position:sticky/);
});

test('studio command bar stays readable and supports ctrl wheel zoom', () => {
  const studio = read('admin-assets', 'js', 'admin-design-studio.mjs');
  const css = read('admin-assets', 'css', 'admin-design-studio.css');

  assert.match(css, /\.ds-topbar\{[^}]*overflow-x:auto/);
  assert.match(css, /\.ds-command\{[^}]*white-space:nowrap/);
  assert.match(css, /\.ds-topbar-group\.is-end\{[^}]*flex:0 0 auto/);
  assert.match(studio, /function handleStudioWheel\(event\)/);
  assert.match(studio, /event\.(ctrlKey|metaKey)/);
  assert.match(studio, /setZoom\(state\.zoom/);
});

test('studio aligns and distributes multiple selected objects', async () => {
  const core = await import(`${pathToFileURL(path.join(root, 'admin-assets', 'js', 'admin-design-studio-core.mjs')).href}?arrange=${Date.now()}`);
  const makeObject = (left, top, width, height) => ({
    left, top, width, height,
    getBoundingRect() { return { left: this.left, top: this.top, width: this.width, height: this.height }; },
    set(values) { Object.assign(this, values); },
    setCoords() {},
  });
  const objects = [makeObject(0, 0, 20, 20), makeObject(60, 15, 20, 10), makeObject(180, 30, 20, 20)];

  assert.equal(core.arrangeObjects(objects, 'distribute-h'), true);
  assert.deepEqual(objects.map((object) => object.left), [0, 90, 180]);

  assert.equal(core.arrangeObjects(objects, 'middle'), true);
  assert.deepEqual(objects.map((object) => object.top), [15, 20, 15]);
});

test('studio exposes practical multi-selection alignment controls', () => {
  const studio = read('admin-assets', 'js', 'admin-design-studio.mjs');
  assert.match(studio, /data-ds-action="arrange"/);
  for (const mode of ['left', 'center', 'right', 'top', 'middle', 'bottom', 'distribute-h', 'distribute-v']) {
    assert.ok(studio.includes(`data-ds-arrange="${mode}"`), `missing arrange mode: ${mode}`);
  }
});

test('new popup starts from the compact rounded card design', () => {
  const studio = read('admin-assets', 'js', 'admin-design-studio.mjs');
  assert.match(studio, /left: 48, top: 40, width: 624, height: 1200, rx: 36, ry: 36/);
  assert.match(studio, /eatspay-popup-logo-white\.svg/);
  assert.match(studio, /left: 90, top: 78, maxWidth: 130, maxHeight: 46/);
  assert.match(studio, /어제 매출, 오늘 바로\\n통장에 입금/);
  assert.match(studio, /left: 48, top: 440, width: 624, height: 360/);
  assert.match(studio, /네이버톡톡 상담/);
});

test('studio core normalizes brand tokens and wraps editable canvas JSON', async () => {
  const core = await import(`${pathToFileURL(path.join(root, 'admin-assets', 'js', 'admin-design-studio-core.mjs')).href}?envelope=${Date.now()}`);
  const kit = core.normalizeBrandKit({ name: '샘플', primaryColor: '#11aa55', logoUrl: '/uploads/logo.png' });
  assert.equal(kit.primaryColor, '#11AA55');
  assert.equal(kit.textColor, '#12351B');
  const envelope = core.createDesignEnvelope({
    kind: 'popup',
    brandKitId: 7,
    width: 720,
    height: 1280,
    canvas: { objects: [{ type: 'Textbox', text: '입금' }] },
  });
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.brandKitId, 7);
  assert.equal(envelope.canvas.objects[0].text, '입금');
});

test('AI image presets cover banner, popup, and general image ratios', async () => {
  const core = await import(`${pathToFileURL(path.join(root, 'admin-assets', 'js', 'admin-design-studio-core.mjs')).href}?ai=${Date.now()}`);
  assert.deepEqual(core.resolveAiImagePreset('banner'), core.AI_IMAGE_PRESETS.banner);
  assert.equal(core.resolveAiImagePreset('popup').height > core.resolveAiImagePreset('popup').width, true);
  assert.equal(core.resolveAiImagePreset('square').width, core.resolveAiImagePreset('square').height);
  assert.equal(core.resolveAiImagePreset('landscape').width > core.resolveAiImagePreset('landscape').height, true);
  assert.equal(core.resolveAiImagePreset('portrait').height > core.resolveAiImagePreset('portrait').width, true);
  assert.deepEqual(core.resolveAiImagePreset('unknown'), core.AI_IMAGE_PRESETS.banner);
});

test('design studio exposes authenticated Codex ImageGen jobs and AI editor controls', () => {
  const studio = read('admin-assets', 'js', 'admin-design-studio.mjs');
  const worker = read('scripts', 'design-studio-imagegen-worker.js');
  assert.match(server, /\/api\/admin\/design-studio\/ai-images/);
  assert.match(server, /requireSystemAdminOnly/);
  assert.match(worker, /eatspay-design-director skill/);
  assert.match(worker, /codex-image-workspace/);
  assert.match(studio, /data-ds-action="ai-image"/);
  assert.match(studio, /data-ds-action="new-ai-image"/);
  assert.match(studio, /AI 이미지 만들기/);
  assert.match(studio, /pollAiImageJob/);
  assert.match(studio, /Ctrl\+V/);
  assert.match(studio, /data-ds-ai-reference-role/);
  assert.match(worker, /First use view_image to inspect/);
  assert.match(server, /INVALID_REFERENCE/);
  assert.match(studio, /A · 레퍼런스 문법/);
  assert.match(studio, /data-ds-action="ai-result-apply"/);
  assert.match(worker, /Generate exactly four distinct final images/);
  assert.match(server, /imageUrls/);
  assert.match(studio, /data-ds-ai-elapsed/);
  assert.match(worker, /외부 레퍼런스 URL에서 원본 미디어를 불러오고 있습니다/);
  assert.match(worker, /디자인 시안.*\/4 생성 완료/);
  assert.match(worker, /motion graphic, approximately/);
  assert.match(worker, /main Korean display lettering/);
  assert.match(worker, /expressive hand lettering/);
  assert.match(studio, /메인 디자인 문구/);
  assert.match(studio, /data-ds-ai-display-text/);
  assert.match(studio, /모션그래픽 MP4/);
  assert.match(studio, /data-ds-ai-output/);
  assert.match(worker, /hyperframes.*render/);
  assert.match(worker, /디자인 타이포 모션을 렌더링하고 있습니다/);
  assert.match(server, /videoUrl/);
});

test('reference analysis is visible, editable, size-aware, and supports separate logos', () => {
  const studio = read('admin-assets', 'js', 'admin-design-studio.mjs');
  const worker = read('scripts', 'design-studio-imagegen-worker.js');
  assert.match(server, /\/api\/admin\/design-studio\/reference-analysis/);
  assert.match(studio, /레퍼런스 이미지 또는 Pinterest URL을 먼저 붙여 넣어주세요/);
  assert.match(studio, /data-ds-ai-reference-url/);
  assert.match(studio, /data-ds-ai-analyze/);
  assert.match(studio, /data-ds-ai-analysis-prompt/);
  assert.match(studio, /data-ds-ai-width/);
  assert.match(studio, /data-ds-ai-height/);
  assert.match(studio, /data-ds-ai-logo-file/);
  assert.match(studio, /analysisPrompt/);
  assert.match(studio, /logoUrl/);
  assert.match(worker, /task === 'analyze'/);
  assert.match(worker, /mediaType/);
  assert.match(worker, /originalWidth/);
  assert.match(worker, /originalHeight/);
  assert.match(worker, /parseCodexMessage/);
  assert.match(worker, /copyIntoWorkspace/);
  assert.match(worker, /image attached to this Codex request directly/);
  assert.match(worker, /ANALYSIS_FAILED/);
});

test('generated assets open in an in-studio pan and zoom preview', () => {
  const studio = read('admin-assets', 'js', 'admin-design-studio.mjs');
  const css = read('admin-assets', 'css', 'admin-design-studio.css');
  assert.doesNotMatch(studio, /target="_blank"[^>]*>MP4 열기/);
  assert.match(studio, /data-ds-action="ai-result-preview"/);
  assert.match(studio, /data-ds-ai-lightbox/);
  assert.match(studio, /data-ds-action="ai-preview-fit"/);
  assert.match(studio, /data-ds-action="ai-preview-original"/);
  assert.match(studio, /wheel.*aiPreview|aiPreview.*wheel/s);
  assert.match(css, /\.ds-ai-lightbox/);
  assert.match(css, /\.ds-ai-lightbox-stage/);
});
