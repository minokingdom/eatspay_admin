export const DESIGN_PRESETS = Object.freeze({
  banner: Object.freeze({ width: 1440, height: 256, label: '가로 배너' }),
  popup: Object.freeze({ width: 720, height: 1280, label: '세로 팝업' }),
});

export const AI_IMAGE_PRESETS = Object.freeze({
  banner: Object.freeze({ width: 1536, height: 1024, label: '배너 이미지', composition: 'wide landscape banner with generous copy-safe negative space' }),
  popup: Object.freeze({ width: 1024, height: 1536, label: '팝업 이미지', composition: 'vertical promotional popup with clear visual hierarchy' }),
  square: Object.freeze({ width: 1024, height: 1024, label: '일반 이미지 · 정사각형', composition: 'balanced square marketing image' }),
  landscape: Object.freeze({ width: 1536, height: 1024, label: '일반 이미지 · 가로형', composition: 'wide landscape marketing image' }),
  portrait: Object.freeze({ width: 1024, height: 1536, label: '일반 이미지 · 세로형', composition: 'vertical portrait marketing image' }),
});

export function resolveAiImagePreset(value = 'banner') {
  return AI_IMAGE_PRESETS[value] || AI_IMAGE_PRESETS.banner;
}

const DEFAULT_BRAND_KIT = Object.freeze({
  name: '이츠페이',
  slug: 'eatspay',
  logoUrl: '',
  primaryColor: '#03C75A',
  secondaryColor: '#3D9B35',
  accentColor: '#4FA72E',
  surfaceColor: '#FFFFFF',
  textColor: '#12351B',
  fontFamily: 'Pretendard',
  headingFontFamily: 'Pretendard',
  defaultCtaLabel: '1분 상담 신청하기',
  defaultCtaUrl: '',
  contactText: '고객센터 1566-3558',
  active: true,
});

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeHex(value, fallback) {
  const color = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : fallback;
}

export function normalizeBrandKit(value = {}) {
  return {
    id: value.id || null,
    name: String(value.name || DEFAULT_BRAND_KIT.name).trim() || DEFAULT_BRAND_KIT.name,
    slug: String(value.slug || '').trim().toLowerCase(),
    logoUrl: String(value.logoUrl || '').trim(),
    primaryColor: normalizeHex(value.primaryColor, DEFAULT_BRAND_KIT.primaryColor),
    secondaryColor: normalizeHex(value.secondaryColor, DEFAULT_BRAND_KIT.secondaryColor),
    accentColor: normalizeHex(value.accentColor, DEFAULT_BRAND_KIT.accentColor),
    surfaceColor: normalizeHex(value.surfaceColor, DEFAULT_BRAND_KIT.surfaceColor),
    textColor: normalizeHex(value.textColor, DEFAULT_BRAND_KIT.textColor),
    fontFamily: String(value.fontFamily || DEFAULT_BRAND_KIT.fontFamily).trim() || DEFAULT_BRAND_KIT.fontFamily,
    headingFontFamily: String(value.headingFontFamily || value.fontFamily || DEFAULT_BRAND_KIT.headingFontFamily).trim() || DEFAULT_BRAND_KIT.headingFontFamily,
    defaultCtaLabel: String(value.defaultCtaLabel || '').trim(),
    defaultCtaUrl: String(value.defaultCtaUrl || '').trim(),
    contactText: String(value.contactText || '').trim(),
    active: value.active !== false,
  };
}

export function createDesignEnvelope({ kind = 'banner', brandKitId = null, width, height, canvas = {}, metadata = {} } = {}) {
  const normalizedKind = kind === 'popup' ? 'popup' : 'banner';
  const preset = DESIGN_PRESETS[normalizedKind];
  return {
    schemaVersion: 1,
    kind: normalizedKind,
    brandKitId: Number(brandKitId) || null,
    width: Math.round(Number(width) || preset.width),
    height: Math.round(Number(height) || preset.height),
    canvas: clone(canvas && typeof canvas === 'object' ? canvas : { objects: [] }),
    metadata: clone(metadata && typeof metadata === 'object' ? metadata : {}),
  };
}

export function createHistory(limit = 60) {
  const max = Math.max(2, Math.min(Number(limit) || 60, 200));
  let states = [];
  let index = -1;

  return {
    push(value) {
      const state = typeof value === 'string' ? value : JSON.stringify(value);
      if (states[index] === state) return state;
      states = states.slice(0, index + 1);
      states.push(state);
      if (states.length > max) states.shift();
      index = states.length - 1;
      return state;
    },
    undo() {
      if (index > 0) index -= 1;
      return states[index] ?? null;
    },
    redo() {
      if (index < states.length - 1) index += 1;
      return states[index] ?? null;
    },
    current() {
      return states[index] ?? null;
    },
    canUndo() {
      return index > 0;
    },
    canRedo() {
      return index >= 0 && index < states.length - 1;
    },
    reset(value) {
      states = [];
      index = -1;
      if (value !== undefined) this.push(value);
    },
    size() {
      return states.length;
    },
  };
}

export function applyTextStyle(target, style) {
  if (!target || !style || typeof style !== 'object') return false;
  const start = Number(target.selectionStart || 0);
  const end = Number(target.selectionEnd || 0);
  if (target.isEditing && end > start && typeof target.setSelectionStyles === 'function') {
    target.setSelectionStyles(style, start, end);
  } else if (typeof target.set === 'function') {
    Object.keys(style).forEach((property) => target.removeStyle?.(property));
    target.set(style);
  } else {
    Object.assign(target, style);
  }
  return true;
}

function objectBounds(object) {
  const bounds = object?.getBoundingRect?.() || {};
  return {
    object,
    left: Number(bounds.left ?? object?.left ?? 0),
    top: Number(bounds.top ?? object?.top ?? 0),
    width: Math.max(0, Number(bounds.width ?? object?.width ?? 0)),
    height: Math.max(0, Number(bounds.height ?? object?.height ?? 0)),
  };
}

function moveObjectBy(item, deltaX = 0, deltaY = 0) {
  const values = {
    left: Number(item.object.left || 0) + deltaX,
    top: Number(item.object.top || 0) + deltaY,
  };
  if (typeof item.object.set === 'function') item.object.set(values);
  else Object.assign(item.object, values);
  item.object.setCoords?.();
}

export function arrangeObjects(objects = [], mode = '') {
  const items = objects.filter(Boolean).map(objectBounds);
  if (items.length < 2) return false;

  const left = Math.min(...items.map((item) => item.left));
  const top = Math.min(...items.map((item) => item.top));
  const right = Math.max(...items.map((item) => item.left + item.width));
  const bottom = Math.max(...items.map((item) => item.top + item.height));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;

  if (mode === 'distribute-h' || mode === 'distribute-v') {
    if (items.length < 3) return false;
    const horizontal = mode === 'distribute-h';
    const ordered = items.slice().sort((a, b) => horizontal ? a.left - b.left : a.top - b.top);
    const start = horizontal ? left : top;
    const end = horizontal ? right : bottom;
    const totalSize = ordered.reduce((sum, item) => sum + (horizontal ? item.width : item.height), 0);
    const gap = (end - start - totalSize) / (ordered.length - 1);
    let cursor = start;
    for (const item of ordered) {
      moveObjectBy(item, horizontal ? cursor - item.left : 0, horizontal ? 0 : cursor - item.top);
      cursor += (horizontal ? item.width : item.height) + gap;
    }
    return true;
  }

  const targets = {
    left: (item) => [left, item.top],
    center: (item) => [centerX - item.width / 2, item.top],
    right: (item) => [right - item.width, item.top],
    top: (item) => [item.left, top],
    middle: (item) => [item.left, centerY - item.height / 2],
    bottom: (item) => [item.left, bottom - item.height],
  };
  const target = targets[mode];
  if (!target) return false;

  for (const item of items) {
    const [targetLeft, targetTop] = target(item);
    moveObjectBy(item, targetLeft - item.left, targetTop - item.top);
  }
  return true;
}

export function ensureTopLeftOrigin(target) {
  if (!target) return target;
  const origin = { originX: 'left', originY: 'top' };
  if (typeof target.set === 'function') target.set(origin);
  else Object.assign(target, origin);
  if (Array.isArray(target._objects)) target._objects.forEach(ensureTopLeftOrigin);
  target.setCoords?.();
  return target;
}

export function applyBrandRoles(objects = [], value = {}) {
  const brand = normalizeBrandKit(value);
  const roleStyles = {
    primary: { fill: brand.primaryColor },
    secondary: { fill: brand.secondaryColor },
    accent: { fill: brand.accentColor },
    surface: { fill: brand.surfaceColor },
    heading: { fill: brand.textColor, fontFamily: brand.headingFontFamily },
    body: { fill: brand.textColor, fontFamily: brand.fontFamily },
    cta: { fill: brand.primaryColor },
    ctaText: { fill: '#FFFFFF', fontFamily: brand.headingFontFamily },
  };
  for (const object of objects) {
    const style = roleStyles[object?.brandRole];
    if (!style) continue;
    if (typeof object.set === 'function') object.set(style);
    else Object.assign(object, style);
  }
  return objects;
}

export function studioShortcut(event) {
  const key = String(event?.key || '').toLowerCase();
  const modifier = Boolean(event?.ctrlKey || event?.metaKey);
  if (modifier && key === 'z' && event?.shiftKey) return 'redo';
  if (modifier && key === 'z') return 'undo';
  if (modifier && key === 'y') return 'redo';
  if (modifier && key === 'd') return 'duplicate';
  if (modifier && key === 's') return 'save';
  if (key === 'delete' || key === 'backspace') return 'delete';
  return '';
}
