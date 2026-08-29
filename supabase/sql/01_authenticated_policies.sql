-- Фаза 3, шаг 1: политики для роли authenticated.
--
-- БЕЗОПАСНО ЗАПУСКАТЬ В ЛЮБОЙ МОМЕНТ, ДО ПЕРЕВОДА КЛИЕНТОВ.
-- Сейчас все существующие политики выданы роли anon ("Allow all" ... TO anon), а у authenticated
-- политик нет вовсе. Значит этот скрипт ничего не ломает: он лишь заранее готовит доступ для
-- токенов, которые начнёт выдавать функция trello-auth. Пока клиент ходит с anon-ключом,
-- эти политики просто не применяются.
--
-- Типы сверены с фактической схемой (2026-08-29): boards.id uuid, boards.trello_board_id text,
-- cards.board_id uuid, time_entries.card_id uuid.

-- Внутренний id доски по клейму из токена.
-- SECURITY DEFINER — чтобы обойти RLS на boards внутри самой функции и не плодить лишних
-- проверок на каждой строке. Функция не опасна: она умеет вернуть только ту доску, чей
-- trello_board_id совпадает с клеймом в токене вызывающего.
create or replace function public.current_board_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id
  from public.boards b
  where b.trello_board_id = (auth.jwt() ->> 'trello_board_id')
$$;

revoke all on function public.current_board_id() from public, anon;
grant execute on function public.current_board_id() to authenticated;

-- boards: видна только своя доска; создать можно только доску с собственным trello_board_id.
-- UPDATE/DELETE не заводим — код их не делает.
drop policy if exists tnm_boards_select on public.boards;
create policy tnm_boards_select on public.boards
  for select to authenticated
  using (trello_board_id = (auth.jwt() ->> 'trello_board_id'));

drop policy if exists tnm_boards_insert on public.boards;
create policy tnm_boards_insert on public.boards
  for insert to authenticated
  with check (trello_board_id = (auth.jwt() ->> 'trello_board_id'));

-- board_settings: SELECT/INSERT/UPDATE. RLS на этой таблице включается позже (скрипт 02) —
-- сейчас он выключен, поэтому политики лежат неактивными.
drop policy if exists tnm_board_settings_select on public.board_settings;
create policy tnm_board_settings_select on public.board_settings
  for select to authenticated
  using (board_id = (select public.current_board_id()));

drop policy if exists tnm_board_settings_insert on public.board_settings;
create policy tnm_board_settings_insert on public.board_settings
  for insert to authenticated
  with check (board_id = (select public.current_board_id()));

drop policy if exists tnm_board_settings_update on public.board_settings;
create policy tnm_board_settings_update on public.board_settings
  for update to authenticated
  using (board_id = (select public.current_board_id()))
  with check (board_id = (select public.current_board_id()));

-- cards: SELECT/INSERT/UPDATE (UPDATE нужен для пересчёта агрегата time_minutes).
drop policy if exists tnm_cards_select on public.cards;
create policy tnm_cards_select on public.cards
  for select to authenticated
  using (board_id = (select public.current_board_id()));

drop policy if exists tnm_cards_insert on public.cards;
create policy tnm_cards_insert on public.cards
  for insert to authenticated
  with check (board_id = (select public.current_board_id()));

drop policy if exists tnm_cards_update on public.cards;
create policy tnm_cards_update on public.cards
  for update to authenticated
  using (board_id = (select public.current_board_id()))
  with check (board_id = (select public.current_board_id()));

-- time_entries: принадлежность доске проверяется через карточку. SELECT/INSERT/DELETE.
-- UPDATE не нужен — записи только добавляются и удаляются.
drop policy if exists tnm_time_entries_select on public.time_entries;
create policy tnm_time_entries_select on public.time_entries
  for select to authenticated
  using (exists (select 1 from public.cards c
                 where c.id = time_entries.card_id
                   and c.board_id = (select public.current_board_id())));

drop policy if exists tnm_time_entries_insert on public.time_entries;
create policy tnm_time_entries_insert on public.time_entries
  for insert to authenticated
  with check (exists (select 1 from public.cards c
                      where c.id = time_entries.card_id
                        and c.board_id = (select public.current_board_id())));

drop policy if exists tnm_time_entries_delete on public.time_entries;
create policy tnm_time_entries_delete on public.time_entries
  for delete to authenticated
  using (exists (select 1 from public.cards c
                 where c.id = time_entries.card_id
                   and c.board_id = (select public.current_board_id())));

-- board_settings.id — serial (nextval), поэтому вставка требует прав на последовательность.
-- У остальных таблиц PK это uuid с gen_random_uuid(), им последовательности не нужны.
grant usage, select on all sequences in schema public to authenticated;
