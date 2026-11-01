import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import localePt from '@angular/common/locales/pt';
import {
  ChangeDetectorRef,
  Injectable,
  Pipe,
  PipeTransform,
  inject,
  isDevMode,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Translation,
  TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of, switchMap } from 'rxjs';
import { de } from './i18n/de';
import { en } from './i18n/en';
import { ptBR } from './i18n/pt-BR';

export const LANGUAGES = ['en', 'pt-BR', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';

/** Each language by its own name, for the picker in the admin page. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
  de: 'Deutsch',
};

const TRANSLATIONS: Record<Language, Translation> = { en, 'pt-BR': ptBR, de };

// For dates. Angular reads "pt-BR" from "pt", whose data is Brazilian Portuguese.
registerLocaleData(localeDe);
registerLocaleData(localePt);

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((lang) => lang === value);
}

/** Values filled into a text's `{{ name }}` placeholders; a value can be a text to translate too. */
export type Params = Record<string, unknown>;

/** A text to translate, worked out in code and translated where it's shown. */
export interface Text {
  key: string;
  params?: Params;
}

function isText(value: unknown): value is Text {
  return typeof value === 'object' && value !== null && typeof (value as Text).key === 'string';
}

/**
 * Shows a {@link Text} in the current language, and again whenever the language changes. Use it
 * rather than translating in code, which can run before the new language's texts are loaded.
 */
@Pipe({ name: 'text', pure: false })
export class TextPipe implements PipeTransform {
  private readonly transloco = inject(TranslocoService);

  constructor() {
    const changes = inject(ChangeDetectorRef);
    this.transloco.langChanges$
      .pipe(
        switchMap((lang) => this.transloco.load(lang)),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        changes.markForCheck();
      });
  }

  transform(text: Text | null): string {
    if (!text) return '';
    const params = text.params && { ...text.params };
    for (const name in params) {
      const value = params[name];
      if (isText(value)) params[name] = this.transform(value);
    }
    return this.transloco.translate(text.key, params);
  }
}

/** An error to show the user, whose message is a translation key. */
export class TextError extends Error {
  constructor(readonly text: Text) {
    super(text.key);
    this.name = 'TextError';
  }
}

/** How the server explains a rejected request: `code` is a key under `errors`. */
export interface ApiError {
  code: string;
  message: string;
  values?: Params;
}

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ApiError>).code === 'string' &&
    typeof (value as Partial<ApiError>).message === 'string'
  );
}

/**
 * The texts are part of the app, not fetched: they're small, and the wall iPad must still be able to
 * say it's lost the server.
 */
@Injectable({ providedIn: 'root' })
export class BundledLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(isLanguage(lang) ? TRANSLATIONS[lang] : TRANSLATIONS[DEFAULT_LANGUAGE]);
  }
}

export function provideI18n() {
  return provideTransloco({
    config: {
      availableLangs: [...LANGUAGES],
      defaultLang: DEFAULT_LANGUAGE,
      fallbackLang: DEFAULT_LANGUAGE,
      missingHandler: { useFallbackTranslation: true },
      reRenderOnLangChange: true,
      prodMode: !isDevMode(),
    },
    loader: BundledLoader,
  });
}
