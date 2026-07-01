const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { saveSession, getSession } = require('../../lib/db');
const { Errors } = require('../../lib/errors');
const { uuid } = require('../../lib/uuid');

const mockUser = {
    user_id: '3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff',
    email: 'juan@ejemplo.cl',
    full_name: 'Juan Pérez González',
    role: 'customer',
    status: 'active'
};

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
    try {
        if (req.body.email === 'yaexiste@ejemplo.cl') {
            return Errors.conflict(req, res, 'El email ya está registrado');
        }
        if (!req.body.email || !req.body.password) {
            return Errors.badRequest(req, res, 'email y password son requeridos');
        }

        const result = await callUpstream({
            envVarName: 'AUTH_SERVICE_URL',
            method: 'POST',
            path: '/auth/register',
            data: req.body,
            headers: { 'X-Correlation-Id': req.correlationId },
            mockFallback: () => ({
                user: { ...mockUser, email: req.body.email, full_name: req.body.full_name || mockUser.full_name },
                access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                refresh_token: 'v1.Md90fka...',
                token_type: 'bearer',
                expires_in: 3600
            })
        });

        res.setHeader('X-Data-Source', result.source);
        res.status(201).json(result.data);
    } catch (err) {
        next(err);
    }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
    try {
        if (req.body.email === 'error@ejemplo.cl') {
            return Errors.unauthorized(req, res, 'Email o contraseña incorrectos');
        }
        if (!req.body.email || !req.body.password) {
            return Errors.badRequest(req, res, 'email y password son requeridos');
        }

        const result = await callUpstream({
            envVarName: 'AUTH_SERVICE_URL',
            method: 'POST',
            path: '/auth/login',
            data: req.body,
            headers: { 'X-Correlation-Id': req.correlationId },
            mockFallback: () => ({
                user: { ...mockUser, email: req.body.email },
                access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                refresh_token: 'v1.Md90fka...',
                token_type: 'bearer',
                expires_in: 3600
            })
        });

        const body = result.data;
        const token = body.access_token || uuid();

        // Persistimos la sesión en el BFF (BD real) para poder validarla
        // localmente en GET /api/auth/session sin re-consultar siempre a Auth.
        await saveSession({
            token,
            user_id: body.user?.user_id || mockUser.user_id,
            email: body.user?.email || req.body.email,
            full_name: body.user?.full_name || mockUser.full_name,
            role: body.user?.role || 'customer',
            expires_at: new Date(Date.now() + (body.expires_in || 3600) * 1000).toISOString()
        });

        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(body);
    } catch (err) {
        next(err);
    }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
    try {
        const result = await callUpstream({
            envVarName: 'AUTH_SERVICE_URL',
            method: 'POST',
            path: '/auth/refresh',
            data: req.body,
            headers: { 'X-Correlation-Id': req.correlationId },
            mockFallback: () => ({
                access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...nuevo',
                refresh_token: 'v1.NewRefresh...',
                token_type: 'bearer',
                expires_in: 3600
            })
        });
        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

// GET /api/auth/session
router.get('/session', async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        if (!authHeader) {
            return Errors.unauthorized(req, res, 'Token de sesión requerido');
        }
        const token = authHeader.replace('Bearer ', '');

        const session = await getSession(token);
        if (!session) {
            return Errors.unauthorized(req, res, 'Sesión inválida o expirada');
        }
        if (new Date(session.expires_at) < new Date()) {
            return Errors.unauthorized(req, res, 'Sesión expirada');
        }

        res.status(200).json({
            user: {
                user_id: session.user_id,
                email: session.email,
                full_name: session.full_name,
                role: session.role,
                status: 'active'
            },
            token_type: 'bearer',
            expires_at: session.expires_at
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/auth/logout
router.post('/logout', async (req, res, next) => {
    try {
        await callUpstream({
            envVarName: 'AUTH_SERVICE_URL',
            method: 'POST',
            path: '/auth/logout',
            headers: { 'Authorization': req.headers['authorization'] || '', 'X-Correlation-Id': req.correlationId },
            mockFallback: () => ({})
        });
        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

module.exports = router;
