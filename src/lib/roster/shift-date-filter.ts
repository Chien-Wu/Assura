const shiftDateTimePattern =
  /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

/** Match inclusive shift dates, preserving the calendar date recorded by staff. */
export function matchesShiftDate(
  value: string | null | undefined,
  fromDate: string,
  toDate: string,
): boolean {
  if (!fromDate && !toDate) return true;
  if (fromDate && !isCalendarDate(fromDate)) return false;
  if (toDate && !isCalendarDate(toDate)) return false;
  if (fromDate && toDate && fromDate > toDate) return false;

  const date = value?.match(shiftDateTimePattern)?.[1];
  if (!date || !isCalendarDate(date)) return false;

  return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
}
