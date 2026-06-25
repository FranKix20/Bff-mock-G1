const express = require('express');
const router = express.Router();

const getMockCart = (userId) => ({
    id: "990e8400-e29b-41d4-a716-446655440444",
    userId: userId,
    status: "ACTIVE",
    items: [
        {
            id: "880e8400-e29b-41d4-a716-446655440333",
            productId: "550e8400-e29b-41d4-a716-446655440000",
            productName: "Caña de pescar Shimano FX",
            quantity: 2,
            unitPrice: 45990,
            subtotal: 91980
        }
    ],
    totalAmount: 91980,
    createdAt: "2026-06-15T14:30:00Z",
    updatedAt: new Date().toISOString()
});

// GET /api/cart/:userId
router.get('/:userId', (req, res) => {
    res.status(200).json(getMockCart(req.params.userId));
});

// POST /api/cart/:userId/items
router.post('/:userId/items', (req, res) => {
    // Simula agregar un producto y devuelve el carrito actualizado
    res.status(201).json(getMockCart(req.params.userId));
});

// DELETE /api/cart/:userId/items/:productId
router.delete('/:userId/items/:productId', (req, res) => {
    // Simula carrito vacío tras borrar
    const emptyCart = getMockCart(req.params.userId);
    emptyCart.items = [];
    emptyCart.totalAmount = 0;
    
    res.status(200).json(emptyCart);
});

module.exports = router;