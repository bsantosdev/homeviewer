import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Text, TextPipe } from '../i18n';
import { LightsService, Room, RoomScene } from '../lights.service';
import { SettingsService } from '../settings.service';
import { DEFAULT_COLOR, roomStatus } from './room-tile';

/**
 * The dashboard's lights widget: the scene shortcuts picked in the admin page, a button to turn
 * everything off, and every room with a switch. The full controls are on the Lights page.
 */
@Component({
  selector: 'app-lights-summary',
  imports: [TextPipe, TranslocoPipe],
  templateUrl: './lights-summary.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block select-none' },
})
export class LightsSummary {
  protected readonly service = inject(LightsService);
  private readonly settings = inject(SettingsService).settings;
  protected readonly defaultColor = DEFAULT_COLOR;
  protected readonly rooms = computed(() => this.service.rooms() ?? []);
  protected readonly onCount = computed(() => this.rooms().filter((room) => room.on).length);
  private readonly scenes = signal<RoomScene[]>([]);
  /** In the order they were picked; scenes since deleted in the Hue app are left out. */
  protected readonly shortcuts = computed(() => {
    const byId = new Map(this.scenes().map((scene) => [scene.id, scene]));
    return (this.settings()?.sceneShortcuts ?? [])
      .map((id) => byId.get(id))
      .filter((scene) => scene !== undefined);
  });

  // Compared as text, so unrelated settings changes don't refetch the scenes.
  private readonly shortcutIds = computed(() => this.settings()?.sceneShortcuts.join(' ') ?? '');

  constructor() {
    effect(() => {
      if (this.shortcutIds()) void this.loadScenes();
    });
  }

  protected dot(room: Room): string | null {
    return room.on ? (room.colors[0] ?? DEFAULT_COLOR) : null;
  }

  protected status(room: Room): Text {
    return roomStatus(room.on, room.brightness);
  }

  private async loadScenes(): Promise<void> {
    try {
      this.scenes.set(await this.service.allScenes());
    } catch (err: unknown) {
      console.error('Scenes fetch failed', err);
    }
  }
}
