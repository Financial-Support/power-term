import { describe, it, expect } from 'vitest';
import { PRESET_THEMES, THEME_NAMES } from './themes';

const REQUIRED_KEYS = [
  'background', 'foreground', 'cursor',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const;

describe('PRESET_THEMES', () => {
  it('contains "default" key', () => {
    expect(PRESET_THEMES['default']).toBeDefined();
  });

  it('contains all 8 named presets', () => {
    const expected = ['dracula', 'nord', 'one-dark', 'tokyo-night', 'gruvbox-dark', 'solarized-dark', 'monokai', 'catppuccin-mocha'];
    for (const name of expected) {
      expect(PRESET_THEMES[name], `missing theme: ${name}`).toBeDefined();
    }
  });

  it('each non-default theme has all required ITheme keys', () => {
    for (const [name, theme] of Object.entries(PRESET_THEMES)) {
      if (name === 'default') continue;
      for (const key of REQUIRED_KEYS) {
        expect((theme as Record<string, unknown>)[key], `${name} missing key: ${key}`).toBeDefined();
      }
    }
  });

  it('THEME_NAMES includes "Default" and all 8 presets', () => {
    expect(THEME_NAMES).toHaveLength(9);
    expect(THEME_NAMES[0]).toBe('Default');
  });
});
