import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';

/** One thing to pick. Choices with a group are listed under its name, so give them in group order. */
export interface Choice {
  value: string;
  label: string;
  group?: string;
}

/**
 * A dropdown of checkboxes: the closed field lists what's picked, and tapping it opens the list.
 * Tapping anywhere else, or Escape, closes it.
 */
@Component({
  selector: 'app-multi-select',
  templateUrl: './multi-select.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative block',
    '(document:click)': 'closeFrom($event)',
    '(document:keydown.escape)': 'open.set(false)',
  },
})
export class MultiSelect {
  readonly choices = input.required<Choice[]>();
  /** The picked values, in the order they were picked. */
  readonly selected = model.required<string[]>();
  /** Names the field for screen readers. */
  readonly label = input.required<string>();
  /** What the closed field says while nothing is picked. */
  readonly placeholder = input.required<string>();
  protected readonly open = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Each choice, with its group's name above the first one in a group. */
  protected readonly rows = computed(() =>
    this.choices().map((choice, i, all) => ({
      choice,
      heading:
        choice.group && choice.group !== (i ? all[i - 1].group : undefined) ? choice.group : null,
    })),
  );

  /** What's picked, in the order it was picked; values no longer offered are left out. */
  protected readonly summary = computed(() => {
    const byValue = new Map(this.choices().map((choice) => [choice.value, choice]));
    return this.selected()
      .map((value) => byValue.get(value))
      .filter((choice) => choice !== undefined)
      .map((choice) => (choice.group ? `${choice.group} · ${choice.label}` : choice.label))
      .join(', ');
  });

  protected toggle(value: string, on: boolean): void {
    const others = this.selected().filter((v) => v !== value);
    this.selected.set(on ? [...others, value] : others);
  }

  protected closeFrom(event: Event): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
