import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import ImportWizard, { type ImportOptions } from './ImportWizard';
import { buildChart, detectLegendSymbols, detectMatchingSymbols } from './image';
import { Glyph } from './glyphs';
import { newProject, nextGroupLabel, SYMBOLS, validateProject, type Cell, type Chart, type PaletteEntry, type Project, type RepeatBox, type SymbolKind } from './model';
import { downloadBlob, fileSafeName, listProjects, loadProject, saveProject } from './storage';
import { savePdf } from './pdf';
import { BackupConflictError, hasWritePermission, pickBackupDirectory, readProjectBackup, rememberedBackupDirectory, rememberBackupDirectory, replaceProjectBackup, requestWritePermission, saveBrowserSafetyCopy, supportsFolderBackup, writeProjectBackup, type BackupDirectory } from './fileBackup';

type Tool = 'select' | 'paint' | 'no-stitch' | 'symbol';
type CellPosition = { row: number; col: number };
type FileBackupState = { kind: 'checking' | 'setup' | 'permission' | 'ready' | 'writing' | 'conflict' | 'error' | 'unsupported'; message: string; folderName?: string };
const HEX = /^#[0-9a-f]{6}$/i;
const LOCAL_KEY = 'colorwork-studio-current';

function saveLocalCopy(project: Project) {
  try { localStorage.setItem('colorwork-studio-current-id', project.id); } catch { /* IndexedDB can still save. */ }
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(project)); }
  catch { /* IndexedDB remains the main store for larger projects. */ }
}

function Icon({ name, size = 20 }: { name: 'upload' | 'download' | 'undo' | 'plus' | 'image' | 'edit' | 'save'; size?: number }) {
  const path = {
    upload: <><path d="M12 16V3m0 0L7 8m5-5 5 5" /><path d="M4 15v5h16v-5" /></>,
    download: <><path d="M12 3v13m0 0-5-5m5 5 5-5" /><path d="M4 17v4h16v-4" /></>,
    undo: <><path d="M9 8H4V3" /><path d="M4 8a8 8 0 1 1-1 8" /></>,
    plus: <path d="M12 4v16M4 12h16" />,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1.5" /><path d="m3 18 6-6 4 4 3-3 5 5" /></>,
    edit: <><path d="m4 17 12-12 3 3L7 20H4z" /><path d="m14 7 3 3" /></>,
    save: <><path d="M4 3h14l3 3v15H3V3z" /><path d="M7 3v6h10V3M7 21v-9h10v9" /></>,
  }[name];
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
}

function ChartCanvas({ chart, palette, selected, sourceView, zoom, tool, onCellDown, onCellEnter }: {
  chart: Chart; palette: PaletteEntry[]; selected: CellPosition | null; sourceView: boolean; zoom: number; tool: Tool;
  onCellDown: (row: number, col: number, event: PointerEvent<SVGRectElement>) => void;
  onCellEnter: (row: number, col: number, event: PointerEvent<SVGRectElement>) => void;
}) {
  const unit = 24;
  const left = 44;
  const top = 34;
  const width = chart.cols * unit;
  const height = chart.rows * unit;
  const colors = useMemo(() => new Map(palette.map((entry) => [entry.id, entry.color])), [palette]);
  const maxRows = chart.rows <= 100 ? chart.rows : 0;
  const maxCols = chart.cols <= 100 ? chart.cols : 0;
  const scaleX = width / chart.crop.width;
  const scaleY = height / chart.crop.height;
  return <svg className="chart-svg" width={(width + left + 16) * zoom} height={(height + top + 18) * zoom} viewBox={`0 0 ${width + left + 16} ${height + top + 18}`} aria-label={`${chart.name}, ${chart.cols} columns by ${chart.rows} rows`}>
    <rect width="100%" height="100%" fill="#fff" />
    {sourceView && chart.sourceImage ? <svg x={left} y={top} width={width} height={height} viewBox={`0 0 ${width} ${height}`} overflow="hidden"><image href={chart.sourceImage} x={-chart.crop.x * scaleX} y={-chart.crop.y * scaleY} width={chart.sourceWidth * scaleX} height={chart.sourceHeight * scaleY} /></svg> : null}
    {Array.from({ length: maxCols }, (_, c) => <text key={`top${c}`} x={left + (c + .5) * unit} y="25" textAnchor="middle" className="chart-number">{chart.colStart + c * chart.colStep}</text>)}
    {Array.from({ length: maxRows }, (_, r) => <text key={`left${r}`} x="35" y={top + (r + .68) * unit} textAnchor="end" className="chart-number">{chart.rowStart + r * chart.rowStep}</text>)}
    {chart.cells.map((row, r) => row.map((cell, c) => <g key={`${r}-${c}`}>
      {!sourceView ? <rect x={left + c * unit} y={top + r * unit} width={unit} height={unit} fill={cell.noStitch ? '#DFE5E9' : colors.get(cell.groupId || '') || cell.sourceColor} stroke="#747d7d" strokeWidth=".55" /> : null}
      {!sourceView && cell.noStitch ? <path d={`M${left + c * unit + 7} ${top + r * unit + 7} l10 10 m0 -10 l-10 10`} stroke="#6C7881" strokeWidth="1.6" /> : null}
      {!sourceView && cell.symbol && !cell.noStitch ? <Glyph kind={cell.symbol} x={left + c * unit + 2} y={top + r * unit + 2} size={20} /> : null}
      {!sourceView && cell.uncertain ? <path d={`M${left + (c + 1) * unit - 7} ${top + r * unit + .8} h6 v6 z`} fill="#C6842B" /> : null}
      <rect x={left + c * unit} y={top + r * unit} width={unit} height={unit} fill="transparent" stroke={selected?.row === r && selected.col === c ? '#1E62D0' : 'none'} strokeWidth="2.7" className={`hit-cell ${tool !== 'select' ? 'editing' : ''}`} onPointerDown={(event) => onCellDown(r, c, event)} onPointerEnter={(event) => onCellEnter(r, c, event)}><title>Row {chart.rowStart + r * chart.rowStep}, column {chart.colStart + c * chart.colStep}{cell.symbol ? `, ${cell.symbol}` : ''}</title></rect>
    </g>))}
    {chart.repeat && !sourceView ? <rect x={left + chart.repeat.left * unit} y={top + chart.repeat.top * unit} width={(chart.repeat.right - chart.repeat.left + 1) * unit} height={(chart.repeat.bottom - chart.repeat.top + 1) * unit} fill="none" stroke="#EA2338" strokeWidth="2.7" pointerEvents="none" /> : null}
  </svg>;
}

export default function App() {
  const [project, setProject] = useState<Project>(newProject);
  const [loaded, setLoaded] = useState(false);
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  const [sourceView, setSourceView] = useState(false);
  const [zoom, setZoom] = useState(1.25);
  const [tool, setTool] = useState<Tool>('select');
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeSymbol, setActiveSymbol] = useState<SymbolKind>('M1L');
  const [importFile, setImportFile] = useState<{ src: string; name: string } | null>(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [combinationName, setCombinationName] = useState('');
  const [repeatDraft, setRepeatDraft] = useState({ left: 1, top: 1, right: 1, bottom: 1 });
  const [mergeTarget, setMergeTarget] = useState('');
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [savedProjects, setSavedProjects] = useState<Project[]>([]);
  const [fileBackup, setFileBackup] = useState<FileBackupState>({ kind: 'checking', message: 'Checking automatic file backup…' });
  const [backupFolderToken, setBackupFolderToken] = useState(0);
  const uploadRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const history = useRef<Project[]>([]);
  const projectRef = useRef(project);
  const dragging = useRef(false);
  const touched = useRef(new Set<string>());
  const backupFolder = useRef<BackupDirectory | null>(null);
  const syncedBackup = useRef(new Map<string, string | null>());
  const backupQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    loadProject().then((saved) => {
      let local: Project | undefined;
      try { const raw = localStorage.getItem(LOCAL_KEY); const parsed: unknown = raw ? JSON.parse(raw) : null; if (validateProject(parsed)) local = parsed; } catch { /* Ignore a damaged local copy. */ }
      const currentId = localStorage.getItem('colorwork-studio-current-id');
      const chosen = local && local.id === currentId && (!saved || (local.id === saved.id && local.updatedAt >= saved.updatedAt)) ? local : saved;
      if (chosen && validateProject(chosen)) { projectRef.current = chosen; setProject(chosen); setSelectedChartId(chosen.charts[0]?.id || null); setActiveGroupId(chosen.palette[0]?.id || null); }
    }).catch(() => setToast('Browser storage is unavailable. Export a project backup to keep your work.')).finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const id = window.setTimeout(() => saveProject(project).catch(() => setToast('Automatic save failed. Export a backup file.')), 450);
    return () => window.clearTimeout(id);
  }, [project, loaded]);

  useEffect(() => {
    let active = true;
    if (!supportsFolderBackup()) {
      setFileBackup({ kind: 'unsupported', message: 'Folder backup is unavailable in this browser. Download JSON manually or open the app in Chrome.' });
      return;
    }
    rememberedBackupDirectory().then(async (directory) => {
      if (!active) return;
      if (!directory) { setFileBackup({ kind: 'setup', message: 'Choose a folder once to back up project JSON automatically.' }); return; }
      backupFolder.current = directory;
      const permission = await hasWritePermission(directory);
      if (!active) return;
      if (permission === 'granted') setBackupFolderToken((value) => value + 1);
      else setFileBackup({ kind: 'permission', folderName: directory.name, message: 'Allow folder access again to resume JSON backups.' });
    }).catch((error) => {
      if (active) setFileBackup({ kind: 'error', message: `Saved backup folder could not be opened: ${error instanceof Error ? error.message : 'Unknown error'}` });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const directory = backupFolder.current;
    if (!loaded || !directory || !backupFolderToken) return;
    const id = project.id;
    let active = true;
    setFileBackup({ kind: 'checking', folderName: directory.name, message: 'Checking the project backup file…' });
    readProjectBackup(directory, id).then((file) => {
      if (!active || backupFolder.current !== directory || projectRef.current.id !== id) return;
      if (file && file.raw !== JSON.stringify(projectRef.current)) {
        setFileBackup({ kind: 'conflict', folderName: directory.name, message: 'The folder file differs from this browser project. Choose which version to keep.' });
      } else {
        syncedBackup.current.set(id, file?.raw ?? null);
        setFileBackup({ kind: 'ready', folderName: directory.name, message: file ? 'JSON file is up to date.' : 'Ready to create this project’s JSON file.' });
      }
    }).catch((error) => {
      if (active) setFileBackup({ kind: 'error', folderName: directory.name, message: error instanceof Error ? error.message : 'Backup file could not be checked.' });
    });
    return () => { active = false; };
  }, [loaded, project.id, backupFolderToken]);

  useEffect(() => {
    if (!loaded || fileBackup.kind !== 'ready' || !project.charts.length || !backupFolder.current) return;
    const id = project.id;
    const timer = window.setTimeout(() => {
      const directory = backupFolder.current;
      const snapshot = projectRef.current;
      if (!directory || snapshot.id !== id) return;
      if (syncedBackup.current.get(id) === JSON.stringify(snapshot)) return;
      const expected = syncedBackup.current.get(id);
      if (expected === undefined) return;
      setFileBackup({ kind: 'writing', folderName: directory.name, message: 'Saving project JSON to the selected folder…' });
      const write = backupQueue.current.then(async () => {
        const saved = await writeProjectBackup(directory, snapshot, expected);
        syncedBackup.current.set(id, saved);
      });
      backupQueue.current = write.catch(() => undefined);
      void write.then(() => {
        if (backupFolder.current === directory && projectRef.current.id === id) setFileBackup({ kind: 'ready', folderName: directory.name, message: 'Project JSON backed up automatically.' });
      }, (error) => {
        if (backupFolder.current !== directory || projectRef.current.id !== id) return;
        setFileBackup(error instanceof BackupConflictError
          ? { kind: 'conflict', folderName: directory.name, message: error.message }
          : { kind: 'error', folderName: directory.name, message: `Automatic JSON backup failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [project, loaded, fileBackup.kind]);

  useEffect(() => {
    const stop = () => {
      if (dragging.current) { saveLocalCopy(projectRef.current); void saveProject(projectRef.current).catch(() => {}); }
      dragging.current = false;
      touched.current.clear();
    };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const chart = project.charts.find((item) => item.id === selectedChartId) || project.charts[0] || null;
  const cell = chart && selectedCell ? chart.cells[selectedCell.row]?.[selectedCell.col] : null;

  useEffect(() => {
    if (!chart) return;
    setRepeatDraft(chart.repeat ? { left: chart.repeat.left + 1, top: chart.repeat.top + 1, right: chart.repeat.right + 1, bottom: chart.repeat.bottom + 1 } : { left: 1, top: 1, right: 1, bottom: 1 });
  }, [chart?.id, chart?.repeat?.left, chart?.repeat?.top, chart?.repeat?.right, chart?.repeat?.bottom]);

  const commit = useCallback((change: (current: Project) => Project) => {
    setProject((current) => {
      const next = change(current);
      if (next === current) return current;
      history.current = [...history.current.slice(-29), current];
      const stamped = { ...next, updatedAt: Date.now() };
      projectRef.current = stamped;
      saveLocalCopy(stamped);
      void saveProject(stamped).catch(() => {});
      return stamped;
    });
  }, []);

  const changeWithoutHistory = useCallback((change: (current: Project) => Project) => {
    setProject((current) => { const next = change(current); if (next === current) return current; const stamped = { ...next, updatedAt: Date.now() }; projectRef.current = stamped; return stamped; });
  }, []);

  const updateChart = useCallback((current: Project, chartId: string, change: (chart: Chart) => Chart): Project => {
    const index = current.charts.findIndex((item) => item.id === chartId);
    if (index < 0) return current;
    const charts = current.charts.slice();
    charts[index] = change(charts[index]);
    return { ...current, charts };
  }, []);

  const updateCell = useCallback((current: Project, chartId: string, row: number, col: number, change: (cell: Cell) => Cell): Project => updateChart(current, chartId, (item) => {
    const cells = item.cells.slice();
    cells[row] = cells[row].slice();
    cells[row][col] = change(cells[row][col]);
    return { ...item, cells };
  }), [updateChart]);

  function doUndo() {
    const previous = history.current.pop();
    if (previous) { const restored = { ...previous, updatedAt: Date.now() }; projectRef.current = restored; setProject(restored); saveLocalCopy(restored); void saveProject(restored).catch(() => {}); setToast('Undone.'); }
  }

  function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function onImageFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setToast('Choose a PNG, JPEG, or WebP image.'); return; }
    if (file.size > 30 * 1024 * 1024) { setToast('This image is over 30 MB. Choose a smaller image.'); return; }
    try { setImportFile({ src: await readFile(file), name: file.name }); }
    catch { setToast('The image could not be read.'); }
  }

  async function onImport(options: ImportOptions) {
    setBusy(true);
    try {
      const result = buildChart(options.image, options.source, options.crop, options.rows, options.cols, project.palette, options.name, options.rowStart, options.rowStep, options.colStart, options.colStep);
      result.chart.legendNames = options.legendNames;
      result.chart.legendSamples = options.legendSamples;
      let detected = 0;
      if (Object.keys(options.legendSamples).length) {
        try {
          const symbols = await detectLegendSymbols(result.chart);
          result.chart = symbols.chart;
          detected = symbols.count;
        } catch { /* The chart remains editable when source symbol matching fails. */ }
      }
      commit((current) => ({ ...current, name: current.charts.length ? current.name : options.name, charts: [...current.charts, result.chart], palette: result.palette }));
      setSelectedChartId(result.chart.id);
      setSelectedCell(null);
      setSourceView(false);
      setActiveGroupId(result.palette[0]?.id || null);
      setImportFile(null);
      setToast(detected ? `Chart reconstructed. ${detected} possible symbols found; review them against the source.` : 'Chart reconstructed. Review the grid, colors, and uncertain cells.');
    } catch (cause) { setToast(cause instanceof Error ? cause.message : 'Import failed.'); }
    finally { setBusy(false); }
  }

  async function onBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { setToast('This backup is over 100 MB.'); return; }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!validateProject(parsed)) throw new Error('This is not a compatible Colorwork Studio project.');
      history.current = [];
      const restored = { ...parsed, updatedAt: Date.now() };
      projectRef.current = restored;
      setProject(restored);
      saveLocalCopy(restored);
      void saveProject(restored).catch(() => {});
      setSelectedChartId(restored.charts[0]?.id || null);
      setSelectedCell(null);
      setActiveGroupId(restored.palette[0]?.id || null);
      if (backupFolder.current) { setFileBackup({ kind: 'checking', folderName: backupFolder.current.name, message: 'Checking the restored project backup…' }); setBackupFolderToken((value) => value + 1); }
      setToast('Project restored.');
    } catch (cause) { setToast(cause instanceof Error ? cause.message : 'Project could not be opened.'); }
  }

  function exportBackup() {
    downloadBlob(new Blob([JSON.stringify(project)], { type: 'application/json' }), `${fileSafeName(project.name)}.colorwork.json`);
    setToast('Project backup downloaded.');
  }

  async function chooseBackupFolder() {
    try {
      const directory = await pickBackupDirectory();
      await backupQueue.current;
      backupFolder.current = directory;
      syncedBackup.current.clear();
      try { await rememberBackupDirectory(directory); }
      catch { setToast('Folder connected for this session; it may need to be selected again next time.'); }
      setBackupFolderToken((value) => value + 1);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setFileBackup({ kind: 'error', message: `Backup folder could not be selected: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
  }

  async function reconnectBackupFolder() {
    const directory = backupFolder.current;
    if (!directory) { await chooseBackupFolder(); return; }
    try {
      if (await requestWritePermission(directory) !== 'granted') {
        setFileBackup({ kind: 'permission', folderName: directory.name, message: 'Folder access was not granted. Browser saving continues.' });
        return;
      }
      setBackupFolderToken((value) => value + 1);
    } catch (error) {
      setFileBackup({ kind: 'error', folderName: directory.name, message: `Folder access failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
  }

  async function keepBrowserBackup() {
    const directory = backupFolder.current;
    if (!directory || fileBackup.kind !== 'conflict') return;
    const snapshot = projectRef.current;
    setFileBackup({ kind: 'writing', folderName: directory.name, message: 'Preserving the old file, then saving the browser version…' });
    try {
      await backupQueue.current;
      const saved = await replaceProjectBackup(directory, snapshot);
      syncedBackup.current.set(snapshot.id, saved);
      if (projectRef.current.id === snapshot.id) setFileBackup({ kind: 'ready', folderName: directory.name, message: 'Browser version backed up. The previous file was preserved.' });
    } catch (error) {
      setFileBackup({ kind: 'error', folderName: directory.name, message: `Backup replacement failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
  }

  async function useFolderBackup() {
    const directory = backupFolder.current;
    if (!directory || fileBackup.kind !== 'conflict') return;
    const current = projectRef.current;
    setFileBackup({ kind: 'checking', folderName: directory.name, message: 'Restoring the folder version…' });
    try {
      await backupQueue.current;
      const file = await readProjectBackup(directory, current.id);
      if (!file) throw new Error('The folder file is missing.');
      await saveBrowserSafetyCopy(directory, current);
      history.current = [];
      projectRef.current = file.project;
      setProject(file.project);
      saveLocalCopy(file.project);
      await saveProject(file.project);
      setSelectedChartId(file.project.charts[0]?.id || null);
      setSelectedCell(null);
      setActiveGroupId(file.project.palette[0]?.id || null);
      syncedBackup.current.set(file.project.id, file.raw);
      setFileBackup({ kind: 'ready', folderName: directory.name, message: 'Folder version restored. The former browser version was preserved.' });
    } catch (error) {
      setFileBackup({ kind: 'error', folderName: directory.name, message: `Folder version could not be restored: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
  }

  async function showProjects() {
    try { setSavedProjects(await listProjects()); setProjectsOpen(true); }
    catch { setToast('Saved projects could not be listed. You can still open a backup file.'); setProjectsOpen(true); }
  }

  function selectProject(selected: Project) {
    history.current = [];
    projectRef.current = selected;
    setProject(selected);
    saveLocalCopy(selected);
    setSelectedChartId(selected.charts[0]?.id || null);
    setSelectedCell(null);
    setActiveGroupId(selected.palette[0]?.id || null);
    setSourceView(false);
    setProjectsOpen(false);
    if (backupFolder.current) setFileBackup({ kind: 'checking', folderName: backupFolder.current.name, message: 'Checking this project’s backup…' });
  }

  function createProject() {
    const fresh = newProject();
    selectProject(fresh);
    void saveProject(fresh).catch(() => setToast('Automatic save failed. Export a backup file.'));
  }

  function addGroup() {
    const initial = cell && !cell.noStitch ? cell.sourceColor : '#8A8A8A';
    const id = crypto.randomUUID();
    commit((current) => ({ ...current, palette: [...current.palette, { id, label: nextGroupLabel(current.palette.map((entry) => entry.label)), originalColor: initial, color: initial }], activeCombinationId: null }));
    setActiveGroupId(id);
    setTool('paint');
    setToast('New group added. Paint selected chart cells into it.');
  }

  function changePalette(id: string, change: (entry: PaletteEntry) => PaletteEntry) {
    commit((current) => ({ ...current, palette: current.palette.map((entry) => entry.id === id ? change(entry) : entry), activeCombinationId: null }));
  }

  function moveGroup(id: string, direction: -1 | 1) {
    commit((current) => {
      const index = current.palette.findIndex((entry) => entry.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.palette.length) return current;
      const palette = current.palette.slice();
      [palette[index], palette[nextIndex]] = [palette[nextIndex], palette[index]];
      return { ...current, palette };
    });
  }

  function applyCellEdit(row: number, col: number, record: boolean) {
    if (!chart) return;
    const change = (current: Project) => updateCell(current, chart.id, row, col, (item) => {
      if (tool === 'paint') return activeGroupId ? { ...item, groupId: activeGroupId, noStitch: false, uncertain: false } : item;
      if (tool === 'no-stitch') return { ...item, noStitch: true, symbol: null, uncertain: false };
      if (tool === 'symbol') return { ...item, symbol: activeSymbol, noStitch: false, uncertain: false };
      return item;
    });
    if (record) commit(change); else changeWithoutHistory(change);
  }

  function onCellDown(row: number, col: number, event: PointerEvent<SVGRectElement>) {
    if (event.button !== 0) return;
    setSelectedCell({ row, col });
    if (tool === 'select') return;
    dragging.current = true;
    touched.current = new Set([`${row}:${col}`]);
    applyCellEdit(row, col, true);
  }

  function onCellEnter(row: number, col: number, _event: PointerEvent<SVGRectElement>) {
    if (!dragging.current || tool === 'select') return;
    const key = `${row}:${col}`;
    if (touched.current.has(key)) return;
    touched.current.add(key);
    applyCellEdit(row, col, false);
  }

  function setCell(change: (cell: Cell) => Cell) {
    if (!chart || !selectedCell) return;
    commit((current) => updateCell(current, chart.id, selectedCell.row, selectedCell.col, change));
  }

  function markGroupNoStitch() {
    if (!chart || !cell?.groupId) return;
    const group = cell.groupId;
    commit((current) => updateChart(current, chart.id, (item) => ({
      ...item,
      cells: item.cells.map((row) => row.map((entry) => entry.groupId === group ? { ...entry, groupId: null, noStitch: true, symbol: null, uncertain: false } : entry)),
    })));
    setToast('This chart’s matching cells were marked No stitch. Undo if the group also contains yarn.');
  }

  async function matchSymbols() {
    if (!chart || !selectedCell || !cell) return;
    setBusy(true);
    try {
      const found = await detectMatchingSymbols(chart, selectedCell.row, selectedCell.col, activeSymbol);
      commit((current) => updateChart(current, chart.id, () => found));
      setToast(`Matching source symbols marked as ${activeSymbol}. Review the result.`);
    } catch (cause) { setToast(cause instanceof Error ? cause.message : 'Symbol matching failed.'); }
    finally { setBusy(false); }
  }

  function applyRepeat() {
    if (!chart) return;
    const left = repeatDraft.left - 1, top = repeatDraft.top - 1, right = repeatDraft.right - 1, bottom = repeatDraft.bottom - 1;
    if (left < 0 || top < 0 || right >= chart.cols || bottom >= chart.rows || left > right || top > bottom) { setToast('Repeat bounds must stay inside the chart.'); return; }
    const repeat: RepeatBox = { left, top, right, bottom };
    commit((current) => updateChart(current, chart.id, (item) => ({ ...item, repeat })));
  }

  function saveCombination() {
    const name = combinationName.trim() || `Combination ${project.combinations.length + 1}`;
    const id = crypto.randomUUID();
    commit((current) => ({ ...current, combinations: [...current.combinations, { id, name, colors: Object.fromEntries(current.palette.map((entry) => [entry.id, entry.color])) }], activeCombinationId: id }));
    setCombinationName('');
    setToast('Color combination saved.');
  }

  function applyCombination(id: string) {
    commit((current) => {
      const combination = current.combinations.find((item) => item.id === id);
      if (!combination) return current;
      return { ...current, palette: current.palette.map((entry) => ({ ...entry, color: combination.colors[entry.id] || entry.color })), activeCombinationId: id };
    });
  }

  function mergeGroup() {
    if (!activeGroupId || !mergeTarget || activeGroupId === mergeTarget) return;
    commit((current) => ({
      ...current,
      charts: current.charts.map((item) => ({ ...item, cells: item.cells.map((row) => row.map((entry) => entry.groupId === activeGroupId ? { ...entry, groupId: mergeTarget } : entry)) })),
      palette: current.palette.filter((entry) => entry.id !== activeGroupId),
      combinations: current.combinations.map((combination) => ({ ...combination, colors: Object.fromEntries(Object.entries(combination.colors).filter(([id]) => id !== activeGroupId)) })),
    }));
    setActiveGroupId(mergeTarget);
    setMergeTarget('');
    setToast('Color groups merged.');
  }

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><span className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></span><strong>Colorwork Studio</strong></div>
      <div className="header-actions">
        <button className="header-link" onClick={showProjects}>Projects</button>
        <button className="header-link" onClick={exportBackup} disabled={!project.charts.length}><Icon name="save" size={17} /> Download JSON</button>
        <button className="primary-button" onClick={() => uploadRef.current?.click()}><Icon name="upload" size={19} /> Upload image</button>
      </div>
      <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onImageFile} />
      <input ref={backupRef} type="file" accept=".json,.colorwork.json,application/json" hidden onChange={onBackupFile} />
    </header>
    <div className="workspace">
      <main className="workbench">
        {chart ? <div className="chart-scroll"><ChartCanvas chart={chart} palette={project.palette} selected={selectedCell} sourceView={sourceView} zoom={zoom} tool={tool} onCellDown={onCellDown} onCellEnter={onCellEnter} /></div>
          : <div className="empty-state"><div className="empty-icon"><Icon name="image" size={42} /></div><h1>Start with a knitting chart</h1><p>Upload a clear screenshot or image. Select its grid, review the reconstructed cells, and try yarn colors without redrawing the pattern.</p><button className="primary-button" onClick={() => uploadRef.current?.click()}><Icon name="upload" /> Upload chart image</button><div className="empty-steps"><span>1. Select the grid</span><span>2. Review the cells</span><span>3. Recolor and save</span></div></div>}
      </main>
      <aside className="inspector">
        <div className="inspector-section sidebar-workspace">
          <label className="sidebar-project-label" htmlFor="project-name">Project name</label>
          <input className="sidebar-project-input" id="project-name" value={project.name} onChange={(event) => commit((current) => ({ ...current, name: event.target.value }))} aria-label="Project name" />
          <div className="sidebar-view-actions"><div className="segmented"><button className={!sourceView ? 'active' : ''} onClick={() => setSourceView(false)}>Reconstruction</button><button className={sourceView ? 'active' : ''} onClick={() => setSourceView(true)} disabled={!chart}>Source</button></div><button className="icon-button" onClick={doUndo} disabled={!history.current.length} title="Undo" aria-label="Undo"><Icon name="undo" /></button></div>
          <h2 className="sidebar-chart-label">Charts in this project</h2>
          {project.charts.length ? <div className="sidebar-chart-list">{project.charts.map((item) => <button key={item.id} className={chart?.id === item.id ? 'selected' : ''} onClick={() => { setSelectedChartId(item.id); setSelectedCell(null); setSourceView(false); }}>{item.name}</button>)}</div> : <p className="quiet-note">No charts yet. Add one image to begin.</p>}
          <button className="secondary-button full sidebar-add-chart" onClick={() => uploadRef.current?.click()}><Icon name="plus" size={17} /> Add chart to this project</button>
          {chart ? <div className="sidebar-chart-details"><strong>{chart.name}</strong><span>{chart.cols} stitches × {chart.rows} rows · {chart.cells.flat().filter((item) => item.uncertain).length} cells to review</span><div className="zoom-controls"><button onClick={() => setZoom((value) => Math.max(.5, +(value - .25).toFixed(2)))} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2, +(value + .25).toFixed(2)))} aria-label="Zoom in">+</button></div></div> : null}
        </div>
        <div className={`inspector-section file-backup-section ${fileBackup.kind}`} role={fileBackup.kind === 'conflict' || fileBackup.kind === 'error' ? 'alert' : 'status'}>
          <h2>Automatic JSON backup</h2><p className="backup-message">{fileBackup.message}</p>
          {fileBackup.folderName ? <p className="backup-folder">Folder: {fileBackup.folderName}</p> : null}
          {fileBackup.kind === 'setup' ? <button className="secondary-button full" onClick={() => void chooseBackupFolder()}>Choose backup folder</button> : null}
          {fileBackup.kind === 'permission' ? <button className="secondary-button full" onClick={() => void reconnectBackupFolder()}>Allow folder access</button> : null}
          {fileBackup.kind === 'conflict' ? <div className="backup-conflict-actions"><button className="secondary-button" onClick={() => void useFolderBackup()}>Use folder file</button><button className="secondary-button" onClick={() => void keepBrowserBackup()}>Use browser version</button></div> : null}
          {fileBackup.kind === 'error' ? <div className="backup-conflict-actions"><button className="secondary-button" onClick={() => void reconnectBackupFolder()}>Try again</button><button className="secondary-button" onClick={() => void chooseBackupFolder()}>Change folder</button></div> : null}
          {fileBackup.kind === 'ready' ? <button className="underlined-button" onClick={() => void chooseBackupFolder()}>Change folder</button> : null}
          <p className="backup-browser-note">Changes also save in this browser. Download JSON remains available above.</p>
        </div>
        <div className="inspector-section"><h2>Yarn colors</h2><p className="section-help">Choose a color to update every matching cell. Move colors to match your pattern’s order.</p>
          {project.palette.length ? <div className="palette-list">{project.palette.map((entry, index) => <div className={`palette-row ${activeGroupId === entry.id ? 'palette-active' : ''}`} key={entry.id}>
            <button className="group-label" onClick={() => { setActiveGroupId(entry.id); setTool('paint'); }} title={`Paint with ${entry.label}`}>{entry.label}</button>
            <input type="color" aria-label={`${entry.label} color`} value={HEX.test(entry.color) ? entry.color : '#888888'} onChange={(event) => changePalette(entry.id, (current) => ({ ...current, color: event.target.value }))} />
            <input className="hex-input" aria-label={`${entry.label} hex color`} key={`${entry.id}-${entry.color}`} defaultValue={entry.color} onBlur={(event) => { const value = event.target.value.trim(); if (HEX.test(value) && value.toUpperCase() !== entry.color.toUpperCase()) changePalette(entry.id, (current) => ({ ...current, color: value.toUpperCase() })); else event.target.value = entry.color; }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
            <input className="name-input" aria-label={`${entry.label} yarn name`} defaultValue={entry.label} key={`${entry.id}-${entry.label}`} onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== entry.label) changePalette(entry.id, (current) => ({ ...current, label: value })); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
            <div className="palette-order-actions"><button type="button" aria-label={`Move ${entry.label} up`} title={`Move ${entry.label} up`} disabled={index === 0} onClick={() => moveGroup(entry.id, -1)}>↑</button><button type="button" aria-label={`Move ${entry.label} down`} title={`Move ${entry.label} down`} disabled={index === project.palette.length - 1} onClick={() => moveGroup(entry.id, 1)}>↓</button></div>
          </div>)}</div> : <p className="quiet-note">Colors appear here after you import a chart.</p>}
          <button className="secondary-button full add-group-button" onClick={addGroup} disabled={!chart}><Icon name="plus" size={17} /> Add color group</button>
          {project.palette.length ? <button className="underlined-button" onClick={() => commit((current) => ({ ...current, palette: current.palette.map((entry) => ({ ...entry, color: entry.originalColor })), activeCombinationId: null }))}>Reset to original colors</button> : null}
        </div>
        <div className="inspector-section"><h2>Edit chart</h2><p className="section-help">Select cells to correct recognition or paint a new group.</p>
          <div className="tool-grid">{([['select', 'Select'], ['paint', 'Paint'], ['no-stitch', 'No stitch'], ['symbol', 'Symbol']] as const).map(([value, label]) => <button key={value} className={tool === value ? 'active' : ''} onClick={() => setTool(value)}>{label}</button>)}</div>
          {tool === 'paint' && activeGroupId ? <p className="tool-hint">Painting into <strong>{project.palette.find((entry) => entry.id === activeGroupId)?.label}</strong>. Drag across cells to make a new color region.</p> : null}
          {tool === 'symbol' ? <label className="inline-label">Symbol to paint<select value={activeSymbol} onChange={(event) => setActiveSymbol(event.target.value as SymbolKind)}>{SYMBOLS.map((kind) => <option key={kind}>{kind}</option>)}</select></label> : null}
          {chart && selectedCell && cell ? <div className="cell-inspector"><div className="cell-inspector-title">Selected cell <span>row {chart.rowStart + selectedCell.row * chart.rowStep}, column {chart.colStart + selectedCell.col * chart.colStep}</span></div>
            <label>Yarn group<select value={cell.groupId || ''} onChange={(event) => setCell((current) => ({ ...current, groupId: event.target.value || null, noStitch: false, uncertain: false }))}><option value="">None</option>{project.palette.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
            <label>Stitch symbol<select value={cell.symbol || ''} onChange={(event) => setCell((current) => ({ ...current, symbol: event.target.value ? event.target.value as SymbolKind : null, noStitch: false, uncertain: false }))}><option value="">None</option>{SYMBOLS.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
            <label className="check-row"><input type="checkbox" checked={cell.noStitch} onChange={(event) => setCell((current) => ({ ...current, noStitch: event.target.checked, symbol: event.target.checked ? null : current.symbol, uncertain: false }))} /> No stitch</label>
            {cell.groupId && !cell.noStitch ? <button className="underlined-button" onClick={markGroupNoStitch}>Mark this entire group No stitch in this chart</button> : null}
            {cell.uncertain ? <button className="underlined-button" onClick={() => setCell((current) => ({ ...current, uncertain: false }))}>Mark reviewed</button> : null}
            <button className="secondary-button full" onClick={matchSymbols} disabled={busy}><Icon name="edit" size={16} /> {busy ? 'Matching…' : `Find matching ${activeSymbol} symbols`}</button><p className="helper">Select a clear source cell first. The app uses that image's shape as a sample; confirm matches afterward.</p>
          </div> : <p className="quiet-note">Click a chart cell to inspect it.</p>}
        </div>
        {chart ? <div className="inspector-section compact-section"><h2>Repeat boundary</h2><p className="section-help">Enter cell positions, starting at 1 from the top left.</p><div className="repeat-grid">{(['left', 'top', 'right', 'bottom'] as const).map((key) => <label key={key}>{key}<input type="number" min="1" value={repeatDraft[key]} onChange={(event) => setRepeatDraft((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div><div className="repeat-actions"><button className="secondary-button" onClick={applyRepeat}>Set boundary</button><button className="underlined-button" onClick={() => commit((current) => updateChart(current, chart.id, (item) => ({ ...item, repeat: null })))} disabled={!chart.repeat}>Clear</button></div></div> : null}
        {project.palette.length > 1 ? <div className="inspector-section compact-section"><h2>Merge color groups</h2><p className="section-help">Move every cell in the active group into another group.</p><div className="merge-row"><select aria-label="Merge into" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}><option value="">Merge into…</option>{project.palette.filter((entry) => entry.id !== activeGroupId).map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}</select><button className="secondary-button" disabled={!mergeTarget || !activeGroupId} onClick={mergeGroup}>Merge</button></div></div> : null}
        <div className="inspector-section combinations"><h2>Saved color combinations</h2>{project.combinations.length ? <div className="combination-list">{project.combinations.map((item) => <button key={item.id} className={project.activeCombinationId === item.id ? 'active' : ''} onClick={() => applyCombination(item.id)}><span className="combination-swatches">{project.palette.map((entry) => <i key={entry.id} style={{ background: item.colors[entry.id] || entry.originalColor }} />)}</span><span>{item.name}</span></button>)}</div> : <p className="quiet-note">Save a palette to compare it later.</p>}<div className="save-combination"><input placeholder="Combination name" aria-label="Combination name" value={combinationName} onChange={(event) => setCombinationName(event.target.value)} /><button className="secondary-button" disabled={!chart} onClick={saveCombination}>Save</button></div></div>
        <div className="inspector-footer"><button className="pdf-button" disabled={!chart || busy} onClick={async () => { setBusy(true); try { await savePdf(project); setToast('PDF downloaded.'); } catch (cause) { setToast(cause instanceof Error ? cause.message : 'PDF export failed.'); } finally { setBusy(false); } }}><Icon name="download" /> Save as PDF</button><p>Chart and color key included</p></div>
      </aside>
    </div>
    {importFile ? <ImportWizard source={importFile.src} fileName={importFile.name} onClose={() => setImportFile(null)} onImport={onImport} /> : null}
    {projectsOpen ? <div className="modal-backdrop" role="presentation"><section className="projects-dialog" role="dialog" aria-modal="true" aria-label="Projects"><header className="dialog-header"><div><h2>Projects</h2><p>Open a saved project or start another chart collection.</p></div><button className="icon-button" onClick={() => setProjectsOpen(false)} aria-label="Close projects">×</button></header><div className="projects-list">{savedProjects.length ? savedProjects.map((item) => <button key={item.id} onClick={() => selectProject(item)}><span><strong>{item.name || 'Untitled project'}</strong><small>{item.charts.length} {item.charts.length === 1 ? 'chart' : 'charts'} · {new Date(item.updatedAt).toLocaleDateString()}</small></span><span aria-hidden="true">→</span></button>) : <p className="quiet-note">No projects saved in this browser yet.</p>}</div><footer className="dialog-footer projects-actions"><button className="secondary-button" onClick={() => { setProjectsOpen(false); backupRef.current?.click(); }}>Open backup file</button><button className="primary-button" onClick={createProject}><Icon name="plus" size={18} /> New project</button></footer></section></div> : null}
    {toast ? <div className="toast" role="status">{toast}</div> : null}
  </div>;
}
