import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface Weather {
  temperature: number;
  description: string;
}

interface OpenMeteoResponse {
  current: { temperature_2m: number; weather_code: number };
}

// WMO weather codes used by Open-Meteo.
const WEATHER_DESCRIPTIONS: Record<number, string | undefined> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Violent showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm, hail',
  99: 'Thunderstorm, hail',
};

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

@Injectable({ providedIn: 'root' })
export class WeatherService {
  private readonly http = inject(HttpClient);

  async current(latitude: number, longitude: number): Promise<Weather> {
    const data = await firstValueFrom(
      this.http.get<OpenMeteoResponse>(OPEN_METEO_URL, {
        params: { latitude, longitude, current: 'temperature_2m,weather_code' },
      }),
    );
    return {
      temperature: Math.round(data.current.temperature_2m),
      description: WEATHER_DESCRIPTIONS[data.current.weather_code] ?? '',
    };
  }
}
