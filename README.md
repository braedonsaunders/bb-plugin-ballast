# Ballast

Physical memory pressure for BB — what is holding your RAM, which thread took
it, and how to shed load before the machine starts paging.

![sidebar: Ballast 85%](assets/icon.svg)

## Install

```sh
bb plugin install bb-plugin-ballast
```

Ballast appears in the sidebar with the current percentage, adds a **Ballast**
panel, and registers `bb ballast` plus three agent tools.

## Why not just read `memory_pressure`

Because it lies. On the machine this was written for it reported 61% free while
the box held 5.2 GB of swap and 6 GB of compressed pages, with 1.4 GB actually
unused — it counts inactive pages as free.

Ballast reads `vm_stat` page classes and reports what Activity Monitor reports,
plus the rates that predict trouble:

| | |
|---|---|
| **Headroom** | free + clean file cache + purgeable — what the next allocation can draw on before anything has to be compressed or paged out |
| **Paging in** | bytes/second read back from swap. The only signal here that measures harm rather than risk |
| **Compression ratio** | how hard the compressor is working to keep the illusion up |
| **Kernel pressure** | macOS's own verdict, which outranks our arithmetic |

Each is graded separately and the worst wins. Swap that is merely *resident*
never raises the level — pages parked there since yesterday cost nothing.

## Memory by thread

Processes are matched to BB threads through worktree paths and argv, so the
panel can say

```
1.49 GB  Fleet8 w3 — e2e inventory to COGS     3 processes
 696 MB  Fleet8 p3 — expense settlement types  5 processes
```

instead of listing six identical `node` rows. That is what makes an
intervention possible: you can steer a thread, but you cannot steer a PID.

## The ladder

Four rungs in order of cost. **All of them are off until you turn them on.**
Ballast reports and plans on a fresh install; it stops nothing.

| Rung | Costs | Fires at |
|---|---|---|
| Throttle BB concurrency | nothing — reversible, auto-restored | warn |
| Ask threads to release memory | a turn | warn |
| Stop disposable processes | whatever it stops | critical |
| Hand the problem to an agent | a thread, once per 20 min | critical |

Escalation runs the spawned thread unattended with full permissions — an agent
that stalls on an approval prompt is useless when nobody is at the keyboard —
and it only starts when the plan has something actionable in it. Steering goes
only to threads that are running right now, never to the composer inbox.

## What it will not stop

Candidates are only ever headless browsers, dev servers, test runners and build
tools, and only when nothing can still be waiting on them — in practice,
orphaned. The one exception is a headless browser idle at no CPU past the
window. A process with a live parent is being held by it, so idle alone never
makes one safe: a language server or bundler at 0% CPU is waiting for work, not
finished.

Refused by construction: agents, BB itself, editors, your browser, containers,
system processes, other users' processes, anything under a minute old, anything
on a protected port, anything matching your exempt patterns, and anything
Ballast could not confidently classify. The plan shows refusals with their
reason rather than hiding them.

`relieve` never accepts a PID — only ids minted by `plan`, re-derived against a
freshly read process table at the moment of the signal, so a recycled PID is
refused rather than killed.

## Cost of running it

A healthy machine costs one ~10 ms memory read a minute: no process table, no
SDK calls. The expensive half runs only under pressure or when you are looking
at it, is cached, and de-duplicates concurrent callers. The panel is push-driven
and idles completely when hidden.

## CLI

```sh
bb ballast status              # pressure and the signals behind it
bb ballast top --limit 20      # largest consumers, by tree and by thread
bb ballast plan                # candidates with ids
bb ballast relieve --safe      # dry run; add --yes to apply
bb ballast log                 # what the guard has done
bb ballast restore             # undo a concurrency throttle
```

## Agent tools

`ballast_status`, `ballast_plan`, `ballast_relieve`, plus a skill. While memory
is under pressure Ballast injects the current numbers into every thread; below
the watch threshold it contributes nothing.

## Settings

In the panel's **Settings** tab: thresholds, the idle window, protected ports
and process patterns, and a switch per rung. Nothing machine-specific ships as
a default — the protected-port list starts empty on purpose.

## Requirements

macOS or Linux. Swap, compression and kernel pressure level are read where the
platform exposes them and reported as absent where it does not.

## Licence

MIT.
