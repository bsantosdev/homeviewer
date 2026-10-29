import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Text } from './i18n';

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
  /** A translation key, or empty for a code Open-Meteo hasn't documented. */
  description: string;
  condition: WeatherCondition;
  isDay: boolean;
  /** When rain starts or stops in the next hours, e.g. "Rain from 15:00", or null if it stays dry. */
  rain: Text | null;
  /** The next days, after today. */
  days: DayForecast[];
  /** The UV index now, or null while it's too low to matter, e.g. at night. */
  uv: Reading | null;
  /** The European air quality index now, or null if the air quality service couldn't say. */
  air: Reading | null;
}

export interface Reading {
  value: number;
  /** A translation key for how good or bad the value is. */
  level: string;
}

export interface DayForecast {
  /** Local midnight. */
  date: Date;
  min: number;
  max: number;
  condition: WeatherCondition;
}

interface OpenMeteoResponse {
  current: { temperature_2m: number; weather_code: number; is_day: 0 | 1; uv_index: number | null };
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

interface AirQualityResponse {
  current: { european_aqi: number | null };
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

// WMO weather codes used by Open-Meteo, with the translation key of each.
const WEATHER_CODES: Record<number, [string, WeatherCondition] | undefined> = {
  0: ['weather.clearSky', 'clear'],
  1: ['weather.mainlyClear', 'partly-cloudy'],
  2: ['weather.partlyCloudy', 'partly-cloudy'],
  3: ['weather.overcast', 'cloudy'],
  45: ['weather.fog', 'fog'],
  48: ['weather.rimeFog', 'fog'],
  51: ['weather.lightDrizzle', 'drizzle'],
  53: ['weather.drizzle', 'drizzle'],
  55: ['weather.heavyDrizzle', 'drizzle'],
  56: ['weather.freezingDrizzle', 'drizzle'],
  57: ['weather.freezingDrizzle', 'drizzle'],
  61: ['weather.lightRain', 'rain'],
  63: ['weather.rain', 'rain'],
  65: ['weather.heavyRain', 'rain'],
  66: ['weather.freezingRain', 'rain'],
  67: ['weather.freezingRain', 'rain'],
  71: ['weather.lightSnow', 'snow'],
  73: ['weather.snow', 'snow'],
  75: ['weather.heavySnow', 'snow'],
  77: ['weather.snowGrains', 'snow'],
  80: ['weather.rainShowers', 'showers'],
  81: ['weather.rainShowers', 'showers'],
  82: ['weather.violentShowers', 'showers'],
  85: ['weather.snowShowers', 'snow'],
  86: ['weather.heavySnowShowers', 'snow'],
  95: ['weather.thunderstorm', 'thunderstorm'],
  96: ['weather.thunderstormHail', 'thunderstorm'],
  99: ['weather.thunderstormHail', 'thunderstorm'],
};

// Where each level starts, lowest first: the WHO's UV index bands and the European air quality
// index bands.
const UV_LEVELS: [number, string][] = [
  [0, 'weather.uvLevels.low'],
  [3, 'weather.uvLevels.moderate'],
  [6, 'weather.uvLevels.high'],
  [8, 'weather.uvLevels.veryHigh'],
  [11, 'weather.uvLevels.extreme'],
];
const AIR_LEVELS: [number, string][] = [
  [0, 'weather.airLevels.good'],
  [20, 'weather.airLevels.fair'],
  [40, 'weather.airLevels.moderate'],
  [60, 'weather.airLevels.poor'],
  [80, 'weather.airLevels.veryPoor'],
  [100, 'weather.airLevels.extremelyPoor'],
];

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
export const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

@Injectable({ providedIn: 'root' })
export class WeatherService {
  private readonly http = inject(HttpClient);

  async current(latitude: number, longitude: number): Promise<Weather> {
    const [data, aqi] = await Promise.all([
      firstValueFrom(
        this.http.get<OpenMeteoResponse>(OPEN_METEO_URL, {
          params: {
            latitude,
            longitude,
            current: 'temperature_2m,weather_code,is_day,uv_index',
            hourly: 'precipitation_probability,precipitation',
            daily: 'weather_code,temperature_2m_min,temperature_2m_max',
            timezone: 'auto',
            forecast_days: FORECAST_DAYS + 1,
            forecast_hours: RAIN_HOURS,
          },
        }),
      ),
      this.airQuality(latitude, longitude),
    ]);
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
      uv: uvReading(data.current.uv_index),
      air: aqi === null ? null : reading(aqi, AIR_LEVELS),
    };
  }

  /** A separate service, so the weather still shows if it fails. */
  private async airQuality(latitude: number, longitude: number): Promise<number | null> {
    try {
      const data = await firstValueFrom(
        this.http.get<AirQualityResponse>(AIR_QUALITY_URL, {
          params: { latitude, longitude, current: 'european_aqi' },
        }),
      );
      return data.current.european_aqi;
    } catch (err: unknown) {
      console.error('Air quality fetch failed', err);
      return null;
    }
  }
}

/** A UV index that rounds to 0 isn't worth showing. */
function uvReading(index: number | null): Reading | null {
  return index === null || Math.round(index) === 0 ? null : reading(index, UV_LEVELS);
}

/** Rounds the value and finds the highest level it reaches. */
function reading(value: number, levels: [number, string][]): Reading {
  const rounded = Math.round(value);
  let level = levels[0][1];
  for (const [from, key] of levels) if (rounded >= from) level = key;
  return { value: rounded, level };
}

function describe(code: number): [string, WeatherCondition] {
  return WEATHER_CODES[code] ?? ['', 'unknown'];
}

/** Likely enough to bother with: a better-than-even chance, or enough to get wet anyway. */
function isWet(probability: number | null, millimetres: number | null): boolean {
  return (probability ?? 0) >= 50 || (millimetres ?? 0) >= 0.5;
}

/** Says when the weather turns, from hours that start with the current one. */
export function rainNote(hours: { time: string; wet: boolean }[]): Text | null {
  if (!hours.length) return null;
  const turn = hours.find((hour) => hour.wet !== hours[0].wet);
  if (hours[0].wet)
    return turn
      ? { key: 'weather.rainUntil', params: { time: turn.time } }
      : { key: 'weather.rainAhead' };
  return turn ? { key: 'weather.rainFrom', params: { time: turn.time } } : null;
}

/** "2026-10-23" as local midnight; `new Date("2026-10-23")` would be UTC midnight. */
function localDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}
