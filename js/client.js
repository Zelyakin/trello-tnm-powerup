// js/client.js (модификация существующего файла)
/* global TrelloPowerUp */

// Функция миграции старых данных в новый формат
function migrateData(t, data) {
    // Если в данных есть старое поле time, но нет новых полей
    if (data && data.time !== undefined && (data.days === undefined || data.hours === undefined || data.minutes === undefined)) {
        console.log('Миграция данных из старого формата в новый');

        // Конвертируем время из часов в новый формат (1 день = 8 часов)
        const totalMinutes = Math.round(data.time * 60);
        data.days = Math.floor(totalMinutes / (8 * 60)) || 0;
        data.hours = Math.floor((totalMinutes % (8 * 60)) / 60) || 0;
        data.minutes = totalMinutes % 60 || 0;

        // Сохраняем обновленные данные
        t.set('card', 'shared', 'tnm-data', data);
    }

    return data;
}

// Обновленная функция форматирования времени в едином формате
function formatTime(days, hours, minutes) {
    days = parseInt(days) || 0;
    hours = parseInt(hours) || 0;
    minutes = parseInt(minutes) || 0;

    let result = [];

    if (days > 0) result.push(days + 'd');
    if (hours > 0) result.push(hours + 'h');
    if (minutes > 0) result.push(minutes + 'm');

    if (result.length === 0) return '0m';

    return result.join(' ');
}

// Инициализация Power-Up
TrelloPowerUp.initialize({
    // Кнопка в меню карточки
    'card-buttons': function(t, options) {
        return [{
            icon: './img/icon.svg',
            text: 'T&M',
            callback: function(t) {
                return t.popup({
                    title: 'Учет времени',
                    url: './views/card-detail.html',
                    height: 400
                });
            }
        }];
    },

    // Бейдж на карточке
    'card-badges': function(t, options) {
        return t.get('card', 'shared', 'tnm-data')
            .then(function(data) {
                // Мигрируем данные, если нужно
                data = migrateData(t, data);

                if (!data) return [];

                // Проверяем, есть ли затраченное время
                const hasTime = (data.days || 0) > 0 || (data.hours || 0) > 0 || (data.minutes || 0) > 0;

                if (!hasTime) return [];

                // Используем нашу локальную функцию форматирования
                return [{
                    text: formatTime(data.days, data.hours, data.minutes),
                    color: 'blue'
                }];
            })
            .catch(function(err) {
                console.error('Ошибка получения данных:', err);
                return [];
            });
    },

    // Детальный бейдж при открытии карточки
    'card-detail-badges': function(t, options) {
        return t.get('card', 'shared', 'tnm-data')
            .then(function(data) {
                if (!data) return [];

                // Проверяем, есть ли затраченное время
                const hasTime = (data.days || 0) > 0 || (data.hours || 0) > 0 || (data.minutes || 0) > 0;

                if (!hasTime) return [{
                    title: 'Время',
                    text: 'Нет данных',
                    color: null,
                    callback: function(t) {
                        return t.popup({
                            title: 'Учет времени',
                            url: './views/card-detail.html',
                            height: 400
                        });
                    }
                }];

                // Используем нашу локальную функцию форматирования
                return [{
                    title: 'Время',
                    text: 'Затраченное время: ' + formatTime(data.days, data.hours, data.minutes),
                    color: 'blue',
                    callback: function(t) {
                        return t.popup({
                            title: 'Учет времени',
                            url: './views/card-detail.html',
                            height: 400
                        });
                    }
                }];
            });
    },

    // Остальной код без изменений...
    'card-back-section': function(t, options) {
        return {
            title: 'Учет времени',
            icon: './img/icon.svg',
            content: {
                type: 'iframe',
                url: t.signUrl('./views/card-back.html'),
                height: 200
            }
        };
    },

    'board-buttons': function(t, options) {
        return [
            {
                icon: {
                    dark: './img/icon-white.svg',
                    light: './img/icon.svg'
                },
                text: 'Экспорт T&M',
                callback: function(t) {
                    return t.popup({
                        title: 'Экспорт данных о времени',
                        url: `./views/export-time.html?v=${Date.now()}`,
                        height: 400
                    });
                }
            },
            {
                icon: {
                    dark: './img/icon-white.svg',
                    light: './img/icon.svg'
                },
                text: 'Обновить T&M',
                callback: function(t) {
                    return t.popup({
                        title: 'Обновление T&M Power-Up',
                        url: `./views/clear-cache.html?v=${Date.now()}`,
                        height: 200
                    });
                }
            }
        ];
    },

    'show-settings': function(t, options) {
        return t.popup({
            title: 'Настройки T&M',
            url: './views/settings.html',
            height: 300
        });
    }
});