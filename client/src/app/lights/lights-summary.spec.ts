import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { LightsSummary } from './lights-summary';
import { LightsService, Room } from '../lights.service';
import { DEFAULT_COLOR } from './room-tile';
import { provideTestBackend, query, text } from '../../testing/test-helpers';

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

describe('LightsSummary', () => {
  let fixture: ComponentFixture<LightsSummary>;
  let el: HTMLElement;
  let http: HttpTestingController;

  async function show(rooms: Room[] | null): Promise<void> {
    TestBed.configureTestingModule({ providers: provideTestBackend() });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(LightsService).rooms.set(rooms);
    fixture = TestBed.createComponent(LightsSummary);
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
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
});
