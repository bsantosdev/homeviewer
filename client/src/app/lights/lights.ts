import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LightsService } from '../lights.service';
import { RoomSheet } from './room-sheet';
import { RoomTile } from './room-tile';

/**
 * The Hue rooms as tiles: tap one to switch it, swipe it up or down to dim it, and open its "•••"
 * for colours and scenes.
 */
@Component({
  selector: 'app-lights',
  imports: [RoomSheet, RoomTile, TranslocoPipe],
  templateUrl: './lights.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block select-none' },
})
export class Lights {
  protected readonly service = inject(LightsService);
  protected readonly rooms = this.service.rooms;
  protected readonly openId = signal<string | null>(null);
  /** Follows the refreshed rooms, so the sheet shows the current temperature. */
  protected readonly openRoom = computed(
    () => this.rooms()?.find((room) => room.id === this.openId()) ?? null,
  );
}
