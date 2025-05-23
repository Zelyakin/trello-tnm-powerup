# T&M Power-Up for Trello

This is a Power-Up for Trello that allows you to track time spent on cards.

## Features

- Track time spent on tasks in a convenient format (1d 2h 30m)
- Select work date via calendar
- Select user on behalf of whom time will be added (current user by default)
- History of all entries with user and date indication
- Ability to delete time entries from history
- Export time tracking data to CSV file with date filtering
- Complete reset of all data on the board if needed
- Hourly rate settings
- Display badges with time spent on cards
- Display time summary on the back of the card
- Button for forced Power-Up update (cache clearing)

## Installation

1. Clone the repository
2. Host files on GitHub Pages or another web server
3. Register the Power-Up in Trello Power-Up Admin: https://trello.com/power-ups/admin
4. Add the Power-Up to your Trello board

## Usage

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

### Managing Data

- To clear cache and update the Power-Up, click the "Update T&M" button on the board toolbar
- To completely reset all data on the board, click the "Delete All Data" button in the same dialog (be careful, this action is irreversible!)

## Updating the Power-Up

If you see an outdated version of the Power-Up after updating the code:

1. Click the "Update T&M" button on the board toolbar
2. In the opened window, click "Clear Cache and Reload"
3. Reload the board page (Ctrl+F5 or Cmd+Shift+R)

## Development

- Use `index.html` as the entry point
- Main code is in `js/client.js`
- Storage utilities in `js/storage.js`
- Board member utilities in `js/board-members.js`
- Card interface in `views/card-detail.html`
- Card back display in `views/card-back.html`
- Power-Up settings in `views/settings.html`
- Cache clearing and data reset in `views/clear-cache.html`
- CSV data export in `views/export-time.html`

## Technical Details

The Power-Up uses Trello storage to save data:
- Card data is stored in 'card', 'shared', 'tnm-data'
- Copies of card data are also stored in 'board', 'shared', 'tnm-card-data-[cardId]'
- Board settings are stored in 'board', 'shared', 'tnm-settings'
- Cache version marker is stored in 'board', 'shared', 'tnm-cache-version'
- List of card IDs with data is stored in 'board', 'shared', 'tnm-known-card-ids'

### Time Calculation
- 1 day (d) = 8 working hours
- 1 hour (h) = 60 minutes
- When adding time, normalization is automatically performed:
    - 60 minutes = 1 hour
    - 8 hours = 1 day

## TODO

- [x] Add export of time tracking data to CSV
- [ ] Add versioning in URL to prevent caching issues
- [ ] Add ability to filter by users
- [ ] Improve mobile support
- [ ] Add support for different date and time formats
- [ ] Add support for decimal time input (e.g., 2.5d should convert to 2d 4h)
- [ ] Implement automatic data backup
- [ ] Add rate calculation

## Data Structure

```javascript
// Card data structure
{
  days: 0, // Days (1 day = 8 hours)
  hours: 2, // Hours
  minutes: 30, // Minutes
  history: [
    {
      id: 1620000000001,
      type: "time",
      days: 0,
      hours: 2,
      minutes: 30,
      description: "Work on task",
      date: "2025-05-11T14:30:00.000Z", // Actual date of adding the entry
      workDate: "2025-05-10T00:00:00.000Z", // Work date selected in calendar
      memberId: "user123",
      memberName: "John Doe"
    }
  ]
}

// Board settings structure
{
  hourlyRate: 1500,
  currency: "USD"
}