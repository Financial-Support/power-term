import { useCallback, useEffect } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';

const STEP = 0.1;
const MIN = 0.5;
const MAX = 3.0;
const STORAGE_KEY = 'app-zoom';

function clamp(v: number): number {
  return Math.min(MAX, Math.max(MIN, Math.round(v * 10) / 10));
}

function getStored(): number {
  const v = parseFloat(localStorage.getItem(STORAGE_KEY) ?? '1');
  return isNaN(v) ? 1 : clamp(v);
}

function applyZoom(zoom: number): void {
  const z = clamp(zoom);
  localStorage.setItem(STORAGE_KEY, String(z));
  void getCurrentWebview().setZoom(z);
}

export function useZoom() {
  useEffect(() => {
    applyZoom(getStored());
  }, []);

  const zoomIn = useCallback(() => applyZoom(getStored() + STEP), []);
  const zoomOut = useCallback(() => applyZoom(getStored() - STEP), []);
  const zoomReset = useCallback(() => applyZoom(1), []);

  return { zoomIn, zoomOut, zoomReset };
}
