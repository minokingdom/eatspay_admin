'use strict';

function clean(value) {
  return String(value || '').trim();
}

function onlyDigits(value) {
  return clean(value).replace(/[^0-9]/g, '');
}

function formatRouteupYymm(month, year) {
  const yy = onlyDigits(year).padStart(2, '0').slice(-2);
  const mm = onlyDigits(month).padStart(2, '0').slice(-2);
  return `${yy}${mm}`;
}

function normalizeInstallment(value) {
  const n = Math.max(0, Math.min(Number(value) || 0, 99));
  return String(Math.floor(n)).padStart(2, '0');
}

function buildRouteupBillKeyPayload({
  contract = {},
  orderNo,
  buyerName,
  buyerPhone,
  cardNumber,
  expiryMonth,
  expiryYear,
  identity,
  cardPw
} = {}) {
  return {
    mid: clean(contract.mid),
    tid: clean(contract.tid),
    ord_num: clean(orderNo),
    buyer_name: clean(buyerName),
    buyer_phone: onlyDigits(buyerPhone),
    card_num: onlyDigits(cardNumber),
    yymm: formatRouteupYymm(expiryMonth, expiryYear),
    auth_num: onlyDigits(identity),
    card_pw: onlyDigits(cardPw).slice(0, 2)
  };
}

function buildRouteupBillPayPayload({
  contract = {},
  orderNo,
  buyerName,
  buyerPhone,
  itemName,
  billKey,
  amount,
  installment
} = {}) {
  return {
    mid: clean(contract.mid),
    tid: clean(contract.tid),
    ord_num: clean(orderNo),
    buyer_name: clean(buyerName),
    buyer_phone: onlyDigits(buyerPhone),
    item_name: clean(itemName),
    bill_key: clean(billKey),
    installment: normalizeInstallment(installment),
    amount: Number(amount)
  };
}

function isRouteupSuccess(payload = {}) {
  return clean(payload.result_cd || payload.resultCd || payload.result?.result_cd || payload.result?.resultCd) === '0000';
}

function routeupMessage(payload = {}) {
  return clean(
    payload.result_msg ||
    payload.resultMsg ||
    payload.message ||
    payload.result?.result_msg ||
    payload.result?.resultMsg
  );
}

function extractRouteupBillKey(payload = {}) {
  return clean(payload.bill_key || payload.billKey || payload.bill?.bill_key || payload.bill?.billKey);
}

module.exports = {
  buildRouteupBillKeyPayload,
  buildRouteupBillPayPayload,
  extractRouteupBillKey,
  formatRouteupYymm,
  isRouteupSuccess,
  routeupMessage
};
