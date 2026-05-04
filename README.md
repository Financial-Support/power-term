# power-term

A modern terminal built with Tauri + React + xterm.js.

## Install

### macOS (Homebrew Cask)

```bash
brew install --cask power-term
```

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
# AppImage
chmod +x power-term-*.AppImage
./power-term-*.AppImage

# .deb
sudo dpkg -i power-term-*.deb
```

### Windows

Run the `.msi` installer from [Releases](https://github.com/band/power-term/releases).

## Build from source

Requires Node 18+, Rust stable, and Tauri prerequisites for your platform ([docs](https://tauri.app/start/prerequisites/)).

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

## License

MIT
