require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');

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
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log('[' + timestamp + '] ' + req.method + ' ' + req.path);
    next();
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'UP',
        service: 'BFF Grupo 1',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        platform: 'Vercel'
    });
});

app.get('/', (req, res) => {
    res.status(200).json({
        message: 'Bienvenido al BFF Grupo 1',
        version: '1.0.0',
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
            docs: 'https://github.com/FranKix20/Bff-mock-G1'
        }
    });
});

try {
    const authRoutes = require('./api/auth/routes');
    app.use('/api/auth', authRoutes);
    console.log('Rutas de Auth cargadas');
} catch (err) {
    console.warn('Rutas de Auth no encontradas:', err.message);
}

try {
    const productRoutes = require('./api/products/routes');
    app.use('/api/products', productRoutes);
    console.log('Rutas de Productos cargadas');
} catch (err) {
    console.warn('Rutas de Productos no encontradas:', err.message);
}

try {
    const cartRoutes = require('./api/cart/routes');
    app.use('/api/cart', cartRoutes);
    console.log('Rutas de Carrito cargadas');
} catch (err) {
    console.warn('Rutas de Carrito no encontradas:', err.message);
}

try {
    const checkoutRoutes = require('./api/checkout/routes');
    app.use('/api/checkout', checkoutRoutes);
    console.log('Rutas de Checkout cargadas');
} catch (err) {
    console.warn('Rutas de Checkout no encontradas:', err.message);
}

try {
    const orderRoutes = require('./api/orders/routes');
    app.use('/api/orders', orderRoutes);
    console.log('Rutas de Ordenes cargadas');
} catch (err) {
    console.warn('Rutas de Ordenes no encontradas:', err.message);
}

try {
    const notificationRoutes = require('./api/notifications/routes');
    app.use('/api/notifications', notificationRoutes);
    console.log('Rutas de Notificaciones cargadas');
} catch (err) {
    console.warn('Rutas de Notificaciones no encontradas:', err.message);
}

app.use((req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada',
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
        hint: 'Revisa la documentacion en GET /'
    });
});

app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);

    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Error interno del servidor';

    res.status(status).json({
        error: message,
        status: status,
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

if (process.env.VERCEL_ENV === undefined) {
    const PORT = process.env.PORT || 3001;

    const server = app.listen(PORT, () => {
        console.log('BFF Grupo 1 corriendo en http://localhost:' + PORT);
        console.log('Environment: ' + (process.env.NODE_ENV || 'development'));
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
