import { DashboardSettings } from './settings.service';

/** How long a tap brings the dashboard back for at night. */
export const WAKE_MS = 60 * 1000;

/**
 * Whether it's night by the settings. The hours may run past midnight (22:00 to 07:00) or not
 * (01:00 to 06:00); the start counts as night and the end doesn't, and equal times mean never.
 */
export function isNight(
  settings: Pick<DashboardSettings, 'nightMode' | 'nightStart' | 'nightEnd'>,
  now: Date,
): boolean {
  const start = minutesOf(settings.nightStart);
  const end = minutesOf(settings.nightEnd);
  if (!settings.nightMode || start === null || end === null) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** "HH:mm" as minutes after midnight, or null if it isn't a time. */
function minutesOf(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
