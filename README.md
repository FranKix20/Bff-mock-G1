# BFF Mock — Grupo 1 · Mini Marketplace Cloud

Backend For Frontend desplegado como mock en Vercel. Actúa como orquestador entre el frontend y los servicios de Grupos 2–5 y 9.

**URL pública:** https://bff-mock-g1.vercel.app

---

## Tecnologías

- Node.js + Express
- Desplegado en Vercel (serverless)

---

## Ejecutar localmente

```bash
# 1. Clonar el repositorio
git clone https://github.com/FranKix20/Bff-mock.git
cd Bff-mock

# 2. Instalar dependencias
npm install

# 3. Iniciar el servidor
npm start
# Servidor corriendo en http://localhost:3001
```

---

## Endpoints disponibles

### Health
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Estado del servicio |

### Autenticación (`/api/auth`) → Grupo 2
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Registrar nuevo usuario |
| POST | `/api/auth/login` | Iniciar sesión |
| POST | `/api/auth/refresh` | Renovar token |
| GET | `/api/auth/session` | Obtener sesión activa |
| POST | `/api/auth/logout` | Cerrar sesión |

### Productos (`/api/products`) → Grupo 3
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/products` | Listar productos paginados |
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
| POST | `/api/checkout` | Procesar checkout |

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
GET https://bff-mock.vercel.app/health
```
```json
{
  "status": "UP",
  "service": "BFF Grupo 1",
  "timestamp": "2026-06-25T00:00:00.000Z",
  "environment": "production"
}
```

### POST /api/auth/login
```
POST https://bff-mock.vercel.app/api/auth/login
Content-Type: application/json

{
  "email": "juan@ejemplo.cl",
  "password": "MiClave123"
}
```
```json
{
  "user": {
    "user_id": "3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff",
    "email": "juan@ejemplo.cl",
    "full_name": "Juan Pérez González",
    "role": "customer",
    "status": "active"
  },
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

### GET /api/notifications?userId=
```
GET https://bff-mock.vercel.app/api/notifications?userId=3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff
```
```json
{
  "data": [
    {
      "id": "notif-0001",
      "userId": "3d9a1f44-1b2a-4c3d-8e5f-aabbccddeeff",
      "type": "ORDER_STATUS",
      "title": "Tu pedido fue confirmado",
      "message": "El pedido ORD-1001 ha sido confirmado y está siendo procesado.",
      "read": false,
      "createdAt": "2026-06-23T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "size": 10,
    "total": 3,
    "totalPages": 1
  }
}
```

---

## Variables de entorno

No se requieren variables de entorno para el mock. El servidor corre con datos simulados estáticos.

Para desarrollo local se puede crear un archivo `.env`:
```
NODE_ENV=development
PORT=3001
```

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
├── index.js
├── package.json
└── vercel.json
```

---

## Integración con otros grupos

| Grupo | Servicio | Prefijo BFF |
|-------|----------|-------------|
| Grupo 2 | Identidad y sesiones | `/api/auth` |
| Grupo 3 | Catálogo de productos | `/api/products` |
| Grupo 4 | Carro y checkout | `/api/cart`, `/api/checkout` |
| Grupo 5 | Pedidos | `/api/orders` |
| Grupo 9 | Notificaciones | `/api/notifications` |
