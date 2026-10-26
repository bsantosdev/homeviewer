import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder } from '@microsoft/signalr';
import { firstValueFrom } from 'rxjs';

export interface DashboardSettings {
  title: string;
  message: string;
  theme: 'light' | 'dark';
  locationName: string;
  latitude: number;
  longitude: number;
  calendars: CalendarFeed[];
  /** Uploaded images shown behind the dashboard, in turn (see `backgroundUrl`). */
  backgrounds: string[];
  /** How long each background shows, in minutes. */
  backgroundMinutes: number;
  /** Whether the dashboard dims to a small clock on black from `nightStart` to `nightEnd`. */
  nightMode: boolean;
  /** "HH:mm", local time. Later than `nightEnd` when the night runs past midnight. */
  nightStart: string;
  nightEnd: string;
}

/** A published Outlook (ICS) calendar. The server downloads it; the link stays private to the home network. */
export interface CalendarFeed {
  name: string;
  url: string;
  /** Badge colour on the dashboard, as "#rrggbb". */
  color: string;
}

/**
 * How long the server can be out of reach before the page says it's under maintenance. Waking the
 * iPad also drops the connection for a moment, and that shouldn't flash the alert.
 */
export const OFFLINE_GRACE_MS = 5000;

/** Waits between tries while the server is down: quick at first, then every 10 seconds for good. */
export const RETRY_DELAYS_MS = [0, 2000, 5000, 10_000];

export function retryDelay(previousRetryCount: number): number {
  return RETRY_DELAYS_MS[Math.min(previousRetryCount, RETRY_DELAYS_MS.length - 1)];
}

/** The parts of the SignalR connection the service uses; replaceable in tests. */
export type SettingsHub = Pick<HubConnection, 'on' | 'onreconnecting' | 'onreconnected' | 'start'>;

export const SETTINGS_HUB = new InjectionToken<SettingsHub>('SETTINGS_HUB', {
  providedIn: 'root',
  factory: () =>
    new HubConnectionBuilder()
      .withUrl(new URL('/hubs/dashboard', inject(DOCUMENT).baseURI).href)
      // The default gives up after four tries; a wall screen should keep trying until the server is back.
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (context) => retryDelay(context.previousRetryCount),
      })
      .build(),
});

/** Reloads the page; replaceable in tests, where jsdom can't. */
export const PAGE_RELOAD = new InjectionToken<() => void>('PAGE_RELOAD', {
  providedIn: 'root',
  factory: () => {
    const location = inject(DOCUMENT).location;
    return () => {
      location.reload();
    };
  },
});

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly reload = inject(PAGE_RELOAD);
  readonly settings = signal<DashboardSettings | null>(null);
  /** Dark until the settings say otherwise, so the first paint doesn't flash white. */
  readonly isDark = computed(() => (this.settings()?.theme ?? 'dark') === 'dark');
  /** False once the server has been out of reach for a while, e.g. while it's stopped for maintenance. */
  readonly online = signal(true);

  private down = false;
  private offlineTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.load();

    const hub = inject(SETTINGS_HUB);
    hub.on('SettingsUpdated', (s: DashboardSettings) => {
      this.settings.set(s);
    });
    hub.onreconnecting(() => {
      this.lost();
    });
    hub.onreconnected(() => {
      this.back();
    });
    this.connect(hub);
  }

  async save(settings: DashboardSettings): Promise<void> {
    this.settings.set(
      await firstValueFrom(this.http.put<DashboardSettings>('/api/settings', settings)),
    );
  }

  /** SignalR only retries a connection it once had, so the first one is retried here. */
  private connect(hub: SettingsHub): void {
    hub.start().then(
      () => {
        this.back();
      },
      (err: unknown) => {
        console.error('SignalR connection failed', err);
        this.lost();
        setTimeout(
          () => {
            this.connect(hub);
          },
          RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1],
        );
      },
    );
  }

  private lost(): void {
    if (this.down) return;
    this.down = true;
    this.offlineTimer = setTimeout(() => {
      this.online.set(false);
    }, OFFLINE_GRACE_MS);
  }

  private back(): void {
    clearTimeout(this.offlineTimer);
    this.online.set(true);
    if (!this.down) return;
    this.down = false;
    // Catch up on anything missed while away (e.g. iPad sleep/wake, or a server restart).
    this.load();
    void this.reloadIfUpdated();
  }

  /** A new build may have gone in while the server was down: its index.html names a different script. */
  private async reloadIfUpdated(): Promise<void> {
    const running = mainScript(this.document.documentElement.outerHTML);
    try {
      const latest = mainScript(await firstValueFrom(this.http.get('/', { responseType: 'text' })));
      if (running && latest && running !== latest) this.reload();
    } catch (err: unknown) {
      console.error('Version check failed', err);
    }
  }

  private load(): void {
    this.http.get<DashboardSettings>('/api/settings').subscribe({
      next: (s) => {
        this.settings.set(s);
      },
      error: (err: unknown) => {
        console.error('Settings fetch failed', err);
      },
    });
  }
}

/** The app's hashed script name in a page, e.g. "main-SXST2NWV.js". */
function mainScript(html: string): string | null {
  return /<script[^>]+src="([^"]*main[^"]*\.js)"/.exec(html)?.[1] ?? null;
}
