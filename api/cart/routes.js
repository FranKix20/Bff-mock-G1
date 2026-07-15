const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { Errors } = require('../../lib/errors');
const { enrichCartItemNames } = require('../../lib/cartNormalize');

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
        const body = result.source === 'upstream' ? await enrichCartItemNames(result.data, req) : result.data;
        res.status(200).json(body);
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
        const body = result.source === 'upstream' ? await enrichCartItemNames(result.data, req) : result.data;
        res.status(201).json(body);
    } catch (err) {
        next(err);
    }
});

// DELETE /api/cart/:userId/items/:productId
//
// El paquete de integración de G4 (E5) confirma que este endpoint
// responde 204 sin body cuando elimina bien el item — no un carrito
// actualizado como asumía el mock original. Si se le pasaba ese body
// vacío directo a enrichCartItemNames() y se reenviaba tal cual, el
// frontend recibía un JSON vacío en vez del carrito, y la UI del
// carrito se quedaba pegada en el estado anterior o rompía. Por eso acá,
// cuando el upstream real confirma el 204, se pide el carrito actualizado
// con un GET aparte antes de responder.
router.delete('/:userId/items/:productId', async (req, res, next) => {
    try {
        const deleteResult = await callUpstream({
            envVarName: 'CART_SERVICE_URL',
            method: 'DELETE',
            path: `/cart/${req.params.userId}/items/${req.params.productId}`,
            headers: {
                'X-Correlation-Id': req.correlationId,
                ...(req.headers['authorization'] ? { 'Authorization': req.headers['authorization'] } : {})
            },
            req,
            mockFallback: () => null // marcador: el mock arma la respuesta más abajo
        });

        res.setHeader('X-Data-Source', deleteResult.source);

        if (deleteResult.source !== 'upstream') {
            return res.status(200).json(getMockCart(req.params.userId, []));
        }

        // Upstream real: el DELETE ya se aplicó (204). Se pide el carrito
        // actualizado en un segundo request para devolverle al frontend
        // el estado real, no un eco vacío.
        const freshCart = await callUpstream({
            envVarName: 'CART_SERVICE_URL',
            method: 'GET',
            path: `/cart/${req.params.userId}`,
            headers: {
                'X-Correlation-Id': req.correlationId,
                ...(req.headers['authorization'] ? { 'Authorization': req.headers['authorization'] } : {})
            },
            req,
            mockFallback: () => getMockCart(req.params.userId, [])
        });

        const body = await enrichCartItemNames(freshCart.data, req);
        res.status(200).json(body);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
