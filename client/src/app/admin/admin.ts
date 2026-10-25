import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DashboardSettings, SettingsService } from '../settings.service';

/** Colours for new calendars, in turn. */
export const CALENDAR_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

@Component({
  selector: 'app-admin',
  imports: [FormsModule, RouterLink],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'block min-h-full bg-[#f7f7f5] text-[#1a1a1a] transition-colors duration-300 dark:bg-[#111] dark:text-[#f2f2f2]',
    '[class.dark]': 'isDark()',
  },
})
export class Admin {
  private readonly service = inject(SettingsService);
  protected readonly isDark = this.service.isDark;
  protected readonly form = signal<DashboardSettings | null>(null);
  protected readonly status = signal('');

  constructor() {
    // Take a copy of the settings once loaded, so edits don't touch the live signal.
    effect(() => {
      const s = this.service.settings();
      if (s && !this.form()) this.form.set({ ...s, calendars: s.calendars.map((c) => ({ ...c })) });
    });
  }

  protected addCalendar(form: DashboardSettings): void {
    this.form.set({
      ...form,
      calendars: [
        ...form.calendars,
        {
          name: '',
          url: '',
          color: CALENDAR_COLORS[form.calendars.length % CALENDAR_COLORS.length],
        },
      ],
    });
  }

  protected removeCalendar(form: DashboardSettings, index: number): void {
    this.form.set({ ...form, calendars: form.calendars.filter((_, i) => i !== index) });
  }

  protected async save(form: DashboardSettings): Promise<void> {
    this.status.set('Saving…');
    try {
      await this.service.save(form);
      this.status.set('Saved');
    } catch (err: unknown) {
      // The server explains rejected settings, e.g. a calendar without a web link.
      const reason =
        err instanceof HttpErrorResponse && err.status === 400 && typeof err.error === 'string'
          ? err.error
          : '';
      this.status.set(reason ? `Save failed: ${reason}` : 'Save failed');
    }
  }
}
