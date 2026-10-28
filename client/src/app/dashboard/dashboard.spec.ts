import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { Dashboard, EVENTS_REFRESH_MS, LIGHTS_REFRESH_MS, WEATHER_REFRESH_MS } from './dashboard';
import { CalendarEvent, CalendarService } from '../calendar.service';
import { LightsService, Room } from '../lights.service';
import { SettingsService } from '../settings.service';
import { Weather, WeatherService } from '../weather.service';
import { WAKE_MS } from '../night';
import { TEST_SETTINGS, provideTestBackend, query, text } from '../../testing/test-helpers';

const MAINLY_CLEAR: Weather = {
  temperature: 21,
  min: 14,
  max: 24,
  description: 'weather.mainlyClear',
  condition: 'partly-cloudy',
  isDay: true,
  rain: null,
  days: [],
  uv: null,
  air: null,
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
    expect(text(el, '.clock')).toBe('14:05');
    expect(el.textContent).toContain('Friday, 23 October');
    expect(current).toHaveBeenCalledWith(38.72, -9.14);
    expect(text(el, '.weather .weather-temp')).toBe('21°');
    expect(text(el, '.weather .weather-range')).toBe('↓14° ↑24°');
    expect(text(el, '.weather .weather-summary')).toBe('Mainly clear');
    expect(text(el, '.weather .weather-place')).toBe('Lisbon');
  });

  it('shows an icon for the weather conditions', async () => {
    await loadSettings();
    const icon = query(el, '.weather .weather-icon');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.querySelector('svg path')).not.toBeNull();
  });

  it('changes the weather icon when the conditions change', async () => {
    await loadSettings();
    const before = query(el, '.weather .weather-icon svg', SVGElement).innerHTML;

    current.mockResolvedValue({ ...MAINLY_CLEAR, condition: 'snow' });
    vi.advanceTimersByTime(WEATHER_REFRESH_MS);
    // Let the weather promise resolve before rendering.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    expect(query(el, '.weather .weather-icon svg', SVGElement).innerHTML).not.toBe(before);
  });

  it('leaves out the weather icon for unknown conditions', async () => {
    current.mockResolvedValue({ ...MAINLY_CLEAR, description: '', condition: 'unknown' });
    await loadSettings();
    expect(el.querySelector('.weather .weather-icon')).toBeNull();
    expect(text(el, '.weather .weather-temp')).toBe('21°');
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
    expect(text(el, '.clock')).toBe('14:06');
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

  it('says when rain is coming, and forecasts the next days', async () => {
    current.mockResolvedValue({
      ...MAINLY_CLEAR,
      rain: { key: 'weather.rainFrom', params: { time: '16:00' } },
      days: [
        { date: new Date(2026, 9, 24), min: 12, max: 19, condition: 'rain' },
        { date: new Date(2026, 9, 25), min: 11, max: 20, condition: 'unknown' },
      ],
    });
    await loadSettings();
    await Promise.resolve();
    await fixture.whenStable();

    expect(text(el, '.weather-rain')).toBe('Rain from 16:00');
    const days = Array.from(el.querySelectorAll('.weather-day'), (d) =>
      d.textContent.replace(/\s+/g, ' ').trim(),
    );
    expect(days).toEqual(['Sat 19° 12°', 'Sun 20° 11°']);
    expect(el.querySelectorAll('.weather-day hugeicons-icon')).toHaveLength(1);
  });

  it('leaves out the rain note and forecast without them', async () => {
    await loadSettings();
    await Promise.resolve();
    await fixture.whenStable();
    expect(el.querySelector('.weather-rain')).toBeNull();
    expect(el.querySelector('.weather-day')).toBeNull();
  });

  it('shows the UV index and air quality', async () => {
    current.mockResolvedValue({
      ...MAINLY_CLEAR,
      uv: { value: 6, level: 'weather.uvLevels.high' },
      air: { value: 24, level: 'weather.airLevels.fair' },
    });
    await loadSettings();
    await Promise.resolve();
    await fixture.whenStable();
    expect(text(el, '.weather-uv')).toBe('UV 6 · High');
    expect(text(el, '.weather-air')).toBe('Air: Fair');
  });

  it('shows air quality alone when the UV index is too low to matter', async () => {
    current.mockResolvedValue({
      ...MAINLY_CLEAR,
      air: { value: 5, level: 'weather.airLevels.good' },
    });
    await loadSettings();
    await Promise.resolve();
    await fixture.whenStable();
    expect(el.querySelector('.weather-uv')).toBeNull();
    expect(text(el, '.weather-air')).toBe('Air: Good');
  });

  it('shows the UV index alone without air quality', async () => {
    current.mockResolvedValue({
      ...MAINLY_CLEAR,
      uv: { value: 2, level: 'weather.uvLevels.low' },
    });
    await loadSettings();
    await Promise.resolve();
    await fixture.whenStable();
    expect(text(el, '.weather-uv')).toBe('UV 2 · Low');
    expect(el.querySelector('.weather-air')).toBeNull();
  });

  it('logs weather errors and keeps running', async () => {
    const error = new Error('offline');
    current.mockRejectedValue(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await loadSettings();
    await Promise.resolve();

    expect(log).toHaveBeenCalledWith('Weather fetch failed', error);
    expect(el.querySelector('.weather')).toBeNull();
  });

  describe('night mode', () => {
    // The tests run at 14:05, so this hour is night.
    const NIGHT = { ...TEST_SETTINGS, nightMode: true, nightStart: '14:00', nightEnd: '15:00' };

    function asleep(): boolean {
      return el.querySelector('.night') !== null;
    }

    async function wait(ms: number): Promise<void> {
      vi.advanceTimersByTime(ms);
      await fixture.whenStable();
    }

    async function wake(): Promise<void> {
      query(el, 'button.night').click();
      await fixture.whenStable();
    }

    it('shows only a dim clock during the night hours', async () => {
      await loadSettings(NIGHT);

      expect(asleep()).toBe(true);
      expect(text(el, '.night-clock')).toBe('14:05');
      expect(el.querySelector('nav')).toBeNull();
      expect(el.querySelector('app-background')).toBeNull();
    });

    it('is off outside the night hours, or when switched off', async () => {
      await loadSettings({ ...NIGHT, nightStart: '22:00', nightEnd: '07:00' });
      expect(asleep()).toBe(false);

      TestBed.inject(SettingsService).settings.set({ ...NIGHT, nightMode: false });
      await fixture.whenStable();
      expect(asleep()).toBe(false);
    });

    it('stops refreshing while dark', async () => {
      await loadSettings({ ...NIGHT, calendars: WITH_CALENDAR.calendars });
      await wait(WEATHER_REFRESH_MS);

      expect(current).toHaveBeenCalledTimes(1);
      expect(events).toHaveBeenCalledTimes(1);
      expect(loadLights).toHaveBeenCalledTimes(1);
    });

    it('wakes on a tap for a minute, with fresh data', async () => {
      await loadSettings(NIGHT);

      await wake();
      expect(asleep()).toBe(false);
      expect(text(el, '.clock')).toBe('14:05');
      expect(current).toHaveBeenCalledTimes(2);
      expect(loadLights).toHaveBeenCalledTimes(2);

      await wait(WAKE_MS - 1000);
      expect(asleep()).toBe(false);
      await wait(1000);
      expect(asleep()).toBe(true);
    });

    it.each(['touchstart', 'mousedown'])('stays awake while being used (%s)', async (type) => {
      await loadSettings(NIGHT);
      await wake();

      await wait(WAKE_MS - 10_000);
      el.dispatchEvent(new Event(type));
      await wait(WAKE_MS - 1000);
      expect(asleep()).toBe(false);

      await wait(1000);
      expect(asleep()).toBe(true);
    });

    it('stays awake while the timer is open, and wakes to home', async () => {
      await loadSettings(NIGHT);
      await wake();
      query(el, 'nav button[aria-label="Timer"]').click();
      await fixture.whenStable();

      await wait(5 * WAKE_MS);
      expect(el.querySelector('app-timer')).not.toBeNull();

      query(el, 'nav button[aria-label="Home"]').click();
      await wait(1000);
      expect(asleep()).toBe(true);
      await wake();
      expect(el.querySelector('app-timer')).toBeNull();
    });

    it('lights up again when the night ends', async () => {
      await loadSettings(NIGHT);
      vi.setSystemTime(new Date(2026, 9, 23, 15, 0));
      await wait(1000);
      expect(asleep()).toBe(false);
    });
  });

  describe('top bar', () => {
    function navButton(label: string): HTMLButtonElement | null {
      return el.querySelector<HTMLButtonElement>(`nav button[aria-label="${label}"]`);
    }

    async function go(label: string): Promise<void> {
      navButton(label)?.click();
      await fixture.whenStable();
    }

    function current(): string[] {
      return Array.from(el.querySelectorAll('nav [aria-current="page"]'), (b) =>
        String(b.getAttribute('aria-label')),
      );
    }

    it('starts on home', async () => {
      await loadSettings();
      expect(Array.from(el.querySelectorAll('nav button'), (b) => b.ariaLabel)).toEqual([
        'Home',
        'Shopping list',
        'Timer',
        'Email',
      ]);
      expect(current()).toEqual(['Home']);
    });

    it('shows the timer in place of the widgets, and goes back home', async () => {
      await loadSettings();

      await go('Timer');
      expect(el.querySelector('app-timer')).not.toBeNull();
      expect(el.querySelector('.clock')).toBeNull();
      expect(current()).toEqual(['Timer']);

      // Tapping the open page again leaves it open.
      await go('Timer');
      expect(el.querySelector('app-timer')).not.toBeNull();

      await go('Home');
      expect(el.querySelector('app-timer')).toBeNull();
      expect(text(el, '.clock')).toBe('14:05');
    });

    it('opens the shopping list, and shows on its button how much is left to buy', async () => {
      await loadSettings();
      TestBed.inject(HttpTestingController)
        .expectOne('/api/shopping')
        .flush([
          { id: '1', text: 'Milk', done: false },
          { id: '2', text: 'Bread', done: false },
          { id: '3', text: 'Eggs', done: true },
        ]);
      // Let the list's promise resolve before rendering.
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
      expect(text(el, 'nav .to-buy')).toBe('2');

      await go('Shopping list');
      expect(el.querySelectorAll('app-shopping-list .item')).toHaveLength(3);
      expect(current()).toEqual(['Shopping list']);
    });

    it('has no badge when there is nothing to buy', async () => {
      await loadSettings();
      TestBed.inject(HttpTestingController).expectOne('/api/shopping').flush([]);
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
      expect(el.querySelector('nav .to-buy')).toBeNull();
    });

    it('has a place for email', async () => {
      await loadSettings();
      await go('Email');
      expect(text(el, '.email')).toBe('Email is coming soon.');
      expect(current()).toEqual(['Email']);
    });
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

    it('hides the lights while no Hue bridge is set up', async () => {
      await loadSettings();
      expect(loadLights).toHaveBeenCalledTimes(1);
      expect(lightsButton()).toBeNull();
      expect(el.querySelector('app-lights-summary')).toBeNull();
      // With nothing to list, the clock gets the whole width.
      expect(el.querySelector('.text-clock')).not.toBeNull();
    });

    it('lists the rooms on home, next to a smaller clock', async () => {
      rooms.set([KITCHEN]);
      await loadSettings();
      expect(text(el, 'app-lights-summary .name')).toBe('Kitchen');
      expect(el.querySelector('.text-clock-half')).not.toBeNull();
    });

    it('opens the lights page and fetches their current state', async () => {
      rooms.set([KITCHEN]);
      await loadSettings();
      expect(lightsButton()?.getAttribute('aria-current')).toBeNull();

      lightsButton()?.click();
      await fixture.whenStable();
      expect(el.querySelector('app-lights')).not.toBeNull();
      expect(el.querySelector('.clock')).toBeNull();
      expect(lightsButton()?.getAttribute('aria-current')).toBe('page');
      expect(loadLights).toHaveBeenCalledTimes(2);

      query(el, 'nav button[aria-label="Timer"]', HTMLButtonElement).click();
      await fixture.whenStable();
      expect(el.querySelector('app-timer')).not.toBeNull();
      expect(el.querySelector('app-lights')).toBeNull();
      expect(loadLights).toHaveBeenCalledTimes(2);
    });

    it('goes back home if the bridge goes away', async () => {
      rooms.set([KITCHEN]);
      await loadSettings();
      lightsButton()?.click();
      await fixture.whenStable();

      rooms.set(null);
      await fixture.whenStable();

      expect(lightsButton()).toBeNull();
      expect(el.querySelector('app-lights')).toBeNull();
      expect(text(el, '.clock')).toBe('14:05');
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
        Array.from(section.querySelectorAll('h3, .calendar-badge, .time, .title, p'), (n) =>
          n.textContent.trim(),
        ).join(' '),
      );
    }

    it('is hidden when no calendars are configured', async () => {
      await loadSettings();
      expect(el.querySelector('.agenda')).toBeNull();
      expect(events).not.toHaveBeenCalled();
    });

    it('lists the week’s events by day, next to a smaller clock', async () => {
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
        {
          title: 'Dentist',
          calendar: 'Work',
          color: '#1e3a8a',
          allDay: false,
          start: new Date(2026, 9, 28, 9, 30).toISOString(),
          end: new Date(2026, 9, 28, 10, 0).toISOString(),
        },
      ]);

      await loadSettings(WITH_CALENDAR);
      await settle();

      // Local midnight today until a week later.
      expect(events).toHaveBeenCalledWith(new Date(2026, 9, 23), new Date(2026, 9, 30));
      expect(sections()).toEqual([
        'Today Family 17:00 Football',
        'Tomorrow Family All day Market',
        'Wednesday, 28 October Work 09:30 Dentist',
      ]);
      expect(el.querySelector('.text-clock-half')?.textContent.trim()).toBe('14:05');
      expect(el.querySelector('.text-clock')).toBeNull();
    });

    it('speaks the language from the settings, dates included', async () => {
      current.mockResolvedValue({
        ...MAINLY_CLEAR,
        rain: { key: 'weather.rainUntil', params: { time: '16:00' } },
        days: [{ date: new Date(2026, 9, 24), min: 12, max: 19, condition: 'rain' }],
        uv: { value: 6, level: 'weather.uvLevels.high' },
        air: { value: 24, level: 'weather.airLevels.fair' },
      });
      events.mockResolvedValue([
        {
          title: 'Market',
          calendar: 'Family',
          color: '#ef4444',
          allDay: true,
          start: '2026-10-24',
          end: '2026-10-25',
        },
        {
          title: 'Dentist',
          calendar: 'Work',
          color: '#1e3a8a',
          allDay: false,
          start: new Date(2026, 9, 28, 9, 30).toISOString(),
          end: new Date(2026, 9, 28, 10, 0).toISOString(),
        },
      ]);
      const navLabels = () =>
        Array.from(el.querySelectorAll('nav button'), (b) => b.getAttribute('aria-label'));

      await loadSettings({ ...WITH_CALENDAR, language: 'de' });
      await settle();

      expect(text(el, '.date')).toBe('Freitag, 23. Oktober');
      expect(text(el, '.weather-summary')).toBe('Überwiegend klar');
      expect(text(el, '.weather-rain')).toBe('Regen bis 16:00');
      expect(text(el, '.weather-uv')).toBe('UV 6 · Hoch');
      expect(text(el, '.weather-air')).toBe('Luft: Akzeptabel');
      expect(text(el, '.weather-day div')).toBe('Sa.');
      expect(sections()).toEqual([
        'Heute Nichts geplant',
        'Morgen Family Ganztägig Market',
        'Mittwoch, 28. Oktober Work 09:30 Dentist',
      ]);
      expect(navLabels()).toEqual(['Start', 'Einkaufsliste', 'Timer', 'E-Mail']);
      expect(document.documentElement.lang).toBe('de');

      TestBed.inject(SettingsService).settings.set({ ...WITH_CALENDAR, language: 'pt-BR' });
      await fixture.whenStable();

      // Lowercase in the text; CSS capitalises the first letter on screen.
      expect(text(el, '.date')).toBe('sexta-feira, 23 de outubro');
      expect(text(el, '.weather-rain')).toBe('Chuva até 16:00');
      expect(text(el, '.weather-air')).toBe('Ar: Razoável');
      expect(sections()[1]).toBe('Amanhã Family Dia todo Market');
      expect(navLabels()).toEqual(['Início', 'Lista de compras', 'Timer', 'E-mail']);
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

    it('says when nothing is planned today and skips other empty days', async () => {
      events.mockResolvedValue([
        {
          title: 'Market',
          calendar: 'Family',
          color: '#ef4444',
          allDay: true,
          start: '2026-10-25',
          end: '2026-10-26',
        },
      ]);

      await loadSettings(WITH_CALENDAR);
      await settle();

      expect(sections()).toEqual([
        'Today Nothing planned',
        'Sunday, 25 October Family All day Market',
      ]);
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
