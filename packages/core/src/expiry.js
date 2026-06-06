const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDate(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day));
}

export function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

export function secondThursday(year, monthIndex) {
  const first = utcDate(year, monthIndex, 1);
  const firstDay = first.getUTCDay();
  const thursday = 4;
  const offset = (thursday - firstDay + 7) % 7;
  return utcDate(year, monthIndex, 1 + offset + 7);
}

export function nextTradingDay(date, holidays = new Set()) {
  let cursor = new Date(date.getTime() + DAY_MS);
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6 || holidays.has(toDateKey(cursor))) {
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return cursor;
}

export function weeklyOptionExpiryForWeek(date, weekday) {
  const target = weekday === 'monday' ? 1 : 4;
  const start = utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const offset = (target - start.getUTCDay() + 7) % 7;
  return new Date(start.getTime() + offset * DAY_MS);
}

function nextMonth(year, monthIndex) {
  return monthIndex === 11 ? { year: year + 1, monthIndex: 0 } : { year, monthIndex: monthIndex + 1 };
}

export function buildExpirySettlementRisk({ asOf = new Date(), holidays = null } = {}) {
  const asOfDate = utcDate(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const holidaySet = holidays ?? new Set();
  let expiryYear = asOfDate.getUTCFullYear();
  let expiryMonth = asOfDate.getUTCMonth();
  let monthlyFinalTradingDay = secondThursday(expiryYear, expiryMonth);
  let monthlySettlementDay = nextTradingDay(monthlyFinalTradingDay, holidaySet);
  if (asOfDate.getTime() > monthlySettlementDay.getTime()) {
    const next = nextMonth(expiryYear, expiryMonth);
    expiryYear = next.year;
    expiryMonth = next.monthIndex;
    monthlyFinalTradingDay = secondThursday(expiryYear, expiryMonth);
    monthlySettlementDay = nextTradingDay(monthlyFinalTradingDay, holidaySet);
  }
  const mondayWeeklyExpiry = weeklyOptionExpiryForWeek(asOfDate, 'monday');
  const thursdayWeeklyExpiry = weeklyOptionExpiryForWeek(asOfDate, 'thursday');
  const daysToMonthly = Math.ceil((monthlyFinalTradingDay.getTime() - asOfDate.getTime()) / DAY_MS);
  const daysToMondayWeekly = Math.ceil((mondayWeeklyExpiry.getTime() - asOfDate.getTime()) / DAY_MS);
  const riskLevel = daysToMonthly >= 0 && daysToMonthly <= 2 ? 'high' : daysToMondayWeekly >= 0 && daysToMondayWeekly <= 1 ? 'elevated' : 'normal';

  return {
    asOf: toDateKey(asOfDate),
    futuresMonthlyFinalTradingDay: toDateKey(monthlyFinalTradingDay),
    futuresMonthlyFinalSettlementDay: toDateKey(monthlySettlementDay),
    weeklyOptionExpiries: {
      monday: toDateKey(mondayWeeklyExpiry),
      thursday: toDateKey(thursdayWeeklyExpiry),
    },
    holidayAdjustment: holidays ? 'applied' : 'unknown',
    settlementBasis: holidays ? 'holiday-adjusted calendar' : 'rule-based estimate; holiday calendar unavailable',
    daysToMonthlyFinalTrading: daysToMonthly,
    daysToMondayWeeklyExpiry: daysToMondayWeekly,
    riskLevel,
    explanation: 'KOSPI200 futures/monthly options use the second-Thursday final trading rule; settlement is represented as the next trading day when a holiday set is available.',
  };
}
