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
  quick_theme_panel_open: boolean;
  accent_dock_open: boolean;
  updated_at: number;
}

export type SettingsPatch = Partial<Omit<Settings, 'shell'>> & { shell?: string | null };

export type TabKind = 'local' | 'ssh' | 'sftp' | 'db';

export interface Tab {
  id: string;
  ptyId: string;
  title: string;
  kind: TabKind;
  exitCode?: number | null;
  /** Termination signal from the backend (e.g. "network_error", "killed").
   * Distinguishes a clean exit (code !== null, signal === null) from a
   * channel that died mid-session — used by the UI to show a "disconnected"
   * dot and surface a Reconnect action. */
  exitSignal?: string | null;
  hostId?: string;
  /** Which split pane this tab belongs to. Each pane keeps its own
   * independent group of tabs; `layoutSlots[paneIndex]` is the one
   * currently shown. Tabs can be dragged between panes. */
  paneIndex: number;
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

export interface SftpTransferProgress {
  transfer_id: string;
  direction: 'upload' | 'download';
  path: string;
  bytes_done: number;
  bytes_total: number;
  state: 'running' | 'done' | 'error' | 'cancelled';
  error: string | null;
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

export interface SshKey {
  id: string;
  name: string;
  path: string;
  /** Captured file contents — empty when fall-back-to-disk mode is in effect. */
  content: string;
  created_at: number;
  updated_at: number;
}

export interface SshKeyInput {
  name: string;
  path: string;
  content: string;
}

export type DbEngine = 'mysql' | 'postgres' | 'sqlite' | 'mssql' | 'redis';

export interface DbConnection {
  id: string;
  host_id: string;
  name: string;
  engine: DbEngine;
  db_host: string;
  db_port: number;
  database: string;
  db_user: string;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
}

export interface DbConnectionInput {
  host_id: string;
  name: string;
  engine: DbEngine;
  db_host: string;
  db_port: number;
  database: string;
  db_user: string;
}

export interface QueryResult {
  columns: string[];
  rows: (string | null)[][];
  rows_affected: number;
  took_ms: number;
  statements: number;
}

export interface DbColumn {
  name: string;
  data_type: string;
  nullable: boolean;
  default_value: string | null;
  primary_key: boolean;
}

export interface DbIndex {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface TableMeta {
  table: string;
  columns: DbColumn[];
  primary_key: string[];
  indexes: DbIndex[];
}

export interface DbCell {
  column: string;
  value: string | null;
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
