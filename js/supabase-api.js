// js/supabase-api.js
const SupabaseAPI = {
    SUPABASE_URL: 'https://tpzbvdyxmzqweoghtgzp.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwemJ2ZHl4bXpxd2VvZ2h0Z3pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg1MTYyNTksImV4cCI6MjA2NDA5MjI1OX0.v61HycgpmbSxjXUkXzD6LGX5rcOmXgJv2n7EFx7Naxs',

    // Кеш с TTL
    _boardCache: new Map(),
    _cardDataCache: new Map(),

    // Увеличиваем TTL для уменьшения запросов
    CARD_DATA_TTL: 60 * 1000, // 60 секунд
    BOARD_TTL: 5 * 60 * 1000, // 5 минут

    // Базовый HTTP клиент с кешированием
    async request(endpoint, options = {}) {
        const url = `${this.SUPABASE_URL}/rest/v1/${endpoint}`;

        // Определяем, можно ли кешировать этот запрос
        const isCacheable = !options.method || options.method === 'GET';
        const cacheTime = options.cacheTime || 300; // 5 минут по умолчанию

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

        // Добавляем заголовки для HTTP-кеширования на стороне Supabase
        if (isCacheable) {
            config.headers['Cache-Control'] = `public, max-age=${cacheTime}, s-maxage=${cacheTime}`;
            // Используем If-None-Match для условных запросов
            if (options.etag) {
                config.headers['If-None-Match'] = options.etag;
            }
        }

        const response = await fetch(url, config);

        // Если получили 304 Not Modified - данные не изменились
        if (response.status === 304) {
            console.log('Using cached response (304 Not Modified)');
            return options.cachedData || null;
        }

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Supabase API error: ${response.status} ${error}`);
        }

        const data = await response.json();

        // Сохраняем ETag для последующих запросов
        const etag = response.headers.get('ETag');
        if (etag && isCacheable) {
            return { data, etag };
        }

        return data;
    },

    // Проверка актуальности кеша
    isCacheValid(timestamp, ttl) {
        return Date.now() - timestamp < ttl;
    },

    // Получить или создать доску (с улучшенным кешированием)
    async ensureBoard(trelloBoardId) {
        try {
            const cached = this._boardCache.get(trelloBoardId);
            if (cached && this.isCacheValid(cached.timestamp, this.BOARD_TTL)) {
                console.log(`Using cached board data for ${trelloBoardId}`);
                return cached.data;
            }

            console.log(`Fetching fresh board data for ${trelloBoardId}`);

            // Используем ETag если есть
            const requestOptions = {
                cacheTime: 900 // 15 минут
            };

            if (cached && cached.etag) {
                requestOptions.etag = cached.etag;
                requestOptions.cachedData = cached.data;
            }

            const result = await SupabaseAPI.request(
                `boards?trello_board_id=eq.${trelloBoardId}`,
                requestOptions
            );

            const boards = result.data || result;
            let board;

            if (boards.length > 0) {
                board = boards[0];
            } else {
                const newResult = await SupabaseAPI.request('boards', {
                    method: 'POST',
                    body: JSON.stringify({
                        trello_board_id: trelloBoardId
                    })
                });
                const newBoards = newResult.data || newResult;
                board = newBoards[0];
            }

            // Сохраняем в кеш с ETag
            this._boardCache.set(trelloBoardId, {
                data: board,
                timestamp: Date.now(),
                etag: result.etag
            });

            return board;
        } catch (error) {
            console.error('Error ensuring board:', error);
            throw error;
        }
    },

    // Получить или создать карточку с улучшенным кешированием
    async ensureCard(boardId, trelloCardId) {
        try {
            const board = await SupabaseAPI.ensureBoard(boardId);

            const requestOptions = {
                cacheTime: 300 // 5 минут
            };

            const result = await SupabaseAPI.request(
                `cards?trello_card_id=eq.${trelloCardId}&board_id=eq.${board.id}`,
                requestOptions
            );

            const cards = result.data || result;

            if (cards.length > 0) {
                return cards[0];
            }

            try {
                const newResult = await SupabaseAPI.request('cards', {
                    method: 'POST',
                    body: JSON.stringify({
                        trello_card_id: trelloCardId,
                        board_id: board.id,
                        total_days: 0,
                        total_hours: 0,
                        total_minutes: 0
                    })
                });
                const newCards = newResult.data || newResult;
                return newCards[0];
            } catch (createError) {
                if (createError.message.includes('duplicate key') || createError.message.includes('23505')) {
                    console.log('Card creation failed due to duplicate, fetching existing card...');
                    const existingResult = await SupabaseAPI.request(
                        `cards?trello_card_id=eq.${trelloCardId}&board_id=eq.${board.id}`,
                        requestOptions
                    );
                    const existingCards = existingResult.data || existingResult;
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

    // Получение данных карточки с улучшенным кешированием
    async getCardData(boardId, trelloCardId) {
        try {
            const cacheKey = `${boardId}_${trelloCardId}`;

            const cached = this._cardDataCache.get(cacheKey);
            if (cached && this.isCacheValid(cached.timestamp, this.CARD_DATA_TTL)) {
                console.log(`Using cached card data for ${cacheKey}`);
                return cached.data;
            }

            console.log(`Fetching fresh card data for ${cacheKey}`);

            const card = await this.ensureCard(boardId, trelloCardId);

            const requestOptions = {
                cacheTime: 300 // 5 минут
            };

            if (cached && cached.etag) {
                requestOptions.etag = cached.etag;
                requestOptions.cachedData = cached.data;
            }

            const result = await SupabaseAPI.request(
                `time_entries?card_id=eq.${card.id}&order=created_at.desc`,
                requestOptions
            );

            const timeEntries = result.data || result;

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
                timestamp: Date.now(),
                etag: result.etag
            });

            return cardData;
        } catch (error) {
            console.error('Error getting card data:', error);
            return { days: 0, hours: 0, minutes: 0, history: [] };
        }
    },

    // Инвалидация кеша карточки
    invalidateCardCache(boardId, trelloCardId) {
        const cacheKey = `${boardId}_${trelloCardId}`;
        this._cardDataCache.delete(cacheKey);
        console.log(`Card cache invalidated for ${cacheKey}`);
    },

    // Добавление записи времени (без изменений логики)
    async addTimeEntry(boardId, trelloCardId, entry) {
        try {
            console.log('Adding time entry to Supabase:', { boardId, trelloCardId, entry });

            const card = await this.ensureCard(boardId, trelloCardId);

            const workDate = entry.workDate ? entry.workDate.split('T')[0] : new Date().toISOString().split('T')[0];

            if (entry.timestampId) {
                const existingEntries = await SupabaseAPI.request(`time_entries?card_id=eq.${card.id}&trello_entry_id=eq.${entry.timestampId}`);
                const entries = existingEntries.data || existingEntries;

                if (entries.length > 0) {
                    console.log(`Entry with timestamp ID ${entry.timestampId} already exists for card ${card.id}, skipping...`);
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

            const result = await SupabaseAPI.request('time_entries', {
                method: 'POST',
                body: JSON.stringify(entryData)
            });

            const timeEntry = result.data || result;

            console.log(`New entry added successfully for card ${card.id}`);

            await SupabaseAPI.updateCardTotalTime(card.id);
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

    // Обновление общего времени карточки
    async updateCardTotalTime(cardId) {
        try {
            const result = await SupabaseAPI.request(`time_entries?card_id=eq.${cardId}`);
            const entries = result.data || result;

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

    // Удаление записи времени
    async deleteTimeEntry(boardId, trelloCardId, entryTimestamp) {
        try {
            console.log('Deleting time entry from Supabase:', { boardId, trelloCardId, entryTimestamp });

            const card = await this.ensureCard(boardId, trelloCardId);

            await SupabaseAPI.request(`time_entries?card_id=eq.${card.id}&created_at=eq.${entryTimestamp}`, {
                method: 'DELETE'
            });

            await SupabaseAPI.updateCardTotalTime(card.id);
            this.invalidateCardCache(boardId, trelloCardId);

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

            const board = await SupabaseAPI.ensureBoard(boardId);

            const cardsResult = await SupabaseAPI.request(
                `cards?board_id=eq.${board.id}`,
                { cacheTime: 600 } // 10 минут для экспорта
            );
            const cards = cardsResult.data || cardsResult;

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

                const entriesResult = await SupabaseAPI.request(
                    timeEntriesQuery,
                    { cacheTime: 600 } // 10 минут
                );
                const timeEntries = entriesResult.data || entriesResult;

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