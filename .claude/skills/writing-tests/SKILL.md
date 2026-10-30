---
name: writing-tests
description: How tests are written in HomeViewer, for the client (Vitest through ng test) and the server (xUnit). Use when writing, changing or reviewing any *.spec.ts or *Tests.cs file.
---

# Writing tests

## Every test: Arrange, Act, Assert

Split each test body into sections marked with comments, in this order:

```ts
it('skips to the next item, then reads it back', async () => {
  // Arrange
  await load();

  // Act
  const skipping = service.next();
  http.expectOne({ method: 'POST', url: '/api/spotify/next' }).flush(null);
  await skipping;

  // Assert
  expect(service.status()?.playback?.item?.name).toBe('Evening Song');
});
```

```csharp
[Fact]
public async Task Pause_is_sent_to_Spotify()
{
    // Arrange
    Spotify.Serve(HttpMethod.Put, $"{FakeSpotify.PlayerUrl}/pause", null, HttpStatusCode.NoContent);

    // Act
    var response = await _client.PostAsync("/api/spotify/pause", null);

    // Assert
    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
}
```

- Leave out `// Arrange` when there's nothing to set up. Always include `// Act` and `// Assert`.
- Use one Act and one Assert section per test. Don't go act, assert, act, assert.
- If a test checks a state that only exists partway through Act, such as an optimistic preview shown before the server answers, save it in a variable during Act and assert it under Assert:

  ```ts
  // Act
  const pausing = service.pause();
  const shown = service.status()?.playback?.isPlaying;
  ...
  // Assert
  expect(shown).toBe(false);
  ```

- Everything that answers a request, flushes, advances timers or waits for the component to settle belongs in Act. This includes `await fixture.whenStable()` and `settle(fixture)`.

## Every test asserts an outcome

A test that runs code and flushes its requests without an `expect` or `Assert` proves nothing beyond "didn't throw". Every test must check what changed: state, the request body sent, rendered text, a status code, or what was logged.

- Don't end a test with something like `for (const req of http.match(...)) req.flush(...)` and no assertion after it. Assert on what those requests did.
- If code does something in the background afterwards (for example a read-back after a command), make the test wait for it and assert on its result.

## One scenario per test

If a test would cover two cases (pause and resume, next and previous, the upper and lower volume limits), split it:

- Use `it.each` / `[Theory]` + `[InlineData]` when only the inputs change.
- Use separate tests when the steps differ.

## Client specifics (Vitest through `ng test`)

- Act, wait, assert: use `await fixture.whenStable()` (or `settle(fixture)` from `src/testing/test-helpers.ts`), never `detectChanges()`.
- `vi.mock` doesn't work with Angular's test builder. Inject fakes through providers instead (see `SETTINGS_HUB`, or the `SpotifyService` fake in `music.spec.ts`).
- Shared fixtures (`SONG`, `SPEAKER`, `PLAYING`, `TEST_SETTINGS`, `FakeHub`, `provideTestBackend`, `query`, `button`, `text`) live in `src/testing/test-helpers.ts`. Never import from another `.spec.ts`: Vitest would run that file's tests again.
- `settle()` waits with a real `setTimeout`. Don't fake `setTimeout` in a test that calls it.
- Silence expected `console.error` calls with `vi.spyOn(console, 'error').mockImplementation(() => undefined)`, and assert on the spy when logging is part of the behaviour.
- Use made-up names in fixtures. Never use real rooms, scenes, devices or playlists from the house.

## Server specifics (xUnit)

- Name tests as sentences with underscores: `Everything_is_unavailable_until_a_client_id_is_configured`.
- Use `HomeViewerFactory` (in `ApiTests.cs`) with the fake HTTP handlers (`FakeSpotify` and the others) and `FakeTimeProvider`. Never call real services.

## Before handing back

Coverage must stay at or above 95% on both sides:

```sh
cd client && npm run check
cd .. && dotnet test server/HomeViewer.Api.Tests -p:CollectCoverage=true
```

If a `dotnet run` server is running, add `--artifacts-path <temp dir>` to the `dotnet test` command.
