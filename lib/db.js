const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

let client = null;
let persistenceEnabled = false;

if (SUPABASE_URL && SUPABASE_KEY) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY);
    persistenceEnabled = true;
} else {
    console.warn(
        '[db] SUPABASE_URL / SUPABASE_SERVICE_KEY no configuradas. ' +
        'El BFF operará en modo degradado (sin persistencia real, usando memoria local).'
    );
}

// Fallback en memoria para desarrollo local sin credenciales de Supabase.
const memoryStore = {
    sessions: new Map(),
    idempotency: new Map(),
    productCache: new Map(),
    requestLogs: []
};

/**
 * Guarda una sesión emitida/validada por el BFF.
 */
async function saveSession(session) {
    if (!persistenceEnabled) {
        memoryStore.sessions.set(session.token, session);
        return session;
    }
    const { data, error } = await client
        .from('sessions')
        .upsert(session, { onConflict: 'token' })
        .select()
        .single();
    if (error) throw error;
    return data;
}

async function getSession(token) {
    if (!persistenceEnabled) {
        return memoryStore.sessions.get(token) || null;
    }
    const { data, error } = await client
        .from('sessions')
        .select('*')
        .eq('token', token)
        .maybeSingle();
    if (error) throw error;
    return data;
}

/**
 * Idempotencia de checkout: evita procesar dos veces el mismo request
 * si el usuario presiona "comprar" dos veces (Idempotency-Key header).
 */
async function getIdempotentResponse(key) {
    if (!persistenceEnabled) {
        return memoryStore.idempotency.get(key) || null;
    }
    const { data, error } = await client
        .from('idempotency_keys')
        .select('*')
        .eq('key', key)
        .maybeSingle();
    if (error) throw error;
    return data;
}

async function saveIdempotentResponse(key, responseBody, statusCode) {
    const record = { key, response: responseBody, status_code: statusCode, created_at: new Date().toISOString() };
    if (!persistenceEnabled) {
        memoryStore.idempotency.set(key, record);
        return record;
    }
    const { data, error } = await client
        .from('idempotency_keys')
        .insert(record)
        .select()
        .single();
    if (error) throw error;
    return data;
}

/**
 * Cache de catálogo: guarda la última respuesta exitosa de products-service
 * para servir datos aunque el servicio del Grupo 3 esté caído (resiliencia).
 */
async function cacheProducts(cacheKey, payload) {
    const record = { cache_key: cacheKey, payload, updated_at: new Date().toISOString() };
    if (!persistenceEnabled) {
        memoryStore.productCache.set(cacheKey, record);
        return record;
    }
    const { data, error } = await client
        .from('product_cache')
        .upsert(record, { onConflict: 'cache_key' })
        .select()
        .single();
    if (error) throw error;
    return data;
}

async function getCachedProducts(cacheKey) {
    if (!persistenceEnabled) {
        return memoryStore.productCache.get(cacheKey) || null;
    }
    const { data, error } = await client
        .from('product_cache')
        .select('*')
        .eq('cache_key', cacheKey)
        .maybeSingle();
    if (error) throw error;
    return data;
}

/**
 * Log de requests entrantes al BFF (auditoría simple / evidencia funcional).
 */
async function logRequest(entry) {
    if (!persistenceEnabled) {
        memoryStore.requestLogs.push(entry);
        return entry;
    }
    const { error } = await client.from('request_logs').insert(entry);
    if (error) console.error('[db] Error guardando request_log:', error.message);
}

module.exports = {
    persistenceEnabled,
    saveSession,
    getSession,
    getIdempotentResponse,
    saveIdempotentResponse,
    cacheProducts,
    getCachedProducts,
    logRequest
};
