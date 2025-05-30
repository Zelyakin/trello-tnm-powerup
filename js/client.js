// js/client.js
/* global TrelloPowerUp */

// Function to migrate old data to new format (можно удалить - больше не нужна)
function migrateData(t, data) {
    // Эта функция больше не нужна, так как используем Supabase
    return data;
}

// Updated function to format time in unified format
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

// Power-Up initialization
TrelloPowerUp.initialize({
    // Card menu button
    'card-buttons': function(t, options) {
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
    'card-badges': function(t, options) {
        // Используем TnMStorage.getCardData который автоматически работает с Supabase или Trello Storage
        return TnMStorage.getCardData(t)
            .then(function(data) {
                if (!data) return [];

                // Check if there is time spent
                const hasTime = (data.days || 0) > 0 || (data.hours || 0) > 0 || (data.minutes || 0) > 0;

                if (!hasTime) return [];

                // Use formatTime function
                return [{
                    text: formatTime(data.days, data.hours, data.minutes),
                    color: 'blue'
                }];
            })
            .catch(function(err) {
                console.error('Error getting badge data:', err);
                return [];
            });
    },

    // Detailed badge when card is open - ОБНОВЛЕННАЯ ВЕРСИЯ ДЛЯ SUPABASE
    'card-detail-badges': function(t, options) {
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

                // Use formatTime function
                return [{
                    title: 'Time',
                    text: 'Time spent: ' + formatTime(data.days, data.hours, data.minutes),
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

    'card-back-section': function(t, options) {
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

    'board-buttons': function(t, options) {
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
            }
        ];
    },

    'show-settings': function(t, options) {
        return t.popup({
            title: 'T&M Settings',
            url: './views/settings.html',
            height: 300
        });
    }
});