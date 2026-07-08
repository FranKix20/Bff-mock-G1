const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { Errors } = require('../../lib/errors');

const getMockCart = (userId, items = null) => ({
    id: '990e8400-e29b-41d4-a716-446655440444',
    userId,
    status: 'ACTIVE',
    items: items ?? [
        {
            id: '880e8400-e29b-41d4-a716-446655440333',
            productId: '550e8400-e29b-41d4-a716-446655440000',
            productName: 'Caña de pescar Shimano FX',
            quantity: 2,
            unitPrice: 45990,
            subtotal: 91980
        }
    ],
    totalAmount: items ? items.reduce((sum, i) => sum + i.subtotal, 0) : 91980,
    createdAt: '2026-06-15T14:30:00Z',
    updatedAt: new Date().toISOString()
});

// GET /api/cart/:userId
router.get('/:userId', async (req, res, next) => {
    try {
        const result = await callUpstream({
            envVarName: 'CART_SERVICE_URL',
            method: 'GET',
            path: `/cart/${req.params.userId}`,
            headers: {
                'X-Correlation-Id': req.correlationId,
                ...(req.headers['authorization'] ? { 'Authorization': req.headers['authorization'] } : {})
            },
            req,
            mockFallback: () => getMockCart(req.params.userId)
        });
        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

// POST /api/cart/:userId/items
router.post('/:userId/items', async (req, res, next) => {
    try {
        const { productId, quantity } = req.body;
        if (!productId || !quantity || quantity < 1) {
            return Errors.badRequest(req, res, 'productId y quantity (>=1) son requeridos');
        }

        const result = await callUpstream({
            envVarName: 'CART_SERVICE_URL',
            method: 'POST',
            path: `/cart/${req.params.userId}/items`,
            data: req.body,
            headers: {
                'X-Correlation-Id': req.correlationId,
                ...(req.headers['authorization'] ? { 'Authorization': req.headers['authorization'] } : {})
            },
            req,
            mockFallback: () => getMockCart(req.params.userId)
        });
        res.setHeader('X-Data-Source', result.source);
        res.status(201).json(result.data);
    } catch (err) {
        next(err);
    }
});

// DELETE /api/cart/:userId/items/:productId
router.delete('/:userId/items/:productId', async (req, res, next) => {
    try {
        const result = await callUpstream({
            envVarName: 'CART_SERVICE_URL',
            method: 'DELETE',
            path: `/cart/${req.params.userId}/items/${req.params.productId}`,
            headers: {
                'X-Correlation-Id': req.correlationId,
                ...(req.headers['authorization'] ? { 'Authorization': req.headers['authorization'] } : {})
            },
            req,
            mockFallback: () => getMockCart(req.params.userId, [])
        });
        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
