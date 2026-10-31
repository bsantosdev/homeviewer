import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { query, text } from '../../testing/test-helpers';
import { Choice, MultiSelect } from './multi-select';

const SCENES: Choice[] = [
  { value: 'read', label: 'Read', group: 'Kitchen' },
  { value: 'cook', label: 'Cook', group: 'Kitchen' },
  { value: 'relax', label: 'Relax', group: 'Living room' },
];

@Component({
  imports: [MultiSelect],
  template: `
    <app-multi-select
      [choices]="choices()"
      [(selected)]="selected"
      label="Scenes"
      placeholder="None"
    />
    <button type="button" class="outside">Elsewhere</button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly choices = signal(SCENES);
  readonly selected = signal<string[]>([]);
}

describe('MultiSelect', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let el: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
  });

  function box(label: string): HTMLInputElement {
    const match = Array.from(el.querySelectorAll('.choice')).find(
      (l) => l.textContent.trim() === label,
    );
    if (!match) throw new Error(`No choice "${label}"`);
    return query(match, 'input', HTMLInputElement);
  }

  async function open(): Promise<void> {
    query(el, '.trigger').click();
    await fixture.whenStable();
  }

  it('says what it shows while nothing is picked, closed', async () => {
    // Act
    await fixture.whenStable();

    // Assert
    expect(text(el, '.summary')).toBe('None');
    expect(query(el, '.trigger').getAttribute('aria-label')).toBe('Scenes');
    expect(query(el, '.trigger').getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('.choices')).toBeNull();
  });

  it('opens the choices under their group, with the picked ones ticked', async () => {
    // Arrange
    host.selected.set(['relax']);

    // Act
    await open();

    // Assert
    expect(query(el, '.trigger').getAttribute('aria-expanded')).toBe('true');
    expect(Array.from(el.querySelectorAll('.heading'), (h) => h.textContent.trim())).toEqual([
      'Kitchen',
      'Living room',
    ]);
    expect(Array.from(el.querySelectorAll('.choice'), (c) => c.textContent.trim())).toEqual([
      'Read',
      'Cook',
      'Relax',
    ]);
    expect(box('Relax').checked).toBe(true);
    expect(box('Read').checked).toBe(false);
    expect(text(el, '.summary')).toBe('Living room · Relax');
  });

  it('picks in the order ticked, and unpicks', async () => {
    // Arrange
    await open();

    // Act
    for (const label of ['Relax', 'Read', 'Relax', 'Relax']) {
      box(label).click();
      await fixture.whenStable();
    }

    // Assert
    expect(host.selected()).toEqual(['read', 'relax']);
    expect(text(el, '.summary')).toBe('Kitchen · Read, Living room · Relax');
    expect(el.querySelector('.choices')).not.toBeNull();
  });

  it('lists choices without a group plainly', async () => {
    // Arrange
    host.choices.set([
      { value: 'kitchen', label: 'Kitchen' },
      { value: 'porch', label: 'Porch' },
    ]);
    host.selected.set(['porch', 'kitchen']);

    // Act
    await open();

    // Assert
    expect(el.querySelector('.heading')).toBeNull();
    expect(text(el, '.summary')).toBe('Porch, Kitchen');
  });

  it('leaves out picked values that are no longer offered', async () => {
    // Arrange
    host.selected.set(['gone', 'read']);

    // Act
    await fixture.whenStable();

    // Assert
    expect(text(el, '.summary')).toBe('Kitchen · Read');
  });

  it('stays open while ticking', async () => {
    // Arrange
    await open();

    // Act
    box('Read').click();
    await fixture.whenStable();

    // Assert
    expect(el.querySelector('.choices')).not.toBeNull();
  });

  it.each([
    [
      'the field',
      () => {
        query(el, '.trigger').click();
      },
    ],
    [
      'a tap elsewhere',
      () => {
        query(el, '.outside').click();
      },
    ],
    [
      'Escape',
      () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      },
    ],
  ])('closes from %s', async (_, close) => {
    // Arrange
    await open();

    // Act
    close();
    await fixture.whenStable();

    // Assert
    expect(el.querySelector('.choices')).toBeNull();
    expect(query(el, '.trigger').getAttribute('aria-expanded')).toBe('false');
  });
});
