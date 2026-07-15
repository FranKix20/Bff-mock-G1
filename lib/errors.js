/**
 * Formato de error estándar acordado para el ecosistema Mini Marketplace Cloud:
 * {
 *   timestamp, status, code, message, correlationId
 * }
 */
class ApiError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function sendError(req, res, status, code, message) {
    return res.status(status).json({
        timestamp: new Date().toISOString(),
        status,
        code,
        message,
        correlationId: req.correlationId || null
    });
}

// Errores comunes reutilizables
const Errors = {
    badRequest: (req, res, message = 'Solicitud inválida') =>
        sendError(req, res, 400, 'BAD_REQUEST', message),
    unauthorized: (req, res, message = 'No autorizado') =>
        sendError(req, res, 401, 'UNAUTHORIZED', message),
    notFound: (req, res, message = 'Recurso no encontrado') =>
        sendError(req, res, 404, 'NOT_FOUND', message),
    conflict: (req, res, message = 'La solicitud ya fue procesada') =>
        sendError(req, res, 409, 'DUPLICATED_REQUEST', message),
    upstreamUnavailable: (req, res, message = 'Servicio dependiente no disponible') =>
        sendError(req, res, 502, 'UPSTREAM_UNAVAILABLE', message),
    internal: (req, res, message = 'Error interno del servidor') =>
        sendError(req, res, 500, 'INTERNAL_ERROR', message)
};

module.exports = { ApiError, sendError, Errors };
