const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { Errors } = require('../../lib/errors');
const { uuid } = require('../../lib/uuid');

// Proxy a Grupo 7 (Inventario real — reposición/ajuste de stock).
//
// OJO: esto es distinto de /api/inventory, que ya existe y apunta al
// reporte de "bajo stock" de Grupo 10 (Reportería). Grupo 7 expone su
// propio servicio de inventario real (crear/consultar/ajustar stock por
// producto), confirmado contra su repo:
//   GET  /inventory              -> lista paginada { data, pagination }
//   GET  /inventory/:productId   -> { productId, availableStock,
//                                     reservedStock, totalStock, virtualStock }
//   POST /inventory/:productId/stock  -> exige Authorization Bearer (admin,
//                                     validado por ellos contra G2) +
//                                     Idempotency-Key. Body: { quantity,
//                                     operation: 'SET' | 'ADD' }.
// callUpstream ya reenvía Authorization y agrega X-Consumer automáticamente
// (ver lib/proxy.js), así que no hay que repetir eso acá.

// GET /api/stock?page=&size=
router.get('/', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const size = parseInt(req.query.size) || 100;

        const result = await callUpstream({
            envVarName: 'INVENTORY_SERVICE_URL',
            method: 'GET',
            path: '/inventory',
            params: { page, size },
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => ({
                data: [],
                pagination: { page, size, total: 0, totalPages: 0 }
            })
        });
        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

// GET /api/stock/:productId
router.get('/:productId', async (req, res, next) => {
    try {
        const result = await callUpstream({
            envVarName: 'INVENTORY_SERVICE_URL',
            method: 'GET',
            path: `/inventory/${req.params.productId}`,
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => null
        });

        if (result.source === 'upstream') {
            res.setHeader('X-Data-Source', result.source);
            return res.status(200).json(result.data);
        }

        // Sin INVENTORY_SERVICE_URL configurada o G7 caído: no se inventa
        // un stock falso para un producto puntual (induciría a error a un
        // admin decidiendo si reponer o no) — se marca explícitamente como
        // "sin datos" en vez de disfrazarlo de cero real.
        res.setHeader('X-Data-Source', result.source);
        return res.status(200).json({
            productId: req.params.productId,
            availableStock: null,
            reservedStock: null,
            totalStock: null,
            virtualStock: null,
            unavailable: true
        });
    } catch (err) {
        if (err.isUpstreamError && err.upstreamStatus === 404) {
            // Producto sin fila de inventario todavía (ej. recién creado en
            // G3 y aún no sincronizado vía /inventory/sync-catalog) — no es
            // un error real, es "sin registrar", así que no se propaga
            // como 404 genérico opaco al panel admin.
            return res.status(200).json({
                productId: req.params.productId,
                availableStock: null,
                reservedStock: null,
                totalStock: null,
                virtualStock: null,
                unregistered: true
            });
        }
        next(err);
    }
});

// POST /api/stock/:productId
// Requiere sesión de admin (el JWT del propio usuario logueado se reenvía
// tal cual; G7 valida el rol contra G2 de su lado). No lleva mockFallback
// a propósito: si G7 no responde, el admin tiene que enterarse de que el
// ajuste de stock NO se aplicó, no recibir un falso "listo".
router.post('/:productId', async (req, res, next) => {
    try {
        const { quantity, operation } = req.body || {};

        if (typeof quantity !== 'number' || quantity < 0) {
            return Errors.badRequest(req, res, 'El campo quantity es requerido y debe ser un número mayor o igual a 0');
        }
        if (operation !== 'SET' && operation !== 'ADD') {
            return Errors.badRequest(req, res, "El campo operation debe ser 'SET' o 'ADD'");
        }

        const idempotencyKey = req.headers['idempotency-key'] || uuid();

        const result = await callUpstream({
            envVarName: 'INVENTORY_SERVICE_URL',
            method: 'POST',
            path: `/inventory/${req.params.productId}/stock`,
            data: { quantity, operation },
            headers: {
                'Idempotency-Key': idempotencyKey,
                'X-Correlation-Id': req.correlationId
            },
            timeout: 8000,
            req
        });

        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
