const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { getIdempotentResponse, saveIdempotentResponse } = require('../../lib/db');
const { Errors } = require('../../lib/errors');

// POST /api/checkout
// Requiere header Idempotency-Key. Si la misma key ya fue procesada,
// se devuelve la respuesta guardada en vez de generar un pedido duplicado.
router.post('/', async (req, res, next) => {
    try {
        const { userId } = req.body;
        const idempotencyKey = req.headers['idempotency-key'];

        if (!userId) {
            return Errors.badRequest(req, res, 'El campo userId es requerido');
        }
        if (!idempotencyKey) {
            return Errors.badRequest(req, res, 'El header Idempotency-Key es requerido');
        }

        const existing = await getIdempotentResponse(idempotencyKey);
        if (existing) {
            res.setHeader('X-Idempotent-Replay', 'true');
            return res.status(existing.status_code).json(existing.response);
        }

        const result = await callUpstream({
            envVarName: 'CHECKOUT_SERVICE_URL',
            method: 'POST',
            path: '/checkout',
            data: req.body,
            headers: {
                'Idempotency-Key': idempotencyKey,
                'X-Correlation-Id': req.correlationId
            },
            mockFallback: () => ({
                orderId: 'ORD-' + Math.floor(1000 + Math.random() * 9000),
                userId,
                status: 'PAID',
                totalAmount: 91980,
                items: [
                    {
                        productId: '550e8400-e29b-41d4-a716-446655440000',
                        productName: 'Caña de pescar Shimano FX',
                        quantity: 2,
                        unitPrice: 45990,
                        subtotal: 91980
                    }
                ],
                paymentMethod: req.body.paymentMethod || 'credit_card',
                shippingAddress: req.body.shippingAddress || {
                    street: 'Av. Providencia 1234',
                    city: 'Santiago',
                    region: 'Metropolitana',
                    country: 'CL',
                    zipCode: '7500000'
                },
                createdAt: new Date().toISOString()
            })
        });

        await saveIdempotentResponse(idempotencyKey, result.data, 201);

        res.setHeader('X-Data-Source', result.source);
        res.status(201).json(result.data);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
