/* Who this phone is: a secret device code made once, the name the guest typed
   last time, and the Google account it is linked to (all kept in localStorage).
   Also the optional Google sign-in: Google's script is loaded only when a sign-in
   control is shown, and any failure of it just means "no sign-in here". */
(function () {
  "use strict";

  const W = (self.WeddingGallery = self.WeddingGallery || {});
  const { GalleryError } = W.errors;

  const DEVICE_KEY = "gallery-device";
  const NAME_KEY = "gallery-name";
  const ACCOUNT_KEY = "gallery-account";
  const DEVICE_BYTES = 16;                    // 32 hex characters (backend contract)
  const DEVICE_PATTERN = /^[0-9a-f]{32}$/;

  function newDeviceCode() {
    const bytes = new Uint8Array(DEVICE_BYTES);
    self.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /* ---------- Google's sign-in script ---------- */

  let googleLoad = null;   // the load in progress or done; null after a failure (a later control tries again)

  function hasGoogle() {
    const g = self.google;
    return !!(g && g.accounts && g.accounts.id && typeof g.accounts.id.initialize === "function" &&
      typeof g.accounts.id.renderButton === "function");
  }

  // Resolves once google.accounts.id is there; rejects GalleryError("signin_failed") if the
  // script fails, takes longer than scriptLoadTimeoutMs, or loads without it.
  function loadGoogle({ googleScriptUrl, scriptLoadTimeoutMs }) {
    if (hasGoogle()) return Promise.resolve();
    if (googleLoad) return googleLoad;
    googleLoad = new Promise((resolve, reject) => {
      if (!googleScriptUrl) return reject(new GalleryError("signin_failed", "no script address"));
      const script = document.createElement("script");
      let timer = null;
      const settle = (why) => {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (!why && hasGoogle()) return resolve();
        script.remove();
        reject(new GalleryError("signin_failed", why || "google.accounts.id missing"));
      };
      script.onload = () => settle("");
      script.onerror = () => settle("script did not load");
      timer = setTimeout(() => settle("script took too long"), scriptLoadTimeoutMs);
      script.async = true;
      script.src = googleScriptUrl;
      document.head.append(script);
    });
    googleLoad.catch(() => { googleLoad = null; });
    return googleLoad;
  }

  // Google's own button in `el` (not restyled). onCredential(token) gets the ID token.
  function renderGoogleButton(el, { clientId, onCredential }) {
    if (!hasGoogle()) throw new GalleryError("signin_failed", "google.accounts.id missing");
    try {
      self.google.accounts.id.initialize({
        client_id: clientId,
        callback: (res) => {
          if (res && typeof res.credential === "string" && res.credential) onCredential(res.credential);
        },
      });
      self.google.accounts.id.renderButton(el, { type: "standard", shape: "pill", text: "signin_with", size: "large" });
    } catch (e) {
      throw new GalleryError("signin_failed", String(e));
    }
  }

  /* ---------- this phone ---------- */

  // api, getStore (both optional; needed for signIn / signOut): the backend client, and a
  // function giving the photo list store (made after this).
  function create({ storageGet, storageSet, api, getStore }) {
    let device = null;   // kept in memory too, in case storage forgets (private mode)

    function store() {
      return getStore ? getStore() : null;
    }

    // Photos by me (and the name box) change with the account: show it and look again.
    function reload(account) {
      const s = store();
      if (!s) return;
      s.setFlags({ account });
      s.load(s.state.tab);
    }

    const me = {
      device() {
        if (device) return device;
        const saved = storageGet(DEVICE_KEY);
        device = DEVICE_PATTERN.test(saved || "") ? saved : newDeviceCode();
        if (device !== saved) storageSet(DEVICE_KEY, device);
        return device;
      },
      name() {
        return storageGet(NAME_KEY) || "";
      },
      setName(s) {
        storageSet(NAME_KEY, String(s == null ? "" : s));
      },
      account() {
        try {
          const a = JSON.parse(storageGet(ACCOUNT_KEY) || "null");
          return a && typeof a.name === "string" ? { name: a.name } : null;
        } catch (e) {
          return null;
        }
      },
      setAccount(a) {
        storageSet(ACCOUNT_KEY, JSON.stringify(a && typeof a.name === "string" ? { name: a.name } : null));
      },
      // Links this phone to the Google account of `token`; resolves { name }.
      // Rejects with a GalleryError (nothing changes) when the backend says no.
      async signIn(token) {
        const res = await api.call("link", { device: me.device(), idToken: token });
        const account = res && res.account && typeof res.account.name === "string" ? { name: res.account.name } : null;
        if (!account) throw new GalleryError("signin_failed", "no account in the answer");
        me.setAccount(account);
        reload(account);
        return account;
      },
      // Unlinks this phone. If the backend can't be told, nothing changes (the server would
      // still treat this phone as the account) and it rejects with the GalleryError.
      async signOut() {
        await api.call("unlink", { device: me.device() });
        me.setAccount(null);
        reload(null);
      },
    };
    return me;
  }

  W.identity = { create, loadGoogle, renderGoogleButton };
})();
