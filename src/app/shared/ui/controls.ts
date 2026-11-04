import { booleanAttribute, Component, Directive, input, model } from '@angular/core';
import type { FormCheckboxControl, FormValueControl } from '@angular/forms/signals';

/**
 * Pill: active = mint fill / `#08110c`; inactive = transparent, hairline border, `#a5a5ad`.
 * `<button appPill [on]="x">` plus optional size class `pill-md` / `pill-lg`.
 */
@Directive({
  selector: '[appPill]',
  host: { class: 'pill', '[class.on]': 'on()', '[attr.aria-pressed]': 'on()' },
})
export class Pill {
  readonly on = input(false, { transform: booleanAttribute });
}

export interface SegmentOption<T> {
  readonly value: T;
  readonly label: string;
}

/**
 * Segmented control. Track `#16171b` (or `#111216` with `tone="inset"` inside settings rows),
 * radius 10–11, 3px padding; the active segment uses pill colours. Signal Forms control
 * (`[formField]`) or plain `[(value)]`.
 */
@Component({
  selector: 'app-segmented',
  host: {
    role: 'radiogroup',
    '[class.inset]': "tone() === 'inset'",
    '[class.fill]': 'fill()',
    '[class.sm]': "size() === 'sm'",
  },
  template: `
    @for (o of options(); track o.value) {
      <button
        type="button"
        role="radio"
        [attr.aria-checked]="o.value === value()"
        [class.on]="o.value === value()"
        [disabled]="disabled()"
        (click)="value.set(o.value)"
      >
        {{ o.label }}
      </button>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      gap: 3px;
      padding: 3px;
      border-radius: 11px;
      background: var(--surface);
      border: 1px solid var(--line-3);
    }
    :host(.inset) {
      background: var(--panel-bg);
      border-radius: 10px;
    }
    :host(.fill) {
      display: flex;
    }
    :host(.fill) button {
      flex: 1;
    }
    button {
      height: 34px;
      padding: 0 14px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--text-3);
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      transition:
        background 0.15s,
        color 0.15s;
    }
    :host(.sm) button {
      height: 32px;
      border-radius: 7px;
    }
    :host(.fill) button {
      height: 36px;
    }
    button:not(.on):hover {
      color: var(--text);
    }
    button.on {
      background: var(--accent);
      color: var(--on-accent);
    }
  `,
})
export class Segmented<T> implements FormValueControl<T> {
  readonly value = model.required<T>();
  readonly options = input.required<readonly SegmentOption<T>[]>();
  readonly disabled = input(false);
  readonly tone = input<'panel' | 'inset'>('panel');
  readonly size = input<'md' | 'sm'>('md');
  /** stretch segments to the full width (welcome screen) */
  readonly fill = input(false, { transform: booleanAttribute });
}

/** Toggle switch: 44×26 track, mint when on, knob `#08110c` on / grey off. */
@Component({
  selector: 'app-toggle',
  template: `
    <button
      type="button"
      role="switch"
      [attr.aria-checked]="checked()"
      [attr.aria-label]="label() || null"
      [disabled]="disabled()"
      [class.on]="checked()"
      (click)="checked.set(!checked())"
    >
      <span></span>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    button {
      width: 44px;
      height: 26px;
      padding: 3px;
      border: none;
      border-radius: 999px;
      background: #2a2b31;
      transition: background 0.18s;
    }
    button.on {
      background: var(--accent);
    }
    span {
      display: block;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #9a9aa2;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
      transition:
        transform 0.18s ease,
        background 0.18s;
    }
    .on span {
      transform: translateX(18px);
      background: var(--on-accent);
    }
  `,
})
export class Toggle implements FormCheckboxControl {
  readonly checked = model(false);
  readonly disabled = input(false);
  readonly label = input('');
}
