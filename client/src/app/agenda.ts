import { CalendarEvent } from './calendar.service';

export const MAX_EVENTS_PER_DAY = 4;

export interface AgendaItem {
  title: string;
  /** "All day", "09:30", or "to 11:00" for something that started on an earlier day. */
  time: string;
  calendar: string;
  color: string;
  /** Black or white, whichever reads better on `color`. */
  textColor: string;
}

export interface AgendaDay {
  label: string;
  items: AgendaItem[];
  /** How many more events there are than fit on screen. */
  more: number;
}

/** Local midnight, `days` days after the day of `date`. */
export function startOfDay(date: Date, days = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Today's and tomorrow's events, in local time. Today leaves out events that have already ended. */
export function agenda(events: CalendarEvent[], now: Date): AgendaDay[] {
  const parsed = events.map((e) => ({ ...e, startAt: parse(e.start), endAt: parse(e.end) }));
  return ['Today', 'Tomorrow'].map((label, offset) => {
    const dayStart = startOfDay(now, offset);
    const dayEnd = startOfDay(now, offset + 1);
    const notBefore = offset === 0 ? now : dayStart;
    const items = parsed
      .filter((e) => e.startAt < dayEnd && e.endAt > notBefore)
      .sort(
        (a, b) =>
          Number(b.allDay) - Number(a.allDay) ||
          a.startAt.getTime() - b.startAt.getTime() ||
          a.title.localeCompare(b.title),
      )
      .map((e) => ({
        title: e.title,
        time: timeLabel(e.allDay, e.startAt, e.endAt, dayStart, dayEnd),
        calendar: e.calendar,
        color: e.color,
        textColor: textColorOn(e.color),
      }));
    return {
      label,
      items: items.slice(0, MAX_EVENTS_PER_DAY),
      more: Math.max(0, items.length - MAX_EVENTS_PER_DAY),
    };
  });
}

/** Black on light colours, white on dark ones, using the WCAG relative luminance. */
export function textColorOn(color: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000' : '#fff';
}

function timeLabel(allDay: boolean, start: Date, end: Date, dayStart: Date, dayEnd: Date): string {
  if (allDay || (start < dayStart && end > dayEnd)) return 'All day';
  return start < dayStart ? `to ${hhmm(end)}` : hhmm(start);
}

function hhmm(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Only "…Z" times are UTC. Dates and zone-less times ("2026-10-24", "2026-10-24T18:00:00") are local,
 * which `new Date()` doesn't do reliably: it reads dates as UTC, and Safari 12 reads both as UTC.
 */
function parse(value: string): Date {
  if (value.endsWith('Z')) return new Date(value);
  const [year, month, day, hours = 0, minutes = 0] = value.split(/[-T:]/).map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}
