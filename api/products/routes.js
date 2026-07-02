const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { cacheProducts, getCachedProducts } = require('../../lib/db');
const { Errors } = require('../../lib/errors');

const mockProduct = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Caña de pescar Shimano FX',
    description: 'Caña de spinning ideal para agua dulce.',
    price: 45990,
    categoryId: 'a1b2c3d4-e5f6-7890-1234-56789abcdef0',
    categoryName: 'Cañas de Pescar',
    stockVisible: 15,
    imageUrl: 'https://cdn.marketplace.local/images/shimano-fx.jpg',
    isActive: true
};

const mockListPayload = (page, size) => ({
    data: [mockProduct],
    pagination: { page, size, total: 145, totalPages: 8 }
});

// GET /api/products
router.get('/', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const size = parseInt(req.query.size) || 20;
        const cacheKey = `products:page=${page}:size=${size}`;

        const result = await callUpstream({
            envVarName: 'PRODUCTS_SERVICE_URL',
            method: 'GET',
            path: '/products',
            params: { page, size },
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => mockListPayload(page, size)
        });

        // Si vino del servicio real, actualizamos el cache. Si vino de mock,
        // intentamos servir el último cache real conocido (mejor evidencia
        // de persistencia funcionando como resiliencia).
        if (result.source === 'upstream') {
            await cacheProducts(cacheKey, result.data);
        } else {
            const cached = await getCachedProducts(cacheKey);
            if (cached) {
                res.setHeader('X-Data-Source', 'cache');
                return res.status(200).json(cached.payload);
            }
        }

        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

// GET /api/products/search (debe ir ANTES que /:id)
router.get('/search', async (req, res, next) => {
    try {
        const q = req.query.q || '';
        if (!q) {
            return Errors.badRequest(req, res, 'El parámetro q es requerido');
        }

        const result = await callUpstream({
            envVarName: 'PRODUCTS_SERVICE_URL',
            method: 'GET',
            path: '/products/search',
            params: { q, page: req.query.page || 1, size: req.query.size || 20 },
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => ({ data: [mockProduct], pagination: { page: 1, size: 20, total: 1, totalPages: 1 } })
        });

        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

// GET /api/products/:id
router.get('/:id', async (req, res, next) => {
    try {
        const result = await callUpstream({
            envVarName: 'PRODUCTS_SERVICE_URL',
            method: 'GET',
            path: `/products/${req.params.id}`,
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => {
                if (req.params.id === '999') return null;
                return { ...mockProduct, id: req.params.id };
            }
        });

        if (!result.data) {
            return Errors.notFound(req, res, 'Producto no encontrado');
        }

        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
