import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { HugeiconsIconComponent } from '@hugeicons/angular';
import { BulbIcon, MoreHorizontalIcon } from '@hugeicons/core-free-icons';

/** How far a finger can wander before a tap counts as a swipe. */
export const SWIPE_THRESHOLD_PX = 8;
/** How much the arrow keys change the brightness. */
export const KEY_STEP = 10;
/** For a room that's on but whose lights report no colour, such as lights that only dim. */
export const DEFAULT_COLOR = '#fbbf24';

/**
 * One room as a big button: tap to switch it, swipe up or down to dim it. The tile fills from the
 * bottom to show the brightness, in the colours the lights are showing, and a swipe across its full
 * height goes from 0 to 100%. The "•••" button in the corner opens the room's colours and scenes.
 *
 * iOS 12 has no pointer events, so swipes come from touch events, with mouse events for desktop
 * browsers.
 */
@Component({
  selector: 'app-room-tile',
  imports: [HugeiconsIconComponent],
  templateUrl: './room-tile.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block' },
})
export class RoomTile {
  readonly name = input.required<string>();
  readonly on = input.required<boolean>();
  /** Null for rooms that only switch on and off: they don't swipe. */
  readonly brightness = input.required<number | null>();
  /** What the lights look like, as "#rrggbb"; several make a gradient. */
  readonly colors = input<string[]>([]);

  /** Tapped: switch to the opposite of `on`. */
  readonly switched = output<boolean>();
  /** A swipe is under way. Only show the value; the bridge gets `dimmed` when it ends. */
  readonly dimming = output<number>();
  readonly dimmed = output<number>();
  /** The "•••" button was tapped. */
  readonly opened = output();

  protected readonly bulbIcon = BulbIcon;
  protected readonly moreIcon = MoreHorizontalIcon;
  protected readonly keyStep = KEY_STEP;
  protected readonly paint = computed(() => {
    const colors = this.colors();
    if (colors.length > 1) return `linear-gradient(to right, ${colors.join(', ')})`;
    return colors[0] ?? DEFAULT_COLOR;
  });
  protected readonly status = computed(() => {
    const brightness = this.brightness();
    if (!this.on()) return 'Off';
    return brightness === null ? 'On' : `${String(brightness)}%`;
  });

  private readonly tile = viewChild.required<ElementRef<HTMLButtonElement>>('tile');
  private readonly document = inject(DOCUMENT);
  private swipe: { startY: number; from: number; height: number; value: number | null } | null =
    null;
  /** A mouse swipe ends with a click, which mustn't also switch the room. */
  private swallowClick = false;

  private readonly mouseMove = (event: MouseEvent) => {
    this.move(event.clientY);
  };
  private readonly mouseUp = () => {
    this.stopMouse();
    this.swallowClick = this.end();
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopMouse();
    });
  }

  protected tap(): void {
    if (this.swallowClick) this.swallowClick = false;
    else this.switched.emit(!this.on());
  }

  protected step(delta: number, event: Event): void {
    const brightness = this.brightness();
    if (brightness === null) return;
    event.preventDefault();
    this.dimmed.emit(clamp((this.on() ? brightness : 0) + delta));
  }

  protected touchStart(event: TouchEvent): void {
    this.begin(event.touches[0].clientY);
  }

  protected touchMove(event: TouchEvent): void {
    // Keep the page from scrolling while a room is being dimmed.
    if (this.move(event.touches[0].clientY)) event.preventDefault();
  }

  protected touchEnd(event: TouchEvent): void {
    // After a swipe, stop the browser from following up with a click that would switch the room.
    if (this.end()) event.preventDefault();
  }

  protected touchCancel(): void {
    this.swipe = null;
  }

  protected mouseDown(event: MouseEvent): void {
    if (event.button !== 0 || !this.begin(event.clientY)) return;
    this.document.addEventListener('mousemove', this.mouseMove);
    this.document.addEventListener('mouseup', this.mouseUp);
  }

  /** @returns Whether the room can be swiped. */
  private begin(y: number): boolean {
    const brightness = this.brightness();
    if (brightness === null) return false;
    this.swipe = {
      startY: y,
      // An off room starts from the bottom, so swiping up brings it on gently.
      from: this.on() ? brightness : 0,
      height: this.tile().nativeElement.getBoundingClientRect().height,
      value: null,
    };
    return true;
  }

  /** @returns Whether a swipe is under way, including the first few pixels before it counts. */
  private move(y: number): boolean {
    const swipe = this.swipe;
    if (!swipe) return false;
    const distance = swipe.startY - y;
    if (swipe.value === null && Math.abs(distance) < SWIPE_THRESHOLD_PX) return true;
    swipe.value = clamp(swipe.from + (distance / swipe.height) * 100);
    this.dimming.emit(swipe.value);
    return true;
  }

  /** @returns Whether this was a swipe rather than a tap. */
  private end(): boolean {
    const value = this.swipe?.value ?? null;
    this.swipe = null;
    if (value !== null) this.dimmed.emit(value);
    return value !== null;
  }

  private stopMouse(): void {
    this.document.removeEventListener('mousemove', this.mouseMove);
    this.document.removeEventListener('mouseup', this.mouseUp);
  }
}

function clamp(value: number): number {
  return Math.min(100, Math.max(1, Math.round(value)));
}
