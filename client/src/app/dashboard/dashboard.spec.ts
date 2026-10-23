import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { Dashboard, WEATHER_REFRESH_MS } from './dashboard';
import { SettingsService } from '../settings.service';
import { Weather, WeatherService } from '../weather.service';
import { TEST_SETTINGS, provideTestBackend, query, text } from '../../testing/test-helpers';

describe('Dashboard', () => {
  let fixture: ComponentFixture<Dashboard>;
  let el: HTMLElement;
  let current: ReturnType<typeof vi.fn<(lat: number, lon: number) => Promise<Weather>>>;

  beforeEach(() => {
    // Fake only the clocks the component uses; Angular's scheduler keeps real timeouts.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 23, 14, 5));
    current = vi.fn().mockResolvedValue({ temperature: 21, description: 'Mainly clear' });

    TestBed.configureTestingModule({
      providers: [...provideTestBackend(), { provide: WeatherService, useValue: { current } }],
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
    expect(text(el, 'footer span:first-child')).toBe('21°');
    expect(text(el, 'footer span:last-child')).toBe('Mainly clear · Lisbon');
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
    await loadSettings();
    fixture.destroy();
    vi.advanceTimersByTime(WEATHER_REFRESH_MS);
    expect(current).toHaveBeenCalledTimes(1);
  });
});
