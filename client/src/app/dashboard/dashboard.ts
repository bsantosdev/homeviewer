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
import { StopWatchIcon } from '@hugeicons/core-free-icons';
import { SettingsService } from '../settings.service';
import { Timer } from '../timer/timer';
import { weatherIconFor } from '../weather-icons';
import { Weather, WeatherService } from '../weather.service';

export const WEATHER_REFRESH_MS = 15 * 60 * 1000;

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, HugeiconsIconComponent, Timer],
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
  protected readonly settings = inject(SettingsService).settings;
  protected readonly isDark = computed(() => (this.settings()?.theme ?? 'dark') === 'dark');
  protected readonly now = signal(new Date());
  protected readonly weather = signal<Weather | null>(null);
  protected readonly weatherIconFor = weatherIconFor;
  protected readonly timerIcon = StopWatchIcon;
  protected readonly timerOpen = signal(false);

  private readonly location = computed(() => {
    const s = this.settings();
    return s ? `${String(s.latitude)},${String(s.longitude)}` : null;
  });

  constructor() {
    const clock = setInterval(() => {
      this.now.set(new Date());
    }, 1000);
    const weatherTimer = setInterval(() => {
      void this.loadWeather();
    }, WEATHER_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(clock);
      clearInterval(weatherTimer);
    });

    // Reload weather whenever the location changes (including the first load).
    effect(() => {
      if (this.location()) void this.loadWeather();
    });
  }

  protected toggleTimer(): void {
    this.timerOpen.update((open) => !open);
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
}
