# Wedding site

A lightweight phone-friendly site for wedding guests, shared by QR code.
No app store, no login. Screens: Program, Stay (room search), Venues,
Gallery (guests share and heart photos; optional Google sign-in), Contacts.

## Where things live

| You want to change… | Edit |
|---|---|
| Program, rooms, venues, contacts, names, date | the **Google Sheet** — no redeploy ([docs/SHEET_SETUP.md](docs/SHEET_SETUP.md)) |
| Show/hide a section, pause photo uploads | the Sheet's **Settings** tab (`show_…`, `gallery_uploads`) — no redeploy |
| Text, colours, photo, links, features, sheet ID | **`public/site-config.js`** — then redeploy ([docs/CONFIG.md](docs/CONFIG.md)) |
| Gallery backend (Drive folder, storage warning, sign-in) | **`apps-script/Config.gs`** in the Apps Script editor ([docs/GALLERY_SETUP.md](docs/GALLERY_SETUP.md)) |
| Going live / beta / QR code | [docs/DEPLOY.md](docs/DEPLOY.md) |

## Files

```
public/              everything that gets published
  index.html         page skeleton (no content)
  app.js             logic: loads the sheet, draws screens, search, countdown
  privacy.html, privacy.js  privacy page (words in site-config.js, text.privacy)
  styles.css         layout; colours/fonts come from site-config.js
  site-config.js     settings (edit this)
  sw.js              offline support
  gallery/           the Gallery (loaded only when the Gallery screen opens):
                     api, store, uploader, image, identity, views, gallery.css
  manifest.webmanifest, assets/
apps-script/         Gallery backend (Google Apps Script; pasted into the editor, not published)
  Config.gs          its settings (private: owner email, folder/sheet IDs)
  Code.gs            web app, Drive/Sheet access, setup(), the Drive sync timer
  Logic.gs           rules without Google services (tested in the browser)
  appsscript.json    manifest (permissions, web app settings)
tools/
  dev_server.py      local server: the site + a stand-in Gallery backend + a test Sheet
  mock_gallery.py    the stand-in backend (used by dev_server.py)
  run_tests.py       runs all tests in headless Chrome
  screenshot.py      takes a picture of a page (default: the phone wall in tests/screens.html)
  make_icons.py      regenerates the app icons
tests/               tests (*.test.js, run.html), test Sheet (sheet/*.csv), screens.html
docs/                setup guides (SHEET_SETUP, CONFIG, GALLERY_SETUP, DEPLOY)
firebase.json, .firebaserc   Firebase Hosting settings
```

## Preview on this PC

With the stand-in Gallery backend and a local copy of the Sheet (needs no Google
account):
```
python tools/dev_server.py
```
Open <http://127.0.0.1:8080/?mock=ok#gallery>. In Chrome/Edge press F12 → device
toolbar to see it at phone size.

`mock=` picks how the stand-in backend behaves:

| `mock=` | Gallery shows |
|---|---|
| `ok` | 45 sample photos; uploads, hearts, delete and sign-in work |
| `empty` | no photos yet |
| `none` | no backend set ("Coming soon") |
| `down` / `html` | backend broken (error page / sign-in page instead of an answer) |
| `slow` / `busy` | every answer takes 20 s / first answers say "busy" |
| `full` / `paused` | album full / uploads paused |
| `badthumbs` | every third picture fails to load |
| `latethumbs` | a photo shared there has no picture for its first 3 s (like Google's for a photo just added) |
| `slowupload` / `flaky` / `ratelimit` | uploads slow / every second one fails / all refused as too many |

Other switches (add with `&`): `fresh=1` (first visit, nothing saved on the phone),
`sheet=paused` (Sheet has `gallery_uploads` = `no`), `sheet=hidden` (`show_gallery` = `no`),
`early=<ms>` (ask for the Gallery's first photos this long after opening; `0` = never),
`noclient=1` (no Google sign-in),
`gis=broken` (Google's sign-in script fails), `break=load` / `break=mount` / `break=show` /
`break=once&k=any` (gallery files missing / failing; see `tools/dev_server.py`). Other `mock=` names act like `ok` with
their own album (useful for trying things without touching the `ok` one).

The real site against the real Sheet (no Gallery backend):
```
python -m http.server 8080 --directory public
```

## Tests

```
python tools/run_tests.py
```
Runs every test in headless Chrome and ends with
`RESULT pass=N fail=0`. `python tools/screenshot.py` saves `screenshot.png`: one
phone per Gallery state, for a quick look.
