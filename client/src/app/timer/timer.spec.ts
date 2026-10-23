import { TestBed } from '@angular/core/testing';
import { Timer } from './timer';

describe('Timer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const fixture = TestBed.createComponent(Timer);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const click = (label: string) => {
      const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.trim() === label);
      button!.click();
      fixture.detectChanges();
    };
    const display = () => el.querySelector('.display')!.textContent!.trim();
    return { fixture, el, click, display };
  }

  const selected = (el: HTMLElement, wheel: string) =>
    el.querySelector(`.${wheel} .item.selected`)!.textContent!.trim();

  it('sets the duration with the wheels and presets', () => {
    const { fixture, el, click } = setup();
    expect(selected(el, 'minutes')).toBe('05');
    expect(selected(el, 'seconds')).toBe('00');

    // Tapping a number on a wheel selects it.
    (el.querySelectorAll('.seconds .item')[10] as HTMLElement).click();
    fixture.detectChanges();
    expect(selected(el, 'seconds')).toBe('10');

    click('1m');
    expect(selected(el, 'minutes')).toBe('01');
    expect(selected(el, 'seconds')).toBe('00');
  });

  it('counts down, pauses, and finishes', () => {
    const { fixture, el, click, display } = setup();
    click('1m');
    click('Start');
    expect(display()).toBe('01:00');

    vi.advanceTimersByTime(20_000);
    fixture.detectChanges();
    expect(display()).toBe('00:40');

    click('Pause');
    vi.advanceTimersByTime(30_000);
    fixture.detectChanges();
    expect(display()).toBe('00:40');

    click('Resume');
    vi.advanceTimersByTime(40_000);
    fixture.detectChanges();
    expect(display()).toBe('00:00');
    expect(el.textContent).toContain("Time's up!");

    // Back to the wheels, keeping the last duration.
    click('Dismiss');
    expect(selected(el, 'minutes')).toBe('01');
    expect(selected(el, 'seconds')).toBe('00');
  });
});
