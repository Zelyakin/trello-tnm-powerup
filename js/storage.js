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
        return t.cards('all')
            .then(function(cards) {
                // Создаем массив промисов для удаления данных с каждой карточки
                const resetPromises = [];

                // Для Trello API нам нужно использовать метод t.remove для очистки данных карточек
                cards.forEach(function(card) {
                    // Мы не можем напрямую удалить данные с карточки указав только её ID
                    // Вместо этого мы запомним все ID карточек, и пометим их для удаления
                    // при следующем открытии
                    resetPromises.push(
                        t.set('board', 'shared', `tnm-card-reset-${card.id}`, true)
                    );
                });

                // Сохраняем список всех карточек для очистки
                resetPromises.push(
                    t.set('board', 'shared', 'tnm-cards-to-reset', cards.map(card => card.id))
                );

                // Устанавливаем флаг очистки данных
                resetPromises.push(
                    t.set('board', 'shared', 'tnm-data-reset-requested', true)
                );

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

    // Новая функция: проверка и очистка данных для карточки при открытии
    checkAndClearCardData: function(t) {
        return Promise.all([
            t.card('id'),
            t.get('board', 'shared', 'tnm-data-reset-requested', false)
        ])
            .then(function([card, resetRequested]) {
                if (resetRequested) {
                    // Проверяем, нужно ли очистить данные для этой карточки
                    return t.get('board', 'shared', `tnm-card-reset-${card.id}`, false)
                        .then(function(needsReset) {
                            if (needsReset) {
                                // Очищаем данные карточки
                                return t.set('card', 'shared', 'tnm-data', null)
                                    .then(function() {
                                        // Удаляем флаг сброса для этой карточки
                                        return t.remove('board', 'shared', `tnm-card-reset-${card.id}`);
                                    });
                            }
                            return Promise.resolve();
                        });
                }
                return Promise.resolve();
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

    // Форматирование времени для отображения (обновлено)
    formatTime: function(days, hours, minutes) {
        days = parseInt(days) || 0;
        hours = parseInt(hours) || 0;
        minutes = parseInt(minutes) || 0;

        let result = [];

        // Добавляем компоненты, только если они больше нуля
        if (days > 0) result.push(days + 'd');
        if (hours > 0) result.push(hours + 'h');
        if (minutes > 0) result.push(minutes + 'm');

        // Если все компоненты равны нулю, показываем хотя бы минуты
        if (result.length === 0) return '0m';

        // Объединяем через пробел
        return result.join(' ');
    },

    // Новая функция: парсинг строки времени
    parseTimeString: function(timeStr) {
        const result = {
            days: 0,
            hours: 0,
            minutes: 0
        };

        if (!timeStr || !timeStr.trim()) {
            return null; // Пустая строка
        }

        // Регулярное выражение для поиска компонентов времени
        const daysRegex = /(\d+)\s*d/i;
        const hoursRegex = /(\d+)\s*h/i;
        const minutesRegex = /(\d+)\s*m/i;

        // Поиск компонентов в строке
        const daysMatch = timeStr.match(daysRegex);
        const hoursMatch = timeStr.match(hoursRegex);
        const minutesMatch = timeStr.match(minutesRegex);

        // Если не найдено ни одного компонента, возвращаем null
        if (!daysMatch && !hoursMatch && !minutesMatch) {
            return null;
        }

        // Заполняем найденные значения
        if (daysMatch) result.days = parseInt(daysMatch[1]);
        if (hoursMatch) result.hours = parseInt(hoursMatch[1]);
        if (minutesMatch) result.minutes = parseInt(minutesMatch[1]);

        return result;
    }
};

window.TnMStorage = TnMStorage;