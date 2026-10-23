# HomeViewer

Wall-mounted dashboard for an iPad on the home network. It shows a clock, the date, a title and message, and the current weather. Settings are edited at `/admin` and appear on every open dashboard straight away, through SignalR.

- `server/HomeViewer.Api`: .NET 10 minimal API. It serves the API (`/api/settings`), the SignalR hub (`/hubs/dashboard`) and the built Angular app. Settings are stored in `data/settings.json`.
- `client`: Angular 21 app (standalone components, signals), styled with Tailwind CSS v3.
- `server/HomeViewer.Api.Tests`: xUnit tests for the API, including SignalR.

Requirements: .NET SDK 10 and Node 22.12 or newer.

## Development

```sh
# terminal 1
cd server/HomeViewer.Api
dotnet run

# terminal 2
cd client
npm install
npm start
```

Open http://localhost:4200 for the dashboard and http://localhost:4200/admin for the admin page. The Angular dev server forwards `/api` and `/hubs` to the .NET server on port 5000.

## Code quality

| Command (in `client/`)  | What it does                                                             |
| ----------------------- | ------------------------------------------------------------------------ |
| `npm run format`        | Formats with Prettier, including sorting Tailwind classes                |
| `npm run lint`          | Runs ESLint with typescript-eslint's strict type-checked rules           |
| `npm test`              | Runs the Vitest unit tests in watch mode                                 |
| `npm run test:coverage` | Runs the tests once and fails below 95% coverage (report in `coverage/`) |
| `npm run check`         | Runs all of the above, then the iOS 12 build                             |

Server tests, with a 95% coverage gate:

```sh
dotnet test server/HomeViewer.Api.Tests -p:CollectCoverage=true
```

## Production-like run

```sh
cd client && npm run build    # outputs into server/HomeViewer.Api/wwwroot
cd ../server/HomeViewer.Api && dotnet run
```

The app then runs on `http://<pc-lan-ip>:5000`. The admin page is at `http://<pc-lan-ip>:5000/admin`.

If other devices can't connect, allow inbound TCP on port 5000 in Windows Firewall:

```powershell
New-NetFirewallRule -DisplayName "HomeViewer" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow -Profile Private
```

## iPad setup

1. Open `http://<pc-lan-ip>:5000` in Safari, then choose Share → **Add to Home Screen**. Launched from the Home Screen, it runs full-screen.
2. Go to Settings → Display & Brightness and set **Auto-Lock** to **Never**.
3. Optionally, turn on **Guided Access** (Settings → Accessibility) to lock the iPad to the app.

The dashboard reconnects automatically and fetches the settings again after the iPad wakes from sleep.

## Notes

- `/admin` has no authentication. Only use HomeViewer on a trusted network.
- **iOS 12 support (iPad mini 2, A1489):** Angular's build can't target Safari 12. To support it, `npm run build` runs [scripts/transpile-legacy.mjs](client/scripts/transpile-legacy.mjs) after `ng build`, which converts the output with Babel. `core-js-bundle` (listed under `scripts` in `angular.json`) provides polyfills for missing browser APIs. Always build with `npm run build`, not `ng build`. Tailwind stays on v3, because v4 needs Safari 16.4+. The build fails if the CSS uses something Safari 12 lacks, such as flexbox `gap` ([scripts/check-legacy-css.mjs](client/scripts/check-legacy-css.mjs)). If startup fails, a red error bar appears at the bottom of the page.
- `npm audit` reports a moderate advisory in Tailwind v3's `postcss-selector-parser`. The only fix is Tailwind v4, which would break iOS 12. The code is only used at build time, on our own CSS.
- `client/.npmrc` sets `legacy-peer-deps`. This works around an npm 10.9 bug (`Cannot read properties of null (reading 'edgesOut')`).
