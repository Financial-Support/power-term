import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileRow } from './FileRow';
import type { SftpEntry } from '../types';

const e = (over: Partial<SftpEntry>): SftpEntry => ({
  name: 'foo.txt', kind: 'file', size: 1024, modified_ms: 1700000000000,
  permissions: 420, symlink_target: null, ...over,
});

describe('FileRow', () => {
  it('renders name + size + modified', () => {
    render(
      <FileRow entry={e({ name: 'data.csv', size: 2048 })}
        selected={false} onSelect={vi.fn()}
        onCd={vi.fn()} onDownload={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText('data.csv')).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB|2 KB/)).toBeInTheDocument();
  });

  it('single-clicking a directory selects it without opening it', async () => {
    const onCd = vi.fn();
    const onSelect = vi.fn();
    render(
      <FileRow entry={e({ name: 'projects', kind: 'dir' })}
        selected={false} onSelect={onSelect}
        onCd={onCd} onDownload={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />,
    );
    await userEvent.click(screen.getByText('projects'));
    expect(onSelect).toHaveBeenCalled();
    expect(onCd).not.toHaveBeenCalled();
  });

  it('double-clicking a directory opens it', async () => {
    const onCd = vi.fn();
    render(
      <FileRow entry={e({ name: 'projects', kind: 'dir' })}
        selected={false} onSelect={vi.fn()}
        onCd={onCd} onDownload={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />,
    );
    await userEvent.dblClick(screen.getByText('projects'));
    expect(onCd).toHaveBeenCalledWith('projects');
  });

  it('clicking a file row does not call onCd', async () => {
    const onCd = vi.fn();
    render(
      <FileRow entry={e({ name: 'data.csv', kind: 'file' })}
        selected={false} onSelect={vi.fn()}
        onCd={onCd} onDownload={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />,
    );
    await userEvent.click(screen.getByText('data.csv'));
    expect(onCd).not.toHaveBeenCalled();
  });

  it('action buttons fire callbacks for files', async () => {
    const onDownload = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    render(
      <FileRow entry={e({ name: 'data.csv' })}
        selected={false} onSelect={vi.fn()}
        onCd={vi.fn()} onDownload={onDownload} onRename={onRename} onDelete={onDelete} />,
    );
    await userEvent.click(screen.getByLabelText('download data.csv'));
    expect(onDownload).toHaveBeenCalledWith(expect.objectContaining({ name: 'data.csv' }));
    await userEvent.click(screen.getByLabelText('rename data.csv'));
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ name: 'data.csv' }));
    await userEvent.click(screen.getByLabelText('delete data.csv'));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ name: 'data.csv' }));
  });

  it('directory row hides download but shows rename + delete', () => {
    render(
      <FileRow entry={e({ name: 'projects', kind: 'dir' })}
        selected={false} onSelect={vi.fn()}
        onCd={vi.fn()} onDownload={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.queryByLabelText('download projects')).not.toBeInTheDocument();
    expect(screen.getByLabelText('rename projects')).toBeInTheDocument();
    expect(screen.getByLabelText('delete projects')).toBeInTheDocument();
  });

  it('renders a checked selection checkbox', () => {
    render(
      <FileRow entry={e({ name: 'selected.txt' })}
        selected onSelect={vi.fn()}
        onCd={vi.fn()} onDownload={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByLabelText('Select selected.txt')).toBeChecked();
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  });
});
