/* Утилиты для работы с хранилищем Trello */

const TnMStorage = {
    // Получить данные T&M для карточки
    getCardData: function(t) {
        return t.get('card', 'shared', 'tnm-data', {
            time: 0,
            materials: [],
            history: []
        });
    },

    // Сохранить данные T&M для карточки
    saveCardData: function(t, data) {
        return t.set('card', 'shared', 'tnm-data', data);
    },

    // Добавить запись о затраченном времени
    addTimeRecord: function(t, hours, description) {
        return this.getCardData(t)
            .then(function(data) {
                // Создаем новую запись
                const newRecord = {
                    id: Date.now(),
                    type: 'time',
                    amount: parseFloat(hours),
                    description: description,
                    date: new Date().toISOString()
                };

                // Обновляем общее время
                data.time = (parseFloat(data.time) || 0) + parseFloat(hours);

                // Добавляем запись в историю
                if (!data.history) data.history = [];
                data.history.push(newRecord);

                // Сохраняем обновленные данные
                return TnMStorage.saveCardData(t, data);
            });
    },

    // Добавить материал
    addMaterial: function(t, name, quantity, cost) {
        return this.getCardData(t)
            .then(function(data) {
                // Создаем новую запись о материале
                const newMaterial = {
                    id: Date.now(),
                    name: name,
                    quantity: parseFloat(quantity),
                    cost: parseFloat(cost),
                    date: new Date().toISOString()
                };

                // Добавляем материал в список
                if (!data.materials) data.materials = [];
                data.materials.push(newMaterial);

                // Создаем запись в истории
                if (!data.history) data.history = [];
                data.history.push({
                    id: newMaterial.id,
                    type: 'material',
                    materialId: newMaterial.id,
                    date: new Date().toISOString()
                });

                // Сохраняем обновленные данные
                return TnMStorage.saveCardData(t, data);
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
    }
};