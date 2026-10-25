import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { CalendarEvent, CalendarService } from './calendar.service';
import { provideTestBackend } from '../testing/test-helpers';

describe('CalendarService', () => {
  it('asks the server for events in a UTC range', async () => {
    TestBed.configureTestingModule({ providers: provideTestBackend() });
    const http = TestBed.inject(HttpTestingController);
    const event: CalendarEvent = {
      title: 'Dentist',
      calendar: 'Me',
      color: '#3b82f6',
      allDay: false,
      start: '2026-10-24T08:30:00Z',
      end: '2026-10-24T09:00:00Z',
    };

    const events = TestBed.inject(CalendarService).events(
      new Date(Date.UTC(2026, 9, 23, 22)),
      new Date(Date.UTC(2026, 9, 25, 23)),
    );
    const req = http.expectOne((r) => r.url === '/api/events');
    expect(req.request.params.get('from')).toBe('2026-10-23T22:00:00.000Z');
    expect(req.request.params.get('to')).toBe('2026-10-25T23:00:00.000Z');
    req.flush([event]);

    expect(await events).toEqual([event]);
    http.verify();
  });
});
