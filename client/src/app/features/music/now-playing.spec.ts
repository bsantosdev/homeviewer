import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NowPlaying } from './now-playing';
import { SpotifyService, SpotifyStatus } from './data-access/spotify.service';
import { PLAYING, SONG, provideTestBackend, query, text } from '../../../testing/test-helpers';

describe('NowPlaying', () => {
  let fixture: ComponentFixture<NowPlaying>;
  let el: HTMLElement;
  let status: ReturnType<typeof signal<SpotifyStatus | null>>;
  let play: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    status = signal<SpotifyStatus | null>(null);
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        ...provideTestBackend(),
        { provide: SpotifyService, useValue: { status, play, pause } },
      ],
    });
    fixture = TestBed.createComponent(NowPlaying);
    el = fixture.nativeElement as HTMLElement;
  });

  async function show(value: SpotifyStatus | null): Promise<void> {
    status.set(value);
    await fixture.whenStable();
  }

  it('shows what’s playing, with its cover', async () => {
    // Act
    await show({ connected: true, playback: PLAYING });

    // Assert
    expect(text(el, '.now-playing-title')).toBe('Morning Song');
    expect(text(el, '.now-playing-by')).toBe('First Artist, Second Artist');
    expect(query(el, '.now-playing img', HTMLImageElement).src).toBe(
      'https://i.scdn.co/image/medium',
    );
    expect(query(el, '.now-playing-toggle').getAttribute('aria-label')).toBe('Pause');
  });

  it('pauses from the strip while playing', async () => {
    // Arrange
    await show({ connected: true, playback: PLAYING });

    // Act
    query(el, '.now-playing-toggle').click();

    // Assert
    expect(pause).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it('resumes from the strip while paused, with or without a cover', async () => {
    // Arrange
    await show({
      connected: true,
      playback: { ...PLAYING, isPlaying: false, item: { ...SONG, image: null } },
    });

    // Act
    query(el, '.now-playing-toggle').click();

    // Assert
    expect(el.querySelector('.now-playing img')).toBeNull();
    expect(play).toHaveBeenCalledWith();
  });

  it('asks to open the music when tapped', async () => {
    // Arrange
    await show({ connected: true, playback: PLAYING });
    const open = vi.fn();
    fixture.componentInstance.open.subscribe(open);

    // Act
    query(el, '.now-playing button[aria-label="Open music"]').click();

    // Assert
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each<[string, SpotifyStatus | null]>([
    ['Spotify isn’t set up', null],
    ['nothing plays', { connected: true, playback: null }],
    ['an ad plays', { connected: true, playback: { ...PLAYING, item: null } }],
  ])('is empty while %s', async (_, value) => {
    // Act
    await show(value);

    // Assert
    expect(el.querySelector('.now-playing')).toBeNull();
  });
});
