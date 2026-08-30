const EXPLICIT_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/i;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function validCalendarDate(date: string) {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === date
  );
}

export function parseExplicitTimestamp(value: string) {
  const match = EXPLICIT_TIMESTAMP.exec(value);
  if (!match) return null;

  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[9] ? Number(match[9]) : 0;
  const offsetMinute = match[10] ? Number(match[10]) : 0;
  if (
    !validCalendarDate(date) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function parseDateOnlyUtc(value: string) {
  if (!DATE_ONLY.test(value) || !validCalendarDate(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}
