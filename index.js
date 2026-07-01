require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { requestContext } = require('./middleware/context');
const { logRequest, persistenceEnabled } = require('./lib/db');
const { sendError } = require('./lib/errors');

const app = express();

const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    process.env.FRONTEND_URL,
    'https://bff-mock-g1.vercel.app'
];

app.use(cors({
    origin: (origin, callback) => {
        if (process.env.NODE_ENV === 'development' || !origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id', 'X-Correlation-Id', 'X-Consumer']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestContext);

app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log('[' + timestamp + '] ' + req.method + ' ' + req.path + ' (req:' + req.requestId + ')');

    res.on('finish', () => {
        logRequest({
            request_id: req.requestId,
            correlation_id: req.correlationId,
            consumer: req.consumer,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            created_at: new Date().toISOString()
        }).catch(err => console.error('[log] Error registrando request:', err.message));
    });

    next();
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'UP',
        service: 'BFF Grupo 1',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        platform: 'Vercel',
        persistence: persistenceEnabled ? 'supabase' : 'in-memory (degraded)',
        upstreams: {
            auth: !!process.env.AUTH_SERVICE_URL,
            products: !!process.env.PRODUCTS_SERVICE_URL,
            cart: !!process.env.CART_SERVICE_URL,
            checkout: !!process.env.CHECKOUT_SERVICE_URL,
            orders: !!process.env.ORDERS_SERVICE_URL,
            notifications: !!process.env.NOTIFICATIONS_SERVICE_URL
        }
    });
});

app.get('/', (req, res) => {
    res.status(200).json({
        message: 'Bienvenido al BFF Grupo 1',
        version: '2.0.0',
        environment: process.env.NODE_ENV || 'development',
        endpoints: {
            auth: '/api/auth',
            products: '/api/products',
            cart: '/api/cart',
            checkout: '/api/checkout',
            orders: '/api/orders',
            notifications: '/api/notifications',
            health: '/health'
        },
        links: {
            docs: 'https://github.com/FranKix20/Bff-mock-G1',
            openapi: '/docs/openapi.yaml'
        }
    });
});

const mount = (path, modulePath, label) => {
    try {
        app.use(path, require(modulePath));
        console.log(`Rutas de ${label} cargadas`);
    } catch (err) {
        console.warn(`Rutas de ${label} no encontradas:`, err.message);
    }
};

mount('/api/auth', './api/auth/routes', 'Auth');
mount('/api/products', './api/products/routes', 'Productos');
mount('/api/cart', './api/cart/routes', 'Carrito');
mount('/api/checkout', './api/checkout/routes', 'Checkout');
mount('/api/orders', './api/orders/routes', 'Ordenes');
mount('/api/notifications', './api/notifications/routes', 'Notificaciones');

app.use((req, res) => {
    sendError(req, res, 404, 'ROUTE_NOT_FOUND', `Ruta no encontrada: ${req.method} ${req.path}`);
});

app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);

    const status = err.status || err.statusCode || 500;
    const code = err.code || 'INTERNAL_ERROR';

    sendError(req, res, status, code, err.message || 'Error interno del servidor');
});

if (process.env.VERCEL_ENV === undefined && process.env.NODE_ENV !== 'test') {
    const PORT = process.env.PORT || 3001;

    const server = app.listen(PORT, () => {
        console.log('BFF Grupo 1 corriendo en http://localhost:' + PORT);
        console.log('Environment: ' + (process.env.NODE_ENV || 'development'));
        console.log('Persistencia: ' + (persistenceEnabled ? 'Supabase conectado' : 'modo degradado (memoria local)'));
    });

    process.on('SIGTERM', () => {
        console.log('SIGTERM recibido: cerrando servidor');
        server.close(() => {
            console.log('Servidor cerrado');
            process.exit(0);
        });
    });
}

module.exports = app;
module.exports.default = app;
