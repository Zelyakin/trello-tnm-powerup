# T&M Power-Up for Trello

This is a Power-Up for Trello that allows you to track time spent on cards with cloud synchronization via Supabase.

## Features

- ⏱️ Track time spent on tasks in a convenient format (1d 2h 30m)
- 📅 Select work date via calendar
- 👥 Select user on behalf of whom time will be added (current user by default)
- 📝 History of all entries with user and date indication
- 🗑️ Ability to delete time entries from history
- 📊 Export time tracking data to CSV file with date filtering
- ☁️ Cloud storage via Supabase for reliable data persistence
- 🏷️ Display badges with time spent on cards
- 📋 Display time summary on the back of the card
- 🔄 Cache clearing and Power-Up refresh
- 📈 Board statistics with period filtering
- ⚡ Optimized API calls for fast loading

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
   - Note: 1 day = 8 hours of work time
6. View time summary on the back of the card
7. If needed, delete incorrect entries using the "Delete" button in the "History" section

### Exporting Time Tracking Data

1. Click the "Export T&M" button on the board toolbar
2. Specify date range for filtering (last month is set by default)
3. Optionally disable the "Include cards without time tracking data" option
4. Click the "Export to CSV" button
5. The CSV file will be automatically downloaded to your computer
6. File format: "date","task","user","time spent","time spent (minutes)","work description"
7. The "time spent (minutes)" column contains total time converted to minutes for easy processing in Excel

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

- **Clear cache**: Click the "Settings" button on the board toolbar → "Clear Cache and Reload"
- **Clear API cache**: Settings → "Clear API Cache" (clears Supabase cache without reloading)
- **View storage statistics**: Go to Settings → "View Storage Statistics"
- **Complete data reset**: Go to Settings → "Delete All Data" (⚠️ irreversible!)

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
│   ├── board-stats.html       # Board statistics
│   └── storage-stats.html     # Storage usage statistics (legacy)
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
  id SERIAL PRIMARY KEY,
  trello_board_id TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Cards table with aggregated time
CREATE TABLE cards (
  id SERIAL PRIMARY KEY,
  trello_card_id TEXT UNIQUE NOT NULL,
  board_id INTEGER REFERENCES boards(id),
  total_days INTEGER DEFAULT 0,
  total_hours INTEGER DEFAULT 0,
  total_minutes INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Time entries table
CREATE TABLE time_entries (
  id SERIAL PRIMARY KEY,
  card_id INTEGER REFERENCES cards(id),
  trello_member_id TEXT,
  member_name TEXT,
  days INTEGER DEFAULT 0,
  hours INTEGER DEFAULT 0,
  minutes INTEGER DEFAULT 0,
  description TEXT,
  work_date DATE,
  trello_entry_id BIGINT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(card_id, trello_entry_id)
);

-- Indexes for performance
CREATE INDEX idx_cards_trello_card_id ON cards(trello_card_id);
CREATE INDEX idx_time_entries_card_id ON time_entries(card_id);
CREATE INDEX idx_time_entries_work_date ON time_entries(work_date);
```

### Time Calculation

- 1 day (d) = 8 working hours
- 1 hour (h) = 60 minutes
- When adding time, normalization is automatically performed:
   - 60 minutes = 1 hour
   - 8 hours = 1 day

### Performance Optimizations

The Power-Up implements several optimizations for fast loading:

1. **Smart data fetching**: Badge display uses only aggregated time (`total_days`, `total_hours`, `total_minutes`) without loading full history
2. **In-memory caching**: API responses are cached with TTL:
   - Badge data: 60 seconds
   - Board data: 5 minutes (legacy, minimal usage)
3. **Request deduplication**: Protection against simultaneous identical requests
4. **Selective field queries**: Only necessary fields are fetched from Supabase
5. **Minimal return preferences**: Write operations use `Prefer: return=minimal` header

**Performance metrics:**
- Opening board with 16 cards: **16 requests** (was 48)
- Opening card: **2 requests** (was 4)
- Opening time entry popup: **2 requests** (was 4)

### API Call Flow

**Opening board (badge display):**
```
For each visible card:
└─ getCardDataForBadge()
   └─ GET /cards?select=total_days,total_hours,total_minutes&trello_card_id=eq.{id}
      ✅ Only aggregates, NO time_entries history
```

**Opening card detail:**
```
1. getCardData()
   ├─ GET /cards?select=id,trello_card_id,total_days,total_hours,total_minutes&trello_card_id=eq.{id}
   └─ GET /time_entries?select=...&card_id=eq.{card_id}&order=created_at.desc
      ✅ Full history with all details
```

**Adding time entry:**
```
1. ensureCardWithBoard()  (if card doesn't exist)
   ├─ GET /cards?select=id,...&trello_card_id=eq.{id}
   └─ (if needed) GET /boards + POST /boards + POST /cards
2. POST /time_entries
3. updateCardTotalTime()
   ├─ GET /time_entries?select=days,hours,minutes&card_id=eq.{id}
   └─ PATCH /cards?id=eq.{id}
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

### Environment Variables

The Power-Up is configured for production use with Supabase cloud storage.

## Architecture Decisions

### Why separate aggregates in cards table?

Instead of calculating totals on-the-fly from `time_entries`, we store aggregated values (`total_days`, `total_hours`, `total_minutes`) in the `cards` table:

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
- If badges don't update, try clearing cache: Settings → "Clear Cache and Reload"
- Check browser console for API errors

**Slow board loading**:
- First load fetches data from Supabase (16 requests for 16 cards)
- Subsequent loads use cache (0 requests for 60 seconds)
- Check network tab for failed requests

**Data not syncing**:
- Verify Supabase connection in browser console
- Check network connectivity
- Clear API cache: Settings → "Clear API Cache"

**Storage limit warnings** (legacy Trello Storage):
- No longer applicable - all data stored in Supabase
- Old storage statistics view kept for reference

## Changelog

### Version 2.0 (Current)

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

- [ ] Batch API calls for board loading (1 request for all cards instead of N)
- [ ] Add versioning in URL to prevent caching issues
- [ ] Add ability to filter by users in export
- [ ] Improve mobile support
- [ ] Add support for different date and time formats
- [ ] Add support for decimal time input (e.g., 2.5d → 2d 4h)
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