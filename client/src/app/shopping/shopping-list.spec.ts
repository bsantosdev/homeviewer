import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ShoppingList } from './shopping-list';
import { ShoppingItem, ShoppingService } from '../shopping.service';
import { button, provideTestBackend, query, settle, text } from '../../testing/test-helpers';

describe('ShoppingList', () => {
  let fixture: ComponentFixture<ShoppingList>;
  let el: HTMLElement;
  let items: ReturnType<typeof signal<ShoppingItem[]>>;
  let add: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  let toggle: ReturnType<typeof vi.fn<(item: ShoppingItem) => Promise<void>>>;
  let clearDone: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(async () => {
    items = signal<ShoppingItem[]>([]);
    add = vi.fn().mockResolvedValue(undefined);
    toggle = vi.fn().mockResolvedValue(undefined);
    clearDone = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        ...provideTestBackend(),
        { provide: ShoppingService, useValue: { items, add, toggle, clearDone } },
      ],
    });
    fixture = TestBed.createComponent(ShoppingList);
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  function field(): HTMLInputElement {
    return query(el, 'input', HTMLInputElement);
  }

  async function submit(value: string): Promise<void> {
    field().value = value;
    query(el, 'button[aria-label="Add"]').click();
    await settle(fixture);
  }

  function rows(): string[] {
    return Array.from(el.querySelectorAll('.item'), (row) =>
      [String(row.getAttribute('aria-checked')), row.textContent.trim()].join(' '),
    );
  }

  it('says when there is nothing to buy', () => {
    expect(text(el, '.empty')).toBe('Nothing to buy.');
    expect(el.querySelector('.clear')).toBeNull();
  });

  it('lists what is left to buy first, then what is ticked off', async () => {
    items.set([
      { id: '1', text: 'Eggs', done: true },
      { id: '2', text: 'Milk', done: false },
      { id: '3', text: 'Bread', done: false },
    ]);
    await fixture.whenStable();

    expect(rows()).toEqual(['false Milk', 'false Bread', 'true Eggs']);
    expect(query(el, '.item[aria-checked="true"] .text').classList).toContain('line-through');
  });

  it('ticks items off and clears them', async () => {
    const eggs = { id: '1', text: 'Eggs', done: true };
    items.set([eggs]);
    await fixture.whenStable();

    query(el, '.item').click();
    expect(toggle).toHaveBeenCalledWith(eggs);

    button(el, 'Clear ticked').click();
    expect(clearDone).toHaveBeenCalled();
  });

  it('adds what is typed, without the spaces around it, and empties the field', async () => {
    await submit('  Milk ');
    expect(add).toHaveBeenCalledWith('Milk');
    expect(field().value).toBe('');
  });

  it('ignores an empty field', async () => {
    await submit('   ');
    expect(add).not.toHaveBeenCalled();
  });

  it('keeps the text and says so when adding fails, until the next add works', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    add.mockRejectedValueOnce(new Error('offline'));

    await submit('Milk');
    expect(field().value).toBe('Milk');
    expect(text(el, '.error')).toBe('Couldn’t add that. Try again.');

    await submit('Milk');
    expect(el.querySelector('.error')).toBeNull();
    log.mockRestore();
  });
});
