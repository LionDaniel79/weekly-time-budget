if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js', {
      type: 'module',
      scope: './',
    }).catch((error) => {
      console.error('서비스 워커 등록 실패', error);
    });
  });
}
