# T&M Power-Up for Trello

This is a Power-Up for Trello that allows you to track time spent on cards with automatic cloud synchronization via Supabase.

## Features

- ⏱️ Track time spent on tasks in a convenient format (1d 2h 30m)
- 📅 Select work date via calendar
- 👥 Select user on behalf of whom time will be added (current user by default)
- 📝 History of all entries with user and date indication
- 🗑️ Ability to delete time entries from history
- 📊 Export time tracking data to CSV file with date filtering
- 🔄 Automatic data migration from Trello Storage to Supabase
- 🔧 Complete reset of all data on the board if needed
- 💰 Hourly rate settings
- 🏷️ Display badges with time spent on cards
- 📋 Display time summary on the back of the card
- 🔄 Button for forced Power-Up update (cache clearing)
- ☁️ Cloud storage via Supabase for reliable data persistence
- 🔄 Force migration button for troubleshooting sync issues

## Installation

1. Clone the repository
2. Host files on GitHub Pages or another web server
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

### Data Migration & Troubleshooting

The Power-Up automatically migrates data from Trello Storage to Supabase cloud storage. If you encounter issues:

1. **Empty history after opening card**: If you see "Migration check: Local X entries, Supabase 0 entries" in console but no data appears:
    - A yellow "Data Migration" section will appear in the Time tab
    - Click "Force Data Migration" to manually trigger migration
    - Wait for migration to complete and data will be synchronized

2. **Failed initial migration**: If migration times out or fails:
    - Open the card again
    - Look for the migration section with the yellow warning
    - Click "Force Data Migration" to retry
    - Migration status will show progress

### Exporting Time Tracking Data

1. Click the "Export T&M" button on the board toolbar
2. Specify date range for filtering (last month is set by default)
3. Optionally disable the "Include cards without time tracking data" option
4. Click the "Export to CSV" button
5. The CSV file will be automatically downloaded to your computer
6. File format: "date","task","user","time spent","time spent (minutes)","work description"
7. The "time spent (minutes)" column contains total time converted to minutes for easy processing in Excel

### Managing Data & Settings

- **Clear cache**: Click the "Settings" button on the board toolbar → "Clear Cache and Reload"
- **View storage statistics**: Go to Settings → "View Storage Statistics"
- **Complete data reset**: Go to Settings → "Delete All Data" (⚠️ irreversible!)
- **Supabase integration**: Data is automatically stored in Supabase cloud storage for reliability

## Updating the Power-Up

If you see an outdated version of the Power-Up after updating the code:

1. Click the "Settings" button on the board toolbar
2. In the opened window, click "Clear Cache and Reload"
3. Reload the board page (Ctrl+F5 or Cmd+Shift+R)

## Development

### File Structure

- `index.html` - Entry point and Power-Up initialization
- `js/client.js` - Main Power-Up logic and Trello integration
- `js/storage.js` - Data storage utilities (Supabase + Trello Storage)
- `js/supabase-api.js` - Supabase cloud storage API
- `js/board-members.js` - Board member utilities
- `views/card-detail.html` - Card time tracking interface
- `views/card-back.html` - Card back summary display
- `views/settings.html` - Power-Up settings and management
- `views/export-time.html` - CSV data export interface
- `views/storage-stats.html` - Storage usage statistics
- `css/style.css` - Styling for all views

### Technical Details

The Power-Up uses a hybrid storage approach:

**Supabase Cloud Storage (Primary)**:
- Time entries stored in `time_entries` table
- Card summaries in `cards` table
- Board information in `boards` table
- Automatic data migration from Trello Storage

**Trello Storage (Fallback)**:
- Legacy data storage for backwards compatibility
- Used during migration process
- Compressed data format to save space

### Data Structure

```sql
-- Supabase Tables
boards (
  id SERIAL PRIMARY KEY,
  trello_board_id TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

cards (
  id SERIAL PRIMARY KEY,
  trello_card_id TEXT,
  board_id INTEGER REFERENCES boards(id),
  total_days INTEGER DEFAULT 0,
  total_hours INTEGER DEFAULT 0,
  total_minutes INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(trello_card_id, board_id)
);

time_entries (
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

### Time Calculation
- 1 day (d) = 8 working hours
- 1 hour (h) = 60 minutes
- When adding time, normalization is automatically performed:
 - 60 minutes = 1 hour
 - 8 hours = 1 day

## Migration Process

The Power-Up automatically handles data migration:

1. **Initial Load**: Checks if card has Supabase data
2. **Legacy Detection**: If local Trello Storage data exists with more entries than Supabase
3. **Auto Migration**: Attempts to migrate data automatically using timestamp IDs for deduplication
4. **Manual Fallback**: If auto-migration fails, shows "Force Data Migration" button
5. **Conflict Resolution**: Uses timestamp IDs to prevent duplicate entries

## Troubleshooting

### Common Issues

**Empty time history after opening card**:
- Check browser console for "Migration check" messages
- Look for yellow migration section in the Time tab
- Click "Force Data Migration" if available

**Migration timeouts**:
- Large datasets may timeout during initial migration
- Use "Force Data Migration" button to retry in smaller batches
- Check Supabase logs for detailed error information

**Data not syncing**:
- Verify Supabase connection in browser console
- Check network connectivity
- Clear cache and reload Power-Up

**Storage limit warnings**:
- Use "View Storage Statistics" to check usage
- Run "Optimize Storage" to compress legacy data
- Consider cleaning up old entries

## TODO

- [x] Add export of time tracking data to CSV
- [x] Add Supabase cloud storage integration
- [x] Add automatic data migration from Trello Storage
- [x] Add force migration for troubleshooting
- [x] Add storage statistics and optimization
- [ ] Add versioning in URL to prevent caching issues
- [ ] Add ability to filter by users in export
- [ ] Improve mobile support
- [ ] Add support for different date and time formats
- [ ] Add support for decimal time input (e.g., 2.5d should convert to 2d 4h)
- [ ] Add automatic data backup from Supabase
- [ ] Add rate calculation and billing features
- [ ] Add team management and permissions
- [ ] Add advanced reporting and analytics

## Configuration

### Supabase Setup

1. Create a new project at https://supabase.com
2. Run the SQL schema from the Technical Details section
3. Update `js/supabase-api.js` with your project credentials:

```javascript
SUPABASE_URL: 'your-project-url',
SUPABASE_ANON_KEY: 'your-anon-key'

### Environment Variables

The Power-Up automatically detects the environment and switches between:
- **Production**: Full Supabase integration with auto-migration
- **Development**: Local storage fallback for testing

## Support

For issues, feature requests, or questions:
- Create an issue on GitHub
- Email: zelyakin@gmail.com
- Check the troubleshooting section above

## Privacy & Data

- All time tracking data is stored securely in Supabase cloud storage
- Data is encrypted in transit and at rest
- Only board members can access time tracking data for their boards
- No personal data is shared with third parties
- See `privacy-policy.html` for complete privacy policy