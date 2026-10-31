create table public.organizations (
  id text primary key,
  name text not null,
  role text not null default 'Customer and vendor',
  agent_name text not null default 'Janus',
  deployment text not null default 'hosted' check (deployment in ('hosted', 'self-hosted'))
);

create table public.organization_members (
  organization_id text not null references public.organizations(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (organization_id, user_id)
);

create table public.connections (
  id text primary key,
  organization_id text not null references public.organizations(id),
  connector_id text not null,
  encrypted_credentials text not null,
  status text not null check (status in ('connected', 'not_configured', 'error')),
  last_checked timestamptz,
  message text,
  unique (organization_id, connector_id)
);

create table public.support_cases (
  id text primary key,
  customer_id text not null references public.organizations(id),
  vendor_id text not null references public.organizations(id),
  created_at timestamptz not null default now(),
  check (customer_id <> vendor_id)
);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.connections enable row level security;
alter table public.support_cases enable row level security;

create policy "Members see their own memberships" on public.organization_members
  for select to authenticated using (user_id = auth.uid());
create policy "Members see their organizations" on public.organizations
  for select to authenticated using (exists (
    select 1 from public.organization_members m where m.organization_id = id and m.user_id = auth.uid()
  ));

revoke all on public.connections from anon, authenticated;
revoke all on public.support_cases from anon, authenticated;
grant all on public.connections, public.support_cases to service_role;
