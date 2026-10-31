import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** A room from the Hue app, from /api/rooms. Switched, dimmed and coloured as a whole. */
export interface Room {
  id: string;
  name: string;
  /** True if any of its lights is on. */
  on: boolean;
  /** The average of the lights that are on (0 while all are off), or null if none can dim. */
  brightness: number | null;
  /**
   * What the lights that are on look like, as "#rrggbb" at full brightness: up to three, one per
   * distinct colour. Empty while the room is off, or if its lights can only dim.
   */
  colors: string[];
  /** The white its lights are set to, in kelvin, or null if none is in white mode. */
  temperature: number | null;
  /** Whether any of its lights can show colours, not just whites. */
  canColor: boolean;
}

/** One of a room's scenes from the Hue app. */
export interface Scene {
  id: string;
  name: string;
  /** A preview: up to four of the colours it sets, as "#rrggbb". */
  colors: string[];
}

/** A scene with the name of its room, for picking shortcuts across rooms. */
export interface RoomScene extends Scene {
  room: string;
}

/** What to change on a room; leave a value out to keep it. Send a temperature or a colour, not both. */
export interface RoomChange {
  on?: boolean;
  /** 1–100 percent. */
  brightness?: number;
  /** A white, in kelvin, from MIN_KELVIN to MAX_KELVIN. */
  temperature?: number;
  /** "#rrggbb". Lights that can only do whites ignore it. */
  color?: string;
}

export const MIN_KELVIN = 2000;
export const MAX_KELVIN = 6500;
/**
 * How long to wait before reading back a room's colours after changing them. The lights fade over
 * a moment, and only the bridge knows what a mixed room ends up looking like.
 */
export const COLOR_REFRESH_MS = 1000;

@Injectable({ providedIn: 'root' })
export class LightsService {
  private readonly http = inject(HttpClient);
  /** Null until loaded, and while the server has no Hue bridge set up. */
  readonly rooms = signal<Room[] | null>(null);

  async load(): Promise<void> {
    try {
      this.rooms.set(await firstValueFrom(this.http.get<Room[]>('/api/rooms')));
    } catch (err: unknown) {
      // 503 means no bridge is configured, which isn't an error. Otherwise keep showing the
      // last known state: the bridge may just be restarting.
      if (err instanceof HttpErrorResponse && err.status === 503) this.rooms.set(null);
      else console.error('Lights fetch failed', err);
    }
  }

  /** Shows the change straight away, without sending it. Used while a room is being swiped. */
  preview(id: string, change: RoomChange): void {
    const { color, ...rest } = change;
    this.rooms.update(
      (rooms) =>
        rooms?.map((room) =>
          room.id === id ? { ...room, ...rest, ...(color ? { colors: [color] } : {}) } : room,
        ) ?? null,
    );
  }

  /** Shows the change straight away, then sends it. If the bridge refuses, reloads the real state. */
  async change(id: string, change: RoomChange): Promise<void> {
    this.preview(id, change);
    try {
      await firstValueFrom(this.http.put(`/api/rooms/${id}`, change));
      if (change.temperature !== undefined || change.color !== undefined) this.refreshSoon();
    } catch (err: unknown) {
      console.error('Light change failed', err);
      await this.load();
    }
  }

  /** Turns off every room that's on. */
  async allOff(): Promise<void> {
    const on = (this.rooms() ?? []).filter((room) => room.on);
    await Promise.all(on.map((room) => this.change(room.id, { on: false })));
  }

  scenes(roomId: string): Promise<Scene[]> {
    return firstValueFrom(this.http.get<Scene[]>(`/api/rooms/${roomId}/scenes`));
  }

  /** Every room's scenes, by room and name. */
  allScenes(): Promise<RoomScene[]> {
    return firstValueFrom(this.http.get<RoomScene[]>('/api/scenes'));
  }

  /** Turns the scene on, then reads back how its room looks. */
  async recall(sceneId: string): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`/api/scenes/${sceneId}/recall`, null));
      this.refreshSoon();
    } catch (err: unknown) {
      console.error('Scene recall failed', err);
    }
  }

  private refreshSoon(): void {
    setTimeout(() => {
      void this.load();
    }, COLOR_REFRESH_MS);
  }
}
