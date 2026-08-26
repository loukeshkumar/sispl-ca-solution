-- DEPRECATED REFERENCE ONLY.
-- Do not run this file. db/schema.ts and the ordered drizzle/*.sql migrations are
-- the canonical schema and include newer tenant-integrity and lifecycle rules.

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

create table role_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  key text not null,
  name text not null,
  description text not null default '',
  role_class text not null check (role_class in ('admin','employee')),
  legacy_role_key text not null check (legacy_role_key in ('partner','manager','associate')),
  is_system boolean not null default false,
  status text not null default 'active' check (status in ('active','archived')),
  version integer not null default 1 check (version > 0),
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,key),
  unique (tenant_id,name)
);

create table tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  role_key text not null,
  access_class text not null default 'employee' check (access_class in ('super_admin','admin','employee')),
  role_definition_id uuid,
  authorization_version integer not null default 1 check (authorization_version > 0),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (tenant_id,user_id),
  unique (tenant_id,id),
  foreign key (tenant_id,role_definition_id) references role_definitions(tenant_id,id)
);

create table role_permissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  role_definition_id uuid not null,
  permission_key text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id,role_definition_id,permission_key),
  foreign key (tenant_id,role_definition_id) references role_definitions(tenant_id,id)
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
