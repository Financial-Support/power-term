import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocalBrowser } from './LocalBrowser';

vi.mock('../lib/ipc', () => ({
  localHome: vi.fn().mockResolvedValue('/Users/test'),
  localList: vi.fn().mockResolvedValue([
    { name: 'a.txt', kind: 'file', size: 1, modified_ms: null },
    { name: 'b.txt', kind: 'file', size: 2, modified_ms: null },
  ]),
  localReveal: vi.fn(),
}));

describe('LocalBrowser multi-select drag', () => {
  beforeEach(() => vi.clearAllMocks());

  it('packs all checked files into one drag payload', async () => {
    render(
      <LocalBrowser
        id="local-test"
        showHidden={false}
        onRemoteDrop={vi.fn()}
      />,
    );

    await screen.findByText('a.txt');
    fireEvent.click(screen.getByLabelText('Select a.txt'));
    fireEvent.click(screen.getByLabelText('Select b.txt'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    const setData = vi.fn();
    const row = screen.getByLabelText('Select a.txt').closest('[role="option"]');
    fireEvent.dragStart(row!, { dataTransfer: { setData, effectAllowed: 'none' } });

    await waitFor(() => expect(setData).toHaveBeenCalled());
    const [mime, raw] = setData.mock.calls[0];
    expect(mime).toBe('application/x-power-term-file');
    expect(JSON.parse(raw)).toEqual({
      kind: 'local',
      items: [
        { name: 'a.txt', path: '/Users/test/a.txt' },
        { name: 'b.txt', path: '/Users/test/b.txt' },
      ],
    });
  });
});
