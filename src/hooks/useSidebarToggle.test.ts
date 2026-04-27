import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSidebarToggle } from './useSidebarToggle';

function dispatchCmdB() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true }));
}

describe('useSidebarToggle', () => {
  it('starts open by default', () => {
    const { result } = renderHook(() => useSidebarToggle());
    expect(result.current.open).toBe(true);
  });

  it('Cmd+B toggles open <-> closed', () => {
    const { result } = renderHook(() => useSidebarToggle());
    act(() => dispatchCmdB());
    expect(result.current.open).toBe(false);
    act(() => dispatchCmdB());
    expect(result.current.open).toBe(true);
  });

  it('imperative setOpen works', () => {
    const { result } = renderHook(() => useSidebarToggle());
    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
  });
});
