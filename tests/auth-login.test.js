import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoogleLoginHandler,
  isDismissibleAuthError,
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
  };
}

test('로그인 요청이 진행 중이면 연속 호출도 팝업을 한 번만 연다', async () => {
  const request = deferred();
  let popupCalls = 0;
  const button = createButton();
  const firebase = {
    GoogleAuthProvider: class GoogleAuthProvider {},
    signInWithPopup() {
      popupCalls += 1;
      return request.promise;
    },
  };
  const login = createGoogleLoginHandler({
    button,
    getFirebase: () => firebase,
    getAuth: () => ({ id: 'auth' }),
    notify: () => {},
    logError: () => {},
  });

  const first = login();
  const second = login();

  assert.equal(popupCalls, 1);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, '로그인 중…');

  request.resolve({ user: { uid: 'user-1' } });
  await Promise.all([first, second]);

  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Google로 시작하기');
});

test('팝업 취소 계열 오류는 사용자에게 실패 경고를 띄우지 않는다', async () => {
  const notices = [];
  const errors = [];
  const firebase = {
    GoogleAuthProvider: class GoogleAuthProvider {},
    signInWithPopup: async () => {
      const error = new Error('cancelled');
      error.code = 'auth/cancelled-popup-request';
      throw error;
    },
  };
  const login = createGoogleLoginHandler({
    button: createButton(),
    getFirebase: () => firebase,
    getAuth: () => ({ id: 'auth' }),
    notify: (message) => notices.push(message),
    logError: (error) => errors.push(error),
  });

  await login();

  assert.equal(notices.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(isDismissibleAuthError({ code: 'auth/cancelled-popup-request' }), true);
  assert.equal(isDismissibleAuthError({ code: 'auth/popup-closed-by-user' }), true);
  assert.equal(isDismissibleAuthError({ code: 'auth/network-request-failed' }), false);
});

test('실제 로그인 오류는 이해하기 쉬운 메시지로 한 번 안내한다', async () => {
  const notices = [];
  const firebase = {
    GoogleAuthProvider: class GoogleAuthProvider {},
    signInWithPopup: async () => {
      const error = new Error('network failed');
      error.code = 'auth/network-request-failed';
      throw error;
    },
  };
  const login = createGoogleLoginHandler({
    button: createButton(),
    getFirebase: () => firebase,
    getAuth: () => ({ id: 'auth' }),
    notify: (message) => notices.push(message),
    logError: () => {},
  });

  await login();

  assert.deepEqual(notices, ['Google 로그인 중 네트워크 오류가 발생했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.']);
});

test('Firebase 초기화 전에는 팝업을 열지 않고 준비 중임을 안내한다', async () => {
  const notices = [];
  const login = createGoogleLoginHandler({
    button: createButton(),
    getFirebase: () => null,
    getAuth: () => null,
    notify: (message) => notices.push(message),
    logError: () => {},
  });

  await login();

  assert.deepEqual(notices, ['로그인 기능을 준비하는 중입니다. 잠시 후 다시 눌러주세요.']);
});
