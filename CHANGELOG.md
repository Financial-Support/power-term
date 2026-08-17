# Changelog

## 0.3.10 (2026-08-17)

- Fix Windows Ctrl+C so selected terminal text is copied instead of interrupting the running command.

## 0.3.9 (2026-08-06)

- Fix Windows tab closing freezes by moving PTY cleanup off the UI path.
- Fix Windows GitHub OAuth callbacks by forwarding deep links to the running app instance.
- Add persistent diagnostics logging with a copyable path in Settings → Sync.

## 0.3.8 (2026-08-06)

- Add an in-app Updates tab with signed update checks, release notes, download progress, install and relaunch actions.
- Add a Power Term app-menu shortcut for Check for Updates… and publish updater metadata from release CI.

## 0.3.7 (2026-08-06)

- Fix local PowerShell startup on Windows by omitting the Unix-only `-l` flag.
- Preserve GitHub OAuth callbacks received through a Windows startup deep link so sync login persists across app windows.

## 0.3.0 (2026-07-20)

- Add toggle to show/hide the main sidebar panel
- Keyboard shortcut ⌘B / Ctrl+B to open and close the sidebar
- Sidebar toggle command available in Command Palette (⌘K)
- Thin reveal button appears when sidebar is hidden
- Persist sidebar open/closed state across sessions

## 0.2.7 (2026-07-14)

- Open terminal HTTP(S) links in the default browser
- Combine quick theme and accent controls into one collapsible Appearance dock

## 0.2.6 (2025-07-04)

- Add collapse/expand toggle to AccentDock (accent color quick picker)
- Persist dock collapsed state across sessions

## 0.2.5 (2025-07-04)

- Add quick theme floating panel (System/Light/Dark) with collapse/expand
- Persist panel state across sessions

## 0.2.4 (2025-06-05)

- Initial release tracking begins
