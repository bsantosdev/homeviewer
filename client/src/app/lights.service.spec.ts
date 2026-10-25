import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { COLOR_REFRESH_MS, LightsService, Room, Scene } from './lights.service';
import { provideTestBackend } from '../testing/test-helpers';

const LIVING: Room = {
  id: 'living-id',
  name: 'Living room',
  on: true,
  brightness: 60,
  colors: ['#ff942c'],
  temperature: 2242,
  canColor: true,
};
const BEDROOM: Room = {
  id: 'bedroom-id',
  name: 'Bedroom',
  on: false,
  brightness: 0,
  colors: [],
  temperature: 2700,
  canColor: false,
};

describe('LightsService', () => {
  let service: LightsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideTestBackend() });
    service = TestBed.inject(LightsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  async function load(respond: (req: ReturnType<HttpTestingController['expectOne']>) => void) {
    const loading = service.load();
    respond(http.expectOne('/api/rooms'));
    await loading;
  }

  async function loadHome(): Promise<void> {
    await load((req) => {
      req.flush([LIVING, BEDROOM]);
    });
  }

  it('has no rooms until loaded', () => {
    expect(service.rooms()).toBeNull();
  });

  it('loads the rooms', async () => {
    await loadHome();
    expect(service.rooms()).toEqual([LIVING, BEDROOM]);
  });

  it('has no rooms when the server has no Hue bridge', async () => {
    await loadHome();
    await load((req) => {
      req.flush('No Hue bridge is configured.', { status: 503, statusText: 'Service Unavailable' });
    });
    expect(service.rooms()).toBeNull();
  });

  it('keeps the last known rooms when the bridge does not answer', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await loadHome();
    await load((req) => {
      req.flush('Couldn’t reach the Hue bridge.', { status: 502, statusText: 'Bad Gateway' });
    });

    expect(service.rooms()).toEqual([LIVING, BEDROOM]);
    expect(log).toHaveBeenCalledWith('Lights fetch failed', expect.anything());
  });

  it('previews a change to one room without sending it', async () => {
    await loadHome();
    service.preview(BEDROOM.id, { on: true, brightness: 30 });
    expect(service.rooms()).toEqual([LIVING, { ...BEDROOM, on: true, brightness: 30 }]);
  });

  it('previews a colour as the room showing just that colour', async () => {
    await loadHome();
    service.preview(LIVING.id, { on: true, color: '#007aff' });
    expect(service.rooms()?.[0]).toEqual({ ...LIVING, colors: ['#007aff'] });
  });

  it('ignores previews before the rooms are loaded', () => {
    service.preview(LIVING.id, { on: false });
    expect(service.rooms()).toBeNull();
  });

  it('shows a change straight away and sends it to the server', async () => {
    await loadHome();

    const changing = service.change(LIVING.id, { on: false });
    expect(service.rooms()?.[0].on).toBe(false);
    const req = http.expectOne({ method: 'PUT', url: '/api/rooms/living-id' });
    expect(req.request.body).toEqual({ on: false });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await changing;

    expect(service.rooms()?.[0].on).toBe(false);
  });

  it('reloads the real state when a change fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await loadHome();

    const changing = service.change(LIVING.id, { on: false });
    http
      .expectOne({ method: 'PUT', url: '/api/rooms/living-id' })
      .flush('Unreachable', { status: 502, statusText: 'Bad Gateway' });
    // Let the failed request settle so the reload starts.
    await new Promise((resolve) => setTimeout(resolve));
    http.expectOne('/api/rooms').flush([LIVING, BEDROOM]);
    await changing;

    expect(log).toHaveBeenCalledWith('Light change failed', expect.anything());
    expect(service.rooms()).toEqual([LIVING, BEDROOM]);
  });

  it('fetches a room’s scenes', async () => {
    const scenes: Scene[] = [{ id: 'relax-id', name: 'Relax', colors: ['#ff942c'] }];

    const loading = service.scenes(LIVING.id);
    http.expectOne('/api/rooms/living-id/scenes').flush(scenes);

    expect(await loading).toEqual(scenes);
  });

  describe('reading colours back', () => {
    beforeEach(() => {
      // Only the delayed refresh; HttpClient and Angular keep real timers.
      vi.useFakeTimers({ toFake: ['setTimeout'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function sendChange(change: Parameters<LightsService['change']>[1]): Promise<void> {
      const changing = service.change(LIVING.id, change);
      http.expectOne({ method: 'PUT', url: '/api/rooms/living-id' }).flush(null);
      await changing;
    }

    it.each([[{ temperature: 4000 }], [{ color: '#007aff' }]])(
      'reloads the rooms shortly after setting %o',
      async (change) => {
        await loadHome();
        await sendChange(change);
        http.expectNone('/api/rooms');

        vi.advanceTimersByTime(COLOR_REFRESH_MS);
        http.expectOne('/api/rooms').flush([LIVING, BEDROOM]);
      },
    );

    it('does not reload after switching or dimming', async () => {
      await loadHome();
      await sendChange({ on: true, brightness: 40 });

      vi.advanceTimersByTime(COLOR_REFRESH_MS);
      http.expectNone('/api/rooms');
    });

    it('recalls a scene, then reloads the rooms', async () => {
      const recalling = service.recall('relax-id');
      const req = http.expectOne({ method: 'POST', url: '/api/scenes/relax-id/recall' });
      req.flush(null);
      await recalling;

      vi.advanceTimersByTime(COLOR_REFRESH_MS);
      http.expectOne('/api/rooms').flush([LIVING]);
    });

    it('logs a scene that fails to recall', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const recalling = service.recall('relax-id');
      http
        .expectOne('/api/scenes/relax-id/recall')
        .flush('Unreachable', { status: 502, statusText: 'Bad Gateway' });
      await recalling;

      expect(log).toHaveBeenCalledWith('Scene recall failed', expect.anything());
      vi.advanceTimersByTime(COLOR_REFRESH_MS);
      http.expectNone('/api/rooms');
    });
  });
});
