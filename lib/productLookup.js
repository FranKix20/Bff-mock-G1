const { callUpstream } = require('./proxy');

/**
 * Resuelve nombre + imagen contra el catálogo real (G3) para una lista de
 * productIds. Se usa desde cualquier lugar que reciba items con solo
 * product_id (carrito de G4, pedidos de G5) y necesite mostrarle al
 * usuario algo más que un UUID — nombre y foto no viven en esos
 * servicios, viven en G3, así que hay que ir a buscarlos ahí.
 *
 * Devuelve un mapa { [productId]: { name, image } }. Los productIds que
 * fallan la búsqueda (ej. 404, servicio caído) quedan con { name: null,
 * image: null } en vez de cortar el resto de las respuestas.
 */
async function resolveProductInfo(productIds, req) {
    const uniqueIds = [...new Set(productIds.filter(Boolean))];
    if (uniqueIds.length === 0) return {};

    const lookups = await Promise.all(
        uniqueIds.map(async (id) => {
            try {
                const result = await callUpstream({
                    envVarName: 'PRODUCTS_SERVICE_URL',
                    method: 'GET',
                    path: `/products/${id}`,
                    headers: { 'X-Correlation-Id': req.correlationId },
                    req,
                    mockFallback: () => null
                });
                const name = result?.data?.name ?? result?.data?.product_name ?? null;
                const image = result?.data?.image_url ?? result?.data?.imageUrl ?? null;
                return [id, { name, image }];
            } catch {
                return [id, { name: null, image: null }];
            }
        })
    );

    return Object.fromEntries(lookups);
}

module.exports = { resolveProductInfo };
