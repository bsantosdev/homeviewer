import { firstValueFrom } from 'rxjs';
import { BundledLoader, LANGUAGES, TextError, isApiError, isLanguage } from './i18n';
import { en } from './i18n/en';

/** Every text by its full key, e.g. "lights.onCount". */
function texts(messages: object, prefix = ''): [string, string][] {
  return Object.entries(messages).flatMap(([name, value]: [string, unknown]) =>
    typeof value === 'string'
      ? [[prefix + name, value] as [string, string]]
      : texts(value as object, `${prefix}${name}.`),
  );
}

function placeholders(text: string): string[] {
  return (text.match(/{{ \w+ }}/g) ?? []).sort();
}

describe('translations', () => {
  const loader = new BundledLoader();

  it.each(LANGUAGES)('fill in the same values in %s as in English', async (lang) => {
    const english = new Map(texts(en));
    const translated = texts(await firstValueFrom(loader.getTranslation(lang)));

    expect(translated.map(([key]) => key)).toEqual([...english.keys()]);
    for (const [key, text] of translated) {
      expect(text, key).not.toBe('');
      expect(placeholders(text), key).toEqual(placeholders(english.get(key) ?? ''));
    }
  });

  it('fall back to English for a language the app has no texts for', async () => {
    expect(await firstValueFrom(loader.getTranslation('fr'))).toBe(en);
  });
});

describe('isLanguage', () => {
  it('knows the languages the app has texts for', () => {
    expect(LANGUAGES.every(isLanguage)).toBe(true);
    expect(isLanguage('pt')).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });
});

describe('isApiError', () => {
  it('recognises the server’s explanations', () => {
    expect(isApiError({ code: 'nightHours', message: 'Night mode needs…' })).toBe(true);
    expect(isApiError({ code: 'nightHours' })).toBe(false);
    expect(isApiError('Night mode needs…')).toBe(false);
    expect(isApiError(null)).toBe(false);
  });
});

describe('TextError', () => {
  it('carries its text, with the key as its message', () => {
    const error = new TextError({ key: 'errors.imageSize', params: { megabytes: 15 } });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('errors.imageSize');
    expect(error.text.params).toEqual({ megabytes: 15 });
  });
});
