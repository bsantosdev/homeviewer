import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { ShoppingPage } from './shopping-page';
import { TEST_SETTINGS, provideTestBackend, text } from '../../testing/test-helpers';

describe('ShoppingPage', () => {
  it('shows the list on its own, in the theme from the settings', async () => {
    TestBed.configureTestingModule({ providers: provideTestBackend() });
    const fixture = TestBed.createComponent(ShoppingPage);
    const el = fixture.nativeElement as HTMLElement;
    TestBed.inject(HttpTestingController)
      .expectOne('/api/settings')
      .flush({ ...TEST_SETTINGS, theme: 'light' });
    await fixture.whenStable();

    expect(text(el, 'h1')).toBe('Shopping list');
    expect(el.querySelector('app-shopping-list')).not.toBeNull();
    expect(el.classList).not.toContain('dark');
  });
});
