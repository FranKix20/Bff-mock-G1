-- Schema de persistencia para el BFF (Grupo 1 - Frontend Marketplace)
-- Ejecutar en el SQL Editor de Supabase (proyecto free tier).

-- 1. Sesiones cacheadas por el BFF (evita golpear al servicio de Auth
--    del Grupo 2 en cada request y permite validar sesión localmente).
create table if not exists sessions (
    token text primary key,
    user_id text not null,
    business_user_id text,
    email text,
    full_name text,
    role text,
    created_at timestamptz default now(),
    expires_at timestamptz not null
);

-- 2. Idempotencia de checkout: evita crear pedidos duplicados si el
--    usuario presiona "comprar" dos veces (Idempotency-Key header).
create table if not exists idempotency_keys (
    key text primary key,
    response jsonb not null,
    status_code integer not null,
    created_at timestamptz default now()
);

-- 3. Cache del catálogo de productos (resiliencia si el servicio del
--    Grupo 3 está caído o aún no desplegado).
create table if not exists product_cache (
    cache_key text primary key,
    payload jsonb not null,
    updated_at timestamptz default now()
);

-- 4. Log simple de requests entrantes al BFF (evidencia funcional /
--    auditoría básica).
create table if not exists request_logs (
    id bigint generated always as identity primary key,
    request_id text,
    correlation_id text,
    consumer text,
    method text,
    path text,
    status integer,
    created_at timestamptz default now()
);

-- Índices útiles
create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_request_logs_created_at on request_logs(created_at);
