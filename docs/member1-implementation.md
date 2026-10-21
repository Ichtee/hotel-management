# Member 1 implementation contract

Source of assignment: Hotel_Management_Balanced_Coding_Assignment.docx (40 UC version). SRS supplies business detail; its UC numbering differs. Scope: UC01 Register, UC02 Login, UC03 Profile, UC09 User accounts, UC10 Roles/permissions, UC33 Promotions, UC36 Revenue, UC38 Staff, plus the requested Home after login. English UI. Implement on ducanh. No implementation of other members' booking/payment/room modules.

## Design and decisions

- React/Vite JavaScript client and Express REST API, existing MongoDB/Mongoose entities. Reuse User for customers and employees. Existing model files remain the integration contract.
- HttpOnly cookie sessions in MongoDB, scrypt password hashing, session regeneration at login, logout invalidation, same-origin write protection, rate-limited authentication. Read current account status and role permissions on every request; password change invalidates prior sessions.
- Public registration always creates a customer. All active roles access their own profile/Home. Admin manages users and roles. Manager manages hotel-scoped staff/coupons/revenue. Receptionist/housekeeping cannot administer. User profile updates cannot change role, status or hotel.
- Five seeded system roles. Admin's management permissions cannot be removed; administrator accounts cannot be demoted/deactivated through the application, preventing lockout. Other role permissions and active state are editable, custom self/hotel roles can be created; in-use roles cannot be deleted. Hotel roles never receive system-level account/role permissions.
- Staff assignment by a Manager is restricted to receptionist/housekeeping roles, within the manager's hotel. Name 2–50 chars, valid email, phone 10–11 digits, active role and existing hotel required. Soft deactivation preserves historical references.
- Coupons: unique alphanumeric code, positive discount, percentage <=100, required positive integer usage limit, validity interval, minimum spend (additive schema field), enable/disable. Do not accept usageCount from client. Existing coupon-use records remain untouched. Used coupons are archived via deactivation rather than deleted. Provide a reusable validation/discount service for reservation integration, not a fake checkout.
- Revenue reads successful VND payments by paidAt and completed VND refunds by processedAt, joined to actual bookings for hotel ownership. Refund attribution follows payment -> booking. Periods use Asia/Ho_Chi_Minh, inclusive input dates, exclusive following-day bound; total = receipts - refunds, including refunds of prior-period payments. Group daily/monthly with chart/table and CSV export. No fabricated live figures.
- Home is a real role-aware workspace with links to available functions and honest empty states. No fake booking/search controls. Customer home offers profile/security; manager/admin home exposes their permitted tools.
- Visual direction: English, warm ivory/lighter paper surfaces, charcoal text, olive action color, restrained terracotta only for negative states; hospitality ledger motif, clear tables, editorial serif headings and readable sans controls. 4px spacing scale, 44px controls, responsive navigation, native accessible inputs/dialogs. Motion limited to feedback with reduced-motion support.
- Local demo uses a separate development database and explicit sample fixtures to exercise all screens. Production startup requires MONGO_URI; no demo accounts created automatically in a real database.

## Execution plan and verification ledger

1. API foundation/auth/profile: write failing integration tests, install required dependencies, implement session security and profile/password flows. Verify registration, duplicate handling, login/logout, mass-assignment prevention, CSRF, role/status revocation.
2. Admin/roles/staff/coupons/revenue: failing API tests first, implement validators and hotel scoping, verify cross-hotel denial, role escalation, used coupon behavior, period/refund math and CSV parity.
3. English frontend: shared app shell, protected navigation, Home, auth/profile, account/staff editors, role permission editor, promotions, reports. Verify build and browser flows, errors/empty/loading states, desktop/mobile.
4. Integration handoff: seed/demo/start scripts, README API contracts and run commands; complete regression and independent code review; leave changes on ducanh, no automatic remote push.

Completed on 2026-10-08:

- All eight Member 1 use cases and the additional role-aware Home implemented in the API and English frontend.
- `npm test`: 17 model validations and 12 API integration tests passed using disposable MongoDB. Includes setup, whitespace-preserving passwords, session revocation, inactive-role deactivation, nonhotel employment validation, tenant isolation and revenue/refund boundaries.
- `npm run test:e2e`: all 4 Chromium workflows passed, including the automatically started demo and 390px mobile viewport. Desktop and mobile screenshots inspected for Home, authentication, staff forms, profile, promotions and revenue.
- `npm run build` passed. Runtime dependency audit returned zero reported vulnerabilities for root/server/client. `git diff --check` passed.
- Independent code review found an inactive-role account-deactivation issue; fixed and covered by regression. Mobile horizontal overflow fixed; mobile navigation supports Escape, focus trapping and inactive-background isolation.
- README includes demo/persistent setup commands, roles/accounts, API integration, deployment requirements and the boundary between coupon validation and future atomic booking redemption.
- Changes remain uncommitted on `ducanh`; local identity is DucAnh <anhkk0904@gmail.com>. No remote push.
