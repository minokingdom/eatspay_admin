(function(root, factory){
  if(typeof module === 'object' && module.exports){
    module.exports = factory();
  }else{
    root.EatsAdminAgencySettlementCalculator = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  function toId(value){
    return String(value ?? '').trim();
  }

  function toNumber(value){
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  }

  function roundMoney(value){
    return Math.round(toNumber(value));
  }

  function findFranchise(payment, franchises){
    const raw = toId(payment?.franchise);
    const franchiseId = toId(payment?.franchiseId);
    return (franchises || []).find(franchise => (
      toId(franchise.id) === franchiseId ||
      toId(franchise.id) === raw ||
      String(franchise.name || '').trim() === raw
    )) || null;
  }

  function defaultPaymentAgencyId(payment, franchises){
    const explicit = toId(payment?.agencyId);
    if(explicit) return explicit;
    const franchise = findFranchise(payment, franchises);
    return franchise?.agencyId !== undefined && franchise?.agencyId !== null ? toId(franchise.agencyId) : '';
  }

  function defaultPaymentFranchiseName(payment, franchises){
    const franchise = findFranchise(payment, franchises);
    const raw = String(payment?.franchise || '').trim();
    return franchise?.name || raw || '-';
  }

  function agencyPathToRoot(agencyId, agencyById){
    const path = [];
    let current = agencyById.get(toId(agencyId));
    const seen = new Set();
    let guard = 0;
    while(current && guard < 20){
      const id = toId(current.id);
      if(!id || seen.has(id)) break;
      seen.add(id);
      path.unshift(current);
      current = agencyById.get(toId(current.parentId));
      guard += 1;
    }
    return path;
  }

  function calculateAgencySettlementRows(options){
    const agencies = Array.isArray(options?.agencies) ? options.agencies : [];
    const franchises = Array.isArray(options?.franchises) ? options.franchises : [];
    const payments = Array.isArray(options?.payments) ? options.payments : [];
    const defaultFeeRate = toNumber(options?.defaultFeeRate ?? 4.4);
    const hqTransactionFee = roundMoney(options?.hqTransactionFee ?? 300);
    const getEffRate = typeof options?.getEffRate === 'function' ? options.getEffRate : agency => agency?.feeRate || 0;
    const sortKey = typeof options?.sortKey === 'function' ? options.sortKey : agency => toId(agency?.id).padStart(5, '0');
    const resolvePaymentAgencyId = typeof options?.paymentAgencyId === 'function'
      ? payment => toId(options.paymentAgencyId(payment))
      : payment => defaultPaymentAgencyId(payment, franchises);
    const resolvePaymentFranchiseName = typeof options?.paymentFranchiseName === 'function'
      ? options.paymentFranchiseName
      : payment => defaultPaymentFranchiseName(payment, franchises);
    const rowAgencyIds = Array.isArray(options?.rowAgencyIds) ? new Set(options.rowAgencyIds.map(toId)) : null;
    const agencyById = new Map(agencies.map(agency => [toId(agency.id), agency]));
    const rowsById = new Map(agencies.map(agency => [toId(agency.id), {
      agency,
      payments: [],
      count: 0,
      amount: 0,
      serviceFee: 0,
      merchantNet: 0,
      agencyFee: 0,
      transactionFee: 0,
      settlementTotal: 0,
      agencyNet: 0,
      rate: toNumber(getEffRate(agency))
    }]));

    for(const payment of payments){
      const directAgencyId = resolvePaymentAgencyId(payment);
      const path = agencyPathToRoot(directAgencyId, agencyById);
      if(!path.length) continue;

      const amount = roundMoney(payment?.amount);
      const serviceFee = roundMoney(amount * (defaultFeeRate / 100));
      const merchantNet = amount - serviceFee;
      const topAgencyId = toId(path[0].id);
      const franchiseName = resolvePaymentFranchiseName(payment);

      for(let index = 0; index < path.length; index += 1){
        const agency = path[index];
        const agencyId = toId(agency.id);
        const child = path[index + 1] || null;
        const agencyRate = toNumber(getEffRate(agency));
        const childRate = child ? toNumber(getEffRate(child)) : 0;
        const shareRate = Math.max(0, child ? agencyRate - childRate : agencyRate);
        const agencyFee = roundMoney(amount * (shareRate / 100));
        const transactionFee = agencyId === topAgencyId ? hqTransactionFee : 0;
        const settlementTotal = agencyFee + transactionFee;
        const row = rowsById.get(agencyId);
        if(!row) continue;

        const allocatedPayment = {
          ...payment,
          franchiseName,
          directAgencyId,
          settlementAgencyId: agencyId,
          settlementAgencyName: agency.name || '',
          shareRate,
          amount,
          serviceFee,
          merchantNet,
          agencyFee,
          transactionFee,
          settlementTotal,
          agencyNet: 0
        };

        row.payments.push(allocatedPayment);
        row.count += 1;
        row.amount += amount;
        row.serviceFee += serviceFee;
        row.merchantNet += merchantNet;
        row.agencyFee += agencyFee;
        row.transactionFee += transactionFee;
        row.settlementTotal += settlementTotal;
      }
    }

    rowsById.forEach(row => {
      row.agencyNet = roundMoney(row.agencyFee * 0.967) + row.transactionFee;
      const paymentNetTotal = row.payments.reduce((sum, payment) => sum + Number(payment.agencyFee || 0), 0);
      row.payments.forEach(payment => {
        const paymentAgencyFee = Number(payment.agencyFee || 0);
        const proportionalNet = paymentNetTotal > 0
          ? roundMoney((row.agencyNet - row.transactionFee) * (paymentAgencyFee / paymentNetTotal))
          : 0;
        payment.agencyNet = proportionalNet + Number(payment.transactionFee || 0);
      });
      const paymentAgencyNet = row.payments.reduce((sum, payment) => sum + Number(payment.agencyNet || 0), 0);
      const adjustment = row.agencyNet - paymentAgencyNet;
      if(adjustment && row.payments.length){
        row.payments[row.payments.length - 1].agencyNet = Number(row.payments[row.payments.length - 1].agencyNet || 0) + adjustment;
      }
    });

    return agencies
      .filter(agency => !rowAgencyIds || rowAgencyIds.has(toId(agency.id)))
      .map(agency => rowsById.get(toId(agency.id)))
      .filter(Boolean)
      .sort((a, b) => String(sortKey(a.agency)).localeCompare(String(sortKey(b.agency))));
  }

  return {
    calculateAgencySettlementRows
  };
}));
