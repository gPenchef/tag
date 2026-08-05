# Repository Guidelines

## Project Structure & Module Organization

This is a two-player, real-time tag game built with Node.js, Express, and Socket.IO. `server.js` is the application entry point: it hosts static files and coordinates Socket.IO events. Keep game-domain logic in `server/` (`game.js` for match simulation and `lobbies.js` for lobby lifecycle). Share browser/server constants through `shared/game-config.js`. Client UI, rendering, and styles live in `public/`; `public/index.html` is the browser entry point. Put Node test files in `test/`.

## Build, Test, and Development Commands

- `npm install` installs the Express and Socket.IO dependencies.
- `npm start` starts the server at `http://localhost:3000`.
- `npm run dev` starts Node's watch mode and restarts on server-side changes.
- `npm test` runs the built-in Node test runner (`node --test`).

There is no separate build step; browser assets are served directly from `public/`.

## Coding Style & Naming Conventions

Use CommonJS modules (`require`/`module.exports`), two-space indentation, semicolons, and single-quoted strings. Prefer small, focused functions and early returns for invalid socket input. Use `camelCase` for functions and variables, `PascalCase` only for constructors/classes, and descriptive event names with namespaces, such as `lobby:join` and `game:state`. Keep configuration values centralized in `shared/game-config.js` instead of duplicating them in server or client code.

## Testing Guidelines

Tests use `node:test` with `node:assert/strict`. Name files `*.test.js` and place them under `test/`; name test cases as observable behavior, for example `test('the runner wins when the timer expires', ...)`. Add or update deterministic tests for gameplay, lobby, and configuration changes. Run `npm test` before submitting changes.

## Commit & Pull Request Guidelines

The repository has no established commit history to derive a convention from. Use concise, imperative subjects such as `Fix lobby cleanup after disconnect`; keep each commit scoped to one change. Pull requests should explain the behavioral change, list test commands run, link relevant issues, and include screenshots or a short recording for visible client changes. Call out Socket.IO event or shared configuration changes explicitly so both client and server impacts are reviewed.

## Configuration & Safety

Use `PORT` to choose a non-default local port (for example, `PORT=3001 npm start`). Validate all client-sent data at the Socket.IO boundary, and never treat lobby codes, names, or input payloads as trusted.
