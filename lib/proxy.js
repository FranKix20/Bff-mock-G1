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
async function callUpstream({ envVarName, method = 'GET', path = '', data, params, headers = {}, timeout = 4000, mockFallback }) {
    const baseUrl = process.env[envVarName];

    if (!baseUrl) {
        return { source: 'mock', degraded: true, data: typeof mockFallback === 'function' ? mockFallback() : mockFallback, status: 200 };
    }

    try {
        const response = await axios({
            method,
            url: baseUrl.replace(/\/$/, '') + path,
            data,
            params,
            headers,
            timeout
        });
        return { source: 'upstream', degraded: false, data: response.data, status: response.status };
    } catch (err) {
        console.warn(`[proxy] Falla al llamar ${envVarName}${path}:`, err.message);
        if (mockFallback !== undefined) {
            return { source: 'mock-fallback', degraded: true, data: typeof mockFallback === 'function' ? mockFallback() : mockFallback, status: 200 };
        }
        throw err;
    }
}

module.exports = { callUpstream };
