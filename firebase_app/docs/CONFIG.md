# site-config.js reference

`public/site-config.js` holds every setting that isn't wedding data. The code
reads all text, links, images and colours from here. After editing, redeploy
(`firebase deploy --only hosting`).

Text values can use placeholders, filled from the Sheet's Settings tab:
`{bride}`, `{groom}`, `{city}` (and `{days}` / `{count}` where noted).

## sheet
| Key | What it does |
|---|---|
| `id` | Google Sheet ID (required). |
| `urlTemplate` | How a tab is fetched. Keep as is unless you switch to "Publish to web" CSV (`https://docs.google.com/spreadsheets/d/e/<pub-id>/pub?output=csv&sheet={tab}`). |
| `tabs.*` | Tab names in the sheet. |
| `columns.*` | Header text for each column. Change the right-hand side if your sheet uses different headers. |
| `settingKeys.*` | Names used in the Settings tab's `key` column. |
| `showKeys.*` | Settings-tab keys that show/hide a section (`show_program`, `show_stay`, `show_venues`, `show_gallery`, `show_contacts`). `settingKeys.galleryUploads` (`gallery_uploads`) pauses guest uploads. |
| `dateOrder` | `"DMY"` or `"MDY"` — how `11/12/2026` is read. `YYYY-MM-DD` is always unambiguous. |

## images
| Key | What it does |
|---|---|
| `hero` | Couple photo on the home screen (portrait ~3:4 looks best in the arch). |
| `appIcon` | Small icon path (reserved). Home-screen icons live in `assets/icons/` and are listed in `manifest.webmanifest`. |

## gallery
Guest photo sharing. While `endpoint` is empty the Gallery shows "coming soon".
Setting it up (Drive, Apps Script, Google sign-in): [GALLERY_SETUP.md](GALLERY_SETUP.md).

| Key | What it does |
|---|---|
| `endpoint` | Web address of the Apps Script backend (the Web app URL ending in `/exec`, [GALLERY_SETUP.md → Part 3](GALLERY_SETUP.md#part-3-publish-the-script-as-a-web-app)). Empty = "coming soon". |
| `googleClientId` | Google sign-in ID (public by design). Empty = no sign-in anywhere. When set, Photos by me ends with "Shared photos from another phone?" + Google's button, and the Ready-to-share panel has "or use my Google name". Sign-in is optional: if it can't work (an app's built-in browser, Google down) that spot says so and uploading works as before. Must be the same value as `GOOGLE_CLIENT_ID` in `apps-script/Config.gs` (blank there = the backend refuses every sign-in). |
| `googleScriptUrl` | Address of Google's sign-in script. Loaded only when a sign-in control is shown (Photos by me, or tapping "or use my Google name"). |
| `maxPhotosPerUpload` | Photos accepted in one go; the rest wait for the next tap. |
| `parallelUploads` | Photos sent at the same time. |
| `maxLongEdgePx` | Photos are shrunk so the longest side is at most this many pixels. |
| `jpegQuality` | Quality of the shrunk copy, 0 to 1. |
| `maxUploadBytes` | Largest single upload after shrinking. |
| `requestTimeoutMs` | Give up on a normal request after this long. |
| `uploadTimeoutMs` | Give up on one photo upload after this long. |
| `scriptLoadTimeoutMs` | Give up loading the gallery files or Google script after this long. |
| `retries` | Extra tries for a failed request. |
| `retryBackoffMs` | Wait before the first retry (doubles each time). |
| `pageSize` | Photos fetched per page. |
| `savedListSize` | Photos remembered on the phone for offline viewing. |
| `thumbSizePx` / `fullSizePx` | Picture width for the grid / for full screen. |
| `thumbRetries` | A grid picture that didn't load (e.g. a photo shared a moment ago, or Google busy) is asked for again on each refresh, at most this many times; then it stays a soft grey square. A photo shared from this phone shows its own small copy meanwhile. |
| `thumbUrl` / `fullUrl` | Picture address patterns; `{id}` and `{size}` are filled in. |
| `refreshIntervalMs` | How often new photos are looked for while the Gallery is open. |
| `nameMaxLength` | Longest name shown on a photo. |
| `addButtonWidth` | Width of the "Add photos" button (e.g. `76%`). |
| `loadMoreAheadPx` | Start fetching the next page of photos this many pixels before the end of the grid. |
| `swipeMinPx` | Sideways finger movement (pixels) that counts as a swipe in the photo viewer. |
| `preloadNeighbours` | Photos fetched ahead on each side of the one open in the viewer. |
| `previewSizePx` | Longest side (pixels) of the small copy shown while photos are chosen and uploading. |
| `progressTickMs` | How often the upload rings are redrawn. |
| `progressEstimateMs` | Rough time to send one photo; the ring fills on this time scale (real sending progress can't be measured). |
| `privacyUrl` | The privacy page (`privacy.html`), linked from the sign-in card on Photos by me and from the Ready-to-share panel. Its words: [`text.privacy`](#textprivacy-privacy-page). |
| `privacyContactsUrl` | Where the privacy page's "Contact the family" buttons go (`./#contacts` = the Contacts screen). |

Pausing uploads without a redeploy: see `gallery_uploads` in
[SHEET_SETUP.md](SHEET_SETUP.md). The gallery wording is in
[`text.gallery`](#textgallery-gallery-wording). The backend has its own settings
(storage levels, sync timer, limits): [Gallery backend settings](#gallery-backend-settings-apps-scriptconfiggs).

## Locale & phone
| Key | What it does |
|---|---|
| `locale` | Date format language, e.g. `en-IN`. |
| `whatsappCountryCode` | Added to 10-digit numbers, e.g. `91`. |
| `whatsappUrl` | WhatsApp link pattern; `{number}` is replaced. |

## theme
`colors.*` — page colours (any CSS colour). `goldText` and `joiner` (the "weds" between the names) should stay dark enough to read on the light background.
`fonts.script` / `fonts.body` — font names; `fonts.url` — the Google Fonts stylesheet that loads them (build one at <https://fonts.google.com>).

## features
`true`/`false` switches: `countdown`, `nowNext`, `installHint`.

Sections: `program`, `stay`, `venues`, `gallery`, `contacts`. These are only
**defaults**, used when the Settings tab has no `show_…` row for that section.
A `show_…` row in the sheet always wins, and needs no redeploy — see
[SHEET_SETUP.md → Showing or hiding sections](SHEET_SETUP.md#showing-or-hiding-sections).
Currently `stay` and `gallery` default to hidden.

## nowWindowHours
How long an event can stay "Happening now" if the next event is far away.

## text
Every word shown on the site. Notable ones:
| Key | Example |
|---|---|
| `pageTitle` | Browser tab title: `"{bride} weds {groom}"` |
| `heroJoiner` | Word between the names on the home screen: `"weds"` |
| `countdownMany` | `"{days} days to go"` |
| `tiles.*` | Labels on the home tiles |
| `titles.*` | Titles at the top of each screen |
| `stay.searchPlaceholder` | Grey text inside the search box (keep it short — it can't wrap) |
| `stay.searchHint` | Small line under the search box; `""` hides it |
| `stay.noHotel` | Heading for guests with no hotel filled in |
| `stay.resultsMany` | `"{count} matches"` |
| `status.dataUpdating` | Shown when a tab or column is missing in the sheet |

### text.gallery (Gallery wording)
Placeholders in `{braces}` are filled in by the site; keep them.

| Key | Where it shows |
|---|---|
| `comingSoonTitle` / `comingSoonBody` | Gallery screen while `gallery.endpoint` is empty |
| `subtitle` | Line under the title: `{count}` = number of photos |
| `subtitleOne` | The same line when there is exactly 1 photo |
| `tabAll` / `tabMine` | The two tabs: all photos / photos shared from this phone |
| `mineSubtitle` | Line under the title on the Photos by me tab |
| `addPhotos` | The big "Add photos" button |
| `emptyTitle` / `emptyBody` | All photos tab when nobody has shared yet |
| `mineEmpty` | Photos by me tab when this phone hasn't shared anything |
| `errorTitle` / `errorBody` | Card when the photos can't load (backend down or set up wrongly) |
| `offlineTitle` / `offlineBody` | Card when the phone is offline and nothing is saved on it |
| `savedNotice` | Note above the photos saved on the phone, when fresh ones can't load |
| `tryAgain` | Button on the error card and on the saved-photos note |
| `pausedNote` | Replaces Add photos while uploads are paused (keep it short) |
| `fullNote` | Replaces Add photos when Drive storage is full (keep it short) |
| `fullAction` | Button next to `fullNote`; opens Contacts |
| `panelTitle` | Title of the panel that opens after choosing photos |
| `panelMore` | Tile in that panel to choose more photos |
| `panelRemove` | Spoken label of the × on a chosen photo (screen readers) |
| `nameLabel` / `nameOptional` | Label of the name box, and the "(optional)" after it |
| `nameHint` | Small line under the name box; `{name}` = what they typed |
| `uploadButton` | Button that sends the chosen photos |
| `useGoogleName` | Link under the name box to use the Google name (only when sign-in is set up) |
| `tooMany` | When more than `maxPhotosPerUpload` are chosen; `{max}` = that number |
| `uploading` | Progress line: `{done}` of `{total}` |
| `keepOpen` | Small line under the progress line |
| `uploadFailed` | On a photo that didn't upload (tap it to try again) |
| `unsupported` | On a chosen file that can't be read as a photo |
| `by` | Name on a photo in the full-screen viewer: `{name}` |
| `byPrefix` | Under each grid photo, before the name (the name follows in bold), e.g. `By` |
| `byGuest` | Under each grid photo that has no name, e.g. `By a guest` |
| `today` / `yesterday` | Photo time on those days: `{time}` |
| `dayTime` | Photo time on other days: `{date}`, `{time}` |
| `loading` | While the first photos are on their way |
| `counter` | In the photo viewer: `{n}` of `{total}` |
| `heartLabel` | Spoken label of the heart button |
| `close` / `prev` / `next` | Spoken labels of the viewer's ×, ‹ and › buttons |
| `delete` | Delete button on your own photos (Photos by me tiles and the viewer) |
| `confirmTitle` / `confirmRemove` / `confirmKeep` | The "remove this photo?" question and its two buttons |
| `otherPhoneTitle` | Heading above Google's sign-in button at the end of Photos by me |
| `signInNote` | Small line under that button |
| `privacyLink` | Small link to the privacy page (sign-in card, signed in or out, and next to `useGoogleName` in the panel) |
| `signedInAs` | Shown after signing in: `{name}` = the Google name |
| `signedInNoName` | The same, when the Google account has no name |
| `signOut` | Sign-out button |
| `signOutFailed` | When signing out didn't work |
| `signInUnavailable` | Where the sign-in button would be, when sign-in can't work there (e.g. an app's built-in browser) |
| `errors.offline` | Upload, delete or heart failed: the phone is offline |
| `errors.unavailable` | … the backend can't be reached |
| `errors.busy` | … too many guests at once (the phone tries again) |
| `errors.full` | … Drive storage is full |
| `errors.paused` | … uploads are paused (`gallery_uploads` = `no`) |
| `errors.invalid` | … the photo or request wasn't accepted |
| `errors.forbidden` | … deleting a photo that isn't yours |
| `errors.too_large` | … the photo is larger than the backend accepts |
| `errors.rate_limited` | … too many uploads from one phone in an hour |
| `errors.signin_failed` | … Google sign-in didn't work |

### text.privacy (privacy page)
The words of `privacy.html`. Plain text only (no `{placeholders}`); the page needs no
Sheet, so it always opens.

| Key | Where it shows |
|---|---|
| `title` | Title at the top of the page (and the browser tab) |
| `intro` | Short line under the title |
| `contactLink` | Button under a section marked `contact: true`; goes to `gallery.privacyContactsUrl` |
| `sections` | The cards, in order: each `{ heading: "...", paragraphs: ["...", "..."] }`, plus `contact: true` for a "Contact the family" button. Add, remove or reword sections freely. |

## Gallery backend settings (apps-script/Config.gs)

These live in `Config.gs` in the **Apps Script editor** (the file in the project folder
is a copy; keep the two alike). `Config.gs` is private: never copy its values into
`site-config.js`, which every guest's phone downloads. After any change: save, then
Deploy → Manage deployments → Edit → **New version**
([GALLERY_SETUP.md](GALLERY_SETUP.md#after-changing-any-gs-file-publish-a-new-version)).

| Key | Default | What it does |
|---|---|---|
| `OWNER_EMAIL` | the wedding account (filled in) | Who gets the "storage nearly full" email. `setup` also only reuses a folder or spreadsheet that belongs to this account. Never shown to guests. |
| `WEDDING_SHEET_ID` | the wedding Sheet's ID | The same Sheet the site reads; only its Settings tab is read (for the pause switch). |
| `SETTINGS_TAB` | `Settings` | Tab in the wedding Sheet with the key/value settings. |
| `UPLOADS_KEY` | `gallery_uploads` | Settings key of the pause switch: `no` (or `n`, `false`, `0`, `off`, `hide`) pauses uploads. Missing or blank = open. |
| `GOOGLE_CLIENT_ID` | blank | Google sign-in client ID; must be the same as `gallery.googleClientId` in `site-config.js`. Blank = every sign-in is refused. |
| `TOKENINFO_URL` | Google's token-check address | Where a guest's sign-in is checked with Google. Leave it. |
| `FOLDER_NAME` | `Wedding guest photos` | Name of the Drive folder `setup` creates for the photos (anyone with the link can view). |
| `DATA_SHEET_NAME` | `Wedding gallery data (private)` | Name of the private spreadsheet `setup` creates in My Drive (photos, hearts, phones). |
| `DRIVE_FOLDER_ID` | blank | The photos folder: its Drive link or bare ID. Blank = the one `setup` created. |
| `DATA_SHEET_ID` | blank | The private data spreadsheet's ID. Blank = the one `setup` created. |
| `STORAGE_WARN_PERCENT` | `85` | Drive storage used (%) at which the owner is emailed (at most once a day). Checked when a guest next shares a photo, not on a schedule. |
| `STORAGE_STOP_PERCENT` | `98` | Drive storage used (%) at which adding photos stops ("album full"). Starts again by itself once there is room. |
| `WARN_MAIL_SUBJECT` / `WARN_MAIL_BODY` | "Wedding gallery: Google Drive is {percent}% full" / a short explanation | The storage email. `{percent}`, `{used}` and `{limit}` (GB) and `{stop}` (%) are filled in. |
| `TIME_ZONE` | `Asia/Kolkata` | Time zone for photo file names and for "once a day". Blank = the script's own. |
| `MAX_PHOTO_BYTES` | `10485760` (10 MB) | Largest photo accepted. The site shrinks photos well below this. |
| `NAME_MAX_LENGTH` | `40` | Longest guest name kept; longer names are cut. |
| `PAGE_SIZE_MAX` | `60` | Most photos in one list answer, whatever the site asks for. |
| `RATE_LIMIT_PER_HOUR` | `100` | Most uploads accepted from one phone in one hour. |
| `SETTINGS_CACHE_SECONDS` | `60` | How long the pause switch's value is remembered. |
| `STORAGE_CACHE_SECONDS` | `60` | How long the Drive storage check is remembered, and how long a "Drive full" error keeps uploads stopped before Drive is asked again. |
| `LIST_CACHE_SECONDS` | `10` | How long the photo, heart and phone lists are remembered between requests. |
| `CACHE_CHUNK_BYTES` | `90000` | Largest piece the remembered lists are cut into (Google's limit is 100 KB). Leave it. |
| `SYNC_MINUTES` | `15` | How often photos trashed or restored in Drive leave / come back to the site. Only 1, 5, 10, 15 or 30 (anything else means 15). Lower = more of Google's daily timer allowance (about 90 minutes a day on a free account). Run `setup` again after changing it. |
| `SYNC_MAX_SECONDS` | `240` | Longest the sync may spend listing the photos folder; if Drive is slower, nothing changes and the next run tries again. |
| `LOCK_WAIT_MS` | `10000` | How long a change (heart, upload, delete) waits for another one to finish before answering "busy" (the phone then tries again). |

## Not in this file
- **App name under the home-screen icon** — `public/manifest.webmanifest` (`name`, `short_name`). Browsers read that file directly, so it can't come from here.
- **Wedding data** — the Google Sheet (see SHEET_SETUP.md).
