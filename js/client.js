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
                    title: 'T&M Менеджер',
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

                return [{
                    text: data.time ? data.time + ' ч' : '',
                    color: data.time ? 'blue' : 'light-gray'
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

                return [{
                    title: 'Время и материалы',
                    text: data.time ? 'Затраченное время: ' + data.time + ' ч' : 'Нет данных',
                    color: data.time ? 'blue' : null,
                    callback: function(t) {
                        return t.popup({
                            title: 'Управление T&M',
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
            title: 'Время и Материалы',
            icon: './img/icon.svg', // Иконка раздела
            content: {
                type: 'iframe',
                url: t.signUrl('./views/card-back.html'),
                height: 200 // Высота раздела в пикселях
            }
        };
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