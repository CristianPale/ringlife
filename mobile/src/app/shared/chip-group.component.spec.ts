import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChipGroupComponent } from './chip-group.component';

@Component({
  imports: [ChipGroupComponent],
  template: `
    <app-chip-group
      label="Prova"
      [options]="options"
      [selected]="selected"
      [multiple]="multiple"
      (changed)="log.push($event)"
    ></app-chip-group>
  `,
})
class HostComponent {
  options = [
    { code: 'a', label: 'A' },
    { code: 'b', label: 'B' },
    { code: 'c', label: 'C' },
  ];
  selected: string[] = ['a'];
  multiple = false;
  log: string[][] = [];
}

describe('ChipGroupComponent', () => {
  function render(configure?: (host: HostComponent) => void) {
    const fixture = TestBed.createComponent(HostComponent);
    configure?.(fixture.componentInstance);
    fixture.detectChanges();
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    return { host: fixture.componentInstance, buttons };
  }

  it('marks the selected choices with aria-pressed', () => {
    const { buttons } = render();
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
  });

  it('names the group for screen readers', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Prova',
    );
  });

  it('single choice: replaces the selection, and a second tap clears it', () => {
    const { host, buttons } = render();
    buttons[1].click();
    buttons[0].click();
    expect(host.log).toEqual([['b'], []]);
  });

  it('multiple choice: adds and removes', () => {
    const { host, buttons } = render((h) => {
      h.multiple = true;
      h.selected = ['a'];
    });
    buttons[1].click();
    buttons[0].click();
    expect(host.log).toEqual([['a', 'b'], []]);
  });
});
