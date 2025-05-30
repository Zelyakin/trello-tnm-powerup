// js/supabase-api.js
const SupabaseAPI = {
// Замени на свои данные из Supabase проекта
    SUPABASE_URL: 'https://tpzbvdyxmzqweoghtgzp.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwemJ2ZHl4bXpxd2VvZ2h0Z3pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg1MTYyNTksImV4cCI6MjA2NDA5MjI1OX0.v61HycgpmbSxjXUkXzD6LGX5rcOmXgJv2n7EFx7Naxs',

// Добавить запись времени - ВЕРСИЯ С СОСТАВНЫМ КЛЮЧОМ
    async addTimeEntry(boardId, trelloCardId, entry) {
        try {
            console.log('Adding time entry to Supabase:', { boardId, trelloCardId, entry });

            const board = await this.ensureBoard(boardId);
            const card = await this.ensureCard(board.id, trelloCardId);

            const workDate = entry.workDate ? entry.workDate.split('T')[0] : new Date().toISOString().split('T')[0];

            // Проверить по СОСТАВНОМУ ключу: card_id + trello_entry_id
            if (entry.timestampId) {
                const existingEntries = await this.request(`time_entries?card_id=eq.${card.id}&trello_entry_id=eq.${entry.timestampId}`);

                if (existingEntries.length > 0) {
                    console.log(`Entry with timestamp ID ${entry.timestampId} already exists for card ${card.id}, skipping...`);
                    return null;
                }
            }

            // Подготовить данные для вставки
            const entryData = {
                card_id: card.id,
                trello_member_id: entry.memberId,
                member_name: entry.memberName,
                days: entry.days || 0,
                hours: entry.hours || 0,
                minutes: entry.minutes || 0,
                description: entry.description || '',
                work_date: workDate
            };

            // Добавить timestamp ID если есть
            if (entry.timestampId) {
                entryData.trello_entry_id = entry.timestampId;
            }

            // Добавить запись времени
            const timeEntry = await this.request('time_entries', {
                method: 'POST',
                body: JSON.stringify(entryData)
            });

            console.log(`New entry added successfully for card ${card.id} with timestamp ${entry.timestampId}`);

            // Обновить общее время карточки
            await this.updateCardTotalTime(card.id);

            return timeEntry[0];
        } catch (error) {
            console.error('Error adding time entry:', error);

            // Если это ошибка дубликата по составному ключу - просто пропускаем
            if (error.message.includes('duplicate key') ||
                error.message.includes('23505') ||
                error.message.includes('idx_time_entries_unique')) {
                console.log(`Duplicate card+timestamp combination detected (card_id + trello_entry_id), skipping...`);
                return null;
            }

            throw error;
        }
    },

    async ensureBoard(trelloBoardId) {
        try {
            const boards = await this.request(`boards?trello_board_id=eq.${trelloBoardId}`);

            if (boards.length > 0) {
                return boards[0];
            }

            const newBoards = await this.request('boards', {
                method: 'POST',
                body: JSON.stringify({
                    trello_board_id: trelloBoardId
                })
            });

            return newBoards[0];
        } catch (error) {
            console.error('Error ensuring board:', error);
            throw error;
        }
    },

    async ensureCard(boardId, trelloCardId) {
        try {
            const cards = await this.request(`cards?trello_card_id=eq.${trelloCardId}&board_id=eq.${boardId}`);

            if (cards.length > 0) {
                return cards[0];
            }

            try {
                const newCards = await this.request('cards', {
                    method: 'POST',
                    body: JSON.stringify({
                        trello_card_id: trelloCardId,
                        board_id: boardId,
                        total_days: 0,
                        total_hours: 0,
                        total_minutes: 0
                    })
                });

                return newCards[0];
            } catch (createError) {
                if (createError.message.includes('duplicate key') || createError.message.includes('23505')) {
                    console.log('Card already exists, fetching...');
                    const existingCards = await this.request(`cards?trello_card_id=eq.${trelloCardId}&board_id=eq.${boardId}`);

                    if (existingCards.length > 0) {
                        return existingCards[0];
                    }
                }

                throw createError;
            }
        } catch (error) {
            console.error('Error ensuring card:', error);
            throw error;
        }
    },

    // Добавить запись времени - ВЕРСИЯ С TIMESTAMP ID
    async addTimeEntry(boardId, trelloCardId, entry) {
        try {
            console.log('Adding time entry to Supabase:', { boardId, trelloCardId, entry });

            const board = await this.ensureBoard(boardId);
            const card = await this.ensureCard(board.id, trelloCardId);

            const workDate = entry.workDate ? entry.workDate.split('T')[0] : new Date().toISOString().split('T')[0];

            // Если есть исходный timestamp ID - проверить, не существует ли уже
            if (entry.timestampId) {
                const existingEntries = await this.request(`time_entries?trello_entry_id=eq.${entry.timestampId}`);

                if (existingEntries.length > 0) {
                    console.log(`Entry with timestamp ID ${entry.timestampId} already exists, skipping...`);
                    return null;
                }
            }

            // Подготовить данные для вставки
            const entryData = {
                card_id: card.id,
                trello_member_id: entry.memberId,
                member_name: entry.memberName,
                days: entry.days || 0,
                hours: entry.hours || 0,
                minutes: entry.minutes || 0,
                description: entry.description || '',
                work_date: workDate
            };

            // Добавить timestamp ID если есть
            if (entry.timestampId) {
                entryData.trello_entry_id = entry.timestampId;
            }

            // Добавить запись времени
            const timeEntry = await this.request('time_entries', {
                method: 'POST',
                body: JSON.stringify(entryData)
            });

            console.log('New entry added successfully');

            // Обновить общее время карточки
            await this.updateCardTotalTime(card.id);

            return timeEntry[0];
        } catch (error) {
            console.error('Error adding time entry:', error);

            // Если это ошибка дубликата по timestamp ID - просто пропускаем
            if (error.message.includes('duplicate key') ||
                error.message.includes('23505') ||
                error.message.includes('idx_time_entries_trello_id')) {
                console.log('Duplicate timestamp ID detected, skipping...');
                return null;
            }

            throw error;
        }
    },

    // Остальные функции остаются без изменений
    async updateCardTotalTime(cardId) {
        try {
            const entries = await this.request(`time_entries?card_id=eq.${cardId}`);

            let totalDays = 0;
            let totalHours = 0;
            let totalMinutes = 0;

            entries.forEach(entry => {
                totalDays += entry.days || 0;
                totalHours += entry.hours || 0;
                totalMinutes += entry.minutes || 0;
            });

            while (totalMinutes >= 60) {
                totalMinutes -= 60;
                totalHours += 1;
            }

            while (totalHours >= 8) {
                totalHours -= 8;
                totalDays += 1;
            }

            await this.request(`cards?id=eq.${cardId}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    total_days: totalDays,
                    total_hours: totalHours,
                    total_minutes: totalMinutes,
                    updated_at: new Date().toISOString()
                })
            });

            return { totalDays, totalHours, totalMinutes };
        } catch (error) {
            console.error('Error updating card total time:', error);
            throw error;
        }
    },

    async getCardData(boardId, trelloCardId) {
        try {
            console.log('Getting card data from Supabase:', { boardId, trelloCardId });

            const boards = await this.request(`boards?trello_board_id=eq.${boardId}`);
            if (boards.length === 0) {
                return { days: 0, hours: 0, minutes: 0, history: [] };
            }

            const board = boards[0];
            const cards = await this.request(`cards?trello_card_id=eq.${trelloCardId}&board_id=eq.${board.id}`);
            if (cards.length === 0) {
                return { days: 0, hours: 0, minutes: 0, history: [] };
            }

            const card = cards[0];
            const timeEntries = await this.request(`time_entries?card_id=eq.${card.id}&order=created_at.desc`);

            const history = timeEntries.map(entry => ({
                id: entry.created_at, // Используем timestamp как ID для совместимости
                type: 'time',
                days: entry.days,
                hours: entry.hours,
                minutes: entry.minutes,
                description: entry.description,
                date: entry.created_at,
                workDate: entry.work_date + 'T00:00:00.000Z',
                memberId: entry.trello_member_id,
                memberName: entry.member_name,
                timestampId: entry.trello_entry_id // Добавляем исходный timestamp
            }));

            return {
                days: card.total_days,
                hours: card.total_hours,
                minutes: card.total_minutes,
                history: history
            };
        } catch (error) {
            console.error('Error getting card data:', error);
            return { days: 0, hours: 0, minutes: 0, history: [] };
        }
    },

    async deleteTimeEntry(boardId, trelloCardId, entryTimestamp) {
        try {
            console.log('Deleting time entry from Supabase:', { boardId, trelloCardId, entryTimestamp });

            const boards = await this.request(`boards?trello_board_id=eq.${boardId}`);
            if (boards.length === 0) throw new Error('Board not found');

            const board = boards[0];
            const cards = await this.request(`cards?trello_card_id=eq.${trelloCardId}&board_id=eq.${board.id}`);
            if (cards.length === 0) throw new Error('Card not found');

            const card = cards[0];

            // Удалить запись времени по timestamp
            await this.request(`time_entries?card_id=eq.${card.id}&created_at=eq.${entryTimestamp}`, {
                method: 'DELETE'
            });

            // Обновить общее время карточки
            await this.updateCardTotalTime(card.id);

            return true;
        } catch (error) {
            console.error('Error deleting time entry:', error);
            throw error;
        }
    },

    async getAllDataForExport(boardId, startDate, endDate) {
        try {
            console.log('Getting all data for export from Supabase:', { boardId, startDate, endDate });

            const boards = await this.request(`boards?trello_board_id=eq.${boardId}`);
            if (boards.length === 0) {
                return [];
            }

            const board = boards[0];
            const cards = await this.request(`cards?board_id=eq.${board.id}`);

            const exportData = [];

            for (const card of cards) {
                let timeEntriesQuery = `time_entries?card_id=eq.${card.id}`;

                if (startDate) {
                    timeEntriesQuery += `&work_date=gte.${startDate}`;
                }

                if (endDate) {
                    timeEntriesQuery += `&work_date=lte.${endDate}`;
                }

                timeEntriesQuery += '&order=work_date.desc';

                const timeEntries = await this.request(timeEntriesQuery);

                exportData.push({
                    cardId: card.trello_card_id,
                    timeEntries: timeEntries
                });
            }

            return exportData;
        } catch (error) {
            console.error('Error getting export data:', error);
            throw error;
        }
    }
};

window.SupabaseAPI = SupabaseAPI;