const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { Errors } = require('../../lib/errors');

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
            mockFallback: () => {
                const filtered = mockNotifications.filter(n => n.userId === userId);
                return { data: filtered, pagination: { page, size, total: filtered.length, totalPages: 1 } };
            }
        });

        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req, res, next) => {
    try {
        const result = await callUpstream({
            envVarName: 'NOTIFICATIONS_SERVICE_URL',
            method: 'PATCH',
            path: `/notifications/${req.params.id}/read`,
            headers: { 'X-Correlation-Id': req.correlationId },
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
        res.status(200).json(result.data);
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
