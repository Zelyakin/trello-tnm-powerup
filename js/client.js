// js/client.js
/* global TrelloPowerUp */

// Power-Up initialization
TrelloPowerUp.initialize({
    // Card menu button
    'card-buttons': function(t) {
        return [{
            icon: './img/icon.png',
            text: 'T&M',
            callback: function(t) {
                return t.popup({
                    title: 'Time Tracking',
                    url: './views/card-detail.html',
                    height: 400
                });
            }
        }];
    },

    // Card badge - ОБНОВЛЕННАЯ ВЕРСИЯ ДЛЯ SUPABASE
    'card-badges': function(t) {
        // Используем TnMStorage.getCardData который автоматически работает с Supabase или Trello Storage
        return TnMStorage.getCardData(t)
            .then(function(data) {
                if (!data) return [];

                // Check if there is time spent
                const hasTime = (data.days || 0) > 0 || (data.hours || 0) > 0 || (data.minutes || 0) > 0;

                if (!hasTime) return [];

                // Use TnMStorage.formatTime function
                return [{
                    text: TnMStorage.formatTime(data.days, data.hours, data.minutes),
                    color: 'blue'
                }];
            })
            .catch(function(err) {
                console.error('Error getting badge data:', err);
                return [];
            });
    },

    // Detailed badge when card is open - ОБНОВЛЕННАЯ ВЕРСИЯ ДЛЯ SUPABASE
    'card-detail-badges': function(t) {
        return TnMStorage.getCardData(t)
            .then(function(data) {
                if (!data) return [];

                // Check if there is time spent
                const hasTime = (data.days || 0) > 0 || (data.hours || 0) > 0 || (data.minutes || 0) > 0;

                if (!hasTime) return [{
                    title: 'Time',
                    text: 'No data',
                    color: null,
                    callback: function(t) {
                        return t.popup({
                            title: 'Time Tracking',
                            url: './views/card-detail.html',
                            height: 400
                        });
                    }
                }];

                // Use TnMStorage.formatTime function
                return [{
                    title: 'Time',
                    text: 'Time spent: ' + TnMStorage.formatTime(data.days, data.hours, data.minutes),
                    color: 'blue',
                    callback: function(t) {
                        return t.popup({
                            title: 'Time Tracking',
                            url: './views/card-detail.html',
                            height: 400
                        });
                    }
                }];
            })
            .catch(function(err) {
                console.error('Error getting detail badge data:', err);
                return [{
                    title: 'Time',
                    text: 'Error loading',
                    color: 'red',
                    callback: function(t) {
                        return t.popup({
                            title: 'Time Tracking',
                            url: './views/card-detail.html',
                            height: 400
                        });
                    }
                }];
            });
    },

    'card-back-section': function(t) {
        return {
            title: 'Time Tracking',
            icon: './img/icon.png',
            content: {
                type: 'iframe',
                url: t.signUrl('./views/card-back.html'),
                height: 200
            }
        };
    },

    'board-buttons': function(t) {
        return [
            {
                icon: {
                    dark: 'https://trello-tnm-powerup.pages.dev/img/export-white.svg',
                    light: 'https://trello-tnm-powerup.pages.dev/img/export-dark.svg'
                },
                text: 'Export T&M',
                callback: function(t) {
                    return t.popup({
                        title: 'Export Time Data',
                        url: './views/export-time.html',
                        height: 400
                    });
                }
            },
            {
                icon: './img/icon.png',
                text: 'T&M Stats',
                callback: function(t) {
                    return t.popup({
                        title: 'Board Time Statistics',
                        url: './views/board-stats.html',
                        height: 600
                    });
                }
            }
        ];
    },

    'show-settings': function(t) {
        return t.popup({
            title: 'T&M Settings',
            url: './views/settings.html',
            height: 300
        });
    }
});