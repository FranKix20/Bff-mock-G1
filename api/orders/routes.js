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

// G5 (Pedidos) tiene tres inconsistencias reales entre sus propios dos
// endpoints, confirmadas con pruebas curl directas:
//  1. Casing distinto: GET /orders/{id} responde camelCase (orderNumber,
//     userId, totalAmount, createdAt), pero GET /orders?... (listado)
//     responde snake_case (order_number, user_id, total_amount, created_at)
//     para el mismo tipo de dato.
//  2. totalAmount cambia de tipo: número en el detalle (49970), string en
//     el listado ("49970.00"). Normalizamos siempre a number.
//  3. Los items del detalle (unit_price, subtotal, product_id) vienen en
//     snake_case aunque el resto del objeto sea camelCase.
// G5 tampoco expone productName en los items (solo product_id), igual que
// pasó con categoryName en G3: no es algo que podamos inventar acá.
function toNumber(value) {
    if (value === undefined || value === null) return value;
    const n = typeof value === 'string' ? parseFloat(value) : value;
    return Number.isNaN(n) ? value : n;
}

function normalizeOrderItem(item) {
    if (!item) return item;
    return {
        id: item.id,
        productId: item.product_id ?? item.productId,
        productName: item.product_name ?? item.productName ?? null,
        quantity: item.quantity,
        unitPrice: toNumber(item.unit_price ?? item.unitPrice),
        subtotal: toNumber(item.subtotal)
    };
}

function normalizeOrderHistoryEntry(h) {
    if (!h) return h;
    return {
        previousStatus: h.previous_status ?? h.previousStatus ?? null,
        newStatus: h.new_status ?? h.newStatus,
        reason: h.reason,
        changedAt: h.changed_at ?? h.changedAt
    };
}

function normalizeOrder(o) {
    if (!o) return o;
    return {
        id: o.id,
        orderNumber: o.orderNumber ?? o.order_number,
        userId: o.userId ?? o.user_id,
        status: o.status,
        totalAmount: toNumber(o.totalAmount ?? o.total_amount),
        createdAt: o.createdAt ?? o.created_at,
        updatedAt: o.updatedAt ?? o.updated_at,
        ...(o.items ? { items: o.items.map(normalizeOrderItem) } : {}),
        ...(o.history ? { history: o.history.map(normalizeOrderHistoryEntry) } : {})
    };
}

function normalizeOrderListPayload(payload, fallbackPage, fallbackSize) {
    const items = (payload.data || []).map(normalizeOrder);
    const meta = payload.meta || payload.pagination || {};
    return {
        data: items,
        pagination: {
            page: meta.currentPage ?? meta.page ?? fallbackPage,
            size: meta.limit ?? meta.pageSize ?? meta.size ?? fallbackSize,
            total: meta.totalItems ?? meta.totalElements ?? meta.total,
            totalPages: meta.totalPages
        }
    };
}

// GET /api/orders
router.get('/', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const size = parseInt(req.query.size) || 10;

        const result = await callUpstream({
            envVarName: 'ORDERS_SERVICE_URL',
            method: 'GET',
            path: '/orders',
            params: { userId: req.query.userId, page, limit: size, status: req.query.status },
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => ({
                data: [mockOrder],
                pagination: { page, size, total: 1, totalPages: 1 }
            })
        });
        res.setHeader('X-Data-Source', result.source);
        const body = result.source === 'upstream'
            ? normalizeOrderListPayload(result.data, page, size)
            : result.data;
        res.status(200).json(body);
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
        const body = result.source === 'upstream' ? normalizeOrder(result.data) : result.data;
        res.status(200).json(body);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
