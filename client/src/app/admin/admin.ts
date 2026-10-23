import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DashboardSettings, SettingsService } from '../settings.service';

@Component({
  selector: 'app-admin',
  imports: [FormsModule, RouterLink],
  templateUrl: './admin.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mx-auto block max-w-[480px] px-4 py-6 text-base' },
})
export class Admin {
  private readonly service = inject(SettingsService);
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
