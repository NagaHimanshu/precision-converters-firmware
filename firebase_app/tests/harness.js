// Tiny test runner. test(name, fn, { timeoutMs }?), eq(actual, expected, msg), ok(cond, msg),
// runAll({ report }?). Writes one line per test into <pre id="log"> and finally
// "RESULT pass=N fail=M", then posts the log to the dev server (tools/run_tests.py reads it
// from there) unless report is false. A script that fails while the page loads (syntax error,
// throws, missing file) counts as one failing test named after the file.
(function () {
  "use strict";
  var TIMEOUT_MS = 5000;   // per test, unless the test asks for longer (long end-to-end tests)
  var tests = [];
  var loadErrors = [];     // "file - why", one per script that failed while the page loaded
  var loading = true;

  // Capture phase: a missing script's error event doesn't bubble up to the window.
  self.addEventListener("error", function (e) {
    if (!loading) return;
    var el = e && e.target;
    if (el && (el.tagName === "SCRIPT" || el.tagName === "LINK")) {
      loadErrors.push((el.src || el.href || "inline script") + " - could not be loaded");
    } else if (e instanceof ErrorEvent) {   // a script threw (or didn't parse)
      loadErrors.push((e.filename || "inline script") + (e.lineno ? ":" + e.lineno : "") + " - " + (e.message || "error"));
    }
  }, true);

  function test(name, fn, opts) {
    tests.push({ name: name, fn: fn, timeoutMs: (opts && opts.timeoutMs) || TIMEOUT_MS });
  }

  function eq(actual, expected, msg) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error((msg ? msg + ": " : "") + "expected " + e + " but got " + a);
  }

  function ok(cond, msg) {
    if (!cond) throw new Error(msg || "assertion failed");
  }

  function logLine(text) {
    var el = document.getElementById("log");
    if (!el) {
      el = document.createElement("pre");
      el.id = "log";
      document.body.appendChild(el);
    }
    el.appendChild(document.createTextNode(text + "\n"));
  }

  function withTimeout(promise, ms) {
    var timer;
    var limit = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        reject(new Error("timed out after " + ms + " ms"));
      }, ms);
    });
    return Promise.race([promise, limit]).then(
      function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; }
    );
  }

  async function runAll(opts) {
    var pass = 0, fail = 0;
    loading = false;
    loadErrors.forEach(function (why) {
      fail++;
      logLine("FAIL load " + why);
    });
    for (var i = 0; i < tests.length; i++) {
      var t = tests[i];
      try {
        await withTimeout(Promise.resolve().then(t.fn), t.timeoutMs);
        pass++;
        logLine("PASS " + t.name);
      } catch (e) {
        fail++;
        logLine("FAIL " + t.name + " - " + (e && e.message ? e.message : e));
      }
    }
    logLine("RESULT pass=" + pass + " fail=" + fail);
    if (opts && opts.report === false) return;
    // tools/run_tests.py waits for this copy of the log (the dev server keeps it).
    try {
      fetch("/tests/result", { method: "POST", body: document.getElementById("log").textContent }).catch(function () {});
    } catch (e) { /* opened without the dev server */ }
  }

  self.test = test;
  self.eq = eq;
  self.ok = ok;
  self.runAll = runAll;
})();
