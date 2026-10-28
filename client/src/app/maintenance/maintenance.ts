import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HugeiconsIconComponent } from '@hugeicons/angular';
import { Loading03Icon, Wrench01Icon } from '@hugeicons/core-free-icons';
import { TranslocoPipe } from '@jsverse/transloco';
import { SettingsService } from '../settings.service';

/**
 * Covers the page while the server is out of reach, e.g. stopped for an update. It goes away by
 * itself once the server answers again.
 */
@Component({
  selector: 'app-maintenance',
  imports: [HugeiconsIconComponent, TranslocoPipe],
  templateUrl: './maintenance.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Maintenance {
  protected readonly offline = computed(() => !this.settings.online());
  protected readonly wrenchIcon = Wrench01Icon;
  protected readonly loadingIcon = Loading03Icon;
  private readonly settings = inject(SettingsService);
}
