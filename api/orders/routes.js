const express = require('express');
const router = express.Router();

const mockOrder = {
    orderId: "ORD-1001",
    userId: "3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff",
    status: "PAID",
    totalAmount: 109950,
    items: [
        {
            productId: "550e8400-e29b-41d4-a716-446655440000",
            productName: "Caña de pescar Shimano FX",
            quantity: 2,
            unitPrice: 45990,
            subtotal: 91980
        }
    ],
    createdAt: "2026-06-17T10:30:00Z",
    updatedAt: "2026-06-17T10:45:00Z"
};

// GET /api/orders
router.get('/', (req, res) => {
    res.status(200).json({
        data: [mockOrder],
        pagination: {
            page: 1,
            size: 10,
            total: 1,
            totalPages: 1
        }
    });
});

// GET /api/orders/:orderId
router.get('/:orderId', (req, res) => {
    if (req.params.orderId === '999') {
        return res.status(404).json({
            timestamp: new Date().toISOString(),
            status: 404,
            code: "NOT_FOUND",
            message: "Pedido no encontrado"
        });
    }

    res.status(200).json({ ...mockOrder, orderId: req.params.orderId });
});

module.exports = router;