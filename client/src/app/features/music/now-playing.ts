import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { HugeiconsIconComponent } from '@hugeicons/angular';
import { PauseIcon, PlayIcon } from '@hugeicons/core-free-icons';
import { TranslocoPipe } from '@jsverse/transloco';
import { SpotifyService } from './data-access/spotify.service';

/** What Spotify is playing or has paused, as a strip under the clock: tap it to open the music. */
@Component({
  selector: 'app-now-playing',
  imports: [HugeiconsIconComponent, TranslocoPipe],
  templateUrl: './now-playing.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class NowPlaying {
  readonly open = output();
  protected readonly spotify = inject(SpotifyService);
  protected readonly playIcon = PlayIcon;
  protected readonly pauseIcon = PauseIcon;
  /** Nothing while nothing, or an ad, plays. */
  protected readonly nowPlaying = computed(() => {
    const playback = this.spotify.status()?.playback;
    return playback?.item ? { ...playback, item: playback.item } : null;
  });
}
