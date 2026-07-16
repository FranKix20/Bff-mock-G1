const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { getIdempotentResponse, saveIdempotentResponse } = require('../../lib/db');
const { Errors } = require('../../lib/errors');
const { fetchNormalizedCart } = require('../../lib/cartNormalize');

async function processPayment({ amount, orderId, idempotencyKey, req }) {
    if (typeof amount !== 'number' || amount <= 0) {
        return { status: 'UNAVAILABLE', reason: 'No se pudo determinar el monto a cobrar' };
    }

    try {
        const created = await callUpstream({
            envVarName: 'PAYMENT_SERVICE_URL',
            method: 'POST',
            path: '/api/payments',
            data: { amount, currency: 'CLP', orderId },
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
                orderId
            })
        });

        const paymentId = created.data && created.data.id;
        if (!paymentId) {
            return { status: 'UNAVAILABLE', reason: 'Respuesta de pagos sin id' };
        }

        const confirmed = await callUpstream({
            envVarName: 'PAYMENT_SERVICE_URL',
            method: 'POST',
            path: '/api/payments/' + paymentId + '/confirm',
            headers: {
                'Idempotency-Key': idempotencyKey + '-pay-confirm',
                'X-Correlation-Id': req.correlationId
            },
            timeout: 15000,
            req,
            mockFallback: () => Object.assign({}, created.data, { status: 'APPROVED' })
        });

        return {
            id: paymentId,
            status: (confirmed.data && confirmed.data.status) || 'APPROVED',
            amount: (confirmed.data && confirmed.data.amount) || amount,
            currency: (confirmed.data && confirmed.data.currency) || 'CLP',
            confirmedAt: (confirmed.data && confirmed.data.confirmedAt) || new Date().toISOString()
        };
    } catch (err) {
        console.warn('[checkout] Falla al procesar pago con G6:', err.message);
        return { status: 'UNAVAILABLE', reason: 'El servicio de pagos no respondió' };
    }
}

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

        const orderId = result.data?.orderId ?? null;
        const totalAmount = cartSnapshot?.totalAmount ?? null;

        const payment = await processPayment({
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
