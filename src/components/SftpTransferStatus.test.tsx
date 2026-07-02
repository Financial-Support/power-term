import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SftpTransferStatus } from './SftpTransferStatus';

const mocks = vi.hoisted(() => ({
  onProgress: null as null | ((payload: any) => void),
}));

vi.mock('../lib/ipc', () => ({
  onSftpTransferProgress: vi.fn(async (cb: (payload: any) => void) => {
    mocks.onProgress = cb;
    return () => {};
  }),
  sftpCancelTransfer: vi.fn().mockResolvedValue(undefined),
}));

import { sftpCancelTransfer } from '../lib/ipc';

describe('SftpTransferStatus', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.onProgress = null;
    vi.clearAllMocks();
  });

  it('shows a cancel button in the popup while transfers are running', async () => {
    render(<SftpTransferStatus />);
    await act(async () => {
      mocks.onProgress?.({
        transfer_id: 'tx-1',
        direction: 'upload',
        path: '/remote/big.iso',
        bytes_done: 128,
        bytes_total: 1024,
        state: 'running',
        error: null,
      });
    });

    await userEvent.click(screen.getByLabelText('SFTP transfers'));
    expect(screen.getByText('Transfer in progress')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }));

    expect(sftpCancelTransfer).toHaveBeenCalledWith('tx-1');
  });

  it('allows cancelling a single running transfer from the popup list', async () => {
    render(<SftpTransferStatus />);
    await act(async () => {
      mocks.onProgress?.({
        transfer_id: 'tx-2',
        direction: 'download',
        path: '/remote/archive.tar.gz',
        bytes_done: 512,
        bytes_total: 4096,
        state: 'running',
        error: null,
      });
    });

    await userEvent.click(screen.getByLabelText('SFTP transfers'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel transfer archive.tar.gz' }));

    expect(sftpCancelTransfer).toHaveBeenCalledWith('tx-2');
  });
});
