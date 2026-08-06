function category(id, name, extra = {}) {
  return { id, name, order: 1, defaultBudgetMinutes: 420, ...extra };
}

export function emptyStatisticsFixture() {
  return {
    data: { entries: [], activeCategories: [], archivedCategories: [], weeklyBudgets: [] },
    restored: { mode: 'monthly', year: 2026, month: 8 },
  };
}

export function legacyCategoryFixture() {
  return {
    data: {
      entries: [{ id: 'legacy-june', date: '2025-06-10', categoryId: 'legacy', durationMinutes: 60 }],
      activeCategories: [category('legacy', '기존 대분류')], archivedCategories: [], weeklyBudgets: [],
    },
    restored: { mode: 'monthly', year: 2025, month: 6 },
  };
}

export function effectiveDateFixture() {
  return {
    data: {
      entries: [
        { id: 'legacy-july', date: '2026-07-10', categoryId: 'legacy', durationMinutes: 60 },
        { id: 'invalid-new-july', date: '2026-07-15', categoryId: 'new', durationMinutes: 90 },
        { id: 'new-august', date: '2026-08-01', categoryId: 'new', durationMinutes: 30 },
      ],
      activeCategories: [
        category('legacy', '기존 대분류'),
        category('new', '새 대분류', { createdDate: '2026-08-01' }),
      ],
      archivedCategories: [], weeklyBudgets: [],
    },
    restored: { mode: 'monthly', year: 2026, month: 7 },
  };
}

export function restraintFixture() {
  return {
    data: {
      entries: [
        { id: 'reading', date: '2026-08-01', categoryId: 'reading', durationMinutes: 60, goalType: 'growth' },
        { id: 'phone', date: '2026-08-01', categoryId: 'phone', durationMinutes: 240, goalType: 'restraint' },
        { id: 'archived', date: '2026-08-01', categoryId: 'archived', durationMinutes: 45 },
      ],
      activeCategories: [
        category('reading', '독서', { defaultBudgetMinutes: 60 }),
        category('phone', '스마트폰', { defaultBudgetMinutes: 180, goalType: 'restraint' }),
      ],
      archivedCategories: [category('archived', '보관 운동', { archivedAt: '2026-08-01' })],
      weeklyBudgets: [{
        id: '2026-07-27', weekStart: '2026-07-27',
        budgets: { reading: 420, phone: 1260, archived: 0 },
      }],
    },
    restored: { mode: 'monthly', year: 2026, month: 8 },
  };
}

export function invalidMonthFixture() {
  return {
    data: {
      entries: [
        { id: 'june', date: '2026-06-10', categoryId: 'reading', durationMinutes: 30 },
        { id: 'august', date: '2026-08-01', categoryId: 'reading', durationMinutes: 30 },
      ],
      activeCategories: [category('reading', '독서')], archivedCategories: [], weeklyBudgets: [],
    },
    restored: { mode: 'monthly', year: 2026, month: 7 },
  };
}

export function largeStatisticsFixture({ years = 5, entriesPerDay = 20 } = {}) {
  const entries = [];
  let id = 0;
  for (let year = 2022; year < 2022 + years; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const days = new Date(year, month, 0).getDate();
      for (let day = 1; day <= days; day += 1) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        for (let entry = 0; entry < entriesPerDay; entry += 1) {
          entries.push({ id: `large-${id++}`, date, categoryId: `category-${entry % 5}`, durationMinutes: 5 + (entry % 4) });
        }
      }
    }
  }
  return {
    data: {
      entries,
      activeCategories: Array.from({ length: 5 }, (_, index) => category(`category-${index}`, `대분류 ${index + 1}`, { order: index + 1 })),
      archivedCategories: [], weeklyBudgets: [],
    },
    restored: { mode: 'monthly', year: 2026, month: 8 },
  };
}

export function fixtureByName(name) {
  const fixtures = { empty: emptyStatisticsFixture, legacy: legacyCategoryFixture, effective: effectiveDateFixture, restraint: restraintFixture, invalid: invalidMonthFixture, large: largeStatisticsFixture };
  return (fixtures[name] || restraintFixture)();
}
