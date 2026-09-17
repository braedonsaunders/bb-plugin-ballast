/**
 * What gets graded `safe`.
 *
 * `safe` is the tier the guard is allowed to act on without asking, so the
 * question each of these pins is the one that decides it: is anything still
 * waiting on this process? Nothing here may depend on a port number, a
 * directory, or any other local convention — an earlier version graded dev
 * servers by port against a shipped default list, which worked on exactly one
 * machine.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { userInfo } from "node:os";
import { buildPlan } from "../lib/relieve.ts";

const ME = userInfo().username;

const config = {
  protectedPorts: new Set(),
  exemptPatterns: [],
  idleSeconds: 600,
  protectedThreadIds: new Set(),
};

const consumer = (over = {}) => ({
  id: "pid:100",
  label: "thing",
  detail: "cmd",
  kind: "browser-automation",
  bytes: 1024 ** 3,
  processCount: 1,
  rootPid: 100,
  parentPid: 900,
  pids: [100],
  ageSeconds: 3600,
  cpuPercent: 0,
  threadId: null,
  threadTitle: null,
  port: null,
  ...over,
});

const row = (over = {}) => ({
  pid: 100,
  ppid: 900,
  rssBytes: 1024 ** 3,
  ageSeconds: 3600,
  cpuPercent: 0,
  command: "cmd",
  name: "cmd",
  user: ME,
  kind: "browser-automation",
  threadId: null,
  port: null,
  ...over,
});

const planFor = (over = {}, rowOver = {}) =>
  buildPlan({
    consumers: [consumer(over)],
    threadConsumers: [],
    rows: [row({ kind: over.kind ?? "browser-automation", ...rowOver })],
    config,
    selfPids: new Set(),
    steerLimit: 0,
  });

const riskOf = (plan) => plan.candidates[0]?.risk ?? null;

test("an idle headless browser is safe, a busy one is not", () => {
  assert.equal(riskOf(planFor({ cpuPercent: 0, ageSeconds: 3600 })), "safe");
  // Mid-assertion: killing this fails somebody's test run.
  assert.equal(riskOf(planFor({ cpuPercent: 30, ageSeconds: 3600 })), "disruptive");
  // Idle, but not for long enough to call it abandoned.
  assert.equal(riskOf(planFor({ cpuPercent: 0, ageSeconds: 120 })), "disruptive");
});

test("an orphan is safe whatever it is doing, because nothing can be waiting on it", () => {
  const orphan = { parentPid: 1, cpuPercent: 80, ageSeconds: 120 };
  assert.equal(riskOf(planFor(orphan, { ppid: 1 })), "safe");
});

test("an idle dev server is NOT safe — idle is a server's resting state", () => {
  const idleServer = { kind: "dev-server", cpuPercent: 0, ageSeconds: 7200, port: 5173 };
  assert.equal(riskOf(planFor(idleServer, { kind: "dev-server" })), "disruptive");

  // Orphaned is different: whatever started it is gone.
  const orphanServer = { ...idleServer, parentPid: 1 };
  assert.equal(riskOf(planFor(orphanServer, { kind: "dev-server", ppid: 1 })), "safe");
});

test("a finished test runner is safe; one still running is not", () => {
  const done = { kind: "test-runner", cpuPercent: 0, ageSeconds: 3600 };
  assert.equal(riskOf(planFor(done, { kind: "test-runner" })), "safe");

  const running = { kind: "test-runner", cpuPercent: 95, ageSeconds: 3600 };
  assert.equal(riskOf(planFor(running, { kind: "test-runner" })), "disruptive");
});

test("safeBytes counts only the safe terminate candidates", () => {
  const plan = buildPlan({
    consumers: [
      consumer({ id: "a", rootPid: 100, pids: [100], bytes: 1024 ** 3 }),
      consumer({ id: "b", rootPid: 101, pids: [101], bytes: 2 * 1024 ** 3, cpuPercent: 50 }),
    ],
    threadConsumers: [],
    rows: [row({ pid: 100 }), row({ pid: 101 })],
    config,
    selfPids: new Set(),
    steerLimit: 0,
  });
  assert.equal(plan.safeBytes, 1024 ** 3);
  assert.equal(plan.disruptiveBytes, 2 * 1024 ** 3);
});

test("steering a thread is always disruptive and never counted as freed bytes", () => {
  const plan = buildPlan({
    consumers: [],
    threadConsumers: [
      consumer({ id: "t", threadId: "thr_abc", label: "Some thread", bytes: 3 * 1024 ** 3 }),
    ],
    rows: [],
    config,
    selfPids: new Set(),
    steerLimit: 3,
  });
  const steer = plan.candidates.find((row) => row.action === "steer");
  assert.ok(steer);
  assert.equal(steer.risk, "disruptive");
  // Asking a thread to release memory frees nothing by itself, so it must not
  // inflate the total the panel offers to free.
  assert.equal(plan.safeBytes, 0);
  assert.equal(plan.disruptiveBytes, 0);
});
