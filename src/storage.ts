import type { Project } from './model';

const DB_NAME = 'colorwork-studio';
const STORE = 'projects';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function saveProject(project: Project): Promise<void> {
  await transact('readwrite', (store) => store.put(project, project.id));
}

export async function loadProject(): Promise<Project | undefined> {
  const id = localStorage.getItem('colorwork-studio-current-id');
  const selected = id ? await transact<Project | undefined>('readonly', (store) => store.get(id)) : undefined;
  return selected || transact('readonly', (store) => store.get('current'));
}

export async function listProjects(): Promise<Project[]> {
  const all = await transact<Project[]>('readonly', (store) => store.getAll());
  return all.filter((item) => item && item.version === 1 && typeof item.id === 'string')
    .filter((item, index, entries) => entries.findIndex((other) => other.id === item.id) === index)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function fileSafeName(name: string) {
  return name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, '-') || 'colorwork-project';
}
