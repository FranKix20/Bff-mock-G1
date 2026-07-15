const { callUpstream } = require('./proxy');

/**
 * Tope de stock al agregar productos al carrito.
 *
 * El frontend ya limita la cantidad en el catálogo y el detalle de producto,
 * pero eso es solo una ayuda visual — nada impide llamar al endpoint
 * directamente, ni evita que alguien siga presionando "+" en el carrito más
 * allá del stock real (ese botón no conoce el stock del producto). Como G4
 * (Carrito) no valida esto por su cuenta, el límite tiene que vivir acá, en
 * el BFF, antes de reenviar el POST a G4 — es la única capa que ambos
 * flujos (catálogo y carrito) atraviesan siempre.
 *
 * Si el catálogo (G3) no responde, se deja pasar la operación en vez de
 * bloquear una compra válida por un problema de red ajeno al usuario —
 * mismo criterio de "degradar, no romper" que ya usa el resto del BFF.
 */

async function getProductStock(productId, req) {
    try {
        const result = await callUpstream({
            envVarName: 'PRODUCTS_SERVICE_URL',
            method: 'GET',
            path: `/products/${productId}`,
            headers: { 'X-Correlation-Id': req.correlationId },
            req,
            mockFallback: () => null
        });
        if (!result?.data) return null;
        const stock = result.data.stock_visible ?? result.data.stockVisible;
        return typeof stock === 'number' ? stock : null;
    } catch {
        return null;
    }
}

async function getCurrentCartQuantity(userId, productId, req) {
    try {
        const result = await callUpstream({
            envVarName: 'CART_SERVICE_URL',
            method: 'GET',
            path: `/cart/${userId}`,
            headers: {
                'X-Correlation-Id': req.correlationId,
                ...(req.headers['authorization'] ? { 'Authorization': req.headers['authorization'] } : {})
            },
            req,
            mockFallback: () => null
        });
        const items = result?.data?.items;
        if (!Array.isArray(items)) return 0;
        const found = items.find((item) => (item.productId ?? item.product_id) === productId);
        return found ? (found.quantity ?? 0) : 0;
    } catch {
        return 0;
    }
}

/**
 * Devuelve { ok: true } si la cantidad solicitada (sumada a lo que ya tiene
 * el usuario en el carrito) cabe en el stock real, o
 * { ok: false, available, inCart } si se pasa. Si no se pudo verificar el
 * stock (G3 no respondió / producto sin dato de stock), devuelve
 * { ok: true, unverified: true } — deja pasar, pero deja constancia de que
 * no se pudo confirmar.
 */
async function checkStockForAdd({ userId, productId, quantity, req }) {
    const [stock, currentQty] = await Promise.all([
        getProductStock(productId, req),
        getCurrentCartQuantity(userId, productId, req)
    ]);

    if (typeof stock !== 'number') {
        return { ok: true, unverified: true };
    }

    const requestedTotal = currentQty + quantity;
    if (requestedTotal > stock) {
        return { ok: false, available: stock, inCart: currentQty };
    }

    return { ok: true, available: stock, inCart: currentQty };
}

module.exports = { checkStockForAdd };
