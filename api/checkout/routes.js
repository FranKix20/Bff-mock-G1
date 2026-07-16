const express = require('express');
const router = express.Router();
const { callUpstream } = require('../../lib/proxy');
const { getIdempotentResponse, saveIdempotentResponse } = require('../../lib/db');
const { Errors } = require('../../lib/errors');
const { fetchNormalizedCart } = require('../../lib/cartNormalize');

/**
 * Procesa el cobro contra Grupo 6 (Pagos) una vez que el pedido ya fue
 * creado en G4/G5. Hasta ahora el "método de pago" que elegía el usuario
 * en el frontend era puramente decorativo: no se llamaba a ningún
 * servicio de pagos real. Esto lo conecta de verdad:
 *   1. POST /api/payments (PENDING) con el monto real del carrito.
 *   2. POST /api/payments/:id/confirm (PENDING -> APPROVED), porque en
 *      este ecosistema el "pago simulado" del checkout no tiene un paso
 *      de autorización separado del usuario: al confirmar la compra, el
 *      pago se da por aprobado de inmediato.
 * G6 publica PaymentApproved a RabbitMQ tras el confirm, que es lo que
 * consume G5 para pasar el pedido a PAID y G10 para reportería — sin
 * este paso, el pedido nunca avanza más allá de STOCK_RESERVED.
 *
 * Es best-effort: si G6 no está disponible o el monto no se pudo
 * determinar (falló el snapshot del carrito), el checkout NO se cae —
 * ya se le creó el pedido al usuario en G4/G5 — solo se informa que el
 * pago quedó pendiente de sincronización.
 */
async function processPayment({ amount, orderId, idempotencyKey, req }) {
    if (typeof amount !== 'number' || amount <= 0) {
        return { status: 'UNAVAILABLE', reason: 'No se pudo determinar el monto a cobrar' };
    }

    try {
        const created = await callUpstream({
            envVarName: 'PAYMENT_SERVICE_URL',
            method: 'POST',
            path: '/api/payments',
            data: { amount, currency: 'CLP', orderId },
            headers: {
                'Idempotency-Key': idempotencyKey + '-pay-create',
                'X-Correlation-Id': req.correlationId
            },
            timeout: 15000,
            req,
            mockFallback: () => ({
                id: 'PAY-MOCK-' + Math.floor(1000 + Math.random() * 9000),
                amount,
                currency: 'CLP',
                status: 'PENDING',
                orderId
            })
        });

        const paymentId = created.data && created.data.id;
        if (!paymentId) {
            return { status: 'UNAVAILABLE', reason: 'Respuesta de pagos sin id' };
        }

        const confirmed = await callUpstream({
            envVarName: 'PAYMENT_SERVICE_URL',
            method: 'POST',
            path: '/api/payments/' + paymentId + '/confirm',
            headers: {
                'Idempotency-Key': idempotencyKey + '-pay-confirm',
                'X-Correlation-Id': req.correlationId
            },
            timeout: 15000,
            req,
            mockFallback: () => Object.assign({}, created.data, { status: 'APPROVED' })
        });

        return {
            id: paymentId,
            status: (confirmed.data && confirmed.data.status) || 'APPROVED',
            amount: (confirmed.data && confirmed.data.amount) || amount,
            currency: (confirmed.data && confirmed.data.currency) || 'CLP',
            confirmedAt: (confirmed.data && confirmed.data.confirmedAt) || new Date().toISOString()
        };
    } catch (err) {
        // Igual que con el resto de upstreams: un 4xx/5xx real de G6 (ej.
        // rechazo de negocio) no debe camuflarse ni cortar el checkout,
        // pero sí hay que reflejarlo para no mentirle al usuario diciendo
        // que su pago fue aprobado cuando no fue así.
        console.warn('[checkout] Falla al procesar pago con G6:', err.message);
        return { status: 'UNAVAILABLE', reason: 'El servicio de pagos no respondió' };
    }
}

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

        const existing = await
