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
import { TranslocoPipe } from '@jsverse/transloco';
import {
  BulbIcon,
  Home09Icon,
  Mail01Icon,
  MusicNote01Icon,
  ShoppingBasket01Icon,
  StopWatchIcon,
} from '@hugeicons/core-free-icons';
import { AgendaWidget } from '../features/agenda/agenda-widget';
import { Background } from '../features/backgrounds/background/background';
import { CalendarService } from '../features/agenda/data-access/calendar.service';
import { LightsService } from '../features/lights/data-access/lights.service';
import { Lights } from '../features/lights/lights';
import { LightsSummary } from '../features/lights/lights-summary';
import { Music } from '../features/music/music';
import { NowPlaying } from '../features/music/now-playing';
import { WAKE_MS, isNight } from '../core/night';
import { SettingsService } from '../core/settings.service';
import { ShoppingService } from '../features/shopping/data-access/shopping.service';
import { MUSIC_REFRESH_MS, SpotifyService } from '../features/music/data-access/spotify.service';
import { ShoppingList } from '../features/shopping/shopping-list';
import { Timer } from '../features/timer/timer';
import { WeatherService } from '../features/weather/data-access/weather.service';
import { WeatherWidget } from '../features/weather/weather-widget';

export const WEATHER_REFRESH_MS = 1 * 60 * 1000;
export const EVENTS_REFRESH_MS = 1 * 60 * 1000;
// Often enough to pick up lights switched from the Hue app or a wall switch.
export const LIGHTS_REFRESH_MS = 15 * 1000;

/** The pages in the top bar. Home holds the widgets; the others fill the space below the bar. */
type Page = 'home' | 'lights' | 'music' | 'shopping' | 'timer' | 'email';

interface NavItem {
  page: Page;
  /** A translation key. */
  label: string;
  icon: typeof Home09Icon;
}

const HOME: NavItem = { page: 'home', label: 'nav.home', icon: Home09Icon };
const LIGHTS: NavItem = { page: 'lights', label: 'nav.lights', icon: BulbIcon };
const MUSIC: NavItem = { page: 'music', label: 'nav.music', icon: MusicNote01Icon };
const SHOPPING: NavItem = { page: 'shopping', label: 'nav.shopping', icon: ShoppingBasket01Icon };
const TIMER: NavItem = { page: 'timer', label: 'nav.timer', icon: StopWatchIcon };
const EMAIL: NavItem = { page: 'email', label: 'nav.email', icon: Mail01Icon };

@Component({
  selector: 'app-dashboard',
  imports: [
    AgendaWidget,
    Background,
    DatePipe,
    HugeiconsIconComponent,
    Lights,
    LightsSummary,
    Music,
    NowPlaying,
    ShoppingList,
    Timer,
    TranslocoPipe,
    WeatherWidget,
  ],
  templateUrl: './dashboard.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'relative z-0 box-border flex h-screen flex-col bg-[#f7f7f5] p-[3vh] text-[#1a1a1a] transition-colors duration-300 dark:bg-[#111] dark:text-[#f2f2f2]',
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
  private readonly spotify = inject(SpotifyService);
  protected readonly settings = this.settingsService.settings;
  protected readonly isDark = this.settingsService.isDark;
  protected readonly language = this.settingsService.language;
  protected readonly now = signal(new Date());
  /** Shown on the list's button, so it's clear from home that there's shopping to do. */
  protected readonly toBuy = inject(ShoppingService).open;
  private readonly chosen = signal<Page>('home');
  /** The lights only show once the server says a Hue bridge is set up. */
  protected readonly hasLights = computed(() => this.lightsService.rooms() !== null);
  /** Music only shows once the server says Spotify is set up. */
  protected readonly hasMusic = computed(() => this.spotify.status() !== null);
  /** Falls back to home if the bridge or Spotify goes away while its page is open. */
  protected readonly page = computed(() => {
    const chosen = this.chosen();
    const gone =
      (chosen === 'lights' && !this.hasLights()) || (chosen === 'music' && !this.hasMusic());
    return gone ? 'home' : chosen;
  });
  protected readonly nav = computed(() => [
    HOME,
    ...(this.hasLights() ? [LIGHTS] : []),
    ...(this.hasMusic() ? [MUSIC] : []),
    SHOPPING,
    TIMER,
    EMAIL,
  ]);
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
    const musicTimer = setInterval(() => {
      if (!this.asleep()) void this.spotify.load();
    }, MUSIC_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(musicTimer);
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
    void this.spotify.load();
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
    void this.spotify.load();
  }

  /** Any touch while woken at night starts the minute again, so it doesn't go dark mid-use. */
  protected keepAwake(): void {
    if (this.awakeUntil() > Date.now()) this.awakeUntil.set(Date.now() + WAKE_MS);
  }

  private async loadWeather(): Promise<void> {
    const s = this.settings();
    if (s) await this.weatherService.load(s.latitude, s.longitude);
  }

  private async loadEvents(): Promise<void> {
    if (this.hasCalendars()) await this.calendarService.load();
    else this.calendarService.clear();
  }
}
