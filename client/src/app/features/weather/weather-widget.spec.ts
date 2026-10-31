import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { WeatherWidget } from './weather-widget';
import { Weather, WeatherService } from './data-access/weather.service';
import { TEST_SETTINGS, provideTestBackend, query, text } from '../../../testing/test-helpers';

const MAINLY_CLEAR: Weather = {
  temperature: 21,
  min: 14,
  max: 24,
  description: 'weather.mainlyClear',
  condition: 'partly-cloudy',
  isDay: true,
  rain: null,
  days: [],
  uv: null,
  air: null,
};

describe('WeatherWidget', () => {
  let fixture: ComponentFixture<WeatherWidget>;
  let el: HTMLElement;
  let weather: WritableSignal<Weather | null>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideTestBackend() });
    fixture = TestBed.createComponent(WeatherWidget);
    el = fixture.nativeElement as HTMLElement;
    TestBed.inject(HttpTestingController).expectOne('/api/settings').flush(TEST_SETTINGS);
    weather = TestBed.inject(WeatherService).weather;
  });

  async function show(value: Weather): Promise<void> {
    weather.set(value);
    await fixture.whenStable();
  }

  it('keeps its space empty until the weather arrives', async () => {
    // Act
    await fixture.whenStable();

    // Assert
    expect(el.querySelector('.weather')).toBeNull();
    expect(el.classList).toContain('flex-1');
  });

  it('shows the temperature, today’s range, the conditions and the place', async () => {
    // Act
    await show(MAINLY_CLEAR);

    // Assert
    expect(text(el, '.weather-temp')).toBe('21°');
    expect(text(el, '.weather-range')).toBe('↓14° ↑24°');
    expect(text(el, '.weather-summary')).toBe('Mainly clear');
    expect(text(el, '.weather-place')).toBe('Lisbon');
  });

  it('shows an icon for the weather conditions, and changes it with them', async () => {
    // Arrange
    await show(MAINLY_CLEAR);
    const icon = query(el, '.weather-icon');
    const before = query(icon, 'svg', SVGElement).innerHTML;

    // Act
    await show({ ...MAINLY_CLEAR, condition: 'snow' });

    // Assert
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(query(el, '.weather-icon svg', SVGElement).innerHTML).not.toBe(before);
  });

  it('leaves out the icon and summary for unknown conditions', async () => {
    // Act
    await show({ ...MAINLY_CLEAR, description: '', condition: 'unknown' });

    // Assert
    expect(el.querySelector('.weather-icon')).toBeNull();
    expect(text(el, '.weather-summary')).toBe('');
    expect(text(el, '.weather-temp')).toBe('21°');
  });

  it('says when rain is coming, and forecasts the next days', async () => {
    // Act
    await show({
      ...MAINLY_CLEAR,
      rain: { key: 'weather.rainFrom', params: { time: '16:00' } },
      days: [
        { date: new Date(2026, 9, 24), min: 12, max: 19, condition: 'rain' },
        { date: new Date(2026, 9, 25), min: 11, max: 20, condition: 'unknown' },
      ],
    });

    // Assert
    expect(text(el, '.weather-rain')).toBe('Rain from 16:00');
    const days = Array.from(el.querySelectorAll('.weather-day'), (d) =>
      d.textContent.replace(/\s+/g, ' ').trim(),
    );
    expect(days).toEqual(['Sat 19° 12°', 'Sun 20° 11°']);
    expect(el.querySelectorAll('.weather-day hugeicons-icon')).toHaveLength(1);
  });

  it('leaves out the rain note, forecast, UV and air without them', async () => {
    // Act
    await show(MAINLY_CLEAR);

    // Assert
    expect(el.querySelector('.weather-rain')).toBeNull();
    expect(el.querySelector('.weather-day')).toBeNull();
    expect(el.querySelector('.weather-uv')).toBeNull();
    expect(el.querySelector('.weather-air')).toBeNull();
  });

  it('shows the UV index and air quality', async () => {
    // Act
    await show({
      ...MAINLY_CLEAR,
      uv: { value: 6, level: 'weather.uvLevels.high' },
      air: { value: 24, level: 'weather.airLevels.fair' },
    });

    // Assert
    expect(text(el, '.weather-uv')).toBe('UV 6 · High');
    expect(text(el, '.weather-air')).toBe('Air: Fair');
  });

  it('shows air quality alone when the UV index is too low to matter', async () => {
    // Act
    await show({ ...MAINLY_CLEAR, air: { value: 5, level: 'weather.airLevels.good' } });

    // Assert
    expect(el.querySelector('.weather-uv')).toBeNull();
    expect(text(el, '.weather-air')).toBe('Air: Good');
  });

  it('shows the UV index alone without air quality', async () => {
    // Act
    await show({ ...MAINLY_CLEAR, uv: { value: 2, level: 'weather.uvLevels.low' } });

    // Assert
    expect(text(el, '.weather-uv')).toBe('UV 2 · Low');
    expect(el.querySelector('.weather-air')).toBeNull();
  });
});
