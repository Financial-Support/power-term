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
  isSftpTransferCancelledError: vi.fn((err: unknown) => String(err).toLowerCase().includes('transfer cancelled')),
}));

vi.mock('../lib/dialog', () => ({
  pickLocalFile: vi.fn(),
  pickLocalSavePath: vi.fn(),
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
  }),
}));

import { sftpDownload, sftpList, sftpMkdir, sftpRename, sftpUpload } from '../lib/ipc';
import { pickLocalFile, pickLocalSavePath } from '../lib/dialog';
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

  it('does not show an error banner when a download is cancelled', async () => {
    (pickLocalSavePath as any).mockResolvedValue('/tmp/a.txt');
    (sftpDownload as any).mockRejectedValue(new Error('transfer cancelled'));
    render(<FileBrowser tabId="t" onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('download a.txt'));

    expect(screen.queryByText(/download failed/i)).not.toBeInTheDocument();
  });

  it('renames a file through the in-app modal', async () => {
    (sftpRename as any).mockResolvedValue(undefined);
    (sftpList as any).mockResolvedValue([]);
    render(<FileBrowser tabId="t" onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('rename a.txt'));
    const input = screen.getByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'renamed.txt');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(sftpRename).toHaveBeenCalledWith('s', '/home/alice/a.txt', '/home/alice/renamed.txt');
  });

  it('confirms overwrite before uploading over an existing file', async () => {
    (pickLocalFile as any).mockResolvedValue('/tmp/a.txt');
    (sftpUpload as any).mockResolvedValue(undefined);
    (sftpList as any).mockResolvedValue([]);
    render(<FileBrowser tabId="t" onClose={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('upload'));
    expect(screen.getByText(/replace "a\.txt" in \/home\/alice/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Overwrite' }));

    expect(sftpUpload).toHaveBeenCalledWith('s', '/tmp/a.txt', '/home/alice/a.txt');
  });
});
