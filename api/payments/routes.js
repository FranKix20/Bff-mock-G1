const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { Errors } = require('../../lib/errors');
const { uuid } = require('../../lib/uuid');

// Proxy a Grupo 6 (Pagos). El servicio real vive en Render y expone su
// propia colección bajo /api/payments, así que la ruta upstream es la
// misma que la nuestra (path = req.originalUrl relativo a este router).
//
// G6 requiere el header Idempotency-Key en los POST para no reprocesar
// una misma operación dos veces (ej. doble click en "confirmar pago").
// El header es opcional en su middleware, pero acá SIEMPRE se manda uno
// (el del cliente si vino, o uno generado) para que cualquier reintento
// automático del BFF (ej. checkout confirmando el pago recién creado)
// quede protegido también.
const MOCK_PAYMENTS = new Map();

function mockPayment(overrides = {}) {
    const id = overrides.id || 'PAY-MOCK-' + Math.floor(1000 + Math.random() * 9000);
    const payment = {
        id,
        amount: overrides.amount ?? 0,
        currency: overrides.currency || 'CLP',
        status: overrides.status || 'PENDING',
        orderId: overrides.orderId ?? null,
        version: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confirmedAt: overrides.status === 'APPROVED' ? new Date().toISOString() : null,
        rejectedAt: overrides.status === 'REJECTED' ? new Date().toISOString() : null
    };
    MOCK_PAYMENTS.set(id, payment);
    return payment;
}

// POST /api/payments
router.post('/', async (req, res, next) => {
    try {
        const { amount, currency, orderId } = req.body || {};
        if (typeof amount !== 'number' || amount <= 0) {
            return Errors.badRequest(req, res, 'El campo amount es requerido y debe ser un número positivo');
        }

        const idempotencyKey = req.headers['idempotency-key'] || uuid();

        const result = await callUpstream({
            envVarName: 'PAYMENT_SERVICE_URL',
            method: 'POST',
            path: '/api/payments',
            data: { amount, currency: currency || 'CLP', orderId },
            headers: {
                'Idempotency-Key': idempotencyKey,
                'X-Correlation-Id': req.correlationId
            },
            timeout: 15000,
            req,
            mockFallback: () => mockPayment({ amount, currency: currency || 'CLP', orderId, status: 'PENDING' })
        });

        res.setHeader('X-Data-Source', result.source);
        res.status(result.source === 'upstream' ? 201 : 201).json(result.data);
    } catch (err) {
        next(err);
    }
});

// GET /api/payments/stats — DEBE registrarse antes de /:id
router.get('/stats', async (req, res, next) => {
    try {
        const result = await callUpstream({
            envVarName: 'PAYMENT_SERVICE_URL',
            method: 'GET',
            path: '/api/payments/stats',
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => ({
                total: MOCK_PAYMENTS.size,
                byStatus: { PENDING: 0, APPROVED: 0, REJECTED: 0 }
            })
        });
        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

// GET /api/payments — listar (?status=&orderId=)
router.get('/', async (req, res, next) => {
    try {
        const { status, orderId } = req.query;
        const result = await callUpstream({
            envVarName: 'PAYMENT_SERVICE_URL',
            method: 'GET',
            path: '/api/payments',
            params: { status, orderId },
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => {
                const all = [...MOCK_PAYMENTS.values()];
                return all.filter((p) => (!status || p.status === status) && (!orderId || p.orderId === orderId));
            }
        });
        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

// GET /api/payments/:id
router.get('/:id', async (req, res, next) => {
    try {
        const result = await callUpstream({
            envVarName: 'PAYMENT_SERVICE_URL',
            method: 'GET',
            path: `/api/payments/${req.params.id}`,
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => MOCK_PAYMENTS.get(req.params.id) || null
        });

        if (!result.data) {
            return Errors.notFound(req, res, `Pago ${req.params.id} no encontrado`);
        }

        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

// POST /api/payments/:id/confirm — PENDING -> APPROVED
router.post('/:id/confirm', async (req, res, next) => {
    try {
        const idempotencyKey = req.headers['idempotency-key'] || uuid();
        const result = await callUpstream({
            envVarName: 'PAYMENT_SERVICE_URL',
            method: 'POST',
            path: `/api/payments/${req.params.id}/confirm`,
            headers: {
                'Idempotency-Key': idempotencyKey,
                'X-Correlation-Id': req.correlationId
            },
            timeout: 15000,
            req,
            mockFallback: () => {
                const existing = MOCK_PAYMENTS.get(req.params.id);
                return mockPayment({ ...existing, id: req.params.id, status: 'APPROVED' });
            }
        });
        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

// POST /api/payments/:id/reject — PENDING -> REJECTED
router.post('/:id/reject', async (req, res, next) => {
    try {
        const idempotencyKey = req.headers['idempotency-key'] || uuid();
        const result = await callUpstream({
            envVarName: 'PAYMENT_SERVICE_URL',
            method: 'POST',
            path: `/api/payments/${req.params.id}/reject`,
            headers: {
                'Idempotency-Key': idempotencyKey,
                'X-Correlation-Id': req.correlationId
            },
            timeout: 15000,
            req,
            mockFallback: () => {
                const existing = MOCK_PAYMENTS.get(req.params.id);
                return mockPayment({ ...existing, id: req.params.id, status: 'REJECTED' });
            }
        });
        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
