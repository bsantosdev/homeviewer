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

  function respond(weatherCode: number): void {
    const req = http.expectOne((r) => r.url === OPEN_METEO_URL);
    expect(req.request.params.get('latitude')).toBe('38.72');
    expect(req.request.params.get('longitude')).toBe('-9.14');
    expect(req.request.params.get('current')).toBe('temperature_2m,weather_code');
    req.flush({ current: { temperature_2m: 13.6, weather_code: weatherCode } });
  }

  it('returns the rounded temperature and a description', async () => {
    const weather = service.current(38.72, -9.14);
    respond(3);
    expect(await weather).toEqual({ temperature: 14, description: 'Overcast' });
  });

  it('uses an empty description for unknown weather codes', async () => {
    const weather = service.current(38.72, -9.14);
    respond(42);
    expect(await weather).toEqual({ temperature: 14, description: '' });
  });
});
