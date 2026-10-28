import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { AIR_QUALITY_URL, OPEN_METEO_URL, WeatherService, rainNote } from './weather.service';

type Hourly = Record<'precipitation_probability' | 'precipitation', (number | null)[]> & {
  time: string[];
};
import { english, provideTestBackend } from '../testing/test-helpers';

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

  const DRY_HOURS: Hourly = {
    time: ['2026-10-23T14:00', '2026-10-23T15:00', '2026-10-23T16:00'],
    precipitation_probability: [10, 20, 0],
    precipitation: [0, 0, 0],
  };

  function respond(
    weatherCode: number,
    isDay: 0 | 1 = 1,
    hourly = DRY_HOURS,
    uvIndex: number | null = 4.6,
  ): void {
    const req = http.expectOne((r) => r.url === OPEN_METEO_URL);
    expect(req.request.params.get('latitude')).toBe('38.72');
    expect(req.request.params.get('longitude')).toBe('-9.14');
    expect(req.request.params.get('current')).toBe('temperature_2m,weather_code,is_day,uv_index');
    expect(req.request.params.get('hourly')).toBe('precipitation_probability,precipitation');
    expect(req.request.params.get('daily')).toBe(
      'weather_code,temperature_2m_min,temperature_2m_max',
    );
    expect(req.request.params.get('timezone')).toBe('auto');
    expect(req.request.params.get('forecast_days')).toBe('5');
    expect(req.request.params.get('forecast_hours')).toBe('12');
    req.flush({
      current: {
        temperature_2m: 13.6,
        weather_code: weatherCode,
        is_day: isDay,
        uv_index: uvIndex,
      },
      hourly,
      daily: {
        time: ['2026-10-23', '2026-10-24', '2026-10-25'],
        weather_code: [3, 61, 42],
        temperature_2m_min: [9.4, 11.2, 8],
        temperature_2m_max: [18.5, 16.6, 20],
      },
    });
  }

  function respondAir(aqi: number | null = 24.4): void {
    const req = http.expectOne((r) => r.url === AIR_QUALITY_URL);
    expect(req.request.params.get('latitude')).toBe('38.72');
    expect(req.request.params.get('longitude')).toBe('-9.14');
    expect(req.request.params.get('current')).toBe('european_aqi');
    req.flush({ current: { european_aqi: aqi } });
  }

  it("returns the rounded temperature, today's range, description and condition", async () => {
    const weather = service.current(38.72, -9.14);
    respond(3);
    respondAir();
    expect(await weather).toMatchObject({
      temperature: 14,
      min: 9,
      max: 19,
      description: 'weather.overcast',
      condition: 'cloudy',
      isDay: true,
      rain: null,
    });
  });

  it('forecasts the days after today', async () => {
    const weather = service.current(38.72, -9.14);
    respond(3);
    respondAir();
    expect((await weather).days).toEqual([
      { date: new Date(2026, 9, 24), min: 11, max: 17, condition: 'rain' },
      { date: new Date(2026, 9, 25), min: 8, max: 20, condition: 'unknown' },
    ]);
  });

  it('says when rain is likely, by chance or by amount', async () => {
    const weather = service.current(38.72, -9.14);
    respond(3, 1, {
      time: ['2026-10-23T14:00', '2026-10-23T15:00', '2026-10-23T16:00'],
      precipitation_probability: [null, 30, 70],
      precipitation: [null, 0.6, 0],
    });
    respondAir();
    expect((await weather).rain).toEqual({ key: 'weather.rainFrom', params: { time: '15:00' } });
  });

  it('reports night time', async () => {
    const weather = service.current(38.72, -9.14);
    respond(0, 0);
    respondAir();
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
    respondAir();
    expect((await weather).condition).toBe(condition);
  });

  it('reads the UV index and air quality, with how good or bad they are', async () => {
    const weather = service.current(38.72, -9.14);
    respond(0);
    respondAir();
    expect(await weather).toMatchObject({
      uv: { value: 5, level: 'weather.uvLevels.moderate' },
      air: { value: 24, level: 'weather.airLevels.fair' },
    });
  });

  it.each([
    [0.4, null],
    [null, null],
    [2.6, 'weather.uvLevels.moderate'],
    [7, 'weather.uvLevels.high'],
    [8, 'weather.uvLevels.veryHigh'],
    [12, 'weather.uvLevels.extreme'],
  ])('rates UV index %s as %s', async (index, level) => {
    const weather = service.current(38.72, -9.14);
    respond(0, 1, DRY_HOURS, index);
    respondAir();
    expect((await weather).uv?.level ?? null).toBe(level);
  });

  it.each([
    [10, 'weather.airLevels.good'],
    [45, 'weather.airLevels.moderate'],
    [60, 'weather.airLevels.poor'],
    [99, 'weather.airLevels.veryPoor'],
    [130, 'weather.airLevels.extremelyPoor'],
  ])('rates air quality index %i as %s', async (aqi, level) => {
    const weather = service.current(38.72, -9.14);
    respond(0);
    respondAir(aqi);
    expect((await weather).air?.level).toBe(level);
  });

  it('leaves out air quality when the service has no value', async () => {
    const weather = service.current(38.72, -9.14);
    respond(0);
    respondAir(null);
    expect((await weather).air).toBeNull();
  });

  it('still gives the weather when the air quality service fails, and logs why', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const weather = service.current(38.72, -9.14);
    respond(3);
    http
      .expectOne((r) => r.url === AIR_QUALITY_URL)
      .flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(await weather).toMatchObject({ description: 'weather.overcast', air: null });
    expect(log).toHaveBeenCalledWith('Air quality fetch failed', expect.anything());
  });

  it('marks unknown weather codes as unknown with no description', async () => {
    const weather = service.current(38.72, -9.14);
    respond(42);
    respondAir();
    expect(await weather).toMatchObject({ description: '', condition: 'unknown' });
  });
});

describe('rainNote', () => {
  const at = (time: string, wet: boolean) => ({ time, wet });
  const note = (hours: { time: string; wet: boolean }[]) => {
    const text = rainNote(hours);
    return text && english(text);
  };

  it('says when rain starts', () => {
    expect(note([at('14:00', false), at('15:00', true)])).toBe('Rain from 15:00');
  });

  it('says when rain stops', () => {
    expect(note([at('14:00', true), at('15:00', true), at('16:00', false)])).toBe(
      'Rain until 16:00',
    );
  });

  it('says when rain keeps on', () => {
    expect(note([at('14:00', true), at('15:00', true)])).toBe('Rain for the next hours');
  });

  it('says nothing when it stays dry, or without hours', () => {
    expect(rainNote([at('14:00', false)])).toBeNull();
    expect(rainNote([])).toBeNull();
  });
});
