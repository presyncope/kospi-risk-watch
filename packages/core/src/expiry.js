const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_HOLIDAY_DATES = 512;

export function utcDate(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day));
}

export function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

export function isValidDateKey(value) {
  if (typeof value !== 'string') return false;
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && toDateKey(parsed) === value;
}

export function normalizeHolidaySet(holidays) {
  if (holidays == null) return null;
  const items = holidays instanceof Set ? Array.from(holidays) : Array.isArray(holidays) ? holidays : null;
  if (!items || items.length === 0 || items.length > MAX_HOLIDAY_DATES) return null;
  if (!items.every(isValidDateKey)) return null;
  return new Set(items);
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

export function previousTradingDayOnOrBefore(date, holidays = new Set()) {
  let cursor = new Date(date.getTime());
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6 || holidays.has(toDateKey(cursor))) {
    cursor = new Date(cursor.getTime() - DAY_MS);
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
  const normalizedHolidaySet = normalizeHolidaySet(holidays);
  const holidaySet = normalizedHolidaySet ?? new Set();
  const finalTradingDayFor = (year, monthIndex) => {
    const ruleBasedDay = secondThursday(year, monthIndex);
    return normalizedHolidaySet ? previousTradingDayOnOrBefore(ruleBasedDay, holidaySet) : ruleBasedDay;
  };
  let expiryYear = asOfDate.getUTCFullYear();
  let expiryMonth = asOfDate.getUTCMonth();
  let monthlyFinalTradingDay = finalTradingDayFor(expiryYear, expiryMonth);
  let monthlySettlementDay = nextTradingDay(monthlyFinalTradingDay, holidaySet);
  if (asOfDate.getTime() > monthlySettlementDay.getTime()) {
    const next = nextMonth(expiryYear, expiryMonth);
    expiryYear = next.year;
    expiryMonth = next.monthIndex;
    monthlyFinalTradingDay = finalTradingDayFor(expiryYear, expiryMonth);
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
    holidayAdjustment: normalizedHolidaySet ? 'applied' : 'unknown',
    settlementBasis: normalizedHolidaySet ? 'holiday-adjusted calendar' : 'rule-based estimate; holiday calendar unavailable',
    daysToMonthlyFinalTrading: daysToMonthly,
    daysToMondayWeeklyExpiry: daysToMondayWeekly,
    riskLevel,
    explanation: 'KOSPI200 futures/monthly options use the second-Thursday final trading rule; settlement is represented as the next trading day when a holiday set is available.',
  };
}
