// js/client.js (модификация существующего файла)
/* global TrelloPowerUp */

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
                if (!data) return [];

                // Проверяем, есть ли затраченное время
                const hasTime = (data.days || 0) > 0 || (data.hours || 0) > 0 || (data.minutes || 0) > 0;

                if (!hasTime) return [];

                return [{
                    text: TnMStorage.formatTime(data.days || 0, data.hours || 0, data.minutes || 0),
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

                return [{
                    title: 'Время',
                    text: hasTime ? 'Затраченное время: ' + TnMStorage.formatTime(data.days || 0, data.hours || 0, data.minutes || 0) : 'Нет данных',
                    color: hasTime ? 'blue' : null,
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

    // Новый раздел на обратной стороне карточки
    'card-back-section': function(t, options) {
        return {
            title: 'Учет времени',
            icon: './img/icon.svg', // Иконка раздела
            content: {
                type: 'iframe',
                url: t.signUrl('./views/card-back.html'),
                height: 200 // Высота раздела в пикселях
            }
        };
    },

    // Кнопка в меню доски для очистки кеша
    'board-buttons': function(t, options) {
        return [{
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
        }];
    },

    // Пункт в меню настроек Power-Up
    'show-settings': function(t, options) {
        return t.popup({
            title: 'Настройки T&M',
            url: './views/settings.html',
            height: 300
        });
    }
});