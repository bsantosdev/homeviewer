import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ALARM_SECONDS, Timer } from './timer';
import { button, query, text } from '../../testing/test-helpers';

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  readonly currentTime = 0;
  readonly destination = {};
  readonly started: number[] = [];
  readonly resume = vi.fn(() => Promise.resolve());
  readonly close = vi.fn(() => Promise.resolve());

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createOscillator() {
    return {
      frequency: { value: 0 },
      connect: vi.fn(),
      start: (at: number) => this.started.push(at),
      stop: vi.fn(),
    };
  }

  createGain() {
    return { gain: { value: 0 }, connect: vi.fn() };
  }
}

describe('Timer', () => {
  let fixture: ComponentFixture<Timer>;
  let el: HTMLElement;

  beforeEach(async () => {
    // Fake only the timer's clocks; Angular's scheduler keeps real timeouts.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    FakeAudioContext.instances = [];
    fixture = TestBed.createComponent(Timer);
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const selected = (wheel: string) => text(el, `.${wheel} .item.selected`);

  async function click(label: string): Promise<void> {
    button(el, label).click();
    await fixture.whenStable();
  }

  async function elapse(ms: number): Promise<void> {
    vi.advanceTimersByTime(ms);
    await fixture.whenStable();
  }

  async function tapWheel(wheel: string, value: number): Promise<void> {
    el.querySelectorAll<HTMLElement>(`.${wheel} .item`)[value].click();
    await fixture.whenStable();
  }

  const display = () => text(el, '.display');

  it('starts at five minutes', () => {
    expect(selected('minutes')).toBe('05');
    expect(selected('seconds')).toBe('00');
    expect(button(el, '5m').classList).toContain('btn-selected');
  });

  it('sets the duration with the wheels and presets', async () => {
    await tapWheel('seconds', 10);
    expect(selected('seconds')).toBe('10');
    expect(button(el, '5m').classList).not.toContain('btn-selected');

    await click('1m');
    expect(selected('minutes')).toBe('01');
    expect(selected('seconds')).toBe('00');
  });

  it('disables Start at 00:00', async () => {
    await tapWheel('minutes', 0);
    expect(button(el, 'Start').disabled).toBe(true);
  });

  it('counts down, pauses, resumes and finishes', async () => {
    await click('1m');
    await click('Start');
    expect(display()).toBe('01:00');

    await elapse(20_000);
    expect(display()).toBe('00:40');

    await click('Pause');
    await elapse(30_000);
    expect(display()).toBe('00:40');

    await click('Resume');
    await elapse(40_000);
    expect(display()).toBe('00:00');
    expect(el.textContent).toContain("Time's up!");
    expect(query(el, '.display').classList).toContain('animate-flash');

    // Back to the wheels, keeping the last duration.
    await click('Dismiss');
    expect(selected('minutes')).toBe('01');
  });

  it('resets a running timer', async () => {
    await click('Start');
    await elapse(5_000);
    await click('Reset');
    expect(selected('minutes')).toBe('05');

    // The old countdown no longer runs.
    await elapse(10 * 60_000);
    expect(el.textContent).not.toContain("Time's up!");
  });

  it('resets a paused timer', async () => {
    await click('Start');
    await click('Pause');
    await click('Reset');
    expect(selected('minutes')).toBe('05');
  });

  it('beeps once a second for a minute when time is up', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    await click('1m');
    await click('Start');
    const [audio] = FakeAudioContext.instances;
    expect(audio.resume).toHaveBeenCalled();

    await elapse(60_000);
    expect(audio.started).toEqual([0, 0.25, 0.5]);

    await elapse(ALARM_SECONDS * 1000);
    expect(audio.started).toHaveLength(ALARM_SECONDS * 3);

    await elapse(10_000);
    expect(audio.started).toHaveLength(ALARM_SECONDS * 3);
  });

  it('reuses the audio context across runs', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    await click('Start');
    await click('Reset');
    await click('Start');
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].resume).toHaveBeenCalledTimes(2);
  });

  it('falls back to the prefixed audio context on iOS 12', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', FakeAudioContext);
    await click('Start');
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it('stops the alarm and closes audio when destroyed', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    await click('1m');
    await click('Start');
    await elapse(60_000);
    const [audio] = FakeAudioContext.instances;

    fixture.destroy();
    vi.advanceTimersByTime(5_000);
    expect(audio.started).toHaveLength(3);
    expect(audio.close).toHaveBeenCalled();
  });
});
