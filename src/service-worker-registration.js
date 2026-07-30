if ('serviceWorker' in navigator) {
  let refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', {
        type: 'module',
        scope: './',
      });
      await registration.update();
    } catch (error) {
      console.error('서비스 워커 등록 실패', error);
    }
  });
}
