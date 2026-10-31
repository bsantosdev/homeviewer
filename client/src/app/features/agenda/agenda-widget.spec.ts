import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { AgendaWidget } from './agenda-widget';
import { CalendarEvent, CalendarService } from './data-access/calendar.service';
import { TEST_SETTINGS, provideTestBackend, query } from '../../../testing/test-helpers';

const NOW = new Date(2026, 9, 23, 14, 5);

const MARKET: CalendarEvent = {
  title: 'Market',
  calendar: 'Family',
  color: '#ef4444',
  allDay: true,
  start: '2026-10-25',
  end: '2026-10-26',
};

describe('AgendaWidget', () => {
  let fixture: ComponentFixture<AgendaWidget>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideTestBackend() });
    fixture = TestBed.createComponent(AgendaWidget);
    fixture.componentRef.setInput('now', NOW);
    el = fixture.nativeElement as HTMLElement;
    TestBed.inject(HttpTestingController).expectOne('/api/settings').flush(TEST_SETTINGS);
  });

  async function show(events: CalendarEvent[]): Promise<void> {
    TestBed.inject(CalendarService).upcoming.set(events);
    await fixture.whenStable();
  }

  function sections(): string[] {
    return Array.from(el.querySelectorAll('.agenda section'), (section) =>
      Array.from(section.querySelectorAll('h3, .calendar-badge, .time, .title, p'), (n) =>
        n.textContent.trim(),
      ).join(' '),
    );
  }

  it('lists the week’s events by day', async () => {
    // Act
    await show([
      {
        title: 'Football',
        calendar: 'Family',
        color: '#ef4444',
        allDay: false,
        start: new Date(2026, 9, 23, 17, 0).toISOString(),
        end: new Date(2026, 9, 23, 18, 30).toISOString(),
      },
      { ...MARKET, start: '2026-10-24', end: '2026-10-25' },
      {
        title: 'Dentist',
        calendar: 'Work',
        color: '#1e3a8a',
        allDay: false,
        start: new Date(2026, 9, 28, 9, 30).toISOString(),
        end: new Date(2026, 9, 28, 10, 0).toISOString(),
      },
    ]);

    // Assert
    expect(sections()).toEqual([
      'Today Family 17:00 Football',
      'Tomorrow Family All day Market',
      'Wednesday, 28 October Work 09:30 Dentist',
    ]);
  });

  it("badges each event with its calendar's name and colour", async () => {
    // Act
    await show([
      {
        title: 'Standup',
        calendar: 'Work',
        color: '#1e3a8a',
        allDay: false,
        start: new Date(2026, 9, 23, 17, 0).toISOString(),
        end: new Date(2026, 9, 23, 17, 15).toISOString(),
      },
    ]);

    // Assert
    const badge = query(el, '.calendar-badge');
    expect(badge.textContent.trim()).toBe('Work');
    expect(badge.style.backgroundColor).toBe('rgb(30, 58, 138)');
    expect(badge.style.color).toBe('rgb(255, 255, 255)');
  });

  it('says when nothing is planned today and skips other empty days', async () => {
    // Act
    await show([MARKET]);

    // Assert
    expect(sections()).toEqual([
      'Today Nothing planned',
      'Sunday, 25 October Family All day Market',
    ]);
  });

  it('turns the days over with the clock', async () => {
    // Arrange
    await show([MARKET]);

    // Act
    fixture.componentRef.setInput('now', new Date(2026, 9, 25, 0, 1));
    await fixture.whenStable();

    // Assert
    expect(sections()).toEqual(['Today Family All day Market']);
  });
});
