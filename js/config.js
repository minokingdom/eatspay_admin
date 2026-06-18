function resolveApiBaseUrl() {
  const protocol = window.location && window.location.protocol;
  const hostname = window.location && window.location.hostname;
  const isNative = Boolean(
    (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
    protocol === 'capacitor:' ||
    protocol === 'ionic:' ||
    hostname === 'localhost'
  );
  if (isNative) return 'https://www.eatspay.co.kr';

  if (window.location && window.location.hostname === '127.0.0.1') {
    return window.location.origin;
  }

  return window.location.origin || 'https://www.eatspay.co.kr';
}

function resolveAdminBaseUrl() {
  const protocol = window.location && window.location.protocol;
  const hostname = window.location && window.location.hostname;
  const isNative = Boolean(
    (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
    protocol === 'capacitor:' ||
    protocol === 'ionic:' ||
    hostname === 'localhost'
  );
  if (isNative) return 'https://www.eatspay.co.kr';

  if (window.location && window.location.hostname === '127.0.0.1') {
    return window.location.origin;
  }

  return window.location.origin || 'https://www.eatspay.co.kr';
}

window.EATSPAY_CONFIG = {
  API_BASE_URL: resolveApiBaseUrl(),
  ADMIN_BASE_URL: resolveAdminBaseUrl()
};
