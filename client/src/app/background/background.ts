import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { backgroundUrl, loadImage } from '../backgrounds';
import { SettingsService } from '../settings.service';

interface Layer {
  id: number;
  url: string;
}

/**
 * The background images behind the dashboard, changing every few minutes. Which image is due only
 * depends on the clock, so every screen shows the same one.
 */
@Component({
  selector: 'app-background',
  templateUrl: './background.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pointer-events-none absolute bottom-0 left-0 right-0 top-0 -z-10 overflow-hidden',
    'aria-hidden': 'true',
  },
})
export class Background {
  private readonly settingsService = inject(SettingsService);
  protected readonly isDark = this.settingsService.isDark;
  readonly now = input.required<Date>();

  private readonly due = computed(() => {
    const s = this.settingsService.settings();
    if (!s?.backgrounds.length) return null;
    const slot = Math.floor(this.now().getTime() / (Math.max(1, s.backgroundMinutes) * 60_000));
    return backgroundUrl(s.backgrounds[slot % s.backgrounds.length]);
  });

  /** On screen: the newest image fading in over the one before it. Never more, to spare memory. */
  protected readonly layers = signal<Layer[]>([]);
  private nextId = 0;

  constructor() {
    effect(() => {
      const url = this.due();
      if (url === null) {
        this.layers.set([]);
        return;
      }
      const shown = untracked(this.layers);
      if (shown.length && shown[shown.length - 1].url === url) return;
      // Swap once the image has loaded, so it fades in whole rather than drawing in.
      loadImage(url).then(
        () => {
          if (this.due() !== url) return;
          this.layers.update((layers) => [...layers.slice(-1), { id: this.nextId++, url }]);
        },
        (err: unknown) => {
          console.error('Background image failed to load', err);
        },
      );
    });
  }
}
