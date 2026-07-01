const { uuid } = require('../lib/uuid');

/**
 * Middleware de contexto de request.
 * Propaga (o genera si no vienen) los headers obligatorios definidos
 * en el contrato base del curso: X-Request-Id y X-Correlation-Id.
 * También expone req.consumer a partir de X-Consumer (útil para logs/auditoría).
 */
function requestContext(req, res, next) {
    const requestId = req.headers['x-request-id'] || uuid();
    const correlationId = req.headers['x-correlation-id'] || uuid();
    const consumer = req.headers['x-consumer'] || 'unknown';

    req.requestId = requestId;
    req.correlationId = correlationId;
    req.consumer = consumer;

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Correlation-Id', correlationId);

    next();
}

module.exports = { requestContext };
