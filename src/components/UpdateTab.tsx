import { useCallback, useEffect, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { DownloadIcon, RefreshIcon } from './AppIcons';

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'up-to-date' | 'error';

export function UpdateTab() {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    setStatus('checking');
    setUpdate(null);
    setProgress(null);
    setError(null);

    try {
      const nextUpdate = await check();
      if (nextUpdate) {
        setUpdate(nextUpdate);
        setStatus('available');
      } else {
        setStatus('up-to-date');
      }
    } catch (reason) {
      setStatus('error');
      setError(toErrorMessage(reason));
    }
  }, []);

  useEffect(() => {
    void checkForUpdate();
  }, [checkForUpdate]);

  const installUpdate = async () => {
    if (!update) return;

    setStatus('downloading');
    setProgress(0);
    setError(null);

    let downloaded = 0;
    let contentLength: number | null = null;

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? null;
            setProgress(contentLength ? 0 : null);
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength) {
              setProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
            }
            break;
          case 'Finished':
            setProgress(100);
            setStatus('installing');
            break;
        }
      });
      setStatus('installing');
      await relaunch();
    } catch (reason) {
      setStatus('error');
      setError(toErrorMessage(reason));
    }
  };

  const busy = status === 'checking' || status === 'downloading' || status === 'installing';
  const statusLabel = getStatusLabel(status, update?.version);

  return (
    <div className="update-tab" aria-live="polite">
      <div className="update-card">
        <div className="update-card-head">
          <div>
            <div className="settings-section-title-row">
              <span className="settings-section-icon" aria-hidden><RefreshIcon size={14} /></span>
              <h3>Power Term updates</h3>
            </div>
            <p className="update-description">
              Check for the latest fixes and improvements, then install them without leaving the app.
            </p>
          </div>
          <span className={`update-status-pill update-status-${status}`}>
            <span className="update-status-dot" aria-hidden />
            {statusLabel}
          </span>
        </div>

        {update?.body && (
          <div className="update-notes">
            <span className="update-notes-label">Release notes</span>
            <p>{update.body}</p>
          </div>
        )}

        {progress !== null && (status === 'downloading' || status === 'installing') && (
          <div className="update-progress" aria-label={`Download progress ${progress}%`}>
            <div className="update-progress-track">
              <div className="update-progress-value" style={{ width: `${progress}%` }} />
            </div>
            <span>{status === 'installing' ? 'Installing…' : `${progress}%`}</span>
          </div>
        )}

        {error && (
          <p className="update-error" title={error}>
            {getErrorLabel(error)}
          </p>
        )}

        <div className="update-actions">
          {status === 'available' && update ? (
            <button type="button" className="primary update-action" onClick={() => void installUpdate()}>
              <DownloadIcon size={14} />
              Install v{update.version}
            </button>
          ) : (
            <button
              type="button"
              className="update-action"
              onClick={() => void checkForUpdate()}
              disabled={busy}
            >
              <RefreshIcon size={14} className={status === 'checking' ? 'update-icon-spin' : undefined} />
              {status === 'checking' ? 'Checking…' : 'Check for updates'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function getStatusLabel(status: UpdateStatus, version?: string): string {
  switch (status) {
    case 'checking': return 'Checking';
    case 'available': return version ? `v${version} available` : 'Update available';
    case 'downloading': return 'Downloading';
    case 'installing': return 'Installing';
    case 'up-to-date': return 'Up to date';
    case 'error': return 'Check failed';
    case 'idle': return 'Not checked';
  }
}

function toErrorMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === 'string' && reason.trim()) return reason;
  return 'The updater returned an unknown error.';
}

function getErrorLabel(error: string): string {
  if (error.toLowerCase().includes('updater') || error.toLowerCase().includes('endpoint')) {
    return 'Unable to reach the update service. Check your connection and try again.';
  }
  return 'The update check failed. Try again in a moment.';
}
