# Front-desk booking API

All endpoints are rooted at `/api/front-desk` and require an authenticated
staff user. Until the authentication module is connected, pass the staff user
ID through `x-user-id`; production authentication should set `req.user`.

## Manage customer information

These endpoints support UC24, allowing reception staff to find a customer and
maintain only their operational contact/profile details. They cannot change a
customer's login credentials, role, account status, or loyalty points.

| Method and endpoint | Purpose |
| --- | --- |
| `GET /customers?search=&status=&page=1&limit=20` | List customers; search name, username, email, or phone. Deleted accounts are excluded unless `status=deleted`. |
| `GET /customers/:customerId` | View one customer's profile, including their ID document number. |
| `PATCH /customers/:customerId` | Update one or more of `fullName`, `phone`, `address`, `dateOfBirth`, or `idDocumentNo`. |

Example update body:

```json
{
  "fullName": "Nguyen An",
  "phone": "0900000000",
  "address": "Hai Chau, Da Nang"
}
```

| Screen | Method and endpoint | Required body fields |
| --- | --- | --- |
| Create booking | `POST /bookings` | `hotelId`, `customerId`, `checkInDate`, `checkOutDate`, `rooms: [{ roomId, guestCount }]` |
| Modify booking | `PATCH /bookings/:bookingId` | Any of `checkInDate`, `checkOutDate`, `rooms`, `guestName`, `guestPhone` |
| Cancel booking | `POST /bookings/:bookingId/cancel` | Optional `reason` |
| Check in | `POST /bookings/:bookingId/check-in` | None |
| Change room | `POST /bookings/:bookingId/change-room` | `oldRoomId`, `newRoomId`; optional `note` |
| Record additional service | `POST /bookings/:bookingId/services` | `serviceId`, `quantity`; optional `note` |
| Check out | `POST /bookings/:bookingId/check-out` | None |

Example: create a booking

```json
{
  "hotelId": "66d0e1dc0c110f9900000001",
  "customerId": "66d0e1dc0c110f9900000002",
  "checkInDate": "2026-11-20",
  "checkOutDate": "2026-11-23",
  "rooms": [{ "roomId": "66d0e1dc0c110f9900000003", "guestCount": 2 }],
  "guestName": "Nguyen An",
  "guestPhone": "0900000000"
}
```

The API derives rates from the room type and service catalog rather than
accepting client-provided prices. It rejects date overlaps, captures a booking
event for every change, moves rooms to `occupied` on check-in and `cleaning` on
room change/check-out, and produces or updates an unpaid invoice at check-out.
