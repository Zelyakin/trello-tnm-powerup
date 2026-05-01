// js/supabase-api.js
const SupabaseAPI = {
    SUPABASE_URL: 'https://tpzbvdyxmzqweoghtgzp.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwemJ2ZHl4bXpxd2VvZ2h0Z3pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg1MTYyNTksImV4cCI6MjA2NDA5MjI1OX0.v61HycgpmbSxjXUkXzD6LGX5rcOmXgJv2n7EFx7Naxs',

    // Кеш с TTL
    _cardDataCache: new Map(),
    _boardIdCache: new Map(),        // Кэш board_id (trelloBoardId → supabaseBoardId)
    _boardSettingsCache: new Map(),  // Кэш настроек доски (trelloBoardId → settings)
    _boardIdPromises: new Map(),     // Промисы текущих запросов board_id (для защиты от race condition)
    _boardSettingsPromises: new Map(), // Промисы текущих запросов settings (для защиты от race condition)
    _lastSettingsUpdate: 0, // Timestamp последнего обновления настроек

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

    // Проверка обновления настроек и очистка кеша при необходимости
    async checkSettingsUpdate(t) {
        try {
            if (!t || !t.get) return; // Защита на случай если t не передан

            const settingsTimestamp = await t.get('board', 'shared', 'tnm-settings-updated', 0);

            if (settingsTimestamp > this._lastSettingsUpdate) {
                console.log('Settings updated, invalidating board settings cache...');
                this._lastSettingsUpdate = settingsTimestamp;
                // Очищаем только кэш настроек, данные карточек остаются в кэше
                this._boardSettingsCache.clear();
                this._boardSettingsPromises.clear();
            }
        } catch (error) {
            console.error('Error checking settings update:', error);
        }
    },

    // Получить или создать карточку (БЕЗ board_id!)
    async ensureCard(trelloCardId) {
        try {
            // Ищем карточку только по trello_card_id (он уникален глобально)
            const cards = await SupabaseAPI.request(
                `cards?select=id,trello_card_id&trello_card_id=eq.${trelloCardId}`
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

    // Получить или создать карточку с контекстом доски
    async ensureCardWithBoard(trelloBoardId, trelloCardId) {
        try {
            // Сначала пробуем найти существующую карточку
            const cards = await SupabaseAPI.request(
                `cards?select=id,trello_card_id&trello_card_id=eq.${trelloCardId}`
            );

            if (cards.length > 0) {
                return cards[0];
            }

            // Карточки нет - нужно создать
            // Используем кэшированный метод для получения boardId
            const boardId = await this.getBoardId(trelloBoardId);

            // Создаем карточку
            try {
                const newCards = await SupabaseAPI.request('cards', {
                    method: 'POST',
                    body: JSON.stringify({
                        trello_card_id: trelloCardId,
                        board_id: boardId,
                        time_minutes: 0
                    })
                });
                return newCards[0];
            } catch (createError) {
                // Race condition: кто-то уже создал карточку
                if (createError.message.includes('duplicate key') || createError.message.includes('23505')) {
                    console.log('Card creation race condition, fetching existing card...');
                    const existingCards = await SupabaseAPI.request(
                        `cards?select=id,trello_card_id&trello_card_id=eq.${trelloCardId}`
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

            // Запрашиваем ТОЛЬКО time_minutes, БЕЗ time_entries!
            const cards = await SupabaseAPI.request(
                `cards?select=time_minutes&trello_card_id=eq.${trelloCardId}`
            );

            let cardData;
            if (cards.length > 0) {
                cardData = {
                    timeMinutes: cards[0].time_minutes || 0,
                    history: []
                };
            } else {
                // Карточки еще нет в Supabase
                cardData = {
                    timeMinutes: 0,
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
            return { timeMinutes: 0, history: [] };
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
                `cards?select=id,trello_card_id,time_minutes&trello_card_id=eq.${trelloCardId}`
            );

            if (cards.length === 0) {
                // Карточки нет - вернем пустые данные
                console.log(`Card ${trelloCardId} not found in Supabase`);
                return { timeMinutes: 0, history: [] };
            }

            const card = cards[0];

            // Теперь получаем историю
            const timeEntries = await SupabaseAPI.request(
                `time_entries?select=time_minutes,description,work_date,trello_member_id,member_name,trello_entry_id,created_at&card_id=eq.${card.id}&order=created_at.desc`
            );

            const history = timeEntries.map(entry => ({
                id: entry.created_at,
                type: 'time',
                timeMinutes: entry.time_minutes || 0,
                description: entry.description,
                date: entry.created_at,
                workDate: entry.work_date + 'T00:00:00.000Z',
                memberId: entry.trello_member_id,
                memberName: entry.member_name,
                timestampId: entry.trello_entry_id
            }));

            const cardData = {
                timeMinutes: card.time_minutes || 0,
                history: history
            };

            this._cardDataCache.set(cacheKey, {
                data: cardData,
                timestamp: Date.now()
            });

            return cardData;
        } catch (error) {
            console.error('Error getting full card data:', error);
            return { timeMinutes: 0, history: [] };
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

            // Получаем или создаем карточку
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
                time_minutes: entry.timeMinutes || 0,
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

            // ВАЖНО: сначала обновляем агрегаты, потом инвалидируем кеш
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
                `time_entries?select=time_minutes&card_id=eq.${cardId}`
            );

            // Просто суммируем минуты - нормализация происходит на клиенте
            let totalMinutes = 0;

            entries.forEach(entry => {
                totalMinutes += entry.time_minutes || 0;
            });

            await SupabaseAPI.request(`cards?id=eq.${cardId}`, {
                method: 'PATCH',
                headers: {
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    time_minutes: totalMinutes,
                    updated_at: new Date().toISOString()
                })
            });

            return { totalMinutes };
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

            // ВАЖНО: сначала обновляем агрегаты, потом инвалидируем кеш
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

            // Используем кэшированный метод для получения boardId
            const supabaseBoardId = await this.getBoardId(boardId);

            // Получаем все карточки доски
            const cards = await this.request(
                `cards?select=id,trello_card_id&board_id=eq.${supabaseBoardId}`
            );

            const exportData = [];

            for (const card of cards) {
                let timeEntriesQuery = `time_entries?select=time_minutes,description,work_date,member_name&card_id=eq.${card.id}`;

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

    // Получение статистики доски (оптимизированный запрос)
    async getBoardStats(trelloBoardId, startDate, endDate) {
        try {
            console.log('Getting board stats from Supabase:', { trelloBoardId, startDate, endDate });

            // Используем кэшированный метод для получения boardId
            const boardId = await this.getBoardId(trelloBoardId);

            // Получаем все карточки доски
            const cards = await this.request(
                `cards?select=id,trello_card_id&board_id=eq.${boardId}`
            );

            if (cards.length === 0) {
                return {
                    totalMinutes: 0,
                    totalEntries: 0,
                    activeCards: 0,
                    contributors: []
                };
            }

            const cardIds = cards.map(c => c.id);

            // Строим запрос для получения всех записей за период
            let query = `time_entries?select=time_minutes,member_name,card_id&card_id=in.(${cardIds.join(',')})`;

            if (startDate) {
                query += `&work_date=gte.${startDate}`;
            }

            if (endDate) {
                query += `&work_date=lte.${endDate}`;
            }

            const timeEntries = await this.request(query);

            // Агрегируем данные на клиенте (можно было бы использовать PostgreSQL functions для этого)
            let totalMinutes = 0;
            const activeCardsSet = new Set();
            const contributorsMap = new Map();

            timeEntries.forEach(entry => {
                totalMinutes += entry.time_minutes || 0;
                activeCardsSet.add(entry.card_id);

                const memberName = entry.member_name || 'Unknown';
                if (!contributorsMap.has(memberName)) {
                    contributorsMap.set(memberName, 0);
                }
                contributorsMap.set(memberName, contributorsMap.get(memberName) + (entry.time_minutes || 0));
            });

            // Сортируем contributors по времени (descending) и ограничиваем топ-3
            const contributors = Array.from(contributorsMap.entries())
                .map(([name, minutes]) => ({ memberName: name, totalMinutes: minutes }))
                .sort((a, b) => b.totalMinutes - a.totalMinutes)
                .slice(0, 3);

            return {
                totalMinutes: totalMinutes,
                totalEntries: timeEntries.length,
                activeCards: activeCardsSet.size,
                contributors: contributors
            };
        } catch (error) {
            console.error('Error getting board stats:', error);
            throw error;
        }
    },

    // Очистка кеша
    clearCache() {
        this._cardDataCache.clear();
        this._boardIdCache.clear();
        this._boardSettingsCache.clear();
        this._boardIdPromises.clear();
        this._boardSettingsPromises.clear();
        console.log('Supabase API cache cleared');
    },

    // Получение или создание board_id с кэшированием
    async getBoardId(trelloBoardId) {
        const cacheKey = `board_${trelloBoardId}`;

        // Проверяем кэш
        const cached = this._boardIdCache.get(cacheKey);
        if (cached && this.isCacheValid(cached.timestamp, this.CARD_DATA_TTL)) {
            console.log(`Using cached board ID for ${trelloBoardId}`);
            return cached.boardId;
        }

        // Проверяем, нет ли уже текущего запроса (защита от race condition)
        const existingPromise = this._boardIdPromises.get(cacheKey);
        if (existingPromise) {
            console.log(`Waiting for existing board ID request for ${trelloBoardId}`);
            return existingPromise;
        }

        console.log(`Fetching fresh board ID for ${trelloBoardId}`);

        // Создаем промис для текущего запроса
        const promise = (async () => {
            try {
                // Запрашиваем из БД
                const boards = await this.request(
                    `boards?select=id&trello_board_id=eq.${trelloBoardId}`
                );

                let boardId;

                if (boards.length === 0) {
                    // Создаем новую доску
                    const newBoards = await this.request('boards', {
                        method: 'POST',
                        body: JSON.stringify({ trello_board_id: trelloBoardId })
                    });
                    boardId = newBoards[0].id;
                } else {
                    boardId = boards[0].id;
                }

                // Кэшируем результат
                this._boardIdCache.set(cacheKey, {
                    boardId: boardId,
                    timestamp: Date.now()
                });

                return boardId;
            } finally {
                // Удаляем промис после завершения
                this._boardIdPromises.delete(cacheKey);
            }
        })();

        // Сохраняем промис
        this._boardIdPromises.set(cacheKey, promise);

        return promise;
    },

    // Получение настроек доски
    async getBoardSettings(trelloBoardId) {
        try {
            const cacheKey = `settings_${trelloBoardId}`;

            // Проверяем кэш настроек
            const cached = this._boardSettingsCache.get(cacheKey);
            if (cached && this.isCacheValid(cached.timestamp, this.CARD_DATA_TTL)) {
                console.log(`Using cached board settings for ${trelloBoardId}`);
                return cached.settings;
            }

            // Проверяем, нет ли уже текущего запроса (защита от race condition)
            const existingPromise = this._boardSettingsPromises.get(cacheKey);
            if (existingPromise) {
                console.log(`Waiting for existing board settings request for ${trelloBoardId}`);
                return existingPromise;
            }

            console.log(`Fetching fresh board settings for ${trelloBoardId}`);

            // Создаем промис для текущего запроса
            const promise = (async () => {
                try {
                    // Получаем boardId (кэшируется отдельно в getBoardId)
                    const boardId = await this.getBoardId(trelloBoardId);

                    // Ищем настройки
                    const settings = await this.request(
                        `board_settings?select=hours_per_day&board_id=eq.${boardId}`
                    );

                    let result;

                    if (settings.length === 0) {
                        // Создаем дефолтные настройки
                        const newSettings = await this.request('board_settings', {
                            method: 'POST',
                            body: JSON.stringify({
                                board_id: boardId,
                                hours_per_day: 8
                            })
                        });
                        result = { hours_per_day: newSettings[0].hours_per_day };
                    } else {
                        result = { hours_per_day: settings[0].hours_per_day };
                    }

                    // Кэшируем результат
                    this._boardSettingsCache.set(cacheKey, {
                        settings: result,
                        timestamp: Date.now()
                    });

                    return result;
                } finally {
                    // Удаляем промис после завершения
                    this._boardSettingsPromises.delete(cacheKey);
                }
            })();

            // Сохраняем промис
            this._boardSettingsPromises.set(cacheKey, promise);

            return promise;

        } catch (error) {
            console.error('Error getting board settings:', error);
            // В случае ошибки возвращаем дефолтные настройки
            return { hours_per_day: 8 };
        }
    },

    // Обновление настроек доски
    async updateBoardSettings(trelloBoardId, hoursPerDay) {
        try {
            // Получаем boardId (используем кэшированный метод)
            const boardId = await this.getBoardId(trelloBoardId);

            // Обновляем или создаем настройки
            const existingSettings = await this.request(
                `board_settings?select=id&board_id=eq.${boardId}`
            );

            if (existingSettings.length === 0) {
                // Создаем новые настройки
                await this.request('board_settings', {
                    method: 'POST',
                    headers: {
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify({
                        board_id: boardId,
                        hours_per_day: hoursPerDay
                    })
                });
            } else {
                // Обновляем существующие
                await this.request(`board_settings?board_id=eq.${boardId}`, {
                    method: 'PATCH',
                    headers: {
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify({
                        hours_per_day: hoursPerDay,
                        updated_at: new Date().toISOString()
                    })
                });
            }

            console.log(`Board settings updated: hours_per_day = ${hoursPerDay}`);

            // Инвалидируем только кэш настроек
            this._boardSettingsCache.delete(`settings_${trelloBoardId}`);
            // Данные карточек (time_minutes) не меняются, только формат отображения
            // Trello автоматически обновит бэджи с новыми настройками

            return { success: true };
        } catch (error) {
            console.error('Error updating board settings:', error);
            throw error;
        }
    }
};

window.SupabaseAPI = SupabaseAPI;

window.addEventListener('beforeunload', function() {
    if (window.SupabaseAPI) {
        window.SupabaseAPI.clearCache();
    }
});