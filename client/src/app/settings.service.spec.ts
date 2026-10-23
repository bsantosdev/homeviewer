import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { HubConnection, HubConnectionState } from '@microsoft/signalr';
import { SETTINGS_HUB, SettingsService } from './settings.service';
import { FakeHub, TEST_SETTINGS, provideTestBackend } from '../testing/test-helpers';

describe('SETTINGS_HUB', () => {
  it('builds a SignalR connection that is not started yet', () => {
    const hub = TestBed.inject(SETTINGS_HUB) as HubConnection;
    expect(hub).toBeInstanceOf(HubConnection);
    expect(hub.state).toBe(HubConnectionState.Disconnected);
  });
});

describe('SettingsService', () => {
  let hub: FakeHub;
  let http: HttpTestingController;

  function create(): SettingsService {
    TestBed.configureTestingModule({ providers: provideTestBackend(hub) });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(SettingsService);
  }

  beforeEach(() => {
    hub = new FakeHub();
  });

  afterEach(() => {
    http.verify();
  });

  it('loads the settings on start', () => {
    const service = create();
    expect(service.settings()).toBeNull();

    http.expectOne('/api/settings').flush(TEST_SETTINGS);
    expect(service.settings()).toEqual(TEST_SETTINGS);
  });

  it('applies settings pushed through the hub', () => {
    const service = create();
    http.expectOne('/api/settings').flush(TEST_SETTINGS);

    const pushed = { ...TEST_SETTINGS, title: 'Pushed' };
    hub.emit('SettingsUpdated', pushed);
    expect(service.settings()).toEqual(pushed);
  });

  it('reloads the settings after reconnecting', () => {
    const service = create();
    http.expectOne('/api/settings').flush(TEST_SETTINGS);

    hub.reconnected?.('new-id');
    const reloaded = { ...TEST_SETTINGS, message: 'Missed while asleep' };
    http.expectOne('/api/settings').flush(reloaded);
    expect(service.settings()).toEqual(reloaded);
  });

  it('logs when the hub fails to connect', async () => {
    const error = new Error('offline');
    hub.startResult = Promise.reject(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    create();
    http.expectOne('/api/settings').flush(TEST_SETTINGS);
    await Promise.resolve();

    expect(log).toHaveBeenCalledWith('SignalR connection failed', error);
  });

  it('saves settings and keeps the server response', async () => {
    const service = create();
    http.expectOne('/api/settings').flush(TEST_SETTINGS);

    const changed = { ...TEST_SETTINGS, theme: 'light' as const };
    const saving = service.save(changed);
    const req = http.expectOne({ method: 'PUT', url: '/api/settings' });
    expect(req.request.body).toEqual(changed);
    req.flush(changed);
    await saving;

    expect(service.settings()).toEqual(changed);
  });
});
