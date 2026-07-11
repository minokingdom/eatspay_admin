import {
  ActiveSelection,
  Canvas,
  Circle,
  FabricImage,
  FabricObject,
  Line,
  Rect,
  Textbox,
} from '../vendor/fabric.min.mjs?v=20260711-studio6';
import {
  DESIGN_PRESETS,
  AI_IMAGE_PRESETS,
  applyBrandRoles,
  applyTextStyle,
  arrangeObjects,
  createDesignEnvelope,
  createHistory,
  ensureTopLeftOrigin,
  normalizeBrandKit,
  studioShortcut,
  resolveAiImagePreset,
} from './admin-design-studio-core.mjs?v=20260711-ai1';

FabricObject.customProperties = ['id', 'name', 'brandRole', 'locked'];
FabricObject.ownDefaults.originX = 'left';
FabricObject.ownDefaults.originY = 'top';

const CUSTOM_PROPERTIES = ['id', 'name', 'brandRole', 'locked'];
const INTERNAL_ASSETS = [
  '/assets/hh-logo.webp',
  '/assets/coupang-eats.webp',
  '/assets/yogiyo.webp',
  '/assets/ddangyo.webp',
  '/assets/card-sales-v2.svg',
];
const state = {
  root: null,
  shell: null,
  dialog: null,
  toast: null,
  canvas: null,
  history: createHistory(80),
  restoring: false,
  dirty: false,
  saveTimer: null,
  textHistoryTimer: null,
  zoom: 1,
  panel: 'properties',
  brandKits: [],
  documents: [],
  currentDocument: null,
  currentDraft: null,
  applyTarget: null,
  textSelection: null,
  selectedBrandId: null,
  libraryQuery: '',
  libraryKind: '',
  libraryBrandId: '',
  aiJobId: '',
  aiPollTimer: null,
  aiReferenceUrl: '',
  aiReferenceName: '',
  aiResults: [],
  aiStartedAt: 0,
  aiElapsedTimer: null,
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function uniqueId(prefix = 'object') {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function headers(extra = {}) {
  return typeof window.adminAuthHeaders === 'function' ? window.adminAuthHeaders(extra) : extra;
}

async function api(path, options = {}) {
  const request = { ...options, headers: headers(options.headers || {}) };
  const response = await fetch(path, request);
  if (typeof window.handleAdminUnauthorized === 'function' && await window.handleAdminUnauthorized(response)) {
    throw new Error('관리자 로그인이 만료되었습니다. 편집 내용은 현재 화면에 유지됩니다.');
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.success) {
    throw new Error(json.error?.message || json.message || '요청을 처리하지 못했습니다.');
  }
  return json.data;
}

function showToast(message, error = false) {
  if (!state.toast) return;
  state.toast.textContent = message;
  state.toast.classList.toggle('is-error', error);
  state.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    if (state.toast) state.toast.hidden = true;
  }, error ? 6000 : 2600);
}

function setBusy(busy) {
  state.root?.classList.toggle('ds-busy', Boolean(busy));
}

function setSaveState(label, error = false) {
  const target = state.root?.querySelector('[data-ds-save-state]');
  if (!target) return;
  target.textContent = label;
  target.classList.toggle('is-error', error);
}

function ensureRoot() {
  if (state.root) return state.root;
  const root = document.createElement('div');
  root.id = 'admin-design-studio';
  root.className = 'ds-overlay';
  root.hidden = true;
  root.innerHTML = `
    <div class="ds-small-screen">디자인 스튜디오는 가로 980px 이상의 관리자 화면에서 사용할 수 있습니다.</div>
    <div data-ds-shell></div>
    <div class="ds-dialog-backdrop" data-ds-dialog hidden></div>
    <div class="ds-toast" data-ds-toast hidden></div>`;
  document.body.appendChild(root);
  state.root = root;
  state.shell = root.querySelector('[data-ds-shell]');
  state.dialog = root.querySelector('[data-ds-dialog]');
  state.toast = root.querySelector('[data-ds-toast]');
  root.addEventListener('click', (event) => {
    handleClick(event).catch((error) => showToast(error.message || '편집 명령을 처리하지 못했습니다.', true));
  });
  root.addEventListener('input', handleInput);
  root.addEventListener('change', handleChange);
  root.addEventListener('mousedown', rememberTextSelection, true);
  root.addEventListener('wheel', handleStudioWheel, { passive: false });
  document.addEventListener('keydown', (event) => {
    handleKeyboard(event).catch((error) => showToast(error.message || '단축키를 처리하지 못했습니다.', true));
  });
  document.addEventListener('paste', (event) => {
    handlePaste(event).catch((error) => showToast(error.message || '붙여넣기에 실패했습니다.', true));
  });
  return root;
}

async function loadLibraryData() {
  const [brandKits, documents] = await Promise.all([
    api('/api/admin/brand-kits'),
    api('/api/admin/design-documents'),
  ]);
  state.brandKits = Array.isArray(brandKits) ? brandKits.map(normalizeBrandKit) : [];
  state.documents = Array.isArray(documents) ? documents : [];
  if (!state.selectedBrandId && state.brandKits[0]) state.selectedBrandId = state.brandKits[0].id;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function brandOptions(selected = '') {
  return state.brandKits.map((brand) => `<option value="${esc(brand.id)}" ${String(brand.id) === String(selected) ? 'selected' : ''}>${esc(brand.name)}</option>`).join('');
}

function filteredDocuments() {
  const query = state.libraryQuery.trim().toLowerCase();
  return state.documents.filter((document) => {
    if (state.libraryKind && document.kind !== state.libraryKind) return false;
    if (state.libraryBrandId && String(document.brandKitId || '') !== String(state.libraryBrandId)) return false;
    if (query && !`${document.name || ''} ${document.brandKitName || ''}`.toLowerCase().includes(query)) return false;
    return document.status !== 'ARCHIVED';
  });
}

function renderLibrary() {
  disposeCanvas();
  const documents = filteredDocuments();
  state.shell.innerHTML = `
    <header class="ds-topbar">
      <div class="ds-topbar-group"><div class="ds-brand-mark">디자인 스튜디오</div></div>
      <div></div>
      <div class="ds-topbar-group is-end"><button type="button" class="ds-command is-icon" data-ds-action="close" aria-label="닫기" title="닫기">×</button></div>
    </header>
    <main class="ds-library">
      <div class="ds-library-inner">
        <div class="ds-library-head">
          <div><div class="ds-library-title">디자인 문서</div><div class="ds-library-subtitle">브랜드별 배너와 팝업을 저장하고 다시 편집합니다.</div></div>
          <div class="ds-library-actions">
            <button type="button" class="ds-command" data-ds-action="brand-manage">브랜드 키트</button>
            <button type="button" class="ds-command is-ai-primary" data-ds-action="new-ai-image">✦ AI 이미지 만들기</button>
            <button type="button" class="ds-command" data-ds-action="new-document" data-ds-kind="banner">새 배너</button>
            <button type="button" class="ds-command is-primary" data-ds-action="new-document" data-ds-kind="popup">새 팝업</button>
          </div>
        </div>
        <div class="ds-library-filters">
          <input class="ds-input" type="search" value="${esc(state.libraryQuery)}" data-ds-library-query placeholder="문서 또는 브랜드 검색">
          <select class="ds-select" data-ds-library-kind><option value="">전체 유형</option><option value="banner" ${state.libraryKind === 'banner' ? 'selected' : ''}>배너</option><option value="popup" ${state.libraryKind === 'popup' ? 'selected' : ''}>팝업</option></select>
          <select class="ds-select" data-ds-library-brand><option value="">전체 브랜드</option>${brandOptions(state.libraryBrandId)}</select>
        </div>
        ${documents.length ? `<div class="ds-document-grid">${documents.map(renderDocumentCard).join('')}</div>` : '<div class="ds-empty">등록된 디자인 문서가 없습니다.</div>'}
      </div>
    </main>`;
}

function renderDocumentCard(document) {
  const size = `${document.width || 0} × ${document.height || 0}`;
  return `<article class="ds-document-card">
    <div class="ds-document-thumb">${document.previewUrl ? `<img src="${esc(document.previewUrl)}" alt="">` : `<div class="ds-document-placeholder">${document.kind === 'popup' ? 'POPUP' : 'BANNER'}</div>`}</div>
    <div class="ds-document-meta"><b>${esc(document.name)}</b><span>${esc(document.brandKitName || '브랜드 미지정')} · ${document.kind === 'popup' ? '팝업' : '배너'} · ${size}</span><span>v${Number(document.version || 1)} · ${formatDate(document.updatedAt)}</span></div>
    <div class="ds-document-actions"><button type="button" class="ds-command" data-ds-action="edit-document" data-ds-document-id="${esc(document.id)}">편집</button><button type="button" class="ds-command is-danger" data-ds-action="archive-document" data-ds-document-id="${esc(document.id)}">보관</button></div>
  </article>`;
}

function defaultDocumentName(kind) {
  const label = kind === 'popup' ? '팝업' : '배너';
  const date = new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit' }).format(new Date());
  return `${label} ${date}`;
}

function createDraft(kind, options = {}) {
  const normalizedKind = kind === 'popup' ? 'popup' : 'banner';
  const preset = DESIGN_PRESETS[normalizedKind];
  const brandKitId = Number(options.brandKitId || state.selectedBrandId || state.brandKits[0]?.id) || null;
  return {
    id: null,
    name: String(options.title || defaultDocumentName(normalizedKind)),
    kind: normalizedKind,
    brandKitId,
    width: preset.width,
    height: preset.height,
    canvasJson: null,
    previewUrl: '',
    exportUrl: '',
    exportFormat: '',
    metadata: {},
    version: 1,
  };
}

async function openDocument(documentOrId, options = {}) {
  setBusy(true);
  try {
    let document = documentOrId;
    if (documentOrId && typeof documentOrId !== 'object') {
      document = await api(`/api/admin/design-documents/${encodeURIComponent(documentOrId)}`);
    }
    if (!document) document = createDraft(options.kind || 'banner', options);
    state.currentDocument = document.id ? document : null;
    state.currentDraft = { ...document };
    state.selectedBrandId = document.brandKitId || state.selectedBrandId;
    renderEditor();
    await initializeCanvas(document);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

function editorTopbar() {
  const document = state.currentDraft;
  return `<header class="ds-topbar">
    <div class="ds-topbar-group"><button type="button" class="ds-command is-icon" data-ds-action="back-library" aria-label="문서 목록" title="문서 목록">←</button><div class="ds-brand-mark">디자인 스튜디오</div></div>
    <div class="ds-topbar-group"><input class="ds-document-name" value="${esc(document.name)}" data-ds-document-name aria-label="문서 이름"><span class="ds-save-state" data-ds-save-state>${document.id ? '저장됨' : '새 문서'}</span></div>
    <div class="ds-topbar-group is-end">
      <select class="ds-select" data-ds-brand-select aria-label="브랜드 키트">${brandOptions(document.brandKitId)}</select>
      <button type="button" class="ds-command is-icon" data-ds-action="undo" aria-label="실행 취소" title="실행 취소 Ctrl+Z">↶</button>
      <button type="button" class="ds-command is-icon" data-ds-action="redo" aria-label="다시 실행" title="다시 실행 Ctrl+Shift+Z">↷</button>
      ${document.id ? '<button type="button" class="ds-command" data-ds-action="versions">버전</button>' : ''}
      <button type="button" class="ds-command" data-ds-action="save">저장</button>
      <button type="button" class="ds-command" data-ds-action="export">내보내기</button>
      ${state.applyTarget ? '<button type="button" class="ds-command is-primary" data-ds-action="apply">적용</button>' : ''}
      <button type="button" class="ds-command is-icon" data-ds-action="close" aria-label="닫기" title="닫기">×</button>
    </div>
  </header>`;
}

function renderEditor() {
  state.shell.innerHTML = `${editorTopbar()}
    <div class="ds-workspace">
      <aside class="ds-tools" aria-label="도구">
        <button type="button" class="ds-tool is-active" data-ds-action="select-tool"><b>↖</b><span>선택</span></button>
        <button type="button" class="ds-tool" data-ds-action="add-text"><b>T</b><span>텍스트</span></button>
        <button type="button" class="ds-tool" data-ds-action="image-pick"><b>▧</b><span>이미지</span></button>
        <button type="button" class="ds-tool is-ai" data-ds-action="ai-image"><b>✦</b><span>AI 생성</span></button>
        <button type="button" class="ds-tool" data-ds-action="add-rect"><b>□</b><span>사각형</span></button>
        <button type="button" class="ds-tool" data-ds-action="add-circle"><b>○</b><span>원</span></button>
        <button type="button" class="ds-tool" data-ds-action="add-line"><b>／</b><span>선</span></button>
        <div class="ds-tool-spacer"></div>
        <button type="button" class="ds-tool" data-ds-action="duplicate"><b>⧉</b><span>복제</span></button>
        <button type="button" class="ds-tool" data-ds-action="delete"><b>⌫</b><span>삭제</span></button>
        <input type="file" accept="image/png,image/jpeg,image/webp" data-ds-image-file hidden>
      </aside>
      <main class="ds-canvas-area" data-ds-canvas-area>
        <div class="ds-canvas-scroll" data-ds-canvas-scroll>
          <div class="ds-canvas-grid"></div>
          <div class="ds-canvas-center"><div class="ds-artboard-shell" data-ds-artboard><canvas data-ds-canvas></canvas><div class="ds-safe-guide"></div></div></div>
        </div>
        <div class="ds-zoom-bar"><button type="button" class="ds-command is-icon" data-ds-action="zoom-out" aria-label="축소" title="축소">−</button><span class="ds-zoom-value" data-ds-zoom>100%</span><button type="button" class="ds-command is-icon" data-ds-action="zoom-in" aria-label="확대" title="확대">+</button><button type="button" class="ds-command" data-ds-action="zoom-fit">맞춤</button></div>
      </main>
      <aside class="ds-panel">
        <div class="ds-panel-tabs"><button type="button" class="ds-panel-tab ${state.panel === 'properties' ? 'is-active' : ''}" data-ds-action="panel" data-ds-panel="properties">속성</button><button type="button" class="ds-panel-tab ${state.panel === 'layers' ? 'is-active' : ''}" data-ds-action="panel" data-ds-panel="layers">레이어</button></div>
        <div class="ds-panel-body" data-ds-panel-body></div>
      </aside>
    </div>`;
  renderSidePanel();
}

async function initializeCanvas(document) {
  disposeCanvas();
  const canvasElement = state.root.querySelector('[data-ds-canvas]');
  state.canvas = new Canvas(canvasElement, {
    width: document.width,
    height: document.height,
    backgroundColor: '#FFFFFF',
    preserveObjectStacking: true,
    selectionColor: 'rgba(3,199,90,.12)',
    selectionBorderColor: '#03C75A',
    selectionLineWidth: 1,
  });
  bindCanvasEvents();
  state.restoring = true;
  try {
    const saved = document.canvasJson?.canvas || document.canvasJson;
    if (saved && Array.isArray(saved.objects)) await state.canvas.loadFromJSON(saved);
    else await seedTemplate(document.kind, currentBrand());
    state.canvas.getObjects().forEach((object) => {
      ensureTopLeftOrigin(object);
      syncObjectLock(object);
    });
    state.canvas.requestRenderAll();
  } finally {
    state.restoring = false;
  }
  fitCanvas();
  state.history.reset(serializeCanvasState());
  state.dirty = false;
  renderSidePanel();
  refreshHistoryButtons();
}

function disposeCanvas() {
  clearTimeout(state.saveTimer);
  clearTimeout(state.textHistoryTimer);
  if (state.canvas) {
    state.canvas.dispose();
    state.canvas = null;
  }
}

function currentBrand() {
  return normalizeBrandKit(state.brandKits.find((brand) => String(brand.id) === String(state.currentDraft?.brandKitId || state.selectedBrandId)) || state.brandKits[0] || {});
}

function named(object, name, brandRole = '') {
  ensureTopLeftOrigin(object);
  object.set({ id: uniqueId('layer'), name, brandRole, locked: false });
  object.set({ cornerColor: '#03C75A', cornerStrokeColor: '#FFFFFF', borderColor: '#03C75A', cornerStyle: 'circle', transparentCorners: false, cornerSize: 10 });
  return object;
}

function addObject(object, select = true) {
  state.canvas.add(object);
  if (select) state.canvas.setActiveObject(object);
  state.canvas.requestRenderAll();
  return object;
}

async function seedTemplate(kind, brandValue) {
  const brand = normalizeBrandKit(brandValue);
  if (kind === 'popup') await seedPopup(brand);
  else await seedBanner(brand);
}

async function seedBanner(brand) {
  addObject(named(new Rect({ left: 0, top: 0, width: 1440, height: 256, fill: brand.surfaceColor, strokeWidth: 0 }), '배경', 'surface'), false);
  addObject(named(new Rect({ left: 0, top: 0, width: 22, height: 256, fill: brand.primaryColor, strokeWidth: 0 }), '브랜드 바', 'primary'), false);
  addObject(named(new Circle({ left: 1260, top: -80, radius: 160, fill: brand.primaryColor, opacity: .1, strokeWidth: 0 }), '배경 포인트', 'primary'), false);
  await addBrandLogo(brand, { left: 70, top: 76, width: 180, height: 90, color: brand.primaryColor }, false);
  addObject(named(new Textbox('어제의 매출, 오늘 바로 입금', { left: 320, top: 62, width: 820, fontFamily: brand.headingFontFamily, fontSize: 46, fontWeight: 900, fill: brand.textColor, lineHeight: 1.1 }), '메인 문구', 'heading'), false);
  addObject(named(new Textbox('사업 운영에 필요한 빠른 선정산 서비스', { left: 322, top: 132, width: 780, fontFamily: brand.fontFamily, fontSize: 24, fontWeight: 700, fill: '#64748B', lineHeight: 1.2 }), '설명 문구', 'body'), false);
  addObject(named(new Rect({ left: 1160, top: 91, width: 220, height: 72, rx: 12, ry: 12, fill: brand.primaryColor, strokeWidth: 0 }), 'CTA 배경', 'cta'), false);
  addObject(named(new Textbox(brand.defaultCtaLabel || '상담 신청하기', { left: 1180, top: 110, width: 180, fontFamily: brand.headingFontFamily, fontSize: 24, fontWeight: 900, textAlign: 'center', fill: '#FFFFFF' }), 'CTA 문구', 'ctaText'), false);
}

async function seedPopup(brand) {
  addObject(named(new Rect({ left: 0, top: 0, width: 720, height: 1280, fill: '#F3FFF6', strokeWidth: 0 }), '바깥 배경'), false);
  addObject(named(new Rect({ left: 48, top: 40, width: 624, height: 1200, rx: 36, ry: 36, fill: brand.surfaceColor, stroke: '#D8EBDD', strokeWidth: 2 }), '팝업 카드', 'surface'), false);
  addObject(named(new Rect({ left: 48, top: 40, width: 624, height: 138, rx: 36, ry: 36, fill: brand.primaryColor, strokeWidth: 0 }), '상단 둥근 배경', 'primary'), false);
  addObject(named(new Rect({ left: 48, top: 100, width: 624, height: 78, fill: brand.primaryColor, strokeWidth: 0 }), '상단 배경', 'primary'), false);
  if (brand.logoUrl) await addBrandLogo(brand, { left: 90, top: 78, width: 130, height: 46, color: '#FFFFFF' }, false);
  else await addImageFromUrl('/assets/eatspay-popup-logo-white.svg?v=20260711-logo-safe', { left: 90, top: 78, maxWidth: 130, maxHeight: 46, name: '브랜드 로고', brandRole: 'logo', select: false });
  addObject(named(new Line([244, 68, 244, 136], { stroke: '#FFFFFF', opacity: .65, strokeWidth: 2 }), '헤더 구분선'), false);
  addObject(named(new Textbox('선정산', { left: 270, top: 79, width: 250, fontFamily: brand.headingFontFamily, fontSize: 34, fontWeight: 900, fill: '#FFFFFF' }), '헤더 라벨', 'ctaText'), false);

  const intro = named(new Textbox('가입후 인증통한 입금수수료 무료', { left: 80, top: 210, width: 560, fontFamily: brand.fontFamily, fontSize: 18, fontWeight: 800, fill: '#64748B' }), '이벤트 문구', 'body');
  intro.setSelectionStyles({ fill: brand.primaryColor, fontWeight: 900 }, 4, 14);
  addObject(intro, false);
  const heading = named(new Textbox('어제 매출, 오늘 바로\n통장에 입금', { left: 80, top: 250, width: 560, fontFamily: brand.headingFontFamily, fontSize: 40, fontWeight: 900, fill: brand.textColor, lineHeight: 1.15 }), '메인 문구', 'heading');
  const accentStart = heading.text.lastIndexOf('입금');
  heading.setSelectionStyles({ fill: brand.primaryColor }, accentStart, accentStart + 2);
  addObject(heading, false);
  addObject(named(new Textbox('배달앱·카드 매출을 다음날 바로\n입금받고 자금 걱정 덜어드려요.', { left: 80, top: 355, width: 560, fontFamily: brand.fontFamily, fontSize: 18, fontWeight: 700, fill: '#64748B', lineHeight: 1.35 }), '설명 문구', 'body'), false);
  addObject(named(new Rect({ left: 48, top: 440, width: 624, height: 360, fill: '#EEF8E7', strokeWidth: 0 }), '혜택 배경'), false);
  const benefits = [
    ['익일 입금', '평일·휴일 상관없이 전날 매출 다음날 입금'],
    ['약정·위약금 없이 언제든', '필요할 때만 자유롭게, 부담 없이 이용'],
    ['투명한 수수료', '이용수수료 1.1%(부가세포함)'],
    ['신용등급 보호', '카드론·현금서비스 없이 내 매출로 자금확보'],
  ];
  benefits.forEach(([title, description], index) => {
    const y = 475 + index * 76;
    addObject(named(new Circle({ left: 78, top: y + 4, radius: 15, fill: '#FFFFFF', strokeWidth: 0 }), `혜택 ${index + 1} 아이콘`), false);
    addObject(named(new Textbox('✓', { left: 84, top: y + 3, width: 22, fontSize: 19, fontWeight: 900, fill: brand.primaryColor }), `혜택 ${index + 1} 체크`, 'primary'), false);
    addObject(named(new Textbox(title, { left: 122, top: y, width: 500, fontFamily: brand.headingFontFamily, fontSize: 19, fontWeight: 900, fill: brand.textColor }), `혜택 ${index + 1} 제목`, 'heading'), false);
    addObject(named(new Textbox(description, { left: 122, top: y + 28, width: 500, fontFamily: brand.fontFamily, fontSize: 14, fontWeight: 700, fill: '#64748B' }), `혜택 ${index + 1} 설명`, 'body'), false);
  });
  addObject(named(new Textbox('정산 대상', { left: 80, top: 835, width: 200, fontFamily: brand.headingFontFamily, fontSize: 16, fontWeight: 900, fill: '#98A2B3' }), '정산 대상 라벨'), false);
  for (let index = 0; index < INTERNAL_ASSETS.length; index += 1) {
    await addImageFromUrl(INTERNAL_ASSETS[index], {
      left: 84 + index * 112,
      top: 885,
      maxWidth: 76,
      maxHeight: 76,
      name: `정산 대상 ${index + 1}`,
      select: false,
    });
  }
  addObject(named(new Rect({ left: 80, top: 1005, width: 560, height: 82, rx: 18, ry: 18, fill: brand.primaryColor, strokeWidth: 0 }), 'CTA 배경', 'cta'), false);
  addObject(named(new Textbox(brand.defaultCtaLabel || '1분 상담 신청하기', { left: 100, top: 1030, width: 520, fontFamily: brand.headingFontFamily, fontSize: 23, fontWeight: 900, textAlign: 'center', fill: '#FFFFFF' }), 'CTA 문구', 'ctaText'), false);
  addObject(named(new Textbox(`${brand.contactText || '고객센터 1566-3558'} | 네이버톡톡 상담`, { left: 80, top: 1110, width: 560, fontFamily: brand.fontFamily, fontSize: 15, fontWeight: 800, textAlign: 'center', fill: '#64748B' }), '고객센터 문구', 'body'), false);
  addObject(named(new Line([48, 1170, 672, 1170], { stroke: '#E8ECE9', strokeWidth: 2 }), '하단 구분선'), false);
  addObject(named(new Textbox('□ 오늘 하루 보지 않기', { left: 80, top: 1192, width: 300, fontFamily: brand.fontFamily, fontSize: 15, fontWeight: 800, fill: '#98A2B3' }), '오늘 하루 보지 않기'), false);
  addObject(named(new Textbox('닫기 ×', { left: 540, top: 1192, width: 100, fontFamily: brand.fontFamily, fontSize: 15, fontWeight: 900, textAlign: 'right', fill: '#98A2B3' }), '닫기 문구'), false);
}

async function addBrandLogo(brand, box, select = true) {
  if (brand.logoUrl) {
    return addImageFromUrl(brand.logoUrl, { ...box, maxWidth: box.width, maxHeight: box.height, name: '브랜드 로고', brandRole: 'logo', select });
  }
  const text = named(new Textbox(brand.name || 'BRAND', {
    left: box.left,
    top: box.top + box.height * .2,
    width: box.width,
    fontFamily: brand.headingFontFamily,
    fontSize: Math.max(22, Math.round(box.height * .38)),
    fontWeight: 900,
    fill: box.color || '#FFFFFF',
  }), '브랜드 로고', 'logo');
  return addObject(text, select);
}

async function addImageFromUrl(url, options = {}) {
  const absolute = new URL(url, location.origin).href;
  const image = await FabricImage.fromURL(absolute, { crossOrigin: 'anonymous' });
  const maxWidth = Number(options.maxWidth || options.width || state.currentDraft.width * .5);
  const maxHeight = Number(options.maxHeight || options.height || state.currentDraft.height * .5);
  const scale = Math.min(maxWidth / Math.max(image.width || 1, 1), maxHeight / Math.max(image.height || 1, 1), 1);
  image.set({ left: Number(options.left || 40), top: Number(options.top || 40), scaleX: scale, scaleY: scale });
  named(image, options.name || '이미지', options.brandRole || '');
  return addObject(image, options.select !== false);
}

function showAiImageDialog() {
  clearTimeout(state.aiPollTimer);
  state.aiJobId = '';
  state.aiReferenceUrl = '';
  state.aiReferenceName = '';
  state.aiResults = [];
  const suggested = state.currentDraft?.kind === 'popup' ? 'popup' : 'banner';
  state.dialog.innerHTML = `<section class="ds-dialog ds-ai-dialog" role="dialog" aria-modal="true" aria-label="AI 이미지 만들기">
    <header class="ds-dialog-head"><div><b>AI 이미지 만들기</b><small>이츠비의 Codex ImageGen이 제작합니다.</small></div><button type="button" class="ds-command is-icon" data-ds-action="dialog-close" aria-label="닫기">×</button></header>
    <div class="ds-dialog-body"><div class="ds-ai-grid">
      <div class="ds-field"><label>이미지 유형</label><select class="ds-select" data-ds-ai-preset>${Object.entries(AI_IMAGE_PRESETS).map(([key, preset]) => `<option value="${key}" ${key === suggested ? 'selected' : ''}>${esc(preset.label)} · ${preset.width}×${preset.height}</option>`).join('')}</select></div>
      <div class="ds-field"><label>프롬프트</label><textarea class="ds-textarea ds-ai-prompt" data-ds-ai-prompt maxlength="1200" placeholder="예: 빠른 정산 서비스를 표현하는 프리미엄 녹색 배너. 오른쪽에 음식점 사장님, 왼쪽은 문구를 넣을 여백. 이미지 안에는 글자와 로고 없음."></textarea></div>
      <div class="ds-field"><label>레퍼런스 이미지 <span>선택사항</span></label>
        <button type="button" class="ds-ai-reference-drop" data-ds-action="ai-reference-pick"><b>이미지를 선택하거나 캡처 후 Ctrl+V</b><span>PNG · JPG · WebP</span></button>
        <input type="file" accept="image/png,image/jpeg,image/webp" data-ds-ai-reference-file hidden>
        <div class="ds-ai-reference-preview" data-ds-ai-reference-preview hidden><img data-ds-ai-reference-image alt="레퍼런스 이미지"><div><b data-ds-ai-reference-name></b><select class="ds-select" data-ds-ai-reference-role><option value="style">스타일 참고</option><option value="composition">구도 참고</option><option value="edit">이 이미지를 수정</option></select></div><button type="button" class="ds-command is-icon" data-ds-action="ai-reference-remove" aria-label="레퍼런스 삭제">×</button></div>
      </div>
      <p class="ds-ai-help">한글 문구와 로고는 생성 후 편집기에서 추가하면 더 선명합니다.</p>
      <div class="ds-ai-status" data-ds-ai-status hidden><span class="ds-ai-spinner" aria-hidden="true"></span><div><b data-ds-ai-status-title>이미지를 만들고 있습니다 <em data-ds-ai-elapsed>00:00</em></b><p data-ds-ai-status-text>네 가지 방향을 만들기 때문에 보통 2~6분 정도 걸립니다.</p></div></div>
      <div class="ds-ai-preview" data-ds-ai-preview hidden><div class="ds-ai-results" data-ds-ai-results></div><p>원하는 시안을 눌러 캔버스에 적용하세요.</p></div>
    </div></div>
    <footer class="ds-dialog-foot"><button type="button" class="ds-command" data-ds-action="dialog-close">닫기</button><button type="button" class="ds-command is-primary" data-ds-action="ai-generate">AI 이미지 만들기</button></footer>
  </section>`;
  state.dialog.hidden = false;
  requestAnimationFrame(() => state.dialog.querySelector('[data-ds-ai-prompt]')?.focus());
}

function startAiElapsed() {
  clearInterval(state.aiElapsedTimer);
  state.aiStartedAt = Date.now();
  const update = () => {
    const target = state.dialog.querySelector('[data-ds-ai-elapsed]');
    if (!target || !state.aiStartedAt) return;
    const seconds = Math.floor((Date.now() - state.aiStartedAt) / 1000);
    target.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  update();
  state.aiElapsedTimer = setInterval(update, 1000);
}

function stopAiElapsed() {
  clearInterval(state.aiElapsedTimer);
  state.aiElapsedTimer = null;
}

async function setAiReference(file) {
  if (!file) return;
  const drop = state.dialog.querySelector('[data-ds-action="ai-reference-pick"]');
  if (drop) { drop.disabled = true; drop.querySelector('b').textContent = '이미지 업로드 중'; }
  try {
    const uploaded = await uploadAsset(file);
    state.aiReferenceUrl = uploaded.imageUrl;
    state.aiReferenceName = file.name || '붙여넣은 캡처 이미지';
    const preview = state.dialog.querySelector('[data-ds-ai-reference-preview]');
    preview.hidden = false;
    preview.querySelector('[data-ds-ai-reference-image]').src = uploaded.imageUrl;
    preview.querySelector('[data-ds-ai-reference-name]').textContent = state.aiReferenceName;
    if (drop) drop.hidden = true;
  } catch (error) {
    if (drop) { drop.disabled = false; drop.querySelector('b').textContent = '이미지를 선택하거나 캡처 후 Ctrl+V'; }
    throw error;
  }
}

function removeAiReference() {
  state.aiReferenceUrl = '';
  state.aiReferenceName = '';
  const preview = state.dialog.querySelector('[data-ds-ai-reference-preview]');
  if (preview) preview.hidden = true;
  const drop = state.dialog.querySelector('[data-ds-action="ai-reference-pick"]');
  if (drop) { drop.hidden = false; drop.disabled = false; drop.querySelector('b').textContent = '이미지를 선택하거나 캡처 후 Ctrl+V'; }
  const input = state.dialog.querySelector('[data-ds-ai-reference-file]');
  if (input) input.value = '';
}

function setAiStatus(title, text, failed = false) {
  const status = state.dialog.querySelector('[data-ds-ai-status]');
  if (!status) return;
  status.hidden = false;
  status.classList.toggle('is-error', failed);
  status.querySelector('[data-ds-ai-status-title]').textContent = title;
  status.querySelector('[data-ds-ai-status-text]').textContent = text;
}

async function startAiImageGeneration() {
  const prompt = state.dialog.querySelector('[data-ds-ai-prompt]')?.value.trim() || '';
  const presetKey = state.dialog.querySelector('[data-ds-ai-preset]')?.value || 'banner';
  if (prompt.length < 10) throw new Error('원하는 이미지를 10자 이상 입력해 주세요.');
  const button = state.dialog.querySelector('[data-ds-action="ai-generate"]');
  if (button) { button.disabled = true; button.textContent = '생성 요청 중'; }
  setAiStatus('이미지 생성을 시작합니다', 'Codex ImageGen에 장면과 구도를 전달하고 있습니다.');
  startAiElapsed();
  try {
    const job = await api('/api/admin/design-studio/ai-images', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, preset: presetKey, referenceUrl: state.aiReferenceUrl, referenceRole: state.dialog.querySelector('[data-ds-ai-reference-role]')?.value || 'style' }),
    });
    state.aiJobId = job.id;
    pollAiImageJob();
  } catch (error) {
    stopAiElapsed();
    if (button) { button.disabled = false; button.textContent = '다시 만들기'; }
    setAiStatus('생성을 시작하지 못했습니다', error.message, true);
  }
}

async function pollAiImageJob() {
  if (!state.aiJobId || state.dialog.hidden) return;
  try {
    const job = await api(`/api/admin/design-studio/ai-images/${encodeURIComponent(state.aiJobId)}`);
    if (job.status === 'complete') {
      stopAiElapsed();
      const preview = state.dialog.querySelector('[data-ds-ai-preview]');
      preview.hidden = false;
      state.aiResults = (Array.isArray(job.imageUrls) && job.imageUrls.length ? job.imageUrls : [job.imageUrl]).filter(Boolean);
      const directionLabels = ['A · 가까운 스타일', 'B · 프리미엄', 'C · 강한 광고', 'D · 친근한 입체'];
      preview.querySelector('[data-ds-ai-results]').innerHTML = state.aiResults.map((url, index) => `<button type="button" class="ds-ai-result" data-ds-action="ai-result-apply" data-ds-result-index="${index}"><img src="${esc(url)}" alt="${esc(directionLabels[index] || `시안 ${index + 1}`)}"><b>${esc(directionLabels[index] || `시안 ${index + 1}`)}</b><span>캔버스에 적용</span></button>`).join('');
      setAiStatus(`${state.aiResults.length}개 시안이 완성되었습니다`, '서로 다른 방향을 비교한 뒤 하나를 선택하세요.');
      const button = state.dialog.querySelector('[data-ds-action="ai-generate"]');
      if (button) { button.disabled = false; button.textContent = '다른 이미지 만들기'; }
      return;
    }
    if (job.status === 'failed') {
      stopAiElapsed();
      setAiStatus('이미지 생성에 실패했습니다', job.error || '잠시 후 다시 시도해 주세요.', true);
      const button = state.dialog.querySelector('[data-ds-action="ai-generate"]');
      if (button) { button.disabled = false; button.textContent = '다시 만들기'; }
      return;
    }
    setAiStatus('이미지를 만들고 있습니다', job.message || '장면을 구성하고 세부 표현을 다듬는 중입니다.');
    state.aiPollTimer = setTimeout(pollAiImageJob, 2500);
  } catch (error) {
    setAiStatus('상태 확인이 지연되고 있습니다', error.message, true);
    state.aiPollTimer = setTimeout(pollAiImageJob, 5000);
  }
}

function bindCanvasEvents() {
  const canvas = state.canvas;
  const structural = ['object:added', 'object:removed', 'object:modified'];
  structural.forEach((eventName) => canvas.on(eventName, () => {
    if (state.restoring) return;
    markChanged();
    renderSidePanel();
  }));
  canvas.on('text:changed', () => {
    if (state.restoring) return;
    clearTimeout(state.textHistoryTimer);
    state.textHistoryTimer = setTimeout(() => markChanged(), 350);
    renderInspector();
  });
  canvas.on('selection:created', renderSidePanel);
  canvas.on('selection:updated', renderSidePanel);
  canvas.on('selection:cleared', renderSidePanel);
  canvas.on('text:selection:changed', rememberCanvasTextSelection);
  canvas.on('text:editing:entered', rememberCanvasTextSelection);
  canvas.on('object:moving', snapObject);
}

function snapObject(event) {
  const object = event.target;
  if (!object) return;
  const threshold = 7;
  const canvasCenter = state.currentDraft.width / 2;
  const objectCenter = object.left + object.getScaledWidth() / 2;
  if (Math.abs(objectCenter - canvasCenter) < threshold) object.set('left', canvasCenter - object.getScaledWidth() / 2);
  if (Math.abs(object.left) < threshold) object.set('left', 0);
  const right = object.left + object.getScaledWidth();
  if (Math.abs(right - state.currentDraft.width) < threshold) object.set('left', state.currentDraft.width - object.getScaledWidth());
}

function rememberCanvasTextSelection(event = {}) {
  const target = event.target || state.canvas?.getActiveObject();
  if (!target || !isTextObject(target)) return;
  state.textSelection = { id: target.id, start: Number(target.selectionStart || 0), end: Number(target.selectionEnd || 0) };
}

function rememberTextSelection(event) {
  if (!event.target.closest('[data-ds-text-style]')) return;
  rememberCanvasTextSelection();
}

function serializeCanvasObject() {
  const json = state.canvas.toObject(CUSTOM_PROPERTIES);
  const normalizeSources = (object) => {
    if (object?.src) {
      try {
        const url = new URL(object.src, location.origin);
        if (url.origin === location.origin) object.src = `${url.pathname}${url.search}`;
      } catch (_) {}
    }
    if (Array.isArray(object?.objects)) object.objects.forEach(normalizeSources);
  };
  (json.objects || []).forEach(normalizeSources);
  return json;
}

function serializeCanvasState() {
  return JSON.stringify(serializeCanvasObject());
}

function markChanged() {
  if (!state.canvas || state.restoring) return;
  state.history.push(serializeCanvasState());
  state.dirty = true;
  setSaveState('저장 안 됨');
  refreshHistoryButtons();
  scheduleAutosave();
}

function refreshHistoryButtons() {
  const undo = state.root?.querySelector('[data-ds-action="undo"]');
  const redo = state.root?.querySelector('[data-ds-action="redo"]');
  if (undo) undo.disabled = !state.history.canUndo();
  if (redo) redo.disabled = !state.history.canRedo();
}

async function restoreCanvasState(value) {
  if (!value || !state.canvas) return;
  state.restoring = true;
  try {
    await state.canvas.loadFromJSON(JSON.parse(value));
    state.canvas.getObjects().forEach((object) => {
      ensureTopLeftOrigin(object);
      syncObjectLock(object);
    });
    state.canvas.requestRenderAll();
    state.dirty = true;
    setSaveState('저장 안 됨');
    renderSidePanel();
  } finally {
    state.restoring = false;
    refreshHistoryButtons();
  }
}

function scheduleAutosave() {
  clearTimeout(state.saveTimer);
  if (!state.currentDocument?.id) return;
  state.saveTimer = setTimeout(() => saveDocument(true).catch(() => {}), 1600);
}

function documentPayload() {
  const canvas = serializeCanvasObject();
  const envelope = createDesignEnvelope({
    kind: state.currentDraft.kind,
    brandKitId: state.currentDraft.brandKitId,
    width: state.currentDraft.width,
    height: state.currentDraft.height,
    canvas,
    metadata: state.currentDraft.metadata || {},
  });
  return {
    name: state.currentDraft.name,
    kind: state.currentDraft.kind,
    brandKitId: state.currentDraft.brandKitId,
    width: state.currentDraft.width,
    height: state.currentDraft.height,
    canvasJson: envelope,
    previewUrl: state.currentDraft.previewUrl || '',
    metadata: state.currentDraft.metadata || {},
  };
}

async function saveDocument(autosave = false) {
  if (!state.canvas) return null;
  clearTimeout(state.saveTimer);
  setSaveState('저장 중');
  const payload = documentPayload();
  try {
    let document;
    if (!state.currentDocument?.id) {
      document = await api('/api/admin/design-documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
    } else {
      const path = autosave
        ? `/api/admin/design-documents/${encodeURIComponent(state.currentDocument.id)}/autosave`
        : `/api/admin/design-documents/${encodeURIComponent(state.currentDocument.id)}`;
      document = await api(path, {
        method: autosave ? 'PATCH' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
    }
    state.currentDocument = document;
    state.currentDraft = { ...state.currentDraft, ...document };
    state.dirty = false;
    setSaveState('저장됨');
    const versionButton = state.root.querySelector('[data-ds-action="versions"]');
    if (!versionButton) renderEditorAfterSave();
    if (!autosave) showToast('디자인 문서를 저장했습니다.');
    return document;
  } catch (error) {
    setSaveState('저장 실패', true);
    showToast(error.message, true);
    throw error;
  }
}

function renderEditorAfterSave() {
  const name = state.currentDraft.name;
  const selection = state.canvas?.getActiveObject()?.id || '';
  const canvas = state.canvas;
  const canvasElement = canvas?.lowerCanvasEl;
  if (!canvas || !canvasElement) return;
  const versionButton = document.createElement('button');
  versionButton.type = 'button';
  versionButton.className = 'ds-command';
  versionButton.dataset.dsAction = 'versions';
  versionButton.textContent = '버전';
  state.root.querySelector('[data-ds-action="save"]')?.before(versionButton);
  state.currentDraft.name = name;
  if (selection) selectObjectById(selection);
}

async function exportDocument(format = 'png') {
  if (!state.canvas) return null;
  if (!state.currentDocument?.id || state.dirty) await saveDocument(false);
  setBusy(true);
  try {
    state.canvas.discardActiveObject();
    state.canvas.requestRenderAll();
    const output = state.canvas.toCanvasElement(1);
    const mime = format === 'webp' ? 'image/webp' : 'image/png';
    const blob = await new Promise((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error('이미지를 생성하지 못했습니다.')), mime, .92));
    const form = new FormData();
    form.append('file', blob, `${state.currentDraft.name}.${format}`);
    const document = await api(`/api/admin/design-documents/${encodeURIComponent(state.currentDocument.id)}/export`, { method: 'POST', body: form });
    state.currentDocument = document;
    state.currentDraft = { ...state.currentDraft, ...document };
    showToast(`${format.toUpperCase()} 이미지를 만들었습니다.`);
    renderSidePanel();
    return document;
  } finally {
    setBusy(false);
  }
}

async function applyDocument() {
  const document = await exportDocument('png');
  const imageUrl = document?.exportUrl || document?.previewUrl || '';
  if (!imageUrl || !state.applyTarget) return;
  const imageInput = window.document.getElementById(state.applyTarget.imageInputId || 'bni');
  const designInput = window.document.getElementById(state.applyTarget.designInputId || 'bn-design-document-id');
  const preview = window.document.getElementById(state.applyTarget.previewId || 'bn-generated-preview');
  if (imageInput) {
    imageInput.value = imageUrl;
    imageInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (designInput) designInput.value = document.id;
  if (preview) {
    preview.src = imageUrl;
    preview.closest('.banner-generated-preview-wrap')?.classList.add('has-image');
    preview.closest('.banner-generated-preview-wrap')?.classList.remove('is-empty');
  }
  closeStudio();
  if (typeof window.toast === 'function') window.toast('디자인 스튜디오 이미지 적용');
}

function setZoom(value) {
  state.zoom = Math.max(.1, Math.min(Number(value) || 1, 2));
  const width = Math.round(state.currentDraft.width * state.zoom);
  const height = Math.round(state.currentDraft.height * state.zoom);
  state.canvas?.setDimensions({ width, height }, { cssOnly: true });
  const artboard = state.root?.querySelector('[data-ds-artboard]');
  if (artboard) {
    artboard.style.width = `${width}px`;
    artboard.style.height = `${height}px`;
  }
  const zoomLabel = state.root?.querySelector('[data-ds-zoom]');
  if (zoomLabel) zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  state.canvas?.calcOffset();
}

function handleStudioWheel(event) {
  if (state.root?.hidden || !state.canvas || !(event.ctrlKey || event.metaKey)) return;
  if (!event.target.closest?.('[data-ds-canvas-area]')) return;
  event.preventDefault();
  setZoom(state.zoom + (event.deltaY < 0 ? .1 : -.1));
}

function fitCanvas() {
  const area = state.root?.querySelector('[data-ds-canvas-area]');
  if (!area || !state.currentDraft) return;
  const availableWidth = Math.max(area.clientWidth - 128, 240);
  const availableHeight = Math.max(area.clientHeight - 128, 240);
  const scale = Math.min(availableWidth / state.currentDraft.width, availableHeight / state.currentDraft.height, 1);
  setZoom(scale);
}

function isTextObject(object) {
  const type = String(object?.type || '').toLowerCase();
  return type.includes('text');
}

function activeObject() {
  return state.canvas?.getActiveObject() || null;
}

function renderSidePanel() {
  if (state.panel === 'layers') renderLayers();
  else renderInspector();
}

function renderInspector() {
  const body = state.root?.querySelector('[data-ds-panel-body]');
  if (!body || state.panel !== 'properties') return;
  const object = activeObject();
  if (!object) {
    body.innerHTML = '<div class="ds-inspector-empty">캔버스에서 편집할 항목을 선택하세요.</div>';
    return;
  }
  if (object instanceof ActiveSelection) {
    body.innerHTML = `<div class="ds-section"><div class="ds-section-title">${object.size()}개 선택</div>
      <div class="ds-field"><label>가로 정렬</label><div class="ds-arrange-grid"><button type="button" class="ds-command" data-ds-action="arrange" data-ds-arrange="left" title="왼쪽 정렬">왼쪽</button><button type="button" class="ds-command" data-ds-action="arrange" data-ds-arrange="center" title="가로 가운데 정렬">가운데</button><button type="button" class="ds-command" data-ds-action="arrange" data-ds-arrange="right" title="오른쪽 정렬">오른쪽</button></div></div>
      <div class="ds-field"><label>세로 정렬</label><div class="ds-arrange-grid"><button type="button" class="ds-command" data-ds-action="arrange" data-ds-arrange="top" title="위쪽 정렬">위</button><button type="button" class="ds-command" data-ds-action="arrange" data-ds-arrange="middle" title="세로 가운데 정렬">중앙</button><button type="button" class="ds-command" data-ds-action="arrange" data-ds-arrange="bottom" title="아래쪽 정렬">아래</button></div></div>
      <div class="ds-field"><label>간격 맞춤</label><div class="ds-arrange-grid is-two"><button type="button" class="ds-command" data-ds-action="arrange" data-ds-arrange="distribute-h" title="가로 간격을 동일하게 배치">가로 동일 간격</button><button type="button" class="ds-command" data-ds-action="arrange" data-ds-arrange="distribute-v" title="세로 간격을 동일하게 배치">세로 동일 간격</button></div></div>
    </div><div class="ds-section ds-selection-actions"><button type="button" class="ds-command" data-ds-action="duplicate">복제</button><button type="button" class="ds-command is-danger" data-ds-action="delete">삭제</button></div>`;
    return;
  }
  const type = String(object.type || 'object').toLowerCase();
  const textFields = isTextObject(object) ? `<div class="ds-section"><div class="ds-section-title">텍스트</div>
    <div class="ds-field"><label>내용</label><textarea class="ds-textarea" data-ds-prop="text">${esc(object.text || '')}</textarea></div>
    <div class="ds-field-grid"><div class="ds-field"><label>글꼴</label><select class="ds-select" data-ds-prop="fontFamily"><option ${object.fontFamily === 'Pretendard' ? 'selected' : ''}>Pretendard</option><option ${object.fontFamily === 'Noto Sans KR' ? 'selected' : ''}>Noto Sans KR</option><option ${object.fontFamily === 'Arial' ? 'selected' : ''}>Arial</option></select></div><div class="ds-field"><label>크기</label><input class="ds-input" type="number" min="6" max="300" value="${Number(object.fontSize || 24)}" data-ds-prop="fontSize"></div></div>
    <div class="ds-field-grid"><div class="ds-field"><label>굵기</label><select class="ds-select" data-ds-prop="fontWeight"><option value="400" ${String(object.fontWeight) === '400' ? 'selected' : ''}>보통</option><option value="700" ${String(object.fontWeight) === '700' ? 'selected' : ''}>굵게</option><option value="900" ${String(object.fontWeight) === '900' ? 'selected' : ''}>매우 굵게</option></select></div><div class="ds-field"><label>행간</label><input class="ds-input" type="number" min="0.7" max="3" step="0.05" value="${Number(object.lineHeight || 1.16)}" data-ds-prop="lineHeight"></div></div>
    <div class="ds-field"><label>선택 글자색</label><div class="ds-color-row"><input class="ds-color" type="color" value="${esc(normalizeColor(object.fill, '#12351B'))}" data-ds-text-style="fill"><input class="ds-input" value="${esc(normalizeColor(object.fill, '#12351B'))}" data-ds-text-style-text="fill"></div></div>
    <div class="ds-field"><label>정렬</label><div class="ds-segment"><button type="button" class="ds-command" data-ds-action="text-align" data-ds-value="left">왼쪽</button><button type="button" class="ds-command" data-ds-action="text-align" data-ds-value="center">가운데</button><button type="button" class="ds-command" data-ds-action="text-align" data-ds-value="right">오른쪽</button></div></div>
  </div>` : '';
  const fillFields = !isTextObject(object) && !type.includes('image') && !type.includes('line') ? `<div class="ds-field"><label>채우기</label><div class="ds-color-row"><input class="ds-color" type="color" value="${esc(normalizeColor(object.fill, '#FFFFFF'))}" data-ds-prop="fill"><input class="ds-input" value="${esc(normalizeColor(object.fill, '#FFFFFF'))}" data-ds-color-text="fill"></div></div>` : '';
  body.innerHTML = `${textFields}<div class="ds-section"><div class="ds-section-title">레이어</div><div class="ds-field"><label>이름</label><input class="ds-input" value="${esc(object.name || type)}" data-ds-prop="name"></div>${fillFields}<div class="ds-field-grid"><div class="ds-field"><label>투명도</label><input class="ds-input" type="number" min="0" max="1" step="0.05" value="${Number(object.opacity ?? 1)}" data-ds-prop="opacity"></div><div class="ds-field"><label>회전</label><input class="ds-input" type="number" min="-360" max="360" value="${Math.round(Number(object.angle || 0))}" data-ds-prop="angle"></div></div></div>
    <div class="ds-section"><div class="ds-section-title">위치와 크기</div><div class="ds-field-grid"><div class="ds-field"><label>X</label><input class="ds-input" type="number" value="${Math.round(Number(object.left || 0))}" data-ds-prop="left"></div><div class="ds-field"><label>Y</label><input class="ds-input" type="number" value="${Math.round(Number(object.top || 0))}" data-ds-prop="top"></div><div class="ds-field"><label>너비</label><input class="ds-input" type="number" value="${Math.round(object.getScaledWidth())}" data-ds-size="width"></div><div class="ds-field"><label>높이</label><input class="ds-input" type="number" value="${Math.round(object.getScaledHeight())}" data-ds-size="height"></div></div></div>
    <div class="ds-section"><button type="button" class="ds-command" data-ds-action="toggle-lock">${object.locked ? '잠금 해제' : '잠금'}</button> <button type="button" class="ds-command" data-ds-action="duplicate">복제</button> <button type="button" class="ds-command is-danger" data-ds-action="delete">삭제</button></div>`;
}

function normalizeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : fallback;
}

function renderLayers() {
  const body = state.root?.querySelector('[data-ds-panel-body]');
  if (!body || state.panel !== 'layers' || !state.canvas) return;
  const activeIds = new Set(state.canvas.getActiveObjects().map((object) => object.id));
  const layers = state.canvas.getObjects().slice().reverse();
  body.innerHTML = `<div class="ds-layer-list">${layers.map((object) => `<div class="ds-layer ${activeIds.has(object.id) ? 'is-active' : ''} ${object.visible === false ? 'is-hidden' : ''}" data-ds-action="select-layer" data-ds-layer-id="${esc(object.id)}"><span class="ds-layer-icon">${layerIcon(object)}</span><span class="ds-layer-name">${esc(object.name || object.type || '레이어')}</span><span class="ds-layer-actions"><button type="button" class="ds-layer-action" data-ds-action="layer-visible" data-ds-layer-id="${esc(object.id)}" aria-label="표시 전환" title="표시 전환">${object.visible === false ? '○' : '●'}</button><button type="button" class="ds-layer-action" data-ds-action="layer-lock" data-ds-layer-id="${esc(object.id)}" aria-label="잠금 전환" title="잠금 전환">${object.locked ? '■' : '□'}</button></span></div>`).join('')}</div>`;
}

function layerIcon(object) {
  const type = String(object?.type || '').toLowerCase();
  if (type.includes('text')) return 'T';
  if (type.includes('image')) return '▧';
  if (type.includes('circle')) return '○';
  if (type.includes('line')) return '／';
  return '□';
}

function objectById(id) {
  return state.canvas?.getObjects().find((object) => String(object.id) === String(id)) || null;
}

function selectObjectById(id) {
  const object = objectById(id);
  if (!object) return;
  state.canvas.setActiveObject(object);
  state.canvas.requestRenderAll();
  renderSidePanel();
}

function setLocked(object, locked) {
  if (!object) return;
  object.set({
    locked: Boolean(locked),
    lockMovementX: Boolean(locked),
    lockMovementY: Boolean(locked),
    lockScalingX: Boolean(locked),
    lockScalingY: Boolean(locked),
    lockRotation: Boolean(locked),
    hasControls: !locked,
  });
}

function syncObjectLock(object) {
  setLocked(object, Boolean(object.locked));
}

async function duplicateSelection() {
  const objects = state.canvas?.getActiveObjects() || [];
  if (!objects.length) return;
  const clones = [];
  for (const object of objects) {
    const clone = await object.clone(CUSTOM_PROPERTIES);
    clone.set({ id: uniqueId('layer'), name: `${object.name || '레이어'} 복사`, left: Number(object.left || 0) + 18, top: Number(object.top || 0) + 18 });
    syncObjectLock(clone);
    state.canvas.add(clone);
    clones.push(clone);
  }
  if (clones.length === 1) state.canvas.setActiveObject(clones[0]);
  else state.canvas.setActiveObject(new ActiveSelection(clones, { canvas: state.canvas }));
  state.canvas.requestRenderAll();
}

function arrangeSelection(mode) {
  const objects = state.canvas?.getActiveObjects() || [];
  if (objects.length < 2) return;
  state.canvas.discardActiveObject();
  const changed = arrangeObjects(objects, mode);
  state.canvas.setActiveObject(new ActiveSelection(objects, { canvas: state.canvas }));
  state.canvas.requestRenderAll();
  if (changed) markChanged();
  renderSidePanel();
}

function deleteSelection() {
  const objects = state.canvas?.getActiveObjects() || [];
  if (!objects.length) return;
  state.canvas.discardActiveObject();
  state.canvas.remove(...objects);
  state.canvas.requestRenderAll();
}

function addText() {
  const brand = currentBrand();
  const text = named(new Textbox('텍스트를 입력하세요', {
    left: Math.round(state.currentDraft.width * .15), top: Math.round(state.currentDraft.height * .15), width: Math.round(state.currentDraft.width * .7), fontFamily: brand.fontFamily, fontSize: state.currentDraft.kind === 'popup' ? 34 : 38, fontWeight: 700, fill: brand.textColor, lineHeight: 1.2,
  }), '텍스트', 'body');
  addObject(text);
  text.enterEditing();
  text.selectAll();
}

function addRect() {
  const brand = currentBrand();
  addObject(named(new Rect({ left: 80, top: 80, width: Math.round(state.currentDraft.width * .28), height: Math.round(state.currentDraft.height * .16), rx: 8, ry: 8, fill: brand.primaryColor, strokeWidth: 0 }), '사각형', 'primary'));
}

function addCircle() {
  const brand = currentBrand();
  addObject(named(new Circle({ left: 100, top: 100, radius: Math.max(30, Math.round(Math.min(state.currentDraft.width, state.currentDraft.height) * .07)), fill: brand.accentColor, strokeWidth: 0 }), '원', 'accent'));
}

function addLine() {
  addObject(named(new Line([100, 100, 360, 100], { stroke: currentBrand().textColor, strokeWidth: 3 }), '선'));
}

async function uploadAsset(file) {
  if (!file || !/^image\/(png|jpeg|webp)$/i.test(file.type)) throw new Error('PNG, JPG, WebP 이미지만 사용할 수 있습니다.');
  const form = new FormData();
  form.append('file', file);
  return api('/api/admin/banners/upload-image', { method: 'POST', body: form });
}

async function addUploadedImage(file) {
  setBusy(true);
  try {
    const uploaded = await uploadAsset(file);
    await addImageFromUrl(uploaded.imageUrl, { left: 70, top: 70, name: file.name || '이미지', select: true });
    showToast('이미지를 추가했습니다.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function changeBrand(brandId) {
  const brand = normalizeBrandKit(state.brandKits.find((item) => String(item.id) === String(brandId)) || {});
  state.currentDraft.brandKitId = brand.id;
  applyBrandRoles(state.canvas.getObjects(), brand);
  await replaceBrandLogo(brand);
  state.canvas.requestRenderAll();
  markChanged();
  renderSidePanel();
}

async function replaceBrandLogo(brand) {
  const logo = state.canvas.getObjects().find((object) => object.brandRole === 'logo');
  if (!logo || !brand.logoUrl) return;
  const index = state.canvas.getObjects().indexOf(logo);
  const box = { left: logo.left, top: logo.top, maxWidth: logo.getScaledWidth(), maxHeight: logo.getScaledHeight(), name: '브랜드 로고', brandRole: 'logo', select: false };
  state.restoring = true;
  try {
    state.canvas.remove(logo);
    const image = await addImageFromUrl(brand.logoUrl, box);
    state.canvas.moveObjectTo(image, index);
  } finally {
    state.restoring = false;
  }
}

function applyObjectProperty(element) {
  const object = activeObject();
  if (!object || object instanceof ActiveSelection) return;
  const property = element.dataset.dsProp;
  let value = element.value;
  if (['fontSize', 'lineHeight', 'opacity', 'angle', 'left', 'top'].includes(property)) value = Number(value);
  object.set(property, value);
  object.setCoords();
  state.canvas.requestRenderAll();
  markChanged();
  if (property === 'name') renderLayers();
}

function applyObjectSize(element) {
  const object = activeObject();
  if (!object || object instanceof ActiveSelection) return;
  const target = Math.max(1, Number(element.value) || 1);
  if (element.dataset.dsSize === 'width') object.scaleX *= target / Math.max(object.getScaledWidth(), 1);
  else object.scaleY *= target / Math.max(object.getScaledHeight(), 1);
  object.setCoords();
  state.canvas.requestRenderAll();
  markChanged();
}

function applySelectedTextStyle(property, value) {
  const object = activeObject();
  if (!object || !isTextObject(object)) return;
  const selection = state.textSelection?.id === object.id ? state.textSelection : null;
  if (object.isEditing && selection && selection.end > selection.start && typeof object.setSelectionStyles === 'function') {
    object.setSelectionStyles({ [property]: value }, selection.start, selection.end);
  } else {
    applyTextStyle(object, { [property]: value });
  }
  object.setCoords();
  state.canvas.requestRenderAll();
  markChanged();
}

async function showBrandManager(selectedId = null) {
  const brand = normalizeBrandKit(state.brandKits.find((item) => String(item.id) === String(selectedId || state.selectedBrandId)) || {});
  state.dialog.dataset.dsBrandId = brand.id || '';
  state.dialog.innerHTML = `<section class="ds-dialog" role="dialog" aria-modal="true" aria-label="브랜드 키트">
    <header class="ds-dialog-head"><b>브랜드 키트</b><button type="button" class="ds-command is-icon" data-ds-action="dialog-close" aria-label="닫기">×</button></header>
    <div class="ds-dialog-body"><div class="ds-brand-layout">
      <div class="ds-brand-list"><button type="button" class="ds-command is-primary" data-ds-action="brand-new">새 브랜드</button>${state.brandKits.map((item) => `<button type="button" class="ds-brand-item ${String(item.id) === String(brand.id) ? 'is-active' : ''}" data-ds-action="brand-edit" data-ds-brand-id="${esc(item.id)}"><span>${esc(item.name)}</span><small>${item.active ? '사용' : '미사용'}</small></button>`).join('')}</div>
      <div data-ds-brand-form>${brandForm(brand)}</div>
    </div></div>
    <footer class="ds-dialog-foot"><button type="button" class="ds-command is-danger" data-ds-action="brand-delete" ${brand.id ? '' : 'disabled'}>삭제</button><button type="button" class="ds-command" data-ds-action="dialog-close">취소</button><button type="button" class="ds-command is-primary" data-ds-action="brand-save">저장</button></footer>
  </section>`;
  state.dialog.hidden = false;
}

function brandForm(brand) {
  return `<div class="ds-field-grid"><div class="ds-field"><label>브랜드 이름</label><input class="ds-input" data-ds-brand-field="name" value="${esc(brand.name)}"></div><div class="ds-field"><label>식별자</label><input class="ds-input" data-ds-brand-field="slug" value="${esc(brand.slug)}" placeholder="brand-name"></div></div>
    <div class="ds-field"><label>로고</label><div class="ds-topbar-group"><input class="ds-input" data-ds-brand-field="logoUrl" value="${esc(brand.logoUrl)}" readonly><button type="button" class="ds-command" data-ds-action="brand-logo-pick">업로드</button><input type="file" data-ds-brand-logo-file accept="image/png,image/jpeg,image/webp" hidden></div></div>
    <div class="ds-field"><label>브랜드 색상</label><div class="ds-brand-colors">${[['primaryColor','Primary'],['secondaryColor','Secondary'],['accentColor','Accent'],['surfaceColor','Surface'],['textColor','Text']].map(([key, label]) => `<label class="ds-brand-color"><span>${label}</span><input type="color" data-ds-brand-field="${key}" value="${esc(brand[key])}"></label>`).join('')}</div></div>
    <div class="ds-field-grid"><div class="ds-field"><label>본문 글꼴</label><select class="ds-select" data-ds-brand-field="fontFamily"><option ${brand.fontFamily === 'Pretendard' ? 'selected' : ''}>Pretendard</option><option ${brand.fontFamily === 'Noto Sans KR' ? 'selected' : ''}>Noto Sans KR</option><option ${brand.fontFamily === 'Arial' ? 'selected' : ''}>Arial</option></select></div><div class="ds-field"><label>제목 글꼴</label><select class="ds-select" data-ds-brand-field="headingFontFamily"><option ${brand.headingFontFamily === 'Pretendard' ? 'selected' : ''}>Pretendard</option><option ${brand.headingFontFamily === 'Noto Sans KR' ? 'selected' : ''}>Noto Sans KR</option><option ${brand.headingFontFamily === 'Arial' ? 'selected' : ''}>Arial</option></select></div></div>
    <div class="ds-field-grid"><div class="ds-field"><label>기본 CTA</label><input class="ds-input" data-ds-brand-field="defaultCtaLabel" value="${esc(brand.defaultCtaLabel)}"></div><div class="ds-field"><label>CTA URL</label><input class="ds-input" data-ds-brand-field="defaultCtaUrl" value="${esc(brand.defaultCtaUrl)}"></div></div>
    <div class="ds-field-grid"><div class="ds-field"><label>연락처 문구</label><input class="ds-input" data-ds-brand-field="contactText" value="${esc(brand.contactText)}"></div><div class="ds-field"><label>상태</label><select class="ds-select" data-ds-brand-field="active"><option value="true" ${brand.active ? 'selected' : ''}>사용</option><option value="false" ${!brand.active ? 'selected' : ''}>미사용</option></select></div></div>`;
}

function brandPayload() {
  const get = (key) => state.dialog.querySelector(`[data-ds-brand-field="${key}"]`)?.value || '';
  return {
    name: get('name'), slug: get('slug'), logoUrl: get('logoUrl'),
    primaryColor: get('primaryColor'), secondaryColor: get('secondaryColor'), accentColor: get('accentColor'), surfaceColor: get('surfaceColor'), textColor: get('textColor'),
    fontFamily: get('fontFamily'), headingFontFamily: get('headingFontFamily'), defaultCtaLabel: get('defaultCtaLabel'), defaultCtaUrl: get('defaultCtaUrl'), contactText: get('contactText'), active: get('active') !== 'false',
  };
}

async function saveBrand() {
  const id = state.dialog.dataset.dsBrandId;
  const payload = brandPayload();
  setBusy(true);
  try {
    const saved = await api(id ? `/api/admin/brand-kits/${encodeURIComponent(id)}` : '/api/admin/brand-kits', {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const index = state.brandKits.findIndex((item) => String(item.id) === String(saved.id));
    if (index >= 0) state.brandKits[index] = normalizeBrandKit(saved);
    else state.brandKits.push(normalizeBrandKit(saved));
    state.selectedBrandId = saved.id;
    showToast('브랜드 키트를 저장했습니다.');
    await showBrandManager(saved.id);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function deleteBrand() {
  const id = state.dialog.dataset.dsBrandId;
  if (!id || !confirm('이 브랜드 키트를 삭제하시겠습니까?')) return;
  setBusy(true);
  try {
    await api(`/api/admin/brand-kits/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.brandKits = state.brandKits.filter((item) => String(item.id) !== String(id));
    state.selectedBrandId = state.brandKits[0]?.id || null;
    await showBrandManager(state.selectedBrandId);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function showVersions() {
  const versions = await api(`/api/admin/design-documents/${encodeURIComponent(state.currentDocument.id)}/versions`);
  state.dialog.innerHTML = `<section class="ds-dialog" role="dialog" aria-modal="true" aria-label="버전 기록"><header class="ds-dialog-head"><b>버전 기록</b><button type="button" class="ds-command is-icon" data-ds-action="dialog-close">×</button></header><div class="ds-dialog-body"><div class="ds-version-list">${versions.map((version) => `<div class="ds-version-row"><b>v${version.version}</b><span>${formatDate(version.createdAt)}</span><button type="button" class="ds-command" data-ds-action="restore-version" data-ds-version="${version.version}">복원</button></div>`).join('') || '<div class="ds-empty">저장된 버전이 없습니다.</div>'}</div></div><footer class="ds-dialog-foot"><button type="button" class="ds-command" data-ds-action="dialog-close">닫기</button></footer></section>`;
  state.dialog.hidden = false;
}

async function restoreVersion(version) {
  if (!confirm(`버전 ${version}의 디자인으로 복원하시겠습니까?`)) return;
  setBusy(true);
  try {
    const document = await api(`/api/admin/design-documents/${encodeURIComponent(state.currentDocument.id)}/restore/${encodeURIComponent(version)}`, { method: 'POST' });
    state.dialog.hidden = true;
    await openDocument(document);
    showToast(`버전 ${version}을 복원했습니다.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function archiveDocument(id) {
  if (!confirm('이 디자인 문서를 보관하시겠습니까?')) return;
  try {
    await api(`/api/admin/design-documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.documents = state.documents.filter((item) => String(item.id) !== String(id));
    renderLibrary();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleClick(event) {
  const trigger = event.target.closest('[data-ds-action]');
  if (!trigger) return;
  const action = trigger.dataset.dsAction;
  if (action === 'close') closeStudio();
  else if (action === 'back-library') { await loadLibraryData(); renderLibrary(); }
  else if (action === 'new-document') await openDocument(null, { kind: trigger.dataset.dsKind });
  else if (action === 'new-ai-image') { await openDocument(null, { kind: 'banner', title: 'AI 이미지' }); showAiImageDialog(); }
  else if (action === 'edit-document') await openDocument(trigger.dataset.dsDocumentId);
  else if (action === 'archive-document') await archiveDocument(trigger.dataset.dsDocumentId);
  else if (action === 'brand-manage') await showBrandManager();
  else if (action === 'brand-new') { state.dialog.dataset.dsBrandId = ''; state.dialog.querySelector('[data-ds-brand-form]').innerHTML = brandForm(normalizeBrandKit({ name: '새 브랜드', slug: '' })); }
  else if (action === 'brand-edit') await showBrandManager(trigger.dataset.dsBrandId);
  else if (action === 'brand-save') await saveBrand();
  else if (action === 'brand-delete') await deleteBrand();
  else if (action === 'brand-logo-pick') state.dialog.querySelector('[data-ds-brand-logo-file]')?.click();
  else if (action === 'dialog-close') state.dialog.hidden = true;
  else if (action === 'undo') await restoreCanvasState(state.history.undo());
  else if (action === 'redo') await restoreCanvasState(state.history.redo());
  else if (action === 'save') await saveDocument(false);
  else if (action === 'export') await exportDocument('png');
  else if (action === 'apply') await applyDocument();
  else if (action === 'versions') await showVersions();
  else if (action === 'restore-version') await restoreVersion(trigger.dataset.dsVersion);
  else if (action === 'add-text') addText();
  else if (action === 'image-pick') state.root.querySelector('[data-ds-image-file]')?.click();
  else if (action === 'ai-image') showAiImageDialog();
  else if (action === 'ai-generate') await startAiImageGeneration();
  else if (action === 'ai-reference-pick') state.dialog.querySelector('[data-ds-ai-reference-file]')?.click();
  else if (action === 'ai-reference-remove') removeAiReference();
  else if (action === 'ai-result-apply') {
    const url = state.aiResults[Number(trigger.dataset.dsResultIndex)];
    if (url) {
      const preset = resolveAiImagePreset(state.dialog.querySelector('[data-ds-ai-preset]')?.value || 'banner');
      await addImageFromUrl(url, { left: 0, top: 0, maxWidth: state.currentDraft.width, maxHeight: state.currentDraft.height, name: `AI ${preset.label}`, select: true });
      markChanged();
      showToast('선택한 시안을 캔버스에 적용했습니다.');
    }
  }
  else if (action === 'add-rect') addRect();
  else if (action === 'add-circle') addCircle();
  else if (action === 'add-line') addLine();
  else if (action === 'duplicate') await duplicateSelection();
  else if (action === 'delete') deleteSelection();
  else if (action === 'zoom-out') setZoom(state.zoom - .1);
  else if (action === 'zoom-in') setZoom(state.zoom + .1);
  else if (action === 'zoom-fit') fitCanvas();
  else if (action === 'panel') { state.panel = trigger.dataset.dsPanel; renderEditorPanelTabs(); renderSidePanel(); }
  else if (action === 'select-layer') selectObjectById(trigger.dataset.dsLayerId);
  else if (action === 'layer-visible') toggleLayerVisible(trigger.dataset.dsLayerId);
  else if (action === 'layer-lock') toggleLayerLock(trigger.dataset.dsLayerId);
  else if (action === 'toggle-lock') toggleLayerLock(activeObject()?.id);
  else if (action === 'arrange') arrangeSelection(trigger.dataset.dsArrange);
  else if (action === 'text-align') applySelectedTextStyle('textAlign', trigger.dataset.dsValue);
}

function renderEditorPanelTabs() {
  state.root.querySelectorAll('[data-ds-panel]').forEach((button) => button.classList.toggle('is-active', button.dataset.dsPanel === state.panel));
}

function toggleLayerVisible(id) {
  const object = objectById(id);
  if (!object) return;
  object.set('visible', object.visible === false);
  state.canvas.requestRenderAll();
  markChanged();
  renderLayers();
}

function toggleLayerLock(id) {
  const object = objectById(id);
  if (!object) return;
  setLocked(object, !object.locked);
  state.canvas.requestRenderAll();
  markChanged();
  renderSidePanel();
}

function handleInput(event) {
  const target = event.target;
  if (target.matches('[data-ds-document-name]')) {
    state.currentDraft.name = target.value.slice(0, 120);
    state.dirty = true;
    setSaveState('저장 안 됨');
    scheduleAutosave();
  } else if (target.matches('[data-ds-library-query]')) {
    state.libraryQuery = target.value;
    renderLibrary();
    state.root.querySelector('[data-ds-library-query]')?.focus();
  } else if (target.dataset.dsProp) {
    applyObjectProperty(target);
  } else if (target.dataset.dsSize) {
    applyObjectSize(target);
  } else if (target.dataset.dsTextStyle) {
    applySelectedTextStyle(target.dataset.dsTextStyle, target.value);
    const text = state.root.querySelector(`[data-ds-text-style-text="${target.dataset.dsTextStyle}"]`);
    if (text) text.value = target.value.toUpperCase();
  } else if (target.dataset.dsTextStyleText) {
    const value = normalizeColor(target.value, '');
    if (value) applySelectedTextStyle(target.dataset.dsTextStyleText, value);
  } else if (target.dataset.dsColorText) {
    const value = normalizeColor(target.value, '');
    if (value) {
      const object = activeObject();
      object?.set(target.dataset.dsColorText, value);
      state.canvas?.requestRenderAll();
      markChanged();
    }
  }
}

async function handleChange(event) {
  const target = event.target;
  if (target.matches('[data-ds-brand-select]')) await changeBrand(target.value);
  else if (target.matches('[data-ds-image-file]') && target.files?.[0]) { await addUploadedImage(target.files[0]); target.value = ''; }
  else if (target.matches('[data-ds-ai-reference-file]') && target.files?.[0]) { await setAiReference(target.files[0]); target.value = ''; }
  else if (target.matches('[data-ds-brand-logo-file]') && target.files?.[0]) {
    setBusy(true);
    try {
      const uploaded = await uploadAsset(target.files[0]);
      const input = state.dialog.querySelector('[data-ds-brand-field="logoUrl"]');
      if (input) input.value = uploaded.imageUrl;
    } catch (error) { showToast(error.message, true); }
    finally { setBusy(false); target.value = ''; }
  } else if (target.matches('[data-ds-library-kind]')) { state.libraryKind = target.value; renderLibrary(); }
  else if (target.matches('[data-ds-library-brand]')) { state.libraryBrandId = target.value; renderLibrary(); }
}

async function handlePaste(event) {
  if (state.root?.hidden || !state.canvas) return;
  const pastedImage = Array.from(event.clipboardData?.items || []).find((item) => item.type.startsWith('image/'))?.getAsFile();
  if (state.dialog?.hidden === false && state.dialog.querySelector('[data-ds-ai-prompt]') && pastedImage) {
    event.preventDefault();
    await setAiReference(pastedImage);
    showToast('캡처 이미지를 레퍼런스로 추가했습니다.');
    return;
  }
  if (isTextObject(activeObject()) && activeObject().isEditing) return;
  const file = pastedImage;
  if (!file) return;
  event.preventDefault();
  await addUploadedImage(file);
}

async function handleKeyboard(event) {
  if (state.root?.hidden || !state.canvas || state.dialog?.hidden === false) return;
  if ((event.ctrlKey || event.metaKey) && event.key === '0') {
    event.preventDefault();
    fitCanvas();
    return;
  }
  const editable = event.target.closest?.('input,textarea,select,[contenteditable="true"]');
  if (editable && !(event.ctrlKey || event.metaKey)) return;
  const command = studioShortcut(event);
  if (!command) {
    const object = activeObject();
    if (event.key.startsWith('Arrow') && object && !(isTextObject(object) && object.isEditing)) {
      const distance = event.shiftKey ? 10 : 1;
      if (event.key === 'ArrowLeft') object.left -= distance;
      if (event.key === 'ArrowRight') object.left += distance;
      if (event.key === 'ArrowUp') object.top -= distance;
      if (event.key === 'ArrowDown') object.top += distance;
      object.setCoords();
      state.canvas.requestRenderAll();
      markChanged();
      event.preventDefault();
    }
    return;
  }
  event.preventDefault();
  if (command === 'undo') await restoreCanvasState(state.history.undo());
  else if (command === 'redo') await restoreCanvasState(state.history.redo());
  else if (command === 'duplicate') await duplicateSelection();
  else if (command === 'delete' && !editable) deleteSelection();
  else if (command === 'save') await saveDocument(false);
}

async function openStudio(options = {}) {
  ensureRoot();
  state.applyTarget = options.applyTarget || (options.kind ? {
    imageInputId: 'bni', designInputId: 'bn-design-document-id', previewId: 'bn-generated-preview',
  } : null);
  state.root.hidden = false;
  document.body.classList.add('ds-open');
  setBusy(true);
  try {
    await loadLibraryData();
    if (options.designDocumentId) await openDocument(options.designDocumentId, options);
    else if (options.kind) await openDocument(null, options);
    else renderLibrary();
  } catch (error) {
    showToast(error.message, true);
    renderLibrary();
  } finally {
    setBusy(false);
  }
}

function closeStudio() {
  if (state.dirty && !confirm('저장하지 않은 변경 내용이 있습니다. 디자인 스튜디오를 닫으시겠습니까?')) return;
  disposeCanvas();
  state.root.hidden = true;
  state.dialog.hidden = true;
  state.currentDocument = null;
  state.currentDraft = null;
  state.dirty = false;
  document.body.classList.remove('ds-open');
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-admin-action="design-studio-open"]');
  if (!trigger) return;
  event.preventDefault();
  event.stopPropagation();
  const kind = trigger.dataset.studioKind || '';
  const designDocumentId = trigger.dataset.studioDesignId || document.getElementById('bn-design-document-id')?.value || '';
  const title = document.getElementById('bnt')?.value || '';
  openStudio({ kind, designDocumentId, title }).catch((error) => showToast(error.message || '디자인 스튜디오를 열지 못했습니다.', true));
}, true);

window.EatsAdminDesignStudio = { open: openStudio, close: closeStudio };
