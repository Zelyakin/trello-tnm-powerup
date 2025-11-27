/* Utilities for working with Supabase storage */

const TnMStorage = {
    // Получить данные карточки для БЕЙДЖА (без истории)
    getCardDataForBadge: function(t) {
        return t.card('id')
            .then(card => {
                return SupabaseAPI.getCardDataForBadge(card.id)
                    .catch(error => {
                        console.error('Error getting card badge data from Supabase:', error);
                        return { days: 0, hours: 0, minutes: 0, history: [] };
                    });
            });
    },

    // Получить ПОЛНЫЕ данные карточки (с историей) для детального просмотра
    getCardData: function(t) {
        return t.card('id')
            .then(card => {
                return SupabaseAPI.getCardDataFull(card.id)
                    .catch(error => {
                        console.error('Error getting card data from Supabase:', error);
                        return { days: 0, hours: 0, minutes: 0, history: [] };
                    });
            });
    },

    // Добавить запись времени
    addTimeRecord: function(t, days, hours, minutes, description, workDate, memberId, memberName) {
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
                timestampId: Date.now()
            };

            return SupabaseAPI.addTimeEntry(board.id, card.id, entry);
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
            return SupabaseAPI.getAllDataForExport(board.id, startDate, endDate);
        });
    },

    // Вспомогательные функции форматирования
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