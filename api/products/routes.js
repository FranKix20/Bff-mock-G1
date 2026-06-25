const express = require('express');
const router = express.Router();

const mockProduct = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Caña de pescar Shimano FX",
    description: "Caña de spinning ideal para agua dulce.",
    price: 45990,
    categoryId: "a1b2c3d4-e5f6-7890-1234-56789abcdef0",
    categoryName: "Cañas de Pescar",
    stockVisible: 15,
    imageUrl: "https://cdn.marketplace.local/images/shimano-fx.jpg",
    isActive: true
};

// GET /api/products
router.get('/', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 20;

    res.status(200).json({
        data: [mockProduct],
        pagination: {
            page: page,
            size: size,
            total: 145,
            totalPages: 8
        }
    });
});

// GET /api/products/search (Debe ir ANTES que /:id para que Express no se confunda)
router.get('/search', (req, res) => {
    const q = req.query.q || '';
    res.status(200).json({
        data: [mockProduct],
        pagination: { page: 1, size: 20, total: 1, totalPages: 1 }
    });
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
    if (req.params.id === '999') {
        return res.status(404).json({
            timestamp: new Date().toISOString(),
            status: 404,
            code: "NOT_FOUND",
            message: "Recurso no encontrado"
        });
    }
    
    // Devolvemos el mock modificando el ID para que coincida con lo que pidió
    res.status(200).json({ ...mockProduct, id: req.params.id });
});

module.exports = router;