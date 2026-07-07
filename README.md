# power-term

A modern terminal built with Tauri + React + xterm.js.

## Install

### macOS (Homebrew Cask)

```bash
brew tap bango97/power-term
brew install --cask power-term
```

The app installs to `/Applications/power-term.app`. The cask runs `xattr -cr` automatically as a postflight step — see below for context.

> **Heads-up**: power-term is **not code-signed or notarized** by Apple (we don't pay the $99/year Developer Program fee). macOS Gatekeeper will block the app on first launch with a *"power-term is damaged and can't be opened"* or *"cannot verify developer"* error. This is expected — see workaround below.

#### First-launch fix

After installing, run once:

```bash
xattr -cr /Applications/power-term.app
```

This clears the quarantine attribute macOS adds to apps downloaded from the internet. After that, power-term opens normally like any other app.

If you installed manually (drag-and-drop from a `.dmg`), the same command applies.

#### Why this is needed

macOS tags every downloaded file with `com.apple.quarantine`. Gatekeeper then refuses to run the app unless its signature chains to an Apple-issued Developer ID. Since power-term is unsigned, the OS can't verify it — the `xattr -cr` command strips the quarantine flag so Gatekeeper stops checking.

You're not bypassing security wholesale: SIP, sandboxing, and TCC permission prompts still apply normally.

### Linux

```bash
# .deb
sudo dpkg -i power-term-*.deb
```

### Windows

Run the `.exe` installer (NSIS) from [Releases](https://github.com/Financial-Support/power-term/releases).

## Build from source

Requires Node 18+, Rust stable, and Tauri prerequisites for your platform.

- **Linux**: `sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev build-essential libssl-dev patchelf`
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Windows**: Microsoft Visual Studio C++ Build Tools

See the [Tauri prerequisites docs](https://tauri.app/start/prerequisites/) for details.

```bash
npm install
npm run tauri:dev      # development
npm run tauri:build    # production bundle
```

Output lands in `src-tauri/target/release/bundle/`.

## Development

```bash
npm run dev            # vite only (no tauri shell)
npm run test           # run unit tests once
npm run test:watch     # watch mode
```

### Rust tests

```bash
cargo test --features mock-keychain --lib
```

## Sync / Cloud features

power-term includes an optional cloud-sync feature (hosts, snippets, SSH keys) powered by Supabase + GitHub OAuth. **Sync is gated behind build-time environment variables** — forks won't have it enabled unless they configure their own Supabase project.

To enable sync when building, set:

```bash
POWER_TERM_SUPABASE_URL=https://your-project.supabase.co
POWER_TERM_SUPABASE_ANON_KEY=your-anon-key
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed fork setup instructions.

## AI features

The built-in AI command bar calls the Anthropic API (`claude-sonnet-4-6`) directly from your browser. You supply your own API key, stored in the OS keychain. No key is ever bundled with the app.

## Releasing

Releases are built by the CI workflow (`.github/workflows/release.yml`) on tag push — produces DMG (macOS), NSIS `.exe` (Windows), and `.deb` (Linux).

A convenience script is also available for macOS-only development releases:

```bash
scripts/release.sh 0.2.0
```

Bumps the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`; builds DMGs for both arches; tags and pushes; updates the cask formula. Requires `gh auth login` and both `aarch64-apple-darwin` / `x86_64-apple-darwin` rustup targets.

**Note**: `release.sh` only builds macOS DMGs. For multi-platform releases, push a version tag and let CI handle it.

## License

MIT
