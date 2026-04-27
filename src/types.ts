export type Theme = 'light' | 'dark' | 'auto';

export interface Settings {
  shell: string | null;
  font_family: string;
  font_size: number;
  theme: Theme;
  cursor_blink: boolean;
  scrollback_lines: number;
  ssh_connect_timeout_secs: number;
  ssh_keepalive_interval_secs: number;
}

export type SettingsPatch = Partial<Omit<Settings, 'shell'>> & { shell?: string | null };

export type TabKind = 'local' | 'ssh';

export interface Tab {
  id: string;
  ptyId: string;
  title: string;
  kind: TabKind;
  exitCode?: number | null;
}

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
