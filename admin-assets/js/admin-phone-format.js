(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EatsAdminPhone = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function phoneDigits(value) {
    return String(value ?? '').replace(/\D/g, '').slice(0, 11);
  }

  function formatAdminPhone(value) {
    const raw = String(value ?? '').trim();
    if (!raw || raw === '-') return raw;
    if (/[xX*]/.test(raw)) return raw;

    const digits = phoneDigits(raw);
    if (!digits) return raw;

    if (digits.startsWith('02')) {
      if (digits.length <= 2) return digits;
      if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
      if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
      return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
    }

    if (digits.startsWith('01')) {
      if (digits.length <= 3) return digits;
      if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
      if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
      return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    }

    if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('input', (event) => {
      const input = event.target?.closest?.('[data-admin-phone-input]');
      if (input) input.value = formatAdminPhone(input.value);
    });
  }

  return { formatAdminPhone, phoneDigits };
}));
