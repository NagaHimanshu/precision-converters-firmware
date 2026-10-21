# Deploying (on the PC where you can log in to Google)

Do this once to put the site online. After that, wedding data changes happen
in the Google Sheet only; you redeploy only when `site-config.js` or the
photo changes.

## 1. Copy the project

Copy the whole `firebase_app` folder (USB / zip / git) to the other PC.

## 2. Install the tools (one time)

1. Install **Node.js LTS** from <https://nodejs.org> (default options).
2. Open a new terminal (PowerShell) and check: `node -v`
3. Install the Firebase command-line tool:
   ```
   npm install -g firebase-tools
   ```
4. Log in (opens the browser):
   ```
   firebase login
   ```

## 3. Create the Firebase project (one time)

1. Go to <https://console.firebase.google.com> → **Create a project**.
2. Pick a name. The project ID becomes your web address:
   `https://<project-id>.web.app` — choose something short, e.g. `ananya-rohan`.
3. Google Analytics: turn it **off** (not needed). Create.
4. You stay on the free **Spark** plan; nothing else needs enabling.

## 4. Point the folder at your project

Open `.firebaserc` and replace `REPLACE-WITH-YOUR-FIREBASE-PROJECT-ID`
with your project ID. Or, in the project folder, run:
```
firebase use --add
```
and pick the project.

You do **not** need `firebase init` — `firebase.json` is already set up.
(If you run it anyway: public directory `public`, single-page app **No**,
and **don't** overwrite `index.html`.)

## 5. Preview locally (optional)

```
cd path\to\firebase_app
firebase emulators:start --only hosting
```
Open the address it prints (usually <http://localhost:5000>). Stop with Ctrl+C.

## 6. Connect the Google Sheet

Follow [SHEET_SETUP.md](SHEET_SETUP.md), then put the sheet ID into
`public/site-config.js` → `sheet.id`.

## 7. Deploy

```
firebase deploy --only hosting
```
It prints the live address, e.g. `https://ananya-rohan.web.app`.

## 8. Check on phones

- [ ] Opens on Android (Chrome) and iPhone (Safari)
- [ ] Names and date show; tiles open each screen; back button works
- [ ] Stay: search finds a name with part of the name
- [ ] Venues: Navigate opens Google Maps
- [ ] Contacts: Call and WhatsApp open correctly
- [ ] Edit a cell in the sheet → reopen the site → the change shows
- [ ] Add to Home Screen works (Android: "Add" button in the tip; iPhone: Share → Add to Home Screen). The tip shows only on the home screen, and × hides it for good (also after reopening).
- [ ] Airplane mode → reopen from home screen → details still show

## 9. Make the QR code

Use the `.web.app` address. Either:
- any free QR generator website (download as PNG/SVG), or
- in a terminal: `npx qrcode -o wedding-qr.png "https://ananya-rohan.web.app"`

Print it at least 2.5 cm wide and test-scan the printed copy with both an
Android and an iPhone camera.

## Updating later

| Change | What to do |
|---|---|
| Program, rooms, venues, contacts, names, date | Edit the Google Sheet. Done. |
| Couple photo | Put the photo in `public/assets/` (portrait, about 900 px wide, under 300 KB), set `images.hero` in `site-config.js`, run `firebase deploy --only hosting` |
| Labels, colours, gallery links, features | Edit `site-config.js`, run `firebase deploy --only hosting` |
| App name shown under the home-screen icon | Edit `name`/`short_name` in `public/manifest.webmanifest`, redeploy |

## After the wedding

Leave it up as a keepsake, or take it offline with:
```
firebase hosting:disable
```
