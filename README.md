# GrandStay — Hotel Management System

Full-stack implementation of `SRS_Hotel_Management_final_v2_5.docx` (SE1938 NJ - Team 6): React/Vite client, Node.js/Express API and MongoDB/Mongoose. One hotel, one room per booking (LIM-01, LIM-02).

## Implemented scope

| Role | Functions (SRS use cases) |
| ---- | ------------------------- |
| Guest | Search available room types for a stay, room details and reviews, register, login (UC01, UC02, UC04, UC05) |
| Customer | Book and pay the deposit online, modify, cancel, check-in / check-out requests, reviews, invoices, notifications, profile (UC03, UC06-UC10, UC12, UC13, UC39) |
| Receptionist | Walk-in booking, booking list with the views of the day, check-in, room change, services, penalties, check-out and final payment, cancellations and refunds, ad-hoc cleaning, room issues (UC11, UC14-UC21, UC31, UC35, UC37, UC38) |
| Housekeeping Staff | Assigned cleaning tasks, damage / room issue report (UC30, UC31) |
| Hotel Manager | Rooms, room types and price rates, coupons, services and compensation items, policies and hotel information, staff accounts and role permissions, customer blacklist, housekeeping plan, review moderation, reports (UC22-UC29, UC33, UC34, UC36) |
| Admin | Hotel Manager accounts, audit log (UC32) |

The roles are fixed (SRS 2.4.3); the Hotel Manager only adjusts the permissions of the Receptionist and Housekeeping roles (UC33).

## Install and preview

Use Node.js 22.12+ (verified with Node 24) and npm.

```powershell
npm ci
npm run install:all
npm run demo
```

Open **http://localhost:5173**. Demo mode starts an isolated temporary MongoDB process. It does not connect to `server/.env` or your existing database. The first run downloads a MongoDB binary and needs internet access. All demo changes disappear when it stops. Do not run demo and normal dev servers simultaneously.

| Demo role     | Email                   |
| ------------- | ----------------------- |
| Administrator | admin@demo.hotel        |
| Hotel manager | manager@demo.hotel      |
| Customer      | customer@demo.hotel     |
| Receptionist  | reception@demo.hotel    |
| Housekeeping  | housekeeping@demo.hotel |

All **demo-only** passwords: `HotelDemo123!`. Revenue, staff and promotion fixtures are sample data. `Ctrl+C` stops the preview.

## Use a persistent database

1. Start MongoDB and copy `server/.env.example` to `server/.env`.
2. Set `MONGO_URI`, `CLIENT_ORIGIN` and a random `JWT_SECRET` of at least 32 characters. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
3. For first setup, fill `ADMIN_USERNAME`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Passwords require 8–128 characters with an upper-case letter, a lower-case letter and a digit (CR-12).
4. Run:

```powershell
npm run db:init --prefix server
npm run setup --prefix server
```

Setup refuses to overwrite an existing administrator. Remove `ADMIN_PASSWORD` from `.env` afterward. Sign in as the administrator and use Hotel managers to create a Hotel Manager account.

```powershell
npm run dev
```

Client: http://localhost:5173; API: http://localhost:3001. Vite proxies `/api` to the API. Keep `.env` out of Git. Normal startup seeds missing system roles but never creates demo users or sample transactions.

`npm run build` builds `client/dist`. A production deployment must serve those static files with SPA fallback and proxy `/api` to `npm start --prefix server`, on the same HTTPS origin. Set `NODE_ENV=production`, `CLIENT_ORIGIN` to the exact HTTPS origin and `JWT_SECRET`. Secure cookies require HTTPS. Step-by-step deployment to Render (API) + Vercel (web) + MongoDB Atlas: [DEPLOY.md](DEPLOY.md).

## Payment gateway (SePay)

Only the deposit (UC10) is paid online, through a gateway adapter; the balance is paid at the front desk at check-out (UC11, BR-14). By default a built-in sandbox gateway is used (tests, offline demo). To use SePay set `PAYMENT_PROVIDER=sepay` plus `SEPAY_ENV`, `SEPAY_MERCHANT_ID`, `SEPAY_SECRET_KEY` and `PUBLIC_URL` (see `server/.env.example`).

1. Create a SePay Payment Gateway account at my.sepay.vn, start with **Sandbox** and copy its Merchant ID and Secret Key.
2. In SePay open Payment Gateway, then IPN, and set the URL to `https://<api-host>/api/payments/sepay/ipn` (public HTTPS; use a tunnel such as ngrok for a local server).
3. The browser is sent to SePay with a form signed on the server, then back to `PUBLIC_URL/api/payments/return`, which only opens the result screen. The IPN (header `X-Secret-Key`, event `ORDER_PAID`) confirms the payment after the server checks the amount and asks SePay for the order; if no IPN arrives, the result screen asks SePay itself.
4. Frontend and API on different domains (for example Vercel and Render) break the session cookie. Let the frontend host proxy `/api` to the API (a Vercel rewrite from `/api/:path*`), and set `PUBLIC_URL` and `CLIENT_ORIGIN` to the frontend domain.

SePay's own pages are mocked in the automated tests; `client/e2e/sepay.spec.js` documents how to run the browser check against SePay mode.

## Verify

```powershell
npm test
npm run build
npx --prefix client playwright install chromium
npm run test:e2e
```

API tests use their own disposable MongoDB and check validation, sessions, admin protection, privilege escalation, promotions, bookings, payments and transaction/date/refund accounting. Browser tests cover manager, administrator, customer and mobile workflows. Playwright starts the demo if no server is running; when reusing a running server, use demo mode because tests depend on its accounts. Browser tests create explicitly named test records in that demo.

## API integration for the team

API prefix `/api`. Responses use `{ data, meta? }`; errors use `{ error: { message, fields? } }`. Sessions use a JWT in the `hotel.token` HttpOnly cookie; fetch calls must include credentials. Writes require a matching `Origin` header. Use `authenticate` and `permit(permission)` for protected routes and verify ownership on the server.

| Methods       | Endpoint                                        | Purpose                               |
| ------------- | ----------------------------------------------- | ------------------------------------- |
| POST          | `/auth/register`, `/auth/login`, `/auth/logout` | Authentication                        |
| GET           | `/auth/me`, `/profile`                          | Current account and permissions       |
| PATCH         | `/profile`                                      | fullName, phone, address, dateOfBirth |
| PUT           | `/profile/password`                             | currentPassword, newPassword          |
| GET           | `/options`                                      | Allowed role and hotel choices        |
| GET, POST     | `/users`, `/staff`                              | List/create accounts or scoped staff  |
| PATCH         | `/users/:id`, `/staff/:id`                      | Update account fields/status          |
| DELETE        | `/staff/:id`                                    | Soft suspension                       |
| GET, POST     | `/promotions`                                   | List/create coupons                   |
| PATCH, DELETE | `/promotions/:id`                               | Edit/remove where permitted           |
| GET           | `/public/availability`                          | Room types free for a stay: rooms left, price of the stay (`checkIn`, `checkOut`, `guests`) |
| POST          | `/bookings/quote`                               | Server price of a stay: nights, coupon, total, deposit |
| GET           | `/bookings/search`                              | Front-desk list: `status`, `view` (`arrivals`, `departures`, `overdue_check_in`, `overdue_check_out`), `q` (code, guest name or phone), `page`, `limit` |
| POST          | `/jobs/:name`                                   | Scheduled jobs for an external cron (header `X-Job-Secret`), see DEPLOY.md |
| GET           | `/reports/revenue`                              | Report or CSV                         |

Users/staff/promotions lists accept `page`, `limit`, `q` (search), `status`; accounts/staff also accept `role`. Revenue accepts `from=YYYY-MM-DD`, `to=YYYY-MM-DD`, `groupBy=day|month`, optional `format=csv`. Dates use Vietnam time (UTC+7); report end dates are inclusive. Successful VND `Payment` records are counted by `paidAt`, completed VND `Refund` records by `processedAt`, joined through payment → booking → hotel. Net revenue = receipts minus refunds, including refunds for older payments. Other members must populate these fields when implementing transactions.

Coupons accept `code`, `discountType` (`percentage`), `discountValue`, `usageLimit`, `minimumSpend`, `startDate`, `endDate`, `isActive`. Coupon end dates are **exclusive** at midnight UTC+7, as the editor explains. Used coupons cannot be renamed/deleted; deactivate them instead. Clients cannot set usage counters.

`server/src/services/promotions.js` exports `validateCoupon({ code, customerId, subtotal })` (no `customerId` for a walk-in guest), returning the validated discount. This is validation only: booking creation increments the usage count and creates `CouponUsage`, recording the discount snapshot on the booking. Calling validation does not reserve or redeem a coupon.

The existing 17 domain models are retained. Additive fields: `User.authVersion`, `Role.scope`, `Coupon.minimumSpend`; sessions use a separate Mongo collection. New features should use existing field names and extend the permission catalog explicitly. See `docs/member1-implementation.md` for implementation decisions.
