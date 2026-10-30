import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PLAYING, provideTestBackend } from '../testing/test-helpers';
import { COMMAND_REFRESH_MS, SpotifyService, SpotifyStatus } from './spotify.service';

describe('SpotifyService', () => {
  let service: SpotifyService;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 29, 18, 0));
    TestBed.configureTestingModule({ providers: provideTestBackend() });
    service = TestBed.inject(SpotifyService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  async function load(status: SpotifyStatus = { connected: true, playback: PLAYING }) {
    const loading = service.load();
    http.expectOne('/api/spotify').flush(status);
    await loading;
  }

  /** Lets the command's read-back happen, and answers it. */
  async function readBack(status: SpotifyStatus = { connected: true, playback: PLAYING }) {
    vi.advanceTimersByTime(COMMAND_REFRESH_MS);
    http.expectOne('/api/spotify').flush(status);
    await Promise.resolve();
  }

  it('loads what is playing, and when it asked', async () => {
    await load();

    expect(service.status()).toEqual({ connected: true, playback: PLAYING });
    expect(service.readAt()).toBe(new Date(2026, 9, 29, 18, 0).getTime());
  });

  it('knows Spotify is not set up from a 503', async () => {
    await load();
    const loading = service.load();
    http.expectOne('/api/spotify').flush(null, { status: 503, statusText: 'Service Unavailable' });
    await loading;

    expect(service.status()).toBeNull();
  });

  it('keeps the last state when Spotify fails, and logs why', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await load();
    const loading = service.load();
    http.expectOne('/api/spotify').flush('down', { status: 502, statusText: 'Bad Gateway' });
    await loading;

    expect(service.status()?.playback).toEqual(PLAYING);
    expect(log).toHaveBeenCalledWith('Spotify fetch failed', expect.anything());
  });

  it('pauses and resumes straight away on screen, then reads back the real state', async () => {
    await load();

    const pausing = service.pause();
    expect(service.status()?.playback?.isPlaying).toBe(false);
    http.expectOne({ method: 'POST', url: '/api/spotify/pause' }).flush(null);
    await pausing;
    await readBack({ connected: true, playback: { ...PLAYING, isPlaying: false } });

    const playing = service.play();
    expect(service.status()?.playback?.isPlaying).toBe(true);
    const req = http.expectOne({ method: 'POST', url: '/api/spotify/play' });
    expect(req.request.body).toEqual({ contextUri: undefined, deviceId: undefined });
    req.flush(null);
    await playing;
    await readBack();
  });

  it('plays a playlist on a device', async () => {
    const playing = service.play('spotify:playlist:1a2b3c', 'phone');
    const req = http.expectOne({ method: 'POST', url: '/api/spotify/play' });
    expect(req.request.body).toEqual({ contextUri: 'spotify:playlist:1a2b3c', deviceId: 'phone' });
    req.flush(null);
    await playing;
    await readBack();
  });

  it('skips forwards and back', async () => {
    const next = service.next();
    http.expectOne({ method: 'POST', url: '/api/spotify/next' }).flush(null);
    await next;
    const previous = service.previous();
    http.expectOne({ method: 'POST', url: '/api/spotify/previous' }).flush(null);
    await previous;
    vi.advanceTimersByTime(COMMAND_REFRESH_MS);
    for (const req of http.match('/api/spotify')) req.flush({ connected: true, playback: PLAYING });
  });

  it('changes the volume within 0 to 100, showing it straight away', async () => {
    await load();

    const louder = service.setVolume(105);
    expect(service.status()?.playback?.device?.volume).toBe(100);
    const up = http.expectOne({ method: 'PUT', url: '/api/spotify/volume' });
    expect(up.request.body).toEqual({ percent: 100 });
    up.flush(null);
    await louder;
    const quieter = service.setVolume(-5);
    const down = http.expectOne({ method: 'PUT', url: '/api/spotify/volume' });
    expect(down.request.body).toEqual({ percent: 0 });
    down.flush(null);
    await quieter;
    vi.advanceTimersByTime(COMMAND_REFRESH_MS);
    for (const req of http.match('/api/spotify')) req.flush({ connected: true, playback: PLAYING });
  });

  it('sends the volume even before anything has loaded', async () => {
    const change = service.setVolume(50);
    http.expectOne({ method: 'PUT', url: '/api/spotify/volume' }).flush(null);
    await change;
    expect(service.status()).toBeNull();
    await readBack();
  });

  it('moves playback to another device', async () => {
    const moving = service.transfer('phone');
    const req = http.expectOne({ method: 'PUT', url: '/api/spotify/device' });
    expect(req.request.body).toEqual({ id: 'phone' });
    req.flush(null);
    await moving;
    await readBack();
  });

  it.each([
    ['spotifyNoDevice', 'errors.spotifyNoDevice'],
    ['spotifyRefused', 'errors.spotifyRefused'],
    ['somethingNew', 'music.failed'],
  ])('explains a %s refusal, until the next command', async (code, key) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const next = service.next();
    http
      .expectOne('/api/spotify/next')
      .flush({ code, message: 'No.' }, { status: 409, statusText: 'Conflict' });
    await next;
    expect(service.error()).toEqual({ key });
    await readBack();

    const again = service.next();
    expect(service.error()).toBeNull();
    http.expectOne('/api/spotify/next').flush(null);
    await again;
    await readBack();
  });

  it('says a command failed when Spotify is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pausing = service.pause();
    http.expectOne('/api/spotify/pause').flush('down', { status: 502, statusText: 'Bad Gateway' });
    await pausing;
    expect(service.error()).toEqual({ key: 'music.failed' });
    await readBack();
  });

  it('lists devices and playlists', async () => {
    const devices = service.devices();
    http.expectOne('/api/spotify/devices').flush([PLAYING.device]);
    expect(await devices).toEqual([PLAYING.device]);

    const playlists = service.playlists();
    const list = [{ uri: 'spotify:playlist:1a2b3c', name: 'Dinner', image: null }];
    http.expectOne('/api/spotify/playlists').flush(list);
    expect(await playlists).toEqual(list);
  });

  it('disconnects the account, then reloads', async () => {
    await load();
    const disconnecting = service.disconnect();
    http.expectOne({ method: 'DELETE', url: '/api/spotify/login' }).flush(null);
    await Promise.resolve();
    http.expectOne('/api/spotify').flush({ connected: false, playback: null });
    await disconnecting;

    expect(service.status()).toEqual({ connected: false, playback: null });
  });
});
