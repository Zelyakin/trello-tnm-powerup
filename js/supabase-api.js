// js/supabase-api.js
const SupabaseAPI = {
// Замени на свои данные из Supabase проекта
    SUPABASE_URL: 'https://tpzbvdyxmzqweoghtgzp.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwemJ2ZHl4bXpxd2VvZ2h0Z3pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg1MTYyNTksImV4cCI6MjA2NDA5MjI1OX0.v61HycgpmbSxjXUkXzD6LGX5rcOmXgJv2n7EFx7Naxs',

    // Базовый HTTP клиент
    async request(endpoint, options = {}) {
        const url = `${this.SUPABASE_URL}/rest/v1/${endpoint}`;
        const config = {
            headers: {
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation',
                ...options.headers
            },
            ...options
        };

        const response = await fetch(url, config);

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Supabase API error: ${response.status} ${error}`);
        }

        return response.json();
    },

    // Получить или создать доску
    async ensureBoard(trelloBoardId) {
        try {
            // Попытаться найти существующую доску
            const boards = await this.request(`boards?trello_board_id=eq.${trelloBoardId}`);

            if (boards.length > 0) {
                return boards[0];
            }

            // Создать новую доску
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

    // Получить или создать карточку - ИСПРАВЛЕННАЯ ВЕРСИЯ
    async ensureCard(boardId, trelloCardId) {
        try {
            // Попытаться найти существующую карточку
            const cards = await this.request(`cards?trello_card_id=eq.${trelloCardId}&board_id=eq.${boardId}`);

            if (cards.length > 0) {
                return cards[0];
            }

            // Создать новую карточку с обработкой дубликатов
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
                // Если ошибка дубликата - попытаться найти карточку снова
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

    // Добавить запись времени - ИСПРАВЛЕННАЯ ВЕРСИЯ
    async addTimeEntry(boardId, trelloCardId, entry) {
        try {
            console.log('Adding time entry to Supabase:', { boardId, trelloCardId, entry });

            // Убедиться что доска существует
            const board = await this.ensureBoard(boardId);

            // Убедиться что карточка существует (с защитой от дубликатов)
            const card = await this.ensureCard(board.id, trelloCardId);

            // Проверить, не существует ли уже такая запись (защита от дублирования при миграции)
            const workDate = entry.workDate ? entry.workDate.split('T')[0] : new Date().toISOString().split('T')[0];

            // Добавить запись времени
            const timeEntry = await this.request('time_entries', {
                method: 'POST',
                body: JSON.stringify({
                    card_id: card.id,
                    trello_member_id: entry.memberId,
                    member_name: entry.memberName,
                    days: entry.days || 0,
                    hours: entry.hours || 0,
                    minutes: entry.minutes || 0,
                    description: entry.description || '',
                    work_date: workDate
                })
            });

            // Обновить общее время карточки
            await this.updateCardTotalTime(card.id);

            return timeEntry[0];
        } catch (error) {
            console.error('Error adding time entry:', error);

            // Если это ошибка дубликата и мы в процессе миграции, просто пропускаем
            if (error.message.includes('duplicate key') || error.message.includes('23505')) {
                console.log('Entry already exists, skipping...');
                return null;
            }

            throw error;
        }
    },

    // Обновить общее время карточки
    async updateCardTotalTime(cardId) {
        try {
            // Получить все записи времени для карточки
            const entries = await this.request(`time_entries?card_id=eq.${cardId}`);

            // Посчитать общее время
            let totalDays = 0;
            let totalHours = 0;
            let totalMinutes = 0;

            entries.forEach(entry => {
                totalDays += entry.days || 0;
                totalHours += entry.hours || 0;
                totalMinutes += entry.minutes || 0;
            });

            // Нормализовать время
            while (totalMinutes >= 60) {
                totalMinutes -= 60;
                totalHours += 1;
            }

            while (totalHours >= 8) {
                totalHours -= 8;
                totalDays += 1;
            }

            // Обновить карточку
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

    // Получить данные карточки
    async getCardData(boardId, trelloCardId) {
        try {
            console.log('Getting card data from Supabase:', { boardId, trelloCardId });

            // Найти доску
            const boards = await this.request(`boards?trello_board_id=eq.${boardId}`);
            if (boards.length === 0) {
                return { days: 0, hours: 0, minutes: 0, history: [] };
            }

            const board = boards[0];

            // Найти карточку
            const cards = await this.request(`cards?trello_card_id=eq.${trelloCardId}&board_id=eq.${board.id}`);
            if (cards.length === 0) {
                return { days: 0, hours: 0, minutes: 0, history: [] };
            }

            const card = cards[0];

            // Получить записи времени
            const timeEntries = await this.request(`time_entries?card_id=eq.${card.id}&order=created_at.desc`);

            // Преобразовать в формат, ожидаемый Power-Up
            const history = timeEntries.map(entry => ({
                id: entry.created_at, // Используем timestamp как ID
                type: 'time',
                days: entry.days,
                hours: entry.hours,
                minutes: entry.minutes,
                description: entry.description,
                date: entry.created_at,
                workDate: entry.work_date + 'T00:00:00.000Z',
                memberId: entry.trello_member_id,
                memberName: entry.member_name
            }));

            return {
                days: card.total_days,
                hours: card.total_hours,
                minutes: card.total_minutes,
                history: history
            };
        } catch (error) {
            console.error('Error getting card data:', error);
            // Возвращаем пустые данные в случае ошибки
            return { days: 0, hours: 0, minutes: 0, history: [] };
        }
    },

    // Удалить запись времени
    async deleteTimeEntry(boardId, trelloCardId, entryTimestamp) {
        try {
            console.log('Deleting time entry from Supabase:', { boardId, trelloCardId, entryTimestamp });

            // Найти доску и карточку
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

    // Получить все данные для экспорта
    async getAllDataForExport(boardId, startDate, endDate) {
        try {
            console.log('Getting all data for export from Supabase:', { boardId, startDate, endDate });

            // Найти доску
            const boards = await this.request(`boards?trello_board_id=eq.${boardId}`);
            if (boards.length === 0) {
                return [];
            }

            const board = boards[0];

            // Получить все карточки доски
            const cards = await this.request(`cards?board_id=eq.${board.id}`);

            const exportData = [];

            for (const card of cards) {
                // Получить записи времени с фильтрацией по датам
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