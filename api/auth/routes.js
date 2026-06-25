const express = require('express');
const router = express.Router();

// POST /api/auth/register
router.post('/register', (req, res) => {
    // Si mandan un email que ya existe, simulamos el error 409 del YAML
    if (req.body.email === 'yaexiste@ejemplo.cl') {
        return res.status(409).json({
            timestamp: new Date().toISOString(),
            status: 409,
            code: "EMAIL_ALREADY_EXISTS",
            message: "El email ya está registrado"
        });
    }

    res.status(201).json({
        user: {
            user_id: "3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff",
            email: req.body.email || "juan@ejemplo.cl",
            full_name: req.body.full_name || "Juan Pérez González",
            role: "customer",
            status: "active"
        },
        access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        refresh_token: "v1.Md90fka...",
        token_type: "bearer",
        expires_in: 3600
    });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
    if (req.body.email === 'error@ejemplo.cl') {
        return res.status(401).json({
            timestamp: new Date().toISOString(),
            status: 401,
            code: "UNAUTHORIZED",
            message: "Email o contraseña incorrectos"
        });
    }

    res.status(200).json({
        user: {
            user_id: "3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff",
            email: req.body.email,
            full_name: "Juan Pérez González",
            role: "customer",
            status: "active"
        },
        access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        refresh_token: "v1.Md90fka...",
        token_type: "bearer",
        expires_in: 3600
    });
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
    res.status(200).json({
        access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...nuevo",
        refresh_token: "v1.NewRefresh...",
        token_type: "bearer",
        expires_in: 3600
    });
});

// GET /api/auth/session
router.get('/session', (req, res) => {
    res.status(200).json({
        user: {
            user_id: "3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff",
            email: "juan@ejemplo.cl",
            full_name: "Juan Pérez González",
            role: "customer",
            status: "active"
        },
        token_type: "bearer",
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString()
    });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    res.status(204).send();
});

module.exports = router;