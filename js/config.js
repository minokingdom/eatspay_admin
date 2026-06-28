function resolveApiBaseUrl() {
  const isNative = Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  if (isNative) return 'https://eatspay.kr';

  if (window.location && ['http:', 'capacitor:'].includes(window.location.protocol) && window.location.hostname === 'localhost') {
    return 'https://eatspay.kr';
  }

  if (window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return window.location.origin;
  }

  return window.location.origin || 'https://eatspay.kr';
}

function resolveAdminBaseUrl() {
  const isNative = Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  if (isNative) return 'https://eatspay.kr';

  if (window.location && ['http:', 'capacitor:'].includes(window.location.protocol) && window.location.hostname === 'localhost') {
    return 'https://eatspay.kr';
  }

  if (window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return window.location.origin;
  }

  return window.location.origin || 'https://eatspay.kr';
}

window.EATSPAY_CONFIG = {
  API_BASE_URL: resolveApiBaseUrl(),
  ADMIN_BASE_URL: resolveAdminBaseUrl(),
  KAKAO_MAP_JS_KEY: '24f01aecf12ba92b3fda2820bf19303b'
};
