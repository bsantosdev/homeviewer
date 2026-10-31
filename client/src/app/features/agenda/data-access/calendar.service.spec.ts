import { TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import { HttpTestingController } from '@angular/common/http/testing';
import { CalendarEvent, CalendarService } from './calendar.service';
import { provideTestBackend } from '../../../../testing/test-helpers';

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

  describe('the agenda’s events', () => {
    const MARKET: CalendarEvent = {
      title: 'Market',
      calendar: 'Family',
      color: '#ef4444',
      allDay: true,
      start: '2026-10-24',
      end: '2026-10-25',
    };
    let service: CalendarService;
    let events: MockInstance<CalendarService['events']>;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 23, 14, 5));
      TestBed.configureTestingModule({ providers: provideTestBackend() });
      service = TestBed.inject(CalendarService);
      events = vi.spyOn(service, 'events').mockResolvedValue([MARKET]);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('loads a week from local midnight today', async () => {
      // Act
      await service.load();

      // Assert
      expect(events).toHaveBeenCalledWith(new Date(2026, 9, 23), new Date(2026, 9, 30));
      expect(service.upcoming()).toEqual([MARKET]);
    });

    it('logs failures and keeps the last events', async () => {
      // Arrange
      await service.load();
      const error = new Error('offline');
      events.mockRejectedValue(error);
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      // Act
      await service.load();

      // Assert
      expect(log).toHaveBeenCalledWith('Calendar fetch failed', error);
      expect(service.upcoming()).toEqual([MARKET]);
    });

    it('forgets the events when cleared', async () => {
      // Arrange
      await service.load();

      // Act
      service.clear();

      // Assert
      expect(service.upcoming()).toEqual([]);
    });
  });
});
