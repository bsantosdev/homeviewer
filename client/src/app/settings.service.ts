import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder } from '@microsoft/signalr';
import { firstValueFrom } from 'rxjs';

export interface DashboardSettings {
  title: string;
  message: string;
  theme: 'light' | 'dark';
  locationName: string;
  latitude: number;
  longitude: number;
}

/** The parts of the SignalR connection the service uses; replaceable in tests. */
export type SettingsHub = Pick<HubConnection, 'on' | 'onreconnected' | 'start'>;

export const SETTINGS_HUB = new InjectionToken<SettingsHub>('SETTINGS_HUB', {
  providedIn: 'root',
  factory: () =>
    new HubConnectionBuilder()
      .withUrl(new URL('/hubs/dashboard', inject(DOCUMENT).baseURI).href)
      .withAutomaticReconnect()
      .build(),
});

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  readonly settings = signal<DashboardSettings | null>(null);

  constructor() {
    this.load();

    const hub = inject(SETTINGS_HUB);
    hub.on('SettingsUpdated', (s: DashboardSettings) => {
      this.settings.set(s);
    });
    // Re-fetch after reconnect in case we missed updates (e.g. iPad sleep/wake).
    hub.onreconnected(() => {
      this.load();
    });
    hub.start().catch((err: unknown) => {
      console.error('SignalR connection failed', err);
    });
  }

  async save(settings: DashboardSettings): Promise<void> {
    this.settings.set(
      await firstValueFrom(this.http.put<DashboardSettings>('/api/settings', settings)),
    );
  }

  private load(): void {
    this.http.get<DashboardSettings>('/api/settings').subscribe((s) => {
      this.settings.set(s);
    });
  }
}
