# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Trello Power-Up for time tracking (T&M - Time & Materials) that uses Supabase for cloud storage. The Power-Up allows users to track time spent on Trello cards, view aggregated time data, export to CSV, and see board statistics.

> **See `TODO.md`** for the list of pending fixes (broken legacy views, dead methods, settings screen redesign).

**Key Features (v3.0)**:
- Minute-based storage system for flexible time display
- Configurable hours per day: 8h workday OR 24h calendar day (per-board setting)
- Auto-refresh when settings change (selective cache invalidation)
- Optimized batch queries for board statistics
- Advanced caching with race condition protection (v3.1)

## Architecture

### Three-Layer Storage Architecture

The Power-Up uses a carefully optimized data flow to minimize API calls:

1. **Supabase Database** (PostgreSQL with REST API)
   - Primary data store with four tables: `boards`, `board_settings`, `cards`, `time_entries`
   - `cards` table stores **pre-aggregated totals** in `time_minutes` field
   - Individual time entries stored in `time_entries` with `time_minutes` field
   - `board_settings` stores per-board `hours_per_day` configuration (8 or 24)
   - Legacy `total_days`/`total_hours`/`total_minutes` columns in `cards` and
     `days`/`hours`/`minutes` columns in `time_entries` still exist in the schema (DEFAULT 0)
     but are no longer selected, written, or read by the code. Safe to drop — see `TODO.md`.

2. **In-Memory Cache** (`supabase-api.js`) - **v3.1 Multi-Level Caching**
   - **Card Data Cache**: TTL-based (60s) for individual card time data
   - **Board ID Cache**: Cached mapping of `trelloBoardId → supabaseBoardId` (60s)
   - **Board Settings Cache**: Cached `hours_per_day` per board (60s)
   - **Race Condition Protection**: Promise deduplication prevents parallel duplicate requests
   - **Selective Invalidation**: Settings changes only clear settings cache, not card data
   - **Settings-aware**: Checks `board.shared.tnm-settings-updated` timestamp
   - Cleared on page reload and after mutations
   - **Why not localStorage**: No quota limits, no stale data persistence, automatic cleanup

3. **Badge Display Optimization**
   - Badge rendering fetches **only `time_minutes`** from `cards` table
   - Full history (from `time_entries`) loaded only when card detail popup opens
   - Settings fetched once and cached for conversion to d/h/m display
   - This reduces API calls by ~3x on board load

### File Structure

```
js/
├── client.js         - Trello Power-Up initialization and capability definitions
├── storage.js        - Abstraction layer between Trello context and Supabase API
├── supabase-api.js   - Direct Supabase REST API client with caching
└── board-members.js  - Board member utilities

views/
├── card-detail.html    - Time entry form (popup when clicking T&M button)
├── card-back.html      - Summary displayed on card back
├── board-stats.html    - Board statistics with period filtering
├── export-time.html    - CSV export interface
└── settings.html       - Display settings (8h/24h) + cache management buttons
```

### Data Flow Examples

**Opening a board with 10 cards** (badge display) - **v3.1 Optimized**:
```
First card:
  getCardDataForBadge()
    → checkSettingsUpdate() - check timestamp (no API call if unchanged)
    → GET /cards?select=time_minutes&trello_card_id=eq.{id}
    → getBoardSettings() (cold) — internally calls getBoardId() first:
        → GET /boards?select=id&trello_board_id=eq.{id}
        → GET /board_settings?select=hours_per_day&board_id=eq.{id}

Remaining 9 cards (parallel):
  getCardDataForBadge()
    → checkSettingsUpdate() - uses cached timestamp
    → GET /cards?select=time_minutes&trello_card_id=eq.{id}
    → getBoardSettings() - waits for first card's promise, then uses cache (no API call)

✓ Total: 10 card requests + 1 board ID + 1 settings = 12 requests (was 30!)
```

**Opening card detail popup** (typically warm cache — settings already cached from badges):
```
getCardDataFull()
  → checkSettingsUpdate() - check if settings changed (Trello local read, no HTTP)
  → GET /cards?select=id,trello_card_id,time_minutes&trello_card_id=eq.{id}
  → GET /time_entries?select=time_minutes,description,work_date,...&card_id=eq.{card_id}&order=created_at.desc
  → getBoardSettings() - cache hit, no HTTP
  ✓ Full history with all details (2 requests warm / up to 4 cold)
```

**Adding a time entry**:
```
addTimeRecord(days, hours, minutes)
  → ensureCardWithBoard() if needed
  → GET /board_settings - get hours_per_day for conversion
  → Convert to minutes: totalMinutes = (days × hoursPerDay × 60) + (hours × 60) + minutes
  → POST /time_entries (with time_minutes, Prefer: return=minimal header)
  → updateCardTotalTime()
    → GET /time_entries?select=time_minutes&card_id=eq.{id}
    → Sum all time_minutes
    → PATCH /cards (update time_minutes aggregate)
  → invalidateCardCache()
```

**Board statistics (optimized v3.2)**:
```
getBoardStats(startDate, endDate)
  → GET /boards?select=id&trello_board_id=eq.{id}                                    (cached after 1st call)
  → GET /time_entries?select=time_minutes,member_name,card_id,cards!inner(id)
        &cards.board_id=eq.{board_id}&work_date=gte.{start}&work_date=lte.{end}
  ✓ Single PostgREST embedded JOIN — no separate /cards fetch, no in.(cardIds), no URL length limit.
  ✓ 2 requests cold / 1 request warm (was 3 / 2 before v3.2).
```

## Critical Implementation Details

### 1. Minute-Based Storage System (v3.0)

**Core Concept**: All time is stored as minutes internally, converted to d/h/m only for display.

**Storage**:
```javascript
// When adding time:
totalMinutes = (days × hoursPerDay × 60) + (hours × 60) + minutes

// Example with 8h mode: "1d 2h 30m"
totalMinutes = (1 × 8 × 60) + (2 × 60) + 30 = 630 minutes

// Example with 24h mode: "1d 2h 30m"
totalMinutes = (1 × 24 × 60) + (2 × 60) + 30 = 1590 minutes
```

**Display**:
```javascript
// storage.js: formatTime(totalMinutes, hoursPerDay)
const minutesPerDay = hoursPerDay × 60;
const days = Math.floor(totalMinutes / minutesPerDay);
const remaining = totalMinutes % minutesPerDay;
const hours = Math.floor(remaining / 60);
const minutes = remaining % 60;

// Example: 630 minutes with 8h mode → "1d 2h 30m"
// Example: 630 minutes with 24h mode → "0d 10h 30m"
```

**Why this approach?**
- Single source of truth (minutes in DB)
- Switch display modes without data migration
- No data loss when changing settings
- Simple aggregation (just sum minutes)
- Future-proof (can add decimal hours, etc.)

### 2. Board Settings and Cache Invalidation

**Settings storage**: Per-board `hours_per_day` in `board_settings` table

**Auto-refresh mechanism** (v3.1 - Selective Invalidation):
```javascript
// When settings change (settings.html):
await TnMStorage.updateBoardSettings(t, hoursPerDay);
// Internally calls: this._boardSettingsCache.delete(`settings_${trelloBoardId}`)
await t.set('board', 'shared', 'tnm-settings-updated', Date.now());
// NO clearCache() - card data remains cached!

// On every badge/card data fetch:
async checkSettingsUpdate(t) {
  const timestamp = await t.get('board', 'shared', 'tnm-settings-updated', 0);
  if (timestamp > this._lastSettingsUpdate) {
    this._lastSettingsUpdate = timestamp;
    // Only clear settings cache, card data stays cached
    this._boardSettingsCache.clear();
    this._boardSettingsPromises.clear();
  }
}
```

**Result**:
- Badges update instantly when switching 8h ↔ 24h mode
- Card data (`time_minutes`) stays cached - only settings are refreshed
- Switching modes: 1 API request instead of ~10+

### 3. Why Aggregates in `cards` Table?

Instead of calculating totals on-the-fly, we store pre-aggregated `time_minutes`:

**Pros:**
- Fast badge rendering (1 query vs 2)
- Works efficiently with hundreds of entries per card
- Reduced API calls on board load

**Trade-off:**
- Must keep aggregates in sync via `updateCardTotalTime()` after every mutation
- Called automatically after add/delete operations

Implementation in `supabase-api.js:updateCardTotalTime()`:
```javascript
// V3.0: Simple sum of minutes
const entries = await GET /time_entries?select=time_minutes&card_id=eq.{id}
let totalMinutes = 0;
entries.forEach(entry => totalMinutes += entry.time_minutes || 0);
await PATCH /cards?id=eq.{id} (time_minutes = totalMinutes)
```

### 4. Card Uniqueness

`trello_card_id` is globally unique in Trello, so we can:
- Fetch cards without knowing `board_id`
- Use single-field index for fast lookups

`board_id` is only needed when **creating** new card records (foreign key constraint).

### 5. Cache Invalidation Pattern

After every mutation:
```javascript
// 1. Update aggregates in database
await SupabaseAPI.updateCardTotalTime(card.id);
// 2. THEN invalidate cache
this.invalidateCardCache(trelloCardId);
```

**Why this order?** Ensures next cache miss fetches already-updated data.

### 6. Duplicate Entry Prevention

Time entries use `trello_entry_id` (timestamp) with `UNIQUE(card_id, trello_entry_id)` constraint to prevent duplicates during race conditions.

### 7. Race Condition Protection (v3.1)

**Problem**: When multiple cards load simultaneously, they all request the same board settings in parallel before the first request completes and caches the result.

**Solution**: Promise deduplication pattern

```javascript
// In getBoardId() and getBoardSettings():
async getBoardSettings(trelloBoardId) {
  const cacheKey = `settings_${trelloBoardId}`;

  // Check cache first
  const cached = this._boardSettingsCache.get(cacheKey);
  if (cached && this.isCacheValid(cached.timestamp, this.CARD_DATA_TTL)) {
    return cached.settings;
  }

  // Check if request already in progress
  const existingPromise = this._boardSettingsPromises.get(cacheKey);
  if (existingPromise) {
    console.log('Waiting for existing request...');
    return existingPromise; // Wait for the ongoing request
  }

  // Create new request promise
  const promise = (async () => {
    try {
      const result = await this.fetchSettings(...);
      this._boardSettingsCache.set(cacheKey, { settings: result, timestamp: Date.now() });
      return result;
    } finally {
      this._boardSettingsPromises.delete(cacheKey); // Cleanup
    }
  })();

  this._boardSettingsPromises.set(cacheKey, promise);
  return promise;
}
```

**Benefit**: 10 parallel card loads make **1 request** instead of 10 duplicate requests

### 8. Optimized Board Statistics (v3.2)

Statistics aggregate `time_entries` (totals, active cards, contributors) — no card-level data is needed in the response. PostgREST's embedded resource filter lets us push the board-membership check to the server without a separate `/cards` round-trip and without the `in.(cardIds)` URL-length limit.

**Evolution**:
- v2.x — N requests (one per card, sequential)
- v3.0 — 3 requests via `card_id=in.(cardIds)` after fetching `/cards` first
- **v3.2 — 1 request (warm) via embedded JOIN**:

```javascript
const timeEntries = await GET
  /time_entries
    ?select=time_minutes,member_name,card_id,cards!inner(id)
    &cards.board_id=eq.{boardId}
    &work_date=gte.{start}&work_date=lte.{end}
// `cards!inner(id)` = INNER JOIN trigger (id is throwaway, response stays compact)
// `cards.board_id=eq.X` = filter on the embedded resource
```

**Benefits over v3.0**:
- Removes the separate `/cards` fetch entirely (stats don't need the card list — empty cards contribute zero anyway)
- No `in.(cardIds)` ⇒ no URL length limit, scales to boards of any size
- Empty board / empty period → `entries=[]` → naturally zeroed-out result, no special early-return needed

The same embedded-JOIN pattern is used in `getAllDataForExport()` (with a parallel `/cards` fetch — export needs to list empty cards for the "Include empty" toggle).

## Deployment

The Power-Up is hosted on **Cloudflare Pages** at `https://trello-tnm-powerup.pages.dev/`

### Making Changes

1. **No build step required** - pure HTML/CSS/vanilla JavaScript
2. Cloudflare Pages auto-deploys from git repository
3. Changes are live immediately after push
4. **Important**: Browser caching may delay updates - use versioned URLs for critical changes

### Supabase Configuration

Credentials in `js/supabase-api.js`:
```javascript
SUPABASE_URL: 'https://tpzbvdyxmzqweoghtgzp.supabase.co'
SUPABASE_ANON_KEY: 'eyJhbGci...' // Anon key (safe for client-side)
```

## Performance Notes

**Current metrics** (after v3.1 optimizations):
- Opening board with 10 cards: **12 requests** (was 30 before v3.1, was 48 before v3.0)
  - 10 × `/cards` (one per card)
  - 1 × `/boards` (cached across all cards)
  - 1 × `/board_settings` (cached across all cards)
- Opening card detail: **2 requests** with warm cache (settings already cached from badges); up to 4 with fully cold cache. Was 4 before v3.0.
- Board statistics: **1 request warm / 2 cold** (was 3 in v3.0–v3.1, was N+2 before v3.0)
- Export (any board size): **2 parallel requests** (was N+1 sequential before v3.2)
- Changing settings (8h ↔ 24h): **1 request** (was ~11 before v3.1)
- Cache TTL: 60 seconds for all caches
- Settings change: selective cache invalidation (only settings, not card data)

**Performance techniques used**:
- **Multi-level caching** (card data, board ID, board settings)
- **Promise deduplication** to prevent parallel duplicate requests
- **Selective cache invalidation** (settings don't invalidate card data)
- Minute-based storage (simple sum aggregation)
- Selective field queries (`?select=field1,field2`)
- `Prefer: return=minimal` header on mutations
- Separate methods for badge vs. full data
- PostgREST embedded resource filters (`cards!inner(...) + cards.board_id=eq.X`) for statistics and export — server-side JOIN, no `in.(ids)` URL bloat
- Settings-aware caching with timestamp tracking

**Optimization Impact**:
| Operation | Before v3.0 | v3.0 | v3.1 | Improvement |
|-----------|-------------|------|------|-------------|
| Open board (10 cards) | 48 requests | 30 requests | **12 requests** | **75% reduction** |
| Change settings | N/A | ~11 requests | **1 request** | **90% reduction** |

## Common Tasks

### Testing Locally

1. Update `manifest.json` to point to local server:
   ```json
   "connectors": {
     "iframe": {
       "url": "http://localhost:8000/"
     }
   }
   ```

2. Serve locally:
   ```bash
   python3 -m http.server 8000
   ```

3. In Trello Power-Up Admin, update iframe connector URL

### Debugging

**Enable console logging** - all API calls log to browser console:
- `Fetching fresh badge data for {cardId}`
- `Using cached badge data for {cardId}`
- `Card cache invalidated for {cardId}`

**Common issues**:
- **Badges not updating after adding time**: Check if `updateCardTotalTime()` was called after mutation
- **Stale data after operations**: Verify cache invalidation happens after DB update
- **Display not updating after settings change**: Check `checkSettingsUpdate()` is called and `tnm-settings-updated` timestamp is set
- **Wrong time display in badges**: Verify `hours_per_day` from board_settings is being used in `formatTime()`
- **Duplicate entries**: Check `trello_entry_id` uniqueness constraint
- **Too many API requests on board load**: Check console logs for "Using cached" vs "Fetching fresh" - should see cache hits for board ID and settings
- **Race condition symptoms**: If you see multiple "Fetching fresh board ID" logs for the same board, the promise deduplication may not be working

### Updating Supabase Schema

If modifying database schema:
1. Run migrations directly in Supabase SQL Editor
2. Update corresponding TypeScript-like interfaces in code comments
3. Test with existing data for backwards compatibility

## Code Style

- Pure vanilla JavaScript (no build tools, no frameworks)
- ES6+ async/await throughout
- All view files are self-contained HTML with inline scripts
- Supabase calls use REST API (not client library)

## Migration Notes

### Version 3.0 Migration (d/h/m → minutes)

**Database changes**:
1. Added `time_minutes` field to `cards` and `time_entries` tables
2. Added `board_settings` table with `hours_per_day` constraint (8 or 24)
3. Changed `trello_board_id` type from TEXT to UUID in `boards` table
4. Migrated all existing data: `time_minutes = (days × 8 × 60) + (hours × 60) + minutes`
5. Kept legacy `total_days`/`total_hours`/`total_minutes` columns in `cards` and `days`/`hours`/`minutes` columns in `time_entries` for backward compatibility (no longer touched by code — pending DB cleanup, see `TODO.md`)

**Code changes**:
- All storage/display now uses `time_minutes` + `hours_per_day` parameter
- Added `checkSettingsUpdate()` for cache invalidation on settings change
- Optimized `getBoardStats()` to use batch `in.(cardIds)` query
- Added `formatTime()` and `parseTimeToMinutes()` utilities in `storage.js`

**Future cleanup** (see `TODO.md`):
- ✅ Stopped selecting legacy `total_*` columns in `ensureCard*()` queries
- Drop legacy `total_days`/`total_hours`/`total_minutes` columns from `cards` table
- Drop legacy `days`/`hours`/`minutes` columns from `time_entries` table

### Version 3.1 (January 2026) - Advanced Caching & Race Condition Protection

**No database changes** - pure optimization of API client layer

**Code changes**:
1. Added **multi-level caching**:
   - `_boardIdCache` - caches `trelloBoardId → supabaseBoardId` mapping
   - `_boardSettingsCache` - caches board settings (`hours_per_day`)
   - Both with 60-second TTL, same as card data cache

2. Added **promise deduplication** (race condition protection):
   - `_boardIdPromises` - tracks in-flight board ID requests
   - `_boardSettingsPromises` - tracks in-flight settings requests
   - When multiple cards request same data simultaneously, they wait for the first request instead of making duplicates

3. **Selective cache invalidation**:
   - `checkSettingsUpdate()` now only clears settings cache, not card data
   - `updateBoardSettings()` only invalidates settings cache
   - `settings.html` no longer calls `clearCache()` on settings update

4. Created **`getBoardId()` helper method**:
   - Centralized board ID lookup with caching
   - Used by `ensureCardWithBoard()`, `getBoardSettings()`, `getAllDataForExport()`, `getBoardStats()`

**Performance impact**:
- Opening board: 30 → 12 requests (60% reduction)
- Changing settings: ~11 → 1 request (90% reduction)
- No more duplicate parallel requests

**Files modified**:
- `js/supabase-api.js` - all caching improvements
- `views/settings.html` - removed redundant `clearCache()` call

### Version 2.0 Removed

**Legacy code removed**:
- Trello Storage fallback (was used before Supabase)
- Migration code (`migrateCardToSupabase`)
- Data compression utilities
- `USE_SUPABASE` feature flag (always true now)

## Key Files to Understand

When making changes, read these files in order:

1. `js/supabase-api.js` - Core API client, caching strategy, database operations
2. `js/storage.js` - Abstraction layer, data formatting utilities
3. `js/client.js` - Power-Up capabilities and Trello integration
4. `views/card-detail.html` - Main UI for time entry
5. `README.md` - User-facing documentation and troubleshooting
