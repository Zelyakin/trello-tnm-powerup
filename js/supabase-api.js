// js/supabase-api.js
const SupabaseAPI = {
    SUPABASE_URL: 'https://tpzbvdyxmzqweoghtgzp.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwemJ2ZHl4bXpxd2VvZ2h0Z3pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg1MTYyNTksImV4cCI6MjA2NDA5MjI1OX0.v61HycgpmbSxjXUkXzD6LGX5rcOmXgJv2n7EFx7Naxs',

    // Кеш с TTL
    _cardDataCache: new Map(),

    CARD_DATA_TTL: 60 * 1000, // 60 секунд

    // Базовый HTTP клиент
    async request(endpoint, options = {}) {
        const url = `${this.SUPABASE_URL}/rest/v1/${endpoint}`;

        const defaultHeaders = {
            'apikey': this.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        };

        const config = {
            ...options,
            headers: {
                ...defaultHeaders,
                ...(options.headers || {})
            }
        };

        const response = await fetch(url, config);

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Supabase API error: ${response.status} ${error}`);
        }

        if (options.headers && options.headers['Prefer'] === 'return=minimal') {
            return {};
        }

        return response.json();
    },

    // Проверка актуальности кеша
    isCacheValid(timestamp, ttl) {
        return Date.now() - timestamp < ttl;
    },

    // Получить или создать карточку (БЕЗ board_id!)
    async ensureCard(trelloCardId) {
        try {
            // Ищем карточку только по trello_card_id (он уникален глобально)
            const cards = await SupabaseAPI.request(
                `cards?select=id,trello_card_id,total_days,total_hours,total_minutes&trello_card_id=eq.${trelloCardId}`
            );

            if (cards.length > 0) {
                return cards[0];
            }

            // Если карточки нет - создаем
            // НО! Нам нужен board_id для создания из-за foreign key
            // Поэтому придется получить boardId из контекста
            // Это единственное место где он нужен
            throw new Error('Card not found and cannot be created without board context');

        } catch (error) {
            console.error('Error ensuring card:', error);
            throw error;
        }
    },

    // НОВАЯ функция: получить или создать карточку с контекстом доски
    // Используется только при создании новой карточки
    async ensureCardWithBoard(trelloBoardId, trelloCardId) {
        try {
            // Сначала пробуем найти существующую карточку
            const cards = await SupabaseAPI.request(
                `cards?select=id,trello_card_id,total_days,total_hours,total_minutes&trello_card_id=eq.${trelloCardId}`
            );

            if (cards.length > 0) {
                return cards[0];
            }

            // Карточки нет - нужно создать
            // Только здесь нам нужна доска
            const boards = await SupabaseAPI.request(
                `boards?select=id,trello_board_id&trello_board_id=eq.${trelloBoardId}`
            );

            let boardId;
            if (boards.length > 0) {
                boardId = boards[0].id;
            } else {
                // Создаем доску если ее нет
                const newBoards = await SupabaseAPI.request('boards', {
                    method: 'POST',
                    body: JSON.stringify({
                        trello_board_id: trelloBoardId
                    })
                });
                boardId = newBoards[0].id;
            }

            // Создаем карточку
            try {
                const newCards = await SupabaseAPI.request('cards', {
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
                // Race condition: кто-то уже создал карточку
                if (createError.message.includes('duplicate key') || createError.message.includes('23505')) {
                    console.log('Card creation race condition, fetching existing card...');
                    const existingCards = await SupabaseAPI.request(
                        `cards?select=id,trello_card_id,total_days,total_hours,total_minutes&trello_card_id=eq.${trelloCardId}`
                    );
                    if (existingCards.length > 0) {
                        return existingCards[0];
                    }
                }
                throw createError;
            }
        } catch (error) {
            console.error('Error ensuring card with board:', error);
            throw error;
        }
    },

    // Получение данных карточки ДЛЯ БЕЙДЖА (только агрегаты, БЕЗ history)
    async getCardDataForBadge(trelloCardId) {
        try {
            const cacheKey = `badge_${trelloCardId}`;

            const cached = this._cardDataCache.get(cacheKey);
            if (cached && this.isCacheValid(cached.timestamp, this.CARD_DATA_TTL)) {
                console.log(`Using cached badge data for ${trelloCardId}`);
                return cached.data;
            }

            console.log(`Fetching fresh badge data for ${trelloCardId}`);

            // Запрашиваем ТОЛЬКО агрегаты, БЕЗ time_entries!
            const cards = await SupabaseAPI.request(
                `cards?select=total_days,total_hours,total_minutes&trello_card_id=eq.${trelloCardId}`
            );

            let cardData;
            if (cards.length > 0) {
                cardData = {
                    days: cards[0].total_days,
                    hours: cards[0].total_hours,
                    minutes: cards[0].total_minutes,
                    history: [] // Пустая история для бейджа
                };
            } else {
                // Карточки еще нет в Supabase - это норма для новых карточек
                cardData = {
                    days: 0,
                    hours: 0,
                    minutes: 0,
                    history: []
                };
            }

            this._cardDataCache.set(cacheKey, {
                data: cardData,
                timestamp: Date.now()
            });

            return cardData;
        } catch (error) {
            console.error('Error getting card data for badge:', error);
            return { days: 0, hours: 0, minutes: 0, history: [] };
        }
    },

    // Получение ПОЛНЫХ данных карточки (с историей) для детального просмотра
    async getCardDataFull(trelloCardId) {
        try {
            const cacheKey = `full_${trelloCardId}`;

            const cached = this._cardDataCache.get(cacheKey);
            if (cached && this.isCacheValid(cached.timestamp, this.CARD_DATA_TTL)) {
                console.log(`Using cached full data for ${trelloCardId}`);
                return cached.data;
            }

            console.log(`Fetching fresh full data for ${trelloCardId}`);

            // Ищем карточку по trello_card_id
            const cards = await SupabaseAPI.request(
                `cards?select=id,trello_card_id,total_days,total_hours,total_minutes&trello_card_id=eq.${trelloCardId}`
            );

            if (cards.length === 0) {
                // Карточки нет - вернем пустые данные
                return { days: 0, hours: 0, minutes: 0, history: [] };
            }

            const card = cards[0];

            // Теперь получаем историю
            const timeEntries = await SupabaseAPI.request(
                `time_entries?select=days,hours,minutes,description,work_date,trello_member_id,member_name,trello_entry_id,created_at&card_id=eq.${card.id}&order=created_at.desc`
            );

            const history = timeEntries.map(entry => ({
                id: entry.created_at,
                type: 'time',
                days: entry.days,
                hours: entry.hours,
                minutes: entry.minutes,
                description: entry.description,
                date: entry.created_at,
                workDate: entry.work_date + 'T00:00:00.000Z',
                memberId: entry.trello_member_id,
                memberName: entry.member_name,
                timestampId: entry.trello_entry_id
            }));

            const cardData = {
                days: card.total_days,
                hours: card.total_hours,
                minutes: card.total_minutes,
                history: history
            };

            this._cardDataCache.set(cacheKey, {
                data: cardData,
                timestamp: Date.now()
            });

            return cardData;
        } catch (error) {
            console.error('Error getting full card data:', error);
            return { days: 0, hours: 0, minutes: 0, history: [] };
        }
    },

    // Инвалидация кеша карточки
    invalidateCardCache(trelloCardId) {
        this._cardDataCache.delete(`badge_${trelloCardId}`);
        this._cardDataCache.delete(`full_${trelloCardId}`);
        console.log(`Card cache invalidated for ${trelloCardId}`);
    },

    // Добавление записи времени
    async addTimeEntry(boardId, trelloCardId, entry) {
        try {
            console.log('Adding time entry to Supabase:', { boardId, trelloCardId, entry });

            // Получаем или создаем карточку (здесь нужен board для создания)
            const card = await this.ensureCardWithBoard(boardId, trelloCardId);

            const workDate = entry.workDate ? entry.workDate.split('T')[0] : new Date().toISOString().split('T')[0];

            if (entry.timestampId) {
                // Проверяем дубликаты
                const existingEntries = await SupabaseAPI.request(
                    `time_entries?select=id&card_id=eq.${card.id}&trello_entry_id=eq.${entry.timestampId}`
                );

                if (existingEntries.length > 0) {
                    console.log(`Entry with timestamp ID ${entry.timestampId} already exists, skipping...`);
                    return null;
                }
            }

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

            if (entry.timestampId) {
                entryData.trello_entry_id = entry.timestampId;
            }

            await SupabaseAPI.request('time_entries', {
                method: 'POST',
                headers: {
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify(entryData)
            });

            console.log(`New entry added successfully for card ${card.id}`);

            await SupabaseAPI.updateCardTotalTime(card.id);
            this.invalidateCardCache(trelloCardId);

            return { success: true };
        } catch (error) {
            console.error('Error adding time entry:', error);

            if (error.message.includes('duplicate key') ||
                error.message.includes('23505') ||
                error.message.includes('idx_time_entries_unique')) {
                console.log(`Duplicate detected, skipping...`);
                return null;
            }

            throw error;
        }
    },

    // Обновление общего времени карточки
    async updateCardTotalTime(cardId) {
        try {
            const entries = await SupabaseAPI.request(
                `time_entries?select=days,hours,minutes&card_id=eq.${cardId}`
            );

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

            await SupabaseAPI.request(`cards?id=eq.${cardId}`, {
                method: 'PATCH',
                headers: {
                    'Prefer': 'return=minimal'
                },
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

    // Удаление записи времени
    async deleteTimeEntry(boardId, trelloCardId, entryTimestamp) {
        try {
            console.log('Deleting time entry from Supabase:', { boardId, trelloCardId, entryTimestamp });

            // Ищем карточку без board_id
            const cards = await SupabaseAPI.request(
                `cards?select=id&trello_card_id=eq.${trelloCardId}`
            );

            if (cards.length === 0) {
                throw new Error('Card not found');
            }

            const card = cards[0];

            await SupabaseAPI.request(`time_entries?card_id=eq.${card.id}&created_at=eq.${entryTimestamp}`, {
                method: 'DELETE',
                headers: {
                    'Prefer': 'return=minimal'
                }
            });

            await SupabaseAPI.updateCardTotalTime(card.id);
            this.invalidateCardCache(trelloCardId);

            return true;
        } catch (error) {
            console.error('Error deleting time entry:', error);
            throw error;
        }
    },

    // Получение всех данных для экспорта
    async getAllDataForExport(boardId, startDate, endDate) {
        try {
            console.log('Getting all data for export from Supabase:', { boardId, startDate, endDate });

            // Находим доску
            const boards = await SupabaseAPI.request(
                `boards?select=id&trello_board_id=eq.${boardId}`
            );

            if (boards.length === 0) {
                console.log('Board not found in Supabase');
                return [];
            }

            const board = boards[0];

            // Получаем все карточки доски
            const cards = await SupabaseAPI.request(
                `cards?select=id,trello_card_id&board_id=eq.${board.id}`
            );

            const exportData = [];

            for (const card of cards) {
                let timeEntriesQuery = `time_entries?select=days,hours,minutes,description,work_date,member_name&card_id=eq.${card.id}`;

                if (startDate) {
                    timeEntriesQuery += `&work_date=gte.${startDate}`;
                }

                if (endDate) {
                    timeEntriesQuery += `&work_date=lte.${endDate}`;
                }

                timeEntriesQuery += '&order=work_date.desc';

                const timeEntries = await SupabaseAPI.request(timeEntriesQuery);

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
    },

    // Очистка кеша
    clearCache() {
        this._cardDataCache.clear();
        console.log('Supabase API cache cleared');
    }
};

window.SupabaseAPI = SupabaseAPI;

window.addEventListener('beforeunload', function() {
    if (window.SupabaseAPI) {
        window.SupabaseAPI.clearCache();
    }
});