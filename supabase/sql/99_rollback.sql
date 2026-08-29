-- Аварийный откат к состоянию на 2026-08-29 (до ужесточения политик).
-- Возвращает ровно то, что было снято скриптом 02: доступ для роли anon.
-- Политики tnm_* для authenticated при этом остаются — они не мешают.

begin;

alter table public.board_settings disable row level security;

drop policy if exists "Allow all" on public.boards;
create policy "Allow all" on public.boards       for all to anon using (true);
drop policy if exists "Allow all" on public.cards;
create policy "Allow all" on public.cards        for all to anon using (true);
drop policy if exists "Allow all" on public.time_entries;
create policy "Allow all" on public.time_entries for all to anon using (true);

grant all on public.boards          to anon;
grant all on public.board_settings  to anon;
grant all on public.cards           to anon;
grant all on public.time_entries    to anon;
grant usage, select on all sequences in schema public to anon;

commit;
