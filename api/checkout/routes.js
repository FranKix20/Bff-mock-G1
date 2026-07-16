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
        
        if (result.source !== 'upstream') {
            console.warn('[checkout] Grupo 4 no respondió, abortando checkout');
            return res.status(503).json({
                error: 'CHECKOUT_UNAVAILABLE',
                message: 'El servicio de pedidos no está disponible, no se puede procesar el checkout en este momento',
                orderId: null,
                payment: null
            });
        }
        
        const orderId = result.data?.id ?? result.data?.orderId ?? null;
        const totalAmount = cartSnapshot?.totalAmount ?? null;

        const payment = await createPayment({
            amount: totalAmount,
            orderId,
            idempotencyKey,
            req
        });

        const enriched = {
            orderId,
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
