import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { HugeiconsIconComponent } from '@hugeicons/angular';
import { Leaf01Icon, SunglassesIcon, UmbrellaIcon } from '@hugeicons/core-free-icons';
import { TranslocoPipe } from '@jsverse/transloco';
import { TextPipe } from '../../core/i18n';
import { SettingsService } from '../../core/settings.service';
import { WeatherService } from './data-access/weather.service';
import { weatherIconFor } from './weather-icons';

/**
 * The weather card on home: now, today's range, UV and air, when rain comes, and the next days.
 * The space stays taken while the weather loads, so the clock above doesn't move.
 */
@Component({
  selector: 'app-weather-widget',
  imports: [DatePipe, HugeiconsIconComponent, TextPipe, TranslocoPipe],
  templateUrl: './weather-widget.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-[3vh] flex min-h-0 flex-1 flex-col' },
})
export class WeatherWidget {
  protected readonly weather = inject(WeatherService).weather;
  private readonly settingsService = inject(SettingsService);
  protected readonly settings = this.settingsService.settings;
  protected readonly language = this.settingsService.language;
  protected readonly weatherIconFor = weatherIconFor;
  protected readonly umbrellaIcon = UmbrellaIcon;
  protected readonly uvIcon = SunglassesIcon;
  protected readonly airIcon = Leaf01Icon;
}
