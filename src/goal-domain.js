export const GOAL_TYPES = Object.freeze({
  GROWTH: 'growth',
  RESTRAINT: 'restraint',
});

const nonNegative = (value) => Math.max(0, Number(value) || 0);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function normalizeGoalType(value) {
  return value === GOAL_TYPES.RESTRAINT ? GOAL_TYPES.RESTRAINT : GOAL_TYPES.GROWTH;
}

export function isIncludedInTimeTotals(goalType) {
  return normalizeGoalType(goalType) !== GOAL_TYPES.RESTRAINT;
}

export function categoryDisplayName(category = {}) {
  const name = String(category.name || '').trim();
  if (normalizeGoalType(category.goalType) !== GOAL_TYPES.RESTRAINT) return name;
  return /\s*\(절제\)$/.test(name) ? name : `${name} (절제)`;
}

export function calculateGoalAchievement({ goalType, budgetMinutes, actualMinutes }) {
  const type = normalizeGoalType(goalType);
  const budget = nonNegative(budgetMinutes);
  const actual = nonNegative(actualMinutes);

  if (!budget) {
    return {
      goalType: type,
      percentage: null,
      differenceMinutes: actual,
      status: 'excluded',
      hasBudget: false,
    };
  }

  const differenceMinutes = actual - budget;

  if (type === GOAL_TYPES.RESTRAINT) {
    if (actual > budget) {
      return {
        goalType: type,
        percentage: -Math.max(1, Math.round((actual - budget) / budget * 100)),
        differenceMinutes,
        status: 'overage',
        hasBudget: true,
      };
    }

    return {
      goalType: type,
      percentage: Math.round(200 - actual / budget * 100),
      differenceMinutes,
      status: actual === budget ? 'exact' : 'remaining',
      hasBudget: true,
    };
  }

  return {
    goalType: type,
    percentage: Math.round(actual / budget * 100),
    differenceMinutes,
    status: differenceMinutes > 0 ? 'exceeded' : differenceMinutes === 0 ? 'exact' : 'remaining',
    hasBudget: true,
  };
}

export function calculateGoalContribution(achievement) {
  if (!achievement?.hasBudget || achievement.percentage === null) return null;
  return clamp(Number(achievement.percentage) || 0, 0, 100);
}

export function calculateGoalComplianceScore(items = []) {
  let weightedTotal = 0;
  let totalWeightMinutes = 0;

  for (const item of items) {
    const weight = nonNegative(item?.budgetMinutes);
    const contribution = calculateGoalContribution(item);
    if (!weight || contribution === null) continue;
    weightedTotal += contribution * weight;
    totalWeightMinutes += weight;
  }

  if (!totalWeightMinutes) {
    return {
      score: null,
      weightedTotal: 0,
      totalWeightMinutes: 0,
      status: 'excluded',
    };
  }

  return {
    score: clamp(Math.round(weightedTotal / totalWeightMinutes), 0, 100),
    weightedTotal,
    totalWeightMinutes,
    status: 'scored',
  };
}

export function calculateGoalProgress({ goalType, budgetMinutes, actualMinutes }) {
  const type = normalizeGoalType(goalType);
  const budget = nonNegative(budgetMinutes);
  const actual = nonNegative(actualMinutes);

  if (!budget) return { mode: 'excluded', fillPercentage: 0 };

  if (type === GOAL_TYPES.GROWTH) {
    return {
      mode: 'growth',
      fillPercentage: Math.round(clamp(actual / budget * 100, 0, 100)),
    };
  }

  if (actual < budget) {
    return {
      mode: 'remaining',
      fillPercentage: Math.round((budget - actual) / budget * 100),
    };
  }

  if (actual === budget) return { mode: 'exact', fillPercentage: 0 };

  return {
    mode: 'overage',
    fillPercentage: Math.round(clamp((actual - budget) / budget * 100, 0, 100)),
  };
}

export function resolveEntryGoalType(entry, category) {
  return normalizeGoalType(entry?.goalType ?? category?.goalType);
}
