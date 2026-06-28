(function () {
  const root = window.EatsAdminModules || {};

  root.version = '2026-06-26.admin-modularization.8';
  root.pages = root.pages || {};
  root.actions = root.actions || {};

  root.registerPage = function registerPage(name, module) {
    if (!name || !module) return;
    root.pages[name] = module;
  };

  root.registerAction = function registerAction(name, handler) {
    if (!name || typeof handler !== 'function') return;
    root.actions[name] = handler;
  };

  root.runAction = function runAction(name, event, payload) {
    const handler = root.actions[name];
    if (typeof handler !== 'function') return false;
    try {
      const result = handler(event, payload || {});
      if (result && typeof result.catch === 'function') {
        result.catch(function (error) {
          console.error('[EatsAdminModules]', name, error);
          if (typeof window.adminAlert === 'function') {
            window.adminAlert(error?.message || '작업 처리 중 오류가 발생했습니다.');
          }
        });
      }
    } catch (error) {
      console.error('[EatsAdminModules]', name, error);
      if (typeof window.adminAlert === 'function') {
        window.adminAlert(error?.message || '작업 처리 중 오류가 발생했습니다.');
      }
    }
    return true;
  };

  root.isInteractiveTarget = function isInteractiveTarget(event) {
    return !!event?.target?.closest?.('button,a,input,select,textarea,label,[data-admin-no-row-click]');
  };

  root.delegateClickActions = function delegateClickActions(options) {
    if (root.clickActionDelegated) return;
    root.clickActionDelegated = true;

    const capture = options?.capture === true;
    document.addEventListener('click', function handleAdminModuleClick(event) {
      const actionTarget = event.target.closest?.('[data-admin-action]');
      if (!actionTarget) return;

      const action = actionTarget.dataset.adminAction;
      if (!action) return;

      const handled = root.runAction(action, event, {
        el: actionTarget,
        dataset: actionTarget.dataset
      });

      if (handled) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
      }
    }, capture);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      root.delegateClickActions();
    }, { once: true });
  } else {
    root.delegateClickActions();
  }

  root.registerAction('admin-pw-toggle', function (_event, payload) {
    const targetId = payload.dataset.adminPwTarget;
    const input = targetId ? document.getElementById(targetId) : null;
    const toggle = payload.el;
    if (!input || !toggle) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    toggle.textContent = showing ? '보기' : '숨김';
  });
  root.registerAction('fr-save', function (_event, payload) {
    window.savF?.(payload.dataset.frSaveId || undefined);
  });

  root.registerAction('fr-add', function () {
    window.addF?.();
  });

  root.registerAction('fr-edit', function (_event, payload) {
    window.edF?.(payload.dataset.frId);
  });

  root.registerAction('fr-back', function () {
    window.goFrList?.();
  });

  root.registerAction('fr-address-search', function () {
    window.openFranchiseAddressSearch?.();
  });

  root.registerAction('fr-detail', function (_event, payload) {
    const id = payload.dataset.frId || payload.dataset.frDetailId || payload.dataset.frRowId;
    if (id) window.goFrDetail?.(id);
  });

  root.registerAction('fr-delete', function (_event, payload) {
    window.delF?.(payload.dataset.frId);
  });

  root.registerAction('fr-card-alias-save', function (_event, payload) {
    window.updateFranchiseCardAlias?.(payload.dataset.frId, payload.dataset.frCardId, payload.el);
  });

  root.registerAction('fr-visibility', async function (_event, payload) {
    const dataset = payload.dataset;
    const type = dataset.frVisType;
    const fid = dataset.frId;
    const targetId = dataset.frTargetId;
    const hidden = dataset.frHidden === 'true';

    if (type === 'card') await window.hideFranchiseCard?.(fid, targetId, hidden);
    if (type === 'account') await window.hideManagedAccount?.(fid, Number(targetId), hidden);
    window.refreshFranchiseDetailIfCurrent?.(fid);
  });

  root.registerAction('fr-managed-account-save', function (_event, payload) {
    const fid = payload.dataset.frId;
    const idx = Number(payload.dataset.frAccountIdx);
    if (fid && !Number.isNaN(idx)) window.saveManagedAccount?.(fid, idx);
  });

  root.registerAction('fr-account-detail', function (_event, payload) {
    const fid = payload.dataset.frId;
    const idx = Number(payload.dataset.frAccountIdx);
    if (fid && !Number.isNaN(idx)) window.showAccountDetail?.(fid, idx);
  });

  root.registerAction('fr-account-action', async function (_event, payload) {
    const dataset = payload.dataset;
    const fid = dataset.frId;
    const idx = Number(dataset.frAccountIdx);
    const action = dataset.frAction;
    if (!fid || Number.isNaN(idx)) return;

    if (action === 'approve') await window.approveAccount?.(fid, idx);
    if (action === 'reject') await window.rejectAccount?.(fid, idx);
    window.refreshFranchiseDetailIfCurrent?.(fid);
  });

  root.registerAction('ag-add', function () {
    window.addAg?.();
  });

  root.registerAction('ag-save', function (_event, payload) {
    const id = payload.dataset.agSaveId;
    window.savAg?.(id === 'new' ? undefined : id, payload.el);
  });

  root.registerAction('ag-view-mode', function (_event, payload) {
    const mode = payload.dataset.agMode === 'full' ? 'full' : 'org';
    window.setAgencyTreeViewMode?.(mode);
  });

  root.registerAction('ag-list', function () {
    window.goAgList?.();
  });

  root.registerAction('ag-edit', function (_event, payload) {
    window.edAg?.(payload.dataset.agTargetId);
  });

  root.registerAction('ag-delete', function (_event, payload) {
    window.delAg?.(payload.dataset.agTargetId);
  });

  root.registerAction('ag-reset-password', function (_event, payload) {
    window.resetAgencyPassword?.(payload.dataset.agTargetId);
  });

  root.registerAction('ag-settlement', function (_event, payload) {
    window.goAgencySettlement?.(payload.dataset.agTargetId || '');
  });

  root.registerAction('ag-detail', function (_event, payload) {
    window.goAgDetail?.(payload.dataset.agTargetId);
  });

  root.registerAction('ag-join-qr', function (_event, payload) {
    window.openAgencyJoinQr?.(payload.dataset.agTargetId);
  });

  root.registerAction('ag-contract', function (_event, payload) {
    window.openAgencyContract?.(
      payload.dataset.agTargetId,
      payload.dataset.agContractKey || '',
      payload.dataset.agContractName || '계약서'
    );
  });

  root.registerAction('da-sort', function (_event, payload) {
    window.setDASort?.(payload.dataset.daSortKey);
  });

  root.registerAction('da-add', function () {
    window.addDA?.();
  });

  root.registerAction('da-detail', function (_event, payload) {
    window.openDADetail?.(payload.dataset.daId);
  });

  root.registerAction('da-status', function (_event, payload) {
    const id = payload.dataset.daId;
    if (payload.dataset.daStatusNext === 'active') window.activateDA?.(id);
    else window.deactivateDA?.(id);
  });

  root.registerAction('da-business-file', function (_event, payload) {
    window.openDeliveryAgencyBusinessFile?.(
      payload.dataset.daId,
      payload.dataset.daBusinessKey || '',
      payload.dataset.daBusinessName || '사업자등록증.pdf'
    );
  });

  root.registerAction('da-business-upload', function (_event, payload) {
    const id = payload.dataset.daId;
    window.closeM?.();
    window.uploadDeliveryAgencyBusinessFile?.(id);
  });

  root.registerAction('da-delete', function (_event, payload) {
    window.deleteDA?.(payload.dataset.daId);
  });

  root.registerAction('da-detail-save', function (_event, payload) {
    window.saveDADetail?.(payload.dataset.daId);
  });

  root.registerAction('da-save', function () {
    window.saveDA?.();
  });

  root.registerAction('faq-cat-move', function (_event, payload) {
    window.moveFaqCat?.(Number(payload.dataset.faqCatMove || 0));
  });

  root.registerAction('faq-cat-rename', function () {
    window.renameFaqCat?.();
  });

  root.registerAction('faq-cat-delete', function () {
    window.delFaqCat?.();
  });

  root.registerAction('faq-tab', function (_event, payload) {
    window.switchFaqTab?.(payload.dataset.faqTab);
  });

  root.registerAction('faq-cat-add', function () {
    window.addFaqCat?.();
  });

  root.registerAction('faq-add', function () {
    window.addFQ?.();
  });

  root.registerAction('faq-move', function (_event, payload) {
    window.moveFQ?.(
      payload.dataset.faqId,
      Number(payload.dataset.faqDirection || 0)
    );
  });

  root.registerAction('faq-edit', function (_event, payload) {
    window.edFQ?.(payload.dataset.faqId);
  });

  root.registerAction('faq-delete', function (_event, payload) {
    window.delFQ?.(payload.dataset.faqId);
  });

  root.registerAction('faq-save', function (_event, payload) {
    const id = payload.dataset.faqId;
    window.savFQ?.(id === 'new' ? undefined : id);
  });

  root.registerAction('pg-add', function () {
    window.addPG?.();
  });

  root.registerAction('pg-edit', function (_event, payload) {
    window.edPG?.(payload.dataset.pgId);
  });

  root.registerAction('pg-save', function (_event, payload) {
    const id = payload.dataset.pgId;
    window.savPG?.(id === 'new' ? undefined : id);
  });

  root.registerAction('pg-toggle', function (_event, payload) {
    window.togglePG?.(payload.dataset.pgId, payload.dataset.pgStatus);
  });

  root.registerAction('legal-add', function (_event, payload) {
    window.addLegalDoc?.(payload.dataset.legalType);
  });

  root.registerAction('legal-view', function (_event, payload) {
    window.viewLegalDoc?.(payload.dataset.legalId);
  });

  root.registerAction('legal-toggle', function (_event, payload) {
    window.toggleLegalDoc?.(
      payload.dataset.legalId,
      payload.dataset.legalApplied === 'true'
    );
  });

  root.registerAction('legal-delete', function (_event, payload) {
    window.delLegalDoc?.(payload.dataset.legalId);
  });

  root.registerAction('legal-save', function (_event, payload) {
    window.savLegalDoc?.(payload.dataset.legalType);
  });

  root.registerAction('adm-add', function () {
    window.addAdm?.();
  });

  root.registerAction('adm-edit', function (_event, payload) {
    window.edAdm?.(payload.dataset.admId);
  });

  root.registerAction('adm-delete', function (_event, payload) {
    window.delAdm?.(payload.dataset.admId);
  });

  root.registerAction('adm-save', function (_event, payload) {
    const id = payload.dataset.admId;
    window.savAdm?.(id === 'new' ? undefined : id);
  });

  root.registerAction('roles-edit', function () {
    window.edRoles?.();
  });

  root.registerAction('roles-save', function () {
    window.savRoles?.();
  });

  root.registerAction('banner-add', function () {
    window.addBn?.();
  });

  root.registerAction('banner-edit', function (_event, payload) {
    window.edBn?.(payload.dataset.bannerId);
  });

  root.registerAction('banner-delete', function (_event, payload) {
    window.delBn?.(payload.dataset.bannerId);
  });

  root.registerAction('banner-status', function (_event, payload) {
    window.toggleBnStatus?.(payload.dataset.bannerId, payload.dataset.bannerNextStatus);
  });

  root.registerAction('banner-tab', function (_event, payload) {
    window.bannerTab = payload.dataset.bannerTabKey || payload.dataset.bannerTab || '전체';
    window.renderPage?.();
  });

  root.registerAction('banner-save', function (_event, payload) {
    const id = payload.dataset.bannerId;
    window.savBn?.(id === 'new' ? 'new' : id);
  });

  root.registerAction('banner-generate-image', function () {
    window.genBnImage?.();
  });

  root.registerAction('banner-generate-detail-image', function () {
    window.genBnDetailImage?.();
  });

  root.registerAction('inst-month', function (_event, payload) {
    window.moveInstallmentMonth?.(Number(payload.dataset.instMonth || 0));
  });

  root.registerAction('inst-save', function () {
    window.savInst?.();
  });

  root.registerAction('push-status-all', function () {
    window.loadPushStatus?.();
  });

  root.registerAction('push-status-target', function () {
    window.loadPushStatusForTarget?.();
  });

  root.registerAction('push-test', function () {
    window.sendPushTest?.();
  });

  root.registerAction('inquiry-add', function () {
    window.addInquiry?.();
  });

  root.registerAction('inquiry-complete', function (_event, payload) {
    window.cmpI?.(payload.dataset.inquiryId);
  });

  root.registerAction('inquiry-edit', function (_event, payload) {
    window.edInquiry?.(payload.dataset.inquiryId);
  });

  root.registerAction('inquiry-delete', function (_event, payload) {
    window.delI?.(payload.dataset.inquiryId);
  });

  root.registerAction('inquiry-save', function (_event, payload) {
    const id = payload.dataset.inquiryId;
    window.savInquiry?.(id === 'new' ? undefined : id);
  });

  root.registerAction('board-add', function (_event, payload) {
    window.addPost?.(payload.dataset.boardType);
  });

  root.registerAction('board-view', function (_event, payload) {
    window.viewPost?.(payload.dataset.boardType, payload.dataset.boardId);
  });

  root.registerAction('board-edit', function (_event, payload) {
    const type = payload.dataset.boardType;
    const id = payload.dataset.boardId;
    if (payload.dataset.modalReopen === '1') {
      window.closeM?.();
      setTimeout(function () {
        window.edPost?.(type, id);
      }, 30);
      return;
    }
    window.edPost?.(type, id);
  });

  root.registerAction('board-delete', function (_event, payload) {
    window.delPost?.(payload.dataset.boardType, payload.dataset.boardId);
  });

  root.registerAction('board-save', function (_event, payload) {
    window.savPost?.(payload.dataset.boardType, payload.dataset.boardId);
  });
  window.EatsAdminModules = root;
})();





