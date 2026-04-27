import { useEffect, useState } from 'react';

export interface SidebarToggle {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

export function useSidebarToggle(initialOpen: boolean = true): SidebarToggle {
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return { open, setOpen, toggle: () => setOpen((v) => !v) };
}
