// js/client.js (modification of existing file)
/* global TrelloPowerUp */

// Function to migrate old data to new format
function migrateData(t, data) {
    // If data has old time field but no new fields
    if (data && data.time !== undefined && (data.days === undefined || data.hours === undefined || data.minutes === undefined)) {
        console.log('Migrating data from old to new format');

        // Convert time from hours to new format (1 day = 8 hours)
        const totalMinutes = Math.round(data.time * 60);
        data.days = Math.floor(totalMinutes / (8 * 60)) || 0;
        data.hours = Math.floor((totalMinutes % (8 * 60)) / 60) || 0;
        data.minutes = totalMinutes % 60 || 0;

        // Save updated data
        t.set('card', 'shared', 'tnm-data', data);
    }

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
            icon: './img/icon.svg',
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

    // Card badge
    'card-badges': function(t, options) {
        return t.get('card', 'shared', 'tnm-data')
            .then(function(data) {
                // Migrate data if needed
                data = migrateData(t, data);

                if (!data) return [];

                // Check if there is time spent
                const hasTime = (data.days || 0) > 0 || (data.hours || 0) > 0 || (data.minutes || 0) > 0;

                if (!hasTime) return [];

                // Use our local formatting function
                return [{
                    text: formatTime(data.days, data.hours, data.minutes),
                    color: 'blue'
                }];
            })
            .catch(function(err) {
                console.error('Error getting data:', err);
                return [];
            });
    },

    // Detailed badge when card is open
    'card-detail-badges': function(t, options) {
        return t.get('card', 'shared', 'tnm-data')
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

                // Use our local formatting function
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
            });
    },

    'card-back-section': function(t, options) {
        return {
            title: 'Time Tracking',
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
                    dark: 'https://zelyakin.github.io/trello-tnm-powerup/img/export-white.svg',
                    light: 'https://zelyakin.github.io/trello-tnm-powerup/img/export-dark.svg'
                },
                text: 'Export T&M',
                callback: function(t) {
                    return t.popup({
                        title: 'Export Time Data',
                        url: `./views/export-time.html?v=${Date.now()}`,
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