import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type WeatherCondition =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'showers'
  | 'snow'
  | 'thunderstorm'
  | 'unknown';

export interface Weather {
  temperature: number;
  description: string;
  condition: WeatherCondition;
  isDay: boolean;
}

interface OpenMeteoResponse {
  current: { temperature_2m: number; weather_code: number; is_day: 0 | 1 };
}

// WMO weather codes used by Open-Meteo.
const WEATHER_CODES: Record<number, [string, WeatherCondition] | undefined> = {
  0: ['Clear sky', 'clear'],
  1: ['Mainly clear', 'partly-cloudy'],
  2: ['Partly cloudy', 'partly-cloudy'],
  3: ['Overcast', 'cloudy'],
  45: ['Fog', 'fog'],
  48: ['Rime fog', 'fog'],
  51: ['Light drizzle', 'drizzle'],
  53: ['Drizzle', 'drizzle'],
  55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'],
  57: ['Freezing drizzle', 'drizzle'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'],
  67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Rain showers', 'showers'],
  81: ['Rain showers', 'showers'],
  82: ['Violent showers', 'showers'],
  85: ['Snow showers', 'snow'],
  86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'thunderstorm'],
  96: ['Thunderstorm, hail', 'thunderstorm'],
  99: ['Thunderstorm, hail', 'thunderstorm'],
};

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

@Injectable({ providedIn: 'root' })
export class WeatherService {
  private readonly http = inject(HttpClient);

  async current(latitude: number, longitude: number): Promise<Weather> {
    const data = await firstValueFrom(
      this.http.get<OpenMeteoResponse>(OPEN_METEO_URL, {
        params: { latitude, longitude, current: 'temperature_2m,weather_code,is_day' },
      }),
    );
    const [description, condition] = WEATHER_CODES[data.current.weather_code] ?? ['', 'unknown'];
    return {
      temperature: Math.round(data.current.temperature_2m),
      description,
      condition,
      isDay: data.current.is_day === 1,
    };
  }
}
