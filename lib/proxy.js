const axios = require('axios');

/**
 * Llama a un servicio upstream real (otro grupo). Si la URL no está
 * configurada en variables de entorno, o el servicio no responde,
 * devuelve el mock proporcionado y marca la respuesta como degradada.
 *
 * Esto permite que el BFF funcione en Fase 3 aunque otros grupos sigan
 * entregando mocks/Postman en vez de una URL cloud real: basta con
 * definir la env var cuando el servicio real esté disponible.
 */
async function callUpstream({ envVarName, method = 'GET', path = '', data, params, headers = {}, timeout = 4000, mockFallback, req }) {
    const baseUrl = process.env[envVarName];

    // Headers de trazabilidad estándar del ecosistema. Algunos servicios
    // (ej. Grupo 3) los exigen como obligatorios, no opcionales, así que
    // se inyectan automáticamente acá para no depender de que cada ruta
    // se acuerde de mandarlos a mano.
    const standardHeaders = req ? {
        'X-Request-Id': req.requestId,
        'X-Correlation-Id': req.correlationId,
        'X-Consumer': 'bff-grupo1',
        // Reenvía la sesión del usuario al servicio upstream. Sin esto,
        // cualquier servicio que empiece a exigir Authorization (como
        // Grupo 4 lo hizo recientemente en /cart y /checkout) responde
        // 401 "Token requerido" aunque el cliente sí se lo haya mandado
        // al BFF, porque el header se perdía en el proxy.
        ...(req.headers && req.headers.authorization
            ? { Authorization: req.headers.authorization }
            : {})
    } : {};

    const finalHeaders = { ...standardHeaders, ...headers };

    if (!baseUrl) {
        return { source: 'mock', degraded: true, data: typeof mockFallback === 'function' ? mockFallback() : mockFallback, status: 200 };
    }

    try {
        const response = await axios({
            method,
            url: baseUrl.replace(/\/$/, '') + path,
            data,
            params,
            headers: finalHeaders,
            timeout
        });
        return { source: 'upstream', degraded: false, data: response.data, status: response.status };
    } catch (err) {
        if (err.response) {
            // El upstream SÍ respondió, solo que con un error (4xx de
            // validación de negocio, o 5xx propio de ese servicio). No es
            // una falla de conectividad: nunca hay que camuflar esto como
            // un mock "exitoso", porque le mentiría al usuario final sobre
            // el resultado real de su operación (ej. "carrito vacío" no
            // puede transformarse en un pedido falso creado con éxito).
            const upstreamError = new Error(
                `Upstream ${envVarName}${path} respondió ${err.response.status}`
            );
            upstreamError.isUpstreamError = true;
            upstreamError.upstreamStatus = err.response.status;
            upstreamError.upstreamData = err.response.data;
            throw upstreamError;
        }

        // Sin response = falla real de conectividad (timeout, DNS, servicio
        // caído o dormido en Render, etc.). Ahí sí aplica el fallback mock,
        // que es el caso de resiliencia para el que se diseñó esta función.
        console.warn(`[proxy] Falla al llamar ${envVarName}${path}:`, err.message);
        if (mockFallback !== undefined) {
            return { source: 'mock-fallback', degraded: true, data: typeof mockFallback === 'function' ? mockFallback() : mockFallback, status: 200 };
        }
        throw err;
    }
}

module.exports = { callUpstream };
