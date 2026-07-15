const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { getIdempotentResponse, saveIdempotentResponse } = require('../../lib/db');
const { Errors } = require('../../lib/errors');
const { fetchNormalizedCart } = require('../../lib/cartNormalize');

// POST /api/checkout
// Requiere header Idempotency-Key. Si la misma key ya fue procesada,
// se devuelve la respuesta guardada en vez de generar un pedido duplicado.
router.post('/', async (req, res, next) => {
    try {
        const { userId, paymentMethod, shippingAddress } = req.body;
        const idempotencyKey = req.headers['idempotency-key'];
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!userId) {
            return Errors.badRequest(req, res, 'El campo userId es requerido');
        }
        if (!idempotencyKey) {
            return Errors.badRequest(req, res, 'El header Idempotency-Key es requerido');
        }
        if (!uuidPattern.test(idempotencyKey)) {
            return Errors.badRequest(req, res, 'El header Idempotency-Key debe ser un UUID válido');
        }

        const existing = await getIdempotentResponse(idempotencyKey);
        if (existing) {
            res.setHeader('X-Idempotent-Replay', 'true');
            return res.status(existing.status_code).json(existing.response);
        }

        // El paquete de integración de G4 (E5) confirma que POST /checkout
        // solo acepta { "userId": ... } en el body — paymentMethod y
        // shippingAddress no son parte de su contrato, así que NO se le
        // reenvían (evita que una validación estricta de su lado rechace
        // campos que no reconoce). Se guardan localmente para devolvérselos
        // al frontend igual, junto con el snapshot del carrito.
        //
        // También confirma que la respuesta exitosa de G4 es mínima:
        // { attemptId, orderId, status, message } — sin items ni
        // totalAmount. Por eso se saca una foto del carrito ANTES de
        // llamar a checkout (después del checkout, G4 vacía el carrito) y
        // se arma la respuesta completa que el frontend ya espera.
        const cartSnapshot = await fetchNormalizedCart(userId, req).catch(() => null);

        const result = await callUpstream({
            envVarName: 'CHECKOUT_SERVICE_URL',
            method: 'POST',
            path: '/checkout',
            data: { userId },
            headers: {
                'Idempotency-Key': idempotencyKey,
                'X-Correlation-Id': req.correlationId
            },
            // El checkout de G4 encadena una validación con G5. El timeout
            // default de proxy.js (4s) es insuficiente para esa cadena
            // completa, sobre todo si algún servicio está recién
            // despertando en Render.
            timeout: 15000,
            req,
            mockFallback: () => ({
                attemptId: 'ATT-' + Math.floor(1000 + Math.random() * 9000),
                orderId: 'ORD-' + Math.floor(1000 + Math.random() * 9000),
                status: 'SUCCESS',
                message: 'Orden procesada correctamente (mock)'
            })
        });

        const enriched = {
            orderId: result.data?.orderId ?? null,
            attemptId: result.data?.attemptId ?? null,
            status: result.data?.status ?? 'SUCCESS',
            message: result.data?.message ?? null,
            totalAmount: cartSnapshot?.totalAmount ?? null,
            items: cartSnapshot?.items ?? [],
            paymentMethod: paymentMethod || 'credit_card',
            shippingAddress: shippingAddress || null,
            createdAt: new Date().toISOString()
        };

        await saveIdempotentResponse(idempotencyKey, enriched, 201);

        res.setHeader('X-Data-Source', result.source);
        res.status(201).json(enriched);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
