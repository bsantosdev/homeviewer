import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SettingsService } from '../settings.service';
import { ShoppingList } from './shopping-list';

/** The shopping list on its own, at /list, for adding things from a phone. */
@Component({
  selector: 'app-shopping-page',
  imports: [ShoppingList],
  template: `
    <h1 class="m-0 mb-[2vh] text-vh-4 font-semibold">Shopping list</h1>
    <app-shopping-list class="flex-1" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'box-border flex h-screen flex-col bg-[#f7f7f5] p-[3vh] text-[#1a1a1a] transition-colors duration-300 dark:bg-[#111] dark:text-[#f2f2f2]',
    '[class.dark]': 'isDark()',
  },
})
export class ShoppingPage {
  protected readonly isDark = inject(SettingsService).isDark;
}
