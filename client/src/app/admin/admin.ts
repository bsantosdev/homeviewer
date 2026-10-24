import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DashboardSettings, SettingsService } from '../settings.service';

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
      if (s && !this.form()) this.form.set({ ...s });
    });
  }

  protected async save(form: DashboardSettings): Promise<void> {
    this.status.set('Saving…');
    try {
      await this.service.save(form);
      this.status.set('Saved');
    } catch {
      this.status.set('Save failed');
    }
  }
}
