# Wedding site

A lightweight phone-friendly site for wedding guests, shared by QR code.
No app store, no login. Screens: Program, Stay (room search), Venues,
Gallery (coming soon), Contacts.

## Where things live

| You want to change… | Edit |
|---|---|
| Program, rooms, venues, contacts, names, date | the **Google Sheet** — no redeploy ([docs/SHEET_SETUP.md](docs/SHEET_SETUP.md)) |
| Text, colours, photo, links, features, sheet ID | **`public/site-config.js`** — then redeploy ([docs/CONFIG.md](docs/CONFIG.md)) |
| Going live / QR code | [docs/DEPLOY.md](docs/DEPLOY.md) |

## Files

```
public/              everything that gets published
  index.html         page skeleton (no content)
  app.js             logic: loads the sheet, draws screens, search, countdown
  styles.css         layout; colours/fonts come from site-config.js
  site-config.js     settings (edit this)
  data/sample.json   sample data, used while no sheet is connected
  sw.js              offline support
  manifest.webmanifest, assets/
sample-data/*.csv    starter data to import into the Google Sheet
tools/               scripts that regenerate sample data and icons (Python)
firebase.json, .firebaserc   Firebase Hosting settings
```

## Preview on this PC

```
python -m http.server 8080 --directory public
```
Open <http://localhost:8080>. In Chrome/Edge press F12 → device toolbar to see it at phone size.
