// Deliberately broken (throws while loading): loaded only by tests/harness-selftest.html.
test("registered before the throw", function () { ok(true); });
throw new Error("fixture failed while loading");
