const express = require('express');
const router = express.Router();

const mockNotifications = [
    {
        id: "notif-0001",
        userId: "3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff",
        type: "ORDER_STATUS",
        title: "Tu pedido fue confirmado",
        message: "El pedido ORD-1001 ha sido confirmado y está siendo procesado.",
        read: false,
        createdAt: "2026-06-23T10:00:00Z"
    },
    {
        id: "notif-0002",
        userId: "3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff",
        type: "PROMOTION",
        title: "Oferta especial para ti",
        message: "Tienes un 15% de descuento en tu próxima compra. Válido hasta el 30/06.",
        read: true,
        createdAt: "2026-06-22T08:30:00Z"
    },
    {
        id: "notif-0003",
        userId: "3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff",
        type: "SHIPPING",
        title: "Tu pedido está en camino",
        message: "El pedido ORD-1001 ha sido despachado y llegará en 2-3 días hábiles.",
        read: false,
        createdAt: "2026-06-23T14:20:00Z"
    }
];

// GET /api/notifications?userId=
router.get('/', (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).json({
            timestamp: new Date().toISOString(),
            status: 400,
            code: "BAD_REQUEST",
            message: "El parámetro userId es requerido"
        });
    }

    const userNotifications = mockNotifications.filter(n => n.userId === userId);

    res.status(200).json({
        data: userNotifications,
        pagination: {
            page: 1,
            size: 10,
            total: userNotifications.length,
            totalPages: 1
        }
    });
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', (req, res) => {
    const { id } = req.params;

    const notification = mockNotifications.find(n => n.id === id);

    if (!notification) {
        return res.status(404).json({
            timestamp: new Date().toISOString(),
            status: 404,
            code: "NOT_FOUND",
            message: "Notificación no encontrada"
        });
    }

    res.status(200).json({
        ...notification,
        read: true,
        updatedAt: new Date().toISOString()
    });
});

// POST /api/notifications/subscriptions
router.post('/subscriptions', (req, res) => {
    const { userId, types, channel } = req.body;

    if (!userId || !types || !channel) {
        return res.status(400).json({
            timestamp: new Date().toISOString(),
            status: 400,
            code: "BAD_REQUEST",
            message: "Los campos userId, types y channel son requeridos"
        });
    }

    res.status(201).json({
        subscriptionId: "sub-" + Math.random().toString(36).substr(2, 8),
        userId,
        types,
        channel,
        active: true,
        createdAt: new Date().toISOString()
    });
});

module.exports = router;
