import { AGENDA_DAYS, agenda, startOfDay, textColorOn } from './agenda';
import { CalendarEvent } from './calendar.service';
import { english } from '../testing/test-helpers';

/** An ISO time for a local time on a day in October 2026, so tests pass in any time zone. */
function at(day: number, hours: number, minutes = 0): string {
  return new Date(2026, 9, day, hours, minutes).toISOString();
}

function timed(title: string, start: string, end: string): CalendarEvent {
  return { title, calendar: 'Home', color: '#3b82f6', allDay: false, start, end };
}

function allDay(title: string, start: string, end: string): CalendarEvent {
  return { title, calendar: 'Home', color: '#3b82f6', allDay: true, start, end };
}

// Saturday 24 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 24, 10, 0);

/** Each shown day's label (or date) and items, as "Today: 09:00 Swim". */
function labels(events: CalendarEvent[]): string[] {
  return agenda(events, NOW).map(
    (day) =>
      `${day.label ? english({ key: day.label }) : String(day.date.getDate())}: ${day.items.map((i) => `${english(i.time)} ${i.title}`).join(', ')}`,
  );
}

describe('agenda', () => {
  it('splits events into today, tomorrow and later days', () => {
    const days = agenda(
      [
        timed('Lunch', at(24, 12, 30), at(24, 13, 30)),
        timed('Match', at(25, 15), at(25, 17)),
        timed('Dentist', at(28, 9), at(28, 9, 30)),
      ],
      NOW,
    );

    const badge = { calendar: 'Home', color: '#3b82f6', textColor: '#000' };
    expect(days).toEqual([
      {
        date: new Date(2026, 9, 24),
        label: 'agenda.today',
        items: [
          { title: 'Lunch', time: { key: 'agenda.startsAt', params: { time: '12:30' } }, ...badge },
        ],
      },
      {
        date: new Date(2026, 9, 25),
        label: 'agenda.tomorrow',
        items: [
          { title: 'Match', time: { key: 'agenda.startsAt', params: { time: '15:00' } }, ...badge },
        ],
      },
      {
        date: new Date(2026, 9, 28),
        label: null,
        items: [
          {
            title: 'Dentist',
            time: { key: 'agenda.startsAt', params: { time: '09:00' } },
            ...badge,
          },
        ],
      },
    ]);
  });

  it(`covers ${String(AGENDA_DAYS)} days`, () => {
    expect(
      labels([timed('Last day', at(30, 20), at(30, 21)), timed('Too late', at(31, 9), at(31, 10))]),
    ).toEqual(['Today: ', '30: 20:00 Last day']);
  });

  it('leaves out events that ended earlier today but keeps ongoing ones', () => {
    expect(
      labels([
        timed('Breakfast', at(24, 8), at(24, 9)),
        timed('Ends now', at(24, 9), at(24, 10)),
        timed('Cleaning', at(24, 9, 30), at(24, 11)),
      ]),
    ).toEqual(['Today: 09:30 Cleaning']);
  });

  it('reads all-day dates as local days', () => {
    expect(labels([allDay('Birthday', '2026-10-25', '2026-10-26')])).toEqual([
      'Today: ',
      'Tomorrow: All day Birthday',
    ]);
  });

  it('reads times without a zone as local times', () => {
    expect(labels([timed('Dinner', '2026-10-24T19:00:00', '2026-10-24T21:00:00')])).toEqual([
      'Today: 19:00 Dinner',
    ]);
  });

  it('shows events spanning several days on each day', () => {
    expect(
      labels([
        allDay('Holiday', '2026-10-14', '2026-10-30'),
        timed('Trip', at(23, 20), at(26, 8)),
        timed('Party', at(24, 23), at(25, 1, 30)),
      ]),
    ).toEqual([
      'Today: All day Holiday, All day Trip, 23:00 Party',
      'Tomorrow: All day Holiday, All day Trip, to 01:30 Party',
      '26: All day Holiday, to 08:00 Trip',
      '27: All day Holiday',
      '28: All day Holiday',
      '29: All day Holiday',
    ]);
  });

  it('puts all-day events first, then sorts by start time and title', () => {
    expect(
      labels([
        timed('Swim', at(25, 18), at(25, 19)),
        timed('Bake', at(25, 9), at(25, 10)),
        timed('Arts', at(25, 9), at(25, 10)),
        allDay('Market', '2026-10-25', '2026-10-26'),
      ]),
    ).toEqual(['Today: ', 'Tomorrow: All day Market, 09:00 Arts, 09:00 Bake, 18:00 Swim']);
  });

  it('keeps every event of a day', () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      timed(`Event ${String(i)}`, at(25, 8 + i), at(25, 9 + i)),
    );

    expect(agenda(events, NOW)[1].items.length).toBe(8);
  });

  it('keeps today when nothing is planned, and only today', () => {
    expect(agenda([], NOW)).toEqual([
      { date: new Date(2026, 9, 24), label: 'agenda.today', items: [] },
    ]);
  });
});

describe('textColorOn', () => {
  it.each([
    ['#ffffff', '#000'],
    ['#f59e0b', '#000'],
    ['#10b981', '#000'],
    ['#000000', '#fff'],
    ['#1e3a8a', '#fff'],
    ['#8b5cf6', '#000'], // just bright enough for black to contrast better
    ['#7c3aed', '#fff'],
  ])('picks readable text on %s', (color, text) => {
    expect(textColorOn(color)).toBe(text);
  });
});

describe('startOfDay', () => {
  it('returns local midnight, optionally some days later', () => {
    expect(startOfDay(NOW)).toEqual(new Date(2026, 9, 24));
    expect(startOfDay(NOW, 2)).toEqual(new Date(2026, 9, 26));
  });

  it('rolls over month ends', () => {
    expect(startOfDay(new Date(2026, 9, 31, 22), 1)).toEqual(new Date(2026, 10, 1));
  });
});
