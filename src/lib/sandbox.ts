// Browser sandbox: runs untrusted JS in disposable Web Workers with per-test timeouts.
export type TestStatus = "pass" | "fail" | "error" | "timeout";
export interface SandboxTest {
  id: string;
  name: string;
  body: string;
}
export interface TestResult {
  id: string;
  name: string;
  status: TestStatus;
  message: string;
  console: string[];
  durationMs: number;
}
export type LoadCheck =
  | { ok: true }
  | { ok: false; reason: "parse" | "missing_entry" | "timeout" | "invalid_entry"; message: string };

const WORKER_SRC = `
"use strict";
(function(){
  var post = self.postMessage.bind(self);
  var Fn = Function;
  self.onmessage = function(e) {
    var data = e.data;
    self.onmessage = null;
    var logs = [];
    function fmt(v){ try { return typeof v === 'string' ? v : JSON.stringify(v); } catch(_) { return String(v); } }
    function cap(){ var a = Array.prototype.slice.call(arguments); if (logs.length < 20) logs.push(a.map(fmt).join(' ').slice(0, 500)); }
    console.log = cap; console.info = cap; console.warn = cap; console.error = cap; console.debug = cap;
    var blocked = ['fetch','XMLHttpRequest','WebSocket','importScripts','indexedDB','localStorage','sessionStorage','caches','EventSource','BroadcastChannel','Worker','SharedWorker','WebTransport','postMessage','close'];
    for (var i = 0; i < blocked.length; i++) {
      try { Object.defineProperty(self, blocked[i], { value: undefined, writable: false, configurable: false }); } catch (_) { try { self[blocked[i]] = undefined; } catch (__) {} }
    }
    var fn;
    try {
      fn = new Fn(data.code + "\\n;return (typeof " + data.entry + " !== 'undefined') ? " + data.entry + " : undefined;")();
    } catch (err) {
      post({ kind: 'load_error', message: String(err && err.message || err), console: logs });
      return;
    }
    if (typeof fn !== 'function') { post({ kind: 'missing_entry', message: 'Entry function "' + data.entry + '" not found', console: logs }); return; }
    if (!data.test) { post({ kind: 'loaded', console: logs }); return; }
    function AssertionError(m){ this.name = 'AssertionError'; this.message = m; }
    AssertionError.prototype = Object.create(Error.prototype);
    var assert = function(c, m){ if (!c) throw new AssertionError(m || 'Assertion failed'); };
    var t0 = performance.now();
    try {
      var r = new Fn('fn', 'assert', data.test.body)(fn, assert);
      if (r && typeof r.then === 'function') throw new Error('Async tests are not supported');
      post({ kind: 'result', status: 'pass', message: '', console: logs, durationMs: performance.now() - t0 });
    } catch (err) {
      var isAssert = err && err.name === 'AssertionError';
      post({ kind: 'result', status: isAssert ? 'fail' : 'error', message: String(err && err.message || err).slice(0, 1000), console: logs, durationMs: performance.now() - t0 });
    }
  };
})();
`;

let workerUrl: string | null = null;
function getWorkerUrl() {
  if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
  return workerUrl;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

type WorkerMsg = { kind: string; status?: TestStatus; message?: string; console?: string[]; durationMs?: number };

function runInWorker(code: string, entry: string, test: SandboxTest | null, timeoutMs: number): Promise<WorkerMsg> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(getWorkerUrl());
    } catch (e) {
      resolve({ kind: "load_error", message: "Could not start sandbox: " + String(e) });
      return;
    }
    const t0 = performance.now();
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ kind: "timeout", message: `TIMEOUT after ${timeoutMs}ms`, durationMs: performance.now() - t0 });
    }, timeoutMs);
    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data as WorkerMsg);
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      e.preventDefault();
      resolve({ kind: "load_error", message: e.message || "Worker error" });
    };
    worker.postMessage({ code, entry, test });
  });
}

export async function preflight(code: string, entry: string, timeoutMs = 3000): Promise<LoadCheck> {
  if (!IDENT.test(entry)) return { ok: false, reason: "invalid_entry", message: `"${entry}" is not a valid function name` };
  const r = await runInWorker(code, entry, null, timeoutMs);
  if (r.kind === "loaded") return { ok: true };
  if (r.kind === "timeout") return { ok: false, reason: "timeout", message: "Code timed out while loading (infinite loop at top level?)" };
  if (r.kind === "missing_entry") return { ok: false, reason: "missing_entry", message: r.message ?? "Entry function missing" };
  return { ok: false, reason: "parse", message: r.message ?? "Code failed to load" };
}

export async function runTests(
  code: string,
  entry: string,
  tests: SandboxTest[],
  timeoutMs = 3000,
  concurrency = 4,
): Promise<TestResult[]> {
  const out: TestResult[] = new Array(tests.length);
  let idx = 0;
  async function lane() {
    while (idx < tests.length) {
      const i = idx++;
      const t = tests[i];
      try {
        if (!IDENT.test(entry)) throw new Error("Invalid entry function name");
        const r = await runInWorker(code, entry, t, timeoutMs);
        if (r.kind === "result") {
          out[i] = { id: t.id, name: t.name, status: r.status!, message: r.message ?? "", console: r.console ?? [], durationMs: r.durationMs ?? 0 };
        } else if (r.kind === "timeout") {
          out[i] = { id: t.id, name: t.name, status: "timeout", message: r.message ?? "TIMEOUT", console: [], durationMs: r.durationMs ?? timeoutMs };
        } else {
          out[i] = { id: t.id, name: t.name, status: "error", message: (r.kind === "missing_entry" ? "" : "Load error: ") + (r.message ?? "unknown"), console: r.console ?? [], durationMs: 0 };
        }
      } catch (e) {
        out[i] = { id: t.id, name: t.name, status: "error", message: String(e), console: [], durationMs: 0 };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tests.length) }, lane));
  return out;
}

export function functionNamesIn(code: string): string[] {
  const names = new Set<string>();
  const re = /(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)|class\s+([A-Za-z_$][\w$]*))/g;
  let m;
  while ((m = re.exec(code))) names.add(m[1] || m[2] || m[3]);
  return [...names];
}
