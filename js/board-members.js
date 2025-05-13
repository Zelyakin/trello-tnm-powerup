// Утилиты для работы с участниками доски
const BoardMembers = {
    // Получить список участников доски
    getBoardMembers: function(t) {
        return t.board('members')
            .then(function(board) {
                return board.members;
            });
    },

    // Получить текущего пользователя
    getCurrentMember: function(t) {
        return t.member('id', 'fullName', 'username');
    }
};

window.BoardMembers = BoardMembers;