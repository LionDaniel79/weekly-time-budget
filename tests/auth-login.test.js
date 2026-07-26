import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSingleFlightButtonHandler,
  installGoogleLoginGuard,
} from '../src/auth-login.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createButton() {
  return {
    disabled: false,
    textContent: 'Google로 시작하기',
    onclick: null,
  };
}

test('로그인 요청이 진행 중이면 연속 호출도 원래 동작을 한 번만 실행한다', async () => {
  const request = deferred();
  let calls = 0;
  const button = createButton();
  const login = createSingleFlightButtonHandler({
    button,
    action() {
      calls += 1;
      return request.promise;
    },
  });

  const first = login();
  const second = login();

  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, '로그인 중…');

  request.resolve('signed-in');
  assert.equal(await first, 'signed-in');
  await second;

  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Google로 시작하기');
});

test('로그인이 실패해도 버튼은 다시 사용할 수 있게 복구한다', async () => {
  const button = createButton();
  const expectedError = new Error('popup failed');
  const login = createSingleFlightButtonHandler({
    button,
    action: async () => {
      throw expectedError;
    },
  });

  await assert.rejects(login(), expectedError);

  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Google로 시작하기');
});

test('Google 로그인 버튼의 기존 onclick을 중복 방지 핸들러로 교체한다', async () => {
  const request = deferred();
  const button = createButton();
  let calls = 0;
  button.onclick = async () => {
    calls += 1;
    return request.promise;
  };

  assert.equal(installGoogleLoginGuard(button), true);

  const first = button.onclick({ type: 'click' });
  const second = button.onclick({ type: 'click' });
  assert.equal(calls, 1);

  request.resolve();
  await Promise.all([first, second]);
});

test('기존 로그인 핸들러가 없는 버튼은 변경하지 않는다', () => {
  const button = createButton();
  assert.equal(installGoogleLoginGuard(button), false);
  assert.equal(button.onclick, null);
});
