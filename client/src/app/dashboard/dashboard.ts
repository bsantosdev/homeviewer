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
import { BulbIcon, StopWatchIcon } from '@hugeicons/core-free-icons';
import { AGENDA_DAYS, agenda, startOfDay } from '../agenda';
import { CalendarEvent, CalendarService } from '../calendar.service';
import { LightsService } from '../lights.service';
import { Lights } from '../lights/lights';
import { SettingsService } from '../settings.service';
import { Timer } from '../timer/timer';
import { weatherIconFor } from '../weather-icons';
import { Weather, WeatherService } from '../weather.service';

export const WEATHER_REFRESH_MS = 1 * 60 * 1000;
export const EVENTS_REFRESH_MS = 1 * 60 * 1000;
// Often enough to pick up lights switched from the Hue app or a wall switch.
export const LIGHTS_REFRESH_MS = 15 * 1000;

/** What replaces the clock in the middle of the screen. */
type Panel = 'timer' | 'lights';

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, HugeiconsIconComponent, Lights, Timer],
  templateUrl: './dashboard.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'relative box-border flex h-screen flex-col justify-between bg-[#f7f7f5] px-[5vw] py-[4vh] text-center text-[#1a1a1a] transition-colors duration-300 dark:bg-[#111] dark:text-[#f2f2f2]',
    '[class.dark]': 'isDark()',
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
  protected readonly timerIcon = StopWatchIcon;
  protected readonly lightsIcon = BulbIcon;
  protected readonly panel = signal<Panel | null>(null);
  /** The lights button only shows once the server says a Hue bridge is set up. */
  protected readonly hasLights = computed(() => this.lightsService.rooms() !== null);
  protected readonly hasCalendars = computed(() => !!this.settings()?.calendars.length);
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
      void this.loadWeather();
    }, WEATHER_REFRESH_MS);
    const eventsTimer = setInterval(() => {
      void this.loadEvents();
    }, EVENTS_REFRESH_MS);
    const lightsTimer = setInterval(() => {
      void this.lightsService.load();
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

  protected toggle(panel: Panel): void {
    this.panel.update((open) => (open === panel ? null : panel));
    // Show the current state when the lights open, not what it was at the last refresh.
    if (this.panel() === 'lights') void this.lightsService.load();
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
