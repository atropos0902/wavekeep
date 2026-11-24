-- step: expand
create extension if not exists pgcrypto;

create table workspace (id uuid primary key default gen_random_uuid(), name text not null);

create table account (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace,
  email text not null unique,
  name text not null,
  role text not null check (role in ('owner', 'analyst', 'client')),
  password_hash text not null
);
create table session (token_hash bytea primary key, workspace_id uuid not null references workspace, account_id uuid not null references account, expires_at timestamptz not null);
create table api_key (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspace, label text not null, key_hash bytea not null unique, per_minute int not null default 600, revoked boolean not null default false);

create table project (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace,
  name text not null,
  current_names int not null default 1,
  current_detector int not null default 3,
  current_questions int not null default 1
);
create table brand (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspace, project_id uuid not null references project, label text not null, is_own boolean not null default false, unique (project_id, label));

-- A name set is written once. A change is a new version.
create table name_set (workspace_id uuid not null references workspace, project_id uuid not null references project, version int not null, note text not null default '', primary key (project_id, version));
create table name_set_name (workspace_id uuid not null, project_id uuid not null, version int not null, brand_id uuid not null references brand, name text not null, needs_context boolean not null default false, primary key (project_id, version, brand_id, name), foreign key (project_id, version) references name_set);
create table name_set_domain (workspace_id uuid not null, project_id uuid not null, version int not null, brand_id uuid not null references brand, domain text not null, primary key (project_id, version, brand_id, domain), foreign key (project_id, version) references name_set);

create table family (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspace, project_id uuid not null references project, label text not null, unique (project_id, label));
-- Questions are never edited. New wording is a new question.
create table question (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspace, project_id uuid not null references project, family_id uuid not null references family, text text not null);
create table question_set (workspace_id uuid not null references workspace, project_id uuid not null references project, version int not null, note text not null default '', primary key (project_id, version));
create table question_set_item (workspace_id uuid not null, project_id uuid not null, version int not null, question_id uuid not null references question, kind text not null check (kind in ('core', 'explore')), primary key (project_id, version, question_id), foreign key (project_id, version) references question_set);

create table wave (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace,
  project_id uuid not null references project,
  seq int not null,
  questions_version int not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  repeats int not null,
  cap_micros bigint not null,
  planned int,
  done int,
  failed int,
  unique (project_id, seq),
  foreign key (project_id, questions_version) references question_set
);
create table wave_spend (wave_id uuid primary key references wave, workspace_id uuid not null, spent_micros bigint not null default 0);
create table wave_engine (wave_id uuid not null references wave, workspace_id uuid not null, engine text not null, planned int not null, done int, failed int, model text, primary key (wave_id, engine));

create table capture (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  wave_id uuid not null references wave,
  question_id uuid not null references question,
  engine text not null,
  repeat int not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts int not null default 0,
  reserved_micros bigint not null default 0,
  error text,
  unique (wave_id, question_id, engine, repeat)
);
create index capture_pending on capture (wave_id) where status = 'pending';
create table answer (
  capture_id bigint primary key references capture,
  workspace_id uuid not null,
  wave_id uuid not null references wave,
  question_id uuid not null,
  engine text not null,
  text text not null,
  model text not null,
  source_kind text not null default 'api',
  cost_micros bigint not null
);
create index answer_cell on answer (wave_id, engine, question_id);
create table citation (answer_id bigint not null references answer, workspace_id uuid not null, wave_id uuid not null, ord int not null, url text not null, host text not null, original text not null, title text not null, primary key (answer_id, ord));
create index citation_wave on citation (wave_id, host);

create table mention (
  answer_id bigint not null references answer,
  workspace_id uuid not null,
  wave_id uuid not null,
  names_version int not null,
  detector int not null,
  brand_id uuid not null references brand,
  start int not null,
  quote text not null,
  primary key (answer_id, names_version, detector, start)
);
create index mention_pick on mention (wave_id, names_version, detector, brand_id, answer_id);
create table recommendation (answer_id bigint not null references answer, workspace_id uuid not null, wave_id uuid not null, names_version int not null, detector int not null, brand_id uuid not null references brand, primary key (answer_id, names_version, detector, brand_id));
create index recommendation_pick on recommendation (wave_id, names_version, detector, brand_id, answer_id);
create table own_citation (answer_id bigint not null references answer, workspace_id uuid not null, wave_id uuid not null, names_version int not null, brand_id uuid not null references brand, primary key (answer_id, names_version, brand_id));
create index own_citation_pick on own_citation (wave_id, names_version, brand_id, answer_id);

-- Counts a page reads. Planned and done don't depend on the brand.
create table wave_cell (wave_id uuid not null references wave, workspace_id uuid not null, question_id uuid not null, engine text not null, planned int not null, done int not null, primary key (wave_id, question_id, engine));
create table brand_cell (wave_id uuid not null references wave, workspace_id uuid not null, names_version int not null, detector int not null, brand_id uuid not null, question_id uuid not null, engine text not null, named int not null, recommended int not null, cited int not null, primary key (wave_id, names_version, detector, brand_id, question_id, engine));
create table publication (wave_id uuid not null references wave, workspace_id uuid not null, project_id uuid not null references project, names_version int not null, detector int not null, primary key (wave_id, names_version, detector));

create table report (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace,
  project_id uuid not null references project,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved')),
  revision int not null default 1,
  pin text not null,
  compare_pin text,
  note text not null default '',
  payload text,
  payload_sha256 text,
  approved_by uuid references account
);
create table share_link (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspace, report_id uuid not null references report, token_hash bytea not null unique, revoked boolean not null default false);

-- A closed wave takes no more answers, whatever the caller forgot to lock.
create function refuse_after_close() returns trigger language plpgsql as $$
begin
  if exists (select 1 from wave where id = new.wave_id and status = 'closed') then
    raise exception 'wave is closed' using errcode = 'WK001';
  end if;
  return new;
end $$;
create trigger answer_open_wave before insert on answer for each row execute function refuse_after_close();

-- Row-level security, forced, keyed on a setting that lives only inside the transaction.
do $$
declare t text;
begin
  foreach t in array array['account','session','api_key','project','brand','name_set','name_set_name','name_set_domain','family','question','question_set','question_set_item','wave','wave_spend','wave_engine','capture','answer','citation','mention','recommendation','own_citation','wave_cell','brand_cell','publication','report','share_link'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant on %I using (workspace_id = nullif(current_setting('app.workspace', true), '')::uuid) with check (workspace_id = nullif(current_setting('app.workspace', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to wavekeep_app', t);
  end loop;
end $$;
alter table workspace enable row level security;
alter table workspace force row level security;
create policy tenant on workspace using (id = nullif(current_setting('app.workspace', true), '')::uuid);
grant select on workspace to wavekeep_app;

-- The few lookups that happen before a workspace is known. Each takes a secret's hash or an email and returns one row.
create function auth_session(h bytea) returns table (workspace_id uuid, account_id uuid, name text, role text) language sql stable security definer set search_path = public as
  $$ select s.workspace_id, a.id, a.name, a.role from session s join account a on a.id = s.account_id where s.token_hash = h and s.expires_at > now() $$;
create function auth_account(e text) returns table (workspace_id uuid, account_id uuid, password_hash text) language sql stable security definer set search_path = public as
  $$ select workspace_id, id, password_hash from account where email = lower(e) $$;
create function auth_key(h bytea) returns table (workspace_id uuid, key_id uuid, per_minute int) language sql stable security definer set search_path = public as
  $$ select workspace_id, id, per_minute from api_key where key_hash = h and not revoked $$;
create function shared_report(h bytea) returns table (title text, payload text, payload_sha256 text) language sql stable security definer set search_path = public as
  $$ select r.title, r.payload, r.payload_sha256 from share_link l join report r on r.id = l.report_id where l.token_hash = h and not l.revoked and r.status = 'approved' $$;
revoke all on function auth_session, auth_account, auth_key, shared_report from public;
grant execute on function auth_session, auth_account, auth_key, shared_report to wavekeep_app;
grant usage on all sequences in schema public to wavekeep_app;
