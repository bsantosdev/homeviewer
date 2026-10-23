import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { HubConnectionBuilder } from '@microsoft/signalr';
import { firstValueFrom } from 'rxjs';

export interface DashboardSettings {
  title: string;
  message: string;
  theme: 'light' | 'dark';
  locationName: string;
  latitude: number;
  longitude: number;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  readonly settings = signal<DashboardSettings | null>(null);

  constructor() {
    this.load();

    const hub = new HubConnectionBuilder().withUrl('/hubs/dashboard').withAutomaticReconnect().build();
    hub.on('SettingsUpdated', (s: DashboardSettings) => this.settings.set(s));
    // Re-fetch after reconnect in case we missed updates (e.g. iPad sleep/wake).
    hub.onreconnected(() => this.load());
    hub.start().catch((err) => console.error('SignalR connection failed', err));
  }

  async save(settings: DashboardSettings): Promise<void> {
    this.settings.set(await firstValueFrom(this.http.put<DashboardSettings>('/api/settings', settings)));
  }

  private load(): void {
    this.http.get<DashboardSettings>('/api/settings').subscribe((s) => this.settings.set(s));
  }
}
