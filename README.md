# Hotel Desk — Hotel Management

Member 1's full-stack implementation, following `Hotel_Management_Balanced_Coding_Assignment.docx`. English UI and role-aware Home, built on React/Vite, Node.js/Express and MongoDB/Mongoose.

## Implemented scope

| Word UC     | Function                                                  | Access                                |
| ----------- | --------------------------------------------------------- | ------------------------------------- |
| UC01 / UC02 | Register, login, logout                                   | Public registration creates customers |
| UC03        | Profile and password change                               | Own account                           |
| UC09        | Create, search, edit, suspend/remove accounts             | Administrator                         |
| UC10        | Roles, scoped permissions, activation                     | Administrator                         |
| UC33        | Promotions, validity, usage limits, minimum spend         | Hotel manager                         |
| UC36        | Revenue chart/table, date filter, day/month grouping, CSV | Hotel manager                         |
| UC38        | Staff creation, editing and deactivation                  | Hotel manager                         |
| Additional  | Home with real navigation and permitted summaries         | All signed-in users                   |

Custom roles receive permissions within their scope. Managers access only their assigned hotel's data. Receptionists, housekeeping and customers have Home/profile access until the team's other modules are implemented. Booking, room operations and payment processing remain other members' work.

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
2. Set `MONGO_URI`, `CLIENT_ORIGIN` and a random `SESSION_SECRET` of at least 32 characters. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
3. For first setup, fill `ADMIN_USERNAME`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Passwords require 10–128 characters, including a letter and a number. Optional `HOTEL_NAME`/`HOTEL_CITY` creates an initial property for staff assignments; otherwise use hotels supplied by the group's hotel module.
4. Run:

```powershell
npm run db:init --prefix server
npm run setup --prefix server
```

Setup refuses to overwrite an existing administrator. Remove `ADMIN_PASSWORD` from `.env` afterward. Sign in as the administrator and use Accounts to create a manager with a hotel assignment and phone number.

```powershell
npm run dev
```

Client: http://localhost:5173; API: http://localhost:3001. Vite proxies `/api` to the API. Keep `.env` out of Git. Normal startup seeds missing system roles but never creates demo users or sample transactions.

`npm run build` builds `client/dist`. A production deployment must serve those static files with SPA fallback and proxy `/api` to `npm start --prefix server`, on the same HTTPS origin. Set `NODE_ENV=production`, `CLIENT_ORIGIN` to the exact HTTPS origin and `SESSION_SECRET`. Secure cookies require HTTPS; the API assumes one trusted reverse proxy in production. Deployment is not included in this change.

## Verify

```powershell
npm test
npm run build
npx --prefix client playwright install chromium
npm run test:e2e
```

API tests use their own disposable MongoDB and check validation, sessions, admin protection, privilege escalation, hotel isolation, promotions and transaction/date/refund accounting. Browser tests cover manager, administrator, customer and mobile workflows. Playwright starts the demo if no server is running; when reusing a running server, use demo mode because tests depend on its accounts. Browser tests create explicitly named test records in that demo.

## API integration for the team

API prefix `/api`. Responses use `{ data, meta? }`; errors use `{ error: { message, fields? } }`. Sessions use the `hotel.sid` HttpOnly cookie; fetch calls must include credentials. Writes require a matching `Origin` header. Use `authenticate`, `permit(permission)` and `hotelScope` for future protected routes and verify ownership on the server.

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
| GET, POST     | `/roles`, `/promotions`                         | List/create                           |
| PATCH, DELETE | `/roles/:id`, `/promotions/:id`                 | Edit/remove where permitted           |
| GET           | `/reports/revenue`                              | Report or CSV                         |

Users/staff/promotions lists accept `page`, `limit`, `q` (search), `status`; accounts/staff also accept `role`. Revenue accepts `from=YYYY-MM-DD`, `to=YYYY-MM-DD`, `groupBy=day|month`, optional `format=csv`. Dates use Vietnam time (UTC+7); report end dates are inclusive. Successful VND `Payment` records are counted by `paidAt`, completed VND `Refund` records by `processedAt`, joined through payment → booking → hotel. Net revenue = receipts minus refunds, including refunds for older payments. Other members must populate these fields when implementing transactions.

Coupons accept `code`, `discountType` (`percentage` or `fixed_amount`), `discountValue`, `usageLimit`, `minimumSpend`, `startDate`, `endDate`, `isActive`. Coupon end dates are **exclusive** at midnight UTC+7, as the editor explains. Used coupons cannot be renamed/deleted; deactivate them instead. Clients cannot set usage counters.

`server/src/services/promotions.js` exports `validateCoupon({ code, hotelId, customerId, subtotal })`, returning the validated discount. This is validation only: the booking/payment owner must atomically recheck/increment the usage limit and create `CouponUsage` during redemption, recording the discount snapshot on the booking. Calling validation does not reserve or redeem a coupon.

The existing 17 domain models are retained. Additive fields: `User.authVersion`, `Role.scope`, `Coupon.minimumSpend`; sessions use a separate Mongo collection. New features should use existing field names and extend the permission catalog explicitly. See `docs/member1-implementation.md` for implementation decisions.
