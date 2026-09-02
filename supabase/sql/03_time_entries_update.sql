-- Политика UPDATE на time_entries — редактирование существующих записей времени (v3.8).
--
-- В 01 этой политики сознательно не было: «записи только добавляются и удаляются». Теперь
-- попап card-detail умеет править запись (время, дата, пользователь, описание), поэтому
-- политика нужна. Нужна ТОЛЬКО она: гранты на таблицы у роли authenticated уже есть,
-- трогать их не требуется.
--
-- using и with check ОБА обязательны и намеренно идентичны:
--   using      — какую строку вообще разрешено взять в UPDATE (её состояние ДО правки);
--   with check — какой ей разрешено стать (состояние ПОСЛЕ правки).
-- Без with check запись можно было бы увести на чужую доску, подменив card_id в PATCH:
-- проверку по своей текущей карточке строка бы прошла, а приземлилась бы за пределами доски.
--
-- Скрипт идемпотентен и обёрнут в транзакцию: при повторном прогоне между drop и create
-- иначе возникало бы окно без политики, а клиенты уже ходят с токенами.

begin;

drop policy if exists tnm_time_entries_update on public.time_entries;
create policy tnm_time_entries_update on public.time_entries
  for update to authenticated
  using (exists (select 1 from public.cards c
                 where c.id = time_entries.card_id
                   and c.board_id = (select public.current_board_id())))
  with check (exists (select 1 from public.cards c
                      where c.id = time_entries.card_id
                        and c.board_id = (select public.current_board_id())));

commit;

-- Проверка сразу после выполнения: на time_entries должно стать четыре политики
-- (select / insert / update / delete), все — для роли authenticated.
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'time_entries'
order by policyname;
