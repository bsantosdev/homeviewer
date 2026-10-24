import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { OPEN_METEO_URL, WeatherService } from './weather.service';
import { provideTestBackend } from '../testing/test-helpers';

describe('WeatherService', () => {
  let service: WeatherService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideTestBackend() });
    service = TestBed.inject(WeatherService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  function respond(weatherCode: number, isDay: 0 | 1 = 1): void {
    const req = http.expectOne((r) => r.url === OPEN_METEO_URL);
    expect(req.request.params.get('latitude')).toBe('38.72');
    expect(req.request.params.get('longitude')).toBe('-9.14');
    expect(req.request.params.get('current')).toBe('temperature_2m,weather_code,is_day');
    req.flush({ current: { temperature_2m: 13.6, weather_code: weatherCode, is_day: isDay } });
  }

  it('returns the rounded temperature, description and condition', async () => {
    const weather = service.current(38.72, -9.14);
    respond(3);
    expect(await weather).toEqual({
      temperature: 14,
      description: 'Overcast',
      condition: 'cloudy',
      isDay: true,
    });
  });

  it('reports night time', async () => {
    const weather = service.current(38.72, -9.14);
    respond(0, 0);
    expect(await weather).toMatchObject({ condition: 'clear', isDay: false });
  });

  it.each([
    [45, 'fog'],
    [56, 'drizzle'],
    [66, 'rain'],
    [81, 'showers'],
    [86, 'snow'],
    [99, 'thunderstorm'],
  ])('maps weather code %i to %s', async (code, condition) => {
    const weather = service.current(38.72, -9.14);
    respond(code);
    expect((await weather).condition).toBe(condition);
  });

  it('marks unknown weather codes as unknown with no description', async () => {
    const weather = service.current(38.72, -9.14);
    respond(42);
    expect(await weather).toMatchObject({ description: '', condition: 'unknown' });
  });
});
