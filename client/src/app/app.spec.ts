import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';
import { Admin } from './admin/admin';
import { Dashboard } from './dashboard/dashboard';
import { WeatherService } from './weather.service';
import { TEST_SETTINGS, provideTestBackend } from '../testing/test-helpers';

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        ...provideTestBackend(),
        { provide: WeatherService, useValue: { current: () => new Promise(() => undefined) } },
      ],
    });
  });

  it('renders a router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('router-outlet')).not.toBeNull();
  });

  it.each([
    ['/', Dashboard],
    ['/admin', Admin],
    ['/unknown', Dashboard],
  ])('routes %s to the right page', async (url, page) => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl(url);
    TestBed.inject(HttpTestingController).expectOne('/api/settings').flush(TEST_SETTINGS);
    expect(component).toBeInstanceOf(page);
  });
});
