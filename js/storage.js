/* Utilities for working with Supabase storage */

const TnMStorage = {
    // Получить данные карточки для БЕЙДЖА (без истории)
    getCardDataForBadge: function(t) {
        return Promise.all([
            t.card('id'),
            t.board('id'),
            SupabaseAPI.checkSettingsUpdate(t) // Проверяем обновление настроек
        ]).then(([card, board]) => {
            return Promise.all([
                SupabaseAPI.getCardDataForBadge(card.id),
                SupabaseAPI.getBoardSettings(board.id)
            ]).then(([cardData, settings]) => {
                cardData.hoursPerDay = settings.hours_per_day;
                return cardData;
            }).catch(error => {
                console.error('Error getting card badge data from Supabase:', error);
                return { timeMinutes: 0, history: [], hoursPerDay: 8 };
            });
        });
    },

    // Получить ПОЛНЫЕ данные карточки (с историей) для детального просмотра
    getCardData: function(t) {
        return Promise.all([
            t.card('id'),
            t.board('id'),
            SupabaseAPI.checkSettingsUpdate(t) // Проверяем обновление настроек
        ]).then(([card, board]) => {
            return Promise.all([
                SupabaseAPI.getCardDataFull(card.id),
                SupabaseAPI.getBoardSettings(board.id)
            ]).then(([cardData, settings]) => {
                cardData.hoursPerDay = settings.hours_per_day;
                return cardData;
            }).catch(error => {
                console.error('Error getting card data from Supabase:', error);
                return { timeMinutes: 0, history: [], hoursPerDay: 8 };
            });
        });
    },

    // Добавить запись времени
    addTimeRecord: function(t, days, hours, minutes, description, workDate, memberId, memberName) {
        return Promise.all([
            t.board('id'),
            t.card('id')
        ]).then(function([board, card]) {
            // Получаем настройки доски для правильной конвертации
            return SupabaseAPI.getBoardSettings(board.id).then(function(settings) {
                const hoursPerDay = settings.hours_per_day;

                // Конвертируем в минуты
                const totalMinutes = TnMStorage.parseTimeToMinutes(
                    parseInt(days) || 0,
                    parseInt(hours) || 0,
                    parseInt(minutes) || 0,
                    hoursPerDay
                );

                const entry = {
                    timeMinutes: totalMinutes,
                    description: description || '',
                    workDate: workDate || new Date().toISOString(),
                    memberId: memberId,
                    memberName: memberName,
                    timestampId: Date.now()
                };

                return SupabaseAPI.addTimeEntry(board.id, card.id, entry);
            });
        });
    },

    // Удалить запись времени
    deleteTimeRecord: function(t, recordId) {
        return Promise.all([
            t.board('id'),
            t.card('id')
        ]).then(function([board, card]) {
            return SupabaseAPI.deleteTimeEntry(board.id, card.id, recordId);
        });
    },

    // Получить все данные для экспорта
    getAllCardDataForExport: function(t, startDate, endDate) {
        return t.board('id').then(function(board) {
            return Promise.all([
                SupabaseAPI.getAllDataForExport(board.id, startDate, endDate),
                SupabaseAPI.getBoardSettings(board.id)
            ]).then(function([exportData, settings]) {
                return {
                    data: exportData,
                    hoursPerDay: settings.hours_per_day
                };
            });
        });
    },

    // Получить настройки доски
    getBoardSettings: function(t) {
        return t.board('id').then(function(board) {
            return SupabaseAPI.getBoardSettings(board.id);
        });
    },

    // Обновить настройки доски
    updateBoardSettings: function(t, hoursPerDay) {
        return t.board('id').then(function(board) {
            return SupabaseAPI.updateBoardSettings(board.id, hoursPerDay);
        });
    },

    // Вспомогательные функции форматирования

    // Форматирование минут в строку "Xd Xh Xm"
    formatTime: function(totalMinutes, hoursPerDay) {
        hoursPerDay = hoursPerDay || 8;
        totalMinutes = parseInt(totalMinutes) || 0;

        if (totalMinutes === 0) return '0m';

        const minutesPerDay = hoursPerDay * 60;

        const days = Math.floor(totalMinutes / minutesPerDay);
        let remaining = totalMinutes % minutesPerDay;

        const hours = Math.floor(remaining / 60);
        const minutes = remaining % 60;

        let result = [];
        if (days > 0) result.push(days + 'd');
        if (hours > 0) result.push(hours + 'h');
        if (minutes > 0) result.push(minutes + 'm');

        return result.join(' ');
    },

    // Конвертация минут в объект {days, hours, minutes}
    minutesToTime: function(totalMinutes, hoursPerDay) {
        hoursPerDay = hoursPerDay || 8;
        totalMinutes = parseInt(totalMinutes) || 0;

        const minutesPerDay = hoursPerDay * 60;

        const days = Math.floor(totalMinutes / minutesPerDay);
        let remaining = totalMinutes % minutesPerDay;

        const hours = Math.floor(remaining / 60);
        const minutes = remaining % 60;

        return { days, hours, minutes };
    },

    formatDate: function(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleDateString();
    },

    // Парсинг строки времени "1d 2h 30m" в объект {days, hours, minutes}
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

    // Конвертация {days, hours, minutes} в общее количество минут
    parseTimeToMinutes: function(days, hours, minutes, hoursPerDay) {
        hoursPerDay = hoursPerDay || 8;
        return (days * hoursPerDay * 60) + (hours * 60) + minutes;
    },

    // Deprecated: для обратной совместимости (используем 8 часов)
    timeToMinutes: function(days, hours, minutes) {
        return TnMStorage.parseTimeToMinutes(days, hours, minutes, 8);
    }
};

window.TnMStorage = TnMStorage;