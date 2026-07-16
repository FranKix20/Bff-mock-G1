const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { Errors } = require('../../lib/errors');

// El listado de notificaciones se veía bien en la validación inicial
// (título, mensaje, tipo y fecha calzaban con lo esperado), pero eso
// escondía que G9 usa un nombre de campo distinto para el identificador
// (`notification_id` en vez de `id`). Como el resto del contenido
// coincidía, el bug no se notó hasta que se intentó marcar una como
// leída: el frontend mandaba PATCH /api/notifications/undefined/read
// porque n.id nunca existió. Se normaliza acá, igual que ya se hace con
// carrito y pedidos, en vez de confiar en que el campo se llame como el
// mock asumía.
function normalizeNotification(n) {
    if (!n) return n;
    return {
        id: n.id ?? n.notification_id ?? n.notificationId ?? n._id ?? null,
        userId: n.userId ?? n.user_id ?? null,
        type: n.type ?? null,
        title: n.title ?? null,
        message: n.message ?? null,
        read: n.read ?? n.is_read ?? n.isRead ?? false,
        createdAt: n.createdAt ?? n.created_at ?? null
    };
}

function normalizeNotificationListPayload(payload, fallbackPage, fallbackSize) {
    const rawItems = payload.data ?? payload.notifications ?? payload.items ?? (Array.isArray(payload) ? payload : []);
    const meta = payload.pagination ?? payload.meta ?? {};
    return {
        data: rawItems.map(normalizeNotification),
        pagination: {
            page: meta.page ?? meta.currentPage ?? fallbackPage,
            size: meta.size ?? meta.pageSize ?? meta.limit ?? fallbackSize,
            total: meta.total ?? meta.totalItems ?? rawItems.length,
            totalPages: meta.totalPages ?? 1
        }
    };
}

const mockNotifications = [
    {
        id: 'notif-0001',
        userId: '3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff',
        type: 'ORDER_STATUS',
        title: 'Tu pedido fue confirmado',
        message: 'El pedido ORD-1001 ha sido confirmado y está siendo procesado.',
        read: false,
        createdAt: '2026-06-23T10:00:00Z'
    },
    {
        id: 'notif-0002',
        userId: '3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff',
        type: 'PROMOTION',
        title: 'Oferta especial para ti',
        message: 'Tienes un 15% de descuento en tu próxima compra. Válido hasta el 30/06.',
        read: true,
        createdAt: '2026-06-22T08:30:00Z'
    },
    {
        id: 'notif-0003',
        userId: '3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff',
        type: 'SHIPPING',
        title: 'Tu pedido está en camino',
        message: 'El pedido ORD-1001 ha sido despachado y llegará en 2-3 días hábiles.',
        read: false,
        createdAt: '2026-06-23T14:20:00Z'
    }
];

// GET /api/notifications?userId=
router.get('/', async (req, res, next) => {
    try {
        const { userId } = req.query;
        if (!userId) {
            return Errors.badRequest(req, res, 'El parámetro userId es requerido');
        }

        const page = parseInt(req.query.page) || 1;
        const size = parseInt(req.query.size) || 10;

        const result = await callUpstream({
            envVarName: 'NOTIFICATIONS_SERVICE_URL',
            method: 'GET',
            path: '/notifications',
            params: { userId, page, size },
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => {
                const filtered = mockNotifications.filter(n => n.userId === userId);
                return { data: filtered, pagination: { page, size, total: filtered.length, totalPages: 1 } };
            }
        });

        res.setHeader('X-Data-Source', result.source);
        const body = result.source === 'upstream'
            ? normalizeNotificationListPayload(result.data, page, size)
            : result.data;
        res.status(200).json(body);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req, res, next) => {
    try {
        // Si el frontend llega a mandar "undefined" (ej. por un id mal
        // resuelto en el listado), se corta acá con un 400 claro en vez
        // de reenviarlo tal cual a G9 y devolver un 404 confuso.
        if (!req.params.id || req.params.id === 'undefined' || req.params.id === 'null') {
            return Errors.badRequest(req, res, 'id de notificación inválido');
        }

        const result = await callUpstream({
            envVarName: 'NOTIFICATIONS_SERVICE_URL',
            method: 'PATCH',
            path: `/notifications/${req.params.id}/read`,
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => {
                const notification = mockNotifications.find(n => n.id === req.params.id);
                if (!notification) return null;
                return { ...notification, read: true, updatedAt: new Date().toISOString() };
            }
        });

        if (!result.data) {
            return Errors.notFound(req, res, 'Notificación no encontrada');
        }

        res.setHeader('X-Data-Source', result.source);
        const body = result.source === 'upstream' ? normalizeNotification(result.data) : result.data;
        res.status(200).json(body);
    } catch (err) {
        next(err);
    }
});

// POST /api/notifications/subscriptions
router.post('/subscriptions', async (req, res, next) => {
    try {
        const { userId, types, channel } = req.body;
        if (!userId || !types || !channel) {
            return Errors.badRequest(req, res, 'Los campos userId, types y channel son requeridos');
        }

        const result = await callUpstream({
            envVarName: 'NOTIFICATIONS_SERVICE_URL',
            method: 'POST',
            path: '/notifications/subscriptions',
            data: req.body,
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => ({
                subscriptionId: 'sub-' + Math.random().toString(36).substr(2, 8),
                userId,
                types,
                channel,
                active: true,
                createdAt: new Date().toISOString()
            })
        });

        res.setHeader('X-Data-Source', result.source);
        res.status(201).json(result.data);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
