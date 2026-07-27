let hideTimer = null;

function ensureStyles() {
  if (typeof document === 'undefined' || document.querySelector('#offline-ui-styles')) return;
  const style = document.createElement('style');
  style.id = 'offline-ui-styles';
  style.textContent = `
    .app-toast-region{position:fixed;z-index:10000;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));width:min(520px,calc(100% - 28px));transform:translateX(-50%);pointer-events:none}
    .app-toast{display:grid;gap:3px;padding:14px 16px;border:1px solid #bfd0c8;border-radius:15px;background:#fffdf7;color:#173b33;box-shadow:0 16px 40px rgba(23,59,51,.22);opacity:0;transform:translateY(12px);transition:.18s ease;pointer-events:none}
    .app-toast.visible{opacity:1;transform:translateY(0)}
    .app-toast strong{font-size:.96rem}.app-toast span{font-size:.84rem;color:#68736e;line-height:1.45}
    .app-toast.success{border-color:#a7cabd}.app-toast.queued{border-color:#d7bf82;background:#fff9e9}.app-toast.error{border-color:#d9a39c;background:#fff4f2}
    .sync-status{display:inline-flex;align-items:center;width:max-content;margin-top:6px;padding:4px 8px;border-radius:999px;font-size:.75rem;font-weight:800}
    .sync-status.pending{background:#fff0be;color:#765b12}.sync-status.failed{background:#f8dfdc;color:#8b2e25}
    .sync-retry{min-height:36px;margin-top:7px;border:1px solid #c8d1cc;border-radius:10px;padding:6px 10px;background:#fff;color:#173b33;font-weight:800;cursor:pointer}
  `;
  document.head.append(style);
}

function ensureRegion() {
  if (typeof document === 'undefined') return null;
  ensureStyles();
  let region = document.querySelector('#app-toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'app-toast-region';
    region.className = 'app-toast-region';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.append(region);
  }
  return region;
}

export function showToast({
  type = 'info',
  title,
  message = '',
  duration = type === 'error' ? 7000 : 4000,
} = {}) {
  const region = ensureRegion();
  if (!region || !title) return;
  clearTimeout(hideTimer);
  region.innerHTML = '';
  const toast = document.createElement('div');
  toast.className = `app-toast ${type}`;
  toast.innerHTML = `<strong>${title}</strong>${message ? `<span>${message}</span>` : ''}`;
  region.append(toast);
  globalThis.requestAnimationFrame?.(() => toast.classList.add('visible'));
  if (!globalThis.requestAnimationFrame) toast.classList.add('visible');
  hideTimer = setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => { if (toast.isConnected) toast.remove(); }, 180);
  }, duration);
}

export function showEntrySaveResult(result = {}) {
  if (result.status === 'synced') {
    showToast({ type: 'success', title: '✓ 기록을 서버에 저장했습니다.' });
    return;
  }
  if (result.status === 'queued') {
    showToast({
      type: 'queued',
      title: '✓ 기기에 안전하게 저장했습니다.',
      message: `인터넷 연결 시 자동으로 반영됩니다. · 동기화 대기 ${result.pendingCount || 1}건`,
    });
    return;
  }
  showToast({
    type: 'error',
    title: '기기에는 저장했지만 서버 동기화가 필요합니다.',
    message: '로그인과 네트워크 상태를 확인한 뒤 기록 내역에서 다시 시도하세요.',
  });
}

export function showSyncResult(result = {}) {
  if (Number(result.syncedCount) > 0) {
    showToast({
      type: 'success',
      title: `✓ 대기 중이던 기록 ${result.syncedCount}건을 서버에 반영했습니다.`,
    });
  }
}

export function showOfflineNotice() {
  showToast({
    type: 'queued',
    title: '오프라인 상태입니다.',
    message: '새 기록은 기기에 저장되고 인터넷 연결 시 자동으로 반영됩니다.',
  });
}

export function showLocalSaveError() {
  showToast({
    type: 'error',
    title: '기기에 기록을 저장하지 못했습니다.',
    message: '입력 내용을 유지했습니다. 저장 공간과 브라우저 상태를 확인하세요.',
  });
}
