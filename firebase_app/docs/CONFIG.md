# site-config.js reference

`public/site-config.js` holds every setting that isn't wedding data. The code
reads all text, links, images and colours from here. After editing, redeploy
(`firebase deploy --only hosting`).

Text values can use placeholders, filled from the Sheet's Settings tab:
`{bride}`, `{groom}`, `{city}` (and `{days}` / `{count}` where noted).

## sheet
| Key | What it does |
|---|---|
| `id` | Google Sheet ID. Empty = use `data/sample.json`. |
| `urlTemplate` | How a tab is fetched. Keep as is unless you switch to "Publish to web" CSV (`https://docs.google.com/spreadsheets/d/e/<pub-id>/pub?output=csv&sheet={tab}`). |
| `tabs.*` | Tab names in the sheet. |
| `columns.*` | Header text for each column. Change the right-hand side if your sheet uses different headers. |
| `settingKeys.*` | Names used in the Settings tab's `key` column. |
| `dateOrder` | `"DMY"` or `"MDY"` — how `11/12/2026` is read. `YYYY-MM-DD` is always unambiguous. |

## sampleDataPath
Path to the sample data used when `sheet.id` is empty.

## images
| Key | What it does |
|---|---|
| `hero` | Couple photo on the home screen (portrait ~3:4 looks best in the arch). |
| `appIcon` | Small icon path (reserved). Home-screen icons live in `assets/icons/` and are listed in `manifest.webmanifest`. |

## links
| Key | What it does |
|---|---|
| `galleryAlbum` | Shared Google Drive folder link. |
| `galleryUpload` | Upload page link (later phase). |
While both are empty the Gallery shows "coming soon".

## Locale & phone
| Key | What it does |
|---|---|
| `locale` | Date format language, e.g. `en-IN`. |
| `whatsappCountryCode` | Added to 10-digit numbers, e.g. `91`. |
| `whatsappUrl` | WhatsApp link pattern; `{number}` is replaced. |

## theme
`colors.*` — page colours (any CSS colour). `goldText` should stay dark enough to read on the light background.
`fonts.script` / `fonts.body` — font names; `fonts.url` — the Google Fonts stylesheet that loads them (build one at <https://fonts.google.com>).

## features
`true`/`false` switches: `countdown`, `nowNext`, `contacts`, `gallery`, `installHint`.

## nowWindowHours
How long an event can stay "Happening now" if the next event is far away.

## text
Every word shown on the site. Notable ones:
| Key | Example |
|---|---|
| `pageTitle` | Browser tab title: `"{bride} & {groom}"` |
| `countdownMany` | `"{days} days to go"` |
| `tiles.*` | Labels on the home tiles |
| `titles.*` | Titles at the top of each screen |
| `stay.resultsMany` | `"{count} matches"` |
| `status.dataUpdating` | Shown when a tab or column is missing in the sheet |

## Not in this file
- **App name under the home-screen icon** — `public/manifest.webmanifest` (`name`, `short_name`). Browsers read that file directly, so it can't come from here.
- **Wedding data** — the Google Sheet (see SHEET_SETUP.md).
