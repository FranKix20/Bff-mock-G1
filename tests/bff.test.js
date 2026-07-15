const request = require('supertest');

// Estos tests validan la regla de negocio nueva: el BFF no debe dejar
// agregar al carrito más unidades de las que hay en stock real (G3),
// incluso si G4 (carrito) no lo valida bien de su lado. Para esto se
// simulan las respuestas de G3 (stock) y G4 (carrito actual) con axios
// mockeado, apuntando el BFF a URLs "reales" para que no caiga al mock
// interno (que no tiene stock configurable).
jest.mock('axios');
const axios = require('axios');

const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440000';

beforeAll(() => {
    process.env.PRODUCTS_SERVICE_URL = 'https://g3.test';
    process.env.CART_SERVICE_URL = 'https://g4.test';
});

afterAll(() => {
    delete process.env.PRODUCTS_SERVICE_URL;
    delete process.env.CART_SERVICE_URL;
});

// Requerido después de fijar las env vars, porque index.js/proxy.js las
// lee al momento de cada llamada (no al importar), pero se deja acá por
// claridad y consistencia con el resto de la suite.
const app = require('../index');

function mockUpstream({ stock, cartItems }) {
    axios.mockImplementation(({ method, url }) => {
        if (url.includes('/products/')) {
            return Promise.resolve({ data: { stockVisible: stock }, status: 200 });
        }
        if (method === 'GET' && url.includes('/cart/')) {
            return Promise.resolve({ data: { items: cartItems }, status: 200 });
        }
        if (method === 'POST' && url.includes('/items')) {
            return Promise.resolve({ data: { id: 'cart-1', items: cartItems, totalAmount: 0 }, status: 201 });
        }
        return Promise.reject(new Error(`ruta no mockeada: ${method} ${url}`));
    });
}

describe('Límite de stock al agregar al carrito', () => {
    afterEach(() => {
        axios.mockReset();
    });

    test('rechaza con 409 INSUFFICIENT_STOCK si la cantidad supera el stock disponible', async () => {
        mockUpstream({
            stock: 5,
            cartItems: [{ productId: PRODUCT_ID, quantity: 4, unitPrice: 100, subtotal: 400 }]
        });

        const res = await request(app)
            .post('/api/cart/user-1/items')
            .send({ productId: PRODUCT_ID, quantity: 2 }); // 4 + 2 = 6 > 5

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('INSUFFICIENT_STOCK');
        expect(res.body.message).toMatch(/1 unidad/);
    });

    test('permite agregar cuando la cantidad total no excede el stock', async () => {
        mockUpstream({
            stock: 5,
            cartItems: [{ productId: PRODUCT_ID, quantity: 4, unitPrice: 100, subtotal: 400 }]
        });

        const res = await request(app)
            .post('/api/cart/user-1/items')
            .send({ productId: PRODUCT_ID, quantity: 1 }); // 4 + 1 = 5 <= 5

        expect(res.status).toBe(201);
    });

    test('rechaza quantity no entero o menor a 1 con 400 BAD_REQUEST', async () => {
        mockUpstream({ stock: 5, cartItems: [] });

        const res = await request(app)
            .post('/api/cart/user-1/items')
            .send({ productId: PRODUCT_ID, quantity: 1.5 });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('BAD_REQUEST');
    });
});

describe('Checkout - idempotencia (caso obligatorio del curso)', () => {
    test('Dos POST /api/checkout con la misma Idempotency-Key no crean pedidos duplicados', async () => {
        const idempotencyKey = randomUUID();
        const payload = { userId: 'USR-TEST-01' };

        const first = await request(app)
            .post('/api/checkout')
            .set('Idempotency-Key', idempotencyKey)
            .send(payload);

        const second = await request(app)
            .post('/api/checkout')
            .set('Idempotency-Key', idempotencyKey)
            .send(payload);

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(second.body.orderId).toBe(first.body.orderId);
        expect(second.headers['x-idempotent-replay']).toBe('true');
    });
    });

    test('rechaza quantity no entero o menor a 1 con 400 BAD_REQUEST', async () => {
        mockUpstream({ stock: 5, cartItems: [] });

        const res = await request(app)
            .post('/api/cart/user-1/items')
            .send({ productId: PRODUCT_ID, quantity: 1.5 });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('BAD_REQUEST');
    });
});
