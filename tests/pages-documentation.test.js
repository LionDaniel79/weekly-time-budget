import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readmeUrl = new URL('../README.md', import.meta.url);

async function readme() {
  return readFile(readmeUrl, 'utf8');
}

test('README는 운영 주소와 GitHub Pages 자동 배포 구조를 설명한다', async () => {
  const source = await readme();
  assert.match(source, /https:\/\/liondaniel79\.github\.io\/weekly-time-budget\//);
  assert.match(source, /GitHub Pages/);
  assert.match(source, /main.*자동.*배포/s);
});

test('README는 필요한 Firebase 저장소 변수와 승인 도메인을 모두 안내한다', async () => {
  const source = await readme();
  for (const name of [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
    'FIREBASE_MEASUREMENT_ID',
  ]) {
    assert.match(source, new RegExp(name));
  }
  assert.match(source, /liondaniel79\.github\.io/);
});

test('README는 일반 배포 흐름과 실패 확인 및 롤백을 설명한다', async () => {
  const source = await readme();
  assert.match(source, /agent\/build-mvp/);
  assert.match(source, /git revert/);
  assert.match(source, /Actions/);
  assert.match(source, /Spark/);
  assert.match(source, /결제 계정.*연결하지/s);
});
