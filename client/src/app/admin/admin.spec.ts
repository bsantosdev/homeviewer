import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TEST_SETTINGS, button, provideTestBackend, query, text } from '../../testing/test-helpers';
import { IMAGE_SHRINKER } from '../backgrounds';
import { SettingsService } from '../settings.service';
import { Admin, CALENDAR_COLORS } from './admin';

describe('Admin', () => {
  let fixture: ComponentFixture<Admin>;
  let el: HTMLElement;
  let http: HttpTestingController;
  // jsdom can't decode images, so "shrinking" hands the file back.
  const shrink = vi.fn((file: Blob) => Promise.resolve(file));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        ...provideTestBackend(),
        { provide: IMAGE_SHRINKER, useValue: shrink },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Admin);
    el = fixture.nativeElement as HTMLElement;
  });

  async function loadSettings(): Promise<void> {
    http.expectOne('/api/settings').flush(TEST_SETTINGS);
    await fixture.whenStable();
  }

  async function type(selector: string, value: string): Promise<void> {
    const input = query(el, selector, HTMLInputElement);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  // Saving resolves over several promise hops after the response; let them all run.
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    button(el, 'Save').click();
    await fixture.whenStable();
  }

  it('shows a loading message until the settings arrive', async () => {
    await fixture.whenStable();
    expect(text(el, 'p')).toBe('Loading…');
  });

  it('fills the form with the current settings', async () => {
    await loadSettings();
    expect(query(el, '[name=title]', HTMLInputElement).value).toBe('Home');
    expect(query(el, '[name=latitude]', HTMLInputElement).value).toBe('38.72');
  });

  it('edits a copy without touching the live settings', async () => {
    await loadSettings();
    await type('[name=title]', 'Kitchen');
    expect(TestBed.inject(SettingsService).settings()?.title).toBe('Home');
  });

  it('saves the edited settings', async () => {
    await loadSettings();
    await type('[name=title]', 'Kitchen');
    await submit();
    expect(text(el, 'form span')).toBe('Saving…');

    const req = http.expectOne({ method: 'PUT', url: '/api/settings' });
    expect(req.request.body).toEqual({ ...TEST_SETTINGS, title: 'Kitchen' });
    req.flush({ ...TEST_SETTINGS, title: 'Kitchen' });
    await settle();

    expect(text(el, 'form span')).toBe('Saved');
  });

  it('reports a failed save', async () => {
    await loadSettings();
    await submit();
    http
      .expectOne({ method: 'PUT', url: '/api/settings' })
      .flush('boom', { status: 500, statusText: 'Server Error' });
    await settle();

    expect(text(el, 'form span')).toBe('Save failed');
  });

  it('follows the saved theme', async () => {
    await loadSettings();
    expect(el.classList).toContain('dark');

    const select = query(el, '[name=theme]', HTMLSelectElement);
    select.value = 'light';
    select.dispatchEvent(new Event('change'));
    await submit();
    // Unsaved choices don't change the page.
    expect(el.classList).toContain('dark');

    http
      .expectOne({ method: 'PUT', url: '/api/settings' })
      .flush({ ...TEST_SETTINGS, theme: 'light' });
    await settle();
    expect(el.classList).not.toContain('dark');
  });

  it('adds, edits and removes calendars', async () => {
    await loadSettings();
    button(el, 'Add calendar').click();
    await fixture.whenStable();
    button(el, 'Add calendar').click();
    await fixture.whenStable();
    await type('#calendar-name-0', 'Family');
    await type('#calendar-url-0', 'webcal://outlook.example/a.ics');
    await type('#calendar-color-0', '#10b981');
    await type('#calendar-name-1', 'Work');

    query(el, 'button[aria-label="Remove Work"]', HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.querySelectorAll('.calendar').length).toBe(1);

    await submit();
    const saved = {
      ...TEST_SETTINGS,
      calendars: [{ name: 'Family', url: 'webcal://outlook.example/a.ics', color: '#10b981' }],
    };
    const req = http.expectOne({ method: 'PUT', url: '/api/settings' });
    expect(req.request.body).toEqual(saved);
    req.flush(saved);
    await settle();
    expect(TestBed.inject(SettingsService).settings()).toEqual(saved);
  });

  it('gives new calendars colours in turn', async () => {
    await loadSettings();
    for (let i = 0; i <= CALENDAR_COLORS.length; i++) {
      button(el, 'Add calendar').click();
      await fixture.whenStable();
    }

    const colors = Array.from(
      el.querySelectorAll<HTMLInputElement>('.calendar input[type=color]'),
      (input) => input.value,
    );
    expect(colors).toEqual([...CALENDAR_COLORS, CALENDAR_COLORS[0]]);
  });

  it('labels the remove button of an unnamed calendar', async () => {
    await loadSettings();
    button(el, 'Add calendar').click();
    await fixture.whenStable();
    expect(el.querySelector('button[aria-label="Remove calendar"]')).not.toBeNull();
  });

  it('edits calendars without touching the live settings', async () => {
    http.expectOne('/api/settings').flush({
      ...TEST_SETTINGS,
      calendars: [{ name: 'Family', url: 'https://a.example', color: '#3b82f6' }],
    });
    await fixture.whenStable();

    await type('#calendar-name-0', 'Changed');

    expect(TestBed.inject(SettingsService).settings()?.calendars[0].name).toBe('Family');
  });

  it('shows the reason when the server rejects the settings', async () => {
    await loadSettings();
    await submit();
    http
      .expectOne({ method: 'PUT', url: '/api/settings' })
      .flush('Calendar "Family" needs an https:// or webcal:// link.', {
        status: 400,
        statusText: 'Bad Request',
      });
    await settle();

    expect(text(el, 'form span')).toBe(
      'Save failed: Calendar "Family" needs an https:// or webcal:// link.',
    );
  });

  it('keeps the form when new settings arrive later', async () => {
    await loadSettings();
    await type('[name=title]', 'Kitchen');
    TestBed.inject(SettingsService).settings.set({ ...TEST_SETTINGS, title: 'Pushed' });
    await fixture.whenStable();
    expect(query(el, '[name=title]', HTMLInputElement).value).toBe('Kitchen');
  });

  it('sets the night hours, which can only change while night mode is on', async () => {
    await loadSettings();
    const start = query(el, '[name=nightStart]', HTMLInputElement);
    expect(start.disabled).toBe(true);

    query(el, '[name=nightMode]', HTMLInputElement).click();
    await fixture.whenStable();
    expect(start.disabled).toBe(false);
    await type('[name=nightStart]', '23:30');
    await type('[name=nightEnd]', '06:15');
    await submit();

    expect(http.expectOne({ method: 'PUT', url: '/api/settings' }).request.body).toEqual({
      ...TEST_SETTINGS,
      nightMode: true,
      nightStart: '23:30',
      nightEnd: '06:15',
    });
  });

  describe('background images', () => {
    const photo = (name: string) => new File(['jpeg'], name, { type: 'image/jpeg' });

    async function pick(...files: File[]): Promise<void> {
      const input = query(el, 'input.add-backgrounds', HTMLInputElement);
      Object.defineProperty(input, 'files', { value: files, configurable: true });
      input.dispatchEvent(new Event('change'));
      await settle();
    }

    function thumbnails(): string[] {
      return Array.from(el.querySelectorAll<HTMLImageElement>('.background img'), (img) =>
        img.getAttribute('src'),
      ) as string[];
    }

    it('uploads picked images one by one and saves them with the interval', async () => {
      await loadSettings();

      await pick(photo('beach.jpg'), photo('snow.jpg'));
      expect(text(el, 'form span')).toBe('Uploading image 1 of 2…');
      http.expectOne({ method: 'POST', url: '/api/backgrounds' }).flush({ name: 'a.jpg' });
      await settle();
      expect(text(el, 'form span')).toBe('Uploading image 2 of 2…');
      http.expectOne({ method: 'POST', url: '/api/backgrounds' }).flush({ name: 'b.jpg' });
      await settle();

      expect(thumbnails()).toEqual(['/api/backgrounds/a.jpg', '/api/backgrounds/b.jpg']);
      expect(text(el, 'form span')).toBe('Save to keep the new images');

      await type('[name=backgroundMinutes]', '5');
      await submit();
      const req = http.expectOne({ method: 'PUT', url: '/api/settings' });
      expect(req.request.body).toEqual({
        ...TEST_SETTINGS,
        backgrounds: ['a.jpg', 'b.jpg'],
        backgroundMinutes: 5,
      });
    });

    it('stops at an upload the server rejects and says why', async () => {
      await loadSettings();

      await pick(photo('drawing.gif'), photo('snow.jpg'));
      http
        .expectOne('/api/backgrounds')
        .flush('Only JPEG and PNG images can be used as backgrounds.', {
          status: 400,
          statusText: 'Bad Request',
        });
      await settle();

      expect(text(el, 'form span')).toBe(
        'Couldn’t add drawing.gif: Only JPEG and PNG images can be used as backgrounds.',
      );
      http.expectNone('/api/backgrounds');
      expect(thumbnails()).toEqual([]);
    });

    it('reports uploads that fail in the browser or on the server', async () => {
      await loadSettings();

      shrink.mockRejectedValueOnce(new Error('The browser can’t read this image.'));
      await pick(photo('photo.heic'));
      expect(text(el, 'form span')).toBe(
        'Couldn’t add photo.heic: The browser can’t read this image.',
      );

      await pick(photo('beach.jpg'));
      http.expectOne('/api/backgrounds').flush('boom', { status: 500, statusText: 'Error' });
      await settle();
      expect(text(el, 'form span')).toBe('Couldn’t add beach.jpg: upload failed');
    });

    it('does nothing when no file is picked', async () => {
      await loadSettings();
      await pick();
      http.expectNone('/api/backgrounds');
      expect(text(el, 'form span')).toBe('');
    });

    it('removes images from a copy of the settings', async () => {
      http.expectOne('/api/settings').flush({ ...TEST_SETTINGS, backgrounds: ['a.jpg', 'b.jpg'] });
      await fixture.whenStable();

      query(el, 'button[aria-label="Remove background 1"]', HTMLButtonElement).click();
      await fixture.whenStable();

      expect(thumbnails()).toEqual(['/api/backgrounds/b.jpg']);
      expect(TestBed.inject(SettingsService).settings()?.backgrounds).toEqual(['a.jpg', 'b.jpg']);
      await submit();
      const req = http.expectOne({ method: 'PUT', url: '/api/settings' });
      expect(req.request.body).toEqual({ ...TEST_SETTINGS, backgrounds: ['b.jpg'] });
    });
  });
});
