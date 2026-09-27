import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { estimateGrid, loadImage, readLegendNames } from './image';
import { SYMBOLS, type Rect, type SymbolKind } from './model';

export interface ImportOptions {
  image: HTMLImageElement;
  source: string;
  crop: Rect;
  rows: number;
  cols: number;
  name: string;
  rowStart: number;
  rowStep: number;
  colStart: number;
  colStep: number;
  legendNames: SymbolKind[];
  legendSamples: Partial<Record<SymbolKind, Rect>>;
}

interface Props {
  source: string;
  fileName: string;
  onClose: () => void;
  onImport: (options: ImportOptions) => void;
}

export default function ImportWizard({ source, fileName, onClose, onImport }: Props) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [mode, setMode] = useState<'chart' | 'legend'>('chart');
  const [crop, setCrop] = useState<Rect | null>(null);
  const [legend, setLegend] = useState<Rect | null>(null);
  const [rows, setRows] = useState(0);
  const [cols, setCols] = useState(0);
  const [name, setName] = useState(fileName.replace(/\.[^.]+$/, '') || 'Chart 1');
  const [rowStart, setRowStart] = useState(1);
  const [rowStep, setRowStep] = useState(1);
  const [colStart, setColStart] = useState(1);
  const [colStep, setColStep] = useState(1);
  const [legendNames, setLegendNames] = useState<SymbolKind[]>([]);
  const [legendSamples, setLegendSamples] = useState<Partial<Record<SymbolKind, Rect>>>({});
  const [confirmedNames, setConfirmedNames] = useState<SymbolKind[]>([]);
  const [manualName, setManualName] = useState<SymbolKind>('M1L');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const drag = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let alive = true;
    loadImage(source).then((loaded) => { if (alive) setImage(loaded); }).catch(() => { if (alive) setError('The image could not be opened.'); });
    return () => { alive = false; };
  }, [source]);

  function point(event: PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || !image) return { x: 0, y: 0 };
    const box = svg.getBoundingClientRect();
    return { x: Math.max(0, Math.min(image.naturalWidth, (event.clientX - box.left) * image.naturalWidth / box.width)), y: Math.max(0, Math.min(image.naturalHeight, (event.clientY - box.top) * image.naturalHeight / box.height)) };
  }

  function currentRect(start: { x: number; y: number }, end: { x: number; y: number }): Rect {
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) };
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!image) return;
    svgRef.current?.setPointerCapture(event.pointerId);
    drag.current = point(event);
    const rect = { ...drag.current, width: 0, height: 0 };
    if (mode === 'chart') setCrop(rect); else setLegend(rect);
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const rect = currentRect(drag.current, point(event));
    if (mode === 'chart') setCrop(rect); else setLegend(rect);
  }

  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current || !image) return;
    const rect = currentRect(drag.current, point(event));
    drag.current = null;
    if (rect.width < 8 || rect.height < 8) return;
    if (mode === 'chart') {
      setCrop(rect);
      const guess = estimateGrid(image, rect);
      setRows(guess.rows);
      setCols(guess.cols);
    } else setLegend(rect);
  }

  async function scanLegend() {
    if (!image || !legend) return;
    setBusy(true);
    setError('');
    try {
      const result = await readLegendNames(image, legend);
      setLegendNames(result.names);
      setLegendSamples(result.samples);
      setConfirmedNames(result.names);
      if (!result.names.length) setError('No supported names were found. You can still assign symbols in the chart editor.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Legend recognition failed.');
    } finally { setBusy(false); }
  }

  const hasChartArea = !!crop && crop.width >= 8 && crop.height >= 8;
  const valid = !!image && hasChartArea && rows > 0 && cols > 0 && rows <= 300 && cols <= 300 && rows * cols <= 50000;

  return <div className="modal-backdrop" role="presentation">
    <section className="import-dialog" role="dialog" aria-modal="true" aria-label="Import chart">
      <header className="dialog-header"><div><h2>Import chart</h2><p>Drag over one chart grid, then confirm its rows and columns.</p></div><button className="icon-button" onClick={onClose} aria-label="Close import">×</button></header>
      <div className="import-body">
        <div className="import-preview">
          <div className="segmented" aria-label="Selection mode"><button className={mode === 'chart' ? 'active' : ''} onClick={() => setMode('chart')}>1. Chart area</button><button className={mode === 'legend' ? 'active' : ''} onClick={() => setMode('legend')}>2. Legend area <span className="optional">optional</span></button></div>
          <p className={`selection-status ${hasChartArea ? 'selection-done' : ''}`} role="status">{hasChartArea ? 'Chart area selected. Check that the blue lines follow the grid.' : 'Drag around one chart grid in the image below. This blue selection is required.'}</p>
          <div className="import-image-scroll">
            {image ? <svg ref={svgRef} className="import-image" width={image.naturalWidth} height={image.naturalHeight} viewBox={`0 0 ${image.naturalWidth} ${image.naturalHeight}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}>
              <image href={source} x="0" y="0" width={image.naturalWidth} height={image.naturalHeight} />
              {crop && crop.width > 1 && crop.height > 1 ? <g><rect x={crop.x} y={crop.y} width={crop.width} height={crop.height} fill="rgba(63,111,196,.08)" stroke="#2864c5" strokeWidth="3" />
                {Array.from({ length: Math.min(cols - 1, 299) }, (_, i) => <line key={`c${i}`} x1={crop.x + (i + 1) * crop.width / cols} x2={crop.x + (i + 1) * crop.width / cols} y1={crop.y} y2={crop.y + crop.height} stroke="#2864c5" strokeWidth="1" opacity=".55" />)}
                {Array.from({ length: Math.min(rows - 1, 299) }, (_, i) => <line key={`r${i}`} x1={crop.x} x2={crop.x + crop.width} y1={crop.y + (i + 1) * crop.height / rows} y2={crop.y + (i + 1) * crop.height / rows} stroke="#2864c5" strokeWidth="1" opacity=".55" />)}</g> : null}
              {legend && legend.width > 1 && legend.height > 1 ? <rect x={legend.x} y={legend.y} width={legend.width} height={legend.height} fill="rgba(163,108,34,.08)" stroke="#a36c22" strokeWidth="3" /> : null}
            </svg> : <div className="loading-image">Loading image…</div>}
          </div>
          <p className="helper">Select the grid itself; leave headings and prose outside the blue box. Select the symbol legend separately if it is visible.</p>
        </div>
        <div className="import-settings">
          <h3>Chart setup</h3>
          <label>Chart name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <div className="input-pair"><label>Rows<input type="number" min="1" max="300" value={rows || ''} onChange={(event) => setRows(Number(event.target.value))} /></label><label>Columns<input type="number" min="1" max="300" value={cols || ''} onChange={(event) => setCols(Number(event.target.value))} /></label></div>
          <p className="helper">The grid count is an estimate. Correct it until the blue lines follow the source grid.</p>
          {rows * cols > 50000 ? <p className="error-text">A chart can contain up to 50,000 cells.</p> : null}
          <h3>Printed numbering</h3>
          <div className="input-pair"><label>Top row<input type="number" value={rowStart} onChange={(event) => setRowStart(Number(event.target.value))} /></label><label>Row step<input type="number" value={rowStep} onChange={(event) => setRowStep(Number(event.target.value))} /></label></div>
          <div className="input-pair"><label>Left column<input type="number" value={colStart} onChange={(event) => setColStart(Number(event.target.value))} /></label><label>Column step<input type="number" value={colStep} onChange={(event) => setColStep(Number(event.target.value))} /></label></div>
          <h3>Symbol legend</h3>
          <button className="secondary-button full" disabled={!legend || busy} onClick={scanLegend}>{busy ? 'Reading names…' : 'Read legend names'}</button>
          <p className="helper">Names identify techniques. After import, choose one source cell as a sample to find matching symbols.</p>
          {legendNames.length ? <div className="detected-names"><strong>Suggested names</strong><div className="legend-name-list">{legendNames.map((kind) => <label key={kind}><input type="checkbox" checked={confirmedNames.includes(kind)} onChange={(event) => setConfirmedNames((current) => event.target.checked ? [...current, kind] : current.filter((name) => name !== kind))} />{kind}</label>)}</div><small>Check these against the printed legend. Only checked names will be used for automatic matching.</small></div> : null}
          <div className="manual-name-row"><select aria-label="Add a legend name" value={manualName} onChange={(event) => setManualName(event.target.value as SymbolKind)}>{SYMBOLS.map((kind) => <option key={kind}>{kind}</option>)}</select><button className="secondary-button" onClick={() => { if (!legendNames.includes(manualName)) setLegendNames((current) => [...current, manualName]); setConfirmedNames((current) => current.includes(manualName) ? current : [...current, manualName]); }}>Add name</button></div>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
        </div>
      </div>
      <footer className="dialog-footer import-footer"><span className="import-footer-status" role="status">{!hasChartArea ? 'Select a chart area above to continue.' : rows < 1 || cols < 1 || rows > 300 || cols > 300 ? 'Enter 1–300 rows and columns.' : rows * cols > 50000 ? 'The chart is too large.' : 'Ready to reconstruct.'}</span><button className="text-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!valid || busy} onClick={() => onImport({ image: image!, source, crop: crop!, rows, cols, name: name.trim() || 'Untitled chart', rowStart, rowStep, colStart, colStep, legendNames: confirmedNames, legendSamples: Object.fromEntries(Object.entries(legendSamples).filter(([name]) => confirmedNames.includes(name as SymbolKind))) })}>Reconstruct chart</button></footer>
    </section>
  </div>;
}
