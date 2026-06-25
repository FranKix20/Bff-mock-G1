const express = require('express');
const router = express.Router();

// POST /api/checkout
router.post('/', (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({
            timestamp: new Date().toISOString(),
            status: 400,
            code: 'BAD_REQUEST',
            message: 'El campo userId es requerido'
        });
    }

    res.status(201).json({
        orderId: 'ORD-' + Math.floor(1000 + Math.random() * 9000),
        userId: userId,
        status: 'PAID',
        totalAmount: 91980,
        items: [
            {
                productId: '550e8400-e29b-41d4-a716-446655440000',
                productName: 'Cana de pescar Shimano FX',
                quantity: 2,
                unitPrice: 45990,
                subtotal: 91980
            }
        ],
        paymentMethod: 'credit_card',
        shippingAddress: {
            street: 'Av. Providencia 1234',
            city: 'Santiago',
            region: 'Metropolitana',
            country: 'CL',
            zipCode: '7500000'
        },
        createdAt: new Date().toISOString()
    });
});

module.exports = router;
