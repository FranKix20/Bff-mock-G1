const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');

// Proxy a Grupo 10 (Reportería). Reenvía cualquier GET bajo /api/reports/*
// hacia G10 en /api/v1/reports/*, con el token del admin y el correlation-id.
// G10 exige Authorization: Bearer <token> validado contra G2 en todas sus
// rutas de reportes, así que ese header SIEMPRE se reenvía si viene.
router.use(async (req, res, next) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Método no soportado en reportería' });
    }
    try {
        const result = await callUpstream({
            envVarName: 'REPORTS_SERVICE_URL',
            method: 'GET',
            path: `/api/v1/reports${req.url}`,
            headers: {
                'X-Correlation-Id': req.correlationId,
                ...(req.headers['authorization'] ? { 'Authorization': req.headers['authorization'] } : {})
            },
            req,
            mockFallback: () => ({ message: 'Reportería (G10) no disponible', mocked: true })
        });
        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

module.exports = router;