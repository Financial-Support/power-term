import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../lib/ipc', () => ({
  sftpList: vi.fn(),
  sftpCanonicalize: vi.fn(),
  sftpMkdir: vi.fn(),
  sftpRemoveFile: vi.fn(),
  sftpRemoveDir: vi.fn(),
  sftpRename: vi.fn(),
  sftpDownload: vi.fn(),
  sftpUpload: vi.fn(),
}));

import { sftpList, sftpMkdir } from '../lib/ipc';
import { FileBrowser } from './FileBrowser';
import { useSftpStore } from '../state/sftpStore';
import type { SftpEntry } from '../types';

const e = (over: Partial<SftpEntry>): SftpEntry => ({
  name: 'x', kind: 'file', size: 0, modified_ms: null, permissions: 0,
  symlink_target: null, ...over,
});

beforeEach(() => {
  useSftpStore.setState({
    tabs: {
      't': {
        sftpId: 's', cwd: '/home/alice',
        entries: [e({ name: 'a.txt' }), e({ name: 'sub', kind: 'dir' })],
        loading: false, error: null, sortKey: 'name', sortAsc: true, showHidden: false,
      },
    },
  });
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(window, 'prompt').mockReturnValue('renamed');
});

describe('FileBrowser', () => {
  it('renders cwd in breadcrumb input', () => {
    render(<FileBrowser tabId="t" onClose={vi.fn()} />);
    expect(screen.getByDisplayValue('/home/alice')).toBeInTheDocument();
  });

  it('renders both file and dir entries', () => {
    render(<FileBrowser tabId="t" onClose={vi.fn()} />);
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('sub')).toBeInTheDocument();
  });

  it('clicking a directory row navigates into it', async () => {
    (sftpList as any).mockResolvedValue([e({ name: 'inside.txt' })]);
    render(<FileBrowser tabId="t" onClose={vi.fn()} />);
    await userEvent.click(screen.getByText('sub'));
    expect(sftpList).toHaveBeenCalledWith('s', '/home/alice/sub');
  });

  it('breadcrumb edit + Enter navigates to that path', async () => {
    (sftpList as any).mockResolvedValue([]);
    render(<FileBrowser tabId="t" onClose={vi.fn()} />);
    const input = screen.getByDisplayValue('/home/alice');
    await userEvent.clear(input);
    await userEvent.type(input, '/etc{Enter}');
    expect(sftpList).toHaveBeenCalledWith('s', '/etc');
  });

  it('reload button reloads current dir', async () => {
    (sftpList as any).mockResolvedValue([]);
    render(<FileBrowser tabId="t" onClose={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('reload'));
    expect(sftpList).toHaveBeenCalledWith('s', '/home/alice');
  });

  it('hidden files are filtered by default and revealed when toggled', async () => {
    useSftpStore.setState({
      tabs: {
        't': {
          sftpId: 's', cwd: '/',
          entries: [e({ name: '.hidden' }), e({ name: 'visible.txt' })],
          loading: false, error: null, sortKey: 'name', sortAsc: true, showHidden: false,
        },
      },
    });
    render(<FileBrowser tabId="t" onClose={vi.fn()} />);
    expect(screen.queryByText('.hidden')).not.toBeInTheDocument();
    expect(screen.getByText('visible.txt')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/show hidden/i));
    expect(screen.getByText('.hidden')).toBeInTheDocument();
  });

  it('new folder button opens prompt + invokes sftp_mkdir', async () => {
    (sftpMkdir as any).mockResolvedValue(undefined);
    (sftpList as any).mockResolvedValue([]);
    render(<FileBrowser tabId="t" onClose={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/new folder/i));
    const input = screen.getByPlaceholderText(/folder name/i);
    await userEvent.type(input, 'newdir{Enter}');
    expect(sftpMkdir).toHaveBeenCalledWith('s', '/home/alice/newdir');
  });

  it('".." pseudo-row navigates to parent', async () => {
    (sftpList as any).mockResolvedValue([]);
    render(<FileBrowser tabId="t" onClose={vi.fn()} />);
    await userEvent.click(screen.getByText('..'));
    expect(sftpList).toHaveBeenCalledWith('s', '/home');
  });
});
