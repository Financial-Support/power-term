export type Theme = 'light' | 'dark' | 'auto';

export interface Settings {
  shell: string | null;
  font_family: string;
  font_size: number;
  theme: Theme;
  cursor_blink: boolean;
  scrollback_lines: number;
}

export type SettingsPatch = Partial<Omit<Settings, 'shell'>> & { shell?: string | null };

export interface Tab {
  id: string;
  ptyId: string;
  title: string;
  exitCode?: number | null;
}

export interface PtyExitPayload {
  code: number | null;
  signal: string | null;
}
