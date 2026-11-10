-- Run this script once in Supabase Dashboard > SQL Editor.
-- Interview records are owned by the authenticated Supabase user.

create table if not exists public.interviews (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  candidate_name text not null,
  target_role text not null,
  interview_type text not null,
  total_questions integer not null check (total_questions between 3 and 7),
  question_number integer not null check (question_number between 1 and 7),
  current_question text not null,
  history jsonb not null default '[]'::jsonb,
  memory jsonb not null default '[]'::jsonb,
  pending_attempts jsonb not null default '[]'::jsonb,
  completed boolean not null default false,
  report jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists interviews_owner_started_idx
  on public.interviews (owner_id, started_at desc);

alter table public.interviews enable row level security;

-- These policies protect the table if a publishable-key client is ever used
-- directly. The VaaniAI backend uses the Supabase Secret key server-side and
-- additionally filters every operation by the verified owner_id.
drop policy if exists "Users can read their own interviews" on public.interviews;
create policy "Users can read their own interviews"
  on public.interviews for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users can insert their own interviews" on public.interviews;
create policy "Users can insert their own interviews"
  on public.interviews for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can update their own interviews" on public.interviews;
create policy "Users can update their own interviews"
  on public.interviews for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can delete their own interviews" on public.interviews;
create policy "Users can delete their own interviews"
  on public.interviews for delete to authenticated
  using ((select auth.uid()) = owner_id);
