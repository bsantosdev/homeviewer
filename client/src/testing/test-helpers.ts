import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { DashboardSettings, SETTINGS_HUB, SettingsHub } from '../app/settings.service';

export const TEST_SETTINGS: DashboardSettings = {
  title: 'Home',
  message: 'Welcome home!',
  theme: 'dark',
  locationName: 'Lisbon',
  latitude: 38.72,
  longitude: -9.14,
  calendars: [],
  backgrounds: [],
  backgroundMinutes: 10,
};

/** A stand-in for the SignalR connection that lets tests fire hub events. */
export class FakeHub implements SettingsHub {
  readonly handlers = new Map<string, (...args: unknown[]) => void>();
  reconnected?: (connectionId?: string) => void;
  startResult: Promise<void> = Promise.resolve();

  on(method: string, handler: (...args: unknown[]) => void): void {
    this.handlers.set(method, handler);
  }

  onreconnected(callback: (connectionId?: string) => void): void {
    this.reconnected = callback;
  }

  start(): Promise<void> {
    return this.startResult;
  }

  emit(method: string, ...args: unknown[]): void {
    this.handlers.get(method)?.(...args);
  }
}

/** HttpClient backed by HttpTestingController, plus a fake SignalR hub. */
export function provideTestBackend(hub = new FakeHub()) {
  return [
    provideHttpClient(),
    provideHttpClientTesting(),
    { provide: SETTINGS_HUB, useValue: hub },
  ];
}

/** Like querySelector, but throws if nothing matches or the element has the wrong type. */
export function query<T extends Element = HTMLElement>(
  root: Element,
  selector: string,
  type: abstract new () => T = HTMLElement as unknown as abstract new () => T,
): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`No element matches "${selector}"`);
  if (!(el instanceof type)) throw new Error(`"${selector}" is not a ${type.name}`);
  return el;
}

/** Finds a button by its trimmed text. */
export function button(root: Element, label: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll('button')).find(
    (b) => b.textContent.trim() === label,
  );
  if (!match) throw new Error(`No button labelled "${label}"`);
  return match;
}

export function text(root: Element, selector: string): string {
  return query(root, selector).textContent.trim();
}

/**
 * jsdom never loads images. This makes each one load on the next tick, with the given size, or fail when
 * `fails` says so. Restore it with `vi.restoreAllMocks()`.
 */
export function fakeImageLoading(
  options: { width?: number; height?: number; fails?: (url: string) => boolean } = {},
): void {
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(options.width ?? 100);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(
    options.height ?? 100,
  );
  vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (
    this: HTMLImageElement,
    url: string,
  ) {
    setTimeout(() => {
      if (options.fails?.(url)) this.onerror?.(new Event('error'));
      else this.onload?.(new Event('load'));
    });
  });
}

/** Lets pending timers and promises run, then lets Angular render. */
export async function settle(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
}
