import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PLAYING, SONG, SPEAKER, provideTestBackend } from '../testing/test-helpers';
import { COMMAND_REFRESH_MS, Playback, SpotifyService, SpotifyStatus } from './spotify.service';

const PAUSED: Playback = { ...PLAYING, isPlaying: false };
const NEXT_SONG: Playback = { ...PLAYING, progressMs: 0, item: { ...SONG, name: 'Evening Song' } };

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

  async function load(playback: Playback | null = PLAYING) {
    const loading = service.load();
    http.expectOne('/api/spotify').flush({ connected: true, playback });
    await loading;
  }

  /** Lets the command's read-back happen, and answers it. */
  async function readBack(playback: Playback | null = PLAYING) {
    vi.advanceTimersByTime(COMMAND_REFRESH_MS);
    http.expectOne('/api/spotify').flush({ connected: true, playback } satisfies SpotifyStatus);
    await Promise.resolve();
  }

  it('loads what is playing, and when it asked', async () => {
    // Act
    await load();

    // Assert
    expect(service.status()).toEqual({ connected: true, playback: PLAYING });
    expect(service.readAt()).toBe(new Date(2026, 9, 29, 18, 0).getTime());
  });

  it('knows Spotify is not set up from a 503', async () => {
    // Arrange
    await load();

    // Act
    const loading = service.load();
    http.expectOne('/api/spotify').flush(null, { status: 503, statusText: 'Service Unavailable' });
    await loading;

    // Assert
    expect(service.status()).toBeNull();
  });

  it('keeps the last state when Spotify fails, and logs why', async () => {
    // Arrange
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await load();

    // Act
    const loading = service.load();
    http.expectOne('/api/spotify').flush('down', { status: 502, statusText: 'Bad Gateway' });
    await loading;

    // Assert
    expect(service.status()?.playback).toEqual(PLAYING);
    expect(log).toHaveBeenCalledWith('Spotify fetch failed', expect.anything());
  });

  it('shows a pause straight away, then reads back the real state', async () => {
    // Arrange
    await load();

    // Act
    const pausing = service.pause();
    const shown = service.status()?.playback?.isPlaying;
    http.expectOne({ method: 'POST', url: '/api/spotify/pause' }).flush(null);
    await pausing;
    await readBack({ ...PAUSED, progressMs: 62000 });

    // Assert
    expect(shown).toBe(false);
    expect(service.status()?.playback).toEqual({ ...PAUSED, progressMs: 62000 });
  });

  it('shows a resume straight away, then reads back the real state', async () => {
    // Arrange
    await load(PAUSED);

    // Act
    const resuming = service.play();
    const shown = service.status()?.playback?.isPlaying;
    const req = http.expectOne({ method: 'POST', url: '/api/spotify/play' });
    req.flush(null);
    await resuming;
    await readBack();

    // Assert
    expect(shown).toBe(true);
    expect(req.request.body).toEqual({ contextUri: undefined, deviceId: undefined });
    expect(service.status()?.playback).toEqual(PLAYING);
  });

  it('plays a playlist on a device, waiting for Spotify to say what plays', async () => {
    // Arrange
    await load(PAUSED);

    // Act
    const playing = service.play('spotify:playlist:1a2b3c', 'phone');
    const shown = service.status()?.playback;
    const req = http.expectOne({ method: 'POST', url: '/api/spotify/play' });
    req.flush(null);
    await playing;
    await readBack(NEXT_SONG);

    // Assert
    expect(req.request.body).toEqual({ contextUri: 'spotify:playlist:1a2b3c', deviceId: 'phone' });
    expect(shown).toEqual(PAUSED);
    expect(service.status()?.playback).toEqual(NEXT_SONG);
  });

  it.each(['next', 'previous'] as const)('skips to the %s item, then reads it back', async (to) => {
    // Arrange
    await load();

    // Act
    const skipping = service[to]();
    http.expectOne({ method: 'POST', url: `/api/spotify/${to}` }).flush(null);
    await skipping;
    await readBack(NEXT_SONG);

    // Assert
    expect(service.status()?.playback?.item?.name).toBe('Evening Song');
    expect(service.error()).toBeNull();
  });

  it.each([
    [50, 50],
    [105, 100],
    [-5, 0],
  ])('sets the volume asked as %i to %i, showing it straight away', async (asked, sent) => {
    // Arrange
    await load();

    // Act
    const changing = service.setVolume(asked);
    const shown = service.status()?.playback?.device?.volume;
    const req = http.expectOne({ method: 'PUT', url: '/api/spotify/volume' });
    req.flush(null);
    await changing;
    await readBack({ ...PLAYING, device: { ...SPEAKER, volume: sent } });

    // Assert
    expect(req.request.body).toEqual({ percent: sent });
    expect(shown).toBe(sent);
    expect(service.status()?.playback?.device?.volume).toBe(sent);
  });

  it('sends the volume even before anything has loaded', async () => {
    // Act
    const changing = service.setVolume(50);
    const req = http.expectOne({ method: 'PUT', url: '/api/spotify/volume' });
    req.flush(null);
    await changing;
    const shown = service.status();
    await readBack();

    // Assert
    expect(req.request.body).toEqual({ percent: 50 });
    expect(shown).toBeNull();
    expect(service.status()?.playback).toEqual(PLAYING);
  });

  it('moves playback to another device', async () => {
    // Arrange
    await load();
    const phone = { id: 'phone', name: 'Phone', type: 'Smartphone', isActive: true, volume: null };

    // Act
    const moving = service.transfer('phone');
    const req = http.expectOne({ method: 'PUT', url: '/api/spotify/device' });
    req.flush(null);
    await moving;
    await readBack({ ...PLAYING, device: phone });

    // Assert
    expect(req.request.body).toEqual({ id: 'phone' });
    expect(service.status()?.playback?.device).toEqual(phone);
  });

  it.each([
    ['spotifyNoDevice', 'errors.spotifyNoDevice'],
    ['spotifyRefused', 'errors.spotifyRefused'],
    ['somethingNew', 'music.failed'],
  ])('explains a %s refusal', async (code, key) => {
    // Arrange
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Act
    const skipping = service.next();
    http
      .expectOne('/api/spotify/next')
      .flush({ code, message: 'No.' }, { status: 409, statusText: 'Conflict' });
    await skipping;
    await readBack();

    // Assert
    expect(service.error()).toEqual({ key });
    expect(log).toHaveBeenCalledWith('Spotify command failed', expect.anything());
  });

  it('forgets the last refusal on the next command', async () => {
    // Arrange
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refused = service.next();
    http
      .expectOne('/api/spotify/next')
      .flush({ code: 'spotifyRefused', message: 'No.' }, { status: 409, statusText: 'Conflict' });
    await refused;
    await readBack();

    // Act
    const again = service.next();
    http.expectOne('/api/spotify/next').flush(null);
    await again;
    await readBack();

    // Assert
    expect(service.error()).toBeNull();
  });

  it('says a command failed when Spotify is unreachable', async () => {
    // Arrange
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Act
    const pausing = service.pause();
    http.expectOne('/api/spotify/pause').flush('down', { status: 502, statusText: 'Bad Gateway' });
    await pausing;
    await readBack();

    // Assert
    expect(service.error()).toEqual({ key: 'music.failed' });
  });

  it('lists devices and playlists', async () => {
    // Arrange
    const list = [{ uri: 'spotify:playlist:1a2b3c', name: 'Dinner', image: null }];

    // Act
    const devices = service.devices();
    http.expectOne('/api/spotify/devices').flush([SPEAKER]);
    const playlists = service.playlists();
    http.expectOne('/api/spotify/playlists').flush(list);

    // Assert
    expect(await devices).toEqual([SPEAKER]);
    expect(await playlists).toEqual(list);
  });

  it('disconnects the account, then reloads', async () => {
    // Arrange
    await load();

    // Act
    const disconnecting = service.disconnect();
    http.expectOne({ method: 'DELETE', url: '/api/spotify/login' }).flush(null);
    await Promise.resolve();
    http.expectOne('/api/spotify').flush({ connected: false, playback: null });
    await disconnecting;

    // Assert
    expect(service.status()).toEqual({ connected: false, playback: null });
  });
});
