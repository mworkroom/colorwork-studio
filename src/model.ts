export const SYMBOLS = ['M1L', 'M1R', 'M1', 'YO', 'SSK', 'K2tog'] as const;
export type SymbolKind = (typeof SYMBOLS)[number];

export interface Rect { x: number; y: number; width: number; height: number }
export interface RepeatBox { left: number; top: number; right: number; bottom: number }
export interface Cell {
  groupId: string | null;
  noStitch: boolean;
  symbol: SymbolKind | null;
  uncertain: boolean;
  sourceColor: string;
}
export interface Chart {
  id: string;
  name: string;
  rows: number;
  cols: number;
  cells: Cell[][];
  rowStart: number;
  rowStep: number;
  colStart: number;
  colStep: number;
  repeat: RepeatBox | null;
  sourceImage: string;
  sourceWidth: number;
  sourceHeight: number;
  crop: Rect;
  legendNames: SymbolKind[];
  legendSamples: Partial<Record<SymbolKind, Rect>>;
  createdAt: number;
}
export interface PaletteEntry {
  id: string;
  label: string;
  originalColor: string;
  color: string;
}
export interface Combination { id: string; name: string; colors: Record<string, string> }
export interface Project {
  version: 1;
  id: string;
  name: string;
  charts: Chart[];
  palette: PaletteEntry[];
  combinations: Combination[];
  activeCombinationId: string | null;
  updatedAt: number;
}

export const newProject = (): Project => ({
  version: 1,
  id: crypto.randomUUID(),
  name: 'Untitled project',
  charts: [],
  palette: [],
  combinations: [],
  activeCombinationId: null,
  updatedAt: Date.now(),
});

export const nextGroupLabel = (used: string[]) => {
  for (let i = 0; i < 26; i++) {
    const name = String.fromCharCode(65 + i);
    if (!used.includes(name)) return name;
  }
  return `Color ${used.length + 1}`;
};

export const isSymbolKind = (value: string): value is SymbolKind =>
  SYMBOLS.includes(value as SymbolKind);

export function normaliseSymbol(value: string): SymbolKind | null {
  const compact = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (compact === 'yo') return 'YO';
  if (compact === 'ssk') return 'SSK';
  if (compact === 'k2tog' || compact === 'ktog') return 'K2tog';
  if (compact === 'm1l' || compact === 'm1i' || compact === 'mil') return 'M1L';
  if (compact === 'm1r' || compact === 'mir') return 'M1R';
  if (compact === 'm1') return 'M1';
  return null;
}

export function validateProject(input: unknown): input is Project {
  if (!input || typeof input !== 'object') return false;
  const p = input as Partial<Project>;
  const isHex = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  const isRect = (value: unknown): value is Rect => {
    if (!value || typeof value !== 'object') return false;
    const rect = value as Rect;
    return [rect.x, rect.y, rect.width, rect.height].every((part) => Number.isFinite(part)) && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0;
  };
  if (p.version !== 1 || typeof p.id !== 'string' || typeof p.name !== 'string' || !Number.isFinite(p.updatedAt) || !Array.isArray(p.charts) || !Array.isArray(p.palette) || !Array.isArray(p.combinations)) return false;
  if (p.charts.length > 50 || p.palette.length > 64 || p.combinations.length > 100) return false;
  if (!p.palette.every((entry) => entry && typeof entry.id === 'string' && typeof entry.label === 'string' && isHex(entry.color) && isHex(entry.originalColor))) return false;
  if (!p.combinations.every((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string' && entry.colors && typeof entry.colors === 'object' && Object.values(entry.colors).every(isHex))) return false;
  return p.charts.every((chart) => chart && typeof chart.id === 'string' && typeof chart.name === 'string' && Number.isInteger(chart.rows) && Number.isInteger(chart.cols) && chart.rows > 0 && chart.cols > 0 && chart.rows <= 300 && chart.cols <= 300 && chart.rows * chart.cols <= 50000 && Number.isInteger(chart.rowStart) && Number.isInteger(chart.rowStep) && Number.isInteger(chart.colStart) && Number.isInteger(chart.colStep) && Number.isFinite(chart.sourceWidth) && Number.isFinite(chart.sourceHeight) && chart.sourceWidth > 0 && chart.sourceHeight > 0 && typeof chart.sourceImage === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(chart.sourceImage) && isRect(chart.crop) && chart.crop.x + chart.crop.width <= chart.sourceWidth + 1 && chart.crop.y + chart.crop.height <= chart.sourceHeight + 1 && Array.isArray(chart.cells) && chart.cells.length === chart.rows && chart.cells.every((row) => Array.isArray(row) && row.length === chart.cols && row.every((cell) => cell && typeof cell.noStitch === 'boolean' && typeof cell.uncertain === 'boolean' && isHex(cell.sourceColor) && (cell.groupId === null || typeof cell.groupId === 'string') && (cell.symbol === null || (typeof cell.symbol === 'string' && isSymbolKind(cell.symbol))))));
}
