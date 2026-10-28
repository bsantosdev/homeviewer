import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HugeiconsIconComponent } from '@hugeicons/angular';
import { CheckmarkCircle02Icon, PlusSignIcon } from '@hugeicons/core-free-icons';
import { TranslocoPipe } from '@jsverse/transloco';
import { ShoppingService } from '../shopping.service';

/** The shopping list: add things, tick them off, clear what's bought. Used on the wall and on phones. */
@Component({
  selector: 'app-shopping-list',
  imports: [HugeiconsIconComponent, TranslocoPipe],
  templateUrl: './shopping-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-col' },
})
export class ShoppingList {
  protected readonly service = inject(ShoppingService);
  protected readonly addIcon = PlusSignIcon;
  protected readonly doneIcon = CheckmarkCircle02Icon;
  /** Things still to buy first, then what's ticked off, each in the order they were added. */
  protected readonly items = computed(() => {
    const items = this.service.items();
    return [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];
  });
  protected readonly hasDone = computed(() => this.items().some((i) => i.done));
  /** A translation key, while the last add failed. */
  protected readonly error = signal('');

  protected async add(event: Event, field: HTMLInputElement): Promise<void> {
    event.preventDefault();
    const text = field.value.trim();
    if (!text) return;
    try {
      await this.service.add(text);
      field.value = '';
      this.error.set('');
    } catch (err: unknown) {
      console.error('Shopping list add failed', err);
      this.error.set('shopping.addFailed');
    }
  }
}
