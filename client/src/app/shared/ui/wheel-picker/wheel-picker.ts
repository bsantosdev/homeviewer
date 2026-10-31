import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';

// Wait this long after the last scroll event before picking a value
// (Safari 12 has no `scrollend` event).
export const SETTLE_MS = 120;

@Component({
  selector: 'app-wheel-picker',
  templateUrl: './wheel-picker.html',
  styleUrl: './wheel-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Three rows are visible; the middle one is the selected value.
  host: { class: 'relative inline-block h-[30vh] w-[18vh] select-none' },
})
export class WheelPicker {
  readonly max = input.required<number>();
  readonly value = model.required<number>();
  protected readonly items = computed(() => Array.from({ length: this.max() + 1 }, (_, i) => i));

  private readonly wheel = viewChild.required<ElementRef<HTMLElement>>('wheel');
  private settleTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Scroll to the value when it changes from outside (first render, presets, taps).
    afterRenderEffect(() => {
      const el = this.wheel().nativeElement;
      const value = this.value();
      if (this.indexAt(el) !== value) el.scrollTop = value * this.itemHeight(el);
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.settleTimer);
    });
  }

  protected format(n: number): string {
    return String(n).padStart(2, '0');
  }

  protected onScroll(): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      const el = this.wheel().nativeElement;
      const index = Math.min(this.max(), Math.max(0, this.indexAt(el)));
      // Align exactly, in case the browser didn't snap.
      el.scrollTop = index * this.itemHeight(el);
      this.value.set(index);
    }, SETTLE_MS);
  }

  private itemHeight(el: HTMLElement): number {
    // Fall back to 1 when there's no layout (e.g. in unit tests).
    return Math.max(1, el.querySelector<HTMLElement>('.item')?.offsetHeight ?? 0);
  }

  private indexAt(el: HTMLElement): number {
    return Math.round(el.scrollTop / this.itemHeight(el));
  }
}
