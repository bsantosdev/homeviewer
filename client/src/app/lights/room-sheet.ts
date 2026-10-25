import { ChangeDetectionStrategy, Component, inject, input, output, resource } from '@angular/core';
import { HugeiconsIconComponent } from '@hugeicons/angular';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { LightsService, MAX_KELVIN, MIN_KELVIN, Room, Scene } from '../lights.service';

/** Colours a room can be set to with one tap, for rooms with colour lights. */
export const SWATCHES = [
  { name: 'Red', color: '#ff3b30' },
  { name: 'Orange', color: '#ff9500' },
  { name: 'Yellow', color: '#ffcc00' },
  { name: 'Green', color: '#34c759' },
  { name: 'Teal', color: '#00c7be' },
  { name: 'Blue', color: '#007aff' },
  { name: 'Purple', color: '#af52de' },
  { name: 'Pink', color: '#ff2d55' },
];

/** Where the white slider starts for a room that isn't in white mode: a warm, everyday white. */
export const DEFAULT_KELVIN = 2700;

/**
 * A room's colours, over the dashboard: its scenes from the Hue app, a warm-to-cool white slider,
 * and colour swatches if any of its lights can show colours.
 */
@Component({
  selector: 'app-room-sheet',
  imports: [HugeiconsIconComponent],
  templateUrl: './room-sheet.html',
  styleUrl: './room-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
})
export class RoomSheet {
  private readonly service = inject(LightsService);
  readonly room = input.required<Room>();
  readonly closed = output();

  protected readonly closeIcon = Cancel01Icon;
  protected readonly swatches = SWATCHES;
  protected readonly minKelvin = MIN_KELVIN;
  protected readonly maxKelvin = MAX_KELVIN;
  protected readonly defaultKelvin = DEFAULT_KELVIN;
  // Keyed on the id, so the 15-second room refresh doesn't fetch the scenes again.
  protected readonly scenes = resource({
    params: () => this.room().id,
    loader: ({ params }) => this.service.scenes(params),
  });

  protected recall(scene: Scene): void {
    void this.service.recall(scene.id);
  }

  protected setTemperature(event: Event): void {
    const temperature = Number((event.target as HTMLInputElement).value);
    void this.service.change(this.room().id, { on: true, temperature });
  }

  protected setColor(color: string): void {
    void this.service.change(this.room().id, { on: true, color });
  }

  protected paint(colors: string[]): string {
    return colors.length > 1 ? `linear-gradient(to right, ${colors.join(', ')})` : colors[0];
  }
}
