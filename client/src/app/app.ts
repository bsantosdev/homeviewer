import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Maintenance } from './maintenance/maintenance';

@Component({
  selector: 'app-root',
  imports: [Maintenance, RouterOutlet],
  template: '<router-outlet /><app-maintenance />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
