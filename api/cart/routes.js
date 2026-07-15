const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { Errors } = require('../../lib/errors');
const { enrichCartItemNames, getProductStock } = require('../../lib/cartNormalize');

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
        if (!productId || typeof productId !== 'string') {
            return Errors.badRequest(req, res, 'productId es requerido');
        }
        if (!Number.isInteger(quantity) || quantity < 1) {
            return Errors.badRequest(req, res, 'quantity debe ser un entero mayor o igual a 1');
        }

        // Nunca confiamos solo en lo que envía el frontend: la fuente de
        // verdad del stock es el catálogo (G3). Se valida acá, en el
        // servidor, porque el checkout de G4 ya demostró (ver Fase 3) que
        // no siempre valida bien sus propios datos antes de aceptar una
        // operación. Si el lookup de stock falla (G3 caído), se deja pasar
        // el request en vez de bloquear al usuario por un problema nuestro
        // de resiliencia — el upstream (G4) sigue siendo el guardián final.
        const stock = await getProductStock(productId, req);
        if (stock !== null) {
            const existingCart = await callUpstream({
                envVarName: 'CART_SERVICE_URL',
                method: 'GET',
                path: `/cart/${req.params.userId}`,
                headers: {
                    'X-Correlation-Id': req.correlationId,
                    ...(req.headers['authorization'] ? { 'Authorization': req.headers['authorization'] } : {})
                },
                req,
                mockFallback: () => ({ items: [] })
            });
            const currentQty = (existingCart.data?.items || [])
                .filter((i) => (i.productId ?? i.product_id) === productId)
                .reduce((sum, i) => sum + (i.quantity || 0), 0);

            if (currentQty + quantity > stock) {
                const remaining = Math.max(0, stock - currentQty);
                return Errors.insufficientStock(
                    req,
                    res,
                    remaining > 0
                        ? `Solo quedan ${remaining} unidades disponibles de este producto`
                        : 'No hay stock disponible para este producto'
                );
            }
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
