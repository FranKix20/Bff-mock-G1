const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { Errors } = require('../../lib/errors');

const mockOrder = {
    orderId: 'ORD-1001',
    userId: '3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff',
    status: 'PAID',
    totalAmount: 109950,
    items: [
        {
            productId: '550e8400-e29b-41d4-a716-446655440000',
            productName: 'Caña de pescar Shimano FX',
            quantity: 2,
            unitPrice: 45990,
            subtotal: 91980
        }
    ],
    createdAt: '2026-06-17T10:30:00Z',
    updatedAt: '2026-06-17T10:45:00Z'
};

// GET /api/orders
router.get('/', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const size = parseInt(req.query.size) || 10;

        const result = await callUpstream({
            envVarName: 'ORDERS_SERVICE_URL',
            method: 'GET',
            path: '/orders',
            params: { userId: req.query.userId, page, size },
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => ({
                data: [mockOrder],
                pagination: { page, size, total: 1, totalPages: 1 }
            })
        });
        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

// GET /api/orders/:orderId
router.get('/:orderId', async (req, res, next) => {
    try {
        const result = await callUpstream({
            envVarName: 'ORDERS_SERVICE_URL',
            method: 'GET',
            path: `/orders/${req.params.orderId}`,
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => {
                if (req.params.orderId === '999') return null;
                return { ...mockOrder, orderId: req.params.orderId };
            }
        });

        if (!result.data) {
            return Errors.notFound(req, res, 'Pedido no encontrado');
        }

        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
