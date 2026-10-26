# HomeViewer

Wall-mounted dashboard for an iPad on the home network. A side bar on the left switches between Home, Lights, Timer and Email. Home shows a title and message, a clock and the date, and widgets for the weather, the week's events and the lights, as translucent cards over the background photo. Email is a placeholder for now. Settings are edited at `/admin` and appear on every open dashboard straight away, through SignalR.

- `server/HomeViewer.Api`: .NET 10 minimal API. It serves the API (`/api/settings`, `/api/events`, `/api/rooms`, `/api/backgrounds`), the SignalR hub (`/hubs/dashboard`) and the built Angular app. Settings are stored in `data/settings.json`.
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

While the server is stopped, for example during an update, an open page shows **Under maintenance** after 5 seconds and keeps trying to reconnect, every 10 seconds at most. Once the server is back, the alert goes away by itself. If a new build was installed meanwhile, the page reloads to run it. A page opened while the server is down can't load at all, because the server serves the page too.

## Outlook calendars

With calendars or lights set up, home splits in two: the clock and weather on the left, and the next 7 days' events and the lights on the right. The lights card lists every room with a switch. Each event shows its calendar's badge, its time and its title, grouped under Today, Tomorrow and then the date. Days with nothing planned are left out, except today. When there are more events than fit, swipe the list to scroll.

1. In Outlook on the web, go to **Settings → Calendar → Shared calendars → Publish a calendar**. Pick the calendar and how much to share. "Can view titles and locations" is enough; "Can view when I'm busy" shows every event as "Busy".
2. Copy the **ICS** link (not the HTML one).
3. In `/admin`, choose **Add calendar**, give it a name, pick a colour, paste the link and save. Repeat for each calendar.

Each event on the dashboard gets a badge with its calendar's name in that colour. The badge text is black or white, whichever is easier to read on the colour.

The server downloads each calendar at most every 5 minutes, and the dashboard refreshes every 5 minutes. Anyone with a published link can read that calendar, so treat it like a password. It's stored in `data/settings.json` and visible to anyone who can open `/admin` on your network. To revoke a link, unpublish the calendar in Outlook.

## Background images

In `/admin`, under **Background images**, choose **Add images** to pick one or more photos, set **Change image every (minutes)**, and save. The dashboard shows the images one at a time behind everything, fading from one to the next. A dark veil (or a light one, with the light theme) keeps the text readable.

- **Resizing:** the admin page resizes each photo to at most 2048 pixels on its longest side and saves it as a JPEG before uploading. Full-size phone photos would use up the iPad's memory.
- **Storage:** images are stored in `data/backgrounds/`, next to `settings.json`, so they stay out of the repository.
- **Saving:** an upload only stays if you save the settings. Saving also deletes images you removed.
- **Timing:** which image shows depends only on the time of day, so all screens change together.

## Night mode

In `/admin`, under **Night mode**, turn on **Dim the dashboard at night** and set the hours, for example from 22:00 until 07:00. During those hours the dashboard shows only a dim clock on black, with no photo, and stops refreshing the weather, calendars and lights.

- **Waking:** tap the screen to bring the dashboard back for a minute. Each touch starts the minute again, and an open timer keeps it on until you leave the timer.
- **Brightness:** a web page can't change the iPad's screen brightness, so the backlight stays on. Turn the brightness down, or use Night Shift, for a darker room.

## Philips Hue lights

With a Hue bridge configured, a Lights entry appears in the side bar. It shows your rooms from the Hue app as tiles. Tap a tile to switch the room on or off, and swipe up or down on it to dim it: the tile fills from the bottom to show the brightness, and a swipe across its full height goes from 0 to 100%. Swiping a room that's off turns it on. With a keyboard, the up and down arrows dim a focused tile in steps of 10%.

While a room is on, its tile takes the colours its lights are showing: a warm white looks amber, and lights in different colours make a gradient. The "•••" in a tile's corner opens the room's sheet:

- **Scenes** from the Hue app, each previewed in its colours. Tap one to turn it on.
- **White**, a slider from warm (2000 K) to cool (6500 K).
- **Colour** swatches, for rooms with colour lights. Lights that only do whites ignore colours.

Close the sheet with ✕, by tapping outside it, or with Escape.

The server talks to the bridge's local API, so this works without the internet. While you swipe, only the tile changes; the bridge gets one request when you let go, since it accepts about one room command a second. The dashboard refreshes the rooms every 15 seconds to pick up changes made from the Hue app or a wall switch.

Rooms are listed by name; to rename one, rename it in the Hue app. Only rooms show up, so a light that isn't in a room in the Hue app doesn't appear on the dashboard.

1. Find the bridge's IP address in the Hue app (**Settings → My Hue system → Bridge**), or at https://discovery.meethue.com.
2. Press the round link button on the bridge, then within 30 seconds run this (in Git Bash or another shell with `curl`; `-k` is needed because the bridge's certificate comes from Signify's own CA, which curl doesn't know; the server trusts that CA and nothing else):

   ```sh
   curl -k -X POST https://<bridge-ip>/api -d '{"devicetype":"homeviewer#server"}'
   ```

   The `username` in the answer is the app key.

3. Give both to the server as environment variables, then restart it:

   ```powershell
   setx Hue__BridgeAddress "<bridge-ip>"
   setx Hue__AppKey "<app key>"
   ```

   `setx` applies to terminals opened afterwards. If VS Code was already open, restart it completely, or copy the values into the current terminal before `dotnet run`:

   ```powershell
   $env:Hue__BridgeAddress = [Environment]::GetEnvironmentVariable('Hue__BridgeAddress', 'User')
   $env:Hue__AppKey = [Environment]::GetEnvironmentVariable('Hue__AppKey', 'User')
   ```

   Keep the key out of `appsettings.json` and anything else in the repository: anyone with it can control your lights.

Without these settings, `/api/rooms` answers 503 and the dashboard hides the button. Give the bridge a fixed IP address in your router so the setting keeps working.

## Notes

- `/admin` has no authentication. Only use HomeViewer on a trusted network.
- **iOS 12 support (iPad mini 2, A1489):** Angular's build can't target Safari 12. To support it, `npm run build` runs [scripts/transpile-legacy.mjs](client/scripts/transpile-legacy.mjs) after `ng build`, which converts the output with Babel. `core-js-bundle` (listed under `scripts` in `angular.json`) provides polyfills for missing browser APIs. Always build with `npm run build`, not `ng build`. Tailwind stays on v3, because v4 needs Safari 16.4+. The build fails if the CSS uses something Safari 12 lacks, such as flexbox `gap` ([scripts/check-legacy-css.mjs](client/scripts/check-legacy-css.mjs)). If startup fails, a red error bar appears at the bottom of the page.
- `npm audit` reports a moderate advisory in Tailwind v3's `postcss-selector-parser`. The only fix is Tailwind v4, which would break iOS 12. The code is only used at build time, on our own CSS.
- `client/.npmrc` sets `legacy-peer-deps`. This works around an npm 10.9 bug (`Cannot read properties of null (reading 'edgesOut')`).
