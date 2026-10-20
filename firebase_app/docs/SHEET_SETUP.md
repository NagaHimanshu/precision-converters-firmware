# Google Sheet setup (the wedding data)

The site reads all wedding details from one Google Sheet. Anyone you add as an
editor can update it from the Google Sheets app on their phone. Guests see the
change the next time they open (or reopen) the site — no redeploy needed.

## 1. Create the sheet

1. Go to <https://sheets.google.com> and create a blank spreadsheet. Name it, e.g. "Wedding site data".
2. Create five tabs (bottom of the screen) named **exactly**:
   `Settings`, `Program`, `Accommodation`, `Locations`, `Contacts`
3. In row 1 of each tab, type the headers listed under [Columns](#columns)
   below, then add your details from row 2 down.

## 2. Make every cell plain text (important)

Select everything in each tab (click the top-left corner box) →
**Format → Number → Plain text**.

Why: otherwise Google converts values on its own — phone numbers lose the
`+`, `07:30` turns into a decimal, and a column that mixes numbers and text
(rooms like `101` and `G-12`) can come through with blanks.

## 3. Share it

1. **Share** button → General access → **Anyone with the link** → **Viewer**.
   (The site needs this to read the data. It does not let anyone edit.)
2. Add your helpers by email as **Editor**.
3. Copy the sheet ID from the address bar:
   `https://docs.google.com/spreadsheets/d/`**`1AbC...xyz`**`/edit`
   and paste it into `public/site-config.js` → `sheet.id`. Redeploy once.

## 4. Protect the header row (recommended)

For each tab: select row 1 → **Data → Protect sheets and ranges** → set
permissions so only you can edit. Helpers can still change everything below.

## Columns

Row 1 must contain these headers (capitals don't matter). Extra columns are
ignored, so you can add your own notes columns.

### Settings (two columns: `key`, `value`)
| key | example value |
|---|---|
| bride | Ananya |
| groom | Rohan |
| wedding_date | 2026-12-12 |
| city | Hyderabad |
| tagline | Together with our families, we invite you to celebrate with us |
| show_stay | no |

The `show_…` rows are optional — see [Showing or hiding sections](#showing-or-hiding-sections).

### Program
| date | time | event | venue | note |
|---|---|---|---|---|
| 2026-12-12 | 7:45 AM | Muhurtham | Royal Convention Hall | |

- **date**: `YYYY-MM-DD` is safest. `12/12/2026` and `12 Dec 2026` also work.
- **time**: `7:45 AM`, `7 PM` or `19:45`. It is shown exactly as typed.
- **venue**: if it matches a name in the Locations tab, a "Map" link appears.
- Rows can be in any order; the site sorts by date and time.

### Accommodation
| sno | name | alias | hotel | room | note |
|---|---|---|---|---|---|
| 1 | Priyanka | Peddakka | Hotel Sapphire | 101 | Check-in from 12 PM |

- Guests search by name. Partial names and any word order work.
- **alias** (optional): what the family calls the person. It is **never shown**
  on the site — it only helps search, so typing "peddakka" finds Priyanka.
  Several aliases go in one cell separated by commas: `Peddakka, Akka`.
- The list is grouped under each **hotel** (in the order hotels first appear in
  the sheet) and sorted by **room** inside each hotel; the site numbers the
  rows 1, 2, 3… itself. `sno` only decides the order for people in the same room.

### Locations
| name | address | map_link | note |
|---|---|---|---|
| Royal Convention Hall | Road No. 1, Banjara Hills | https://maps.app.goo.gl/... | Parking at the back gate |

To get a map link: open the place in Google Maps → **Share** → **Copy link**.
Only links starting with `http` are used.

### Contacts
| name | role | phone | whatsapp |
|---|---|---|---|
| Suresh | Rooms & check-in | 9876543210 | yes |

- **phone**: 10-digit numbers get the country code from `site-config.js`
  (`whatsappCountryCode`). Or write it in full: `+91 98765 43210`.
- **whatsapp**: `no` hides the WhatsApp button; anything else shows it.

## Showing or hiding sections

Program, Stay, Venues, Gallery and Contacts can each be hidden — the home tile
disappears and the screen can't be opened, even from an old link. The data in
the tab stays as it is, so you can fill it in early.

In the **Settings** tab add a row (column `key`, column `value`):

| key | value |
|---|---|
| show_program | yes |
| show_stay | no |
| show_venues | yes |
| show_gallery | no |
| show_contacts | yes |

- Change `no` → `yes` to reveal a section (e.g. Stay one week before the wedding).
  Guests see it the next time they open the site — no redeploy.
- If a row is missing or blank, the default from `site-config.js` (`features`)
  is used. Right now Stay and Gallery default to hidden; the rest are shown.
- Hidden only means "not shown in the app". The sheet is readable by anyone
  with its link, so don't rely on this for anything truly secret.

## Rules for helpers

- Don't rename tabs or change row 1.
- One person/event/place per row. Empty rows are skipped.
- After editing, reopen the site to check.
- If a section on the site says "being updated", a tab or header name was
  probably changed — undo it with **File → Version history**.
