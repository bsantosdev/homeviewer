# HomeViewer

A wall dashboard for the home network: an Angular 21 client (`client/`) served by a .NET 10 minimal API (`server/`), with live settings updates over SignalR. The README covers how to run it.

## Hard constraint: iOS 12

The main screen is an iPad mini 2 (A1489) that can't update past iOS 12.5.7, which ships Safari 12.1. Everything the client ships must run there.

- **Tailwind stays on v3.4.** v4 needs Safari 16.4+. This overrides the angular-developer skill's "always use Tailwind v4" guidance, and `npm audit fix --force` would make the same upgrade.
- **CSS:** don't use flexbox `gap`, `inset`, `aspect-ratio`, `:is()`, `:where()`, `@layer` in output, or modern color functions. Use margins for spacing. `tailwind.config.js` disables `gap`, `space-*` and `divide-*`, and `npm run build` fails if the emitted CSS uses any of these (`scripts/check-legacy-css.mjs`).
- **JS:** `npm run build` runs Babel after `ng build`, and `core-js-bundle` polyfills browser APIs. Only use APIs that core-js can polyfill: no `WeakRef` and no `FinalizationRegistry`. Always build with `npm run build`, never with a plain `ng build`.
- **Audio:** iOS 12 only has `webkitAudioContext`, and audio must start from a user gesture.

## Client conventions

- Standalone components, signals, `OnPush` change detection, built-in control flow (`@if`/`@for`), and `inject()`. Strict ESLint enforces these.
- Icons come from Hugeicons: `<hugeicons-icon>` from `@hugeicons/angular`, with icons imported one at a time from `@hugeicons/core-free-icons`. Never import the whole set. Size icons with Tailwind classes, and use `currentColor` so they follow the theme.
- Style with Tailwind utilities in templates. Use a component `.scss` file only for vendor-specific CSS or shared `@apply` classes.
- Theme: `SettingsService.isDark` drives a `dark` class on each page's host. In templates, `dark:` utilities work. In a component `.scss`, `@apply dark:...` never matches, because view encapsulation scopes it, so write `:host(.dark) .x { @apply ... }` instead.
- Text: every user-facing string goes in `src/app/i18n/en.ts`, with the same key in `de.ts` and `pt-BR.ts` (the build fails otherwise). Templates use the `transloco` pipe. Text worked out in code returns a `Text` (`{ key, params }`) and is shown with the `text` pipe; don't translate in TypeScript, because a language's texts may not be loaded yet. Dates take their format from `dates.*` and the locale from `SettingsService.language`. Server errors the admin page shows are an `ApiError` with a `code` under `errors`.
- Tests: follow the `writing-tests` skill in `.claude/skills/` (Arrange/Act/Assert comments, and every test asserts). Vitest through `ng test`, written "act, wait, assert" (`await fixture.whenStable()`, not `detectChanges()`). The helpers in `src/testing/test-helpers.ts` include a fake SignalR hub and `HttpTestingController` setup. `vi.mock` doesn't work with Angular's test builder, so inject dependencies instead (see `SETTINGS_HUB`).
- Coverage must stay at 95% or higher (statements, branches, functions, lines). It's currently about 99%.

## Checks before handing work back

```sh
cd client && npm run check   # prettier --check, eslint, tests with coverage gate, legacy build + CSS check
cd .. && dotnet test server/HomeViewer.Api.Tests -p:CollectCoverage=true   # 95% line/branch/method gate
```

If a `dotnet run` server is running, it locks `bin/`. Add `--artifacts-path <temp dir>` to `dotnet test` instead of stopping the user's server.

## Angular skill

The official `angular-developer` skill is installed in `.claude/skills/` (tracked in `skills-lock.json`). Use it for Angular guidance, except where it conflicts with the iOS 12 rules above.
