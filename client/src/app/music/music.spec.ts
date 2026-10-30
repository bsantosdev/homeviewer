import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LaptopIcon, SmartPhone01Icon, SpeakerIcon, Tv01Icon } from '@hugeicons/core-free-icons';
import { Text } from '../i18n';
import {
  COMMAND_REFRESH_MS,
  Playback,
  Playlist,
  SpotifyDevice,
  SpotifyService,
  SpotifyStatus,
} from '../spotify.service';
import {
  PLAYING,
  SONG,
  SPEAKER,
  button,
  provideTestBackend,
  query,
  settle,
  text,
} from '../../testing/test-helpers';
import { Music, deviceIcon, formatTime, progressOf } from './music';

const READ_AT = new Date(2026, 9, 29, 18, 0).getTime();

const DEVICES: SpotifyDevice[] = [
  { id: 'phone', name: 'Kitchen phone', type: 'Smartphone', isActive: false, volume: null },
  { id: 'speaker', name: 'Living room speaker', type: 'Speaker', isActive: true, volume: 35 },
];

const PLAYLISTS: Playlist[] = [
  { uri: 'spotify:playlist:1a2b3c', name: 'Dinner', image: 'https://mosaic.scdn.co/300/dinner' },
  { uri: 'spotify:playlist:7g8h9i', name: 'Empty', image: null },
];

describe('Music', () => {
  let fixture: ComponentFixture<Music>;
  let el: HTMLElement;
  let status: ReturnType<typeof signal<SpotifyStatus | null>>;
  let error: ReturnType<typeof signal<Text | null>>;
  let fake: {
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    next: ReturnType<typeof vi.fn>;
    previous: ReturnType<typeof vi.fn>;
    setVolume: ReturnType<typeof vi.fn>;
    transfer: ReturnType<typeof vi.fn>;
    devices: ReturnType<typeof vi.fn<() => Promise<SpotifyDevice[]>>>;
    playlists: ReturnType<typeof vi.fn<() => Promise<Playlist[]>>>;
  };

  beforeEach(() => {
    status = signal<SpotifyStatus | null>({ connected: true, playback: PLAYING });
    error = signal<Text | null>(null);
    fake = {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      next: vi.fn().mockResolvedValue(undefined),
      previous: vi.fn().mockResolvedValue(undefined),
      setVolume: vi.fn().mockResolvedValue(undefined),
      transfer: vi.fn().mockResolvedValue(undefined),
      devices: vi.fn().mockResolvedValue(DEVICES),
      playlists: vi.fn().mockResolvedValue(PLAYLISTS),
    };
    TestBed.configureTestingModule({
      providers: [
        ...provideTestBackend(),
        {
          provide: SpotifyService,
          useValue: { status, readAt: signal(READ_AT), error, ...fake },
        },
      ],
    });
    fixture = TestBed.createComponent(Music);
    fixture.componentRef.setInput('now', new Date(READ_AT));
    el = fixture.nativeElement as HTMLElement;
  });

  function show(playback: Playback | null): void {
    status.set({ connected: true, playback });
  }

  function label(selector: string): string | null {
    return query(el, selector).getAttribute('aria-label');
  }

  it('asks to connect an account first', async () => {
    status.set({ connected: false, playback: null });
    await settle(fixture);

    expect(text(el, '.not-connected')).toBe(
      'Connect a Spotify account in the settings to see what’s playing.',
    );
    expect(fake.devices).not.toHaveBeenCalled();
  });

  it('shows the song, its cover, and where it plays', async () => {
    await settle(fixture);

    expect(text(el, '.title')).toBe('Morning Song');
    expect(text(el, '.by')).toBe('First Artist, Second Artist');
    expect(text(el, '.album')).toBe('Sunrise');
    expect(text(el, '.device')).toBe('On Living room speaker');
    expect(query(el, '.cover img', HTMLImageElement).src).toBe('https://i.scdn.co/image/medium');
  });

  it('moves the progress along while it plays', async () => {
    await settle(fixture);
    expect(Array.from(el.querySelectorAll('.times span'), (s) => s.textContent)).toEqual([
      '1:01',
      '3:35',
    ]);
    expect(query(el, '.progress').style.width).toBe(`${String((61000 / 215000) * 100)}%`);

    fixture.componentRef.setInput('now', new Date(READ_AT + 4000));
    await settle(fixture);

    expect(text(el, '.times span')).toBe('1:05');
  });

  it('pauses, skips, and changes the volume', async () => {
    await settle(fixture);
    expect(label('.play-pause')).toBe('Pause');

    query(el, '.play-pause').click();
    query(el, '.next').click();
    query(el, '.previous').click();
    query(el, '.louder').click();
    query(el, '.quieter').click();

    expect(fake.pause).toHaveBeenCalled();
    expect(fake.next).toHaveBeenCalled();
    expect(fake.previous).toHaveBeenCalled();
    expect(fake.setVolume.mock.calls).toEqual([[45], [25]]);
    expect(text(el, '.volume-value')).toBe('35%');
  });

  it('resumes a paused episode, without volume controls where it can’t be changed', async () => {
    show({
      isPlaying: false,
      progressMs: 5000,
      item: { name: 'Episode 12', by: 'A Podcast', album: null, image: null, durationMs: 3600000 },
      device: { id: 'phone', name: 'Phone', type: 'Smartphone', isActive: true, volume: null },
    });
    await settle(fixture);
    expect(text(el, '.times span:last-child')).toBe('1:00:00');
    expect(el.querySelector('.album')).toBeNull();
    expect(el.querySelector('.cover img')).toBeNull();
    expect(el.querySelector('.volume')).toBeNull();
    expect(label('.play-pause')).toBe('Play');

    query(el, '.play-pause').click();

    expect(fake.play).toHaveBeenCalledWith();
  });

  it('keeps the volume controls while muted', async () => {
    show({ ...PLAYING, device: { ...SPEAKER, volume: 0 } });
    await settle(fixture);

    expect(text(el, '.volume-value')).toBe('0%');
  });

  it('says when an ad plays', async () => {
    show({ isPlaying: true, progressMs: 0, item: null, device: null });
    await settle(fixture);

    expect(text(el, '.title')).toBe('Advertisement');
    expect(el.querySelector('.progress')).toBeNull();
    expect(el.querySelector('.device')).toBeNull();
  });

  it('suggests what to do when nothing plays', async () => {
    show(null);
    await settle(fixture);

    expect(text(el, '.title')).toBe('Nothing playing');
    expect(el.querySelector('.controls')).toBeNull();
  });

  it('explains why a command failed', async () => {
    error.set({ key: 'errors.spotifyNoDevice' });
    await settle(fixture);

    expect(text(el, '.error')).toBe('Open Spotify on a phone, computer or speaker first.');
  });

  it('lists the devices, and moves playback to the one tapped', async () => {
    await settle(fixture);
    const choices = () =>
      Array.from(el.querySelectorAll('.device-choice'), (b) => [
        b.textContent.trim(),
        b.getAttribute('aria-pressed'),
      ]);
    expect(choices()).toEqual([
      ['Kitchen phone', 'false'],
      ['Living room speaker', 'true'],
    ]);

    button(el, 'Kitchen phone').click();
    await fixture.whenStable();

    expect(fake.transfer).toHaveBeenCalledWith('phone');
    expect(choices()).toEqual([
      ['Kitchen phone', 'true'],
      ['Living room speaker', 'false'],
    ]);
    // Then reads back where Spotify is playing, once it's had a moment.
    await new Promise((resolve) => setTimeout(resolve, COMMAND_REFRESH_MS));
    expect(fake.devices).toHaveBeenCalledTimes(2);
  });

  it('plays a playlist on the device playing now', async () => {
    await settle(fixture);
    const tiles = Array.from(el.querySelectorAll('.playlist'));
    expect(tiles.map((t) => t.textContent.trim())).toEqual(['Dinner', 'Empty']);
    expect(tiles[0].querySelector('img')?.src).toBe('https://mosaic.scdn.co/300/dinner');
    expect(tiles[1].querySelector('img')).toBeNull();

    button(el, 'Dinner').click();

    expect(fake.play).toHaveBeenCalledWith('spotify:playlist:1a2b3c', 'speaker');
  });

  it('lets Spotify pick the device when nothing plays', async () => {
    show(null);
    await settle(fixture);

    button(el, 'Empty').click();

    expect(fake.play).toHaveBeenCalledWith('spotify:playlist:7g8h9i', undefined);
  });

  it('says when there are no devices or playlists', async () => {
    fake.devices.mockResolvedValue([]);
    fake.playlists.mockResolvedValue([]);
    await settle(fixture);

    expect(text(el, '.no-devices')).toBe(
      'Open Spotify on a phone, computer or speaker to play from here.',
    );
    expect(text(el, '.no-playlists')).toBe('No playlists yet.');
  });

  it('logs when the devices or playlists can’t be loaded', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake.devices.mockRejectedValue(new Error('down'));
    fake.playlists.mockRejectedValue(new Error('down'));
    await settle(fixture);

    expect(log).toHaveBeenCalledWith('Spotify devices fetch failed', expect.any(Error));
    expect(log).toHaveBeenCalledWith('Spotify playlists fetch failed', expect.any(Error));
  });
});

describe('progressOf', () => {
  const now = (ms: number) => new Date(READ_AT + ms);

  it('adds the time since Spotify was asked while playing, up to the end', () => {
    expect(progressOf(PLAYING, READ_AT, now(2000))).toBe(63000);
    expect(progressOf(PLAYING, READ_AT, now(10 * 60 * 1000))).toBe(215000);
    // A clock a little behind the read doesn't go backwards.
    expect(progressOf(PLAYING, READ_AT, now(-500))).toBe(61000);
  });

  it('stands still while paused, and is 0 without an item', () => {
    expect(progressOf({ ...PLAYING, isPlaying: false }, READ_AT, now(2000))).toBe(61000);
    expect(progressOf({ ...PLAYING, item: null }, READ_AT, now(2000))).toBe(0);
    expect(progressOf(null, READ_AT, now(2000))).toBe(0);
  });

  it('gives a 0% bar for an item without a length', async () => {
    TestBed.configureTestingModule({
      providers: [
        ...provideTestBackend(),
        {
          provide: SpotifyService,
          useValue: {
            status: signal({
              connected: true,
              playback: { ...PLAYING, item: { ...SONG, durationMs: 0 } },
            }),
            readAt: signal(READ_AT),
            error: signal(null),
            devices: () => Promise.resolve([]),
            playlists: () => Promise.resolve([]),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(Music);
    fixture.componentRef.setInput('now', new Date(READ_AT));
    await settle(fixture);

    expect(query(fixture.nativeElement as HTMLElement, '.progress').style.width).toBe('0%');
  });
});

describe('formatTime', () => {
  it('shows minutes and seconds, and hours when there are any', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(185999)).toBe('3:05');
    expect(formatTime(3725000)).toBe('1:02:05');
  });
});

describe('deviceIcon', () => {
  it('picks an icon by the kind of device', () => {
    expect(deviceIcon('Computer')).toBe(LaptopIcon);
    expect(deviceIcon('Smartphone')).toBe(SmartPhone01Icon);
    expect(deviceIcon('Tablet')).toBe(SmartPhone01Icon);
    expect(deviceIcon('TV')).toBe(Tv01Icon);
    expect(deviceIcon('Speaker')).toBe(SpeakerIcon);
    expect(deviceIcon('Automobile')).toBe(SpeakerIcon);
  });
});
