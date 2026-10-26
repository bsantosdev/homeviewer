import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Maintenance } from './maintenance';
import { SettingsService } from '../settings.service';
import { provideTestBackend, text } from '../../testing/test-helpers';

describe('Maintenance', () => {
  let fixture: ComponentFixture<Maintenance>;
  let el: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: provideTestBackend() });
    fixture = TestBed.createComponent(Maintenance);
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('stays out of the way while the server is reachable', () => {
    expect(el.querySelector('.maintenance')).toBeNull();
  });

  it('covers the page while the server is out of reach, and goes once it’s back', async () => {
    const online = TestBed.inject(SettingsService).online;

    online.set(false);
    await fixture.whenStable();
    expect(el.querySelector('.maintenance')?.getAttribute('role')).toBe('alert');
    expect(text(el, 'h2')).toBe('Under maintenance');

    online.set(true);
    await fixture.whenStable();
    expect(el.querySelector('.maintenance')).toBeNull();
  });
});
