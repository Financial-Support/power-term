# Contributing to power-term

## Prerequisites

- Node.js 18+
- Rust stable (install via [rustup](https://rustup.rs/))
- Tauri system dependencies ([docs](https://tauri.app/start/prerequisites/))

  **Linux**: `sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev build-essential libssl-dev patchelf`

## Getting started

```bash
git clone https://github.com/<your-org>/power-term.git
cd power-term
npm install
npm run dev            # Vite dev server (no Tauri shell)
npm run tauri:dev      # Full Tauri dev mode
```

## Running tests

```bash
npm test               # Vitest (frontend)
cargo test --features mock-keychain --lib  # Rust tests
```

## Setting up cloud sync (forks)

The sync feature requires a Supabase project and build-time environment variables. Without them, the app builds and runs normally but sync is disabled.

### Fork setup

1. Create a Supabase project
2. Enable the `github` OAuth provider in Supabase Auth
3. Set up the `power-term://auth/callback` deep-link URI in your GitHub OAuth app
4. Configure your Tauri app's `tauri.conf.json` `plugins.deep-link.schemes` to match
5. Build with:

```bash
POWER_TERM_SUPABASE_URL=https://your-project.supabase.co \
POWER_TERM_SUPABASE_ANON_KEY=your-anon-key \
npm run tauri:build
```

Without these env vars, sync-related UI will show a "not configured" message.

## Code style

- TypeScript: strict mode, no `any` unless absolutely necessary
- Rust: follow `cargo fmt` and `cargo clippy`
- No commented-out code
- Use existing patterns (zustand stores, IPC commands, etc.)

## Pull request process

1. Create a feature branch from `develop`
2. Write tests for new functionality
3. Ensure `npm test` and `cargo test --features mock-keychain --lib` pass
4. Open a PR against `develop`
5. CI runs automatically on PR — ensure all checks pass

## Releasing

See [RELEASE.md](./README.md#releasing) for the release process.
