import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TextPipe } from '../../core/i18n';
import { SettingsService } from '../../core/settings.service';
import { agenda } from './agenda';
import { CalendarService } from './data-access/calendar.service';

/** The agenda card on home: the week's events by day, each badged with its calendar. */
@Component({
  selector: 'app-agenda-widget',
  imports: [DatePipe, TextPipe, TranslocoPipe],
  templateUrl: './agenda-widget.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class AgendaWidget {
  /** The dashboard's clock, so "Today" turns over at midnight. */
  readonly now = input.required<Date>();
  private readonly events = inject(CalendarService).upcoming;
  protected readonly language = inject(SettingsService).language;
  protected readonly agenda = computed(() => agenda(this.events(), this.now()));
}
