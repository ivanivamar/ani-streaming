import { Component, input } from '@angular/core';

/** Stand-in page for routes whose screen is built in Step 4. `heading` comes from route data. */
@Component({
  selector: 'app-placeholder-page',
  template: `
    <section class="placeholder">
      <h1>{{ heading() }}</h1>
      <p>Coming in Step 4 of the revival plan.</p>
    </section>
  `,
  styles: `
    .placeholder {
      padding: 32px;
    }
    h1 {
      margin: 0 0 8px;
      font-weight: 600;
    }
    p {
      margin: 0;
      opacity: 0.6;
    }
  `,
})
export class PlaceholderPage {
  readonly heading = input('');
}
