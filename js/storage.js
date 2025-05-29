/* Utilities for working with Trello storage */

const TnMStorage = {
    // Maximum entries to keep in card storage (to fit in 4096 limit)
    MAX_CARD_ENTRIES: 20,

    // Maximum entries to keep in board storage (to fit in 8192 limit)
    MAX_BOARD_ENTRIES: 150,

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

                // Expand compressed data if needed
                data = TnMStorage.expandData(data);

                // ALWAYS sync data with board storage when card is accessed
                t.card('id').then(function(card) {
                    console.log(`Syncing card ${card.id} data to board storage`);
                    TnMStorage.syncCardDataWithBoard(t, card.id, data);
                });
                return data;
            });
    },

    // Compress data to save maximum space
    compressData: function(data) {
        if (!data || !data.history) return data;

        const compressed = {
            d: data.days || 0,  // days -> d
            h: data.hours || 0, // hours -> h
            m: data.minutes || 0, // minutes -> m
            // Compress history with ultra-short field names
            hist: data.history.map(function(entry) {
                return [
                    entry.id,
                    entry.days || 0,
                    entry.hours || 0,
                    entry.minutes || 0,
                    entry.description || '',
                    entry.workDate || entry.date,
                    entry.memberId,
                    entry.memberName || ''
                ];
            })
        };

        return compressed;
    },

    // Expand compressed data
    expandData: function(data) {
        if (!data) return data;

        // Check if data is already expanded
        if (data.history !== undefined) {
            return data; // Already expanded
        }

        // Check if data is compressed (has 'hist' instead of 'history')
        if (!data.hist) {
            return data; // No history data
        }

        const expanded = {
            days: data.d || 0,
            hours: data.h || 0,
            minutes: data.m || 0,
            history: data.hist.map(function(entry) {
                return {
                    id: entry[0],
                    type: 'time',
                    days: entry[1],
                    hours: entry[2],
                    minutes: entry[3],
                    description: entry[4],
                    date: entry[5], // Use the same date for both
                    workDate: entry[5],
                    memberId: entry[6],
                    memberName: entry[7]
                };
            })
        };

        return expanded;
    },

    // Save T&M data for card with aggressive compression and limits
    saveCardData: function(t, data) {
        // Limit history size for card storage
        const limitedData = {
            days: data.days,
            hours: data.hours,
            minutes: data.minutes,
            history: data.history.slice(-TnMStorage.MAX_CARD_ENTRIES) // Keep only last N entries
        };

        // Compress data before saving
        const compressedData = TnMStorage.compressData(limitedData);

        const dataSize = JSON.stringify(compressedData).length;
        console.log(`Saving card data: ${limitedData.history.length} entries, ${dataSize} chars`);

        if (dataSize > 4000) { // Leave some margin
            console.warn(`Card data still too large (${dataSize} chars), reducing further...`);
            // Keep even fewer entries
            limitedData.history = data.history.slice(-10);
            const recompressed = TnMStorage.compressData(limitedData);

            return t.set('card', 'shared', 'tnm-data', recompressed).then(function() {
                console.log(`Saved reduced card data: ${limitedData.history.length} entries`);
                // Sync full data to board storage
                return t.card('id').then(function(card) {
                    return TnMStorage.syncCardDataWithBoard(t, card.id, data);
                });
            });
        }

        return t.set('card', 'shared', 'tnm-data', compressedData).then(function() {
            console.log('Card data saved successfully');
            // Sync full data to board storage
            return t.card('id').then(function(card) {
                return TnMStorage.syncCardDataWithBoard(t, card.id, data);
            });
        }).catch(function(error) {
            console.error('Error saving card data:', error);
            throw error;
        });
    },

    // Sync card data with board storage with size limits (WITHOUT descriptions)
    syncCardDataWithBoard: function(t, cardId, data) {
        console.log(`Starting sync for card ${cardId}`);

        if (!data) {
            console.log(`No data to sync for card ${cardId}`);
            return Promise.resolve();
        }

        // For board storage, keep more entries but still limit AND remove descriptions
        const boardData = {
            days: data.days,
            hours: data.hours,
            minutes: data.minutes,
            history: data.history.slice(-TnMStorage.MAX_BOARD_ENTRIES).map(function(entry) {
                // Create a copy without description to save space in board storage
                const entryWithoutDescription = {
                    id: entry.id,
                    type: entry.type,
                    days: entry.days,
                    hours: entry.hours,
                    minutes: entry.minutes,
                    date: entry.date,
                    workDate: entry.workDate,
                    memberId: entry.memberId,
                    memberName: entry.memberName
                    // Intentionally omitting description to save space
                };
                return entryWithoutDescription;
            })
        };

        const dataSize = JSON.stringify(boardData).length;
        console.log(`Board sync data size: ${dataSize} chars for ${boardData.history.length} entries (without descriptions)`);

        if (dataSize > 8000) { // Leave margin for 8192 limit
            console.warn('Board data too large, reducing entries...');
            boardData.history = boardData.history.slice(-30); // Further reduce
        }

        return t.set('board', 'shared', `tnm-card-data-${cardId}`, boardData)
            .then(function() {
                console.log(`Successfully synced ${boardData.history.length} entries to board storage for card ${cardId} (without descriptions)`);
                return TnMStorage.updateKnownCardsList(t, cardId);
            })
            .catch(function(error) {
                console.error(`Error syncing card ${cardId} to board:`, error);
                return Promise.resolve(); // Don't fail the main operation
            });
    },

    // Helper function to update known cards list
    updateKnownCardsList: function(t, cardId) {
        return t.get('board', 'shared', 'tnm-known-card-ids', [])
            .then(function(knownCardIds) {
                if (!knownCardIds.includes(cardId)) {
                    knownCardIds.push(cardId);
                    console.log(`Adding card ${cardId} to known cards list. Total known cards: ${knownCardIds.length}`);
                    return t.set('board', 'shared', 'tnm-known-card-ids', knownCardIds);
                } else {
                    console.log(`Card ${cardId} already in known cards list`);
                }
                return Promise.resolve();
            });
    },

    // Get card data from board storage
    getCardDataFromBoard: function(t, cardId) {
        return t.get('board', 'shared', `tnm-card-data-${cardId}`, null)
            .then(function(data) {
                if (data && data.history) {
                    console.log(`Found data in board storage for card ${cardId}: ${data.history.length} entries`);
                } else {
                    console.log(`No data in board storage for card ${cardId}`);
                }
                return data;
            })
            .catch(function(error) {
                console.error(`Error getting data for card ${cardId}:`, error);
                return null;
            });
    },

    // Get all card data for export
    getAllCardDataForExport: function(t) {
        console.log('Starting comprehensive data search for export...');

        return Promise.all([
            t.get('board', 'shared', 'tnm-known-card-ids', []),
            t.cards('all')
        ])
            .then(function([knownCardIds, allCards]) {
                console.log(`Known card IDs: ${knownCardIds.length}, All cards: ${allCards.length}`);

                const exportData = [];
                const promises = [];

                knownCardIds.forEach(function(cardId) {
                    const promise = TnMStorage.getCardDataFromBoard(t, cardId)
                        .then(function(data) {
                            const card = allCards.find(c => c.id === cardId);
                            if (card) {
                                if (data && data.history && data.history.length > 0) {
                                    console.log(`Card ${card.name} (${cardId}): ${data.history.length} entries`);
                                    exportData.push({
                                        card: card,
                                        data: data
                                    });
                                } else {
                                    console.log(`Card ${card.name} (${cardId}): no data found`);
                                    exportData.push({
                                        card: card,
                                        data: null
                                    });
                                }
                            } else {
                                console.log(`Card ID ${cardId}: card not found on board`);
                            }
                            return Promise.resolve();
                        });

                    promises.push(promise);
                });

                return Promise.all(promises).then(function() {
                    console.log(`Export data prepared for ${exportData.length} cards`);
                    return exportData;
                });
            });
    },

    // Get list of IDs of all known cards with data
    getKnownCardIds: function(t) {
        return t.get('board', 'shared', 'tnm-known-card-ids', []);
    },

    // Add time record
    addTimeRecord: function(t, days, hours, minutes, description, workDate) {
        return t.member('id', 'fullName', 'username')
            .then(function(member) {
                return TnMStorage.getCardData(t)
                    .then(function(data) {
                        const newRecord = {
                            id: Date.now(),
                            type: 'time',
                            days: parseInt(days) || 0,
                            hours: parseInt(hours) || 0,
                            minutes: parseInt(minutes) || 0,
                            description: description,
                            date: new Date().toISOString(),
                            workDate: workDate ? new Date(workDate).toISOString() : null,
                            memberId: member.id,
                            memberName: member.fullName || member.username
                        };

                        // Update total time
                        data.days = (parseInt(data.days) || 0) + parseInt(days || 0);
                        data.hours = (parseInt(data.hours) || 0) + parseInt(hours || 0);
                        data.minutes = (parseInt(data.minutes) || 0) + parseInt(minutes || 0);

                        // Normalize values
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

                        console.log(`Adding time record. Total history entries: ${data.history.length}`);

                        return TnMStorage.saveCardData(t, data);
                    });
            });
    },

    // Delete time record
    deleteTimeRecord: function(t, recordId) {
        return TnMStorage.getCardData(t)
            .then(function(data) {
                const recordIndex = data.history.findIndex(record => record.id === recordId);

                if (recordIndex === -1) {
                    throw new Error('Record not found');
                }

                const record = data.history[recordIndex];

                // Subtract time from total time
                data.days = Math.max(0, (parseInt(data.days) || 0) - (parseInt(record.days) || 0));
                data.hours = Math.max(0, (parseInt(data.hours) || 0) - (parseInt(record.hours) || 0));
                data.minutes = Math.max(0, (parseInt(data.minutes) || 0) - (parseInt(record.minutes) || 0));

                // Normalize values
                while (data.minutes < 0) {
                    data.minutes += 60;
                    data.hours -= 1;
                }

                while (data.hours < 0) {
                    data.hours += 8;
                    data.days -= 1;
                }

                data.history.splice(recordIndex, 1);

                console.log(`Deleted time record. Remaining history entries: ${data.history.length}`);

                return TnMStorage.saveCardData(t, data);
            });
    },

    // Delete all Power-Up data from all cards
    resetAllData: function(t) {
        console.log('Starting complete data reset...');

        return t.cards('all')
            .then(function(cards) {
                console.log('Found', cards.length, 'cards on board');

                const deletePromises = [];

                return TnMStorage.getKnownCardIds(t)
                    .then(function(knownCardIds) {
                        console.log('Known card IDs:', knownCardIds);

                        knownCardIds.forEach(function(cardId) {
                            deletePromises.push(
                                t.remove('board', 'shared', `tnm-card-data-${cardId}`)
                                    .catch(function(err) {
                                        console.warn('Failed to remove card data for', cardId, err);
                                    })
                            );
                        });

                        cards.forEach(function(card) {
                            deletePromises.push(
                                t.remove('board', 'shared', `tnm-card-data-${card.id}`)
                                    .catch(function(err) {
                                        console.warn('Failed to remove card data for', card.id, err);
                                    })
                            );
                        });

                        deletePromises.push(
                            t.set('board', 'shared', 'tnm-known-card-ids', [])
                        );

                        deletePromises.push(
                            t.set('board', 'shared', 'tnm-settings', {
                                hourlyRate: 0,
                                currency: 'USD'
                            })
                        );

                        deletePromises.push(
                            t.set('board', 'shared', 'tnm-global-reset-timestamp', Date.now())
                        );

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

    // Check and clear card data on opening
    checkAndClearCardData: function(t) {
        return Promise.all([
            t.card('id'),
            t.get('board', 'shared', 'tnm-data-reset-requested', false)
        ])
            .then(function([card, resetRequested]) {
                if (resetRequested) {
                    return t.get('board', 'shared', `tnm-card-reset-${card.id}`, false)
                        .then(function(needsReset) {
                            if (needsReset) {
                                return t.set('card', 'shared', 'tnm-data', null)
                                    .then(function() {
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

    // Time formatting for display
    formatTime: function(days, hours, minutes) {
        days = parseInt(days) || 0;
        hours = parseInt(hours) || 0;
        minutes = parseInt(minutes) || 0;

        let result = [];

        if (days > 0) result.push(days + 'd');
        if (hours > 0) result.push(hours + 'h');
        if (minutes > 0) result.push(minutes + 'm');

        if (result.length === 0) return '0m';

        return result.join(' ');
    },

    // Date formatting for display
    formatDate: function(dateString) {
        if (!dateString) return '';

        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '';

        return date.toLocaleDateString();
    },

    // Parse time string with decimal validation
    parseTimeString: function(timeStr) {
        const result = {
            days: 0,
            hours: 0,
            minutes: 0
        };

        if (!timeStr || !timeStr.trim()) {
            return null;
        }

        if (/\d+\.\d+/.test(timeStr)) {
            return null;
        }

        const daysRegex = /(\d+)\s*d/i;
        const hoursRegex = /(\d+)\s*h/i;
        const minutesRegex = /(\d+)\s*m/i;

        const daysMatch = timeStr.match(daysRegex);
        const hoursMatch = timeStr.match(hoursRegex);
        const minutesMatch = timeStr.match(minutesRegex);

        if (!daysMatch && !hoursMatch && !minutesMatch) {
            return null;
        }

        if (daysMatch) result.days = parseInt(daysMatch[1]);
        if (hoursMatch) result.hours = parseInt(hoursMatch[1]);
        if (minutesMatch) result.minutes = parseInt(minutesMatch[1]);

        return result;
    },

    // Get card info by ID
    getCardInfo: function(t, cardId) {
        return t.cards('all')
            .then(function(cards) {
                return cards.find(card => card.id === cardId);
            });
    },

    // Convert time to minutes
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