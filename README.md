# BFF Mock — Grupo 1 · Mini Marketplace Cloud

**Fase 3 — Desarrollo Cloud**: versión funcional del servicio en cloud free, con persistencia real y todas las integraciones vigentes conectadas a los servicios reales de los otros grupos.

Backend For Frontend desplegado en Vercel. Orquesta las llamadas entre el frontend y los servicios de los Grupos 2 (Auth), 3 (Catálogo), 4 (Carro/Checkout), 5 (Pedidos), 9 (Notificaciones) y 11 (Chatbot).

**URL pública:** https://bff-mock-g1.vercel.app
**URL Swagger:** https://app.swaggerhub.com/apis/utem-c81/bff-grupo-1-mini-marketplace-cloud/2.1.0#/default/get_health
**Repositorio:** https://github.com/FranKix20/Bff-mock
**Informe de pruebas de integración (evidencia Fase 3):** [`docs/Informe_Integracion_BFF_G1_Fase3.pdf`](./docs/Informe_Integracion_BFF_G1_Fase3.pdf)

---

## Estado de las integraciones (cierre Fase 3)

| Grupo | Servicio | Endpoint(s) BFF | Estado | Detalle |
|---|---|---|---|---|
| Grupo 2 | Autenticación | `/api/auth/*` | Conectado | Login y registro validados en producción contra el servicio real. |
| Grupo 3 | Catálogo / Productos | `/api/products` | Conectado (con normalización) | G3 responde en `snake_case`; el BFF normaliza a `camelCase` y unifica la paginación. |
| Grupo 4 | Carrito y Checkout | `/api/cart`, `/api/checkout` | Bloqueado (no atribuible al BFF) | El carrito conecta bien, pero el checkout de punta a punta no completa: el `Idempotency-Key` no se valida en G4 antes de una consulta SQL (500 en vez de 400), el `id` del carrito no es estable entre requests, y los `productId` de G4 no existen en el catálogo real de G5. El BFF propaga los errores en formato estándar (`UPSTREAM_ERROR`); no hay nada más que corregir de este lado. |
| Grupo 5 | Pedidos | `/api/orders` | Conectado (con normalización) | G5 usa `camelCase` en el detalle y `snake_case` en el listado, y `totalAmount` cambia de tipo (number/string) entre ambos. El BFF normaliza todo a un contrato único. |
| Grupo 9 | Notificaciones | `/api/notifications` | Conectado | Sin inconsistencias de formato detectadas. |
| Grupo 11 | Chatbot | `/api/chat`, `/api/chat/faq/:category` | Conectado (con hallazgo externo) | Conversación general y FAQ funcionan correctamente contra el servicio real. Las consultas de estado de pedido vía chat fallan (503) porque G11 le manda a G5 el `orderNumber` en vez del `id` (UUID) que G5 exige — bug de la integración G11-G5, no del BFF. |

Detalle completo de pruebas, evidencia (capturas) y hallazgos: ver el informe en [`docs/Informe_Integracion_BFF_G1_Fase3.pdf`](./docs/Informe_Integracion_BFF_G1_Fase3.pdf).

---

## Novedades de la Fase 3 respecto al mock (Fase 2)

| Antes (E2 Mock) | Ahora (E3 Cloud) |
|---|---|
| Datos hardcodeados en cada ruta | Proxy real a los servicios de otros grupos vía variables de entorno, con **fallback automático a mock** si el servicio upstream no está configurado o no responde |
| Sin base de datos | Persistencia real en **Supabase (Postgres)**: sesiones, idempotencia de checkout y cache de catálogo — confirmado activo en producción (`"persistence":"supabase"`) |
| Errores inconsistentes | Formato de error estándar del curso (`timestamp`, `status`, `code`, `message`, `correlationId`) en todas las rutas |
| Sin variables de entorno reales | `.env` separado de secretos (no versionado), documentado en `.env.example` |
| Sin CI | GitHub Actions corre los tests y valida `/health` en cada push/PR |
| Solo mocks propios | 5 de 6 integraciones (G2, G3, G5, G9, G11) conectadas y validadas contra los servicios reales desplegados por cada grupo, con normalización de contrato donde fue necesario |

---

## Arquitectura

```
Frontend (usuario)
      │
      ▼
┌───────────────────────────────┐
│    BFF - Grupo 1 (Vercel)     │
│  ┌──────────────────────────┐ │
│  │ middleware/context.js    │ │  → X-Request-Id / X-Correlation-Id
│  │ lib/proxy.js             │ │  → llama upstream o cae a mock
│  │ lib/errors.js            │ │  → formato de error estándar
│  │ lib/db.js                │ │  → persistencia (Supabase)
│  └──────────────────────────┘ │
└────────────┬───────────────────┘
             │                   ┌──────────────► Supabase Postgres
             │                   │  (sessions, idempotency_keys,
             │                   │   product_cache, request_logs)
             │
   ┌─────────┼─────────┬─────────┬──────────┬───────────┐
   ▼         ▼         ▼         ▼          ▼           ▼
 G2 Auth   G3 Cat.   G4 Carro  G5 Pedidos  G9 Notif.  G11 Chatbot
(conectado)(conectado)(carrito ok /   (conectado)  (conectado)  (conectado,
                       checkout                                  FAQ + chat;
                       bloqueado)                                pedidos vía
                                                                  chat: bug G11-G5)
```

Cada integración se activa configurando la variable de entorno correspondiente en Vercel; si no está configurada (o el upstream no responde), el BFF cae automáticamente a un mock interno y lo indica en el header `X-Data-Source: mock` / `mock-fallback`, para no bloquear el desarrollo del frontend mientras algún grupo esté atrasado.

---

## Persistencia (Supabase Postgres)

El BFF usa base de datos real para funciones propias (no duplica los datos de negocio de otros grupos):

1. **`sessions`** — cachea la sesión emitida al hacer login, para validarla en `GET /api/auth/session` sin depender de otro servicio en cada request.
2. **`idempotency_keys`** — implementa el caso obligatorio del curso: si el usuario presiona "comprar" dos veces con el mismo header `Idempotency-Key`, el BFF devuelve la respuesta ya guardada en vez de generar un pedido duplicado.
3. **`product_cache`** — guarda la última respuesta exitosa del catálogo como resiliencia si el servicio de productos está caído.
4. **`request_logs`** — log simple de cada request (evidencia de auditoría / trazabilidad).

Script de creación de tablas: [`db/schema.sql`](./db/schema.sql).

Si `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` no están configuradas, el BFF **no falla**: opera en modo degradado usando memoria local, y lo reporta en `GET /health` (`"persistence": "in-memory (degraded)"`). En producción, `GET /health` confirma actualmente `"persistence": "supabase"`.

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
# y las URLs/keys de los upstreams que quieras probar contra datos reales

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
| `AUTH_SERVICE_URL` | Configurada | URL real del servicio de Auth (Grupo 2). Conectado en producción. |
| `PRODUCTS_SERVICE_URL` | Configurada | URL real del servicio de Catálogo (Grupo 3). Conectado en producción. |
| `CART_SERVICE_URL` | Configurada | URL real del servicio de Carro (Grupo 4). Conectado; checkout de punta a punta queda bloqueado por causas ajenas al BFF (ver tabla de integraciones). |
| `CHECKOUT_SERVICE_URL` | Opcional | URL real del servicio de Checkout, si G4/G5 exponen uno separado del de carro. |
| `ORDERS_SERVICE_URL` | Configurada | URL real del servicio de Pedidos (Grupo 5). Conectado en producción. |
| `NOTIFICATIONS_SERVICE_URL` | Configurada | URL real del servicio de Notificaciones (Grupo 9). Conectado en producción. |
| `CHATBOT_SERVICE_URL` | Configurada | URL real del servicio de Chatbot (Grupo 11). Conectado en producción. |
| `CHATBOT_API_KEY` | Configurada | API key exigida por G11 en el header `X-Api-Key`. |

**Ningún secreto se sube al repositorio**: `.env` está en `.gitignore`, solo `.env.example` con valores vacíos/placeholder se versiona. En Vercel, las variables se configuran en *Project Settings → Environment Variables*, y requieren un **redeploy** para aplicarse a un deployment ya existente.

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

Códigos usados: `400 BAD_REQUEST`, `401 UNAUTHORIZED`, `404 NOT_FOUND`, `409 DUPLICATED_REQUEST`, `422`/`500`/`503 UPSTREAM_ERROR` (error real propagado desde el servicio dependiente), `500 INTERNAL_ERROR`.

Headers propagados en cada request/response: `X-Request-Id`, `X-Correlation-Id`, `X-Consumer`, `X-Data-Source`.

---

## CI/CD

`.github/workflows/ci.yml` corre en cada push/PR a `main`:
1. Instala dependencias (`npm ci`).
2. Ejecuta `npm test` (suite completa de pruebas funcionales) con `NODE_ENV=test`.
3. Levanta el servidor con `NODE_ENV=development` (separado del paso de test) y valida `GET /health` con reintentos, para evitar falsos negativos por arranque lento.

El deploy a producción es automático vía integración Git de Vercel: cada push a `main` que pasa CI dispara un nuevo deploy en https://bff-mock-g1.vercel.app.

> **Nota técnica importante:** todos los `require()` de módulos de rutas en `index.js` deben usar un string literal directo (`require('./api/auth/routes')`), nunca una variable. Vercel usa un analizador estático (Node File Trace) para decidir qué archivos empaqueta en la función serverless; con `require(variable)` no detecta esos archivos, no los incluye en el bundle, y en producción todas las rutas bajo `/api/*` responden 404 aunque el código funcione perfecto en local. `vercel.json` además refuerza esto con `includeFiles` como respaldo.

---

## Endpoints disponibles

Documentación completa en [`docs/openapi.yaml`](./docs/openapi.yaml).

### Health
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Estado del servicio, persistencia activa y estado de cada integración configurada |

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
| GET | `/api/products` | Listar productos paginados, normalizado a `camelCase` (con cache de resiliencia) |
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
| POST | `/api/checkout` | Procesar checkout (requiere header `Idempotency-Key`). Actualmente bloqueado de punta a punta por causas en G4/G5, ver tabla de integraciones. |

### Órdenes (`/api/orders`) → Grupo 5
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/orders?userId=&page=&size=&status=` | Listar órdenes del usuario, con filtro opcional por `status`, normalizado a `camelCase` |
| GET | `/api/orders/:orderId` | Obtener orden por `id` (UUID interno de G5) |

### Notificaciones (`/api/notifications`) → Grupo 9
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/notifications?userId=` | Listar notificaciones del usuario |
| PATCH | `/api/notifications/:id/read` | Marcar notificación como leída |
| POST | `/api/notifications/subscriptions` | Crear suscripción a notificaciones |

### Chatbot (`/api/chat`) → Grupo 11
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/chat` | Enviar mensaje al asistente conversacional, normalizado a `camelCase` (`sessionId`, `intentDetected`, `sourcesConsulted`, `correlationId`) |
| GET | `/api/chat/faq/:category` | Obtener preguntas frecuentes por categoría (`faq_envios`, `faq_pagos`, `faq_productos`, `faq_cuenta`, `faq_devoluciones`) |

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
  "timestamp": "2026-07-02T00:00:00.000Z",
  "environment": "production",
  "platform": "Vercel",
  "persistence": "supabase",
  "upstreams": {
    "auth": true,
    "products": true,
    "cart": true,
    "checkout": false,
    "orders": true,
    "notifications": true,
    "chatbot": true
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
Si se reenvía el mismo request con la misma `Idempotency-Key`, la respuesta es idéntica (mismo `orderId`) y llega con el header `X-Idempotent-Replay: true` — no se crea un segundo pedido. El flujo completo contra datos reales de G4/G5 está actualmente bloqueado (ver tabla de integraciones); la idempotencia en sí ya está validada por los tests de Jest.

### POST /api/chat
```
POST https://bff-mock-g1.vercel.app/api/chat
Content-Type: application/json

{ "sessionId": "550e8400-e29b-41d4-a716-446655440000", "message": "¿Cuáles son los métodos de pago disponibles?", "userId": "USR-01" }
```
Responde con `X-Data-Source: upstream` y el body normalizado a `camelCase`, aunque G11 internamente use `snake_case`.

---

## Estructura del proyecto

```
Bff-mock/
├── api/
│   ├── auth/routes.js
│   ├── cart/routes.js
│   ├── chat/routes.js         # Integración con Grupo 11 (Chatbot)
│   ├── checkout/routes.js
│   ├── notifications/routes.js
│   ├── orders/routes.js       # incluye normalización de contrato de G5
│   └── products/routes.js     # incluye normalización de contrato de G3
├── db/
│   └── schema.sql             # tablas de persistencia (Supabase)
├── docs/
│   ├── openapi.yaml           # documentación de endpoints
│   └── Informe_Integracion_BFF_G1_Fase3.pdf   # evidencia de pruebas funcionales
├── lib/
│   ├── db.js                  # cliente Supabase + modo degradado
│   ├── errors.js               # formato de error estándar
│   ├── proxy.js                 # llamadas upstream con fallback a mock
│   └── uuid.js
├── middleware/
│   └── context.js              # X-Request-Id / X-Correlation-Id
├── tests/
│   └── bff.test.js             # pruebas funcionales (incluye idempotencia)
├── .github/workflows/ci.yml    # CI: tests + verificación de arranque en cada push/PR
├── .env.example
├── index.js
├── package.json
└── vercel.json                 # incluye includeFiles como respaldo del bundling de Vercel
```

---

## Integración con otros grupos

| Grupo | Servicio | Prefijo BFF | Variable de entorno | Estado |
|-------|----------|-------------|----------------------|--------|
| Grupo 2 | Identidad y sesiones | `/api/auth` | `AUTH_SERVICE_URL` | Conectado |
| Grupo 3 | Catálogo de productos | `/api/products` | `PRODUCTS_SERVICE_URL` | Conectado (normalizado) |
| Grupo 4 | Carro y checkout | `/api/cart`, `/api/checkout` | `CART_SERVICE_URL`, `CHECKOUT_SERVICE_URL` | Carrito conectado; checkout bloqueado (causas en G4/G5, no en el BFF) |
| Grupo 5 | Pedidos | `/api/orders` | `ORDERS_SERVICE_URL` | Conectado (normalizado) |
| Grupo 9 | Notificaciones | `/api/notifications` | `NOTIFICATIONS_SERVICE_URL` | Conectado |
| Grupo 11 | Chatbot | `/api/chat` | `CHATBOT_SERVICE_URL`, `CHATBOT_API_KEY` | Conectado (bug externo G11-G5 en consultas de pedido vía chat) |

Detalle de cada prueba, evidencia y hallazgos técnicos de contrato (casing inconsistente, tipos de dato, contratos openapi desactualizados respecto al código real, etc.) está documentado en [`docs/Informe_Integracion_BFF_G1_Fase3.pdf`](./docs/Informe_Integracion_BFF_G1_Fase3.pdf), junto con la retroalimentación preparada para cada grupo.
