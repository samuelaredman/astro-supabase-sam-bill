-- Comment votes table
create table comment_votes (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  comment_id uuid not null references review_comments(id) on delete cascade,
  vote       smallint not null check (vote in (1, -1)),
  created_at timestamptz default now(),
  unique (profile_id, comment_id)
);

-- Wire comment_id into the notifications table so comment vote notifs can link back
alter table notifications
  add column if not exists comment_id uuid references review_comments(id) on delete cascade;
