import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { BackgroundsService, backgroundUrl } from '../backgrounds';
import { LANGUAGES, LANGUAGE_NAMES, Text, TextError, TextPipe, isApiError } from '../i18n';
import { en } from '../i18n/en';
import { LightsService, RoomScene } from '../lights.service';
import { DashboardSettings, SettingsService } from '../settings.service';

/** Colours for new calendars, in turn. */
export const CALENDAR_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

@Component({
  selector: 'app-admin',
  imports: [FormsModule, RouterLink, TextPipe, TranslocoPipe],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'block min-h-full bg-[#f7f7f5] text-[#1a1a1a] transition-colors duration-300 dark:bg-[#111] dark:text-[#f2f2f2]',
    '[class.dark]': 'isDark()',
  },
})
export class Admin {
  private readonly service = inject(SettingsService);
  private readonly backgrounds = inject(BackgroundsService);
  protected readonly backgroundUrl = backgroundUrl;
  protected readonly isDark = this.service.isDark;
  protected readonly languages = LANGUAGES;
  protected readonly languageNames = LANGUAGE_NAMES;
  protected readonly form = signal<DashboardSettings | null>(null);
  protected readonly status = signal<Text | null>(null);
  /** Every room's Hue scenes to pick shortcuts from; empty while there's no bridge. */
  protected readonly scenes = signal<RoomScene[]>([]);

  constructor() {
    // Take a copy of the settings once loaded, so edits don't touch the live signal.
    effect(() => {
      const s = this.service.settings();
      if (s && !this.form())
        this.form.set({
          ...s,
          calendars: s.calendars.map((c) => ({ ...c })),
          backgrounds: [...s.backgrounds],
          sceneShortcuts: [...s.sceneShortcuts],
        });
    });
    void this.loadScenes(inject(LightsService));
  }

  protected toggleShortcut(form: DashboardSettings, id: string, on: boolean): void {
    const others = form.sceneShortcuts.filter((s) => s !== id);
    this.form.set({ ...form, sceneShortcuts: on ? [...others, id] : others });
  }

  protected addCalendar(form: DashboardSettings): void {
    this.form.set({
      ...form,
      calendars: [
        ...form.calendars,
        {
          name: '',
          url: '',
          color: CALENDAR_COLORS[form.calendars.length % CALENDAR_COLORS.length],
        },
      ],
    });
  }

  protected removeCalendar(form: DashboardSettings, index: number): void {
    this.form.set({ ...form, calendars: form.calendars.filter((_, i) => i !== index) });
  }

  /** Uploads the picked images one by one. They're kept once the settings are saved. */
  protected async addBackgrounds(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    // Clear the picker, so picking the same file again still counts as a change.
    input.value = '';
    for (let i = 0; i < files.length; i++) {
      this.status.set({ key: 'admin.uploading', params: { number: i + 1, total: files.length } });
      try {
        const name = await this.backgrounds.upload(files[i]);
        this.form.update((f) => f && { ...f, backgrounds: [...f.backgrounds, name] });
      } catch (err: unknown) {
        const reason = reasonFor(err) ?? { key: 'admin.uploadFailedReason' };
        this.status.set({ key: 'admin.uploadFailed', params: { name: files[i].name, reason } });
        return;
      }
    }
    if (files.length) this.status.set({ key: 'admin.saveToKeep' });
  }

  protected removeBackground(form: DashboardSettings, name: string): void {
    this.form.set({ ...form, backgrounds: form.backgrounds.filter((b) => b !== name) });
  }

  private async loadScenes(lights: LightsService): Promise<void> {
    try {
      this.scenes.set(await lights.allScenes());
    } catch {
      // No bridge is set up, or it isn't answering: there's nothing to pick from.
    }
  }

  protected async save(form: DashboardSettings): Promise<void> {
    this.status.set({ key: 'admin.saving' });
    try {
      await this.service.save(form);
      this.status.set({ key: 'admin.saved' });
    } catch (err: unknown) {
      const reason = reasonFor(err);
      this.status.set(
        reason
          ? { key: 'admin.saveFailedReason', params: { reason } }
          : { key: 'admin.saveFailed' },
      );
    }
  }
}

/**
 * The server explains rejected requests with a code, e.g. for a calendar without a web link; the
 * browser's own failures carry a text. Codes this build doesn't know keep the server's own words.
 */
function reasonFor(err: unknown): Text | string | null {
  if (err instanceof HttpErrorResponse) {
    if (err.status !== 400) return null;
    if (isApiError(err.error))
      return err.error.code in en.errors
        ? { key: `errors.${err.error.code}`, params: err.error.values }
        : err.error.message;
    return typeof err.error === 'string' ? err.error : null;
  }
  if (err instanceof TextError) return err.text;
  return err instanceof Error ? err.message : null;
}
