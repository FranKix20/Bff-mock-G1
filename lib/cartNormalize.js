const { callUpstream } = require('./proxy');
const { resolveProductInfo } = require('./productLookup');

/**
 * Normaliza los items del carrito al shape que consume el frontend
 * (camelCase: productId, unitPrice, subtotal, quantity, productName,
 * productImage).
 *
 * G4 confirmó en su paquete de integración (E5) que su respuesta real
 * usa snake_case adentro de cada item: cart_id, product_id, unit_price,
 * subtotal — distinto de lo que asumía el mock original (productId,
 * unitPrice ya en camelCase). Sin este mapeo, item.productId llega
 * `undefined` al frontend y el carrito se ve vacío o roto aunque el
 * upstream sí esté devolviendo datos reales.
 */
function normalizeCartItem(item) {
    return {
        ...item,
        productId: item.productId ?? item.product_id ?? null,
        unitPrice: item.unitPrice ?? item.unit_price ?? 0,
        subtotal: item.subtotal ?? (item.quantity && (item.unitPrice ?? item.unit_price)
            ? item.quantity * (item.unitPrice ?? item.unit_price)
            : 0),
        quantity: item.quantity ?? 1,
        productName: item.productName ?? item.product_name ?? item.name ?? null,
        productImage: item.productImage ?? item.image_url ?? item.imageUrl ?? null
    };
}

/**
 * G4 (Carrito) no siempre incluye el nombre ni la imagen del producto en
 * cada item — solo trae product_id. Cuando falta, se resuelve contra el
 * catálogo real (G3) antes de responder al frontend, para no depender de
 * que G4 lo agregue algún día.
 */
async function enrichCartItemNames(cart, req) {
    if (!cart || !Array.isArray(cart.items)) return cart;

    const items = cart.items.map(normalizeCartItem);

    const missingIds = items
        .filter((item) => (!item.productName || !item.productImage) && item.productId)
        .map((item) => item.productId);

    const dataById = await resolveProductInfo(missingIds, req);
    if (Object.keys(dataById).length === 0) {
        return { ...cart, items };
    }

    return {
        ...cart,
        items: items.map((item) => {
            const found = dataById[item.productId];
            if (!found) return item;
            return {
                ...item,
                productName: item.productName ?? found.name,
                productImage: item.productImage ?? found.image
            };
        })
    };
}

/**
 * Trae el carrito actual ya normalizado. Se usa desde /api/checkout para
 * sacar una "foto" de items/totalAmount ANTES de confirmar la compra,
 * porque la respuesta real de G4 a POST /checkout no trae items ni
 * totalAmount (ver nota en checkout/routes.js).
 */
async function fetchNormalizedCart(userId, req) {
    const result = await callUpstream({
        envVarName: 'CART_SERVICE_URL',
        method: 'GET',
        path: `/cart/${userId}`,
        headers: {
            'X-Correlation-Id': req.correlationId,
            ...(req.headers['authorization'] ? { Authorization: req.headers['authorization'] } : {})
        },
        req,
        mockFallback: () => null
    });
    if (!result.data) return null;
    return enrichCartItemNames(result.data, req);
}

module.exports = { normalizeCartItem, enrichCartItemNames, fetchNormalizedCart };
