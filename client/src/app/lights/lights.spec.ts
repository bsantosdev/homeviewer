import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { Lights } from './lights';
import { LightsService, Room, Scene } from '../lights.service';
import { DEFAULT_KELVIN, SWATCHES } from './room-sheet';
import { DEFAULT_COLOR } from './room-tile';
import { button, provideTestBackend, query, text } from '../../testing/test-helpers';

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

/** Tiles are mocked to this height, so a 20px swipe is 10%. */
const TILE_HEIGHT = 200;

describe('Lights', () => {
  let fixture: ComponentFixture<Lights>;
  let el: HTMLElement;
  let http: HttpTestingController;

  async function show(rooms: Room[]): Promise<void> {
    TestBed.configureTestingModule({ providers: provideTestBackend() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(LightsService).rooms.set(rooms);
    fixture = TestBed.createComponent(Lights);
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    // jsdom doesn't lay anything out, so give the tiles a height to swipe across.
    for (const button of Array.from(el.querySelectorAll('button.tile'))) {
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
        height: TILE_HEIGHT,
      } as DOMRect);
    }
  }

  function tile(name: string): HTMLButtonElement {
    const match = Array.from(el.querySelectorAll<HTMLButtonElement>('button.tile')).find(
      (b) => b.querySelector('.name')?.textContent.trim() === name,
    );
    if (!match) throw new Error(`No tile named "${name}"`);
    return match;
  }

  /** jsdom can't build real touches, so the event carries a stand-in list. */
  function touch(name: string, type: string, y?: number): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: y === undefined ? [] : [{ clientY: y }] });
    tile(name).dispatchEvent(event);
    return event;
  }

  async function swipe(name: string, ...ys: number[]): Promise<Event> {
    touch(name, 'touchstart', ys[0]);
    for (const y of ys.slice(1)) touch(name, 'touchmove', y);
    await fixture.whenStable();
    return touch(name, 'touchend');
  }

  function mouse(target: EventTarget, type: string, clientY: number, button = 0): void {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY, button }));
  }

  function sent(id: string): unknown {
    return http.expectOne({ method: 'PUT', url: `/api/rooms/${id}` }).request.body;
  }

  afterEach(() => {
    http.verify();
  });

  it('shows each room as a tile filled to its brightness', async () => {
    await show([LIVING, BEDROOM, PORCH]);

    expect(tile('Living room').getAttribute('aria-pressed')).toBe('true');
    expect(tile('Living room').getAttribute('aria-label')).toBe('Living room, 60%');
    expect(query(tile('Living room'), '.fill').style.height).toBe('60%');
    expect(tile('Living room').classList).toContain('text-white');

    expect(tile('Bedroom').getAttribute('aria-pressed')).toBe('false');
    expect(text(tile('Bedroom'), '.status')).toBe('Off');
    expect(tile('Bedroom').querySelector('.fill')).toBeNull();
    expect(tile('Bedroom').classList).toContain('bg-neutral-500/15');

    // A room that can't dim says it's on, and is full.
    expect(text(tile('Porch'), '.status')).toBe('On');
    expect(query(tile('Porch'), '.fill').style.height).toBe('100%');
  });

  describe('colours', () => {
    function paint(name: string, part: '.fill' | '.tint'): string {
      return query(tile(name), part).style.background;
    }

    it('paints a tile in the colour its lights show', async () => {
      await show([LIVING]);
      expect(paint('Living room', '.fill')).toBe('rgb(255, 148, 44)');
      expect(paint('Living room', '.tint')).toBe('rgb(255, 148, 44)');
    });

    it('blends several colours into a gradient', async () => {
      await show([{ ...LIVING, colors: ['#ff0000', '#0000ff'] }]);
      expect(paint('Living room', '.fill')).toBe(
        'linear-gradient(to right, rgb(255, 0, 0), rgb(0, 0, 255))',
      );
    });

    it('falls back to amber for lights that report no colour', async () => {
      await show([PORCH]);
      // jsdom normalises the hex to rgb.
      const swatch = document.createElement('span');
      swatch.style.background = DEFAULT_COLOR;
      expect(paint('Porch', '.fill')).toBe(swatch.style.background);
    });
  });

  it('says when the bridge has no rooms with lights', async () => {
    await show([]);
    expect(el.textContent.trim()).toBe('No rooms with lights found on the Hue bridge.');
  });

  it('switches a room with a tap', async () => {
    await show([LIVING]);

    tile('Living room').click();
    await fixture.whenStable();

    expect(sent('living-id')).toEqual({ on: false });
    expect(tile('Living room').getAttribute('aria-pressed')).toBe('false');
  });

  describe('swiping', () => {
    it('dims up and down, and only sends the level when the finger lifts', async () => {
      await show([LIVING]);

      touch('Living room', 'touchstart', 300);
      touch('Living room', 'touchmove', 250);
      await fixture.whenStable();
      expect(text(tile('Living room'), '.status')).toBe('85%');
      http.expectNone('/api/rooms/living-id');

      touch('Living room', 'touchmove', 340);
      await fixture.whenStable();
      expect(text(tile('Living room'), '.status')).toBe('40%');

      const end = touch('Living room', 'touchend');
      expect(sent('living-id')).toEqual({ on: true, brightness: 40 });
      // Stops the browser's follow-up click from also switching the room off.
      expect(end.defaultPrevented).toBe(true);
    });

    it('keeps the page still while swiping', async () => {
      await show([LIVING]);
      touch('Living room', 'touchstart', 300);
      expect(touch('Living room', 'touchmove', 250).defaultPrevented).toBe(true);
      touch('Living room', 'touchcancel');
    });

    it('turns an off room on, starting from the bottom', async () => {
      await show([BEDROOM]);

      await swipe('Bedroom', 300, 200);

      expect(sent('bedroom-id')).toEqual({ on: true, brightness: 50 });
      expect(tile('Bedroom').getAttribute('aria-pressed')).toBe('true');
    });

    it('stops at 1% and 100%', async () => {
      await show([LIVING, BEDROOM]);

      await swipe('Living room', 300, 0);
      await swipe('Bedroom', 0, 300);

      expect(sent('living-id')).toEqual({ on: true, brightness: 100 });
      expect(sent('bedroom-id')).toEqual({ on: true, brightness: 1 });
    });

    it('treats a small wobble as a tap', async () => {
      await show([LIVING]);

      const end = await swipe('Living room', 300, 304);

      expect(end.defaultPrevented).toBe(false);
      http.expectNone('/api/rooms/living-id');
      expect(text(tile('Living room'), '.status')).toBe('60%');
    });

    it('drops a swipe the browser cancels', async () => {
      await show([LIVING]);

      touch('Living room', 'touchstart', 300);
      touch('Living room', 'touchmove', 250);
      touch('Living room', 'touchcancel');
      touch('Living room', 'touchmove', 200);
      touch('Living room', 'touchend');

      http.expectNone('/api/rooms/living-id');
      expect(text(tile('Living room'), '.status')).toBe('60%');
    });

    it('does nothing on rooms that can only switch', async () => {
      await show([PORCH]);

      touch('Porch', 'touchstart', 300);
      const move = touch('Porch', 'touchmove', 200);
      touch('Porch', 'touchend');

      expect(move.defaultPrevented).toBe(false);
      http.expectNone('/api/rooms/porch-id');
    });
  });

  describe('with a mouse', () => {
    it('dims by dragging, without the click that ends the drag switching the room', async () => {
      await show([LIVING]);

      mouse(tile('Living room'), 'mousedown', 300);
      mouse(document, 'mousemove', 280);
      mouse(document, 'mouseup', 280);
      tile('Living room').click();
      await fixture.whenStable();

      expect(sent('living-id')).toEqual({ on: true, brightness: 70 });

      // The next click is a real one again.
      tile('Living room').click();
      expect(sent('living-id')).toEqual({ on: false });
    });

    it('stops following the mouse once released', async () => {
      await show([LIVING]);

      mouse(tile('Living room'), 'mousedown', 300);
      mouse(document, 'mouseup', 300);
      mouse(document, 'mousemove', 100);
      await fixture.whenStable();

      expect(text(tile('Living room'), '.status')).toBe('60%');
    });

    it('ignores other buttons and rooms that can only switch', async () => {
      await show([LIVING, PORCH]);

      mouse(tile('Living room'), 'mousedown', 300, 2);
      mouse(tile('Porch'), 'mousedown', 300);
      mouse(document, 'mousemove', 100);
      mouse(document, 'mouseup', 100);
      await fixture.whenStable();

      expect(text(tile('Living room'), '.status')).toBe('60%');
      http.expectNone('/api/rooms/living-id');
      http.expectNone('/api/rooms/porch-id');
    });

    it('stops listening when the panel closes mid-drag', async () => {
      await show([LIVING]);
      const rooms = TestBed.inject(LightsService).rooms;

      mouse(tile('Living room'), 'mousedown', 300);
      fixture.destroy();
      mouse(document, 'mousemove', 100);

      expect(rooms()).toEqual([LIVING]);
    });
  });

  describe('colours and scenes', () => {
    const SCENES: Scene[] = [
      { id: 'party-id', name: 'Party', colors: ['#ff0000', '#0000ff'] },
      { id: 'relax-id', name: 'Relax', colors: ['#ff942c'] },
      { id: 'plain-id', name: 'Plain', colors: [] },
    ];

    function sheet(): HTMLElement | null {
      return el.querySelector<HTMLElement>('[role="dialog"]');
    }

    /** Opens a room's sheet and answers its scenes request. */
    async function open(name: string, scenes: Scene[] = SCENES, id = 'living-id'): Promise<void> {
      query(el, `button[aria-label="${name} colours and scenes"]`).click();
      TestBed.tick();
      http.expectOne(`/api/rooms/${id}/scenes`).flush(scenes);
      await fixture.whenStable();
    }

    function sceneNames(): string[] {
      return Array.from(el.querySelectorAll('button.scene'), (b) => b.textContent.trim());
    }

    it('opens from the tile’s "•••" without switching the room', async () => {
      await show([LIVING]);

      await open('Living room');

      expect(sheet()?.getAttribute('aria-label')).toBe('Living room');
      expect(tile('Living room').getAttribute('aria-pressed')).toBe('true');
      http.expectNone({ method: 'PUT' });
    });

    it('lists the room’s scenes in their colours', async () => {
      await show([LIVING]);
      await open('Living room');

      expect(sceneNames()).toEqual(['Party', 'Relax', 'Plain']);
      const [party, relax, plain] = Array.from(el.querySelectorAll<HTMLElement>('button.scene'));
      expect(party.style.background).toBe(
        'linear-gradient(to right, rgb(255, 0, 0), rgb(0, 0, 255))',
      );
      expect(relax.style.background).toBe('rgb(255, 148, 44)');
      expect(plain.style.background).toBe('');
    });

    it('recalls a scene with a tap', async () => {
      await show([LIVING]);
      await open('Living room');

      button(el, 'Relax').click();

      const req = http.expectOne({ method: 'POST', url: '/api/scenes/relax-id/recall' });
      expect(req.request.body).toBeNull();
    });

    it('says while the scenes load, if there are none, and if they fail', async () => {
      await show([LIVING]);
      query(el, 'button[aria-label="Living room colours and scenes"]').click();
      TestBed.tick();
      expect(text(el, '.scenes')).toBe('Loading scenes…');

      http.expectOne('/api/rooms/living-id/scenes').flush([]);
      await fixture.whenStable();
      expect(text(el, '.scenes')).toBe('No scenes for this room in the Hue app.');

      query(el, '.close').click();
      await fixture.whenStable();
      query(el, 'button[aria-label="Living room colours and scenes"]').click();
      TestBed.tick();
      http
        .expectOne('/api/rooms/living-id/scenes')
        .flush('Unreachable', { status: 502, statusText: 'Bad Gateway' });
      await fixture.whenStable();
      expect(text(el, '.scenes')).toBe("Couldn't load the scenes.");
    });

    it('sets a white with the slider', async () => {
      await show([LIVING, BEDROOM]);
      await open('Living room');
      const slider = query(el, 'input.temperature', HTMLInputElement);
      // Browsers snap to the slider's 100 K steps; jsdom keeps the exact value.
      expect(Math.round(Number(slider.value) / 100) * 100).toBe(2200);

      slider.value = '4000';
      slider.dispatchEvent(new Event('change'));

      expect(http.expectOne({ method: 'PUT', url: '/api/rooms/living-id' }).request.body).toEqual({
        on: true,
        temperature: 4000,
      });
    });

    it('starts the slider at an everyday white for rooms not in white mode', async () => {
      await show([BEDROOM]);
      await open('Bedroom', [], 'bedroom-id');
      expect(query(el, 'input.temperature', HTMLInputElement).value).toBe(String(DEFAULT_KELVIN));
    });

    it('offers colours only to rooms with colour lights', async () => {
      await show([LIVING, BEDROOM]);
      await open('Bedroom', [], 'bedroom-id');
      expect(el.querySelectorAll('button.swatch')).toHaveLength(0);
      query(el, '.close').click();
      await fixture.whenStable();

      await open('Living room');
      expect(el.querySelectorAll('button.swatch')).toHaveLength(SWATCHES.length);
      query(el, 'button.swatch[aria-label="Blue"]').click();

      expect(http.expectOne({ method: 'PUT', url: '/api/rooms/living-id' }).request.body).toEqual({
        on: true,
        color: '#007aff',
      });
    });

    it.each([
      [
        'the close button',
        () => {
          query(el, '.close').click();
        },
      ],
      [
        'the backdrop',
        () => {
          query(el, 'button.backdrop').click();
        },
      ],
      ['Escape', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ])('closes with %s', async (_, close) => {
      await show([LIVING]);
      await open('Living room');

      close();
      await fixture.whenStable();

      expect(sheet()).toBeNull();
    });

    it('closes if its room goes away', async () => {
      await show([LIVING]);
      await open('Living room');

      TestBed.inject(LightsService).rooms.set([]);
      await fixture.whenStable();

      expect(sheet()).toBeNull();
    });
  });

  describe('with the keyboard', () => {
    function key(name: string, key: string): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      tile(name).dispatchEvent(event);
      return event;
    }

    it('dims in steps with the arrow keys', async () => {
      await show([LIVING, BEDROOM]);

      expect(key('Living room', 'ArrowUp').defaultPrevented).toBe(true);
      expect(sent('living-id')).toEqual({ on: true, brightness: 70 });

      key('Bedroom', 'ArrowDown');
      expect(sent('bedroom-id')).toEqual({ on: true, brightness: 1 });
    });

    it('leaves the arrow keys alone on rooms that can only switch', async () => {
      await show([PORCH]);

      expect(key('Porch', 'ArrowUp').defaultPrevented).toBe(false);
      http.expectNone('/api/rooms/porch-id');
    });
  });
});
