const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { Errors } = require('../../lib/errors');

// G8 (Despacho y Logística) ya responde en camelCase con exactamente el
// shape documentado en su openapi.yaml (shipmentId, orderId, userId,
// status, lines, shipTo, driverId, driverName, createdAt, updatedAt,
// deliveredAt, proof, version) — a diferencia de G3/G4/G5, no hace falta
// normalizar snake_case → camelCase acá. Si en el futuro cambian su
// contrato, este es el lugar donde correspondería agregar ese mapeo.

const mockShipment = (orderId) => ({
    shipmentId: 'shp_mock0001',
    orderId,
    userId: 'USR-01',
    status: 'PICKING',
    lines: [{ sku: 'SKU-0001', qty: 2, description: 'Producto de ejemplo' }],
    shipTo: {
        fullName: 'Cliente de prueba',
        addressLine1: 'Av. Siempre Viva 123',
        city: 'Santiago',
        region: 'Metropolitana',
        postalCode: '8320000',
        country: 'CL'
    },
    driverId: null,
    driverName: null,
    reshipOf: null,
    createdAt: '2026-07-10T14:00:00Z',
    updatedAt: '2026-07-10T14:00:00Z',
    deliveredAt: null,
    proof: null,
    version: 1
});

// GET /api/shipments/by-order/:orderId
//
// Endpoint pensado para la pantalla de detalle de pedido del frontend:
// un pedido puede no tener envío todavía (si G5 no ha llegado a
// READY_TO_SHIP), así que en vez de forzar un 404 que el frontend tendría
// que capturar como error, se responde 200 con `null` cuando G8 no tiene
// ningún envío para ese orderId — la UI simplemente no muestra la sección
// de despacho en ese caso.
router.get('/by-order/:orderId', async (req, res, next) => {
    try {
        const result = await callUpstream({
            envVarName: 'SHIPMENTS_SERVICE_URL',
            method: 'GET',
            path: '/v1/shipments',
            params: { orderId: req.params.orderId, pageSize: 1 },
            headers: {
                'X-Correlation-Id': req.correlationId,
                'X-Consumer': 'bff-grupo1'
            },
            req,
            mockFallback: () => ({ items: [mockShipment(req.params.orderId)], page: 1, pageSize: 1, total: 1 })
        });

        res.setHeader('X-Data-Source', result.source);
        const shipment = (result.data?.items || [])[0] || null;
        res.status(200).json(shipment);
    } catch (err) {
        next(err);
    }
});

// GET /api/shipments/:shipmentId
//
// Detalle directo por id de envío (para uso futuro: panel propio, o si el
// frontend guarda el shipmentId después de la primera consulta).
router.get('/:shipmentId', async (req, res, next) => {
    try {
        const result = await callUpstream({
            envVarName: 'SHIPMENTS_SERVICE_URL',
            method: 'GET',
            path: `/v1/shipments/${req.params.shipmentId}`,
            headers: {
                'X-Correlation-Id': req.correlationId,
                'X-Consumer': 'bff-grupo1'
            },
            req,
            mockFallback: () => mockShipment('ORD-MOCK')
        });

        if (!result.data) {
            return Errors.notFound(req, res, 'Envío no encontrado');
        }

        res.setHeader('X-Data-Source', result.source);
        res.status(200).json(result.data);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
