import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { Text, isApiError } from './i18n';
import { en } from './i18n/en';

/** A song, or a podcast episode. */
export interface PlayingItem {
  name: string;
  /** The artists, or the podcast. */
  by: string;
  album: string | null;
  /** The cover, about 300 pixels wide. */
  image: string | null;
  durationMs: number;
}

/** Somewhere Spotify can play: a speaker, phone, computer or TV. */
export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  /** Null if it can't be changed from here. */
  volume: number | null;
}

export interface Playback {
  isPlaying: boolean;
  /** How far into the item, when the server asked Spotify. */
  progressMs: number;
  /** Null while Spotify can't say, e.g. during an ad. */
  item: PlayingItem | null;
  device: SpotifyDevice | null;
}

export interface SpotifyStatus {
  connected: boolean;
  /** Null while nothing is playing or paused anywhere. */
  playback: Playback | null;
}

export interface Playlist {
  /** What to play it with, e.g. "spotify:playlist:…". */
  uri: string;
  name: string;
  image: string | null;
}

/** How often to ask what's playing. The server shares Spotify's answer between screens for a few seconds. */
export const MUSIC_REFRESH_MS = 5 * 1000;
/** How long Spotify takes to show a command's effect. */
export const COMMAND_REFRESH_MS = 1000;
/** How much the volume buttons change it by, in percent. */
export const VOLUME_STEP = 10;

@Injectable({ providedIn: 'root' })
export class SpotifyService {
  private readonly http = inject(HttpClient);
  /** Null until loaded, and while the server has no Spotify app set up. */
  readonly status = signal<SpotifyStatus | null>(null);
  /** When the status was read, so progress can move along between reads. */
  readonly readAt = signal(0);
  /** Why the last command failed, until the next one. */
  readonly error = signal<Text | null>(null);

  async load(): Promise<void> {
    try {
      const status = await firstValueFrom(this.http.get<SpotifyStatus>('/api/spotify'));
      this.status.set(status);
      this.readAt.set(Date.now());
    } catch (err: unknown) {
      // 503 means Spotify isn't set up, which isn't an error. Otherwise keep showing the last
      // known state: Spotify may just be slow to answer.
      if (err instanceof HttpErrorResponse && err.status === 503) this.status.set(null);
      else console.error('Spotify fetch failed', err);
    }
  }

  /** Resumes, or plays a playlist; on the given device, or the one playing now. */
  play(contextUri?: string, deviceId?: string): Promise<void> {
    if (!contextUri) this.preview({ isPlaying: true });
    return this.send(this.http.post('/api/spotify/play', { contextUri, deviceId }));
  }

  pause(): Promise<void> {
    this.preview({ isPlaying: false });
    return this.send(this.http.post('/api/spotify/pause', null));
  }

  next(): Promise<void> {
    return this.send(this.http.post('/api/spotify/next', null));
  }

  previous(): Promise<void> {
    return this.send(this.http.post('/api/spotify/previous', null));
  }

  setVolume(percent: number): Promise<void> {
    const volume = Math.min(100, Math.max(0, percent));
    const device = this.status()?.playback?.device;
    if (device) this.preview({ device: { ...device, volume } });
    return this.send(this.http.put('/api/spotify/volume', { percent: volume }));
  }

  /** Moves playback to another device, and keeps it playing there. */
  transfer(deviceId: string): Promise<void> {
    return this.send(this.http.put('/api/spotify/device', { id: deviceId }));
  }

  devices(): Promise<SpotifyDevice[]> {
    return firstValueFrom(this.http.get<SpotifyDevice[]>('/api/spotify/devices'));
  }

  playlists(): Promise<Playlist[]> {
    return firstValueFrom(this.http.get<Playlist[]>('/api/spotify/playlists'));
  }

  async disconnect(): Promise<void> {
    await firstValueFrom(this.http.delete('/api/spotify/login'));
    await this.load();
  }

  /** Shows a change straight away, before Spotify confirms it. */
  private preview(change: Partial<Playback>): void {
    const status = this.status();
    if (status?.playback)
      this.status.set({ ...status, playback: { ...status.playback, ...change } });
  }

  /** Sends a command, then reads back what it did, or the real state if it failed. */
  private async send(request: Observable<unknown>): Promise<void> {
    this.error.set(null);
    try {
      await firstValueFrom(request);
    } catch (err: unknown) {
      console.error('Spotify command failed', err);
      this.error.set(reasonFor(err));
    }
    setTimeout(() => {
      void this.load();
    }, COMMAND_REFRESH_MS);
  }
}

/** The server explains what Spotify couldn't do with a code; anything else is a plain failure. */
function reasonFor(err: unknown): Text {
  return err instanceof HttpErrorResponse && isApiError(err.error) && err.error.code in en.errors
    ? { key: `errors.${err.error.code}` }
    : { key: 'music.failed' };
}
