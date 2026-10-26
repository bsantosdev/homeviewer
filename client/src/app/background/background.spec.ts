import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Background } from './background';
import { DashboardSettings, SettingsService } from '../settings.service';
import {
  TEST_SETTINGS,
  fakeImageLoading,
  provideTestBackend,
  settle,
} from '../../testing/test-helpers';

const MINUTE = 60_000;
// The 7th ten-minute slot since 1970, whatever the time zone.
const NOW = new Date(70 * MINUTE);

describe('Background', () => {
  let fixture: ComponentFixture<Background>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideTestBackend() });
    fixture = TestBed.createComponent(Background);
    el = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function show(settings: Partial<DashboardSettings>, now = NOW): Promise<void> {
    TestBed.inject(SettingsService).settings.set({ ...TEST_SETTINGS, ...settings });
    fixture.componentRef.setInput('now', now);
    // Render, so the image starts loading, then let it load.
    await fixture.whenStable();
    await settle(fixture);
  }

  function layers(): string[] {
    return Array.from(el.querySelectorAll<HTMLElement>('.layer'), (l) => l.style.backgroundImage);
  }

  it('shows nothing without images', async () => {
    fakeImageLoading();
    await show({});
    expect(layers()).toEqual([]);
    expect(el.querySelector('.veil')).toBeNull();
  });

  it('shows the image due now, with a veil for the theme', async () => {
    fakeImageLoading();
    await show({ backgrounds: ['a.jpg', 'b.jpg', 'c.jpg'] });

    // Slot 7 of three images is the second one.
    expect(layers()).toEqual(['url("/api/backgrounds/b.jpg")']);
    expect(el.querySelector('.veil')?.classList).toContain('bg-black/50');

    await show({ backgrounds: ['a.jpg', 'b.jpg', 'c.jpg'], theme: 'light' });
    expect(el.querySelector('.veil')?.classList).toContain('bg-white/60');
  });

  it('moves on after the set minutes, fading over the previous image', async () => {
    fakeImageLoading();
    const settings = { backgrounds: ['a.jpg', 'b.jpg', 'c.jpg'], backgroundMinutes: 10 };
    await show(settings);

    await show(settings, new Date(NOW.getTime() + 9 * MINUTE));
    expect(layers()).toEqual(['url("/api/backgrounds/b.jpg")']);

    await show(settings, new Date(NOW.getTime() + 10 * MINUTE));
    expect(layers()).toEqual(['url("/api/backgrounds/b.jpg")', 'url("/api/backgrounds/c.jpg")']);

    // Only the last two stay on screen.
    await show(settings, new Date(NOW.getTime() + 20 * MINUTE));
    expect(layers()).toEqual(['url("/api/backgrounds/c.jpg")', 'url("/api/backgrounds/a.jpg")']);
  });

  it('skips an image that is no longer due once it has loaded', async () => {
    fakeImageLoading();
    TestBed.inject(SettingsService).settings.set({ ...TEST_SETTINGS, backgrounds: ['a.jpg'] });
    fixture.componentRef.setInput('now', NOW);
    await fixture.whenStable();

    TestBed.inject(SettingsService).settings.set({ ...TEST_SETTINGS, backgrounds: ['b.jpg'] });
    await fixture.whenStable();
    await settle(fixture);

    expect(layers()).toEqual(['url("/api/backgrounds/b.jpg")']);
  });

  it('keeps the current image when the next one fails to load', async () => {
    fakeImageLoading({ fails: (url) => url.endsWith('broken.jpg') });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await show({ backgrounds: ['a.jpg'] });

    await show({ backgrounds: ['broken.jpg'] });

    expect(layers()).toEqual(['url("/api/backgrounds/a.jpg")']);
    expect(log).toHaveBeenCalledWith('Background image failed to load', expect.any(Error));
  });

  it('clears the images when they are removed', async () => {
    fakeImageLoading();
    await show({ backgrounds: ['a.jpg'] });

    await show({ backgrounds: [] });

    expect(layers()).toEqual([]);
  });
});
