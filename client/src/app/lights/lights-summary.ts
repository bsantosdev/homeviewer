import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LightsService, Room } from '../lights.service';
import { DEFAULT_COLOR } from './room-tile';

/** The dashboard's lights widget: every room with a switch. The full controls are on the Lights page. */
@Component({
  selector: 'app-lights-summary',
  templateUrl: './lights-summary.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block select-none' },
})
export class LightsSummary {
  protected readonly service = inject(LightsService);
  protected readonly rooms = computed(() => this.service.rooms() ?? []);
  protected readonly onCount = computed(() => this.rooms().filter((room) => room.on).length);

  protected dot(room: Room): string | null {
    return room.on ? (room.colors[0] ?? DEFAULT_COLOR) : null;
  }

  protected status(room: Room): string {
    if (!room.on) return 'Off';
    return room.brightness === null ? 'On' : `${String(room.brightness)}%`;
  }
}
