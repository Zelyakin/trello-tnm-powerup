// js/storage.js (модификация существующего файла)
/* Утилиты для работы с хранилищем Trello */

const TnMStorage = {
    // Получить данные T&M для карточки
    getCardData: function(t) {
        return t.get('card', 'shared', 'tnm-data', {
            days: 0,
            hours: 0,
            minutes: 0,
            history: []
        });
    },

    // Сохранить данные T&M для карточки
    saveCardData: function(t, data) {
        return t.set('card', 'shared', 'tnm-data', data);
    },

    // Добавить запись о затраченном времени
    addTimeRecord: function(t, days, hours, minutes, description) {
        // Получаем информацию о текущем пользователе
        return t.member('id', 'fullName', 'username')
            .then(function(member) {
                return TnMStorage.getCardData(t)
                    .then(function(data) {
                        // Создаем новую запись с информацией о пользователе
                        const newRecord = {
                            id: Date.now(),
                            type: 'time',
                            days: parseInt(days) || 0,
                            hours: parseInt(hours) || 0,
                            minutes: parseInt(minutes) || 0,
                            description: description,
                            date: new Date().toISOString(),
                            memberId: member.id,
                            memberName: member.fullName || member.username
                        };

                        // Обновляем общее время
                        data.days = (parseInt(data.days) || 0) + parseInt(days || 0);
                        data.hours = (parseInt(data.hours) || 0) + parseInt(hours || 0);
                        data.minutes = (parseInt(data.minutes) || 0) + parseInt(minutes || 0);

                        // Нормализуем значения (60 минут = 1 час, 24 часа = 1 день)
                        while (data.minutes >= 60) {
                            data.minutes -= 60;
                            data.hours += 1;
                        }

                        while (data.hours >= 24) {
                            data.hours -= 24;
                            data.days += 1;
                        }

                        // Добавляем запись в историю
                        if (!data.history) data.history = [];
                        data.history.push(newRecord);

                        // Сохраняем обновленные данные
                        return TnMStorage.saveCardData(t, data);
                    });
            });
    },

    // Получить настройки доски
    getBoardSettings: function(t) {
        return t.get('board', 'shared', 'tnm-settings', {
            hourlyRate: 0,
            currency: 'RUB'
        });
    },

    // Сохранить настройки доски
    saveBoardSettings: function(t, settings) {
        return t.set('board', 'shared', 'tnm-settings', settings);
    },

    // Форматирование времени для отображения
    formatTime: function(days, hours, minutes) {
        let result = '';
        if (days > 0) result += days + 'd/';
        if (hours > 0 || days > 0) result += hours + 'h/';
        result += minutes + 'm';
        return result;
    }
};