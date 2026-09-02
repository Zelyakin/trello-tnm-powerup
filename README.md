# T&M Power-Up for Trello

This is a Power-Up for Trello that allows you to track time spent on cards with cloud synchronization via Supabase.

## Features

- ⏱️ Track time spent on tasks in a convenient format (1d 2h 30m)
- 📅 Select work date via calendar
- 👥 Select user on behalf of whom time will be added (current user by default)
- 📝 History of all entries with user and date indication
- ✏️ Editing of existing entries — time, work date, user and description
- 🗑️ Ability to delete time entries from history
- 📊 Export time tracking data to CSV file with date filtering, including each card's labels
- ☁️ Cloud storage via Supabase for reliable data persistence
- 🏷️ Display badges with time spent on cards
- 📋 Display time summary on the back of the card
- 🔄 Cache clearing and Power-Up refresh
- 📈 Board statistics with period filtering and top contributors
- ⚙️ **Configurable hours per day**: Choose between 8h workday or 24h calendar day mode
- ⚡ **High performance**: Advanced multi-level caching reduces API calls by 75% for instant loading

## Installation

1. Clone the repository
2. Host files on Cloudflare Pages or another web server
3. Register the Power-Up in Trello Power-Up Admin: https://trello.com/power-ups/admin
4. Add the Power-Up to your Trello board

## Usage

### Adding Time

1. Open a card on your Trello board
2. Click the "T&M" button in the card menu
3. Select the user on behalf of whom you want to add time (current user is selected by default)
4. Select the work date in the calendar (current date is set by default)
5. Add time spent in the format "1d 2h 30m" (days, hours, minutes)
   - Examples: "2h 30m", "1d", "45m", "1d 6h"
   - Note: 1 day = 8 hours (workday mode) or 24 hours (calendar mode, configurable in settings)
6. View time summary on the back of the card
7. If needed, fix an entry with the "Edit" button in the "History" section: the form switches to
   edit mode (time, work date, user and description), "Save changes" overwrites the entry in place
   and returns you to the history. "Cancel" leaves it untouched
8. If needed, delete incorrect entries using the "Delete" button in the "History" section

### Exporting Time Tracking Data

1. Click the "Export T&M" button on the board toolbar
2. Specify date range for filtering (last month is set by default)
3. Optionally disable the "Include cards without time tracking data" option
4. Click the "Export to CSV" button
5. The CSV file will be automatically downloaded to your computer
6. File format: "date","task","labels","user","time spent","time spent (minutes)","work description"
7. The "time spent (minutes)" column contains total time converted to minutes for easy processing in Excel
8. The "labels" column lists the card's Trello labels, separated by `; `. A label with no name is
   shown as its color in parentheses (e.g. `(green)`). Labels reflect the card's **current** state,
   not the state at the time the entry was logged — they are read live from Trello, not stored with
   the time entry

**Archived & deleted cards.** Time logged on a card stays in the export even after the card
is archived or deleted from the board. Trello's Power-Up client (`t.cards('all')`) does not
return such cards, so their names are resolved on demand via the Trello REST API:

- **Archived** card → shown as `[archived] <name>`, labels included
- **Deleted** card → shown as `[deleted] <cardId>` (Trello no longer has a name or labels for it)
- A card **moved to another board** still resolves to its plain `<name>` (no prefix), labels included

Name resolution is **opt-in**: tick "Resolve names of archived/deleted cards" in the export form.
When it is off (the default), the export never contacts Trello's REST API and off-board cards
export as `Card <id>` with an empty "labels" cell. When it is on and the export contains off-board cards, the person exporting
is asked once to grant **read-only** access to Trello — Trello grants this at the account level
(there is no per-board scope), and the token expires after 30 days. If they decline, the export
still completes with the `Card <id>` fallback. Trello's client library stores the token itself —
it is never sent to or stored by this Power-Up. See **Setup → Trello REST API** below for the API key.

### Board Statistics

1. Click the "T&M Stats" button (Σ icon) on the board toolbar
2. Select period: Current Month, Last Month, or Current Week
3. View statistics:
   - Total time spent
   - Number of entries
   - Active cards
   - Average per day
   - Top 3 contributors

### Managing Data & Settings

- **Hours per day setting**: Go to Settings → Choose between "8 hours (work day)" or "24 hours (calendar day)"
  - This affects how days are calculated: 16 hours = 2 days (8h mode) or 0d 16h (24h mode)
  - Click "Save Settings" — changes apply instantly to all time displays on the board
- **Data removal**: The Settings screen has a "Data Removal" section. There is no in-app delete
  button by design — to permanently erase all your data, contact zelyakin@gmail.com

## Development

### File Structure

```
├── index.html                  # Entry point and Power-Up initialization
├── manifest.json               # Power-Up manifest
├── _headers                    # CORS and security headers
│
├── css/
│   └── style.css              # Styling for all views
│
├── js/
│   ├── client.js              # Main Power-Up logic and Trello integration
│   ├── storage.js             # Data storage utilities (Supabase wrapper)
│   ├── supabase-api.js        # Supabase cloud storage API
│   └── board-members.js       # Board member utilities
│
├── views/
│   ├── card-detail.html       # Card time tracking interface (popup)
│   ├── card-back.html         # Card back summary display
│   ├── settings.html          # Power-Up settings and management
│   ├── export-time.html       # CSV data export interface
│   └── board-stats.html       # Board statistics
│
└── img/
    ├── icon.png               # Power-Up icon
    ├── export-white.svg       # Export button icon (light theme)
    ├── export-dark.svg        # Export button icon (dark theme)
    ├── sigma-icon.svg         # Statistics button icon
    └── stats-icon.svg         # Alternative stats icon
```

### Technical Details

The Power-Up uses Supabase for cloud storage:

**Supabase Database Schema:**

```sql
-- Boards table
CREATE TABLE boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trello_board_id TEXT UNIQUE NOT NULL,   -- 24-char Trello board id (hex, NOT a UUID)
  created_at TIMESTAMP DEFAULT NOW()
);

-- Board settings table
CREATE TABLE board_settings (
  id SERIAL PRIMARY KEY,                  -- the only sequence-backed PK in the schema
  board_id UUID REFERENCES boards(id) UNIQUE NOT NULL,
  hours_per_day INTEGER DEFAULT 8 CHECK (hours_per_day IN (8, 24)),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Cards table with aggregated time in minutes
CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trello_card_id TEXT UNIQUE NOT NULL,
  board_id UUID REFERENCES boards(id),
  time_minutes INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Time entries table with minutes-based storage
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID REFERENCES cards(id),
  trello_member_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  time_minutes INTEGER DEFAULT 0,
  description TEXT DEFAULT '',
  work_date DATE NOT NULL,
  trello_entry_id BIGINT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(card_id, trello_entry_id)
);

-- Indexes for performance
CREATE INDEX idx_cards_trello_card_id ON cards(trello_card_id);
CREATE INDEX idx_cards_board_id ON cards(board_id);
CREATE INDEX idx_time_entries_card_id ON time_entries(card_id);
CREATE INDEX idx_time_entries_work_date ON time_entries(work_date);
CREATE INDEX idx_board_settings_board_id ON board_settings(board_id);
```

### Time Calculation

The Power-Up uses a **minute-based storage system** with configurable hours-per-day settings:

**Storage:**
- All time is stored internally as minutes (`time_minutes` field)
- Time entries are converted to minutes when saved: `totalMinutes = (days × hoursPerDay × 60) + (hours × 60) + minutes`
- Example with 8h mode: "1d 2h 30m" → `(1 × 8 × 60) + (2 × 60) + 30 = 630 minutes`
- Example with 24h mode: "1d 2h 30m" → `(1 × 24 × 60) + (2 × 60) + 30 = 1590 minutes`

**Display:**
- Minutes are converted back to d/h/m format based on current board settings
- Board setting controls: 1 day = 8 hours (workday) OR 1 day = 24 hours (calendar day)
- Display updates automatically when settings change (no data migration needed)
- Example: 630 minutes = "1d 2h 30m" (8h mode) or "0d 10h 30m" (24h mode)

**Benefits:**
- Single source of truth (minutes)
- Flexible display without changing stored data
- Accurate time tracking regardless of display mode
- No data loss when switching between modes

### Performance Optimizations

The Power-Up implements several optimizations for fast loading:

1. **Smart data fetching**: Badge display uses only aggregated time (`time_minutes`) without loading full history
2. **In-memory caching**: API responses are cached with TTL:
   - Badge data: 60 seconds
   - Full card data: 60 seconds
   - Settings cache invalidation on change
3. **Request deduplication**: Protection against simultaneous identical requests
4. **Selective field queries**: Only necessary fields are fetched from Supabase
5. **Minimal return preferences**: Write operations use `Prefer: return=minimal` header
6. **Batch queries for statistics**: Board stats use single query with `in.(cardIds)` instead of N queries
7. **Auto-refresh on settings change**: Cache invalidates automatically when hours-per-day setting changes

**Performance metrics:**
- Opening board with 16 cards: **16 requests** (was 48)
- Opening card: **2 requests** (was 4)
- Opening time entry popup: **2 requests** (was 4)
- Board statistics: **2-3 requests** (was N+2 for N cards)

### API Call Flow

**Opening board (badge display):**
```
For each visible card:
└─ getCardDataForBadge()
   ├─ checkSettingsUpdate() - checks if settings changed
   ├─ GET /cards?select=time_minutes&trello_card_id=eq.{id}
   └─ GET /board_settings?board_id=eq.{board_id}
      ✅ Only time_minutes aggregate, NO time_entries history
```

**Opening card detail:**
```
1. getCardData()
   ├─ checkSettingsUpdate() - checks if settings changed
   ├─ GET /cards?select=id,trello_card_id,time_minutes&trello_card_id=eq.{id}
   ├─ GET /time_entries?select=time_minutes,description,work_date,...&card_id=eq.{card_id}&order=created_at.desc
   └─ GET /board_settings?board_id=eq.{board_id}
      ✅ Full history with all details
```

**Adding time entry:**
```
1. ensureCardWithBoard()  (if card doesn't exist)
   ├─ GET /cards?select=id,...&trello_card_id=eq.{id}
   └─ (if needed) GET /boards + POST /boards + POST /cards
2. GET /board_settings - get hours_per_day for conversion
3. POST /time_entries (with time_minutes calculated)
4. updateCardTotalTime()
   ├─ GET /time_entries?select=time_minutes&card_id=eq.{id}
   └─ PATCH /cards?id=eq.{id} (update time_minutes)
```

**Board statistics (optimized):**
```
1. getBoardStats()
   ├─ GET /boards?select=id&trello_board_id=eq.{id}
   ├─ GET /cards?select=id,trello_card_id&board_id=eq.{board_id}
   └─ GET /time_entries?select=time_minutes,member_name,card_id&card_id=in.(id1,id2,...)&work_date=gte.{start}&work_date=lte.{end}
      ✅ Single batch query for ALL cards' time entries
```

## Configuration

### Supabase Setup

1. Create a new project at https://supabase.com
2. Run the SQL schema from the Technical Details section
3. Update `js/supabase-api.js` with your project credentials:

```javascript
SUPABASE_URL: 'your-project-url',
SUPABASE_ANON_KEY: 'your-anon-key'
```

4. Deploy the `trello-auth` Edge Function and apply the RLS policies — see
   [supabase/README.md](supabase/README.md). **This step is not optional:** since v3.6 the anon
   key alone grants no access to data, and the Power-Up authenticates with a short-lived token
   that is scoped to the board it is open on. Without the function every request fails.

### Trello REST API

Required only for resolving names of **archived/deleted** cards in the CSV export
(everything else works without it).

This project runs as **two Power-Ups**: production on `https://trello-tnm-powerup.pages.dev`
(Cloudflare Pages, `master`) and development on `https://zelyakin.github.io/trello-tnm-powerup/`
(GitHub Pages, `dev`). Each has its own API key; `views/export-time.html` selects the right one at
runtime by `location.hostname`, so the source file is identical on both branches (a `dev → master`
PR can't clobber the production key):

```javascript
const DEV_KEY = 'DEV_POWERUP_KEY';
const TRELLO_API_KEY = ({
  'trello-tnm-powerup.pages.dev': 'PROD_POWERUP_KEY',
  'zelyakin.github.io':           DEV_KEY
})[location.hostname] || DEV_KEY;  // unknown host → dev key
```

Setup per Power-Up (https://trello.com/power-ups/admin → the Power-Up → **API Key** tab):

1. Generate (or reuse) the API key and paste it into the map above for the matching host.
2. In that key's **Allowed origins**, add the Power-Up's **origin only** (scheme + host, no path):
   - production key → `https://trello-tnm-powerup.pages.dev`
   - development key → `https://zelyakin.github.io`

   It is the origin `https://zelyakin.github.io`, **not** the full Pages path `.../trello-tnm-powerup/`.
   Without a matching allowed origin, Trello blocks the authorization popup.

API keys are **public and safe to embed** in client-side code (per Trello's docs); only the user
token is secret, and Trello's client library stores that itself (member-private, one-time `read`
scope) — this Power-Up never sees or persists it. Until real keys are set, the export still works;
off-board cards just fall back to `Card <id>` instead of resolved `[archived]`/`[deleted]` names.

### Environment Variables

The Power-Up is configured for production use with Supabase cloud storage.

## Architecture Decisions

### Why minute-based storage?

The Power-Up stores all time internally as minutes (`time_minutes` field) instead of separate days/hours/minutes:

**Pros:**
- **Flexible display**: Can switch between 8h/24h modes without data migration
- **Single source of truth**: No ambiguity about total time
- **Accurate calculations**: All math done in minutes, then converted for display
- **Simple aggregation**: Just sum minutes, no complex d/h/m arithmetic
- **Future-proof**: Easy to add new display modes (e.g., decimal hours)

**Cons:**
- **Display conversion overhead**: Must convert minutes to d/h/m on every display
- **Migration complexity**: Existing data must be migrated from d/h/m to minutes

**Mitigation:**
- Conversion is very fast (simple integer math)
- Client-side caching minimizes conversion frequency
- Migration done once with SQL scripts

### Why separate aggregates in cards table?

Instead of calculating totals on-the-fly from `time_entries`, we store aggregated `time_minutes` in the `cards` table:

**Pros:**
- **Fast badge rendering**: No need to fetch and sum all time entries for each card
- **Reduced API calls**: Badge display requires only 1 query instead of 2
- **Better scalability**: Works efficiently even with hundreds of time entries per card

**Cons:**
- **Data duplication**: Totals must be kept in sync
- **Update complexity**: Every time entry modification requires updating aggregates

**Mitigation:** The `updateCardTotalTime()` function is called automatically after each add/delete operation.

### Why trello_card_id is globally unique?

Although the database schema includes `board_id` for foreign key constraints, `trello_card_id` is globally unique in Trello. This allows:

- Fetching card data without knowing the board
- Simplified API for badge display
- Faster queries with single-field index

The `board_id` is only needed when creating a new card record.

### Why in-memory cache instead of localStorage?

**Benefits:**
- No storage quota limits
- No persistence issues with stale data
- Automatic cleanup on page reload
- Better security (no data in browser storage)

**Trade-off:** Cache is lost on page reload, but with TTL of 60 seconds this is acceptable.

## Troubleshooting

### Common Issues

**Badges not updating after adding time**:
- The Power-Up updates badges automatically
- If badges don't update, reload the Trello tab (in-memory cache has a 60s TTL and is rebuilt on reload)
- Check browser console for API errors

**Slow board loading**:
- First load fetches data from Supabase (16 requests for 16 cards)
- Subsequent loads use cache (0 requests for 60 seconds)
- Check network tab for failed requests

**Data not syncing**:
- Verify Supabase connection in browser console
- Check network connectivity
- Reload the Trello tab to refresh cached data (cache TTL is 60 seconds)

**Storage limit warnings** (legacy Trello Storage):
- No longer applicable - all data stored in Supabase

## Changelog

### Version 3.8 (Current) - Editing Time Entries

**New features:**
- ✅ **Existing entries can be edited**: "Edit" next to each entry in the card's History opens it in the same form — time, work date, user and description. Saving overwrites the entry and keeps you in the history so the result is visible right away
- ✅ The author of an entry who has since left the board is preserved: they stay selected in the user list (marked "not on the board") instead of being silently replaced by the current user

**Notes:**
- **Requires one SQL step**: apply [supabase/sql/03_time_entries_update.sql](supabase/sql/03_time_entries_update.sql) — until then the database rejects edits (the original policies allowed only insert and delete). Nothing else changes: no schema migration, no data migration
- Every board member can edit any entry, including someone else's — the same rule that already applies to deletion. Edits leave no audit trail, so if the export goes to a client, treat this as you would deletion
- An entry deleted in another tab while you were editing it produces a clear error and the history reloads, instead of a silent no-op

### Version 3.7 - Labels in Export

**New features:**
- ✅ **Card labels in the CSV export**: a new "labels" column (right after "task") lists the card's Trello labels, separated by `; `. A label with no name is shown as its color, e.g. `(green)`
- ✅ Works for archived and moved cards too, under the existing opt-in "Resolve names of archived cards" toggle; deleted cards have no labels left in Trello

**Notes:**
- No database or schema changes: labels are read live from Trello and cost **zero** extra requests — on-board cards already carry them in the board data the export loads anyway, off-board cards get them in the REST call that was already being made
- Labels reflect the card's **current** state, not the state on the date the time was logged — there is no label history in the database
- The new column is inserted in the middle of the row, so spreadsheets/scripts keyed to fixed column positions need a one-off adjustment

### Version 3.6 - Board-Scoped Authorization

**Security:**
- ✅ **The public Supabase key no longer grants access to any data**: until 3.6 the Power-Up authenticated with the static anon key alone. That key proves "I am a client of this project", but says nothing about **which board** the Power-Up is open on — and since the client builds its own query filters, another board's `board_id` was indistinguishable from its own. In practice every board's data was readable and writable by any user of the Power-Up
- ✅ **Trello is now the identity provider**: the Power-Up exchanges the JWT that Trello signs for the current board (`t.jwt()`) for a short-lived Supabase token, via the `trello-auth` Edge Function. The function verifies the RS256 signature against Trello's published public keys, checks the Power-Up id against an allowlist, and mints a 1-hour token carrying the board id
- ✅ **Row-level security does the cutting**: every query is filtered server-side by `board_id` taken from that token, so a request can only ever touch the board the Power-Up is actually open on. Policies exist only for the authenticated role — the `anon` role was left with neither policies nor grants, and a plain `curl` with the public key now answers **401** instead of returning another board's time entries

**Notes:**
- No database migration and no visible change for users: same badges, same 60-second freshness. The token is cached per iframe, refreshed 5 minutes before it expires and deduplicated across parallel calls, so even a 270-card board performs a single exchange
- **Self-hosting now requires one extra setup step**: deploy the Edge Function and apply the SQL policies — see [supabase/README.md](supabase/README.md). Without them every request fails, since the anon key alone no longer opens anything
- Old browser tabs left open across the cutover keep running the pre-3.6 code and see empty data until refreshed (RLS returns no rows rather than an error). A page reload fixes it

### Version 3.5 - Constant-Cost Board Loading

**Improvements:**
- ✅ **Badges now cost one request per board instead of one per card**: opening a board loads every card's total in a single query, so a 270-card board is as cheap as a 5-card one (measured: ~264 KB → ~4 KB of traffic, 3 requests total regardless of board size)
- ✅ Cards with no tracked time are filtered out server-side — they render no badge anyway

**Notes:**
- No database or schema changes; nothing to migrate
- Behaviour is unchanged for users: same badges, same 60-second freshness. If the prefetch fails for any reason, the Power-Up silently falls back to the previous per-card lookups

### Version 3.4 - Timezone-Correct Dates

**Bug fixes:**
- ✅ **Work date no longer shifts by a day**: entries saved for a given date now display on that exact date regardless of the viewer's timezone. Previously, for users **west of UTC** (e.g. the Americas), a date saved as e.g. Jul 13 showed as Jul 12 — because a bare calendar date was being interpreted as UTC midnight and then rendered in local time. Card badges, card back, card detail and CSV export are all fixed.
- ✅ **Board statistics period boundaries fixed**: the "current month / last month / current week" filters no longer include or drop an edge day. The period boundaries were serialized via `toISOString()` (UTC), which shifted the `work_date` filter by a day — affecting users **both east and west** of UTC (e.g. a "Current Month" in UTC+5 wrongly pulled in the last day of the previous month and dropped the last day of the current one).

**Notes:**
- Display/query-side only — **data stored in the database was always correct**, so no migration is needed. Existing entries simply render on the right day now.

### Version 3.3 - Readable Export

**New features:**
- ✅ **Archived/deleted card names in CSV export**: off-board cards now resolve to `[archived] <name>` / `[deleted] <id>` via the Trello REST API instead of a bare `Card <id>`
- ✅ **Opt-in and read-only**: name resolution is off by default; enabling it asks the exporter once for read-only Trello access (30-day token, revocable anytime)

**Improvements:**
- CSV output hardened against formula injection; Export button disabled while a run is in progress; tidier export dialog

### Version 3.0 - Minute-Based Storage

**Major features:**
- ✅ **Minute-based storage system**: All time stored as minutes internally
- ✅ **Configurable hours per day**: Choose between 8h workday or 24h calendar day
- ✅ **Flexible display**: Switch display modes without data migration
- ✅ **Board settings table**: Per-board configuration with `hours_per_day` setting
- ✅ **Auto-refresh on settings change**: Cache invalidation via timestamp tracking
- ✅ **Optimized board statistics**: Batch query using `in.(cardIds)` instead of N queries

**Database changes:**
- Added `time_minutes` field to `cards` and `time_entries` tables
- Added `board_settings` table with `hours_per_day` constraint
- Changed `trello_board_id` type from TEXT to UUID
- Migrated all existing data from d/h/m to minutes (8h conversion)
- Kept legacy d/h/m fields for backward compatibility during the transition — dropped 2026-07-11 once the minute-based code was live in prod

**Performance improvements:**
- Board stats: 2-3 requests (was N+2 for N cards)
- Settings-aware caching with automatic invalidation
- Single batch query for all statistics data

### Version 2.0

**Major optimizations:**
- ✅ Removed legacy Trello Storage migration code
- ✅ Optimized API calls: 3x faster board loading
- ✅ Eliminated duplicate requests in card views
- ✅ Added separate methods for badge data vs full data
- ✅ Improved caching strategy with TTL
- ✅ Added protection against simultaneous requests
- ✅ Reduced polling interval from 2s to 5s

**Technical debt removed:**
- Removed `migrateCardToSupabase()` function
- Removed `compressData()` and `expandData()` functions
- Removed `USE_SUPABASE` flag (always Supabase now)
- Removed Trello Storage fallback logic
- Removed board_id requirement for most operations

### Version 1.0

**Initial features:**
- Basic time tracking functionality
- Supabase integration
- Data migration from Trello Storage
- Export to CSV
- Board statistics

## TODO

- [x] ~~Batch API calls for board statistics~~ (✅ Done in v3.0)
- [x] ~~Add configurable hours per day~~ (✅ Done in v3.0)
- [ ] Remove legacy d/h/m fields from database (after final testing)
- [ ] Batch API calls for board loading (1 request for all cards instead of N)
- [ ] Add versioning in URL to prevent caching issues
- [ ] Add ability to filter by users in export
- [ ] Improve mobile support
- [ ] Add support for different date and time formats
- [ ] Add support for decimal time input (e.g., 2.5h → 2h 30m)
- [ ] Add rate calculation and billing features
- [ ] Add team management and permissions
- [ ] Add advanced reporting and analytics
- [ ] Add real-time collaboration features

## Support

For issues, feature requests, or questions:
- Create an issue on GitHub
- Email: zelyakin@gmail.com

## Privacy & Data

- All time tracking data is stored securely in Supabase cloud storage
- Data is encrypted in transit (HTTPS) and at rest
- Only board members can access time tracking data for their boards
- No personal data is shared with third parties
- See `privacy-policy.html` for complete privacy policy

## License

MIT License - feel free to use and modify for your needs.

---

**Built with ❤️ using Trello Power-Up API and Supabase**