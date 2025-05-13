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

    // Удаление записи о времени
    deleteTimeRecord: function(t, recordId) {
        return TnMStorage.getCardData(t)
            .then(function(data) {
                // Находим запись для удаления
                const recordIndex = data.history.findIndex(record => record.id === recordId);

                if (recordIndex === -1) {
                    throw new Error('Запись не найдена');
                }

                // Получаем запись перед удалением
                const record = data.history[recordIndex];

                // Вычитаем время из общего времени
                data.days = Math.max(0, (parseInt(data.days) || 0) - (parseInt(record.days) || 0));
                data.hours = Math.max(0, (parseInt(data.hours) || 0) - (parseInt(record.hours) || 0));
                data.minutes = Math.max(0, (parseInt(data.minutes) || 0) - (parseInt(record.minutes) || 0));

                // Нормализуем значения в случае отрицательных минут или часов
                // (может произойти при удалении записи, если были округления)
                while (data.minutes < 0) {
                    data.minutes += 60;
                    data.hours -= 1;
                }

                while (data.hours < 0) {
                    data.hours += 24;
                    data.days -= 1;
                }

                // Удаляем запись из истории
                data.history.splice(recordIndex, 1);

                // Сохраняем обновленные данные
                return TnMStorage.saveCardData(t, data);
            });
    },

    // Удаление всех данных Power-Up со всех карточек
    resetAllData: function(t) {
        // Удаляем настройки доски
        const resetBoardSettings = t.set('board', 'shared', 'tnm-settings', {
            hourlyRate: 0,
            currency: 'RUB'
        });

        // Получаем все карточки на доске
        return t.cards('id')
            .then(function(cards) {
                // Создаем массив промисов для удаления данных с каждой карточки
                const resetPromises = cards.map(function(card) {
                    return t.set('card', 'shared', 'tnm-data', null, card.id);
                });

                // Добавляем промис для сброса настроек доски
                resetPromises.push(resetBoardSettings);

                // Ждем выполнения всех промисов
                return Promise.all(resetPromises);
            })
            .then(function() {
                // Обновляем маркер времени последнего обновления
                return t.set('board', 'shared', 'tnm-cache-version', Date.now());
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
        let result = [];

        // Добавляем компоненты, только если они больше нуля
        if (days > 0) result.push(days + 'd');
        if (hours > 0) result.push(hours + 'h');
        if (minutes > 0) result.push(minutes + 'm');

        // Если все компоненты равны нулю, показываем хотя бы минуты
        if (result.length === 0) return '0m';

        // Объединяем через пробел
        return result.join(' ');
    }
};

window.TnMStorage = TnMStorage;