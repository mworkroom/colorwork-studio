import { validateProject, type Project } from './model';

const DB_NAME = 'colorwork-studio:file-backup:v1';
const STORE_NAME = 'settings';
const DIRECTORY_KEY = 'backup-directory';

export type BackupDirectory = FileSystemDirectoryHandle & {
  queryPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<BackupDirectory>;
};

export class BackupConflictError extends Error {
  constructor() { super('The backup file changed outside this app. Review both versions before replacing it.'); }
}

export function supportsFolderBackup() {
  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function' && 'indexedDB' in window;
}

export async function pickBackupDirectory(): Promise<BackupDirectory> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('This browser cannot write to a chosen folder. Open the app in Chrome or download JSON manually.');
  return picker({ mode: 'readwrite' });
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function rememberBackupDirectory(directory: BackupDirectory): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(directory, DIRECTORY_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function rememberedBackupDirectory(): Promise<BackupDirectory | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(DIRECTORY_KEY);
      request.onsuccess = () => resolve((request.result as BackupDirectory | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export const hasWritePermission = (directory: BackupDirectory) => directory.queryPermission({ mode: 'readwrite' });
export const requestWritePermission = (directory: BackupDirectory) => directory.requestPermission({ mode: 'readwrite' });
export const projectBackupName = (id: string) => `colorwork-${id}.colorwork.json`;

async function readText(directory: BackupDirectory, name: string): Promise<string | null> {
  try {
    const file = await directory.getFileHandle(name);
    return await (await file.getFile()).text();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}

async function writeText(directory: BackupDirectory, name: string, content: string): Promise<void> {
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(content);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

export async function readProjectBackup(directory: BackupDirectory, id: string): Promise<{ raw: string; project: Project } | null> {
  const raw = await readText(directory, projectBackupName(id));
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('The existing backup file is not valid JSON. It was left untouched.'); }
  if (!validateProject(value) || value.id !== id) throw new Error('The existing backup file is incompatible. It was left untouched.');
  return { raw, project: value };
}

function localDate() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export async function writeProjectBackup(directory: BackupDirectory, project: Project, expectedRaw: string | null): Promise<string> {
  const name = projectBackupName(project.id);
  const content = JSON.stringify(project);
  const actual = await readText(directory, name);
  if (actual === content) return content;
  if (actual !== expectedRaw) throw new BackupConflictError();
  if (actual !== null) {
    const historyName = `colorwork-${project.id}-history-${localDate()}.json`;
    if (await readText(directory, historyName) === null) await writeText(directory, historyName, actual);
  }
  await writeText(directory, name, content);
  return content;
}

export async function replaceProjectBackup(directory: BackupDirectory, project: Project): Promise<string> {
  const name = projectBackupName(project.id);
  const existing = await readText(directory, name);
  if (existing !== null) {
    const stamp = new Date().toISOString().replaceAll(':', '-').replace('.', '-');
    await writeText(directory, `colorwork-${project.id}-before-replace-${stamp}-${crypto.randomUUID().slice(0, 8)}.json`, existing);
  }
  const content = JSON.stringify(project);
  await writeText(directory, name, content);
  return content;
}

export async function saveBrowserSafetyCopy(directory: BackupDirectory, project: Project): Promise<void> {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace('.', '-');
  await writeText(directory, `colorwork-${project.id}-before-restore-${stamp}-${crypto.randomUUID().slice(0, 8)}.json`, JSON.stringify(project));
}
