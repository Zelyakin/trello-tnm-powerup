/* Utilities for working with Supabase storage */

const TnMStorage = {
    // Флаг для переключения между Trello Storage и Supabase
    USE_SUPABASE: true,

// Migrate single card data to Supabase - ВЕРСИЯ С TIMESTAMP ID
    migrateCardToSupabase: function(t, boardId, cardId, oldData) {
        console.log('Starting card migration to Supabase...');

        if (!oldData) return Promise.resolve();

        const expandedData = this.expandData(oldData);
        if (!expandedData || !expandedData.history) return Promise.resolve();

        const timeEntries = expandedData.history.filter(entry => entry.type === 'time');
        if (timeEntries.length === 0) return Promise.resolve();

        console.log(`Attempting to migrate ${timeEntries.length} entries for card ${cardId}`);

        let successCount = 0;
        let skipCount = 0;
        let errorCount = 0;

        const migrateSequentially = async () => {
            for (let i = 0; i < timeEntries.length; i++) {
                const entry = timeEntries[i];
                try {
                    const result = await SupabaseAPI.addTimeEntry(boardId, cardId, {
                        days: entry.days || 0,
                        hours: entry.hours || 0,
                        minutes: entry.minutes || 0,
                        description: entry.description || '',
                        workDate: entry.workDate || entry.date,
                        memberId: entry.memberId,
                        memberName: entry.memberName,
                        timestampId: entry.id // ПЕРЕДАЕМ TIMESTAMP ID!
                    });

                    if (result === null) {
                        skipCount++;
                        console.log(`Entry ${i + 1}/${timeEntries.length} skipped (duplicate timestamp: ${entry.id})`);
                    } else {
                        successCount++;
                        console.log(`Entry ${i + 1}/${timeEntries.length} migrated successfully (timestamp: ${entry.id})`);
                    }
                } catch (error) {
                    errorCount++;
                    console.warn(`Entry ${i + 1}/${timeEntries.length} failed (timestamp: ${entry.id}):`, error.message);
                }
            }

            return { successCount, skipCount, errorCount };
        };

        return migrateSequentially()
            .then(({ successCount, skipCount, errorCount }) => {
                console.log(`Migration completed: ${successCount} new, ${skipCount} skipped, ${errorCount} errors`);

                return t.set('card', 'shared', 'tnm-migrated-to-supabase', true)
                    .then(() => {
                        return { successCount, skipCount, errorCount };
                    });
            });
    },


// Get T&M data for card - ВЕРСИЯ С ПРИНУДИТЕЛЬНОЙ ПРОВЕРКОЙ
    getCardData: function(t) {
        if (this.USE_SUPABASE) {
            return Promise.all([
                t.board('id'),
                t.card('id'),
                t.get('card', 'shared', 'tnm-data', null),
                t.get('card', 'shared', 'tnm-migrated-to-supabase', false)
            ]).then(([board, card, oldData, alreadyMigrated]) => {

                // Получаем данные из Supabase
                return SupabaseAPI.getCardData(board.id, card.id)
                    .then(supabaseData => {
                        const supabaseEntryCount = supabaseData.history ? supabaseData.history.length : 0;

                        // ПРИНУДИТЕЛЬНАЯ ПРОВЕРКА: даже если помечено как мигрированное,
                        // проверяем соответствие количества записей
                        if (oldData) {
                            const expandedOldData = this.expandData(oldData);
                            const oldEntryCount = expandedOldData.history ? expandedOldData.history.filter(e => e.type === 'time').length : 0;

                            // Если в старых данных значительно больше записей - нужна миграция
                            if (oldEntryCount > supabaseEntryCount + 2) { // небольшой допуск
                                console.log(`FORCE MIGRATION: ${oldEntryCount} local entries vs ${supabaseEntryCount} in Supabase (migrated flag: ${alreadyMigrated})`);

                                // Сбрасываем флаг миграции для принудительной повторной миграции
                                return t.remove('card', 'shared', 'tnm-migrated-to-supabase')
                                    .then(() => this.migrateCardToSupabase(t, board.id, card.id, oldData))
                                    .then(() => SupabaseAPI.getCardData(board.id, card.id))
                                    .catch(error => {
                                        console.error('Force migration failed:', error);
                                        return expandedOldData;
                                    });
                            }
                        }

                        return supabaseData;
                    })
                    .catch(error => {
                        console.error('Error getting card data from Supabase:', error);
                        // Fallback to old data
                        if (oldData) {
                            return this.expandData(oldData);
                        }
                        return { days: 0, hours: 0, minutes: 0, history: [] };
                    });
            });
        }

        // Старый код остается без изменений
        return t.get('card', 'shared', 'tnm-data', {
            days: 0,
            hours: 0,
            minutes: 0,
            history: []
        }).then(data => this.expandData(data));
    },

    // Остальные функции остаются без изменений...

    // Compress data to save maximum space
    compressData: function(data) {
        if (!data || !data.history) return data;

        const compressed = {
            d: data.days || 0,
            h: data.hours || 0,
            m: data.minutes || 0,
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
        if (!data) return { days: 0, hours: 0, minutes: 0, history: [] };

        // Check if data is already expanded
        if (data.history !== undefined) {
            return data; // Already expanded
        }

        // Check if data is compressed (has 'hist' instead of 'history')
        if (!data.hist) {
            return { days: data.d || 0, hours: data.h || 0, minutes: data.m || 0, history: [] };
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
                    date: entry[5],
                    workDate: entry[5],
                    memberId: entry[6],
                    memberName: entry[7]
                };
            })
        };

        return expanded;
    },

    // Save T&M data for card
    saveCardData: function(t, data) {
        if (this.USE_SUPABASE) {
            // Для Supabase не нужно сохранять весь объект данных
            return Promise.resolve();
        }

        // Старый код для Trello Storage
        const compressedData = this.compressData(data);
        return t.set('card', 'shared', 'tnm-data', compressedData);
    },

    // Add time record - ВЕРСИЯ С TIMESTAMP ID
    addTimeRecord: function(t, days, hours, minutes, description, workDate, memberId, memberName) {
        if (this.USE_SUPABASE) {
            return Promise.all([
                t.board('id'),
                t.card('id')
            ]).then(function([board, card]) {
                const entry = {
                    days: parseInt(days) || 0,
                    hours: parseInt(hours) || 0,
                    minutes: parseInt(minutes) || 0,
                    description: description || '',
                    workDate: workDate || new Date().toISOString(),
                    memberId: memberId,
                    memberName: memberName,
                    timestampId: Date.now() // ГЕНЕРИРУЕМ TIMESTAMP ID ДЛЯ НОВЫХ ЗАПИСЕЙ
                };

                return SupabaseAPI.addTimeEntry(board.id, card.id, entry);
            });
        }

        // Старый код остается без изменений
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

                        data.days = (parseInt(data.days) || 0) + parseInt(days || 0);
                        data.hours = (parseInt(data.hours) || 0) + parseInt(hours || 0);
                        data.minutes = (parseInt(data.minutes) || 0) + parseInt(minutes || 0);

                        while (data.minutes >= 60) {
                            data.minutes -= 60;
                            data.hours += 1;
                        }

                        while (data.hours >= 8) {
                            data.hours -= 8;
                            data.days += 1;
                        }

                        if (!data.history) data.history = [];
                        data.history.push(newRecord);

                        return TnMStorage.saveCardData(t, data);
                    });
            });
    },

    // Delete time record
    deleteTimeRecord: function(t, recordId) {
        if (this.USE_SUPABASE) {
            return Promise.all([
                t.board('id'),
                t.card('id')
            ]).then(function([board, card]) {
                return SupabaseAPI.deleteTimeEntry(board.id, card.id, recordId);
            });
        }

        // Старый код остается без изменений
        return this.getCardData(t)
            .then(function(data) {
                const recordIndex = data.history.findIndex(record => record.id === recordId);

                if (recordIndex === -1) {
                    throw new Error('Record not found');
                }

                const record = data.history[recordIndex];

                data.days = Math.max(0, (parseInt(data.days) || 0) - (parseInt(record.days) || 0));
                data.hours = Math.max(0, (parseInt(data.hours) || 0) - (parseInt(record.hours) || 0));
                data.minutes = Math.max(0, (parseInt(data.minutes) || 0) - (parseInt(record.minutes) || 0));

                while (data.minutes < 0) {
                    data.minutes += 60;
                    data.hours -= 1;
                }

                while (data.hours < 0) {
                    data.hours += 8;
                    data.days -= 1;
                }

                data.history.splice(recordIndex, 1);

                return TnMStorage.saveCardData(t, data);
            });
    },

    // Get all card data for export
    getAllCardDataForExport: function(t, startDate, endDate) {
        if (this.USE_SUPABASE) {
            return t.board('id').then(function(board) {
                return SupabaseAPI.getAllDataForExport(board.id, startDate, endDate);
            });
        }

        // Старый код остается без изменений
        return Promise.all([
            t.get('board', 'shared', 'tnm-known-card-ids', []),
            t.cards('all')
        ]).then(function([knownCardIds, allCards]) {
            const exportData = [];
            const promises = [];

            knownCardIds.forEach(function(cardId) {
                const promise = t.get('board', 'shared', `tnm-card-data-${cardId}`, null)
                    .then(function(data) {
                        const card = allCards.find(c => c.id === cardId);
                        if (card) {
                            exportData.push({
                                card: card,
                                data: data
                            });
                        }
                        return Promise.resolve();
                    });

                promises.push(promise);
            });

            return Promise.all(promises).then(function() {
                return exportData;
            });
        });
    },

    // Остальные вспомогательные функции
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

    formatDate: function(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleDateString();
    },

    parseTimeString: function(timeStr) {
        const result = { days: 0, hours: 0, minutes: 0 };

        if (!timeStr || !timeStr.trim()) return null;
        if (/\d+\.\d+/.test(timeStr)) return null;

        const daysRegex = /(\d+)\s*d/i;
        const hoursRegex = /(\d+)\s*h/i;
        const minutesRegex = /(\d+)\s*m/i;

        const daysMatch = timeStr.match(daysRegex);
        const hoursMatch = timeStr.match(hoursRegex);
        const minutesMatch = timeStr.match(minutesRegex);

        if (!daysMatch && !hoursMatch && !minutesMatch) return null;

        if (daysMatch) result.days = parseInt(daysMatch[1]);
        if (hoursMatch) result.hours = parseInt(hoursMatch[1]);
        if (minutesMatch) result.minutes = parseInt(minutesMatch[1]);

        return result;
    },

    timeToMinutes: function(days, hours, minutes) {
        return (days * 8 * 60) + (hours * 60) + minutes;
    }
};

window.TnMStorage = TnMStorage;