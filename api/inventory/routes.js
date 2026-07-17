const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');

// Proxy a Grupo 10 (Reportería) — mismo servicio que /api/reports, pero 
// su endpoint de inventario vive bajo un prefijo distinto en su lado
// (/api/v1/inventory en vez de /api/v1/reports), así que necesita su
// propio router aunque reutilice la misma variable de entorno.
router.use(async (req, res, next) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Método no soportado en inventario' });
    }
    try {
        const result = await callUpstream({
            envVarName: 'REPORTS_SERVICE_URL',
            method: 'GET',
            path: `/api/v1/inventory${req.url}`,
            headers: {
                'X-Correlation-Id': req.correlationId,
                ...(req.headers['authorization'] ? { 'Authorization': req.headers['authorization'] } : {})
            },
            req,
            mockFallback: () => ({ threshold: 10, totalProducts: 0, products: [], source: 'mock' })
        });
        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
