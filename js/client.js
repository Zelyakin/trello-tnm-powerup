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

    // Card badge - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ (без time_entries!)
    'card-badges': function(t) {
        return TnMStorage.getCardDataForBadge(t)
            .then(function(data) {
                if (!data) return [];

                // Check if there is time spent
                const hasTime = (data.timeMinutes || 0) > 0;

                if (!hasTime) return [];

                return [{
                    text: TnMStorage.formatTime(data.timeMinutes, data.hoursPerDay),
                    color: 'blue'
                }];
            })
            .catch(function(err) {
                console.error('Error getting badge data:', err);
                return [];
            });
    },

    // Detailed badge when card is open
    'card-detail-badges': function(t) {
        return TnMStorage.getCardDataForBadge(t)
            .then(function(data) {
                if (!data) return [];

                // Check if there is time spent
                const hasTime = (data.timeMinutes || 0) > 0;

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

                return [{
                    title: 'Time',
                    text: 'Time spent: ' + TnMStorage.formatTime(data.timeMinutes, data.hoursPerDay),
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
                        height: 500
                    });
                }
            },
            {
                icon: {
                    dark: 'https://trello-tnm-powerup.pages.dev/img/sigma-icon.svg',
                    light: 'https://trello-tnm-powerup.pages.dev/img/sigma-icon.svg'
                },
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
            height: 360
        });
    },

    // Listen for changes in board data to refresh badges when settings change
    'on-enable': function(t) {
        console.log('T&M Power-Up enabled');
        return null;
    },

    'on-disable': function(t) {
        console.log('T&M Power-Up disabled');
        return null;
    }
});