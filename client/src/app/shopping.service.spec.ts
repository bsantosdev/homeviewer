import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ShoppingItem, ShoppingService } from './shopping.service';
import { FakeHub, TEST_SETTINGS, provideTestBackend } from '../testing/test-helpers';

const MILK: ShoppingItem = { id: 'milk-id', text: 'Milk', done: false };
const EGGS: ShoppingItem = { id: 'eggs-id', text: 'Eggs', done: true };

describe('ShoppingService', () => {
  let service: ShoppingService;
  let http: HttpTestingController;
  let hub: FakeHub;

  beforeEach(() => {
    hub = new FakeHub();
    TestBed.configureTestingModule({ providers: provideTestBackend(hub) });
    service = TestBed.inject(ShoppingService);
    http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/settings').flush(TEST_SETTINGS);
  });

  afterEach(() => {
    http.verify();
  });

  /** The list loads from an effect, which runs once Angular gets to it. */
  async function loaded(items: ShoppingItem[] = [MILK, EGGS]): Promise<void> {
    TestBed.tick();
    http.expectOne('/api/shopping').flush(items);
    await new Promise((resolve) => setTimeout(resolve));
  }

  it('loads the list and counts what is left to buy', async () => {
    expect(service.items()).toEqual([]);
    await loaded();
    expect(service.items()).toEqual([MILK, EGGS]);
    expect(service.open()).toBe(1);
  });

  it('takes changes pushed from other screens', async () => {
    await loaded();
    hub.emit('ShoppingUpdated', [EGGS]);
    expect(service.items()).toEqual([EGGS]);
  });

  it('loads the list again after reconnecting', async () => {
    await loaded();
    hub.reconnecting?.();
    hub.reconnected?.();
    http.expectOne('/api/settings').flush(TEST_SETTINGS);
    http.expectOne('/').flush('<html></html>');

    await loaded([MILK]);
    expect(service.items()).toEqual([MILK]);
  });

  it('logs a list that fails to load', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.tick();
    http.expectOne('/api/shopping').flush('down', { status: 500, statusText: 'Error' });
    await new Promise((resolve) => setTimeout(resolve));

    expect(log).toHaveBeenCalledWith('Shopping list fetch failed', expect.anything());
    log.mockRestore();
  });

  it('adds an item and keeps the list the server sends back', async () => {
    await loaded([]);
    const adding = service.add('Milk');
    const req = http.expectOne({ method: 'POST', url: '/api/shopping' });
    expect(req.request.body).toEqual({ text: 'Milk' });
    req.flush([MILK]);
    await adding;
    expect(service.items()).toEqual([MILK]);
  });

  it('ticks an item straight away, then sends it', async () => {
    await loaded();
    const ticking = service.toggle(MILK);
    expect(service.open()).toBe(0);

    const req = http.expectOne({ method: 'PUT', url: '/api/shopping/milk-id' });
    expect(req.request.body).toEqual({ done: true });
    req.flush([{ ...MILK, done: true }, EGGS]);
    await ticking;
    expect(service.items()).toEqual([{ ...MILK, done: true }, EGGS]);
  });

  it('clears the ticked items straight away, then sends it', async () => {
    await loaded();
    const clearing = service.clearDone();
    expect(service.items()).toEqual([MILK]);

    http.expectOne({ method: 'DELETE', url: '/api/shopping/done' }).flush([MILK]);
    await clearing;
    expect(service.items()).toEqual([MILK]);
  });

  it('reloads the real list when a change fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await loaded();
    const ticking = service.toggle(EGGS);

    http
      .expectOne({ method: 'PUT', url: '/api/shopping/eggs-id' })
      .flush('gone', { status: 404, statusText: 'Not Found' });
    await new Promise((resolve) => setTimeout(resolve));
    http.expectOne('/api/shopping').flush([MILK]);
    await ticking;

    expect(log).toHaveBeenCalledWith('Shopping list change failed', expect.anything());
    expect(service.items()).toEqual([MILK]);
    log.mockRestore();
  });
});
