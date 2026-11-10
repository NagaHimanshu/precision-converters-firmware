# Gallery: guest photo sharing — design

Date: 2026-11-09
Status: approved by owner 2026-11-09
Mockup: `2026-11-09-gallery-mockup-v3.html` (same folder) (six phone screens; produced during brainstorming — the
decisions it shows are written out below, so the document stands on its own)

## 1. Intent

The wedding site (Rishika & Vamsi, Kakinada, 1 Jan 2027) has a Gallery screen that
currently says "coming soon". Guests should be able to share the candid photos they take
at the wedding and see everyone else's, straight from the site they already open via the
QR code. Each photo can be hearted.

Guests range from young cousins to elderly relatives. Many are not comfortable with
apps, sign-ins or small buttons. If an older guest can't work out how to add a photo in
a few seconds, the feature has failed for them. The owner also cares a lot about
**robustness**: the site goes out to every guest, so a backend problem (Google Drive
failing, permissions breaking, quota) must never crash the site or even crash the Gallery
screen — it must show a calm, friendly message.

Success looks like: lots of guests posting, older relatives managing on their own, and no
one ever seeing a broken screen or technical error text.

## 2. Goals

1. **View**: anyone with the site link can browse all shared photos, newest first, in a
   2-per-row grid of square thumbnails; tap to open full screen (uncropped), swipe or
   arrow-tap between photos.
2. **Heart**: one tap to heart / un-heart a photo, from the grid tile or the full-screen
   viewer. One heart per phone per photo. Count shown.
3. **Upload**: one big "📷 Add photos" button → the phone's own photo picker (multi-select)
   → a small panel showing the picked photos (× to remove one, ＋ More to add) with an
   optional name box → Upload. Photos appear immediately at the top of the grid with
   progress. No approval step: photos are live for everyone straight away.
4. **"By {name}"**: optional name, typed once and remembered on that phone. Blank = no
   name shown.
5. **"Photos by me"** tab: shows the photos this guest shared; each can be deleted (with a
   confirm). Delete also available on your own photo in the full-screen viewer.
6. **Optional Google sign-in** (never required): gives "By {Google name}" automatically
   and lets "Photos by me" work from any phone.
7. **Graceful failure everywhere** (see §6).
8. **Light**: gallery code and styles load only when the Gallery screen is opened; Google
   sign-in code loads only when someone taps a sign-in control. The rest of the site's
   weight and speed is unchanged.
9. **Modular**: the gallery is a self-contained module so later features (e.g. comments)
   can be added without touching or risking the rest of the site.

## 3. Non-goals

- Videos (photos only — enforced in the picker and on the server).
- Comments (not in this build; the design should not make them hard to add later).
- Moderation / approval queue.
- Required accounts or passwords of any kind.
- Google Photos integration (Drive and Photos don't sync; the owner can copy the folder
  into a Google Photos album after the wedding by hand).
- Original-resolution archiving (photos are resized on the phone — see §5.4).

## 4. Anti-goals (would be failure even if it "works")

- Any gallery or backend error that breaks Home, Program, Stay, Venues or Contacts.
- A blank, frozen, or endlessly spinning Gallery screen.
- Technical error text, codes, or stack traces shown to guests.
- An older guest stuck at a sign-in screen, or confused about which button to press.
- A guest deleting someone else's photo, or deleting their own by accident.
- Browser-specific code paths (see §8).

## 5. What the guest sees (decided)

### 5.1 Gallery screen layout

- Existing inner header (back button + "Gallery" title + sprig), unchanged.
- One subtitle line: "Candid moments shared by our guests · {count} photos".
- Two-way switch: **All photos** | **Photos by me**. (Not "My photos" — that reads as
  "photos of me".)
- Grid: 2 per row, square-cropped thumbnails, small gap, rounded corners. Each tile has a
  heart pill bottom-right (♡/♥ + count). Tapping the pill hearts; tapping elsewhere opens
  the viewer.
- **"📷 Add photos"** pinned at the bottom of the screen, always visible while scrolling,
  centred and about 75% of the screen width (owner: full width felt too heavy; the exact
  fraction is a config/CSS value). It is the only filled-colour button on the screen, with
  words + icon (not just "+").
- **No sign-in control on the main grid** (it would compete with Add photos for attention).
- Newest first. More photos load as the guest scrolls (paged).

### 5.2 Add photos flow

1. Tap **Add photos** → phone's native picker, photos only, multi-select.
2. A bottom panel titled **"Ready to share"** shows thumbnails of the picked photos, each
   with ×; a **＋ More** tile reopens the picker. Below: **"Your name (optional)"** box
   (prefilled from last time), a hint ("Shown as 'By {name}'. We'll remember it on this
   phone."), one big **Upload** button, and a small text link **"or use my Google name"**.
   Signed-in guests don't see the name box — their Google name is used.
3. If more than the per-upload limit (default 20) are picked, keep the first N and say so
   plainly ("We'll share the first 20 now — tap Add photos again for the rest.").
4. After Upload: the panel closes, the photos appear at the top of the grid at once with a
   progress ring each; a small line says "Uploading 2 of 3… you can keep browsing".
5. A photo that fails shows "Couldn't upload — tap to try again" on its own tile only;
   the rest continue.

### 5.3 Full-screen viewer

- Dark background, photo uncropped, "12 of 126" and a large × at the top.
- Left/right arrows (so swiping isn't required) plus swipe.
- Bottom: "By {name}" + time ("Today, 8:42 pm"), and a big heart button with count.
- On your own photo: a 🗑 Delete button next to the heart.
- The phone's Back button / gesture closes the viewer (returns to the grid), it does not
  leave the Gallery.

### 5.4 Photo processing

- The phone resizes each photo before upload: long edge ≤ 2500 px, JPEG quality ~0.85
  (both configurable). Typical result ~1–1.5 MB. Orientation must come out correct.
- Re-encoding strips the photo's location data — intended (privacy).
- **Resize one photo at a time** and release memory after each (decode straight to the
  target size where possible). Decoding several 12–48 MP photos at once can crash the page
  on older iPhones. Uploading can still run in parallel (§7.6 parallel uploads).
- While uploads are running, show "Keep this page open until uploads finish". Locking the
  phone or switching apps suspends the page on every phone; interrupted photos fall back
  to the per-photo "tap to try again" state.
- The Ready-to-share panel must keep the name box visible when the on-screen keyboard
  opens (known trouble spot on iPhone Safari with bottom panels).
- A photo the browser can't read gets a plain per-photo message
  ("This photo can't be shared") and doesn't block the others.

### 5.5 Photos by me & delete

- Shows only photos this guest uploaded, each with "🗑 Delete".
- Delete asks "Remove this photo for everyone?" with **Remove** / **Keep**.
- Deleted photos go to the Drive **trash** (recoverable by the owner for 30 days), and
  disappear from everyone's gallery.
- Bottom of this tab: a card "Shared photos from another phone?" + **Sign in with Google**.
  Once signed in it shows "Signed in as {name} · Sign out".
- Empty state: "You haven't shared any photos yet" + Add photos.

### 5.6 Calm states (same arch style as the existing "coming soon" card)

- **Can't load photos** (backend down, timeout, bad response): "Just a moment — the
  photos are taking a little break. Please try again in a minute." + **Try again**. If
  photos were loaded on this phone before, show those instead with a small status line.
- **No photos yet**: "Be the first to share a moment" + Add photos.
- **Offline**: same idea, offline wording.
- **Album full** (§7.3): the Add photos button is replaced by a soft note ("So many lovely
  photos — the album is full for now!") with a button to the Contacts screen. Viewing and
  hearts keep working.
- **Sign-in unavailable** (e.g. inside an app's built-in browser, Google down):
  "Sign-in isn't available here. You can still add photos." Upload is never blocked.
- **Uploads paused by the owner** (§7.5): Add photos is replaced by a soft note
  ("Photo sharing is paused for now."). Viewing, hearts and deleting your own photos keep
  working.
- **Offline / backend unreachable with photos loaded before**: show the last list saved on
  the phone; thumbnails the browser still has show, others show soft placeholders. No
  dedicated offline photo cache is built (keeps the site light). Nothing saved → the calm
  offline / can't-load card.

All wording lives in `site-config.js` (`text.gallery.*`); the examples above are the
intended defaults.

## 6. Robustness and modularity (decided requirements)

Failure must be contained at three levels:

1. **Site ↔ gallery module.** `app.js` only knows how to load the gallery module and hand
   it its container. If the module's script/styles fail to load, time out, or throw while
   starting, `app.js` shows the calm "can't load" card with Try again. No other screen is
   affected. The gallery module is not loaded at all until the Gallery screen is opened.
2. **Inside the gallery.** Each concern fails on its own: list, each upload, each
   thumbnail, hearts, delete, sign-in. Every network call has a timeout. All failures map
   to a small set of friendly states (offline / temporarily unavailable / album full /
   photo not supported / not allowed); raw errors only go to the console.
   - Hearts are optimistic: shown immediately, retried quietly later if sending fails.
   - Thumbnails that fail show a soft placeholder tile.
3. **Backend.** Every request handler catches everything and always answers in the same
   JSON shape (`ok: false` + a short code) — never an HTML error page. The client also
   treats anything that isn't the expected JSON as "temporarily unavailable".

Also: nothing in the gallery may spin forever; retries back off; Try again is always
available where something failed.

## 7. How it's built (decided by owner, or proposed and accepted)

### 7.1 Pieces

- **Photos**: stored in a **Google Drive folder** owned by the account that owns the
  wedding Sheet. Drive does not compress uploads; Drive's
  automatic thumbnails are used for the grid, so the grid stays light regardless of size.
  The folder must be viewable by anyone with the link so thumbnails load in browsers.
- **Backend**: a **Google Apps Script web app** under that account, "execute as me",
  accessible to anyone. Guests never sign in to use it. It handles: list, upload, heart,
  delete, sign-in linking, storage checks. Its source lives in the repo outside `public/`
  (e.g. `apps-script/`), and is deployed by pasting into the Apps Script editor on the
  owner's other PC.
- **Gallery data** (photo records, hearts, owners): kept somewhere **private** to the
  owner's account — *not* in tabs of the existing wedding Sheet, because that Sheet is
  shared publicly for the site to read. (Builder's choice of exact store: a separate
  private spreadsheet is the expected default.)
- **Site**: a separate gallery module (script + styles) in `public/`, lazily loaded by
  `app.js`. The existing `show_gallery` switch in the Settings tab still shows/hides the
  whole section. While the backend address in `site-config.js` is empty, the existing
  "coming soon" card shows.
- Firebase Storage was considered and rejected (now needs a paid plan).

### 7.2 Who owns a photo ("Photos by me", delete)

- No sign-in needed. On first use, the phone creates a random secret code and keeps it in
  the browser's storage. Each upload is recorded with a one-way, server-salted hash of it.
  A delete is allowed only if the phone presents the matching code. Guests can never
  delete others' photos.
- If the guest is signed in with Google, the photo is also recorded against their Google
  account (stored as a hash of Google's account ID, never the email), and delete is
  allowed from any phone signed into that account.
- Signing in links photos already uploaded from that phone to the Google account.
- The server must verify Google sign-in tokens properly (audience = our client ID, issuer,
  expiry) before trusting them — this is the security-critical part.
- From Google, store only the display name and the hashed account ID. Never store or show
  the email. Show "Your name will appear on photos you share." near sign-in.
- Known, accepted limit: an unsigned-in guest who clears browser data or switches phone /
  browser loses "Photos by me" for old uploads. Safari on iPhone also clears website
  storage after ~7 days without a visit (not for home-screen installs), so the same
  happens there. The photos stay in the gallery; only delete-from-this-phone is lost.
  Google sign-in avoids this. Fallback: ask the couple's family, who delete from Drive
  directly.
- Photos removed by the owner directly in Drive (or its trash) must disappear from the
  gallery on their own within a short, configurable time.

### 7.3 Drive storage

- 15 GB free ≈ 12,000 resized photos (fewer if Gmail already uses space). Unlikely to fill.
- **Early warning**: when used storage passes a warning level (default 85%), the script
  emails the owner, at most once a day.
- **Stop level** (default ~98%) or a real "storage full" error from Drive → uploads pause
  with the friendly note in §5.6; the client learns this from the backend (ideally before
  a guest tries to upload) and replaces the Add photos button. Viewing and hearts continue.
- When space is freed, uploads resume automatically. No redeploy.

### 7.4 Scale

About 200 guests invited; at worst ~50 using the gallery at the same moment. A single
Apps Script with a short server-side cache of the photo list and modest client defaults
(page size, refresh interval, back-off) is sufficient — no pre-built snapshot or batching
architecture needed.

### 7.5 Pause-uploads switch (owner request)

A new Settings-tab key in the existing public wedding Sheet, `gallery_uploads` = yes/no
(blank/missing = yes; key name configurable like the other `show_*` keys). "no" hides Add
photos for everyone (§5.6) **and** the backend refuses uploads — the client check alone
is not enough, since the backend address is public. Viewing, hearts and deletes continue.
Takes effect without a redeploy (within the backend's settings cache time).

### 7.6 Configuration — no hard-coded values

Every number, limit, URL pattern and piece of text lives in a settings block, with a
comment, and is documented in `docs/CONFIG.md`:

- **`public/site-config.js`** (public — every guest's browser downloads it), new
  `gallery` section, e.g.: backend web app URL; Google OAuth client ID (public by design);
  max photos per upload (20); parallel uploads (2); max long edge (2500 px); JPEG quality;
  max upload bytes; request / upload / script-load timeouts; retry counts and back-off;
  page size; thumbnail and full-size pixel widths; thumbnail / full-image URL templates;
  auto-refresh interval while the screen is open; name max length. Plus all text under
  `text.gallery`. The old `links.galleryAlbum` / `links.galleryUpload` are replaced.
- **Settings block at the top of the Apps Script** (private, on Google's side): owner
  email (blank = the account the script runs under), Drive folder ID, data store ID, Google client ID,
  storage warning % and stop %, max accepted photo bytes, name max length, list cache
  time, per-phone rate limit, how often Drive deletions are picked up, wedding Sheet ID
  and the `gallery_uploads` key name (for the pause switch). Secrets (the hash
  salt) are generated once and kept in Script Properties, not in the code.
- Nothing private (email, folder ID, secrets) goes in `site-config.js`.

### 7.7 Backend constraints worth knowing

- Apps Script web apps don't answer CORS preflight requests, so the site must send POSTs
  as "simple" requests (e.g. `Content-Type: text/plain` with a JSON body) and read the
  JSON reply.
- Apps Script limits simultaneous executions per account (around 30). Uploads are sent a
  couple at a time per phone, and the client retries with back-off when busy.
- Drive thumbnail URLs are not an official API and can be rate-limited; keep the URL
  templates in config so they can be swapped, and treat thumbnail failures per tile.
- The owner will see Google's "unverified app" warning once when authorising the script;
  setup docs must walk through it.
- Guest-facing Google sign-in only asks for basic profile (no Google review needed). It
  needs an OAuth client ID with the site's address as an authorised origin.

## 8. Constraints

- **No browser-specific code**: never branch on Samsung Internet / iOS / in-app browsers.
  Behave the same everywhere; handle e.g. a failed Google sign-in by its failure, not by
  detecting the browser.
- **No hard-coded content** (existing project rule): see §7.6.
- Plain HTML/CSS/JS, no build step, no frameworks, matching the style of `app.js`
  (the `h()` helper, `text` from config, comment density).
- Elder-friendly: body text at least the current 18 px; tap targets ≥ 44 px; plain words;
  one primary action per screen; destructive actions always confirmed; nothing that
  requires a gesture without a button alternative.
- Development PC can't sign in to Google, has Python 3.10 (+Pillow) but no Node. All
  Google-side setup and deployment is documented and done by the owner on another PC.
  Local preview: `python -m http.server 8080 --directory public`.
- Docs must be updated with the change: `README.md`, `docs/CONFIG.md`, `docs/DEPLOY.md`,
  `docs/SHEET_SETUP.md` as relevant, plus a new step-by-step Apps Script / Drive / OAuth
  setup guide written for a non-developer.
- The service worker cache version must be bumped so guests get the new files. Backend
  and Drive requests must not be cached by the service worker.

## 9. Build order (owner asked for baby steps, one at a time)

Testing and release (owner decision): the site has not been shared with guests yet, so no
hidden "preview mode" is needed. All steps are built and verified locally against the
stand-in backend. The owner then deploys the whole thing to a **beta** release first
(Firebase Hosting preview channel), tests it on real phones, gives feedback, and only then
deploys to the main site. Consequences for the build:

- `docs/DEPLOY.md` gets a "beta release" section (preview channel deploy, promoting to
  live). Google sign-in's authorised origins must include the beta address too.
- Beta and main share one backend; test photos uploaded during beta are cleared before
  launch (documented step).
- The Apps Script, Drive folder, data store and OAuth setup is done once, before the beta.
- The beta section includes a short real-phone checklist, to run on at least one iPhone
  and one Android phone (development PC can't test real phones): add 5–10 photos, heart
  one, delete one, try the pause switch, open in an app's built-in browser.

Each step should be usable and verified before the next:

1. Gallery module shell: lazy loading from `app.js`, config section, calm error/empty
   states, error containment (§6 level 1) — proven by breaking it on purpose.
2. Viewing: list, grid, paging, viewer, hearts.
3. Uploading: picker, resize, Ready-to-share panel, name, progress, per-photo retry,
   limits.
4. Photos by me + delete.
5. Drive storage warning + album-full state.
6. Optional Google sign-in + linking.
7. Docs and setup guide finalised.

The backend grows alongside each step. Because the backend can't be run on the
development PC, a small local stand-in for it (e.g. a Python script under `tools/`) is
expected so each step — including every failure mode (slow, down, HTML instead of JSON,
album full, sign-in rejected) — can be previewed and screenshotted locally.

## 10. Left to the builder

- Exact API shape (actions, fields, paging cursor), data columns, file naming in Drive.
- How "mine" and "hearted by me" flags reach the client.
- Caching on the backend, locking for concurrent writes, how Drive-side deletions are
  detected.
- How long sign-in lasts on a phone and how an expired Google token is renewed, as long
  as uploading is never blocked by it.
- Auto-refresh behaviour while the screen is open (must not jump the guest's scroll).
- Exact visual polish within the existing blush & gold theme and the mockup.
- Whether gallery styles are a separate file or appended to `styles.css`, provided they
  don't load until needed or are trivially small.

## 11. Decisions made during brainstorming that the owner should double-check

(Proposed by the assistant and accepted in conversation, not originated by the owner.)

- 2-per-row grid; newest first.
- Resize to 2500 px / ~0.85 JPEG instead of original quality.
- 20 photos per upload, 2 at a time.
- Google sign-in placed in "Photos by me" + a small text link in the name panel, rather
  than at the bottom of the main grid.
- Hearts are per phone (not per Google account).
- Album-full note links to the Contacts screen (earlier in chat it was "send yours to
  {contact} on WhatsApp"; Contacts screen already has the WhatsApp buttons and avoids a
  new setting).
- Gallery data in a separate private store rather than the public wedding Sheet.
- Offline: no dedicated photo cache (see §5.6).
- Beta and main sites share one backend; test photos are cleared before launch.
