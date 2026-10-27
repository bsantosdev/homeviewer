import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { SETTINGS_HUB, SettingsService } from './settings.service';

/** Something to buy. Ticked items stay on the list, struck through, until they're cleared. */
export interface ShoppingItem {
  id: string;
  text: string;
  done: boolean;
}

/** The shared shopping list. Changes from any screen reach every other one through the hub. */
@Injectable({ providedIn: 'root' })
export class ShoppingService {
  private readonly http = inject(HttpClient);
  readonly items = signal<ShoppingItem[]>([]);
  /** How many things are still to buy. */
  readonly open = computed(() => this.items().filter((item) => !item.done).length);

  constructor() {
    // The settings service owns the connection: injecting it makes sure it's started.
    const settings = inject(SettingsService);
    inject(SETTINGS_HUB).on('ShoppingUpdated', (items: ShoppingItem[]) => {
      this.items.set(items);
    });
    // Loads the list, and again whenever the connection comes back, for changes made meanwhile.
    effect(() => {
      settings.reconnects();
      void this.load();
    });
  }

  async load(): Promise<void> {
    try {
      this.items.set(await firstValueFrom(this.http.get<ShoppingItem[]>('/api/shopping')));
    } catch (err: unknown) {
      console.error('Shopping list fetch failed', err);
    }
  }

  /** Rejects if the server doesn't take it, so the text can stay in the field. */
  async add(text: string): Promise<void> {
    this.items.set(await firstValueFrom(this.http.post<ShoppingItem[]>('/api/shopping', { text })));
  }

  /** Shows the tick straight away, then sends it. If the server refuses, reloads the real list. */
  async toggle(item: ShoppingItem): Promise<void> {
    const done = !item.done;
    this.items.update((items) => items.map((i) => (i.id === item.id ? { ...i, done } : i)));
    await this.send(this.http.put<ShoppingItem[]>(`/api/shopping/${item.id}`, { done }));
  }

  async clearDone(): Promise<void> {
    this.items.update((items) => items.filter((i) => !i.done));
    await this.send(this.http.delete<ShoppingItem[]>('/api/shopping/done'));
  }

  private async send(request: Observable<ShoppingItem[]>): Promise<void> {
    try {
      this.items.set(await firstValueFrom(request));
    } catch (err: unknown) {
      console.error('Shopping list change failed', err);
      await this.load();
    }
  }
}
