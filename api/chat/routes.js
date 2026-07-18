const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { Errors } = require('../../lib/errors');

// Categorías válidas según el código real de G11 (faq.controller.ts).
// Nota: el contrato openapi de G11 solo documenta 4 categorías (sin
// faq_devoluciones), pero el controlador real acepta 5. Se usa la lista
// real para no rechazar de más.
const VALID_FAQ_CATEGORIES = ['faq_envios', 'faq_pagos', 'faq_productos', 'faq_cuenta', 'faq_devoluciones'];

// G11 (Chatbot) responde y espera snake_case en su propio código real
// (session_id, correlation_id, intent_detected, sources_consulted), aunque
// su contrato openapi documente camelCase (sessionId, correlationId). Se
// normaliza acá para que el frontend reciba siempre camelCase, igual que
// el resto de este BFF.
function normalizeChatResponse(data) {
    if (!data) return data;
    return {
        sessionId: data.session_id ?? data.sessionId,
        response: data.response,
        intentDetected: data.intent_detected ?? data.intentDetected,
        sourcesConsulted: data.sources_consulted ?? data.sourcesConsulted ?? [],
        correlationId: data.correlation_id ?? data.correlationId ?? null,
        timestamp: data.timestamp
    };
}

const mockChatResponse = (sessionId, message) => ({
    sessionId,
    response: `(Simulado) Recibí tu mensaje: "${message}". El servicio de chat aún no está conectado.`,
    intentDetected: 'unknown',
    sourcesConsulted: [],
    correlationId: null,
    timestamp: new Date().toISOString()
});

// POST /api/chat
// El contrato openapi de G11 (v1.2) documenta este endpoint como
// POST /chat/message, pero el código real desplegado (chat.routes.ts) lo
// expone en POST /chat, sin /message. Se usa la ruta real verificada en
// el código fuente (no la del documento) porque es la que efectivamente
// responde en producción — con /chat/message G11 devuelve 404.
router.post('/', async (req, res, next) => {
    try {
        const { sessionId, message, userId } = req.body || {};

        if (!sessionId || typeof sessionId !== 'string') {
            return Errors.badRequest(req, res, "El campo 'sessionId' es requerido");
        }
        if (!message || typeof message !== 'string' || !message.trim()) {
            return Errors.badRequest(req, res, "El campo 'message' es requerido y no puede estar vacío");
        }

        const apiKey = process.env.CHATBOT_API_KEY;

        const result = await callUpstream({
            envVarName: 'CHATBOT_SERVICE_URL',
            method: 'POST',
            path: '/chat',
            data: {
                session_id: sessionId,
                message,
                context: { user_id: userId ?? null }
            },
            headers: {
                'X-Correlation-Id': req.correlationId,
                ...(apiKey ? { 'X-Api-Key': apiKey } : {})
            },
            // Sin esto, callUpstream usaba su default de 4000ms — muy
            // corto para una respuesta de IA (Gemini) real, y peor aún si
            // el servicio de Render estaba dormido (30-50s para
            // "despertar" en el primer request). El resultado era que el
            // BFF se rendía y caía al mock aunque G11 fuera a responder
            // bien un par de segundos después. Health/FAQ no llaman a un
            // LLM, por eso a esos sí les alcanzaba el default.
            timeout: 20000,
            req,
            mockFallback: () => mockChatResponse(sessionId, message)
        });

        res.setHeader('X-Data-Source', result.source);
        const body = result.source === 'upstream' ? normalizeChatResponse(result.data) : result.data;
        res.status(200).json(body);
    } catch (err) {
        next(err);
    }
});

// GET /api/chat/faq/:category
router.get('/faq/:category', async (req, res, next) => {
    try {
        const { category } = req.params;
        if (!VALID_FAQ_CATEGORIES.includes(category)) {
            return Errors.badRequest(
                req,
                res,
                `La categoría '${category}' no es válida. Use: ${VALID_FAQ_CATEGORIES.join(', ')}`
            );
        }

        const apiKey = process.env.CHATBOT_API_KEY;

        const result = await callUpstream({
            envVarName: 'CHATBOT_SERVICE_URL',
            method: 'GET',
            path: `/chat/faq/${category}`,
            headers: {
                'X-Correlation-Id': req.correlationId,
                ...(apiKey ? { 'X-Api-Key': apiKey } : {})
            },
            req,
            mockFallback: () => ({
                category,
                items: [
                    {
                        question: '(Simulado) ¿Cómo hago seguimiento a mi pedido?',
                        answer: 'El servicio de FAQ del chatbot aún no está conectado.'
                    }
                ],
                generated_at: new Date().toISOString(),
                correlationId: req.correlationId
            })
        });

        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

// GET /api/chat/health
// El widget del frontend (botón de la tuerca) usa esta ruta para mostrar el
// estado de las dependencias del chatbot (Gemini, Supabase, etc). Antes no
// existía, así que el frontend caía siempre a su fallback de llamar directo
// a Render desde el navegador (lo que además exige que Render tenga CORS
// habilitado para el dominio del frontend). Proxyando acá, pasa por el mismo
// camino que el resto de las rutas y no depende del CORS de un tercero.
router.get('/health', async (req, res, next) => {
    try {
        const apiKey = process.env.CHATBOT_API_KEY;

        const result = await callUpstream({
            envVarName: 'CHATBOT_SERVICE_URL',
            method: 'GET',
            path: '/health',
            headers: {
                'X-Correlation-Id': req.correlationId,
                ...(apiKey ? { 'X-Api-Key': apiKey } : {})
            },
            req,
            mockFallback: () => ({
                status: 'error',
                version: null,
                dependencies: {}
            })
        });

        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
