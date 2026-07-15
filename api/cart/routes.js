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

// G4 (Carrito) no siempre incluye el nombre del producto en cada item —
// solo trae productId. Cuando falta, el frontend mostraba el UUID crudo en
// vez de un nombre legible, lo que además rompía el layout en móvil (un
// UUID es una sola palabra larga sin espacios). Acá se normaliza la
// convención de nombre que use G4 (name / product_name / productName) y,
// si de plano no viene, se resuelve contra el catálogo real (G3) antes de
// responder al frontend, para no depender de que G4 lo agregue algún día.
async function enrichCartItemNames(cart, req) {
    if (!cart || !Array.isArray(cart.items)) return cart;

    const items = cart.items.map((item) => ({
        ...item,
        productName: item.productName ?? item.product_name ?? item.name ?? null
    }));

    const missingIds = [...new Set(
        items.filter((item) => !item.productName && item.productId).map((item) => item.productId)
    )];

    if (missingIds.length === 0) {
        return { ...cart, items };
    }

    const lookups = await Promise.all(
        missingIds.map(async (id) => {
            try {
                const result = await callUpstream({
                    envVarName: 'PRODUCTS_SERVICE_URL',
                    method: 'GET',
                    path: `/products/${id}`,
                    headers: { 'X-Correlation-Id': req.correlationId },
                    req,
                    mockFallback: () => null
                });
                const name = result?.data?.name ?? result?.data?.product_name ?? null;
                return [id, name];
            } catch {
                // Si el catálogo no responde (o el producto ya no existe), se
                // deja sin nombre y el frontend cae a su propio fallback visual,
                // en vez de tumbar la carga completa del carrito por esto.
                return [id, null];
            }
        })
    );
    const nameById = Object.fromEntries(lookups);

    return {
        ...cart,
        items: items.map((item) =>
            item.productName ? item : { ...item, productName: nameById[item.productId] ?? item.productName }
        )
    };
}

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
        const body = result.source === 'upstream' ? await enrichCartItemNames(result.data, req) : result.data;
        res.status(200).json(body);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
