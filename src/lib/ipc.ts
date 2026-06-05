import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { encodeBase64, decodeBase64 } from './base64';
import type { PtyExitPayload, Settings, SettingsPatch, AuthRequest, SshConnectResult, SshTarget, Host, HostInput, SftpEntry, SftpOpenResult, SftpTransferProgress, Snippet, SnippetInput, Forward, ForwardInput, ForwardStatus, TagColor, DbConnection, DbConnectionInput, QueryResult, SshKey, SshKeyInput, TableMeta, DbCell } from '../types';

export async function ptySpawn(args: {
  shell?: string | null;
  cwd?: string | null;
  cols: number;
  rows: number;
}): Promise<string> {
  return invoke<string>('pty_spawn', {
    shell: args.shell ?? null,
    cwd: args.cwd ?? null,
    cols: args.cols,
    rows: args.rows,
  });
}

export async function ptyWrite(ptyId: string, data: string | Uint8Array): Promise<void> {
  await invoke('pty_write', { ptyId, data: encodeBase64(data) });
}

export async function ptyResize(ptyId: string, cols: number, rows: number): Promise<void> {
  await invoke('pty_resize', { ptyId, cols, rows });
}

export async function ptyKill(ptyId: string): Promise<void> {
  await invoke('pty_kill', { ptyId });
}

export async function settingsGet(): Promise<Settings> {
  return invoke<Settings>('settings_get');
}

export async function settingsUpdate(patch: SettingsPatch): Promise<Settings> {
  return invoke<Settings>('settings_update', { patch });
}

export async function onPtyOutput(
  ptyId: string,
  cb: (bytes: Uint8Array) => void,
): Promise<UnlistenFn> {
  return listen<string>(`pty://output/${ptyId}`, (event) => {
    cb(decodeBase64(event.payload));
  });
}

export async function onPtyExit(
  ptyId: string,
  cb: (payload: PtyExitPayload) => void,
): Promise<UnlistenFn> {
  return listen<PtyExitPayload>(`pty://exit/${ptyId}`, (event) => cb(event.payload));
}

export async function sshConnect(args: {
  target: SshTarget;
  auth: AuthRequest;
  cols: number;
  rows: number;
  acceptFingerprint?: string | null;
}): Promise<SshConnectResult> {
  return invoke<SshConnectResult>('ssh_connect', {
    target: args.target,
    auth: args.auth,
    cols: args.cols,
    rows: args.rows,
    acceptFingerprint: args.acceptFingerprint ?? null,
  });
}

export async function sshWrite(ptyId: string, data: string | Uint8Array): Promise<void> {
  await invoke('ssh_write', { ptyId, data: encodeBase64(data) });
}

export async function sshResize(ptyId: string, cols: number, rows: number): Promise<void> {
  await invoke('ssh_resize', { ptyId, cols, rows });
}

export async function sshKill(ptyId: string): Promise<void> {
  await invoke('ssh_kill', { ptyId });
}

export async function sshAttach(ptyId: string): Promise<void> {
  await invoke('ssh_attach', { ptyId });
}

export async function knownHostsGet(host: string, port: number): Promise<{ fingerprint: string | null; key_type: string | null }> {
  return invoke('known_hosts_get', { host, port });
}

export async function hostsList(): Promise<Host[]> {
  return invoke<Host[]>('hosts_list');
}

export async function hostsCreate(input: HostInput): Promise<Host> {
  return invoke<Host>('hosts_create', { input });
}

export async function hostsUpdate(id: string, input: HostInput): Promise<Host> {
  return invoke<Host>('hosts_update', { id, input });
}

export async function hostsDelete(id: string): Promise<void> {
  await invoke('hosts_delete', { id });
}

export async function hostsTouch(id: string): Promise<void> {
  await invoke('hosts_touch', { id });
}

export interface SshConfigEntry {
  name: string;
  hostname: string;
  port: number;
  user: string;
  key_path: string | null;
  proxy_jump: string | null;
}

export async function sshConfigRead(): Promise<SshConfigEntry[]> {
  return invoke<SshConfigEntry[]>('ssh_config_read');
}

export interface LocalEntry {
  name: string;
  /** "file" | "dir" | "symlink" | "other" */
  kind: string;
  size: number;
  modified_ms: number | null;
}

export async function localList(path: string): Promise<LocalEntry[]> {
  return invoke<LocalEntry[]>('local_list', { path });
}

export async function localHome(): Promise<string> {
  return invoke<string>('local_home');
}

export async function localReveal(path: string): Promise<void> {
  await invoke('local_reveal', { path });
}

export async function localReadText(path: string): Promise<string> {
  return invoke<string>('local_read_text', { path });
}

export async function secretSet(hostId: string, secret: string): Promise<void> {
  await invoke('secret_set', { hostId, secret });
}

export async function secretGet(hostId: string): Promise<string | null> {
  return invoke<string | null>('secret_get', { hostId });
}

export async function secretDelete(hostId: string): Promise<void> {
  await invoke('secret_delete', { hostId });
}

export async function sftpOpen(args: {
  host: string; port: number; user: string;
  auth: AuthRequest;
  acceptFingerprint?: string | null;
}): Promise<SftpOpenResult> {
  return invoke<SftpOpenResult>('sftp_open', {
    host: args.host, port: args.port, user: args.user,
    auth: args.auth,
    acceptFingerprint: args.acceptFingerprint ?? null,
  });
}

export async function sftpClose(sftpId: string): Promise<void> {
  await invoke('sftp_close', { sftpId });
}

export async function sftpList(sftpId: string, path: string): Promise<SftpEntry[]> {
  return invoke<SftpEntry[]>('sftp_list', { sftpId, path });
}

export async function sftpCanonicalize(sftpId: string, path: string): Promise<string> {
  return invoke<string>('sftp_canonicalize', { sftpId, path });
}

export async function sftpMkdir(sftpId: string, path: string): Promise<void> {
  await invoke('sftp_mkdir', { sftpId, path });
}

export async function sftpRemoveFile(sftpId: string, path: string): Promise<void> {
  await invoke('sftp_remove_file', { sftpId, path });
}

export async function sftpRemoveDir(sftpId: string, path: string): Promise<void> {
  await invoke('sftp_remove_dir', { sftpId, path });
}

export async function sftpRename(sftpId: string, from: string, to: string): Promise<void> {
  await invoke('sftp_rename', { sftpId, from, to });
}

export async function sftpDownload(sftpId: string, remote: string, local: string): Promise<number> {
  return invoke<number>('sftp_download', { sftpId, remote, local, transferId: makeTransferId() });
}

export async function sftpUpload(sftpId: string, local: string, remote: string): Promise<number> {
  return invoke<number>('sftp_upload', { sftpId, local, remote, transferId: makeTransferId() });
}

export async function sftpCancelTransfer(transferId: string): Promise<void> {
  await invoke('sftp_cancel_transfer', { transferId });
}

export async function onSftpTransferProgress(
  cb: (payload: SftpTransferProgress) => void,
): Promise<UnlistenFn> {
  return listen<SftpTransferProgress>('sftp://transfer-progress', (event) => cb(event.payload));
}

export async function snippetsList(): Promise<Snippet[]> {
  return invoke<Snippet[]>('snippets_list');
}

export async function snippetsCreate(input: SnippetInput): Promise<Snippet> {
  return invoke<Snippet>('snippets_create', { input });
}

export async function snippetsUpdate(id: string, input: SnippetInput): Promise<Snippet> {
  return invoke<Snippet>('snippets_update', { id, input });
}

export async function snippetsDelete(id: string): Promise<void> {
  await invoke('snippets_delete', { id });
}

export async function snippetsTouch(id: string): Promise<void> {
  await invoke('snippets_touch', { id });
}

// ─── Tag colors ─────────────────────────────────────────────────────────────

export async function tagColorsList(): Promise<TagColor[]> {
  return invoke<TagColor[]>('tag_colors_list');
}
export async function tagColorSet(name: string, color: string): Promise<TagColor> {
  return invoke<TagColor>('tag_color_set', { name, color });
}
export async function tagColorDelete(name: string): Promise<void> {
  await invoke('tag_color_delete', { name });
}
export async function tagRename(oldName: string, newName: string): Promise<void> {
  await invoke('tag_rename', { old: oldName, new: newName });
}
export async function tagDelete(name: string): Promise<void> {
  await invoke('tag_delete', { name });
}

// ─── Port Forwarding ────────────────────────────────────────────────────────

export async function forwardsList(): Promise<Forward[]> {
  return invoke<Forward[]>('forwards_list');
}
export async function forwardsCreate(input: ForwardInput): Promise<Forward> {
  return invoke<Forward>('forwards_create', { input });
}
export async function forwardsUpdate(id: string, input: ForwardInput): Promise<Forward> {
  return invoke<Forward>('forwards_update', { id, input });
}
export async function forwardsDelete(id: string): Promise<void> {
  await invoke('forwards_delete', { id });
}
export async function forwardStart(id: string): Promise<ForwardStatus> {
  return invoke<ForwardStatus>('forward_start', { id });
}
export async function forwardStop(id: string): Promise<ForwardStatus> {
  return invoke<ForwardStatus>('forward_stop', { id });
}
export async function forwardStatus(id: string): Promise<ForwardStatus> {
  return invoke<ForwardStatus>('forward_status', { id });
}
export async function forwardsStatusAll(): Promise<ForwardStatus[]> {
  return invoke<ForwardStatus[]>('forwards_status_all');
}

// ─── Database query runner ──────────────────────────────────────────────────

export async function dbConnectionsList(): Promise<DbConnection[]> {
  return invoke<DbConnection[]>('db_connections_list');
}
export async function dbConnectionsCreate(input: DbConnectionInput): Promise<DbConnection> {
  return invoke<DbConnection>('db_connections_create', { input });
}
export async function dbConnectionsUpdate(id: string, input: DbConnectionInput): Promise<DbConnection> {
  return invoke<DbConnection>('db_connections_update', { id, input });
}
export async function dbConnectionsDelete(id: string): Promise<void> {
  await invoke('db_connections_delete', { id });
}
export async function dbSessionOpen(
  connectionId: string,
  dbPassword: string,
  sshPassphrase?: string,
): Promise<string> {
  return invoke<string>('db_session_open', {
    connectionId,
    dbPassword,
    sshPassphrase: sshPassphrase ?? null,
  });
}
export async function dbSessionClose(sessionId: string): Promise<void> {
  await invoke('db_session_close', { sessionId });
}

function makeTransferId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
export async function dbQuery(sessionId: string, sql: string): Promise<QueryResult> {
  return invoke<QueryResult>('db_query', { sessionId, sql });
}
export async function dbDescribeTable(sessionId: string, table: string): Promise<TableMeta> {
  return invoke<TableMeta>('db_describe_table', { sessionId, table });
}
export async function dbUpdateRow(
  sessionId: string,
  table: string,
  key: DbCell[],
  changes: DbCell[],
): Promise<QueryResult> {
  return invoke<QueryResult>('db_update_row', { sessionId, table, key, changes });
}
export async function dbInsertRow(sessionId: string, table: string, values: DbCell[]): Promise<QueryResult> {
  return invoke<QueryResult>('db_insert_row', { sessionId, table, values });
}
export async function dbDeleteRow(sessionId: string, table: string, key: DbCell[]): Promise<QueryResult> {
  return invoke<QueryResult>('db_delete_row', { sessionId, table, key });
}
export async function dbExecuteSchema(sessionId: string, sql: string): Promise<QueryResult> {
  return invoke<QueryResult>('db_execute_schema', { sessionId, sql });
}
export async function dbQueryCancel(sessionId: string): Promise<void> {
  await invoke('db_query_cancel', { sessionId });
}
export async function dbListTables(sessionId: string, engine: string): Promise<string[]> {
  return invoke<string[]>('db_list_tables', { sessionId, engine });
}
export async function dbListDatabases(sessionId: string, engine: string): Promise<string[]> {
  return invoke<string[]>('db_list_databases', { sessionId, engine });
}
export async function dbSwitchDatabase(sessionId: string, database: string): Promise<void> {
  await invoke('db_switch_database', { sessionId, database });
}
export async function dbExportDump(sessionId: string, dataToo: boolean): Promise<string> {
  return invoke<string>('db_export_dump', { sessionId, dataToo });
}
export async function readTextFile(path: string): Promise<string> {
  return invoke<string>('read_text_file', { path });
}
export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke('write_text_file', { path, content });
}

// ─── SSH key registry ───────────────────────────────────────────────────────

export async function sshKeysList(): Promise<SshKey[]> {
  return invoke<SshKey[]>('ssh_keys_list');
}
export async function sshKeysCreate(input: SshKeyInput): Promise<SshKey> {
  return invoke<SshKey>('ssh_keys_create', { input });
}
export async function sshKeysUpdate(id: string, input: SshKeyInput): Promise<SshKey> {
  return invoke<SshKey>('ssh_keys_update', { id, input });
}
export async function sshKeysDelete(id: string): Promise<void> {
  await invoke('ssh_keys_delete', { id });
}
