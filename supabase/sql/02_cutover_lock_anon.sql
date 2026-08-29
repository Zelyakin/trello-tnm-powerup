-- Фаза 3, шаг 2: закрытие доступа для anon. ЗАПУСКАТЬ ПОСЛЕДНИМ.
--
-- ⚠️ ТОЛЬКО ПОСЛЕ ТОГО, КАК ОБА КЛИЕНТА (prod pages.dev и dev github.io) УЖЕ ХОДЯТ
-- С ТОКЕНОМ ОТ trello-auth И ЭТО ВИДНО В ЛОГАХ ФУНКЦИИ.
--
-- До этого момента прод работает на anon-ключе и политике "Allow all" — скрипт её убирает.
-- Откат: supabase/sql/99_rollback.sql (мгновенно, без передеплоя клиентов).

begin;

-- Единственная таблица, где RLS был выключен совсем.
alter table public.board_settings enable row level security;

-- Политики, разрешавшие роли anon всё и на всех таблицах.
drop policy if exists "Allow all" on public.boards;
drop policy if exists "Allow all" on public.cards;
drop policy if exists "Allow all" on public.time_entries;

-- Пояс поверх подтяжек: даже если когда-нибудь по ошибке появится разрешающая политика для
-- anon, гранта у него уже не будет. anon-ключ остаётся в клиенте только как заголовок apikey
-- (пропуск на порог PostgREST) — доступа к данным он больше не даёт.
revoke all on public.boards          from anon;
revoke all on public.board_settings  from anon;
revoke all on public.cards           from anon;
revoke all on public.time_entries    from anon;
revoke usage, select on all sequences in schema public from anon;

commit;

-- Проверка сразу после выполнения: политик для anon быть не должно, у всех четырёх
-- таблиц RLS = enabled.
select tablename, policyname, cmd, roles
from pg_policies where schemaname = 'public' order by tablename, policyname;

select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('boards','board_settings','cards','time_entries');
