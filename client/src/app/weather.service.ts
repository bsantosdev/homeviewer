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
  /** Today's low and high, in the location's time zone. */
  min: number;
  max: number;
  description: string;
  condition: WeatherCondition;
  isDay: boolean;
  /** When rain starts or stops in the next hours, e.g. "Rain from 15:00", or null if it stays dry. */
  rain: string | null;
  /** The next days, after today. */
  days: DayForecast[];
}

export interface DayForecast {
  /** Local midnight. */
  date: Date;
  min: number;
  max: number;
  condition: WeatherCondition;
}

interface OpenMeteoResponse {
  current: { temperature_2m: number; weather_code: number; is_day: 0 | 1 };
  /** From the current hour on, in the location's time ("2026-10-23T15:00"). Gaps are null. */
  hourly: Hourly;
  /** Today first ("2026-10-23"). */
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_min: number[];
    temperature_2m_max: number[];
  };
}

interface Hourly {
  time: string[];
  precipitation_probability: (number | null)[];
  precipitation: (number | null)[];
}

/** How many days follow today in the forecast. */
export const FORECAST_DAYS = 4;
/** How far ahead to look for rain. */
export const RAIN_HOURS = 12;

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
        params: {
          latitude,
          longitude,
          current: 'temperature_2m,weather_code,is_day',
          hourly: 'precipitation_probability,precipitation',
          daily: 'weather_code,temperature_2m_min,temperature_2m_max',
          timezone: 'auto',
          forecast_days: FORECAST_DAYS + 1,
          forecast_hours: RAIN_HOURS,
        },
      }),
    );
    const [description, condition] = describe(data.current.weather_code);
    const { daily, hourly } = data;
    return {
      temperature: Math.round(data.current.temperature_2m),
      min: Math.round(daily.temperature_2m_min[0]),
      max: Math.round(daily.temperature_2m_max[0]),
      description,
      condition,
      isDay: data.current.is_day === 1,
      rain: rainNote(
        hourly.time.map((time, i) => ({
          time: time.slice(11, 16),
          wet: isWet(hourly.precipitation_probability[i], hourly.precipitation[i]),
        })),
      ),
      days: daily.time.slice(1).map((day, i) => ({
        date: localDate(day),
        min: Math.round(daily.temperature_2m_min[i + 1]),
        max: Math.round(daily.temperature_2m_max[i + 1]),
        condition: describe(daily.weather_code[i + 1])[1],
      })),
    };
  }
}

function describe(code: number): [string, WeatherCondition] {
  return WEATHER_CODES[code] ?? ['', 'unknown'];
}

/** Likely enough to bother with: a better-than-even chance, or enough to get wet anyway. */
function isWet(probability: number | null, millimetres: number | null): boolean {
  return (probability ?? 0) >= 50 || (millimetres ?? 0) >= 0.5;
}

/** Says when the weather turns, from hours that start with the current one. */
export function rainNote(hours: { time: string; wet: boolean }[]): string | null {
  if (!hours.length) return null;
  const turn = hours.find((hour) => hour.wet !== hours[0].wet);
  if (hours[0].wet) return turn ? `Rain until ${turn.time}` : 'Rain for the next hours';
  return turn ? `Rain from ${turn.time}` : null;
}

/** "2026-10-23" as local midnight; `new Date("2026-10-23")` would be UTC midnight. */
function localDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}
