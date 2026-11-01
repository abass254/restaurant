# Software Design Specification (SDS)

## TransChap Merchants — Merchant-Side Retail Platform

**Version:** 1.0  
**Date:** 13 August 2026

---

## 1. Introduction

### 1.1 Purpose

The purpose of this Software Design Specification (SDS) is to provide a detailed overview of the software architecture and design for **TransChap Merchants**. It includes system architecture, modules, data structures, and interface design to guide the development team.

### 1.2 Scope

TransChap Merchants is a multi-tenant web application that allows shop owners and staff to manage inventory, POS sales, orders, Instagram messaging, delivery riders, and M-Pesa payments.

This SDS outlines how the frontend, backend, and database layers interact to deliver these merchant-side features.

**Out of scope:** platform admin console, rider mobile runtime internals, and the separate services/appointments product.

---

## 2. System Overview

TransChap Merchants is designed as a multi-tier architecture:

- **Frontend:** Next.js (React) web application
- **Backend:** RESTful API using FastAPI
- **Database:** MySQL
- **Authentication:** Session cookies with CSRF (Sanctum-compatible)

The browser talks only to Next.js. Next.js rewrites/proxies `/api`, `/auth`, `/sanctum`, `/webhooks`, `/mpesa`, and `/uploads` to the FastAPI backend.

---

## 3. Design Considerations

### 3.1 Assumptions and Dependencies

- Modern browsers (Chrome, Firefox, Edge, Safari)
- Internet access (or localhost for development)
- Hosting via Docker Compose or equivalent (frontend + API + MySQL)
- Platform-configured Meta Instagram and Safaricom Daraja credentials when those features are enabled
- Optional Google Maps, Google OAuth, AI providers, and SMTP mail

### 3.2 General Constraints

- Mobile-responsive merchant UI; companion routes under `/m/...`
- API must follow RESTful principles under `/api/v1`
- Passwords must be hashed before storage
- Session + CSRF required for mutating requests
- Data must be scoped to the active shop (account)
- Staff access limited by `allowed_sections`
- Retail-only product boundary in this codebase

---

## 4. System Architecture

```
[ Next.js Frontend ] <--> [ FastAPI REST API ] <--> [ MySQL Database ]
        |                         |                        |
     Merchant UI           Business Logic            Data Storage
                                  |
                    +-------------+-------------+
                    |             |             |
              Meta Instagram   Daraja M-Pesa   Maps / AI / Mail
```

### 4.1 Technologies Used

| Layer | Technology |
|-------|------------|
| Frontend | Next.js, React, TypeScript, existing TransChap CSS design system |
| Backend | FastAPI, SQLAlchemy, Uvicorn |
| Database | MySQL |
| Auth | Session cookies + CSRF (`/sanctum/csrf-cookie`) |
| Integrations | Meta Instagram, Safaricom Daraja, optional Google Maps/OAuth, AI providers |
| Deployment | Docker Compose, Git-based workflows |

### 4.2 Runtime Ports

| Mode | Frontend | API |
|------|----------|-----|
| Local development | `7000` | `7001` |
| Docker / production | `7070` | `7071` |

---

## 5. Module Design

### 5.1 Auth & Membership Module

- **Functions:** Signup, login, logout, session refresh, password change/reset, switch active shop
- **Routes (examples):**
  - `POST /api/v1/auth/signup`
  - `POST /api/v1/auth/login`
  - `GET /api/v1/auth/user`
  - `POST /api/v1/auth/logout`
  - `POST /api/v1/auth/switch-merchant`
  - `POST /api/v1/accounts`
- **Tables:** `users`, `user_memberships`, `accounts`

### 5.2 Business Profile & Onboarding Module

- **Functions:** Onboarding wizard, business name/category, logo, location pin, Instagram checklist
- **Routes (examples):**
  - `PATCH /api/v1/settings/business`
  - `PATCH /api/v1/settings/business-location`
  - `POST/DELETE /api/v1/settings/logo`
  - `GET /api/v1/onboarding`, `POST /api/v1/onboarding/refresh`
- **UI:** `/onboarding`, `/basics`, `/settings`
- **Tables:** `accounts`, related settings/channel tables

### 5.3 Inventory Module

- **Functions:** CRUD inventory items, media, import, AI generate, post to feed
- **Routes:** `/api/v1/inventory/*`, `/api/v1/products/*`
- **UI:** `/inventory`, `/inventory/[id]`
- **Tables:** `products`, `inventory_items`

### 5.4 POS & Orders Module

- **Functions:** Create orders from POS, list/filter orders, status transitions, analytics, assign rider, STK on order
- **Routes:** `/api/v1/orders/*`
- **UI:** `/pos`, `/orders`, `/orders/[id]`, `/orders/analytics`
- **Tables:** `orders`, `order_items`, `order_status_history`

### 5.5 Station / Store Status Module

- **Functions:** Live queue, pause/resume/busy, prep minutes, heartbeat
- **Routes:** `/api/v1/store-status/*`, order transition endpoints
- **UI:** `/station`, `/station/history`, `/station/settings`, `/station/stock`
- **Tables:** store-status fields on `accounts`, `orders`

### 5.6 Tickets & Messaging Module

- **Functions:** Inbox list/thread, reply, ticket resolve, notifications, nav badges
- **Routes:** `/api/v1/messages/*`, `/api/v1/tickets/*`, `/api/v1/nav-counts`, `/api/v1/notifications/*`
- **UI:** `/tickets`, `/messages`, `/tickets/analytics`
- **Tables:** support tickets / Instagram conversations & messages (channel messaging store)

### 5.7 Feeds & Automation Module

- **Functions:** List/publish posts, insights, link inventory; conversation starters; auto-reply rules
- **Routes:** `/api/v1/feeds/*`, `/api/v1/conversation-starters/*`, `/api/v1/auto-reply/*`
- **UI:** `/feeds`, `/tools/starters`, `/tools/auto-reply`
- **Tables:** feed/post records, `auto_reply_rules`, starter records

### 5.8 Delivery Module

- **Functions:** Invite riders, list/update/suspend, test dispatch, order assign/handoff
- **Routes:** `/api/v1/riders/*`, order rider endpoints
- **UI:** `/delivery`, order detail
- **Tables:** `riders`, `rider_invites`

### 5.9 Payments Module (M-Pesa)

- **Functions:** STK push, transaction list/status, merchant payout business config
- **Routes:**
  - `POST /api/v1/mpesa/stk-push`
  - `/api/v1/mpesa/transactions*`
  - `/api/v1/mpesa/business-config`
- **UI:** `/tools/payments`, Settings payout section, order payment actions
- **Tables:** `mpesa_transactions`, merchant business-config storage

### 5.10 Team Module

- **Functions:** Staff lookup, invite, section ACL, activate/deactivate, password/reset link
- **Routes:** `/api/v1/staff/*`
- **UI:** `/team` (owner only)
- **Tables:** `users`, `user_memberships`

### 5.11 Settings & Integrations Module

- **Functions:** Channels summary, auto-reply toggle, inventory integration, KRA ETR config
- **Routes:** `/api/v1/settings/*`, `/api/v1/channels/*`, `/api/v1/kra/business-config`
- **UI:** `/settings`

---

## 6. Database Design

Primary keys are UUID strings (36 characters). Multi-tenancy is centered on `accounts` and `user_memberships`.

### 6.1 Core Tables

#### Account (`accounts`)

| Field | Type | Description |
|-------|------|-------------|
| id | string(36) | Primary key |
| business_name | string | Shop name |
| business_location | string | Address text |
| business_category | string | Retail category |
| logo_url | string/null | Logo path/URL |
| latitude / longitude | float/null | Map coordinates |
| orders_paused | boolean | Station pause flag |
| default_prep_minutes | int | Default prep time |
| station_last_heartbeat_at | datetime/null | Station online signal |
| created_at / updated_at | datetime | Audit timestamps |

#### User (`users`)

| Field | Type | Description |
|-------|------|-------------|
| id | string(36) | Primary key |
| name | string | Display name |
| email | string/null | Unique login email |
| password | string/null | Hashed password |
| user_role | string/null | Global role flags |
| require_change_password | boolean | Force password change |
| onboarded_at | datetime/null | Onboarding completion |
| created_at / updated_at | datetime | Audit timestamps |

#### User Membership (`user_memberships`)

| Field | Type | Description |
|-------|------|-------------|
| id | string(36) | Primary key |
| user_id | string(36) | FK → users |
| account_id | string(36) | FK → accounts |
| role | string | `system_admin` (owner) or `staff` |
| allowed_sections | text/null | Comma-separated section keys |
| is_active | boolean | Membership active flag |

#### Inventory Item (`inventory_items`)

| Field | Type | Description |
|-------|------|-------------|
| id | string(36) | Primary key |
| account_id | string(36) | FK → accounts |
| product_id | string(36) | FK → products |
| buying_price / selling_price | numeric | Pricing |
| stock_quantity | int/null | On-hand stock |
| low_stock_threshold | int/null | Alert threshold |
| is_active | boolean | Active flag |
| media | json/null | Media metadata |

#### Order (`orders`)

| Field | Type | Description |
|-------|------|-------------|
| id | string(36) | Primary key |
| account_id | string(36) | Shop scope |
| order_number | string | Human-readable order number |
| status | string | Lifecycle status |
| source | string | walk-in / phone / channel / etc. |
| fulfillment_type | string | pickup / delivery |
| payment_method | string/null | mpesa / cash / card / other |
| customer_name / phone / email | string/null | Customer contact |
| delivery_address | text/null | Delivery address |
| subtotal / delivery_fee / discount / total | numeric | Money fields (KES default) |
| assigned_rider_id | string/null | FK → riders |
| mpesa_transaction_id | string/null | Linked payment |

#### Order Item (`order_items`)

| Field | Type | Description |
|-------|------|-------------|
| id | string(36) | Primary key |
| order_id | string(36) | FK → orders |
| inventory_item_id / product_id | string/null | Line refs |
| product_name / product_sku | string | Snapshot for receipts |
| quantity | int | Units |
| unit_price / line_total | numeric | Pricing |

#### Rider (`riders`)

| Field | Type | Description |
|-------|------|-------------|
| id | string(36) | Primary key |
| account_id | string(36) | Shop scope |
| identity/contact fields | string | Rider details |
| status flags | boolean/string | Active/suspended presence |

#### M-Pesa Transaction (`mpesa_transactions`)

| Field | Type | Description |
|-------|------|-------------|
| id | string(36) | Primary key |
| account_id | string(36)/null | Shop scope |
| phone_number | string | Customer MSISDN |
| amount | int | Amount (KES) |
| status | string | pending / completed / failed… |
| checkout_request_id | string/null | Daraja checkout id |
| mpesa_receipt_number | string/null | Receipt on success |
| payout_* | mixed | Payout tracking fields |

### 6.2 Relationships (summary)

- One **Account** has many **Users** (via memberships), **InventoryItems**, **Orders**, **Riders**
- One **User** may belong to many **Accounts** through **UserMembership**
- One **Order** has many **OrderItems** and optional **Rider**
- Messaging/feed entities attach to the shop’s connected Instagram/channel account

---

## 7. Interface Design

### 7.1 Frontend Surfaces

| Surface | Routes | Purpose |
|---------|--------|---------|
| Auth | `/` → `/sign-in` (or dashboard if signed in), `/signup`, password pages | Access control |
| Onboarding | `/onboarding` | Create/configure shop |
| Dashboard | `/dashboard` | Sales KPIs |
| Commerce | `/inventory`, `/pos`, `/orders`, `/station` | Sell & fulfill |
| Social ops | `/tickets`, `/messages`, `/feeds` | Inbox & publish |
| Ops tools | `/delivery`, `/tools/*`, `/team` | Riders, automations, staff |
| Config | `/basics`, `/settings` | Profile & integrations |
| Companion | `/m/...` | Mobile merchant ops |
| Customer | `/shop/[token]`, `/pay/[token]`, `/track/[token]` | Public token UX |

### 7.2 API Interface (representative)

**Auth**

- `POST /api/v1/auth/signup` — Create user
- `POST /api/v1/auth/login` — Create session
- `GET /api/v1/auth/user` — Current user + memberships
- `POST /api/v1/auth/logout` — End session

**Inventory / Orders**

- `GET/POST /api/v1/inventory` — List/create items
- `GET/PATCH/DELETE /api/v1/inventory/{id}` — Item detail ops
- `GET/POST /api/v1/orders` — List/create orders
- Order transition / STK / rider endpoints under `/api/v1/orders/{id}/...`

**Messaging / Tools**

- `GET /api/v1/messages` — Inbox
- `POST /api/v1/messages/{id}/reply` — Reply
- CRUD `/api/v1/conversation-starters`, `/api/v1/auto-reply`

**Payments**

- `POST /api/v1/mpesa/stk-push` — Initiate STK
- `GET /api/v1/mpesa/transactions` — List transactions

### 7.3 Permission Gating

Frontend: `MerchantSectionGate` + nav from `merchant-nav.ts`  
Backend: section checks in `merchant_permissions.py`  
Owner-only: `/team` and merchant payout business-config writes

---

## 8. Security Considerations

- Passwords are hashed before storage
- Authenticated session required for merchant APIs
- CSRF cookie/token required for mutating requests
- Account scoping prevents cross-shop data access
- Staff limited by `allowed_sections`
- Platform Daraja/Meta secrets stay in environment / admin config — not merchant-editable app keys
- HTTPS enforced in production deployments
- Meta privacy / data-deletion endpoints supported for compliance

---

## 9. Appendix

### A. Component diagram (logical)

```
Merchant Browser
   → Next.js UI (dashboard shell, section pages)
      → Proxied FastAPI modules (auth, inventory, orders, messages, mpesa, staff, riders)
         → MySQL
         → External: Instagram webhooks/OAuth, M-Pesa callbacks
```

### B. API schema

- Interactive docs available from FastAPI OpenAPI/Swagger when the API server is running

### C. Sample JSON shapes (illustrative)

**Login success (conceptual):** session cookie set; `GET /api/v1/auth/user` returns user, memberships, active account.

**Create order (conceptual):**

```json
{
  "items": [{ "inventory_item_id": "...", "quantity": 2 }],
  "fulfillment_type": "pickup",
  "payment_method": "mpesa",
  "source": "walk_in"
}
```

**STK push (conceptual):**

```json
{
  "phone_number": "2547XXXXXXXX",
  "amount": 500,
  "account_reference": "ORDER-123",
  "transaction_desc": "Order payment"
}
```

---

## Document Control

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | 13 Aug 2026 | SDS recreated in academic format for TransChap Merchants |
