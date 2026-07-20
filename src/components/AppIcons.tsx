import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

type LayoutPreviewKind = 'solo' | '2col' | '2row' | '3col' | '2x2';

function IconBase({
  size = 14,
  viewBox = '0 0 16 16',
  children,
  ...props
}: IconProps & { viewBox?: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 6 8 10.5 12.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 10 8 5.5 12.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 3.5 5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </IconBase>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 4.5 11.5 11.5M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </IconBase>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12.5 6.5A4.8 4.8 0 0 0 4.2 4.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4.4 2.9v2.7h2.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 9.5a4.8 4.8 0 0 0 8.3 1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11.6 13.1v-2.7H8.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 2.8v7.1M5.1 7.9 8 10.8l2.9-2.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </IconBase>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 13.2V6.1M10.9 8.1 8 5.2 5.1 8.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 3.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </IconBase>
  );
}

export function FolderIcon({ open = false, ...props }: IconProps & { open?: boolean }) {
  if (open) {
    return (
      <IconBase {...props}>
        <path d="M2.8 5.2c0-.7.6-1.2 1.2-1.2h2l1.1 1.1H12c.7 0 1.2.6 1.2 1.2v.6H4.8c-.6 0-1.1.4-1.2 1l-1.1 4.3c0 .1-.1.2-.1.4V5.2Z" fill="currentColor" fillOpacity="0.14" />
        <path d="M2.8 5.2c0-.7.6-1.2 1.2-1.2h2l1.1 1.1H12c.7 0 1.2.6 1.2 1.2v.6M2.8 5.2v6.2c0 .7.6 1.2 1.2 1.2h7.1c.6 0 1.1-.4 1.2-1l1-3.7c.2-.7-.3-1.4-1-1.4H4.8c-.6 0-1.1.4-1.2 1l-1 4.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </IconBase>
    );
  }
  return (
    <IconBase {...props}>
      <path d="M2.8 5.4c0-.8.6-1.4 1.4-1.4h1.9l1.1 1.1H12c.7 0 1.2.6 1.2 1.2v5.1c0 .7-.6 1.2-1.2 1.2H4.1c-.7 0-1.3-.6-1.3-1.3V5.4Z" fill="currentColor" fillOpacity="0.1" />
      <path d="M2.8 5.4c0-.8.6-1.4 1.4-1.4h1.9l1.1 1.1H12c.7 0 1.2.6 1.2 1.2v5.1c0 .7-.6 1.2-1.2 1.2H4.1c-.7 0-1.3-.6-1.3-1.3V5.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </IconBase>
  );
}

export function FolderPlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M2.8 5.4c0-.8.6-1.4 1.4-1.4h1.9l1.1 1.1H12c.7 0 1.2.6 1.2 1.2v5.1c0 .7-.6 1.2-1.2 1.2H4.1c-.7 0-1.3-.6-1.3-1.3V5.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.7v4.2M5.9 8.8h4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </IconBase>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 2.8h4.4l2.6 2.6v7.8c0 .6-.5 1.1-1.1 1.1H4.5c-.6 0-1.1-.5-1.1-1.1V3.9c0-.6.5-1.1 1.1-1.1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8.9 2.8v2.3c0 .6.5 1.1 1.1 1.1h2.3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </IconBase>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6.2 9.8 5 11a2.2 2.2 0 1 1-3.1-3.1l1.8-1.8A2.2 2.2 0 0 1 6.8 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="m9.8 6.2 1.2-1.2a2.2 2.2 0 1 1 3.1 3.1l-1.8 1.8A2.2 2.2 0 0 1 9.2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5.9 10.1 10 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </IconBase>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m10.9 3.6 1.5 1.5a1 1 0 0 1 0 1.4l-5.8 5.8-2.8.7.7-2.8 5.8-5.8a1 1 0 0 1 1.4 0Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="m9.8 4.7 1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </IconBase>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 4.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6.2 2.8h3.6M5 4.5v7.1c0 .6.5 1.1 1.1 1.1h3.8c.6 0 1.1-.5 1.1-1.1V4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.8 6.5v4.2M9.2 6.5v4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </IconBase>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="5.5" y="4.5" width="6.5" height="8" rx="1.1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 10.3H3.7c-.6 0-1.1-.5-1.1-1.1V3.7c0-.6.5-1.1 1.1-1.1h5.5c.6 0 1.1.5 1.1 1.1V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12.5 8H3.5M6.5 5 3.5 8l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 8h9M9.5 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function ParentDirectoryIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 11.5H5.5a2 2 0 0 1-2-2V4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m8 8.2-3 3-3-3" transform="translate(3 -3.2)" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function RevealIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 3.2c3.2 0 5.4 3 6 4.8-.6 1.8-2.8 4.8-6 4.8S2.6 9.8 2 8c.6-1.8 2.8-4.8 6-4.8Z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" />
    </IconBase>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5.3 4.3 11.7 8l-6.4 3.7V4.3Z" fill="currentColor" />
    </IconBase>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5.2 4.2v7.6M10.8 4.2v7.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </IconBase>
  );
}

export function BranchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="4.2" cy="4.2" r="1.4" fill="currentColor" />
      <circle cx="11.8" cy="11.8" r="1.4" fill="currentColor" />
      <circle cx="11.8" cy="4.2" r="1.4" fill="currentColor" />
      <path d="M5.6 4.2h4.8M4.2 5.6v2.2c0 2.2 1.8 4 4 4h2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </IconBase>
  );
}

export function ForwardIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 5.2h6.8M7.7 3 10 5.2 7.7 7.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 10.8H6.2M8.3 8.6 6 10.8 8.3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3.6" y="7" width="8.8" height="5.8" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.6 7V5.6a2.4 2.4 0 1 1 4.8 0V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </IconBase>
  );
}

export function AlertCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 5.2v3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r=".8" fill="currentColor" />
    </IconBase>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="7" cy="7" r="3.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="m10 10 2.8 2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </IconBase>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="2.2" y="3" width="11.6" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="m5 6 1.9 1.9L5 9.8M8.3 10h2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </IconBase>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m8 2.6.9 2.4 2.5.9-2.5.9L8 9.2l-.9-2.4-2.5-.9 2.5-.9L8 2.6Z" fill="currentColor" />
      <path d="m12.1 9.4.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5.5-1.3Z" fill="currentColor" fillOpacity=".8" />
      <path d="m3.9 9.8.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4.4-1Z" fill="currentColor" fillOpacity=".72" />
    </IconBase>
  );
}

export function ServerIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="2.5" y="3" width="11" height="4" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2.5" y="9" width="11" height="4" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.4" cy="5" r=".8" fill="currentColor" />
      <circle cx="11.4" cy="11" r=".8" fill="currentColor" />
    </IconBase>
  );
}

export function SnippetIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 4.5h8M4 8h6M4 11.5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </IconBase>
  );
}

export function DatabaseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <ellipse cx="8" cy="4" rx="4.8" ry="1.7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.2 4v7.2c0 .9 2.1 1.7 4.8 1.7s4.8-.8 4.8-1.7V4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.2 7.6c0 .9 2.1 1.7 4.8 1.7s4.8-.8 4.8-1.7" stroke="currentColor" strokeWidth="1.2" />
    </IconBase>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="5" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7.4 8h5.9M10.6 8v2.2M13.3 8v2.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </IconBase>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props} viewBox="0 0 24 24">
      <path
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
    </IconBase>
  );
}

export function BrandIcon(props: IconProps) {
  return (
    <IconBase {...props} viewBox="0 0 20 20">
      <rect x="1" y="1" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.4" strokeOpacity="0.9" />
      <path d="M11.2 4 L6.2 11.2 H10 L8.8 16 L13.8 8.8 H10 Z" fill="currentColor" />
    </IconBase>
  );
}

export function BroadcastIcon(props: IconProps) {
  return (
    <IconBase {...props} size={18} viewBox="0 0 18 18">
      <circle cx="9" cy="9" r="1.6" fill="currentColor" />
      <path
        d="M6.4 6.4a3.7 3.7 0 0 0 0 5.2M11.6 6.4a3.7 3.7 0 0 1 0 5.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M4.2 4.2a6.7 6.7 0 0 0 0 9.6M13.8 4.2a6.7 6.7 0 0 1 0 9.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeOpacity="0.55"
      />
    </IconBase>
  );
}

export function TransferStatusIcon(props: IconProps) {
  return (
    <IconBase {...props} size={18} viewBox="0 0 18 18">
      <path d="M5 6.2 9 2.5l4 3.7M9 2.8v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 11.8 9 15.5l-4-3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
    </IconBase>
  );
}

export function LayoutIcon({ kind, ...props }: IconProps & { kind: LayoutPreviewKind }) {
  const stroke = 'currentColor';
  const strokeWidth = 1.4;

  switch (kind) {
    case 'solo':
      return (
        <IconBase {...props} size={18} viewBox="0 0 18 18">
          <rect x="2" y="2" width="14" height="14" rx="2" stroke={stroke} strokeWidth={strokeWidth} />
        </IconBase>
      );
    case '2col':
      return (
        <IconBase {...props} size={18} viewBox="0 0 18 18">
          <rect x="2" y="2" width="14" height="14" rx="2" stroke={stroke} strokeWidth={strokeWidth} />
          <line x1="9" y1="2" x2="9" y2="16" stroke={stroke} strokeWidth={strokeWidth} />
        </IconBase>
      );
    case '2row':
      return (
        <IconBase {...props} size={18} viewBox="0 0 18 18">
          <rect x="2" y="2" width="14" height="14" rx="2" stroke={stroke} strokeWidth={strokeWidth} />
          <line x1="2" y1="9" x2="16" y2="9" stroke={stroke} strokeWidth={strokeWidth} />
        </IconBase>
      );
    case '3col':
      return (
        <IconBase {...props} size={18} viewBox="0 0 18 18">
          <rect x="2" y="2" width="14" height="14" rx="2" stroke={stroke} strokeWidth={strokeWidth} />
          <line x1="7" y1="2" x2="7" y2="16" stroke={stroke} strokeWidth={strokeWidth} />
          <line x1="11" y1="2" x2="11" y2="16" stroke={stroke} strokeWidth={strokeWidth} />
        </IconBase>
      );
    case '2x2':
      return (
        <IconBase {...props} size={18} viewBox="0 0 18 18">
          <rect x="2" y="2" width="14" height="14" rx="2" stroke={stroke} strokeWidth={strokeWidth} />
          <line x1="9" y1="2" x2="9" y2="16" stroke={stroke} strokeWidth={strokeWidth} />
          <line x1="2" y1="9" x2="16" y2="9" stroke={stroke} strokeWidth={strokeWidth} />
        </IconBase>
      );
    default:
      return null;
  }
}

export function SidebarPanelIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
    </IconBase>
  );
}
