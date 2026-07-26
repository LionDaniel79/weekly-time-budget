const guardedButtons = new WeakSet();

export function createSingleFlightButtonHandler({
  button,
  action,
  pendingText = '로그인 중…',
}) {
  if (!button) throw new Error('로그인 버튼이 필요합니다.');
  if (typeof action !== 'function') throw new Error('로그인 동작이 필요합니다.');

  const idleText = button.textContent;
  const idleDisabled = Boolean(button.disabled);
  let pending = null;

  return function singleFlightButtonHandler(...args) {
    if (pending) return pending;

    button.disabled = true;
    button.textContent = pendingText;

    let result;
    try {
      result = action.apply(this, args);
    } catch (error) {
      result = Promise.reject(error);
    }

    pending = Promise.resolve(result).finally(() => {
      pending = null;
      button.disabled = idleDisabled;
      button.textContent = idleText;
    });

    return pending;
  };
}

export function installGoogleLoginGuard(button) {
  if (!button || guardedButtons.has(button) || typeof button.onclick !== 'function') {
    return guardedButtons.has(button);
  }

  const originalHandler = button.onclick;
  button.onclick = createSingleFlightButtonHandler({
    button,
    action: originalHandler,
  });
  guardedButtons.add(button);
  return true;
}
