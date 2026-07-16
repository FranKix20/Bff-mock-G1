const request = require('supertest');
const app = require('../index');
const { randomUUID } = require('crypto');

describe('Health & routing', () => {
    test('GET /health responde 200 con estado UP', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('UP');
    });

    test('Ruta inexistente responde 404 con formato de error estándar', async () => {
        const res = await request(app).get('/api/ruta-que-no-existe');
        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('timestamp');
        expect(res.body).toHaveProperty('status', 404);
        expect(res.body).toHaveProperty('code');
        expect(res.body).toHaveProperty('message');
    });
});

describe('Auth', () => {
    test('POST /api/auth/login sin body requerido responde 400', async () => {
        const res = await request(app).post('/api/auth/login').send({});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('BAD_REQUEST');
    });

    test('POST /api/auth/login con credenciales válidas responde 200 y access_token', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'juan@ejemplo.cl', password: 'MiClave123' });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('access_token');
    });

    test('GET /api/auth/session sin token responde 401', async () => {
        const res = await request(app).get('/api/auth/session');
        expect(res.status).toBe(401);
    });
});

describe('Products', () => {
    test('GET /api/products responde 200 con paginación', async () => {
        const res = await request(app).get('/api/products?page=1&size=10');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('data');
        expect(res.body).toHaveProperty('pagination');
    });

    test('GET /api/products/999 responde 404', async () => {
        const res = await request(app).get('/api/products/999');
        expect(res.status).toBe(404);
    });
});

describe('Checkout - idempotencia (caso obligatorio del curso)', () => {
    test('Dos POST /api/checkout con la misma Idempotency-Key: en modo degradado retorna 503 (Grupo 4 no responde)', async () => {
        const idempotencyKey = randomUUID();
        const payload = { userId: 'USR-TEST-01' };

        const first = await request(app)
            .post('/api/checkout')
            .set('Idempotency-Key', idempotencyKey)
            .send(payload);

        expect(first.status).toBe(503);
        expect(first.body.error).toBe('CHECKOUT_UNAVAILABLE');

        const second = await request(app)
            .post('/api/checkout')
            .set('Idempotency-Key', idempotencyKey)
            .send(payload);

        expect(second.status).toBe(503);
    });

    test('POST /api/checkout sin Idempotency-Key responde 400', async () => {
        const res = await request(app).post('/api/checkout').send({ userId: 'USR-1' });
        expect(res.status).toBe(400);
    });
});

describe('Carrito - tope de stock', () => {
    test('POST /api/cart/:userId/items sin productId o quantity responde 400', async () => {
        const res = await request(app).post('/api/cart/USR-TEST-01/items').send({});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('BAD_REQUEST');
    });

    test('POST /api/cart/:userId/items agrega normalmente cuando el stock no se pudo verificar (modo degradado)', async () => {
        const res = await request(app)
            .post('/api/cart/USR-TEST-01/items')
            .send({ productId: '550e8400-e29b-41d4-a716-446655440000', quantity: 2 });
        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('items');
    });
});

describe('Pagos (Grupo 6)', () => {
    test('POST /api/payments sin amount responde 400', async () => {
        const res = await request(app).post('/api/payments').send({ orderId: 'ORD-1' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('BAD_REQUEST');
    });

    test('POST /api/payments crea un pago (modo degradado sin PAYMENT_SERVICE_URL)', async () => {
        const res = await request(app)
            .post('/api/payments')
            .send({ amount: 15000, currency: 'CLP', orderId: 'ORD-1' });
        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('id');
        expect(res.body.status).toBe('PENDING');
    });

    test('POST /api/payments/:id/confirm mueve el pago a APPROVED', async () => {
        const created = await request(app).post('/api/payments').send({ amount: 5000 });
        const res = await request(app).post(`/api/payments/${created.body.id}/confirm`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('APPROVED');
    });

    test('GET /api/payments/:id de un pago inexistente responde 404', async () => {
        const res = await request(app).get('/api/payments/no-existe-123');
        expect(res.status).toBe(404);
    });
});

describe('Checkout integrado con Pagos (Grupo 6)', () => {
    test('POST /api/checkout en modo degradado (Grupo 4 no disponible) retorna 503 CHECKOUT_UNAVAILABLE', async () => {
        const idempotencyKey = randomUUID();
        const res = await request(app)
            .post('/api/checkout')
            .set('Idempotency-Key', idempotencyKey)
            .send({ userId: 'USR-TEST-01' });

        expect(res.status).toBe(503);
        expect(res.body).toHaveProperty('error', 'CHECKOUT_UNAVAILABLE');
        expect(res.body).toHaveProperty('message');
        expect(res.body.orderId).toBeNull();
        expect(res.body.payment).toBeNull();
    });
});
