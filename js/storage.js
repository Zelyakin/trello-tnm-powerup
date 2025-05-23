/* Utilities for working with Trello storage */

const TnMStorage = {
// Get T&M data for card
    getCardData: function(t) {
        return Promise.all([
            t.get('card', 'shared', 'tnm-data', {
                days: 0,
                hours: 0,
                minutes: 0,
                history: []
            }),
            t.get('board', 'shared', 'tnm-global-reset-timestamp', 0),
            t.get('card', 'shared', 'tnm-last-reset-check', 0)
        ])
            .then(function([data, globalResetTime, lastResetCheck]) {
                // If there was a global reset after this card was last checked, clear its data
                if (globalResetTime > lastResetCheck) {
                    console.log('Clearing card data due to global reset');
                    const emptyData = {
                        days: 0,
                        hours: 0,
                        minutes: 0,
                        history: []
                    };

                    // Save empty data and update reset check timestamp
                    return Promise.all([
                        t.set('card', 'shared', 'tnm-data', emptyData),
                        t.set('card', 'shared', 'tnm-last-reset-check', Date.now())
                    ]).then(function() {
                        return emptyData;
                    });
                }

                // After getting data, sync it with board storage
                t.card('id').then(function(card) {
                    TnMStorage.syncCardDataWithBoard(t, card.id, data);
                });
                return data;
            });
    },

    // Save T&M data for card
    saveCardData: function(t, data) {
        return t.set('card', 'shared', 'tnm-data', data).then(function() {
            // After saving data, sync it with board storage
            return t.card('id').then(function(card) {
                return TnMStorage.syncCardDataWithBoard(t, card.id, data);
            });
        });
    },

    // Sync card data with board storage
    syncCardDataWithBoard: function(t, cardId, data) {
        // Save card data in special key at board level
        return t.set('board', 'shared', `tnm-card-data-${cardId}`, data)
            .then(function() {
                // Add card ID to list of known cards
                return t.get('board', 'shared', 'tnm-known-card-ids', []);
            })
            .then(function(knownCardIds) {
                if (!knownCardIds.includes(cardId)) {
                    knownCardIds.push(cardId);
                    return t.set('board', 'shared', 'tnm-known-card-ids', knownCardIds);
                }
                return Promise.resolve();
            });
    },

    // Get card data from board storage
    getCardDataFromBoard: function(t, cardId) {
        return t.get('board', 'shared', `tnm-card-data-${cardId}`, null);
    },

    // Get list of IDs of all known cards with data
    getKnownCardIds: function(t) {
        return t.get('board', 'shared', 'tnm-known-card-ids', []);
    },

    // Add time record
    addTimeRecord: function(t, days, hours, minutes, description, workDate) {
        // Get info about current user
        return t.member('id', 'fullName', 'username')
            .then(function(member) {
                return TnMStorage.getCardData(t)
                    .then(function(data) {
                        // Create new record with user info
                        const newRecord = {
                            id: Date.now(),
                            type: 'time',
                            days: parseInt(days) || 0,
                            hours: parseInt(hours) || 0,
                            minutes: parseInt(minutes) || 0,
                            description: description,
                            date: new Date().toISOString(), // Actual add date
                            workDate: workDate ? new Date(workDate).toISOString() : null, // Work date
                            memberId: member.id,
                            memberName: member.fullName || member.username
                        };

                        // Update total time
                        data.days = (parseInt(data.days) || 0) + parseInt(days || 0);
                        data.hours = (parseInt(data.hours) || 0) + parseInt(hours || 0);
                        data.minutes = (parseInt(data.minutes) || 0) + parseInt(minutes || 0);

                        // Normalize values (60 minutes = 1 hour, 8 hours = 1 day)
                        while (data.minutes >= 60) {
                            data.minutes -= 60;
                            data.hours += 1;
                        }

                        while (data.hours >= 8) {
                            data.hours -= 8;
                            data.days += 1;
                        }

                        // Add record to history
                        if (!data.history) data.history = [];
                        data.history.push(newRecord);

                        // Save updated data
                        return TnMStorage.saveCardData(t, data);
                    });
            });
    },

    // Delete time record
    deleteTimeRecord: function(t, recordId) {
        return TnMStorage.getCardData(t)
            .then(function(data) {
                // Find record to delete
                const recordIndex = data.history.findIndex(record => record.id === recordId);

                if (recordIndex === -1) {
                    throw new Error('Record not found');
                }

                // Get record before deletion
                const record = data.history[recordIndex];

                // Subtract time from total time
                data.days = Math.max(0, (parseInt(data.days) || 0) - (parseInt(record.days) || 0));
                data.hours = Math.max(0, (parseInt(data.hours) || 0) - (parseInt(record.hours) || 0));
                data.minutes = Math.max(0, (parseInt(data.minutes) || 0) - (parseInt(record.minutes) || 0));

                // Normalize values in case of negative minutes or hours
                // (can happen when deleting a record if there were rounding)
                while (data.minutes < 0) {
                    data.minutes += 60;
                    data.hours -= 1;
                }

                while (data.hours < 0) {
                    data.hours += 8;
                    data.days -= 1;
                }

                // Remove record from history
                data.history.splice(recordIndex, 1);

                // Save updated data
                return TnMStorage.saveCardData(t, data);
            });
    },

// Delete all Power-Up data from all cards
    resetAllData: function(t) {
        console.log('Starting complete data reset...');

        // Get all cards on the board first
        return t.cards('all')
            .then(function(cards) {
                console.log('Found', cards.length, 'cards on board');

                // Create array of promises to delete data
                const deletePromises = [];

                // Delete data from board storage for each known card
                return TnMStorage.getKnownCardIds(t)
                    .then(function(knownCardIds) {
                        console.log('Known card IDs:', knownCardIds);

                        // Delete board-level data for each known card
                        knownCardIds.forEach(function(cardId) {
                            deletePromises.push(
                                t.remove('board', 'shared', `tnm-card-data-${cardId}`)
                                    .catch(function(err) {
                                        console.warn('Failed to remove card data for', cardId, err);
                                    })
                            );
                        });

                        // Also try to delete from all current cards (in case some aren't in known list)
                        cards.forEach(function(card) {
                            deletePromises.push(
                                t.remove('board', 'shared', `tnm-card-data-${card.id}`)
                                    .catch(function(err) {
                                        console.warn('Failed to remove card data for', card.id, err);
                                    })
                            );
                        });

                        // Clear the known cards list
                        deletePromises.push(
                            t.set('board', 'shared', 'tnm-known-card-ids', [])
                        );

                        // Reset board settings
                        deletePromises.push(
                            t.set('board', 'shared', 'tnm-settings', {
                                hourlyRate: 0,
                                currency: 'USD'
                            })
                        );

                        // Set global reset flag that will be checked when cards are opened
                        deletePromises.push(
                            t.set('board', 'shared', 'tnm-global-reset-timestamp', Date.now())
                        );

                        // Update cache version to force refresh
                        deletePromises.push(
                            t.set('board', 'shared', 'tnm-cache-version', Date.now())
                        );

                        return Promise.all(deletePromises);
                    });
            })
            .then(function() {
                console.log('Board-level data reset completed');
                return true;
            })
            .catch(function(error) {
                console.error('Error during data reset:', error);
                throw error;
            });
    },

    // New function: check and clear card data on opening
    checkAndClearCardData: function(t) {
        return Promise.all([
            t.card('id'),
            t.get('board', 'shared', 'tnm-data-reset-requested', false)
        ])
            .then(function([card, resetRequested]) {
                if (resetRequested) {
                    // Check if data needs to be cleared for this card
                    return t.get('board', 'shared', `tnm-card-reset-${card.id}`, false)
                        .then(function(needsReset) {
                            if (needsReset) {
                                // Clear card data
                                return t.set('card', 'shared', 'tnm-data', null)
                                    .then(function() {
                                        // Remove reset flag for this card
                                        return t.remove('board', 'shared', `tnm-card-reset-${card.id}`);
                                    });
                            }
                            return Promise.resolve();
                        });
                }
                return Promise.resolve();
            });
    },

    // Get board settings
    getBoardSettings: function(t) {
        return t.get('board', 'shared', 'tnm-settings', {
            hourlyRate: 0,
            currency: 'USD'
        });
    },

    // Save board settings
    saveBoardSettings: function(t, settings) {
        return t.set('board', 'shared', 'tnm-settings', settings);
    },

    // Time formatting for display (updated)
    formatTime: function(days, hours, minutes) {
        days = parseInt(days) || 0;
        hours = parseInt(hours) || 0;
        minutes = parseInt(minutes) || 0;

        let result = [];

        // Add components only if they are greater than zero
        if (days > 0) result.push(days + 'd');
        if (hours > 0) result.push(hours + 'h');
        if (minutes > 0) result.push(minutes + 'm');

        // If all components are zero, show at least minutes
        if (result.length === 0) return '0m';

        // Join with space
        return result.join(' ');
    },

    // Date formatting for display
    formatDate: function(dateString) {
        if (!dateString) return '';

        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '';

        return date.toLocaleDateString();
    },

    // Updated function: parse time string with decimal validation
    parseTimeString: function(timeStr) {
        const result = {
            days: 0,
            hours: 0,
            minutes: 0
        };

        if (!timeStr || !timeStr.trim()) {
            return null; // Empty string
        }

        // Check for decimal numbers in the input - this is not allowed
        if (/\d+\.\d+/.test(timeStr)) {
            return null; // Decimal numbers found - invalid format
        }

        // Regular expression to find time components
        const daysRegex = /(\d+)\s*d/i;
        const hoursRegex = /(\d+)\s*h/i;
        const minutesRegex = /(\d+)\s*m/i;

        // Find components in string
        const daysMatch = timeStr.match(daysRegex);
        const hoursMatch = timeStr.match(hoursRegex);
        const minutesMatch = timeStr.match(minutesRegex);

        // If no components found, return null
        if (!daysMatch && !hoursMatch && !minutesMatch) {
            return null;
        }

        // Fill found values
        if (daysMatch) result.days = parseInt(daysMatch[1]);
        if (hoursMatch) result.hours = parseInt(hoursMatch[1]);
        if (minutesMatch) result.minutes = parseInt(minutesMatch[1]);

        return result;
    },

    // New function: get card info by ID
    getCardInfo: function(t, cardId) {
        return t.cards('all')
            .then(function(cards) {
                return cards.find(card => card.id === cardId);
            });
    },

    // Convert time to minutes (convenient for calculations)
    timeToMinutes: function(days, hours, minutes) {
        return (days * 8 * 60) + (hours * 60) + minutes;
    },

    // Convert minutes back to time structure
    minutesToTime: function(totalMinutes) {
        const days = Math.floor(totalMinutes / (8 * 60));
        totalMinutes -= days * 8 * 60;

        const hours = Math.floor(totalMinutes / 60);
        totalMinutes -= hours * 60;

        const minutes = totalMinutes;

        return {
            days: days,
            hours: hours,
            minutes: minutes
        };
    }
};

window.TnMStorage = TnMStorage;