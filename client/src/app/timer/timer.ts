import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { WheelPicker } from '../wheel-picker/wheel-picker';

type TimerState = 'setup' | 'running' | 'paused' | 'done';

interface LegacyWindow {
  webkitAudioContext?: typeof AudioContext;
}

const PRESET_MINUTES = [1, 3, 5, 10, 15, 30];
export const ALARM_SECONDS = 60;

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// iOS 12 only has the prefixed constructor.
function audioContextClass(): typeof AudioContext | undefined {
  return (
    (window as Partial<typeof window>).AudioContext ?? (window as LegacyWindow).webkitAudioContext
  );
}

@Component({
  selector: 'app-timer',
  imports: [TranslocoPipe, WheelPicker],
  templateUrl: './timer.html',
  styleUrl: './timer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block select-none' },
})
export class Timer {
  protected readonly presets = PRESET_MINUTES;
  protected readonly state = signal<TimerState>('setup');
  protected readonly minutes = signal(5);
  protected readonly seconds = signal(0);
  protected readonly duration = computed(() => this.minutes() * 60 + this.seconds());
  protected readonly remaining = signal(0);
  protected readonly display = computed(() => formatTime(this.remaining()));

  // Track the end time rather than counting ticks, so the countdown stays
  // accurate even if the browser throttles timers.
  private endsAt = 0;
  private tick?: ReturnType<typeof setInterval>;
  private alarm?: ReturnType<typeof setInterval>;
  private audio?: AudioContext;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopTimers();
      void this.audio?.close();
    });
  }

  protected setPreset(minutes: number): void {
    this.minutes.set(minutes);
    this.seconds.set(0);
  }

  // The Start button is disabled while the duration is 00:00.
  protected start(): void {
    this.unlockAudio();
    this.remaining.set(this.duration());
    this.run();
  }

  protected pause(): void {
    clearInterval(this.tick);
    this.update();
    this.state.set('paused');
  }

  protected resume(): void {
    this.run();
  }

  protected reset(): void {
    this.stopTimers();
    this.state.set('setup');
  }

  private run(): void {
    this.endsAt = Date.now() + this.remaining() * 1000;
    this.state.set('running');
    this.tick = setInterval(() => {
      this.update();
    }, 250);
  }

  private update(): void {
    const left = Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
    this.remaining.set(left);
    if (left === 0 && this.state() === 'running') this.finish();
  }

  private finish(): void {
    clearInterval(this.tick);
    this.state.set('done');
    let beeps = 0;
    this.beep();
    this.alarm = setInterval(() => {
      if (++beeps >= ALARM_SECONDS) clearInterval(this.alarm);
      else this.beep();
    }, 1000);
  }

  private stopTimers(): void {
    clearInterval(this.tick);
    clearInterval(this.alarm);
  }

  // iOS only allows audio that was started by a user gesture, so the
  // AudioContext is created (or resumed) when Start is tapped.
  private unlockAudio(): void {
    const AudioCtx = audioContextClass();
    if (!AudioCtx) return;
    this.audio ??= new AudioCtx();
    void this.audio.resume();
  }

  private beep(): void {
    const ctx = this.audio;
    if (!ctx) return;
    for (const offset of [0, 0.25, 0.5]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.3;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.15);
    }
  }
}
