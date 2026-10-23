import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { SettingsService } from '../settings.service';
import { Timer } from '../timer/timer';

interface Weather {
  temperature: number;
  code: number;
}

// WMO weather codes used by Open-Meteo.
const WEATHER_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
  95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail',
};

const WEATHER_REFRESH_MS = 15 * 60 * 1000;

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, Timer],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  host: { '[class]': 'settings()?.theme ?? "dark"' },
})
export class Dashboard {
  protected readonly settings = inject(SettingsService).settings;
  protected readonly now = signal(new Date());
  protected readonly weather = signal<Weather | null>(null);
  protected readonly timerOpen = signal(false);
  protected readonly weatherDescription = computed(() => {
    const w = this.weather();
    return w ? (WEATHER_DESCRIPTIONS[w.code] ?? '') : '';
  });

  private readonly location = computed(() => {
    const s = this.settings();
    return s ? `${s.latitude},${s.longitude}` : null;
  });

  constructor() {
    const clock = setInterval(() => this.now.set(new Date()), 1000);
    const weatherTimer = setInterval(() => this.loadWeather(), WEATHER_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(clock);
      clearInterval(weatherTimer);
    });

    // Reload weather whenever the location changes (including the first load).
    effect(() => {
      if (this.location()) this.loadWeather();
    });
  }

  private async loadWeather(): Promise<void> {
    const s = this.settings();
    if (!s) return;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${s.latitude}&longitude=${s.longitude}&current=temperature_2m,weather_code`;
      const data = await (await fetch(url)).json();
      this.weather.set({ temperature: Math.round(data.current.temperature_2m), code: data.current.weather_code });
    } catch (err) {
      console.error('Weather fetch failed', err);
    }
  }
}
