# Hotel Booking System — Base Structure

This repository is a base setup for the hotel booking project described in
`CODEX_BRIEF.md`.

Implemented now:

- React + Vite frontend entry point.
- Local MongoDB connection through Mongoose.
- Database initialization scripts.
- 17 Mongoose models covering reservations, payments, policies, roles, and room operations.

The remaining application folders are intentionally empty so their files can be
implemented manually later. No controllers, routes, middleware, services, auth,
or business logic have been generated.

## Structure

```text
server/
  scripts/                  # Database setup scripts
  src/
    config/                 # MongoDB connection
    models/                 # 17 implemented Mongoose models
    controllers/            # Reserved for manual implementation
    routes/                 # Reserved for manual implementation
    middleware/             # Reserved for manual implementation
    services/               # Reserved for manual implementation
    utils/                  # Reserved for manual implementation

client/
  src/
    api/                    # Reserved for API client code
    assets/                 # Static source assets
    components/             # Shared React components
    context/                # React contexts
    pages/                  # Application pages
    routes/                 # Frontend route definitions
    App.jsx
    main.jsx
    styles.css
```

## Requirements

- Node.js
- MongoDB installed and running locally on port `27017`

Docker is not used.

## Install

```bash
npm install
npm run install:all
```

Copy `server/.env.example` to `server/.env`. The default connection is:

```env
MONGO_URI=mongodb://127.0.0.1:27017/hotel_booking
```

## Initialize the database

```bash
npm run db:init --prefix server
```

This creates the 17 collections and synchronizes their indexes using the Mongoose
models. See `docs/use-case-collection-design.md` for the collection map and
business rules required in the future service layer.

Each model lives in its own file under `server/src/models`; import only the
models needed by a route or service (for example, `require('./models/Booking')`).

## Run the base project

```bash
npm run dev
```

The frontend runs at `http://localhost:5173` and the database watcher connects to
the local `hotel_booking` database.

## Verify

```bash
npm test
npm run build
```
