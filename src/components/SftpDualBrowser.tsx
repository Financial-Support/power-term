import { useRef, useState } from 'react';
import { LocalBrowser, type DragPayload } from './LocalBrowser';
import { FileBrowser } from './FileBrowser';
import { Splitter } from './Splitter';
import { useSftpStore } from '../state/sftpStore';
import { sftpDownload, sftpUpload } from '../lib/ipc';

interface Props {
  tabId: string;
  onClose: () => void;
}

/**
 * Dual-pane SFTP browser: local filesystem on the left, remote SFTP on the
 * right, with a draggable splitter between. Files can be dragged in either
 * direction (HTML5 drag/drop within the webview) to copy across panes.
 *
 * The Tauri OS-level drag/drop on the right pane stays on so Finder→remote
 * upload still works exactly as before; the new intra-webview drop is a
 * separate code path that uses the `application/x-power-term-file` MIME.
 */
export function SftpDualBrowser({ tabId, onClose }: Props) {
  const tab = useSftpStore((s) => s.tabs[tabId]);
  const reload = useSftpStore((s) => s.reload);
  const [split, setSplit] = useState(0.5);
  const [bumpKey, setBumpKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  if (!tab) return null;

  // Local pane re-mounts to refresh after a download lands. Cheaper than
  // adding an explicit reload prop and coordinating across components.
  const refreshLocal = () => setBumpKey((k) => k + 1);

  const handleRemoteToLocal = async (payload: DragPayload, targetCwd: string) => {
    if (payload.kind !== 'remote' || !payload.sftpId) return;
    const localPath = joinPath(targetCwd, payload.name);
    await sftpDownload(payload.sftpId, payload.path, localPath);
    refreshLocal();
  };

  const handleLocalToRemote = async (
    payload: { kind: 'local'; path: string; name: string },
    targetCwd: string,
    sftpId: string,
  ) => {
    await sftpUpload(sftpId, payload.path, joinPath(targetCwd, payload.name));
    void reload(tabId);
  };

  // Context-menu shortcut: "Copy to <other side>" copies into the OTHER
  // pane's current cwd. We can't read the local cwd directly because it
  // lives inside LocalBrowser state, so we stash it on the container via
  // a data attribute the LocalBrowser keeps in sync.
  const copyRemoteToLocalCwd = async (remotePath: string, name: string) => {
    const localCwd = containerRef.current?.querySelector<HTMLElement>('.local-browser')
      ?.dataset.cwd;
    if (!localCwd) return;
    await sftpDownload(tab.sftpId, remotePath, joinPath(localCwd, name));
    refreshLocal();
  };

  const copyLocalToRemoteCwd = async (localPath: string, name: string) => {
    await sftpUpload(tab.sftpId, localPath, joinPath(tab.cwd, name));
    void reload(tabId);
  };

  return (
    <div ref={containerRef} className="sftp-dual">
      <div className="sftp-dual-pane" style={{ flex: split }}>
        <LocalBrowser
          key={bumpKey}
          id={`local-${tabId}`}
          showHidden={tab.showHidden}
          onRemoteDrop={handleRemoteToLocal}
          onCopyToRemote={copyLocalToRemoteCwd}
        />
      </div>
      <div className="sftp-dual-pane" style={{ flex: 1 - split }}>
        <FileBrowser
          tabId={tabId}
          onClose={onClose}
          onRowDragStart={(e, payload) => {
            e.dataTransfer.setData('application/x-power-term-file', JSON.stringify(payload));
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onLocalDrop={handleLocalToRemote}
          onCopyToLocal={copyRemoteToLocalCwd}
        />
      </div>
      <Splitter
        orientation="vertical"
        value={split}
        onChange={setSplit}
        parentRef={containerRef as React.RefObject<HTMLElement>}
        min={0.15}
        max={0.85}
      />
    </div>
  );
}

function joinPath(base: string, name: string): string {
  if (name.startsWith('/')) return name;
  if (base.endsWith('/')) return base + name;
  return base + '/' + name;
}
