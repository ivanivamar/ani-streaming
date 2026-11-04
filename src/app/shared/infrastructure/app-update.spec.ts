import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppUpdate, SW_CONTAINER } from './app-update';

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  readonly posted: unknown[] = [];
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  become(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  updates = 0;
  async update() {
    this.updates++;
  }
}

class FakeContainer extends EventTarget {
  controller: object | null = {};
  readonly reg = new FakeRegistration();
  get ready() {
    return Promise.resolve(this.reg);
  }
}

function setup(container: FakeContainer | null) {
  const reload = vi.fn();
  const doc = document.implementation.createHTMLDocument('t');
  const win = {
    location: { reload },
    setInterval: () => 0,
    setTimeout: () => 0,
  };
  Object.defineProperty(doc, 'defaultView', { value: win });
  TestBed.configureTestingModule({
    providers: [
      { provide: SW_CONTAINER, useValue: container },
      { provide: DOCUMENT, useValue: doc },
    ],
  });
  return { updates: TestBed.inject(AppUpdate), reload };
}

describe('AppUpdate', () => {
  it('does nothing without service workers', async () => {
    const { updates } = setup(null);
    await updates.start();
    expect(updates.available()).toBe(false);
  });

  it('prompts for a worker that is already waiting', async () => {
    const sw = new FakeContainer();
    sw.reg.waiting = new FakeWorker();
    const { updates } = setup(sw);
    await updates.start();
    expect(updates.available()).toBe(true);
  });

  it('prompts when a new build finishes installing, not on the first install', async () => {
    const sw = new FakeContainer();
    sw.controller = null;
    const { updates } = setup(sw);
    await updates.start();

    const first = new FakeWorker();
    sw.reg.installing = first;
    sw.reg.dispatchEvent(new Event('updatefound'));
    first.become('installed');
    expect(updates.available()).toBe(false);

    sw.controller = {};
    const next = new FakeWorker();
    sw.reg.installing = next;
    sw.reg.dispatchEvent(new Event('updatefound'));
    next.become('installed');
    expect(updates.available()).toBe(true);
  });

  it('reload tells the waiting worker to take over and reloads on controllerchange', async () => {
    const sw = new FakeContainer();
    const waiting = new FakeWorker();
    sw.reg.waiting = waiting;
    const { updates, reload } = setup(sw);
    await updates.start();

    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();

    updates.reload();
    expect(waiting.posted).toEqual([{ type: 'ani:skip-waiting' }]);
    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalled();
  });

  it('dismiss hides the prompt; check asks for a new sw.js', async () => {
    const sw = new FakeContainer();
    sw.reg.waiting = new FakeWorker();
    const { updates } = setup(sw);
    await updates.start();
    updates.dismiss();
    expect(updates.available()).toBe(false);
    await updates.check();
    expect(sw.reg.updates).toBe(1);
  });
});
