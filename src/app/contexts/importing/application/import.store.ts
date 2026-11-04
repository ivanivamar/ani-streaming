import { computed, DestroyRef, inject, Service, signal } from '@angular/core';
import { SessionStore } from '@identity/application';
import { groupScan, ImportGateway, isAgentOnline, type AgentStatus, type ImportJob, type ScanEntry } from '../domain';

/**
 * Live state of the PC import agent for the Import page: agent heartbeat, scanned files, jobs.
 * Listeners run only while a page holds `connect()` (ref-counted), so other pages pay nothing.
 */
@Service()
export class ImportStore {
  private readonly gateway = inject(ImportGateway);
  private readonly session = inject(SessionStore);

  private readonly _agent = signal<AgentStatus | null>(null);
  private readonly _scan = signal<readonly ScanEntry[]>([]);
  private readonly _jobs = signal<readonly ImportJob[]>([]);
  private readonly _loaded = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _now = signal(Date.now());
  private users = 0;
  private stops: (() => void)[] = [];
  private tick: ReturnType<typeof setInterval> | undefined;

  readonly agent = this._agent.asReadonly();
  readonly scan = this._scan.asReadonly();
  readonly jobs = this._jobs.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly error = this._error.asReadonly();
  readonly now = this._now.asReadonly();

  readonly online = computed(() => isAgentOnline(this._agent(), this._now()));
  readonly groups = computed(() => groupScan(this._scan()));
  readonly activeJobs = computed(() => this._jobs().filter((j) => j.status === 'running' || j.status === 'queued'));
  readonly finishedJobs = computed(() => this._jobs().filter((j) => j.status !== 'running' && j.status !== 'queued').slice(0, 3));
  /** scan ids already waiting in or running a job (not selectable again) */
  readonly busyIds = computed(() => new Set(this.activeJobs().flatMap((j) => j.sources.filter((s) => !j.results[s]))));

  /** Start listening for as long as the calling page lives (`DestroyRef`). */
  connect(destroyRef: DestroyRef): void {
    if (this.users++ === 0) {
      const fail = (e: Error) => this._error.set(e.message);
      let pending = 3;
      const ready = () => --pending <= 0 && this._loaded.set(true);
      this.stops = [
        this.gateway.watchAgent((a) => (this._agent.set(a), ready()), fail),
        this.gateway.watchScan((s) => (this._scan.set(s), ready()), fail),
        this.gateway.watchJobs((j) => (this._jobs.set(j), ready()), fail),
      ];
      this.tick = setInterval(() => this._now.set(Date.now()), 10_000);
    }
    destroyRef.onDestroy(() => {
      if (--this.users > 0) return;
      this.stops.forEach((s) => s());
      this.stops = [];
      clearInterval(this.tick);
      this._loaded.set(false);
    });
  }

  requestScan(): Promise<void> {
    return this.gateway.requestScan();
  }

  async queue(ids: readonly string[], opts: { forceEncode: boolean }): Promise<void> {
    const byId = new Map(this._scan().map((e) => [e.id, e]));
    const entries = ids.map((id) => byId.get(id)).filter((e): e is ScanEntry => !!e);
    if (!entries.length) return;
    entries.sort((a, b) => (a.parsed?.title ?? '').localeCompare(b.parsed?.title ?? '') || (a.parsed?.season ?? 0) - (b.parsed?.season ?? 0) || (a.parsed?.episode ?? 0) - (b.parsed?.episode ?? 0));
    await this.gateway.createJob({
      sources: entries.map((e) => e.id),
      labels: entries.map((e) => (e.parsed ? `${e.parsed.title} ${e.episodeId?.toUpperCase() ?? ''}`.trim() : e.fileName)),
      createdBy: this.session.uid() ?? '',
      forceEncode: opts.forceEncode,
      replace: false,
    });
  }

  cancel(jobId: string): Promise<void> {
    return this.gateway.cancelJob(jobId);
  }

  /** Pick an AniList entry for a series without an exact match, then rescan to show it. */
  async useMatch(seriesId: string, anilistId: number): Promise<void> {
    await this.gateway.setOverride(seriesId, anilistId);
    await this.gateway.requestScan();
  }
}
