create extension if not exists pgcrypto;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  display_name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('trial','active','suspended','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text not null,
  status text not null default 'active' check (status in ('invited','active','disabled')),
  created_at timestamptz not null default now()
);

create table tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  role_key text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (tenant_id,user_id)
);

create table client_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  relationship_owner_id uuid references users(id),
  risk_status text not null default 'normal',
  created_at timestamptz not null default now(),
  unique (tenant_id,name)
);

create table legal_entities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_group_id uuid not null references client_groups(id),
  legal_name text not null,
  entity_type text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table work_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  legal_entity_id uuid not null references legal_entities(id),
  service_key text not null,
  period_key text not null,
  status text not null,
  statutory_due_date date,
  internal_due_date date,
  assignee_id uuid references users(id),
  reviewer_id uuid references users(id),
  blocker_reason text,
  rule_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,legal_entity_id,service_key,period_key)
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  actor_user_id uuid references users(id),
  resource_type text not null,
  resource_id uuid not null,
  action text not null,
  reason text,
  correlation_id uuid not null default gen_random_uuid(),
  occurred_at timestamptz not null default now()
);

create index work_items_attention_idx on work_items(tenant_id,status,statutory_due_date);
create index audit_events_resource_idx on audit_events(tenant_id,resource_type,resource_id,occurred_at desc);
