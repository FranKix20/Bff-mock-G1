const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { getIdempotentResponse, saveIdempotentResponse } = require('../../lib/db');
const { Errors } = require('../../lib/errors');
const { fetchNormalizedCart } = require('../../lib/cartNormalize');

/**
 * Crea el pago en Grupo 6 (Mercado Pago Checkout Pro) y devuelve el
 * initPoint para que el FRONTEND redirija al usuario ahí a pagar de
 * verdad. El BFF NO llama a /confirm — según el contrato real de G6,
 * confirm/reject son solo para forzar manualmente un estado (demo/testing);
 * el estado real lo cambia Mercado Pago vía su propio webhook.
 *
 * El Authorization del usuario se reenvía automáticamente a G6 porque
 * callUpstream ya inyecta el header cuando se le pasa `req` (ver
 * lib/proxy.js) — G6 exige JWT válido de Grupo 2 en este endpoint.
 */
async function createPayment({ amount, orderId, idempotencyKey, req }) {
    if (typeof amount !== 'number' || amount <= 0) {
        return { status: 'UNAVAILABLE', reason: 'No se pudo determinar el monto a cobrar' };
    }

    try {
        const created = await callUpstream({
            envVarName: 'PAYMENT_SERVICE_URL',
            method: 'POST',
            path: '/api/payments',
            data: {
                amount,
                currency: 'CLP',
                orderId,
                description: 'Pedido FishMarket'
            },
            headers: {
                'Idempotency-Key': idempotencyKey + '-pay-create',
                'X-Correlation-Id': req.correlationId
            },
            timeout: 15000,
            req,
            mockFallback: () => ({
                id: 'PAY-MOCK-' + Math.floor(1000 + Math.random() * 9000),
                amount,
                currency: 'CLP',
                status: 'PENDING',
                orderId,
                initPoint: null
            })
        });

        return {
            id: created.data?.id ?? null,
            status: created.data?.status ?? 'PENDING',
            amount: created.data?.amount ?? amount,
            currency: created.data?.currency ?? 'CLP',
            initPoint: created.data?.initPoint ?? null
        };
    } catch (err) {
        console.warn('[checkout] Falla al crear pago con G6:', err.message);
        return { status: 'UNAVAILABLE', reason: 'El servicio de pagos no respondió' };
    }
}

/**
 * G4 devuelve el "order_number" legible (ej. "ORD-1784177256148") en su
 * campo `orderId` — pero la clave primaria real del pedido en G5 es un
 * UUID, y es ESE UUID el que G5 necesita recibir de vuelta en el webhook
 * de PaymentApproved para poder encontrar el pedido y disparar el resto
 * de la cadena (pasar a PAID, avisar a G8 para crear el envío, etc).
 * Si a G6 le mandamos el order_number como orderId, el pago se aprueba
 * igual, pero G5 nunca logra correlacionarlo con nada — es exactamente
 * el problema que confirmaron entre G4/G5/G6.
 *
 * Se resuelve el UUID real consultando el mismo listado de G5 que ya usa
 * el resto del BFF (GET /orders?userId=...), buscando el pedido cuyo
 * order_number coincide con el que acaba de devolver G4. El checkout de
 * G4 ya valida sincrónicamente contra G5 antes de responder, así que el
 * pedido debería existir ahí de inmediato — no hace falta reintentar.
 *
 * Es best-effort: si G5 no responde o no aparece el match (por ejemplo,
 * si G5 está temporalmente degradado), se hace fallback al order_number
 * tal cual, que es el comportamiento anterior — el pago igual se crea,
 * solo que sin garantía de que G5 lo pueda correlacionar automáticamente.
 */
async function resolveOrderUuid(userId, orderNumber, req) {
    if (!userId || !orderNumber) return null;
    try {
        const result = await callUpstream({
            envVarName: 'ORDERS_SERVICE_URL',
            method: 'GET',
            path: '/orders',
            params: { userId, page: 1, size: 20, limit: 20 },
            headers: { 'X-Correlation-Id': req.correlationId },
            timeout: 8000,
            req,
            mockFallback: () => ({ data: [] })
        });

        const list = result.data?.data || result.data?.items || [];
        const match = list.find((o) => (o.order_number ?? o.orderNumber) === orderNumber);
        return match?.id ?? null;
    } catch (err) {
        console.warn('[checkout] No se pudo resolver el UUID del pedido en G5:', err.message);
        return null;
    }
}

// POST /api/checkout
router.post('/', async (req, res, next) => {
    try {
        const { userId, paymentMethod, shippingAddress } = req.body;
        const idempotencyKey = req.headers['idempotency-key'];
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!userId) {
            return Errors.badRequest(req, res, 'El campo userId es requerido');
        }
        if (!idempotencyKey) {
            return Errors.badRequest(req, res, 'El header Idempotency-Key es requerido');
        }
        if (!uuidPattern.test(idempotencyKey)) {
            return Errors.badRequest(req, res, 'El header Idempotency-Key debe ser un UUID válido');
        }

        const existing = await getIdempotentResponse(idempotencyKey);
        if (existing) {
            res.setHeader('X-Idempotent-Replay', 'true');
            return res.status(existing.status_code).json(existing.response);
        }

        const cartSnapshot = await fetchNormalizedCart(userId, req).catch(() => null);

        const result = await callUpstream({
            envVarName: 'CHECKOUT_SERVICE_URL',
            method: 'POST',
            path: '/checkout',
            data: { userId },
            headers: {
                'Idempotency-Key': idempotencyKey,
                'X-Correlation-Id': req.correlationId
            },
            timeout: 15000,
            req,
            mockFallback: () => ({
                attemptId: 'ATT-' + Math.floor(1000 + Math.random() * 9000),
                orderId: 'ORD-' + Math.floor(1000 + Math.random() * 9000),
                status: 'SUCCESS',
                message: 'Orden procesada correctamente (mock)'
            })
        });
            
        const orderNumber = result.data?.id ?? result.data?.orderId ?? null;
        const totalAmount = cartSnapshot?.totalAmount ?? null;

        // Este es el paso que cierra el problema: el pago en G6 se crea
        // con el UUID real de G5 (si se pudo resolver), no con el
        // order_number legible que devuelve G4.
        const resolvedOrderUuid = await resolveOrderUuid(userId, orderNumber, req);
        const paymentOrderId = resolvedOrderUuid || orderNumber;

        if (orderNumber && !resolvedOrderUuid) {
            console.warn(
                `[checkout] No se pudo resolver el UUID de G5 para el pedido ${orderNumber}; ` +
                'se envió a G6 el order_number como fallback, sin garantía de correlación en G5.'
            );
        }

        const payment = await createPayment({
            amount: totalAmount,
            orderId: paymentOrderId,
            idempotencyKey,
            req
        });

        const enriched = {
            orderId: orderNumber,
            attemptId: result.data?.attemptId ?? null,
            status: result.data?.status ?? 'SUCCESS',
            message: result.data?.message ?? null,
            totalAmount,
            items: cartSnapshot?.items ?? [],
            paymentMethod: paymentMethod || 'credit_card',
            shippingAddress: shippingAddress || null,
            payment,
            createdAt: new Date().toISOString()
        };

        await saveIdempotentResponse(idempotencyKey, enriched, 201);

        res.setHeader('X-Data-Source', result.source);
        res.status(201).json(enriched);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
