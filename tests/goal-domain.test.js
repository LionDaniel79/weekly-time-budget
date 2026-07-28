import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGoalType,
  categoryDisplayName,
  calculateGoalAchievement,
  calculateGoalContribution,
  calculateGoalComplianceScore,
  calculateGoalProgress,
  resolveEntryGoalType,
} from '../src/goal-domain.js';

test('기존 목표 방식은 성장으로 정규화한다', () => {
  assert.equal(normalizeGoalType(undefined), 'growth');
  assert.equal(normalizeGoalType(null), 'growth');
  assert.equal(normalizeGoalType('invalid'), 'growth');
  assert.equal(normalizeGoalType('growth'), 'growth');
  assert.equal(normalizeGoalType('restraint'), 'restraint');
});

test('절제 목표만 이름에 접미사를 한 번 붙인다', () => {
  assert.equal(categoryDisplayName({ name: '기도' }), '기도');
  assert.equal(categoryDisplayName({ name: '독서', goalType: 'growth' }), '독서');
  assert.equal(categoryDisplayName({ name: '스마트폰', goalType: 'restraint' }), '스마트폰 (절제)');
  assert.equal(categoryDisplayName({ name: '스마트폰 (절제)', goalType: 'restraint' }), '스마트폰 (절제)');
});

test('성장 목표는 실제시간을 예산시간으로 나눈다', () => {
  assert.deepEqual(
    [0, 60, 180, 240].map((actualMinutes) => calculateGoalAchievement({
      goalType: 'growth',
      budgetMinutes: 180,
      actualMinutes,
    }).percentage),
    [0, 33, 100, 133],
  );
});

test('절제 3시간 예산은 엄격한 달성률을 계산한다', () => {
  const actuals = [0, 60, 120, 180, 240, 300, 360];
  assert.deepEqual(
    actuals.map((actualMinutes) => calculateGoalAchievement({
      goalType: 'restraint',
      budgetMinutes: 180,
      actualMinutes,
    }).percentage),
    [200, 167, 133, 100, -33, -67, -100],
  );
});

test('절제는 아주 조금만 넘겨도 즉시 음수다', () => {
  assert.equal(
    calculateGoalAchievement({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 180.01 }).percentage,
    -1,
  );
});

test('예산 0은 성장과 절제 모두 계산에서 제외한다', () => {
  for (const goalType of ['growth', 'restraint']) {
    assert.deepEqual(
      calculateGoalAchievement({ goalType, budgetMinutes: 0, actualMinutes: 120 }),
      {
        goalType,
        percentage: null,
        differenceMinutes: 120,
        status: 'excluded',
        hasBudget: false,
      },
    );
  }
});

test('전체 반영 점수는 100 초과를 제한하고 음수를 0으로 만든다', () => {
  assert.equal(calculateGoalContribution({ hasBudget: true, percentage: 167 }), 100);
  assert.equal(calculateGoalContribution({ hasBudget: true, percentage: 50 }), 50);
  assert.equal(calculateGoalContribution({ hasBudget: true, percentage: -33 }), 0);
  assert.equal(calculateGoalContribution({ hasBudget: false, percentage: null }), null);
});

test('예산시간으로 목표 준수를 가중 계산한다', () => {
  assert.deepEqual(
    calculateGoalComplianceScore([
      { budgetMinutes: 180, hasBudget: true, percentage: 100 },
      { budgetMinutes: 60, hasBudget: true, percentage: 100 },
      { budgetMinutes: 180, hasBudget: true, percentage: -33 },
    ]),
    {
      score: 57,
      weightedTotal: 24000,
      totalWeightMinutes: 420,
      status: 'scored',
    },
  );
});

test('예산 0은 목표 준수의 가중치와 분모에서 제외한다', () => {
  assert.deepEqual(
    calculateGoalComplianceScore([
      { budgetMinutes: 180, hasBudget: true, percentage: 50 },
      { budgetMinutes: 0, hasBudget: false, percentage: null },
    ]),
    {
      score: 50,
      weightedTotal: 9000,
      totalWeightMinutes: 180,
      status: 'scored',
    },
  );
  assert.deepEqual(calculateGoalComplianceScore([]), {
    score: null,
    weightedTotal: 0,
    totalWeightMinutes: 0,
    status: 'excluded',
  });
});

test('절제 막대는 파란 잔여 뒤 빈 상태와 빨간 초과로 전환한다', () => {
  assert.deepEqual(
    calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 0 }),
    { mode: 'remaining', fillPercentage: 100 },
  );
  assert.deepEqual(
    calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 60 }),
    { mode: 'remaining', fillPercentage: 67 },
  );
  assert.deepEqual(
    calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 180 }),
    { mode: 'exact', fillPercentage: 0 },
  );
  assert.deepEqual(
    calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 240 }),
    { mode: 'overage', fillPercentage: 33 },
  );
  assert.deepEqual(
    calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 420 }),
    { mode: 'overage', fillPercentage: 100 },
  );
});

test('성장 막대는 사용량이 왼쪽부터 증가하고 100에서 제한한다', () => {
  assert.deepEqual(
    calculateGoalProgress({ goalType: 'growth', budgetMinutes: 180, actualMinutes: 60 }),
    { mode: 'growth', fillPercentage: 33 },
  );
  assert.deepEqual(
    calculateGoalProgress({ goalType: 'growth', budgetMinutes: 180, actualMinutes: 240 }),
    { mode: 'growth', fillPercentage: 100 },
  );
});

test('기록 당시 목표 방식이 현재 대분류보다 우선한다', () => {
  assert.equal(resolveEntryGoalType({ goalType: 'restraint' }, { goalType: 'growth' }), 'restraint');
  assert.equal(resolveEntryGoalType({}, { goalType: 'restraint' }), 'restraint');
  assert.equal(resolveEntryGoalType({}, null), 'growth');
});
