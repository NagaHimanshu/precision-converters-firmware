# Deploying (on the PC where you can log in to Google)

Do this once to put the site online. After that, wedding data changes happen
in the Google Sheet only; you redeploy only when `site-config.js` or the
photo changes.

First time with the Gallery: do steps 1–7, then the **beta release** (step 8) to test
on real phones, and only then go live (step 9).

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

Follow [SHEET_SETUP.md](SHEET_SETUP.md): the Sheet is private and its ID goes into the
Apps Script's `Config.gs` (`WEDDING_SHEET_ID`), not into `site-config.js`. The site asks the
Apps Script for the Sheet's data, so step 7 (the Apps Script) has to be done first.

**Moving a site that already reads a public Sheet to the private Sheet** (do it in this
order, so you see each step work before the next):

1. Paste the new `Config.gs`, `Logic.gs` and `Code.gs` into the Apps Script editor and
   publish a **New version** (the Sheet is still public, so the old site keeps working).
2. Make the Sheet private (Share → General access → Restricted) and add your helpers by
   email as Editors. In the editor run **checkSheetAccess**: every tab should show its rows.
   If not, set General access back to "Anyone with the link" and fix the cause first.
3. Deploy the new site to the beta address (step 8). Open it: the home screen, Program,
   Stay, Venues and Contacts should show your data. Edit a cell from the Sheets app on
   your phone: it shows on the site within about 40 seconds (a phone that opens the site
   afresh sees it within about 10).
4. Deploy to the live address (`firebase deploy --only hosting`). Until a phone loads the
   new version it shows its last saved details (it can't reach the now-private Sheet), and
   the new version removes the Sheet ID from the files phones download.

## 7. Set up the Gallery (one time)

Follow [GALLERY_SETUP.md](GALLERY_SETUP.md) Parts 1–4 (and Part 5 if you want Google
sign-in). At the end, `gallery.endpoint` in `public/site-config.js` holds the Web app URL.

## 8. Beta release

A beta release puts the site on a separate test address. Guests never see it; the live
address stays as it is. The beta and the live site use the **same** Sheet, Drive folder
and backend, so photos you add on the beta are real photos in the folder (step 8.6 clears
them).

1. In a terminal in the project folder:
   ```
   firebase hosting:channel:deploy beta --expires 30d
   ```
   It ends with a line like
   `Channel URL (beta): https://rishika-vamsi-wedding--beta-ab12cd34.web.app [expires ...]`.
   Open that address on the PC: the home screen should show.
2. If you set up Google sign-in: add that address (exactly, no `/` at the end) to
   **Authorized JavaScript origins** ([GALLERY_SETUP.md → Part 5b](GALLERY_SETUP.md#5b-the-client-id)).
   It can take a few minutes, sometimes hours, to start working.
3. In the Sheet's Settings tab: `show_gallery` = `yes`, `gallery_uploads` = `yes`.
   (The live address reads the same Sheet, so its Gallery tile appears too. That's fine
   while the site isn't shared yet.)
4. Send the beta address to your phones (e.g. WhatsApp it to yourself) and go through the
   checklist below on **at least one iPhone and one Android phone**.
5. Changed something? Run the same command again: the beta address stays the same (and
   gets 30 more days).
6. **Clear the test photos before going live:** open the photos folder in Drive (the link
   from GALLERY_SETUP Part 2) → select all photos (Ctrl+A) → right-click → **Move to
   trash**. Wait `SYNC_MINUTES` (15 minutes) and reopen the Gallery: it should say
   "No photos yet". Then empty the Drive trash (or leave it; Drive empties it after 30
   days). Don't restore them afterwards, or they come back to the site.

### Real-phone checklist (beta)

Everything else is tested on the development PC; these can only be checked on real
phones with the real Google backend.

- [ ] Home, Program, Stay, Venues and Contacts work as before
- [ ] Gallery opens and shows "No photos yet" (or the photos so far)
- [ ] **Add photos** → pick 5–10 photos → "Ready to share" → type a name → **Upload**:
      the rings fill, the photos appear in the grid, and in the Drive photos folder
- [ ] In "Ready to share", the **Camera** tile next to **More** opens the camera; the
      photo taken joins the others in the panel. Next time, the name box already has
      the name used last time
- [ ] Open the site, wait on Home for a few seconds, then tap Gallery: the photos are
      there at once or within a second or two (moving bars while they come on a first
      visit). Reopen the Gallery later: the photos seen before show straight away
- [ ] A name starting with `=`, `+`, `-` or `@` (e.g. `=Ravi`, `+Uncle`, `-Anu`,
      `@Sita`) shows on the photo exactly as typed, with no `'` in front
- [ ] Heart a photo: the count goes up; on the other phone the count shows after a
      minute; tapping again takes it back
- [ ] Open a photo: swipe left/right and the arrow buttons move between photos;
      the phone's Back closes the photo and stays in the Gallery
- [ ] Open a photo → **⬇ Save** (top, next to ×): three bars, then "Saved to Downloads".
      **Android (Chrome):** the photo is in the Downloads folder / Files app, sharp (not a
      small copy), named `Rishika-Vamsi-wedding-….jpg`. **iPhone (Safari):** Safari may ask
      "Download?" first; the photo is in **Files → Downloads** (not in the Photos app).
      Also try once from the **home-screen icon** on both phones (an iPhone may open the
      photo instead of saving it — note what it does). Airplane mode → Save:
      "Couldn't save. Try again."
- [ ] **Photos by me** → open one of yours → **Delete** → **Remove**: it disappears on
      both phones, and the file is in the Drive trash
- [ ] Move a photo to the trash directly in Drive: it disappears from the site within
      `SYNC_MINUTES` (15 minutes). Restore it: it comes back within 15 minutes
- [ ] Set `gallery_uploads` to `no`: within about 1–5 minutes "Photo sharing is paused
      for now." replaces Add photos. Try `hide` as well. Set it back to `yes`: Add photos
      returns
- [ ] If sign-in is set up: Photos by me → "Shared photos from another phone?" → Google
      button → sign in. Works in **Chrome** (Android) and **Safari** (iPhone), then shows
      "Signed in as …". Sign in on the second phone with the same account: the first
      phone's photos show under Photos by me there too. **Sign out** works. In "Ready to
      share", "or use my Google name" shows Google's button with a tiny "Read our Privacy
      Policy" line under it; once signed in, the name box is a green "Using Google name ✓
      — …" line, and **Not you? Sign out** under it brings the name box back
- [ ] Open the beta link from inside **WhatsApp** and **Instagram** (tap it in a chat):
      the Gallery works and photos can be added; sign-in either works or says "Sign-in
      isn't available here. You can still add photos." (or Google shows its own error
      page instead of that message after the Google button is tapped: expected there) —
      never a blank screen or an error code from the site
- [ ] Storage warning email: in the Apps Script editor set `STORAGE_WARN_PERCENT` in
      `Config.gs` to a number below your current Drive use (drive.google.com shows
      "… of 15 GB used"; `1` always works) → publish a new version
      ([GALLERY_SETUP.md](GALLERY_SETUP.md#after-changing-any-gs-file-publish-a-new-version))
      → add one photo → the "Google Drive is …% full" email arrives at the email in
      `Config.gs` (check Spam). Set it back to `85` and publish a new version again.
      It comes at most once a day, so this test works once per day
- [ ] Airplane mode → reopen the Gallery: the photos seen before still show, with
      "Showing photos saved on this phone."

## 9. Go live

When the beta is good and the test photos are cleared:
```
firebase deploy --only hosting
```
It prints the live address, e.g. `https://rishika-vamsi-wedding.web.app`. Open the
Gallery there once to check it loads.

## 10. Check on phones

- [ ] Opens on Android (Chrome) and iPhone (Safari)
- [ ] Names and date show; tiles open each screen; back button works
- [ ] Stay: search finds a name with part of the name
- [ ] Venues: Navigate opens Google Maps
- [ ] Contacts: Call and WhatsApp open correctly
- [ ] Edit a cell in the sheet → reopen the site → the change shows
- [ ] Add to Home Screen works (Android: "Add" button in the tip; iPhone: Share → Add to Home Screen). The tip shows only on the home screen, and × hides it for good (also after reopening).
- [ ] Airplane mode → reopen from home screen → details still show

## 11. Make the QR code

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
| Labels, colours, gallery settings, features | Edit `site-config.js`, run `firebase deploy --only hosting` (for bigger changes, the beta first: step 8) |
| Pause / reopen adding photos | Sheet → Settings → `gallery_uploads` = `no` / `yes`. Done (about 1–5 minutes). |
| Hide / show the Gallery | Sheet → Settings → `show_gallery` = `no` / `yes`. Done. |
| Remove a guest's photo | Drive photos folder → right-click → **Move to trash**. Gone within `SYNC_MINUTES` ([GALLERY_SETUP.md → Deleting photos](GALLERY_SETUP.md#deleting-photos)) |
| Gallery backend settings (`Config.gs`: storage levels, sign-in client ID, …) | Change it in the Apps Script editor → Deploy → Manage deployments → Edit → **New version**. Copy the same change into `apps-script/Config.gs` in the project folder so the two stay alike |
| New versions of the `apps-script/*.gs` files | Paste each into the editor (keep your `Config.gs` values) → **New version**. The Web app URL stays the same |
| Google sign-in addresses (new beta or domain) | Google Cloud → Clients → `Wedding site` → **Authorized JavaScript origins** → Add URI → Save |
| App name shown under the home-screen icon | Edit `name`/`short_name` in `public/manifest.webmanifest`, redeploy |

## After the wedding

Leave it up as a keepsake, or take it offline with:
```
firebase hosting:disable
```
