import {
  CloudAngledZapIcon,
  CloudDrizzleIcon,
  CloudFogIcon,
  CloudIcon,
  CloudMidRainIcon,
  CloudSnowIcon,
  Moon02Icon,
  MoonCloudAngledRainIcon,
  MoonCloudAngledZapIcon,
  MoonCloudIcon,
  Sun03Icon,
  SunCloud02Icon,
  SunCloudAngledRain02Icon,
} from '@hugeicons/core-free-icons';
import type { WeatherCondition } from './weather.service';

type Icon = typeof Sun03Icon;

// Day and night icons per condition; conditions without a moon variant share one icon.
const ICONS: Record<Exclude<WeatherCondition, 'unknown'>, { day: Icon; night: Icon }> = {
  clear: { day: Sun03Icon, night: Moon02Icon },
  'partly-cloudy': { day: SunCloud02Icon, night: MoonCloudIcon },
  cloudy: { day: CloudIcon, night: CloudIcon },
  fog: { day: CloudFogIcon, night: CloudFogIcon },
  drizzle: { day: CloudDrizzleIcon, night: CloudDrizzleIcon },
  rain: { day: CloudMidRainIcon, night: CloudMidRainIcon },
  showers: { day: SunCloudAngledRain02Icon, night: MoonCloudAngledRainIcon },
  snow: { day: CloudSnowIcon, night: CloudSnowIcon },
  thunderstorm: { day: CloudAngledZapIcon, night: MoonCloudAngledZapIcon },
};

/** The icon for a weather condition, or null when the condition is unknown. */
export function weatherIconFor(condition: WeatherCondition, isDay: boolean): Icon | null {
  if (condition === 'unknown') return null;
  const icons = ICONS[condition];
  return isDay ? icons.day : icons.night;
}
