import {
  CloudFogIcon,
  CloudIcon,
  Moon02Icon,
  MoonCloudAngledZapIcon,
  Sun03Icon,
  SunCloud02Icon,
} from '@hugeicons/core-free-icons';
import { weatherIconFor } from './weather-icons';
import type { WeatherCondition } from './weather.service';

describe('weatherIconFor', () => {
  it('uses the sun by day and the moon by night when clear', () => {
    expect(weatherIconFor('clear', true)).toBe(Sun03Icon);
    expect(weatherIconFor('clear', false)).toBe(Moon02Icon);
  });

  it('uses night variants where they exist', () => {
    expect(weatherIconFor('partly-cloudy', true)).toBe(SunCloud02Icon);
    expect(weatherIconFor('thunderstorm', false)).toBe(MoonCloudAngledZapIcon);
  });

  it('uses the same icon day and night for conditions without a moon variant', () => {
    expect(weatherIconFor('cloudy', true)).toBe(CloudIcon);
    expect(weatherIconFor('cloudy', false)).toBe(CloudIcon);
    expect(weatherIconFor('fog', false)).toBe(CloudFogIcon);
  });

  it('has a day and a night icon for every known condition', () => {
    const conditions: WeatherCondition[] = [
      'clear',
      'partly-cloudy',
      'cloudy',
      'fog',
      'drizzle',
      'rain',
      'showers',
      'snow',
      'thunderstorm',
    ];
    for (const condition of conditions) {
      expect(weatherIconFor(condition, true)).toBeTruthy();
      expect(weatherIconFor(condition, false)).toBeTruthy();
    }
  });

  it('has no icon for unknown weather', () => {
    expect(weatherIconFor('unknown', true)).toBeNull();
  });
});
