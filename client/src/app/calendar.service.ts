import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** One occurrence from /api/events. */
export interface CalendarEvent {
  title: string;
  calendar: string;
  /** The calendar's badge colour, as "#rrggbb". */
  color: string;
  allDay: boolean;
  /**
   * A UTC time ("2026-10-24T08:30:00Z"); a date ("2026-10-24") for all-day events; or, for times the
   * feed gives without a time zone, a local wall-clock time ("2026-10-24T18:00:00").
   */
  start: string;
  /** The exclusive end, in the same form as `start`. */
  end: string;
}

@Injectable({ providedIn: 'root' })
export class CalendarService {
  private readonly http = inject(HttpClient);

  events(from: Date, to: Date): Promise<CalendarEvent[]> {
    return firstValueFrom(
      this.http.get<CalendarEvent[]>('/api/events', {
        // UTC with "Z": Angular leaves "+" unencoded, which the server would read as a space.
        params: { from: from.toISOString(), to: to.toISOString() },
      }),
    );
  }
}
