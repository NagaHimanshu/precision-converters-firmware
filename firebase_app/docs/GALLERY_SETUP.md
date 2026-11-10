# Gallery setup (Google Drive + Apps Script + Google sign-in)

The Gallery lets guests share photos from their phones. The photos are kept in a
folder in your Google Drive; a small Google "Apps Script" program (the four files in
`apps-script/`) receives them and answers the site.

Do this **once**, on the PC where you can sign in to Google, **before** the beta
release ([DEPLOY.md → 8. Beta release](DEPLOY.md#8-beta-release)). It takes about 30 minutes.

Before you start:

- Sign in to Google as the wedding account: the one that owns the wedding Sheet, and
  whose email is in `apps-script/Config.gs` (`OWNER_EMAIL`). If the browser is signed in
  to several Google accounts, use a separate Chrome profile or a private window so the
  right one is used everywhere.
- Have the project folder (`firebase_app`) on this PC.

Parts 1–4 are needed. Part 5 (Google sign-in for guests) is optional: without it
guests can still share photos, they just don't see any sign-in buttons.

---

## Part 1. Create the Apps Script project

1. Go to <https://script.google.com> → **New project** (top left).
   You see an editor with one file, `Code.gs`, containing `function myFunction() {}`.
2. Click **Untitled project** at the top, type `Wedding gallery`, press **Rename**.
3. **Code.gs:** click `Code.gs` in the **Files** list on the left. Select everything in
   the editor (Ctrl+A) and delete it. Open `apps-script/Code.gs` from the project folder
   in Notepad, copy all of it (Ctrl+A, Ctrl+C) and paste it into the editor (Ctrl+V).
4. **Config.gs:** click the **+** next to **Files** → **Script**. Type `Config` and press
   Enter (the editor adds `.gs` itself). Delete the few lines it puts in the new file,
   then paste all of `apps-script/Config.gs`.
5. **Logic.gs:** the same way: **+** → **Script** → `Logic` → paste all of
   `apps-script/Logic.gs`.
6. **appsscript.json** (the "manifest", it lists what the script may do):
   1. Click the gear icon **Project Settings** on the far left.
   2. Tick **Show "appsscript.json" manifest file in editor**.
   3. Click the **< >** icon **Editor** on the far left. `appsscript.json` now appears in
      the Files list.
   4. Click it, select everything, delete, and paste all of `apps-script/appsscript.json`.
7. Press **Ctrl+S** (or the disk icon **Save project**).

You should now see four files: `appsscript.json`, `Code.gs`, `Config.gs`, `Logic.gs`
(the order doesn't matter), and no red error marks.

### Check Config.gs

Click `Config.gs`. Each setting has a short note above it; the full list is in
[CONFIG.md → Gallery backend settings](CONFIG.md#gallery-backend-settings-apps-scriptconfiggs).
The ones to look at now:

| Setting | What to do |
|---|---|
| `OWNER_EMAIL` | Already filled in: the wedding account. Storage warning emails go here. Leave it. |
| `WEDDING_SHEET_ID` | Already filled in: the same ID as `sheet.id` in `site-config.js`. The script reads only its Settings tab (for the pause switch). |
| `DRIVE_FOLDER_ID` | Leave it blank: `setup` (next part) creates a folder called **Wedding guest photos**. If you'd rather use a folder you already have, paste its Drive link (`https://drive.google.com/drive/folders/...`) or just the ID between the quotes. |
| `DATA_SHEET_ID` | Leave it blank: `setup` creates the data spreadsheet. |
| `GOOGLE_CLIENT_ID` | Leave it blank for now; Part 5 fills it in. |

If you changed anything, press Ctrl+S.

## Part 2. Run setup (creates the folder, the data sheet and the timer)

1. Click `Code.gs` in the Files list.
2. In the toolbar above the code there is a list of functions (it may say
   `doGet` or `myFunction`). Choose **setup**.
3. Press **Run**.
4. A box **Authorization required** appears → **Review permissions** → choose the
   wedding account.
5. Google shows **Google hasn't verified this app**. This is normal: it is your own
   script, used only by you. Click **Advanced** (small link, bottom left) →
   **Go to Wedding gallery (unsafe)**.
6. Google lists what the script may do: see and change your Drive files and
   spreadsheets, connect to an outside service (to check guests' Google sign-ins), send
   email as you (the storage warning), and run when you are not there (the timer). If
   there are tick boxes, tick **Select all**. Press **Continue** (or **Allow**).
7. The **Execution log** opens at the bottom. After a few seconds you should see lines
   like:
   ```
   Created the photos folder "Wedding guest photos".
   Created the data spreadsheet "Wedding gallery data (private)".
   Hash secret: created and kept in Script Properties (do not share or change it).
   Photos folder: https://drive.google.com/drive/folders/1AbC... (id 1AbC...)
   Private data spreadsheet: https://docs.google.com/spreadsheets/d/1XyZ.../edit (id 1XyZ...)
   Photos deleted in Drive leave the gallery within 15 minutes.
   Setup done.
   ```
8. Copy the **Photos folder** link and keep it (e.g. bookmark it): that's where every
   guest photo arrives. Open it once to check it is there.

What `setup` made:

- **Wedding guest photos** (Drive folder). Its sharing is set to *Anyone with the link
  can view* — needed so guests' phones can show the small pictures. Only people who
  have the link can see it, and the site never shows the folder's link itself.
- **Wedding gallery data (private)** (a spreadsheet in My Drive, not inside the photos
  folder). It keeps the list of photos (with the name each guest typed), the hearts, and
  the phones as scrambled codes — never email addresses. **Don't share it** and don't change it,
  except the `deleted` column (see [Deleting photos](#deleting-photos)).
- A secret code (kept in **Project Settings → Script Properties** as `HASH_SECRET`).
  Never change or delete it: phones would lose their "Photos by me".
- A timer that runs `syncDeletions` every 15 minutes (see it under the clock icon
  **Triggers** on the far left). It keeps the gallery in step with the Drive folder.

Running `setup` again later is safe: it finds what it made before and changes nothing
that is already there.

## Part 3. Publish the script as a web app

1. Top right: **Deploy** → **New deployment**.
2. Next to **Select type**, click the gear → **Web app**.
3. Fill in:
   - **Description**: `Gallery`
   - **Execute as**: **Me** (your email)
   - **Who has access**: **Anyone** (not "Anyone with Google account" — guests don't
     sign in to use the gallery)
4. Press **Deploy**. If Google asks to authorise again, do the same as in Part 2.
5. Copy the **Web app URL** (it starts with `https://script.google.com/macros/s/` and ends
   with `/exec`). Press **Done**.
6. Test it: paste the URL into a new browser tab. You should see exactly:
   ```
   {"ok":true,"service":"gallery"}
   ```
   A Google sign-in page or an error page instead means **Who has access** isn't
   **Anyone**: Deploy → Manage deployments → Edit (pencil) → change it → Deploy.

## Part 4. Connect the site

1. Open `public/site-config.js` in Notepad. In the `gallery` section, paste the Web app
   URL between the quotes of `endpoint`:
   ```
   endpoint: "https://script.google.com/macros/s/AKfy.../exec",
   ```
   Save.
2. In the wedding Sheet's **Settings** tab, set `show_gallery` to `yes` (add the row if
   it isn't there) and `gallery_uploads` to `yes`. See
   [SHEET_SETUP.md → Showing or hiding sections](SHEET_SETUP.md#showing-or-hiding-sections).
3. Publish the site to the **beta** address first and test it on phones:
   [DEPLOY.md → 8. Beta release](DEPLOY.md#8-beta-release).

## Part 5. Google sign-in for guests (optional)

Signing in lets a guest see "Photos by me" from all their phones and puts their Google
name on their photos. It needs a "client ID" from Google Cloud.

**The same client ID goes in two places**: `gallery.googleClientId` in
`site-config.js` and `GOOGLE_CLIENT_ID` in `Config.gs`. Blank in both = no sign-in
buttons anywhere (guests can still share photos).

### 5a. Consent screen (what guests see when they sign in)

1. Go to <https://console.cloud.google.com>. At the top, next to "Google Cloud", pick
   the project **rishika-vamsi-wedding** (your Firebase project is also a Google Cloud
   project). If Google asks you to agree to terms first, agree.
2. Menu (☰) → **APIs & Services** → **OAuth consent screen**. (Google may call this page
   **Google Auth Platform** and show a **Get started** button — same thing.)
3. Fill in:
   - **App name**: the name guests will see, e.g. `Rishika & Vamsi's wedding`
   - **User support email**: choose the wedding account
   - **Audience / User type**: **External**
   - **Contact information**: the wedding account's email
   - Agree to the policy → **Create**.
4. The **Overview** page may now say "You haven't configured any OAuth clients". That is
   normal: 5b creates the client.
5. Left menu → **Branding**:
   - **App name** and **User support email**: as above.
   - **App logo**: leave it **empty** (a logo makes Google review the app first).
   - **Authorized domains** → **Add domain**, once for each:
     - `rishika-vamsi-wedding.web.app`
     - `rishika-vamsi-wedding.firebaseapp.com`
   - **Application home page**: `https://rishika-vamsi-wedding.web.app`
   - **Application privacy policy link**: `https://rishika-vamsi-wedding.web.app/privacy.html`
     (the site's privacy page; its words are in `site-config.js` → `text.privacy`)
   - **Developer contact information**: the wedding account's email → **Save**.
6. **Scopes**: add nothing. The sign-in only uses the guest's name, which every app gets.
7. **Publish**: left menu → **Audience** → under **Publishing status** press
   **Publish app** → **Confirm**. It should now say **In production**. (While it says
   "Testing", only people you list can sign in.) No Google review is needed because no
   extra scopes are used and there is no logo.
   If Google won't publish until the privacy page is online, deploy the main site now with
   `firebase deploy --only hosting` (safe: the site isn't shared with guests yet), then
   come back and press **Publish app**. The privacy policy link in the form stays the main
   address above.

### 5b. The client ID

1. Go to **Clients** (or **APIs & Services → Credentials → + Create credentials →
   OAuth client ID**) → **Create client**.
2. **Application type**: **Web application**. **Name**: `Wedding site`.
3. **Authorized JavaScript origins** → **Add URI**, once for each address (exactly
   like this: `https://`, no `/` at the end):
   - `https://rishika-vamsi-wedding.web.app`
   - `https://rishika-vamsi-wedding.firebaseapp.com`
   - the beta address, e.g. `https://rishika-vamsi-wedding--beta-ab12cd34.web.app`
     (you get it from the beta release command in DEPLOY.md; if you don't have it yet,
     come back later: **Clients** → click `Wedding site` → **Add URI** → **Save**)
4. Leave **Authorized redirect URIs** empty. Press **Create**.
5. Copy the **Client ID** (it ends with `.apps.googleusercontent.com`). There is also a
   "client secret": you don't need it, don't put it anywhere.
6. Paste the client ID:
   - in `public/site-config.js` → `gallery` → `googleClientId: "...",` (save; it goes
     online with the next site deploy), and
   - in the Apps Script editor → `Config.gs` → `GOOGLE_CLIENT_ID: "...",` → Ctrl+S, then
     publish a new version (next section).
7. Redeploy the beta (the same command as before: [DEPLOY.md → 8. Beta release](DEPLOY.md#8-beta-release)) after
   pasting the client ID into `site-config.js`, so the beta site has it.

New origins can take from 5 minutes to a few hours to start working.

## After changing any .gs file: publish a new version

The web app keeps using the version it was deployed with until you publish a new one:

1. Save (Ctrl+S).
2. **Deploy** → **Manage deployments**.
3. Select the `Gallery` deployment → **Edit** (pencil icon).
4. **Version** → **New version** → **Deploy**.

The Web app URL **stays the same**, so `site-config.js` needs no change. Don't use
**New deployment** again — that makes a new URL.

If you changed `SYNC_MINUTES`, also run `setup` again (Part 2, steps 1–3) so the timer
uses the new value.

---

## Day-to-day

### Pausing uploads

In the wedding Sheet's **Settings** tab set `gallery_uploads` to `no` (`off` and `hide`
work too). Guests can still look and heart; where "Add photos" was they see "Photo
sharing is paused for now." It reaches phones within about 1–5 minutes. Set it back to
`yes` (or blank) to open again. No redeploy.

### Storage

Photos use the wedding account's Google Drive storage (15 GB free, shared with Gmail
and Google Photos). A shared photo is roughly 1–2 MB, so 1 GB holds about 500–1000 photos.

- Drive use is checked when a guest shares a photo (there is no scheduled check, so
  nothing is sent while nobody is adding photos). If it is at `STORAGE_WARN_PERCENT`
  (85%) or more, the email in `Config.gs` gets a "Google Drive is …% full" message. It
  is sent **at most once a day**; if sending fails it isn't tried again that day.
- At `STORAGE_STOP_PERCENT` (98%), or if Drive says it is full, adding photos pauses by
  itself: guests see "The album is full — thank you for sharing!" with a Contact us
  button. Viewing and hearts keep working. The same email is sent (still once a day).
- To make room: empty the Drive **Trash** (files in the trash still count), delete large
  files you don't need, or buy more storage. Adding photos starts again **by itself**
  within a few minutes of space being freed — nothing to switch back on.

### Deleting photos

- **A guest deletes their own photo** (Photos by me → **Delete** on the photo → **Remove**): it is
  gone from the site for everyone, for good. The file goes to the Drive trash (you can
  still get the file back from there for 30 days), but the site keeps it hidden.
- **You delete a photo for a guest**: open the photos folder in Drive, find the photo
  (files are named by date and time, e.g. `20261212-204233-a1b2c3.jpg`), right-click →
  **Move to trash**. It disappears from the site within `SYNC_MINUTES` (15 minutes).
- **A photo you trashed in Drive came back?** Someone restored it from the Drive trash:
  restoring a file brings it back to the site within `SYNC_MINUTES` too.
- **Bringing back a photo deleted through the site:**
  1. In Drive → **Trash**, right-click the photo → **Restore**.
  2. Right-click it in the photos folder → **Share** → **Copy link**. The long part between
     `/d/` and `/view` is its ID.
  3. Open the **Wedding gallery data (private)** spreadsheet → **Photos** tab → Ctrl+F →
     paste the ID. In that row change `deleted` from `TRUE` to `FALSE`.
  It shows again within a minute.

### The Drive sync

Every `SYNC_MINUTES` the timer compares the gallery with the photos folder: photos
trashed or deleted in Drive disappear from the site, and photos restored from the trash
come back. A photo deleted through the site stays deleted (see above).

Lowering `SYNC_MINUTES` (allowed: 1, 5, 10, 15, 30) makes this quicker but uses more of
Google's daily time allowance for timers (about 90 minutes a day on a free account,
shared by all your scripts). 15 is a good balance; don't go below 5.

### Seeing what the script did

In the Apps Script editor, the list icon **Executions** (far left) shows every request
and timer run. Click one to see its log; problems are marked **Failed** or show a
warning line starting with `Gallery`. Guests never see these messages.

---

## Troubleshooting

| What you see | What to check |
|---|---|
| No Gallery tile on the home screen | Settings tab: `show_gallery` = `yes`. Reopen the site. |
| Gallery says **Coming soon** | `gallery.endpoint` in `site-config.js` is empty on the deployed site: paste the Web app URL (Part 4) and redeploy the site. |
| Gallery says **Just a moment** / "The photos aren't loading right now" | 1. Open the Web app URL in a private window: it must show `{"ok":true,"service":"gallery"}` (Part 3, step 6). 2. The URL in `site-config.js` is exactly that one, ending in `/exec`. 3. **Who has access** = **Anyone**. 4. After a `.gs` change you published a **New version**. 5. `setup` has been run (Executions shows "Gallery is not set up" otherwise). |
| Photos show as **grey squares** | The photos folder must be *Anyone with the link → Viewer*: open it in Drive → **Share** → General access. Or run `setup` again (it sets this). A photo added a moment ago can take a minute for Google to make its small picture (the site asks again by itself a few times; the phone that shared it shows its own copy meanwhile). |
| **"Sign-in isn't available here"**, or a Google error page after tapping the Google button | In WhatsApp's or Instagram's built-in browser this is expected: there we show "Sign-in isn't available here", or Google may show its own error page instead of our message. Guests can open the link in Chrome or Safari, or just add photos without signing in. Everywhere else: check the client ID in `site-config.js` (and that the site was redeployed), and that the address in the browser bar is listed exactly under **Authorized JavaScript origins** (Part 5b). New origins can take a few hours. |
| **"Sign-in didn't work"** after choosing an account | `GOOGLE_CLIENT_ID` in `Config.gs` is blank or not the same as `googleClientId` in `site-config.js`, or the new version wasn't published. Consent screen must say **In production** (Part 5a). |
| Email **"Google Drive is …% full"** | Make room (see [Storage](#storage)). Uploads restart by themselves. |
| Expected the email but none came | Check Spam. It comes at most once a day, and only when a guest shares a photo (Drive use isn't checked otherwise). Executions → look for "storage warning email not sent". |
| Guests see **"The album is full"** | Drive is at 98% or full: make room (see [Storage](#storage)). |
| Want to stop uploads for a while | `gallery_uploads` = `no` (see [Pausing uploads](#pausing-uploads)). |
| A guest asks you to remove a photo | Drive photos folder → right-click the photo → **Move to trash**. Gone from the site within `SYNC_MINUTES` (see [Deleting photos](#deleting-photos)). |
| "Lots of guests are sharing right now" | Many uploads at the same moment; the phone tries again by itself. Nothing to do. |
| Ran `setup` and it says a folder or spreadsheet "does not belong to …" | Something with the same name was shared with you by another account; `setup` makes its own instead. Fine to ignore. |
