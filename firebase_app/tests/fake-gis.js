// Stand-in for Google's sign-in script (dev only; dev-overrides.js points
// gallery.googleScriptUrl here). Defines google.accounts.id.{initialize, renderButton,
// prompt}; its button hands the callback the stand-in token "mock:Ravi Kumar" (the
// stand-in backend accepts "mock:{name}"). With gis=broken in the page's query (or in
// this script's own address) it defines nothing, like a browser where Google's script
// can't work. fake = what the page asked for, for tests.
(function () {
  "use strict";
  var own = document.currentScript ? document.currentScript.src : "";
  var broken = function (q) { return new URLSearchParams(q).get("gis") === "broken"; };
  if (broken(location.search) || broken(own.split("?")[1] || "")) return;

  var TOKEN = "mock:Ravi Kumar";
  var fake = { initialized: null, rendered: null, callback: null };

  function renderButton(el, opts) {
    fake.rendered = { el: el, opts: opts };
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("data-fake-gis", "button");
    b.textContent = "Sign in with Google (stand-in)";
    b.style.cssText = "min-height:44px;padding:0 20px;border:1px solid #dadce0;border-radius:22px;" +
      "background:#fff;color:#3c4043;font:600 16px sans-serif;cursor:pointer";
    b.addEventListener("click", function () {
      if (fake.callback) fake.callback({ credential: TOKEN, select_by: "btn" });
    });
    el.replaceChildren(b);
  }

  self.google = self.google || {};
  self.google.accounts = {
    id: {
      initialize: function (o) {
        fake.initialized = o;
        fake.callback = o && o.callback;
      },
      renderButton: renderButton,
      prompt: function () {},
      fake: fake,
    },
  };
})();
