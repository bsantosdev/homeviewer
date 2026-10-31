import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { LightsSummary } from './lights-summary';
import { LightsService, Room, RoomScene } from '../lights.service';
import { DEFAULT_COLOR } from './room-tile';
import {
  TEST_SETTINGS,
  button,
  provideTestBackend,
  query,
  settle,
  text,
} from '../../testing/test-helpers';

const LIVING: Room = {
  id: 'living-id',
  name: 'Living room',
  on: true,
  brightness: 60,
  colors: ['#ff942c'],
  temperature: 2242,
  canColor: true,
};
const BEDROOM: Room = {
  id: 'bedroom-id',
  name: 'Bedroom',
  on: false,
  brightness: 0,
  colors: [],
  temperature: null,
  canColor: false,
};
const PORCH: Room = {
  id: 'porch-id',
  name: 'Porch',
  on: true,
  brightness: null,
  colors: [],
  temperature: null,
  canColor: false,
};

const RELAX: RoomScene = {
  id: 'relax-id',
  name: 'Relax',
  room: 'Living room',
  colors: ['#ff942c'],
};
const READ: RoomScene = { id: 'read-id', name: 'Read', room: 'Kitchen', colors: [] };

describe('LightsSummary', () => {
  let fixture: ComponentFixture<LightsSummary>;
  let el: HTMLElement;
  let http: HttpTestingController;

  async function show(
    rooms: Room[] | null,
    sceneShortcuts: string[] = [],
    homeRooms: string[] = [],
  ): Promise<void> {
    TestBed.configureTestingModule({ providers: provideTestBackend() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(LightsService).rooms.set(rooms);
    fixture = TestBed.createComponent(LightsSummary);
    el = fixture.nativeElement as HTMLElement;
    http.expectOne('/api/settings').flush({ ...TEST_SETTINGS, sceneShortcuts, homeRooms });
    await fixture.whenStable();
  }

  function names(): string[] {
    return Array.from(el.querySelectorAll('.room'), (r) => text(r, '.name'));
  }

  function shortcuts(): string[] {
    return Array.from(el.querySelectorAll('.scene'), (b) => String(b.getAttribute('aria-label')));
  }

  function row(name: string): HTMLElement {
    const match = Array.from(el.querySelectorAll<HTMLElement>('.room')).find(
      (r) => text(r, '.name') === name,
    );
    if (!match) throw new Error(`No room named "${name}"`);
    return match;
  }

  /** Colours read back from the DOM come out as rgb(), so compare through the browser too. */
  function css(color: string): string {
    const swatch = document.createElement('span');
    swatch.style.backgroundColor = color;
    return swatch.style.backgroundColor;
  }

  afterEach(() => {
    http.verify();
  });

  it('lists every room with its state and how many are on', async () => {
    await show([LIVING, BEDROOM, PORCH]);

    expect(text(el, '.on-count')).toBe('2 on');
    expect(text(row('Living room'), '.status')).toBe('60%');
    expect(text(row('Bedroom'), '.status')).toBe('Off');
    expect(text(row('Porch'), '.status')).toBe('On');

    expect(query(row('Living room'), '.dot').style.backgroundColor).toBe(css('#ff942c'));
    expect(query(row('Porch'), '.dot').style.backgroundColor).toBe(css(DEFAULT_COLOR));
    expect(query(row('Bedroom'), '.dot').classList).toContain('bg-neutral-500/40');

    expect(query(row('Living room'), '.switch').getAttribute('aria-checked')).toBe('true');
    expect(query(row('Bedroom'), '.switch').getAttribute('aria-checked')).toBe('false');
  });

  it('lists only the rooms picked, in the order picked, still counting the whole house', async () => {
    // Act
    await show([LIVING, BEDROOM, PORCH], [], ['porch-id', 'gone-id', 'bedroom-id']);

    // Assert
    expect(names()).toEqual(['Porch', 'Bedroom']);
    expect(text(el, '.on-count')).toBe('2 on');
  });

  it('lists every room once none of the picked ones are left', async () => {
    // Act
    await show([LIVING, BEDROOM], [], ['gone-id']);

    // Assert
    expect(names()).toEqual(['Living room', 'Bedroom']);
  });

  it('switches a room', async () => {
    await show([LIVING, BEDROOM]);

    query(row('Bedroom'), '.switch').click();
    await fixture.whenStable();

    const req = http.expectOne({ method: 'PUT', url: '/api/rooms/bedroom-id' });
    expect(req.request.body).toEqual({ on: true });
    expect(query(row('Bedroom'), '.switch').getAttribute('aria-checked')).toBe('true');
    expect(text(el, '.on-count')).toBe('2 on');
  });

  it('says when the bridge has no rooms with lights', async () => {
    await show([]);
    expect(text(el, 'p')).toBe('No rooms with lights found on the Hue bridge.');
    expect(text(el, '.on-count')).toBe('0 on');
  });

  it('shows nothing before the rooms load', async () => {
    await show(null);
    expect(el.querySelectorAll('.room')).toHaveLength(0);
  });

  it('turns every room off', async () => {
    await show([LIVING, BEDROOM, PORCH]);

    button(el, 'All off').click();
    await fixture.whenStable();

    const sent = http
      .match({ method: 'PUT' })
      .map((req): [string, unknown] => [req.request.url, req.request.body]);
    expect(sent).toEqual([
      ['/api/rooms/living-id', { on: false }],
      ['/api/rooms/porch-id', { on: false }],
    ]);
    expect(text(el, '.on-count')).toBe('0 on');
    expect(el.querySelector('.all-off')).toBeNull();
  });

  it('has no scene shortcuts until some are picked', async () => {
    await show([LIVING]);
    http.expectNone('/api/scenes');
    expect(shortcuts()).toEqual([]);
  });

  it('shows the picked scenes in order, and recalls one', async () => {
    await show([LIVING], ['read-id', 'gone-id', 'relax-id']);
    http.expectOne('/api/scenes').flush([RELAX, READ]);
    await settle(fixture);

    expect(shortcuts()).toEqual(['Read, Kitchen', 'Relax, Living room']);
    expect(text(el, '.scene .scene-name')).toBe('Read');

    query(el, '.scene[aria-label="Relax, Living room"]').click();
    expect(http.expectOne({ method: 'POST', url: '/api/scenes/relax-id/recall' })).toBeTruthy();
  });

  it('logs scenes that fail to load', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await show([LIVING], ['relax-id']);
    http.expectOne('/api/scenes').flush('down', { status: 502, statusText: 'Bad Gateway' });
    await settle(fixture);

    expect(log).toHaveBeenCalledWith('Scenes fetch failed', expect.anything());
    expect(shortcuts()).toEqual([]);
    log.mockRestore();
  });
});
