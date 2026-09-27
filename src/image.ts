import { nextGroupLabel, normaliseSymbol, type Cell, type Chart, type PaletteEntry, type Rect, type RepeatBox, type SymbolKind } from './model';

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

export function imageData(image: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is unavailable.');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function pixel(data: ImageData, x: number, y: number): [number, number, number] {
  const ix = Math.min(data.width - 1, Math.max(0, Math.round(x)));
  const iy = Math.min(data.height - 1, Math.max(0, Math.round(y)));
  const i = (iy * data.width + ix) * 4;
  return [data.data[i], data.data[i + 1], data.data[i + 2]];
}

function colorDistance(a: number[], b: number[]) {
  return Math.sqrt(0.3 * (a[0] - b[0]) ** 2 + 0.59 * (a[1] - b[1]) ** 2 + 0.11 * (a[2] - b[2]) ** 2);
}

function rgbHex(rgb: number[]) {
  return '#' + rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function hexRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return [128, 128, 128];
  return [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16)) as [number, number, number];
}

function scorePeriod(scores: number[], length: number, minimum = 6, maximum = 100): number {
  let bestPeriod = Math.max(5, Math.round(length / 24));
  let bestScore = -Infinity;
  for (let period = Math.max(6, Math.round(minimum)); period <= Math.min(Math.round(maximum), length / 2); period++) {
    for (let offset = 0; offset < period; offset++) {
      let total = 0;
      let between = 0;
      let count = 0;
      for (let i = offset; i < length; i += period) { total += scores[i] || 0; between += scores[i + Math.floor(period / 2)] || 0; count++; }
      const value = ((total - between * 0.7) / count) * Math.sqrt(count) - period * 0.015;
      if (value > bestScore) { bestScore = value; bestPeriod = period; }
    }
  }
  return bestPeriod;
}

export function estimateGrid(image: HTMLImageElement, crop: Rect): { rows: number; cols: number } {
  const data = imageData(image);
  const width = Math.round(crop.width);
  const height = Math.round(crop.height);
  const xScores = new Array(width).fill(0);
  const yScores = new Array(height).fill(0);
  const luma = (x: number, y: number) => { const p = pixel(data, x, y); return p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11; };
  for (let x = 2; x < width - 2; x++) {
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 100))) {
      xScores[x] += Math.min(1, Math.abs(luma(crop.x + x, crop.y + y) - luma(crop.x + x - 2, crop.y + y)) / 35);
    }
  }
  for (let y = 2; y < height - 2; y++) {
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 100))) {
      yScores[y] += Math.min(1, Math.abs(luma(crop.x + x, crop.y + y) - luma(crop.x + x, crop.y + y - 2)) / 35);
    }
  }
  let xPeriod = scorePeriod(xScores, width);
  let yPeriod = scorePeriod(yScores, height);
  if (xPeriod > yPeriod * 1.8) xPeriod = scorePeriod(xScores, width, yPeriod * 0.65, yPeriod * 1.6);
  if (yPeriod > xPeriod * 1.8) yPeriod = scorePeriod(yScores, height, xPeriod * 0.55, xPeriod * 1.05);
  return {
    rows: Math.max(1, Math.min(300, Math.round(height / yPeriod))),
    cols: Math.max(1, Math.min(300, Math.round(width / xPeriod))),
  };
}

function cellColor(data: ImageData, crop: Rect, row: number, col: number, rows: number, cols: number) {
  const x = crop.x + col * crop.width / cols;
  const y = crop.y + row * crop.height / rows;
  const w = crop.width / cols;
  const h = crop.height / rows;
  const positions = [0.2, 0.4, 0.6, 0.8];
  const samples = positions.flatMap((sy) => positions.map((sx) => pixel(data, x + sx * w, y + sy * h)));
  const median = [0, 1, 2].map((channel) => samples.map((p) => p[channel]).sort((a, b) => a - b)[8]);
  const outliers = samples.filter((p) => colorDistance(p, median) > 55).length;
  let markedSides = 0;
  if (median.every((value) => value > 235)) {
    const darkOnSide = (points: [number, number][]) => points.some(([sx, sy]) => {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const p = pixel(data, x + sx * w + dx, y + sy * h + dy);
        if (p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11 < 245) return true;
      }
      return false;
    });
    if (darkOnSide([[0, .3], [0, .5], [0, .7]])) markedSides++;
    if (darkOnSide([[1, .3], [1, .5], [1, .7]])) markedSides++;
    if (darkOnSide([[.3, 0], [.5, 0], [.7, 0]])) markedSides++;
    if (darkOnSide([[.3, 1], [.5, 1], [.7, 1]])) markedSides++;
  }
  return { rgb: median, uncertain: outliers >= 5, noStitch: median.every((value) => value > 235) && markedSides <= 1 };
}

function detectRedRepeat(data: ImageData, crop: Rect, rows: number, cols: number): RepeatBox | null {
  const x0 = Math.round(crop.x), y0 = Math.round(crop.y);
  const width = Math.round(crop.width), height = Math.round(crop.height);
  const red = (x: number, y: number) => {
    const [r, g, b] = pixel(data, x, y);
    return r > 145 && r > g * 1.65 && r > b * 1.4;
  };
  const xs: number[] = [], ys: number[] = [];
  for (let x = 0; x <= width; x++) {
    let hits = 0;
    for (let y = 0; y <= height; y += 2) if (red(x0 + x, y0 + y)) hits++;
    if (hits > height * 0.18) xs.push(x);
  }
  for (let y = 0; y <= height; y++) {
    let hits = 0;
    for (let x = 0; x <= width; x += 2) if (red(x0 + x, y0 + y)) hits++;
    if (hits > width * 0.18) ys.push(y);
  }
  if (xs.length < 2 || ys.length < 2) return null;
  const left = Math.round(Math.min(...xs) / crop.width * cols);
  const right = Math.round(Math.max(...xs) / crop.width * cols) - 1;
  const top = Math.round(Math.min(...ys) / crop.height * rows);
  const bottom = Math.round(Math.max(...ys) / crop.height * rows) - 1;
  if (left < 0 || top < 0 || right >= cols || bottom >= rows || left > right || top > bottom) return null;
  return { left, right, top, bottom };
}

export function buildChart(image: HTMLImageElement, src: string, crop: Rect, rows: number, cols: number, existing: PaletteEntry[], name: string, rowStart: number, rowStep: number, colStart: number, colStep: number) {
  const data = imageData(image);
  const readings = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => cellColor(data, crop, row, col, rows, cols)));
  const clusters: { rgb: number[]; count: number; id: string }[] = [];
  const palette = existing.map((entry) => ({ ...entry }));
  const values = readings.flat().filter((reading) => !reading.noStitch).map((reading) => reading.rgb);
  const bins = new Map<string, { rgb: number[]; count: number }>();
  values.forEach((rgb) => {
    const key = rgb.map((v) => Math.round(v / 12)).join('-');
    const bin = bins.get(key) || { rgb, count: 0 };
    bin.count++;
    bins.set(key, bin);
  });
  [...bins.values()].sort((a, b) => b.count - a.count).forEach(({ rgb }) => {
    if (clusters.some((cluster) => colorDistance(rgb, cluster.rgb) < 36)) return;
    if (clusters.length >= 12) return;
    const match = palette.find((entry) => colorDistance(rgb, hexRgb(entry.originalColor)) < 30);
    const id = match?.id || crypto.randomUUID();
    if (!match) palette.push({ id, label: nextGroupLabel(palette.map((entry) => entry.label)), originalColor: rgbHex(rgb), color: rgbHex(rgb) });
    clusters.push({ rgb, count: 0, id });
  });
  if (!clusters.length) throw new Error('No colors could be read from this region.');
  const cells: Cell[][] = readings.map((line) => line.map(({ rgb, uncertain, noStitch }) => {
    const nearest = clusters.reduce((best, cluster) => colorDistance(rgb, cluster.rgb) < colorDistance(rgb, best.rgb) ? cluster : best, clusters[0]);
    if (!noStitch) nearest.count++;
    return { groupId: noStitch ? null : nearest.id, noStitch, symbol: null, uncertain: !noStitch && (uncertain || colorDistance(rgb, nearest.rgb) > 35), sourceColor: rgbHex(rgb) };
  }));
  const chart: Chart = { id: crypto.randomUUID(), name, rows, cols, cells, rowStart, rowStep, colStart, colStep, repeat: detectRedRepeat(data, crop, rows, cols), sourceImage: src, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight, crop, legendNames: [], legendSamples: {}, createdAt: Date.now() };
  return { chart, palette };
}

export async function readLegendNames(image: HTMLImageElement, crop: Rect): Promise<{ names: SymbolKind[]; samples: Partial<Record<SymbolKind, Rect>> }> {
  const canvas = document.createElement('canvas');
  const scale = 3;
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  canvas.getContext('2d')?.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  const { createWorker } = await import('tesseract.js');
  const ocrBase = `${import.meta.env.BASE_URL}ocr`;
  const worker = await createWorker('eng', 1, {
    workerPath: `${ocrBase}/worker.min.js`,
    corePath: `${ocrBase}/tesseract-core-lstm.wasm.js`,
    langPath: ocrBase,
    workerBlobURL: false,
  });
  try {
    const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const words = result.data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))) || [];
    const recognized = words.map((word) => ({ kind: normaliseSymbol(word.text), bbox: word.bbox, confidence: word.confidence })).filter((item): item is { kind: SymbolKind; bbox: typeof item.bbox; confidence: number } => item.kind !== null);
    const found = recognized.map((item) => item.kind);
    const samples: Partial<Record<SymbolKind, Rect>> = {};
    recognized.sort((a, b) => b.confidence - a.confidence).forEach(({ kind, bbox }) => {
      if (samples[kind]) return;
      const height = bbox.y1 - bbox.y0;
      const center = (bbox.y0 + bbox.y1) / 2;
      const nextLine = words.map((word) => ({ gap: Math.abs((word.bbox.y0 + word.bbox.y1) / 2 - center), x: word.bbox.x0 }))
        .filter((word) => Math.abs(word.x - bbox.x0) < height * 1.4 && word.gap > height * 1.15)
        .sort((a, b) => a.gap - b.gap)[0]?.gap;
      const side = Math.max(30, Math.min(height * 3.5, nextLine ? nextLine * .78 : Infinity));
      const gap = side * .35 + height * .1;
      const x = crop.x + (bbox.x0 - gap - side) / scale;
      const y = crop.y + (center - side * .62) / scale;
      if (x < 0 || y < 0 || x + side / scale > image.naturalWidth || y + side / scale > image.naturalHeight) return;
      samples[kind] = { x, y, width: side / scale, height: side / scale };
    });
    return { names: [...new Set(found)], samples };
  } finally {
    await worker.terminate();
  }
}

function feature(data: ImageData, crop: Rect, row: number, col: number, rows: number, cols: number, background: string): Uint8Array {
  const result = new Uint8Array(16 * 16);
  const bg = hexRgb(background);
  const cw = crop.width / cols;
  const ch = crop.height / rows;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const px = crop.x + (col + 0.15 + 0.7 * (x + 0.5) / 16) * cw;
    const py = crop.y + (row + 0.15 + 0.7 * (y + 0.5) / 16) * ch;
    result[y * 16 + x] = colorDistance(pixel(data, px, py), bg) > 55 ? 1 : 0;
  }
  return result;
}

function legendFeature(data: ImageData, rect: Rect): Uint8Array {
  const corners = [[.22, .22], [.78, .22], [.22, .78], [.78, .78]]
    .map(([x, y]) => pixel(data, rect.x + x * rect.width, rect.y + y * rect.height));
  const background = [0, 1, 2].map((channel) => corners.map((sample) => sample[channel]).sort((a, b) => a - b)[2]);
  const result = new Uint8Array(256);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const sx = rect.x + (0.15 + 0.7 * (x + 0.5) / 16) * rect.width;
    const sy = rect.y + (0.15 + 0.7 * (y + 0.5) / 16) * rect.height;
    result[y * 16 + x] = colorDistance(pixel(data, sx, sy), background) > 48 ? 1 : 0;
  }
  return result;
}

export async function detectLegendSymbols(chart: Chart): Promise<{ chart: Chart; count: number }> {
  const image = await loadImage(chart.sourceImage);
  const data = imageData(image);
  const templates = Object.entries(chart.legendSamples || {}).map(([kind, rect]) => {
    const bits = legendFeature(data, rect);
    return { kind: kind as SymbolKind, bits, count: bits.reduce((total, bit) => total + bit, 0) };
  }).filter((template) => template.count >= 6 && template.count <= 130);
  if (!templates.length) throw new Error('No usable legend symbols were found. Select a source cell to make a sample instead.');
  let count = 0;
  const cells = chart.cells.map((line, row) => line.map((cell, col) => {
    if (cell.noStitch || cell.symbol) return { ...cell };
    const candidate = feature(data, chart.crop, row, col, chart.rows, chart.cols, cell.sourceColor);
    const candidateCount = candidate.reduce((total, bit) => total + bit, 0);
    if (candidateCount < 6) return { ...cell };
    const scored = templates.map((template) => {
      let differences = 0;
      for (let i = 0; i < 256; i++) differences += candidate[i] !== template.bits[i] ? 1 : 0;
      return { kind: template.kind, difference: differences / 256, sizeRatio: candidateCount / template.count };
    }).filter((item) => item.sizeRatio >= .6 && item.sizeRatio <= 1.5).sort((a, b) => a.difference - b.difference);
    if (!scored.length || scored[0].difference > .13 || (scored[1] && scored[1].difference - scored[0].difference < .025)) return { ...cell };
    count++;
    return { ...cell, symbol: scored[0].kind };
  }));
  return { chart: { ...chart, cells }, count };
}

export async function detectMatchingSymbols(chart: Chart, row: number, col: number, kind: SymbolKind): Promise<Chart> {
  const image = await loadImage(chart.sourceImage);
  const data = imageData(image);
  const selected = chart.cells[row][col];
  const template = feature(data, chart.crop, row, col, chart.rows, chart.cols, selected.sourceColor);
  const count = template.reduce((sum, bit) => sum + bit, 0);
  if (count < 7 || count > 130) throw new Error('This cell does not contain a clear symbol sample. Select a clearer source cell.');
  const cells = chart.cells.map((line) => line.map((cell) => ({ ...cell })));
  for (let r = 0; r < chart.rows; r++) for (let c = 0; c < chart.cols; c++) {
    const candidate = feature(data, chart.crop, r, c, chart.rows, chart.cols, chart.cells[r][c].sourceColor);
    let mismatches = 0;
    let candidateCount = 0;
    for (let i = 0; i < candidate.length; i++) { mismatches += candidate[i] !== template[i] ? 1 : 0; candidateCount += candidate[i]; }
    if (candidateCount >= count * 0.65 && candidateCount <= count * 1.35 && mismatches / 256 < 0.12) cells[r][c].symbol = kind;
  }
  cells[row][col].symbol = kind;
  return { ...chart, cells };
}
