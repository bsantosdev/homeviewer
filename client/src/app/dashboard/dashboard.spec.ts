import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { Dashboard, EVENTS_REFRESH_MS, LIGHTS_REFRESH_MS, WEATHER_REFRESH_MS } from './dashboard';
import { CalendarEvent, CalendarService } from '../calendar.service';
import { LightsService, Room } from '../lights.service';
import { SettingsService } from '../settings.service';
import { Weather, WeatherService } from '../weather.service';
import { TEST_SETTINGS, provideTestBackend, query, text } from '../../testing/test-helpers';

const MAINLY_CLEAR: Weather = {
  temperature: 21,
  min: 14,
  max: 24,
  description: 'Mainly clear',
  condition: 'partly-cloudy',
  isDay: true,
};

const WITH_CALENDAR = {
  ...TEST_SETTINGS,
  calendars: [{ name: 'Family', url: 'https://a.example/a.ics', color: '#ef4444' }],
};

describe('Dashboard', () => {
  let fixture: ComponentFixture<Dashboard>;
  let el: HTMLElement;
  let current: ReturnType<typeof vi.fn<(lat: number, lon: number) => Promise<Weather>>>;
  let events: ReturnType<typeof vi.fn<(from: Date, to: Date) => Promise<CalendarEvent[]>>>;
  let rooms: ReturnType<typeof signal<Room[] | null>>;
  let loadLights: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    // Fake only the clocks the component uses; Angular's scheduler keeps real timeouts.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 23, 14, 5));
    current = vi.fn().mockResolvedValue(MAINLY_CLEAR);
    events = vi.fn().mockResolvedValue([]);
    rooms = signal<Room[] | null>(null);
    loadLights = vi.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        ...provideTestBackend(),
        { provide: WeatherService, useValue: { current } },
        { provide: CalendarService, useValue: { events } },
        { provide: LightsService, useValue: { rooms, load: loadLights } },
      ],
    });
    fixture = TestBed.createComponent(Dashboard);
    el = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function loadSettings(settings = TEST_SETTINGS): Promise<void> {
    TestBed.inject(HttpTestingController).expectOne('/api/settings').flush(settings);
    await fixture.whenStable();
  }

  it('renders nothing until the settings arrive', async () => {
    await fixture.whenStable();
    expect(el.textContent.trim()).toBe('');
    expect(current).not.toHaveBeenCalled();
  });

  it('shows the title, message, clock, date and weather', async () => {
    await loadSettings();

    expect(text(el, 'h1')).toBe('Home');
    expect(text(el, 'header p')).toBe('Welcome home!');
    expect(text(el, 'main div')).toBe('14:05');
    expect(el.textContent).toContain('Friday, 23 October');
    expect(current).toHaveBeenCalledWith(38.72, -9.14);
    expect(text(el, 'footer .weather-temp')).toBe('21°');
    expect(text(el, 'footer .weather-range')).toBe('↓14° ↑24°');
    expect(text(el, 'footer .weather-summary')).toBe('Mainly clear · Lisbon');
  });

  it('shows an icon for the weather conditions', async () => {
    await loadSettings();
    const icon = query(el, 'footer .weather-icon');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.querySelector('svg path')).not.toBeNull();
  });

  it('changes the weather icon when the conditions change', async () => {
    await loadSettings();
    const before = query(el, 'footer .weather-icon svg', SVGElement).innerHTML;

    current.mockResolvedValue({ ...MAINLY_CLEAR, condition: 'snow' });
    vi.advanceTimersByTime(WEATHER_REFRESH_MS);
    // Let the weather promise resolve before rendering.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    expect(query(el, 'footer .weather-icon svg', SVGElement).innerHTML).not.toBe(before);
  });

  it('leaves out the weather icon for unknown conditions', async () => {
    current.mockResolvedValue({ ...MAINLY_CLEAR, description: '', condition: 'unknown' });
    await loadSettings();
    expect(el.querySelector('footer .weather-icon')).toBeNull();
    expect(text(el, 'footer .weather-temp')).toBe('21°');
  });

  it('applies the theme from the settings', async () => {
    await loadSettings();
    expect(el.classList).toContain('dark');

    TestBed.inject(SettingsService).settings.set({ ...TEST_SETTINGS, theme: 'light' });
    await fixture.whenStable();
    expect(el.classList).not.toContain('dark');
  });

  it('ticks the clock every second', async () => {
    await loadSettings();
    vi.setSystemTime(new Date(2026, 9, 23, 14, 6));
    vi.advanceTimersByTime(1000);
    await fixture.whenStable();
    expect(text(el, 'main div')).toBe('14:06');
  });

  it('refreshes the weather periodically and when the location changes', async () => {
    await loadSettings();
    expect(current).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(WEATHER_REFRESH_MS);
    await fixture.whenStable();
    expect(current).toHaveBeenCalledTimes(2);

    TestBed.inject(SettingsService).settings.set({ ...TEST_SETTINGS, latitude: 47.24 });
    await fixture.whenStable();
    expect(current).toHaveBeenLastCalledWith(47.24, -9.14);
  });

  it('skips the periodic refresh while settings are missing', async () => {
    await loadSettings();
    TestBed.inject(SettingsService).settings.set(null);
    await fixture.whenStable();

    vi.advanceTimersByTime(WEATHER_REFRESH_MS);
    expect(current).toHaveBeenCalledTimes(1);
  });

  it('logs weather errors and keeps running', async () => {
    const error = new Error('offline');
    current.mockRejectedValue(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await loadSettings();
    await Promise.resolve();

    expect(log).toHaveBeenCalledWith('Weather fetch failed', error);
    expect(text(el, 'footer')).toBe('');
  });

  it('toggles the timer in place of the clock', async () => {
    await loadSettings();
    const toggle = query(el, 'button[aria-label="Timer"]', HTMLButtonElement);
    expect(toggle.classList).toContain('opacity-75');

    toggle.click();
    await fixture.whenStable();
    expect(el.querySelector('app-timer')).not.toBeNull();
    expect(toggle.classList).toContain('opacity-100');

    toggle.click();
    await fixture.whenStable();
    expect(el.querySelector('app-timer')).toBeNull();
    expect(text(el, 'main div')).toBe('14:05');
  });

  it('stops its timers when destroyed', async () => {
    await loadSettings(WITH_CALENDAR);
    fixture.destroy();
    vi.advanceTimersByTime(WEATHER_REFRESH_MS);
    expect(current).toHaveBeenCalledTimes(1);
    expect(events).toHaveBeenCalledTimes(1);
    expect(loadLights).toHaveBeenCalledTimes(1);
  });

  describe('lights', () => {
    const KITCHEN: Room = {
      id: 'kitchen-id',
      name: 'Kitchen',
      on: true,
      brightness: 80,
      colors: [],
      temperature: null,
      canColor: false,
    };

    function lightsButton(): HTMLButtonElement | null {
      return el.querySelector<HTMLButtonElement>('button[aria-label="Lights"]');
    }

    it('hides the lights button while no Hue bridge is set up', async () => {
      await loadSettings();
      expect(loadLights).toHaveBeenCalledTimes(1);
      expect(lightsButton()).toBeNull();
    });

    it('opens the lights in place of the clock and fetches their current state', async () => {
      rooms.set([KITCHEN]);
      await loadSettings();
      const toggle = lightsButton();
      expect(toggle?.classList).toContain('opacity-75');

      toggle?.click();
      await fixture.whenStable();
      expect(el.querySelector('app-lights')).not.toBeNull();
      expect(el.querySelector('.text-clock')).toBeNull();
      expect(toggle?.classList).toContain('opacity-100');
      expect(loadLights).toHaveBeenCalledTimes(2);

      toggle?.click();
      await fixture.whenStable();
      expect(el.querySelector('app-lights')).toBeNull();
      expect(text(el, 'main div')).toBe('14:05');
      expect(loadLights).toHaveBeenCalledTimes(2);
    });

    it('shows one panel at a time', async () => {
      rooms.set([KITCHEN]);
      await loadSettings();

      lightsButton()?.click();
      await fixture.whenStable();
      query(el, 'button[aria-label="Timer"]', HTMLButtonElement).click();
      await fixture.whenStable();

      expect(el.querySelector('app-timer')).not.toBeNull();
      expect(el.querySelector('app-lights')).toBeNull();
      expect(lightsButton()?.classList).toContain('opacity-75');
    });

    it('goes back to the clock if the bridge goes away', async () => {
      rooms.set([KITCHEN]);
      await loadSettings();
      lightsButton()?.click();
      await fixture.whenStable();

      rooms.set(null);
      await fixture.whenStable();

      expect(lightsButton()).toBeNull();
      expect(el.querySelector('app-lights')).toBeNull();
      expect(text(el, 'main div')).toBe('14:05');
    });

    it('refreshes the lights periodically', async () => {
      await loadSettings();
      vi.advanceTimersByTime(LIGHTS_REFRESH_MS);
      expect(loadLights).toHaveBeenCalledTimes(2);
    });
  });

  describe('calendar', () => {
    // Let the events promise resolve before rendering.
    async function settle(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    }

    function sections(): string[] {
      return Array.from(el.querySelectorAll('.agenda section'), (section) =>
        Array.from(section.querySelectorAll('h2, span, p'), (n) => n.textContent.trim()).join(' '),
      );
    }

    it('is hidden when no calendars are configured', async () => {
      await loadSettings();
      expect(el.querySelector('.agenda')).toBeNull();
      expect(events).not.toHaveBeenCalled();
    });

    it('shows the events for today and tomorrow', async () => {
      events.mockResolvedValue([
        {
          title: 'Football',
          calendar: 'Family',
          color: '#ef4444',
          allDay: false,
          start: new Date(2026, 9, 23, 17, 0).toISOString(),
          end: new Date(2026, 9, 23, 18, 30).toISOString(),
        },
        {
          title: 'Market',
          calendar: 'Family',
          color: '#ef4444',
          allDay: true,
          start: '2026-10-24',
          end: '2026-10-25',
        },
      ]);

      await loadSettings(WITH_CALENDAR);
      await settle();

      // Local midnight today until the day after tomorrow.
      expect(events).toHaveBeenCalledWith(new Date(2026, 9, 23), new Date(2026, 9, 25));
      expect(sections()).toEqual(['Today 17:00 Football Family', 'Tomorrow All day Market Family']);
    });

    it("badges each event with its calendar's name and colour", async () => {
      events.mockResolvedValue([
        {
          title: 'Standup',
          calendar: 'Work',
          color: '#1e3a8a',
          allDay: false,
          start: new Date(2026, 9, 23, 17, 0).toISOString(),
          end: new Date(2026, 9, 23, 17, 15).toISOString(),
        },
      ]);

      await loadSettings(WITH_CALENDAR);
      await settle();

      const badge = query(el, '.agenda .calendar-badge');
      expect(badge.textContent.trim()).toBe('Work');
      expect(badge.style.backgroundColor).toBe('rgb(30, 58, 138)');
      expect(badge.style.color).toBe('rgb(255, 255, 255)');
    });

    it('says when a day has nothing planned or more than fits', async () => {
      events.mockResolvedValue(
        Array.from({ length: 6 }, (_, i) => ({
          title: `Event ${String(i)}`,
          calendar: 'Family',
          color: '#ef4444',
          allDay: true,
          start: '2026-10-24',
          end: '2026-10-25',
        })),
      );

      await loadSettings(WITH_CALENDAR);
      await settle();

      expect(text(el, '.agenda section:first-child p')).toBe('Nothing planned');
      expect(text(el, '.agenda section:last-child p')).toBe('+2 more');
    });

    it('refreshes periodically and when the calendar links change', async () => {
      await loadSettings(WITH_CALENDAR);
      expect(events).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(EVENTS_REFRESH_MS);
      await fixture.whenStable();
      expect(events).toHaveBeenCalledTimes(2);

      const settings = TestBed.inject(SettingsService).settings;
      settings.set({ ...WITH_CALENDAR, title: 'Kitchen' });
      await fixture.whenStable();
      expect(events).toHaveBeenCalledTimes(2);

      settings.set({
        ...WITH_CALENDAR,
        calendars: [{ name: 'Work', url: 'https://b.example/b.ics', color: '#10b981' }],
      });
      await fixture.whenStable();
      expect(events).toHaveBeenCalledTimes(3);
    });

    it('clears the events when the calendars are removed', async () => {
      events.mockResolvedValue([
        {
          title: 'Market',
          calendar: 'Family',
          color: '#ef4444',
          allDay: true,
          start: '2026-10-23',
          end: '2026-10-24',
        },
      ]);
      await loadSettings(WITH_CALENDAR);
      await settle();

      TestBed.inject(SettingsService).settings.set(TEST_SETTINGS);
      await fixture.whenStable();
      vi.advanceTimersByTime(EVENTS_REFRESH_MS);
      await fixture.whenStable();

      expect(el.querySelector('.agenda')).toBeNull();
      expect(events).toHaveBeenCalledTimes(1);
    });

    it('logs calendar errors and keeps running', async () => {
      const error = new Error('offline');
      events.mockRejectedValue(error);
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await loadSettings(WITH_CALENDAR);
      await settle();

      expect(log).toHaveBeenCalledWith('Calendar fetch failed', error);
      expect(text(el, '.agenda section:first-child p')).toBe('Nothing planned');
    });

    it('makes way for the timer', async () => {
      await loadSettings(WITH_CALENDAR);
      query(el, 'button[aria-label="Timer"]', HTMLButtonElement).click();
      await fixture.whenStable();
      expect(el.querySelector('.agenda')).toBeNull();
    });
  });
});
