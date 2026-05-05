export type Theme = 'light' | 'dark' | 'auto';
export type CursorStyle = 'block' | 'underline' | 'bar';

export interface Settings {
  shell: string | null;
  font_family: string;
  font_size: number;
  theme: Theme;
  cursor_blink: boolean;
  cursor_style: CursorStyle;
  scrollback_lines: number;
  ssh_connect_timeout_secs: number;
  ssh_keepalive_interval_secs: number;
  terminal_theme: string;
  /** "system" (use macOS AccentColor) or a `#RRGGBB` hex string. */
  accent_color: string;
  updated_at: number;
}

export type SettingsPatch = Partial<Omit<Settings, 'shell'>> & { shell?: string | null };

export type TabKind = 'local' | 'ssh' | 'sftp';

export interface Tab {
  id: string;
  ptyId: string;
  title: string;
  kind: TabKind;
  exitCode?: number | null;
  hostId?: string;
}

export type LayoutKind = 'solo' | '2col' | '2row' | '3col' | '2x2';

export const LAYOUT_SLOT_COUNTS: Record<LayoutKind, number> = {
  solo: 1,
  '2col': 2,
  '2row': 2,
  '3col': 3,
  '2x2': 4,
};

export interface PtyExitPayload {
  code: number | null;
  signal: string | null;
}

export interface SshTarget {
  host: string;
  port: number;
  user: string;
}

export type AuthRequest =
  | { kind: 'agent' }
  | { kind: 'password'; password: string }
  | { kind: 'key'; path: string; passphrase?: string };

export type SshConnectResult =
  | { status: 'connected'; id: string }
  | { status: 'needs_fingerprint'; fingerprint: string; host: string; key_type: string }
  | { status: 'fingerprint_mismatch'; fingerprint: string; expected: string; host: string }
  | { status: 'needs_auth'; tried: string[]; available: string[] };

export type AuthMethodKind = 'agent' | 'key' | 'password';

export interface Host {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  group_name: string | null;
  tags: string[];
  auth_method: AuthMethodKind;
  key_path: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
}

export interface HostInput {
  name: string;
  hostname: string;
  port: number;
  username: string;
  group_name: string | null;
  tags: string[];
  auth_method: AuthMethodKind;
  key_path: string | null;
  notes: string | null;
}

export type SftpEntryKind = 'file' | 'dir' | 'symlink' | 'other';

export interface SftpEntry {
  name: string;
  kind: SftpEntryKind;
  size: number;
  modified_ms: number | null;
  permissions: number;
  symlink_target: string | null;
}

export type SftpOpenResult =
  | { status: 'connected'; id: string }
  | { status: 'needs_fingerprint'; fingerprint: string; host: string; key_type: string }
  | { status: 'fingerprint_mismatch'; fingerprint: string; expected: string; host: string }
  | { status: 'needs_auth'; tried: string[]; available: string[] };

export type SortKey = 'name' | 'size' | 'modified';

export interface TagColor {
  name: string;
  /** `#RRGGBB` literal validated server-side. */
  color: string;
}

export interface Snippet {
  id: string;
  name: string;
  content: string;
  tags: string[];
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
}

export interface SnippetInput {
  name: string;
  content: string;
  tags: string[];
}

export type ForwardKind = 'local' | 'remote';

export interface Forward {
  id: string;
  host_id: string;
  name: string;
  kind: ForwardKind;
  bind_addr: string;
  bind_port: number;
  remote_host: string;
  remote_port: number;
  auto_start: boolean;
  created_at: number;
  updated_at: number;
}

export interface ForwardInput {
  host_id: string;
  name: string;
  kind: ForwardKind;
  bind_addr: string;
  bind_port: number;
  remote_host: string;
  remote_port: number;
  auto_start: boolean;
}

export type ForwardState = 'stopped' | 'starting' | 'running' | 'error';

export interface ForwardStatus {
  id: string;
  state: ForwardState;
  error: string | null;
}

export interface SyncUser {
  id: string;
  email: string | null;
}

export type SyncStatusKind = 'idle' | 'syncing' | 'synced' | 'error';

export interface SyncState {
  user: SyncUser | null;
  status: SyncStatusKind;
  last_synced: number | null;
  pending_count: number;
  error: string | null;
}
