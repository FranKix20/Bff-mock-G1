# BFF Mock — Grupo 1 · Mini Marketplace Cloud

**Fase 3 — Desarrollo Cloud**: primera versión funcional del servicio en cloud free, con persistencia real y endpoints principales.

Backend For Frontend desplegado en Vercel. Orquesta las llamadas entre el frontend y los servicios de los Grupos 2 (Auth), 3 (Catálogo), 4 (Carro), 5 (Pedidos) y 9 (Notificaciones).

**URL pública:** https://bff-mock-g1.vercel.app

---

## Novedades de la Fase 3 respecto al mock (Fase 2)

| Antes (E2 Mock) | Ahora (E3 Cloud) |
|---|---|
| Datos hardcodeados en cada ruta | Proxy real a los servicios de otros grupos vía variables de entorno, con **fallback automático a mock** si el servicio upstream aún no está desplegado |
| Sin base de datos | Persistencia real en **Supabase (Postgres)**: sesiones, idempotencia de checkout y cache de catálogo |
| Errores inconsistentes | Formato de error estándar del curso (`timestamp`, `status`, `code`, `message`, `correlationId`) en todas las rutas |
| Sin variables de entorno reales | `.env` separado de secretos, documentado en `.env.example` |
| Sin CI | GitHub Actions corre los tests en cada push/PR |

---

## Arquitectura

```
Frontend (usuario)
      │
      ▼
┌─────────────────────────────┐
│   BFF - Grupo 1 (Vercel)    │
│  ┌────────────────────────┐ │
│  │ middleware/context.js  │ │  → X-Request-Id / X-Correlation-Id
│  │ lib/proxy.js           │ │  → llama upstream o cae a mock
│  │ lib/errors.js          │ │  → formato de error estándar
│  │ lib/db.js              │ │  → persistencia (Supabase)
│  └────────────────────────┘ │
└───────────┬──────────────────┘
            │                  ┌──────────────► Supabase Postgres
            │                  │  (sessions, idempotency_keys,
            │                  │   product_cache, request_logs)
            │
   ┌────────┼────────┬────────┬─────────┐
   ▼        ▼        ▼        ▼         ▼
 G2 Auth  G3 Cat.  G4 Carro  G5 Pedidos G9 Notif.
(mock/cloud según env var configurada)
```

Mientras un servicio de otro grupo siga en mock/Postman, basta con **no** definir su variable de entorno: el BFF sigue funcionando con datos simulados. Cuando ese grupo despliegue su URL real, solo se configura la env var correspondiente y el BFF empieza a consumir datos reales sin cambios de código.

---

## Persistencia (Supabase Postgres)

El BFF usa base de datos real para tres funciones propias (no duplica los datos de negocio de otros grupos):

1. **`sessions`** — cachea la sesión emitida al hacer login, para validarla en `GET /api/auth/session` sin depender de otro servicio en cada request.
2. **`idempotency_keys`** — implementa el caso obligatorio del curso: si el usuario presiona "comprar" dos veces con el mismo header `Idempotency-Key`, el BFF devuelve la respuesta ya guardada en vez de generar un pedido duplicado.
3. **`product_cache`** — guarda la última respuesta exitosa del catálogo como resiliencia si el servicio de productos está caído.
4. **`request_logs`** — log simple de cada request (evidencia de auditoría / trazabilidad).

Script de creación de tablas: [`db/schema.sql`](./db/schema.sql).

Si `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` no están configuradas, el BFF **no falla**: opera en modo degradado usando memoria local (útil para desarrollo sin credenciales), y lo reporta en `GET /health`.

---

## Ejecutar localmente

```bash
# 1. Clonar el repositorio
git clone https://github.com/FranKix20/Bff-mock.git
cd Bff-mock

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# completar SUPABASE_URL y SUPABASE_SERVICE_KEY (ver sección Persistencia)

# 4. Crear las tablas en Supabase
# Copiar el contenido de db/schema.sql en el SQL Editor de tu proyecto Supabase

# 5. Iniciar el servidor
npm start
# Servidor corriendo en http://localhost:3001
```

### Correr las pruebas funcionales

```bash
npm test
```

Incluye pruebas de: health check, formato de error estándar, validaciones de auth/checkout, y el caso obligatorio de **idempotencia en checkout** (dos requests con la misma `Idempotency-Key` no generan pedidos duplicados).

---

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `NODE_ENV` | No | `development` / `production` / `test` |
| `PORT` | No | Puerto local (default 3001) |
| `FRONTEND_URL` | No | Origen permitido adicional para CORS |
| `SUPABASE_URL` | Recomendada | URL del proyecto Supabase (persistencia real) |
| `SUPABASE_SERVICE_KEY` | Recomendada | Service role key de Supabase |
| `AUTH_SERVICE_URL` | Opcional | URL real del servicio de Auth (Grupo 2). Si no está, usa mock |
| `PRODUCTS_SERVICE_URL` | Opcional | URL real del servicio de Catálogo (Grupo 3). Si no está, usa mock |
| `CART_SERVICE_URL` | Opcional | URL real del servicio de Carro (Grupo 4). Si no está, usa mock |
| `CHECKOUT_SERVICE_URL` | Opcional | URL real del servicio de Checkout (Grupos 4/5). Si no está, usa mock |
| `ORDERS_SERVICE_URL` | Opcional | URL real del servicio de Pedidos (Grupo 5). Si no está, usa mock |
| `NOTIFICATIONS_SERVICE_URL` | Opcional | URL real del servicio de Notificaciones (Grupo 9). Si no está, usa mock |

**Ningún secreto se sube al repositorio**: `.env` está en `.gitignore`, solo `.env.example` con valores vacíos/placeholder se versiona. En Vercel, las variables se configuran en *Project Settings → Environment Variables*.

Cada respuesta incluye el header `X-Data-Source` (`upstream` / `mock` / `mock-fallback` / `cache`) para saber de dónde vino el dato — útil para depurar integración con otros grupos.

---

## Manejo de errores

Todas las rutas devuelven el formato de error estándar del curso:

```json
{
  "timestamp": "2026-07-01T10:00:00.000Z",
  "status": 409,
  "code": "DUPLICATED_REQUEST",
  "message": "La solicitud ya fue procesada",
  "correlationId": "abc-123"
}
```

Códigos usados: `400 BAD_REQUEST`, `401 UNAUTHORIZED`, `404 NOT_FOUND`, `409 DUPLICATED_REQUEST`, `502 UPSTREAM_UNAVAILABLE`, `500 INTERNAL_ERROR`.

Headers propagados en cada request/response: `X-Request-Id`, `X-Correlation-Id`, `X-Consumer`.

---

## CI/CD

`.github/workflows/ci.yml` corre en cada push/PR a `main`:
1. Instala dependencias (`npm ci`).
2. Ejecuta `npm test` (suite completa de pruebas funcionales).
3. Levanta el servidor y valida `GET /health`.

El deploy a producción es automático vía integración Git de Vercel: cada push a `main` que pasa CI dispara un nuevo deploy en https://bff-mock-g1.vercel.app.

---

## Endpoints disponibles

Documentación completa en [`docs/openapi.yaml`](./docs/openapi.yaml).

### Health
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Estado del servicio y de las integraciones configuradas |

### Autenticación (`/api/auth`) → Grupo 2
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Registrar nuevo usuario |
| POST | `/api/auth/login` | Iniciar sesión (persiste sesión en BFF) |
| POST | `/api/auth/refresh` | Renovar token |
| GET | `/api/auth/session` | Obtener sesión activa |
| POST | `/api/auth/logout` | Cerrar sesión |

### Productos (`/api/products`) → Grupo 3
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/products` | Listar productos paginados (con cache de resiliencia) |
| GET | `/api/products/:id` | Obtener producto por ID |
| GET | `/api/products/search?q=` | Buscar productos |

### Carrito (`/api/cart`) → Grupo 4
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/cart/:userId` | Obtener carrito del usuario |
| POST | `/api/cart/:userId/items` | Agregar producto al carrito |
| DELETE | `/api/cart/:userId/items/:productId` | Eliminar producto del carrito |

### Checkout (`/api/checkout`) → Grupos 4 y 5
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/checkout` | Procesar checkout (requiere header `Idempotency-Key`) |

### Órdenes (`/api/orders`) → Grupo 5
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/orders` | Listar órdenes |
| GET | `/api/orders/:orderId` | Obtener orden por ID |

### Notificaciones (`/api/notifications`) → Grupo 9
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/notifications?userId=` | Listar notificaciones del usuario |
| PATCH | `/api/notifications/:id/read` | Marcar notificación como leída |
| POST | `/api/notifications/subscriptions` | Crear suscripción a notificaciones |

---

## Ejemplos de uso

### GET /health
```
GET https://bff-mock-g1.vercel.app/health
```
```json
{
  "status": "UP",
  "service": "BFF Grupo 1",
  "timestamp": "2026-07-01T00:00:00.000Z",
  "environment": "production",
  "platform": "Vercel",
  "persistence": "supabase",
  "upstreams": {
    "auth": false,
    "products": false,
    "cart": false,
    "checkout": false,
    "orders": false,
    "notifications": false
  }
}
```

### POST /api/checkout (idempotente)
```
POST https://bff-mock-g1.vercel.app/api/checkout
Content-Type: application/json
Idempotency-Key: 3f29a1b2-...

{ "userId": "USR-01" }
```
Si se reenvía el mismo request con la misma `Idempotency-Key`, la respuesta es idéntica (mismo `orderId`) y llega con el header `X-Idempotent-Replay: true` — no se crea un segundo pedido.

---

## Estructura del proyecto

```
Bff-mock/
├── api/
│   ├── auth/routes.js
│   ├── cart/routes.js
│   ├── checkout/routes.js
│   ├── notifications/routes.js
│   ├── orders/routes.js
│   └── products/routes.js
├── db/
│   └── schema.sql          # tablas de persistencia (Supabase)
├── docs/
│   └── openapi.yaml         # documentación de endpoints
├── lib/
│   ├── db.js                # cliente Supabase + modo degradado
│   ├── errors.js             # formato de error estándar
│   ├── proxy.js               # llamadas upstream con fallback a mock
│   └── uuid.js
├── middleware/
│   └── context.js            # X-Request-Id / X-Correlation-Id
├── tests/
│   └── bff.test.js           # pruebas funcionales (incluye idempotencia)
├── .github/workflows/ci.yml  # CI: tests en cada push/PR
├── .env.example
├── index.js
├── package.json
└── vercel.json
```

---

## Integración con otros grupos

| Grupo | Servicio | Prefijo BFF | Variable de entorno |
|-------|----------|-------------|----------------------|
| Grupo 2 | Identidad y sesiones | `/api/auth` | `AUTH_SERVICE_URL` |
| Grupo 3 | Catálogo de productos | `/api/products` | `PRODUCTS_SERVICE_URL` |
| Grupo 4 | Carro y checkout | `/api/cart`, `/api/checkout` | `CART_SERVICE_URL`, `CHECKOUT_SERVICE_URL` |
| Grupo 5 | Pedidos | `/api/orders` | `ORDERS_SERVICE_URL` |
| Grupo 9 | Notificaciones | `/api/notifications` | `NOTIFICATIONS_SERVICE_URL` |

Estado actual (Fase 3): los servicios de los Grupos 2-5 y 9 aún no tienen URL cloud pública, por lo que el BFF opera con fallback a mock para esas integraciones. Esto se resuelve solo actualizando las variables de entorno en Vercel cuando cada grupo despliegue — no requiere cambios de código.
