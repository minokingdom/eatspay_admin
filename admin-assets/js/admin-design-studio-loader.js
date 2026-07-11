(function loadAdminDesignStudio() {
  const moduleUrl = '/admin-assets/js/admin-design-studio.mjs?v=20260711-ai1';
  document.documentElement.dataset.designStudioLoader = 'loading';
  window.EatsAdminDesignStudioReady = import(moduleUrl)
    .then((module) => {
      document.documentElement.dataset.designStudioLoader = 'ready';
      return module;
    })
    .catch((error) => {
      document.documentElement.dataset.designStudioLoader = 'error';
      document.documentElement.dataset.designStudioError = String(error?.message || error || 'unknown').slice(0, 240);
      console.error('디자인 스튜디오 모듈을 불러오지 못했습니다.', error);
      throw error;
    });
})();
