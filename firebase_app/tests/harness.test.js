test("harness self-check", () => {
  eq(1 + 1, 2);
  eq({ a: [1] }, { a: [1] });
});

test("harness self-check (async)", async () => {
  await new Promise((r) => setTimeout(r, 10));
  ok(true);
});

test("harness longer limit when asked", async () => {
  await new Promise((r) => setTimeout(r, 5200));   // past the 5 s default
  ok(true);
}, { timeoutMs: 8000 });

// A test file that can't be loaded (syntax error, throws while loading, missing) must fail
// the run. tests/harness-selftest.html loads such files; its result stays on that page.
test("harness fails the run when a test file can't load", async () => {
  const f = document.createElement("iframe");
  document.body.appendChild(f);
  f.src = "/tests/harness-selftest.html";
  try {
    const start = Date.now();
    let log = "";
    while (!/RESULT/.test(log)) {
      if (Date.now() - start > 4000) throw new Error("self-test page gave no result: " + log);
      await new Promise((r) => setTimeout(r, 50));
      const el = f.contentDocument && f.contentDocument.getElementById("log");
      log = el ? el.textContent : "";
    }
    const lines = log.trim().split("\n");
    const failed = (file) => lines.some((l) => l.indexOf("FAIL load ") === 0 && l.indexOf(file) > 0);
    ok(failed("fixtures/harness-syntax-error.js"), "syntax error not counted: " + log);
    ok(failed("fixtures/harness-throws.js"), "throw while loading not counted: " + log);
    ok(failed("fixtures/harness-missing.js"), "missing file not counted: " + log);
    eq(lines[lines.length - 1], "RESULT pass=2 fail=3");
  } finally {
    f.remove();
  }
});
