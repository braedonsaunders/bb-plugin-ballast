## What you get

A memory dashboard that tells you where your RAM went, attributes it to the BB
threads that took it, and can shed load before the machine starts paging.

## The number you were given is wrong

The usual way to check memory pressure on macOS is `memory_pressure`, whose
"System-wide memory free percentage" is what most scripts reach for. On the
machine this plugin was written for it reported **61% free** while the box was
holding 5.2 GB of swap, 6 GB of compressed pages, and had 1.4 GB genuinely
unused. It counts inactive pages as free, so it stays reassuring right up until
everything stops.

Ballast reads `vm_stat` page classes directly and reconstructs what Activity
Monitor shows — app memory, wired, compressed, cached files — plus the two
rates that actually predict trouble: how fast the machine is paging in, and how
hard the compressor is working.

Four signals are graded independently and the worst one wins, so 90% used with
6 GB of clean cache behind it is correctly healthy, and 70% used while paging in
300 MB a minute is correctly not. The banner always names the signal that
decided, because an alarm that will not say what moved is one you learn to
ignore.

## Where it went

Consumers are grouped by process tree, so a headless Chrome is one browser
rather than thirty renderers, and by **BB thread** — matched through worktree
paths and argv — so the question becomes *"Fleet w4 is holding 2.4 GB"* rather
than *"node is holding 2.4 GB"*. That is the difference between a number and
something you can act on: one of them names a thread you can talk to.

## Shedding load

Four rungs, in order of what they cost. Each is independent, and all of them
are off unless you turn them on.

1. **Throttle** — lower BB's concurrency so no new threads start. Frees
   nothing, loses nothing, lifted automatically when pressure clears.
2. **Ask** — steer the hungriest threads: close your browsers, stop your dev
   server. Costs a turn, costs no work.
3. **Stop** — terminate disposable processes. The first rung that destroys
   something, so it waits for critical unless you say otherwise.
4. **Escalate** — hand the whole picture to an agent with the tools to work it,
   for when the deterministic rungs were not enough.

Every threshold crossing and every automatic action is logged with the numbers
that triggered it.

## What it will not stop

Only four kinds of process are ever candidates: headless browsers, dev servers,
test runners and build tools — and only when nothing can still be waiting on
them, meaning the process is orphaned or has burned no CPU for longer than the
idle window. An idle dev server is deliberately not safe; idle is a dev
server's resting state.

Agents, BB itself, editors, your own browser, containers, system processes,
anything owned by another user, anything younger than a minute, and anything
Ballast could not confidently identify are refused by construction. Refusals
are shown in the plan with their reason rather than hidden.

The apply step never accepts a PID. It takes identifiers Ballast minted while
building a plan and re-derives each target from a freshly read process table
immediately before signalling — a recycled PID is refused, not killed. The
panel, the `bb ballast` command and an agent all pass through the same gate.

## Cost

A healthy machine is sampled once a minute, and a healthy sample reads only
memory totals — about ten milliseconds, no process table, no SDK call. The
expensive half runs only when pressure is real or someone is looking, is cached
for a few seconds, and de-duplicates concurrent callers. The panel is refreshed
by pushes from the guard rather than by polling, and stops entirely when the
tab is not visible.

## Agents

Ballast registers `ballast_status`, `ballast_plan` and `ballast_relieve` in
every BB thread, plus a skill, so an agent whose build just got killed can
diagnose it without being told the plugin exists. While memory is under
pressure it also injects the current numbers into every thread, with a nudge to
release what it is done with; below the watch threshold it contributes nothing.

## Requirements

macOS or Linux. No account, service, or separate install. Swap, compression and
kernel pressure level are read where the platform exposes them and reported as
absent where it does not.
