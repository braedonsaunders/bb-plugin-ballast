// Ballast — frontend entry.
//
// Layout contract: the panel is an APP, not a document. The outermost element
// is `h-full min-h-0 overflow-hidden` and every scroll happens inside a
// `min-h-0 flex-1 overflow-y-auto` region, so the page itself never scrolls and
// the pressure band stays pinned while you read the consumer list under it.
import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { HistoryChart, PressureBand, StatTile } from "@/components/meter";
import { AttributionNote, ConsumerList, EmptyState, KindBand } from "@/components/consumers";
import { ReliefPanel } from "@/components/relief-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { formatAgo, formatBytes, formatPercent } from "@/lib/format";
import { levelIcon, levelTone, toneFill, toneText, toneTrack } from "@/lib/ui";
import type { Overview, Plan, Pressure, ReliefResult } from "@/lib/contract";
import type { rpcContract } from "./server";

/**
 * The panel is push-driven, not poll-driven.
 *
 * The guard publishes on the `pressure` channel whenever the level changes or
 * it acts, and that is what refreshes this view. The interval below is a
 * backstop so the numbers do not go stale while nothing notable is happening —
 * and it only fires while the tab is actually visible. Polling a full process
 * table every few seconds to animate a dashboard nobody is looking at is
 * exactly the behaviour this plugin exists to catch other programs doing.
 */
const OVERVIEW_POLL_MS = 30_000;

/* ------------------------------------------------------------------ */
/* data                                                                */
/* ------------------------------------------------------------------ */

function useOverview() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    rpc.call("overview").then(
      (next) => {
        setData(next);
        setError(null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [rpc]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, OVERVIEW_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useRealtime("pressure", load);

  return { data, error, reload: load };
}

/* ------------------------------------------------------------------ */
/* panel                                                               */
/* ------------------------------------------------------------------ */

type Tab = "overview" | "threads" | "relief" | "log" | "settings";

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "LayoutDashboard" },
  { id: "threads", label: "Threads", icon: "MessageSquare" },
  { id: "relief", label: "Relief", icon: "Wind" },
  { id: "log", label: "Activity", icon: "ScrollText" },
  { id: "settings", label: "Settings", icon: "Settings" },
];

function GuardBanner({
  overview,
  onOpenSettings,
}: {
  overview: Overview;
  onOpenSettings: () => void;
}) {
  if (!overview.escalationUnconfigured) return null;
  return (
    <div className="flex items-start gap-2 border-b border-border bg-muted/40 px-4 py-2 md:px-5">
      <Icon name="Info" className="mt-0.5 size-4 shrink-0 text-primary" />
      <p className="text-xs text-muted-foreground">
        Agent escalation is on but has no project to start threads in, so the guard will log an
        escalation and do nothing.{" "}
        <button type="button" className="underline hover:text-foreground" onClick={onOpenSettings}>
          Choose a project
        </button>
        .
      </p>
    </div>
  );
}

function ActivityLog({ overview }: { overview: Overview }) {
  if (overview.events.length === 0) {
    return (
      <EmptyState
        icon="ScrollText"
        title="The guard has not had to do anything"
        body="Every threshold crossing and every automatic action lands here, with the numbers that triggered it."
      />
    );
  }
  return (
    <ul className="divide-y divide-border">
      {overview.events.map((event) => {
        const tone = levelTone(event.level);
        return (
          <li key={event.id} className="flex items-start gap-3 px-4 py-2 md:px-5">
            <Icon
              name={levelIcon(event.level)}
              className={cn("mt-0.5 size-4 shrink-0", toneText[tone])}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm capitalize">{event.action}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatAgo(event.atMs)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{event.detail}</p>
              <p className="text-[11px] tabular-nums text-muted-foreground">
                {formatBytes(event.headroomBytes)} headroom ·{" "}
                {formatPercent(event.usedFraction, 1)} used
                {event.bytesFreed > 0 ? ` · ${formatBytes(event.bytesFreed)} released` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function BallastPage() {
  const rpc = useRpc<typeof rpcContract>();
  const { data, error, reload } = useOverview();
  const [tab, setTab] = useState<Tab>("overview");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<ReliefResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data !== null) setPlan(data.plan);
  }, [data]);

  const refreshPlan = useCallback(() => {
    setBusy(true);
    rpc.call("plan", { force: true }).then(
      (next) => {
        setPlan(next);
        setBusy(false);
      },
      () => setBusy(false),
    );
  }, [rpc]);

  const relieve = useCallback(
    (ids: string[], dryRun: boolean) => {
      setBusy(true);
      rpc.call("relieve", { ids, dryRun }).then(
        (next) => {
          setResult(next);
          setBusy(false);
          if (!dryRun) {
            reload();
            refreshPlan();
          }
        },
        () => setBusy(false),
      );
    },
    [rpc, reload, refreshPlan],
  );

  if (error !== null) {
    return (
      <EmptyState
        icon="AlertTriangle"
        title="Could not read memory"
        body={error}
      />
    );
  }
  if (data === null) {
    return <div className="px-5 py-6 text-sm text-muted-foreground">Reading memory…</div>;
  }

  const { pressure } = data;
  const consumerTotal = data.byKind.reduce((sum, row) => sum + row.bytes, 0);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PressureBand pressure={pressure} />
      <GuardBanner overview={data} onOpenSettings={() => setTab("settings")} />

      <nav className="flex shrink-0 gap-1 border-b border-border px-3 py-1.5">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
              tab === entry.id
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon name={entry.icon} className="size-3.5" />
            {entry.label}
            {entry.id === "relief" && plan !== null && plan.safeBytes > 0 ? (
              <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">
                {formatBytes(plan.safeBytes)}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "overview" ? (
          <>
            <HistoryChart history={data.history} pressure={pressure} />
            <KindBand byKind={data.byKind} total={consumerTotal} />
            <ConsumerList
              title="Largest consumers"
              hint="grouped by process tree"
              consumers={data.consumers}
              emptyMessage="Nothing above the reporting floor."
            />
            <AttributionNote />
          </>
        ) : null}

        {tab === "threads" ? (
          data.threads.length === 0 ? (
            <EmptyState
              icon="MessageSquare"
              title="No BB thread is holding memory"
              body="Processes are matched to threads by their worktree path and argv. Nothing running right now belongs to a thread."
            />
          ) : (
            <>
              <ConsumerList
                title="Memory by BB thread"
                hint="worktree paths matched to threads"
                consumers={data.threads}
                emptyMessage="No thread-owned processes."
                showComposition
              />
              <AttributionNote />
            </>
          )
        ) : null}

        {tab === "relief" ? (
          <ReliefPanel
            plan={plan}
            busy={busy}
            result={result}
            onRelieve={relieve}
            onRefresh={refreshPlan}
          />
        ) : null}

        {tab === "log" ? <ActivityLog overview={data} /> : null}

        {tab === "settings" ? (
          <SettingsPanel
            onChanged={() => {
              reload();
              refreshPlan();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function PanelHeaderActions() {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        rpc.call("escalate", {}).finally(() => setBusy(false));
      }}
    >
      <Icon name="Sparkles" className="mr-1.5 size-3.5" />
      {busy ? "Starting…" : "Hand to an agent"}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* compact surfaces                                                    */
/* ------------------------------------------------------------------ */

/** Sidebar row accessory: the one number worth carrying everywhere. */
function SidebarPressure() {
  const rpc = useRpc<typeof rpcContract>();
  const [percent, setPercent] = useState<number | null>(null);
  const [tone, setTone] = useState<ReturnType<typeof levelTone>>("neutral");

  const load = useCallback(() => {
    rpc.call("pressure").then(
      (pressure: Pressure) => {
        const { sample } = pressure;
        setPercent(sample.totalBytes > 0 ? sample.usedBytes / sample.totalBytes : 0);
        setTone(levelTone(pressure.level));
      },
      () => {},
    );
  }, [rpc]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);
  useRealtime("pressure", load);

  if (percent === null) return null;
  return (
    // text-xs matches the Reclaim and Provider Usage sidebar indicators, so the
    // three plugins' numbers sit at the same weight rather than one looking
    // like a footnote to the others.
    <span className={cn("text-xs font-medium tabular-nums", toneText[tone])}>
      {formatPercent(percent)}
    </span>
  );
}

function HomepageMemory() {
  const rpc = useRpc<typeof rpcContract>();
  const [pressure, setPressure] = useState<Pressure | null>(null);

  const load = useCallback(() => {
    rpc.call("pressure").then(setPressure, () => {});
  }, [rpc]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime("pressure", load);

  if (pressure === null) return null;
  const tone = levelTone(pressure.level);
  const { sample } = pressure;
  const used = sample.totalBytes > 0 ? sample.usedBytes / sample.totalBytes : 0;

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-3">
        <Icon name={levelIcon(pressure.level)} className={cn("size-5 shrink-0", toneText[tone])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cn("text-lg font-semibold tabular-nums", toneText[tone])}>
              {formatPercent(used, 1)}
            </span>
            <span className="text-sm text-muted-foreground">
              used · {formatBytes(sample.headroomBytes)} headroom
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">{pressure.reason}</p>
        </div>
      </div>
      {/* toneFill, never a class built by string manipulation — Tailwind only
          emits classes it can see literally in the source. */}
      <div className={cn("mt-2 h-1.5 w-full overflow-hidden rounded-full", toneTrack[tone])}>
        <div
          className={cn("h-full rounded-full", toneFill[tone])}
          style={{ width: `${Math.min(100, used * 100)}%` }}
        />
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "ballast",
    title: "Ballast",
    icon: "Weight",
    path: "ballast",
    component: BallastPage,
    headerContent: PanelHeaderActions,
    experimental_sidebarAccessory: SidebarPressure,
  });
  app.slots.homepageSection({
    id: "memory",
    title: "Memory",
    component: HomepageMemory,
  });
});

export { StatTile };
