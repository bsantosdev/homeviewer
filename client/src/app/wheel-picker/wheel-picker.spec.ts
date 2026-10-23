import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SETTLE_MS, WheelPicker } from './wheel-picker';
import { query, text } from '../../testing/test-helpers';

@Component({
  imports: [WheelPicker],
  template: '<app-wheel-picker [max]="59" [(value)]="value" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly value = signal(5);
}

const ITEM_HEIGHT = 50;

describe('WheelPicker', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;
  let wheel: HTMLElement;

  beforeEach(async () => {
    // jsdom has no layout, so give every row a height.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(ITEM_HEIGHT);
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    wheel = query(el, '.wheel');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function scrollTo(top: number): Promise<void> {
    wheel.scrollTop = top;
    wheel.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 20));
    await fixture.whenStable();
  }

  it('shows two-digit values from 00 to max', () => {
    const items = el.querySelectorAll('.item');
    expect(items).toHaveLength(60);
    expect(items[0].textContent.trim()).toBe('00');
    expect(items[59].textContent.trim()).toBe('59');
  });

  it('scrolls to the initial value', () => {
    expect(wheel.scrollTop).toBe(5 * ITEM_HEIGHT);
    expect(text(el, '.item.selected')).toBe('05');
  });

  it('scrolls when the value changes from outside', async () => {
    fixture.componentInstance.value.set(10);
    await fixture.whenStable();
    expect(wheel.scrollTop).toBe(10 * ITEM_HEIGHT);
  });

  it('picks the nearest value once scrolling settles and snaps to it', async () => {
    await scrollTo(12.6 * ITEM_HEIGHT);
    expect(fixture.componentInstance.value()).toBe(13);
    expect(wheel.scrollTop).toBe(13 * ITEM_HEIGHT);
  });

  it('keeps the value within range', async () => {
    await scrollTo(100 * ITEM_HEIGHT);
    expect(fixture.componentInstance.value()).toBe(59);

    await scrollTo(-2 * ITEM_HEIGHT);
    expect(fixture.componentInstance.value()).toBe(0);
  });

  it('selects a value when it is tapped', async () => {
    el.querySelectorAll<HTMLElement>('.item')[7].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe(7);
    expect(wheel.scrollTop).toBe(7 * ITEM_HEIGHT);
  });

  it('ignores a pending scroll once destroyed', async () => {
    wheel.scrollTop = 20 * ITEM_HEIGHT;
    wheel.dispatchEvent(new Event('scroll'));
    fixture.destroy();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 20));
    expect(fixture.componentInstance.value()).toBe(5);
  });
});
