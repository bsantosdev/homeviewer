import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { HubConnection, HubConnectionState } from '@microsoft/signalr';
import {
  OFFLINE_GRACE_MS,
  PAGE_RELOAD,
  RETRY_DELAYS_MS,
  SETTINGS_HUB,
  SettingsService,
  retryDelay,
} from './settings.service';
import { FakeHub, TEST_SETTINGS, provideTestBackend } from '../testing/test-helpers';

describe('SETTINGS_HUB', () => {
  it('builds a SignalR connection that is not started yet', () => {
    const hub = TestBed.inject(SETTINGS_HUB) as HubConnection;
    expect(hub).toBeInstanceOf(HubConnection);
    expect(hub.state).toBe(HubConnectionState.Disconnected);
  });
});

describe('PAGE_RELOAD', () => {
  it('reloads the page', () => {
    const reload = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { location: { reload } } }],
    });
    TestBed.inject(PAGE_RELOAD)();
    expect(reload).toHaveBeenCalledTimes(1);
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

  it('is dark until the settings choose the light theme', () => {
    const service = create();
    expect(service.isDark()).toBe(true);

    http.expectOne('/api/settings').flush({ ...TEST_SETTINGS, theme: 'light' });
    expect(service.isDark()).toBe(false);
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

    hub.reconnecting?.();
    hub.reconnected?.('new-id');
    const reloaded = { ...TEST_SETTINGS, message: 'Missed while asleep' };
    http.expectOne('/api/settings').flush(reloaded);
    http.expectOne('/').flush('<html></html>');
    expect(service.settings()).toEqual(reloaded);
  });

  it('logs when the settings can’t be fetched', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = create();

    http.expectOne('/api/settings').flush('Down', { status: 502, statusText: 'Bad Gateway' });

    expect(log).toHaveBeenCalledWith('Settings fetch failed', expect.anything());
    expect(service.settings()).toBeNull();
  });

  it('keeps trying forever, quickly at first', () => {
    expect([0, 1, 2, 3, 4, 50].map(retryDelay)).toEqual([0, 2000, 5000, 10_000, 10_000, 10_000]);
  });

  describe('while the server is down', () => {
    let reload: ReturnType<typeof vi.fn<() => void>>;
    let script: HTMLScriptElement;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      reload = vi.fn();
      TestBed.configureTestingModule({ providers: [{ provide: PAGE_RELOAD, useValue: reload }] });
      script = document.createElement('script');
      script.setAttribute('src', 'main-OLD.js');
      document.body.appendChild(script);
    });

    afterEach(() => {
      script.remove();
      vi.useRealTimers();
    });

    /** Answers the requests a reconnect makes: the settings, then the page to compare builds. */
    function catchUp(page = '<script src="main-OLD.js" type="module"></script>'): void {
      http.expectOne('/api/settings').flush(TEST_SETTINGS);
      http.expectOne('/').flush(page);
    }

    it('says so only after a few seconds, so a quick reconnect doesn’t flash', async () => {
      const service = create();
      http.expectOne('/api/settings').flush(TEST_SETTINGS);

      hub.reconnecting?.();
      hub.reconnecting?.();
      vi.advanceTimersByTime(OFFLINE_GRACE_MS - 1);
      expect(service.online()).toBe(true);
      hub.reconnected?.();
      catchUp();
      vi.advanceTimersByTime(OFFLINE_GRACE_MS);
      expect(service.online()).toBe(true);

      hub.reconnecting?.();
      vi.advanceTimersByTime(OFFLINE_GRACE_MS);
      expect(service.online()).toBe(false);
      hub.reconnected?.();
      catchUp();
      await Promise.resolve();
      expect(service.online()).toBe(true);
      expect(reload).not.toHaveBeenCalled();
    });

    it('reloads the page if a new build went in meanwhile', async () => {
      create();
      http.expectOne('/api/settings').flush(TEST_SETTINGS);

      hub.reconnecting?.();
      hub.reconnected?.();
      catchUp('<script src="scripts-A.js" defer></script><script src="main-NEW.js" type="module">');
      await Promise.resolve();

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('stays on the page if it can’t tell which build is running', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      create();
      http.expectOne('/api/settings').flush(TEST_SETTINGS);

      hub.reconnecting?.();
      hub.reconnected?.();
      http.expectOne('/api/settings').flush(TEST_SETTINGS);
      http.expectOne('/').flush('Down', { status: 502, statusText: 'Bad Gateway' });
      await Promise.resolve();

      expect(log).toHaveBeenCalledWith('Version check failed', expect.anything());
      hub.reconnecting?.();
      hub.reconnected?.();
      catchUp('<p>No scripts here</p>');
      await Promise.resolve();
      expect(reload).not.toHaveBeenCalled();
    });

    it('retries a first connection that fails', async () => {
      const error = new Error('offline');
      hub.startResult = Promise.reject(error);
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const service = create();
      http.expectOne('/api/settings').flush(TEST_SETTINGS);
      await Promise.resolve();

      expect(log).toHaveBeenCalledWith('SignalR connection failed', error);
      vi.advanceTimersByTime(OFFLINE_GRACE_MS);
      expect(service.online()).toBe(false);

      hub.startResult = Promise.resolve();
      vi.advanceTimersByTime(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
      await Promise.resolve();
      await Promise.resolve();

      expect(hub.starts).toBe(2);
      expect(service.online()).toBe(true);
      catchUp();
    });
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
