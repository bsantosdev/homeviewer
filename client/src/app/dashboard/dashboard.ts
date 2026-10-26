import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { HugeiconsIconComponent } from '@hugeicons/angular';
import { BulbIcon, Home09Icon, Mail01Icon, StopWatchIcon } from '@hugeicons/core-free-icons';
import { AGENDA_DAYS, agenda, startOfDay } from '../agenda';
import { Background } from '../background/background';
import { CalendarEvent, CalendarService } from '../calendar.service';
import { LightsService } from '../lights.service';
import { Lights } from '../lights/lights';
import { LightsSummary } from '../lights/lights-summary';
import { WAKE_MS, isNight } from '../night';
import { SettingsService } from '../settings.service';
import { Timer } from '../timer/timer';
import { weatherIconFor } from '../weather-icons';
import { Weather, WeatherService } from '../weather.service';

export const WEATHER_REFRESH_MS = 1 * 60 * 1000;
export const EVENTS_REFRESH_MS = 1 * 60 * 1000;
// Often enough to pick up lights switched from the Hue app or a wall switch.
export const LIGHTS_REFRESH_MS = 15 * 1000;

/** The pages in the side bar. Home holds the widgets; the others fill the space next to the bar. */
type Page = 'home' | 'lights' | 'timer' | 'email';

interface NavItem {
  page: Page;
  label: string;
  icon: typeof Home09Icon;
}

const HOME: NavItem = { page: 'home', label: 'Home', icon: Home09Icon };
const LIGHTS: NavItem = { page: 'lights', label: 'Lights', icon: BulbIcon };
const TIMER: NavItem = { page: 'timer', label: 'Timer', icon: StopWatchIcon };
const EMAIL: NavItem = { page: 'email', label: 'Email', icon: Mail01Icon };

@Component({
  selector: 'app-dashboard',
  imports: [Background, DatePipe, HugeiconsIconComponent, Lights, LightsSummary, Timer],
  templateUrl: './dashboard.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'relative z-0 box-border flex h-screen bg-[#f7f7f5] p-[3vh] text-[#1a1a1a] transition-colors duration-300 dark:bg-[#111] dark:text-[#f2f2f2]',
    '[class.dark]': 'isDark()',
    // iOS 12 has no pointer events.
    '(touchstart)': 'keepAwake()',
    '(mousedown)': 'keepAwake()',
  },
})
export class Dashboard {
  private readonly weatherService = inject(WeatherService);
  private readonly calendarService = inject(CalendarService);
  private readonly settingsService = inject(SettingsService);
  private readonly lightsService = inject(LightsService);
  protected readonly settings = this.settingsService.settings;
  protected readonly isDark = this.settingsService.isDark;
  protected readonly now = signal(new Date());
  protected readonly weather = signal<Weather | null>(null);
  protected readonly weatherIconFor = weatherIconFor;
  private readonly chosen = signal<Page>('home');
  /** The lights only show once the server says a Hue bridge is set up. */
  protected readonly hasLights = computed(() => this.lightsService.rooms() !== null);
  /** Falls back to home if the bridge goes away while its page is open. */
  protected readonly page = computed(() =>
    this.chosen() === 'lights' && !this.hasLights() ? 'home' : this.chosen(),
  );
  protected readonly nav = computed(() =>
    this.hasLights() ? [HOME, LIGHTS, TIMER, EMAIL] : [HOME, TIMER, EMAIL],
  );
  /** When the last tap at night stops keeping the dashboard on. */
  private readonly awakeUntil = signal(0);
  /**
   * At night only a dim clock shows, and nothing refreshes. A tap brings the dashboard back for a
   * while, and an open timer keeps it on so a countdown isn't lost.
   */
  protected readonly asleep = computed(() => {
    const s = this.settings();
    return (
      !!s &&
      isNight(s, this.now()) &&
      this.now().getTime() >= this.awakeUntil() &&
      this.page() !== 'timer'
    );
  });
  protected readonly hasCalendars = computed(() => !!this.settings()?.calendars.length);
  /** Whether home has a right-hand column of lists, or the clock gets the whole width. */
  protected readonly hasWidgets = computed(() => this.hasCalendars() || this.hasLights());
  private readonly events = signal<CalendarEvent[]>([]);
  protected readonly agenda = computed(() => agenda(this.events(), this.now()));

  private readonly location = computed(() => {
    const s = this.settings();
    return s ? `${String(s.latitude)},${String(s.longitude)}` : null;
  });

  // Compared as text, so unrelated settings changes don't refetch the calendars.
  private readonly calendarUrls = computed(() =>
    this.settings()
      ?.calendars.map((c) => c.url)
      .join(' '),
  );

  constructor() {
    const clock = setInterval(() => {
      this.now.set(new Date());
    }, 1000);
    const weatherTimer = setInterval(() => {
      if (!this.asleep()) void this.loadWeather();
    }, WEATHER_REFRESH_MS);
    const eventsTimer = setInterval(() => {
      if (!this.asleep()) void this.loadEvents();
    }, EVENTS_REFRESH_MS);
    const lightsTimer = setInterval(() => {
      if (!this.asleep()) void this.lightsService.load();
    }, LIGHTS_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(clock);
      clearInterval(weatherTimer);
      clearInterval(eventsTimer);
      clearInterval(lightsTimer);
    });

    // Reload weather whenever the location changes (including the first load).
    effect(() => {
      if (this.location()) void this.loadWeather();
    });
    effect(() => {
      if (this.calendarUrls() !== undefined) void this.loadEvents();
    });
    void this.lightsService.load();
  }

  protected show(page: Page): void {
    this.chosen.set(page);
    // Show the current state when the lights open, not what it was at the last refresh.
    if (page === 'lights') void this.lightsService.load();
  }

  /** Brings the dashboard back at night, with fresh data: nothing refreshed while it was dark. */
  protected wake(): void {
    this.awakeUntil.set(Date.now() + WAKE_MS);
    this.chosen.set('home');
    this.now.set(new Date());
    void this.loadWeather();
    void this.loadEvents();
    void this.lightsService.load();
  }

  /** Any touch while woken at night starts the minute again, so it doesn't go dark mid-use. */
  protected keepAwake(): void {
    if (this.awakeUntil() > Date.now()) this.awakeUntil.set(Date.now() + WAKE_MS);
  }

  private async loadWeather(): Promise<void> {
    const s = this.settings();
    if (!s) return;
    try {
      this.weather.set(await this.weatherService.current(s.latitude, s.longitude));
    } catch (err: unknown) {
      console.error('Weather fetch failed', err);
    }
  }

  private async loadEvents(): Promise<void> {
    if (!this.hasCalendars()) {
      this.events.set([]);
      return;
    }
    const today = startOfDay(new Date());
    try {
      this.events.set(await this.calendarService.events(today, startOfDay(today, AGENDA_DAYS)));
    } catch (err: unknown) {
      console.error('Calendar fetch failed', err);
    }
  }
}
