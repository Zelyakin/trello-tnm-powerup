// js/supabase-api.js
const SupabaseAPI = {
    SUPABASE_URL: 'https://tpzbvdyxmzqweoghtgzp.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwemJ2ZHl4bXpxd2VvZ2h0Z3pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg1MTYyNTksImV4cCI6MjA2NDA5MjI1OX0.v61HycgpmbSxjXUkXzD6LGX5rcOmXgJv2n7EFx7Naxs',

    // Кеш с TTL
    _boardCache: new Map(), // { trelloBoardId: { data: board, timestamp: Date.now() } }
    _cardDataCache: new Map(), // { "boardId_cardId": { data: cardData, timestamp: Date.now() } }

    // Время жизни кеша (30 секунд для данных карточек, 5 минут для досок)
    CARD_DATA_TTL: 60 * 1000, // 60 секунд
    BOARD_TTL: 5 * 60 * 1000, // 5 минут

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

    // Проверка актуальности кеша
    isCacheValid(timestamp, ttl) {
        return Date.now() - timestamp < ttl;
    },

    // Получить или создать доску (с TTL кешированием)
    async ensureBoard(trelloBoardId) {
        try {
            // Проверяем кеш
            const cached = this._boardCache.get(trelloBoardId);
            if (cached && this.isCacheValid(cached.timestamp, this.BOARD_TTL)) {
                console.log(`Using cached board data for ${trelloBoardId}`);
                return cached.data;
            }

            console.log(`Fetching fresh board data for ${trelloBoardId}`);
            const boards = await SupabaseAPI.request(`boards?trello_board_id=eq.${trelloBoardId}`);

            let board;
            if (boards.length > 0) {
                board = boards[0];
            } else {
                const newBoards = await SupabaseAPI.request('boards', {
                    method: 'POST',
                    body: JSON.stringify({
                        trello_board_id: trelloBoardId
                    })
                });
                board = newBoards[0];
            }

            // Сохраняем в кеш с текущим временем
            this._boardCache.set(trelloBoardId, {
                data: board,
                timestamp: Date.now()
            });

            return board;
        } catch (error) {
            console.error('Error ensuring board:', error);
            throw error;
        }
    },

    // ИСПРАВЛЕННАЯ функция для получения или создания карточки
    async ensureCard(boardId, trelloCardId) {
        try {
            const board = await SupabaseAPI.ensureBoard(boardId);

            // Получаем карточку
            const cards = await SupabaseAPI.request(`cards?trello_card_id=eq.${trelloCardId}&board_id=eq.${board.id}`);

            if (cards.length > 0) {
                return cards[0];
            }

            // Создаем новую карточку только если не найдена
            try {
                const newCards = await SupabaseAPI.request('cards', {
                    method: 'POST',
                    body: JSON.stringify({
                        trello_card_id: trelloCardId,
                        board_id: board.id,
                        total_days: 0,
                        total_hours: 0,
                        total_minutes: 0
                    })
                });
                return newCards[0];
            } catch (createError) {
                // Если ошибка создания из-за дубликата, пытаемся получить еще раз
                if (createError.message.includes('duplicate key') || createError.message.includes('23505')) {
                    console.log('Card creation failed due to duplicate, fetching existing card...');
                    const existingCards = await SupabaseAPI.request(`cards?trello_card_id=eq.${trelloCardId}&board_id=eq.${board.id}`);
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

    // ИСПРАВЛЕННАЯ функция получения данных карточки
    async getCardData(boardId, trelloCardId) {
        try {
            const cacheKey = `${boardId}_${trelloCardId}`;

            // Проверяем кеш данных карточки
            const cached = this._cardDataCache.get(cacheKey);
            if (cached && this.isCacheValid(cached.timestamp, this.CARD_DATA_TTL)) {
                console.log(`Using cached card data for ${cacheKey}`);
                return cached.data;
            }

            console.log(`Fetching fresh card data for ${cacheKey}`);

            // Используем новую функцию ensureCard
            const card = await this.ensureCard(boardId, trelloCardId);

            // Получаем записи времени
            const timeEntries = await SupabaseAPI.request(`time_entries?card_id=eq.${card.id}&order=created_at.desc`);

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

            // Сохраняем в кеш с текущим временем
            this._cardDataCache.set(cacheKey, {
                data: cardData,
                timestamp: Date.now()
            });

            return cardData;
        } catch (error) {
            console.error('Error getting card data:', error);
            return { days: 0, hours: 0, minutes: 0, history: [] };
        }
    },

    // Принудительная инвалидация кеша карточки
    invalidateCardCache(boardId, trelloCardId) {
        const cacheKey = `${boardId}_${trelloCardId}`;
        this._cardDataCache.delete(cacheKey);
        console.log(`Card cache invalidated for ${cacheKey}`);
    },

    // ИСПРАВЛЕННАЯ функция добавления записи времени
    async addTimeEntry(boardId, trelloCardId, entry) {
        try {
            console.log('Adding time entry to Supabase:', { boardId, trelloCardId, entry });

            // Используем новую функцию ensureCard
            const card = await this.ensureCard(boardId, trelloCardId);

            const workDate = entry.workDate ? entry.workDate.split('T')[0] : new Date().toISOString().split('T')[0];

            // Проверить дубликаты
            if (entry.timestampId) {
                const existingEntries = await SupabaseAPI.request(`time_entries?card_id=eq.${card.id}&trello_entry_id=eq.${entry.timestampId}`);

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

            if (entry.timestampId) {
                entryData.trello_entry_id = entry.timestampId;
            }

            // Добавить запись времени
            const timeEntry = await SupabaseAPI.request('time_entries', {
                method: 'POST',
                body: JSON.stringify(entryData)
            });

            console.log(`New entry added successfully for card ${card.id}`);

            // Обновить общее время карточки
            await SupabaseAPI.updateCardTotalTime(card.id);

            // ВАЖНО: Инвалидируем кеш карточки после изменения
            this.invalidateCardCache(boardId, trelloCardId);

            return timeEntry[0];
        } catch (error) {
            console.error('Error adding time entry:', error);

            if (error.message.includes('duplicate key') ||
                error.message.includes('23505') ||
                error.message.includes('idx_time_entries_unique')) {
                console.log(`Duplicate card+timestamp combination detected, skipping...`);
                return null;
            }

            throw error;
        }
    },

    // Обновить общее время карточки
    async updateCardTotalTime(cardId) {
        try {
            const entries = await SupabaseAPI.request(`time_entries?card_id=eq.${cardId}`);

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

    async deleteTimeEntry(boardId, trelloCardId, entryTimestamp) {
        try {
            console.log('Deleting time entry from Supabase:', { boardId, trelloCardId, entryTimestamp });

            const card = await this.ensureCard(boardId, trelloCardId);

            await SupabaseAPI.request(`time_entries?card_id=eq.${card.id}&created_at=eq.${entryTimestamp}`, {
                method: 'DELETE'
            });

            await SupabaseAPI.updateCardTotalTime(card.id);

            // Инвалидируем кеш карточки
            this.invalidateCardCache(boardId, trelloCardId);

            return true;
        } catch (error) {
            console.error('Error deleting time entry:', error);
            throw error;
        }
    },

    async getAllDataForExport(boardId, startDate, endDate) {
        try {
            console.log('Getting all data for export from Supabase:', { boardId, startDate, endDate });

            const board = await SupabaseAPI.ensureBoard(boardId);
            const cards = await SupabaseAPI.request(`cards?board_id=eq.${board.id}`);

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

    // Функция для очистки кеша
    clearCache() {
        this._boardCache.clear();
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