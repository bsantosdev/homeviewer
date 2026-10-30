import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { HugeiconsIconComponent } from '@hugeicons/angular';
import {
  LaptopIcon,
  MinusSignIcon,
  MusicNote01Icon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
  PreviousIcon,
  SmartPhone01Icon,
  SpeakerIcon,
  Tv01Icon,
} from '@hugeicons/core-free-icons';
import { TranslocoPipe } from '@jsverse/transloco';
import { TextPipe } from '../i18n';
import {
  COMMAND_REFRESH_MS,
  Playback,
  Playlist,
  SpotifyDevice,
  SpotifyService,
  VOLUME_STEP,
} from '../spotify.service';

/** How far into the item it is now: Spotify's answer, moved along by the time since, while it plays. */
export function progressOf(playback: Playback | null, readAt: number, now: Date): number {
  if (!playback?.item) return 0;
  const since = playback.isPlaying ? Math.max(0, now.getTime() - readAt) : 0;
  return Math.min(playback.item.durationMs, playback.progressMs + since);
}

/** "3:05", or "1:02:05" from an hour on. */
export function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const rest = String(seconds % 60).padStart(2, '0');
  return hours
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${String(minutes)}:${rest}`;
}

// Spotify's device types; anything else, such as an amplifier or a car, shows as a speaker.
const DEVICE_ICONS: Record<string, typeof SpeakerIcon | undefined> = {
  Computer: LaptopIcon,
  Smartphone: SmartPhone01Icon,
  Tablet: SmartPhone01Icon,
  TV: Tv01Icon,
};

export function deviceIcon(type: string): typeof SpeakerIcon {
  return DEVICE_ICONS[type] ?? SpeakerIcon;
}

/**
 * The Music page: what Spotify is playing with its controls, the devices to play on, and the
 * account's playlists.
 */
@Component({
  selector: 'app-music',
  imports: [HugeiconsIconComponent, TextPipe, TranslocoPipe],
  templateUrl: './music.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-col select-none' },
})
export class Music {
  /** The dashboard's clock, to move the progress bar along between reads. */
  readonly now = input.required<Date>();
  protected readonly service = inject(SpotifyService);
  protected readonly connected = computed(() => this.service.status()?.connected ?? false);
  protected readonly playback = computed(() => this.service.status()?.playback ?? null);
  protected readonly progress = computed(() =>
    progressOf(this.playback(), this.service.readAt(), this.now()),
  );
  protected readonly devices = signal<SpotifyDevice[]>([]);
  protected readonly playlists = signal<Playlist[]>([]);
  protected readonly formatTime = formatTime;
  protected readonly deviceIcon = deviceIcon;
  protected readonly volumeStep = VOLUME_STEP;
  protected readonly icons = {
    cover: MusicNote01Icon,
    play: PlayIcon,
    pause: PauseIcon,
    next: NextIcon,
    previous: PreviousIcon,
    quieter: MinusSignIcon,
    louder: PlusSignIcon,
  };

  constructor() {
    effect(() => {
      if (this.connected()) {
        void this.loadDevices();
        void this.loadPlaylists();
      }
    });
  }

  protected percent(durationMs: number): number {
    return durationMs ? (this.progress() / durationMs) * 100 : 0;
  }

  /** Plays on the device playing now; with none, Spotify picks the one used last. */
  protected playPlaylist(playlist: Playlist): void {
    void this.service.play(playlist.uri, this.playback()?.device?.id);
  }

  protected async transfer(device: SpotifyDevice): Promise<void> {
    this.devices.update((devices) => devices.map((d) => ({ ...d, isActive: d.id === device.id })));
    await this.service.transfer(device.id);
    // Spotify takes a moment to move playback over.
    setTimeout(() => {
      void this.loadDevices();
    }, COMMAND_REFRESH_MS);
  }

  private async loadDevices(): Promise<void> {
    try {
      this.devices.set(await this.service.devices());
    } catch (err: unknown) {
      console.error('Spotify devices fetch failed', err);
    }
  }

  private async loadPlaylists(): Promise<void> {
    try {
      this.playlists.set(await this.service.playlists());
    } catch (err: unknown) {
      console.error('Spotify playlists fetch failed', err);
    }
  }
}
