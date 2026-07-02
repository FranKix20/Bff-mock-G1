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

// G3 (Catálogo) responde en snake_case y con un formato de paginación
// distinto al que documenta nuestro propio contrato (openapi.yaml). Estas
// funciones traducen su respuesta real al shape camelCase que espera el
// frontend, para que no le importe qué convención use cada grupo por detrás.
// Nota: G3 no devuelve category_name en el producto (solo category_id), así
// que queda null hasta que exista un endpoint de categorías que resolverlo.
function normalizeProduct(p) {
    if (!p) return p;
    return {
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        categoryId: p.category_id ?? p.categoryId,
        categoryName: p.category_name ?? p.categoryName ?? null,
        stockVisible: p.stock_visible ?? p.stockVisible,
        imageUrl: p.image_url ?? p.imageUrl,
        isActive: p.is_active ?? p.isActive
    };
}

function normalizeListPayload(payload, fallbackPage, fallbackSize) {
    const items = (payload.data || []).map(normalizeProduct);
    const meta = payload.meta || payload.pagination || {};
    return {
        data: items,
        pagination: {
            page: meta.currentPage ?? meta.page ?? fallbackPage,
            size: meta.pageSize ?? meta.size ?? fallbackSize,
            total: meta.totalElements ?? meta.total,
            totalPages: meta.totalPages
        }
    };
}

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
            const normalized = normalizeListPayload(result.data, page, size);
            await cacheProducts(cacheKey, normalized);
            res.setHeader('X-Data-Source', result.source);
            return res.status(200).json(normalized);
        }

        const cached = await getCachedProducts(cacheKey);
        if (cached) {
            res.setHeader('X-Data-Source', 'cache');
            return res.status(200).json(cached.payload);
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
        const body = result.source === 'upstream'
            ? normalizeListPayload(result.data, req.query.page || 1, req.query.size || 20)
            : result.data;
        res.status(200).json(body);
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
        const body = result.source === 'upstream' ? normalizeProduct(result.data) : result.data;
        res.status(200).json(body);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
