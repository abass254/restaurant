# DukAI Merchants
## Software Requirements Specification (SRS)

**Version:** 1.0  
**Date:** 13 August 2026  
**Product:** DukAI Merchants — Merchant-Side Retail Platform

---

## 1. Introduction

### 1.1 Purpose

The purpose of this Software Requirements Specification (SRS) document is to provide a detailed description of the requirements for the **DukAI Merchants** system, a web-based retail commerce platform for shops.

This document outlines the functional and non-functional requirements of the system, serving as a reference for developers, testers, and stakeholders involved in the development process.

The system is designed to allow shop owners and staff to manage inventory, sell through POS and Instagram, fulfill orders (pickup/delivery), collect M-Pesa payments, and operate day-to-day retail workflows through a secure and user-friendly interface.

### 1.2 Intended Audience and Reading Suggestions

This document is intended for:

- **Developers** – to understand system functionality and implementation requirements
- **Project supervisors/lecturers** – to evaluate system completeness and design
- **Testers** – to validate system behavior against requirements
- **End users (merchants)** – to understand system capabilities

**Reading order:**

1. Start with Introduction  
2. Proceed to Overall Description  
3. Review Functional Requirements  
4. Then Non-functional Requirements  

### 1.3 Project Scope

DukAI Merchants is a web-based retail commerce system designed to help shops manage products, orders, staff, social messaging, delivery, and payments in one place.

The system aims to:

- Improve retail operations for shop owners and staff
- Provide secure multi-tenant authentication and section-based access control
- Allow merchants to sell in-store (POS) and via Instagram messaging
- Support order fulfillment, rider management, and M-Pesa payments

**Out of scope for this document:**

- Platform admin console
- Rider mobile runtime (except merchant invite/assign flows)
- Services / appointments product (separate vertical)

The system is built using:

- **FastAPI** (Backend)
- **Next.js + React** (Frontend)
- **MySQL** (Database)

---

## 2. Overall Description

### 2.1 User Classes and Characteristics

| User Class | Description |
|------------|-------------|
| Shop Owners | Users who create/own a shop account; full access including Team and payout settings |
| Staff | Invited users with limited section permissions (e.g. POS, Orders, Inventory) |
| Prospects | New users who sign up and complete onboarding to create a shop |
| Customers (external) | People who pay/track orders via public token links (not dashboard users) |

**Characteristics:**

- Basic computer literacy
- Ability to use web applications
- No advanced technical knowledge required for end users
- Owners may manage multiple shops; staff work within assigned sections

### 2.2 Operating Environment

The system operates in the following environment:

- **Frontend:** Web browser (Chrome, Edge, Firefox, Safari)
- **Backend:** FastAPI server (Python)
- **Database:** MySQL
- **OS:** macOS / Windows / Linux (server or local development)
- **Network:** Internet or localhost (dev: frontend `7000`, API `7001`)
- **Production (Docker):** frontend `7070`, API `7071`, MySQL

### 2.3 Design and Implementation Constraints

- System must use FastAPI as the API-only backend
- Frontend must be built with Next.js (React)
- Session-based authentication with CSRF protection must be implemented
- Must support browser-based interaction (merchant dashboard + companion routes)
- Browser talks only to Next.js; API is proxied (`/api`, `/auth`, `/sanctum`, etc.)
- Product is retail-only in this codebase
- Merchants configure M-Pesa payout destination; platform holds Daraja credentials
- Instagram is the primary available messaging channel

### 2.4 User Documentation

The system will include:

- On-screen instructions (forms, empty states, onboarding wizard hints)
- Settings and Tools guidance for channels, payments, and Instagram checklist
- Architecture / setup docs for developers (`README.md`, `docs/ARCHITECTURE.md`)

### 2.5 Assumptions and Dependencies

**Assumptions:**

- Users have internet access (or local network for development)
- Users have modern web browsers
- Backend and database servers are available
- Platform-level Meta and M-Pesa credentials are configured when those features are used
- Shop location coordinates are set when Google Maps / delivery features are enabled

**Dependencies:**

- FastAPI / SQLAlchemy / MySQL
- Next.js (React)
- Meta Instagram APIs (OAuth, webhooks, messaging, publish)
- Safaricom Daraja (M-Pesa STK)
- Optional: Google OAuth, Google Maps, AI providers, SMTP mail

---

## 3. Functional Requirements

Each requirement is uniquely identified.

### REQ-1: User Registration

The system shall allow new users to create an account by providing:

- Name
- Email
- Password  
(Optional Google signup when configured)

**Expected behavior:**

- System validates input fields
- Stores user securely in the database
- User may not have a shop yet
- Returns success or error message

### REQ-2: User Login

The system shall allow registered users to log in using:

- Email
- Password

**Expected behavior:**

- System authenticates credentials
- Creates a user session (cookie + CSRF)
- Grants access to merchant resources for the active shop

### REQ-3: User Logout

The system shall allow authenticated users to log out.

**Expected behavior:**

- System destroys session
- User is redirected to `/sign-in`

### REQ-4: Password Management

The system shall support forced password change and password reset via token.

**Expected behavior:**

- Users flagged to change password are redirected to change-password
- Reset links allow setting a new password when mail/token flow is enabled

### REQ-5: Create / Onboard Shop

The system shall allow an authenticated user to create a retail shop and complete onboarding.

**Expected behavior:**

- Wizard guides Business → Catalog → Payment → AI → Channels → Go live
- Shop (account) is created and linked to the user as owner
- User is routed to the dashboard when ready

### REQ-6: Switch Active Shop

The system shall allow users with multiple memberships to switch the active merchant account.

**Expected behavior:**

- Active account is updated in session
- Subsequent data access is scoped to the selected shop

### REQ-7: Section Access Control

The system shall restrict merchant navigation and APIs by section permissions.

**Sections:** dashboard, feeds, tickets, inventory, pos, orders, delivery, tools, settings

**Expected behavior:**

- Owners have full access
- Staff only see granted sections
- Unauthorized access is denied

### REQ-8: Business Profile (Basics)

The system shall allow users with settings access to manage:

- Business name
- Category
- Logo
- Address and map coordinates

**Expected behavior:**

- Changes are saved to the account
- When maps are enabled and coordinates are missing, users are gated to Basics

### REQ-9: Dashboard Overview

The system shall provide a sales dashboard for users with dashboard access.

**Expected behavior:**

- Shows KPIs from orders and inventory (revenue, units, customers, charts)
- Refreshes periodically while open

### REQ-10: Inventory Management

The system shall allow users with inventory access to create, view, update, and delete inventory items.

**Expected behavior:**

- Items are scoped to the active shop
- Supports media upload, optional AI image generation, import, and post-to-feed

### REQ-11: Point of Sale (POS)

The system shall allow users with POS access to build a cart and create orders.

**Expected behavior:**

- Cart from inventory (including scan-style lookup)
- Supports pickup/delivery and payment methods (M-Pesa, cash, card, other)
- Creates an order linked to the shop

### REQ-12: Order Management

The system shall allow users with orders access to list, view, update, and transition orders.

**Expected behavior:**

- Filter by status / source / fulfillment
- Advance through statuses (e.g. placed → payment → prepared → ready → delivered/picked up)
- Support cancel/refund paths
- Optional rider assign and handoff for delivery

### REQ-13: Station Operations

The system shall provide a Station UI for live order queue and store status.

**Expected behavior:**

- Accept/advance orders
- Pause/resume/busy store and prep timing
- Heartbeat / online presence for the station

### REQ-14: Tickets / Messaging Inbox

The system shall allow users with tickets access to view and reply to customer conversations.

**Expected behavior:**

- Unified inbox (Tickets / Messages)
- Reply and resolve ticket status
- Clear empty state when no channel is connected

### REQ-15: Feeds

The system shall allow users with feeds access to browse, compose, and publish social posts (Instagram when connected).

**Expected behavior:**

- Link posts to inventory items
- View insights/analytics when permissions allow

### REQ-16: Delivery Fleet Management

The system shall allow users with delivery access to invite and manage riders.

**Expected behavior:**

- Invite by email / join link
- List, update, suspend riders
- Support test delivery dispatch

### REQ-17: Tools — Starters and Auto-Reply

The system shall allow users with tools access to manage conversation starters and auto-reply rules.

**Expected behavior:**

- CRUD, toggle, and sync starters
- CRUD and toggle auto-reply rules

### REQ-18: M-Pesa Payments

The system shall allow authorized merchants to initiate STK Push and view transactions.

**Expected behavior:**

- STK from Tools/Payments and/or order flows
- Transaction status is stored and listable
- Owners configure payout destination (paybill/till/pochi); platform credentials remain env-managed

### REQ-19: Team Management

The system shall allow shop owners to invite and manage staff.

**Expected behavior:**

- Lookup by email, assign allowed sections
- Activate/deactivate staff
- Set password / send reset link
- Non-owners cannot access Team

### REQ-20: Settings and Integrations

The system shall provide settings for channels summary, auto-replies, inventory integration, M-Pesa payout profile, and KRA ETR configuration.

**Expected behavior:**

- Channel connect/remove is restricted to platform admins
- Merchant can view channel status and configure shop-level integrations

### REQ-21: Notifications and Nav Badges

The system shall show navigation badge counts for tickets and orders and support in-app notifications.

**Expected behavior:**

- Badge counts from nav-counts API
- Notifications can be listed and marked read

### REQ-22: Customer Token Surfaces

The system shall provide public token-based pages for shop checkout, payment, and order tracking.

**Expected behavior:**

- Customers use `/shop/[token]`, `/pay/[token]`, `/track/[token]`
- Actions update merchant-visible orders/payments

---

### 3.1 System Features

#### 3.1.1 User Authentication & Tenancy

**Description:** Handles signup, login, logout, session/CSRF, multi-shop membership, and section ACLs.  
**Priority:** High  

**Stimulus/Response:**

- User enters credentials → system validates → grants or denies access  
- User logs out → session destroyed  
- Staff opens restricted page → access denied / redirected  

#### 3.1.2 Shop Onboarding & Business Profile

**Description:** Creates retail shop, wizard setup, basics (name, category, logo, map pin).  
**Priority:** High  

**Stimulus/Response:**

- User completes wizard → shop created → dashboard access  
- Missing location with maps enabled → redirect to Basics  

#### 3.1.3 Inventory & POS

**Description:** Catalog/stock management and in-store checkout.  
**Priority:** High  

**Stimulus/Response:**

- User adds inventory → stored for shop  
- User checks out POS cart → order created  

#### 3.1.4 Orders & Station

**Description:** Order lifecycle, analytics, kitchen/station queue, store pause/busy.  
**Priority:** High  

**Stimulus/Response:**

- New order → appears in Orders/Station  
- Staff advances status → order updated  
- Station paused → online acceptance affected per store status rules  

#### 3.1.5 Messaging, Feeds & Automations

**Description:** Instagram inbox, tickets, feeds publish, starters, auto-replies.  
**Priority:** High  

**Stimulus/Response:**

- Customer DMs shop → ticket/message appears  
- Merchant replies → outbound message sent  
- Rule matches → auto-reply sent  

#### 3.1.6 Delivery & Payments

**Description:** Rider invite/assign and M-Pesa STK + payout profile.  
**Priority:** High  

**Stimulus/Response:**

- Owner invites rider → join link issued  
- Merchant initiates STK → transaction pending → callback updates status  

#### 3.1.7 Team & Settings

**Description:** Staff permissions, channels summary, KRA/inventory integrations.  
**Priority:** Medium  

**Stimulus/Response:**

- Owner invites staff with sections → staff sees limited nav  
- Owner saves payout destination → used for settlement orchestration  

---

## 4. External Interface Requirements

### 4.1 User Interfaces

- Web-based merchant interface built with Next.js / React
- Forms and pages for:
  - Login / Signup / Onboarding
  - Dashboard, Inventory, POS, Orders, Station
  - Tickets, Feeds, Delivery, Tools, Team, Basics, Settings
- Mobile companion routes under `/m/...`
- Clean UI using the existing DukAI dashboard design system

### 4.2 Hardware Interfaces

- Runs on standard computers (PC/laptop) and modern phones (companion)
- No special hardware required (barcode scanning may use device camera/keyboard wedge where supported)

### 4.3 Software Interfaces

- Backend: FastAPI REST API under `/api/v1`
- Frontend communicates via HTTP with `credentials: "include"`
- Database: MySQL
- External: Meta Instagram, Daraja M-Pesa, optional Google Maps / OAuth / AI / SMTP

### 4.4 Communication Interfaces

- HTTP/HTTPS protocol
- RESTful API communication
- JSON data format
- Webhooks for Instagram and M-Pesa callbacks
- OAuth redirect for Instagram (and optional Google)

---

## 5. Other Non-Functional Requirements

### 5.1 Performance Requirements

- The system shall respond to typical user requests within 2–3 seconds under normal load
- The system shall support multiple shops/users simultaneously without significant delay
- Dashboard and station views shall refresh without requiring full manual reload for basic ops freshness
- API responses shall be optimized for quick data retrieval

### 5.2 Safety Requirements

- The system shall prevent accidental data loss through validation
- Confirmation prompts shall be used before destructive actions (e.g. delete inventory, remove staff)
- Input validation shall prevent invalid or harmful data entries
- Location gate reduces incorrect delivery setup when maps are enabled

### 5.3 Security Requirements

- The system shall require authentication before accessing merchant data
- User sessions shall be securely managed (cookies + CSRF)
- Passwords shall be stored in hashed/encrypted form
- CSRF protection shall be implemented for mutating requests
- Users shall only access data for shops they belong to
- Staff shall only access granted sections
- Platform M-Pesa/Meta secrets shall not be exposed in merchant UI

### 5.4 Software Quality Attributes

- **Usability:** Clear navigation and onboarding for non-technical merchants
- **Reliability:** Core retail flows (POS, orders, payments) should operate without crashes
- **Maintainability:** Modular frontend routes and backend API modules
- **Scalability:** Multi-tenant account model supports many shops
- **Efficiency:** Minimal unnecessary client-server chatter beyond polling needs

---

## 6. Other Requirements

- Database must support account–user membership relationships and shop-scoped commerce data
- System must be web-based and accessible via browser
- System must support RESTful API architecture
- Default timezone Africa/Nairobi; currency UX in KES
- Privacy, terms, and data-deletion pages required for Meta compliance

---

## 7. References

- DukAI Merchants `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DOCKER.md`
- `docs/META_APP_REVIEW.md`
- FastAPI Documentation
- Next.js Documentation
- Meta Instagram Graph API Documentation
- Safaricom Daraja API Documentation

---

## Appendix A: Glossary

| Term | Meaning |
|------|---------|
| API | Application Programming Interface |
| ACL | Access Control List (section permissions) |
| Account | A shop / tenant business |
| CRUD | Create, Read, Update, Delete |
| CSRF | Cross-Site Request Forgery |
| Daraja | Safaricom M-Pesa API platform |
| Membership | User’s role and permissions on an account |
| Owner | Shop administrator (`system_admin` membership role) |
| POS | Point of Sale |
| REST | Representational State Transfer |
| SRS | Software Requirements Specification |
| Station | Live order queue / kitchen ops UI |
| STK | M-Pesa STK Push payment prompt |
| UI | User Interface |

---

## Document Control

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | 13 Aug 2026 | SRS recreated in academic format for DukAI Merchants |
