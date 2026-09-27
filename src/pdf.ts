import type { Project, SymbolKind } from './model';
import { fileSafeName } from './storage';
import { hexRgb } from './image';

export async function savePdf(project: Project) {
  if (!project.charts.length) throw new Error('Import a chart before saving a PDF.');
  const { jsPDF } = await import('jspdf');
  const first = project.charts[0];
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: first.cols / first.rows > 1.45 ? 'landscape' : 'portrait' });
  const groupColors = new Map(project.palette.map((entry) => [entry.id, entry.color]));

  function drawGlyph(kind: SymbolKind, x: number, y: number, size: number) {
    const line = (x1: number, y1: number, x2: number, y2: number) => pdf.line(x + x1 * size, y + y1 * size, x + x2 * size, y + y2 * size);
    const lines: Record<Exclude<SymbolKind, 'YO' | 'M1'>, number[][]> = {
      SSK: [[0.2, 0.17, 0.8, 0.83]],
      K2tog: [[0.2, 0.83, 0.8, 0.17]],
      M1L: [[0.18, 0.2, 0.72, 0.65], [0.72, 0.25, 0.72, 0.85]],
      M1R: [[0.82, 0.2, 0.28, 0.65], [0.28, 0.25, 0.28, 0.85]],
    };
    const stroke = (r: number, g: number, b: number, width: number) => {
      pdf.setDrawColor(r, g, b);
      pdf.setLineWidth(width);
      if (kind === 'YO') pdf.circle(x + size / 2, y + size / 2, size * 0.31);
      else if (kind === 'M1') { pdf.circle(x + size / 2, y + size * 0.59, size * 0.28); line(0.5, 0.11, 0.5, 0.31); }
      else lines[kind].forEach(([x1, y1, x2, y2]) => line(x1, y1, x2, y2));
    };
    stroke(255, 255, 255, Math.max(0.5, size * 0.18));
    stroke(20, 20, 20, Math.max(0.25, size * 0.09));
  }

  project.charts.forEach((chart, index) => {
    const orientation = chart.cols / chart.rows > 1.45 ? 'landscape' : 'portrait';
    if (index) pdf.addPage('a4', orientation);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    pdf.setTextColor(20, 20, 20);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text(project.name, 15, 16);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    if (chart.name !== project.name) pdf.text(chart.name, 15, 23);
    const cell = Math.min(8, (pageWidth - 42) / chart.cols, (pageHeight - 65) / chart.rows);
    const x0 = Math.max(20, (pageWidth - chart.cols * cell) / 2);
    const y0 = 36;
    chart.cells.forEach((line, r) => line.forEach((item, c) => {
      const color = item.noStitch ? '#DFE4E8' : groupColors.get(item.groupId || '') || item.sourceColor;
      const [red, green, blue] = hexRgb(color);
      pdf.setFillColor(red, green, blue);
      pdf.rect(x0 + c * cell, y0 + r * cell, cell, cell, 'F');
      if (item.noStitch) {
        pdf.setDrawColor(85, 96, 106);
        pdf.setLineWidth(0.17);
        pdf.line(x0 + c * cell + cell * 0.28, y0 + r * cell + cell * 0.28, x0 + (c + 1) * cell - cell * 0.28, y0 + (r + 1) * cell - cell * 0.28);
        pdf.line(x0 + (c + 1) * cell - cell * 0.28, y0 + r * cell + cell * 0.28, x0 + c * cell + cell * 0.28, y0 + (r + 1) * cell - cell * 0.28);
      }
      if (item.symbol && !item.noStitch) drawGlyph(item.symbol, x0 + c * cell, y0 + r * cell, cell);
    }));
    pdf.setDrawColor(90, 90, 90);
    pdf.setLineWidth(0.12);
    for (let c = 0; c <= chart.cols; c++) pdf.line(x0 + c * cell, y0, x0 + c * cell, y0 + chart.rows * cell);
    for (let r = 0; r <= chart.rows; r++) pdf.line(x0, y0 + r * cell, x0 + chart.cols * cell, y0 + r * cell);
    if (chart.repeat) {
      pdf.setDrawColor(226, 32, 47);
      pdf.setLineWidth(0.9);
      pdf.rect(x0 + chart.repeat.left * cell, y0 + chart.repeat.top * cell, (chart.repeat.right - chart.repeat.left + 1) * cell, (chart.repeat.bottom - chart.repeat.top + 1) * cell);
    }
    pdf.setTextColor(55, 55, 55);
    pdf.setFontSize(Math.max(5, Math.min(8, cell * 1.7)));
    for (let r = 0; r < chart.rows; r++) pdf.text(String(chart.rowStart + r * chart.rowStep), x0 - 2.2, y0 + (r + 0.7) * cell, { align: 'right' });
    for (let c = 0; c < chart.cols; c++) pdf.text(String(chart.colStart + c * chart.colStep), x0 + (c + 0.5) * cell, y0 - 2.2, { align: 'center' });
    let legendX = 15;
    let legendY = y0 + chart.rows * cell + 10;
    pdf.setFontSize(9);
    for (const entry of project.palette) {
      const labelWidth = Math.max(18, pdf.getTextWidth(entry.label) + 10);
      if (legendX + labelWidth > pageWidth - 15) { legendX = 15; legendY += 8; }
      const [red, green, blue] = hexRgb(entry.color);
      pdf.setFillColor(red, green, blue);
      pdf.setDrawColor(95, 95, 95);
      pdf.rect(legendX, legendY - 4, 5, 5, 'FD');
      pdf.text(entry.label, legendX + 7, legendY);
      legendX += labelWidth;
    }
  });
  pdf.save(`${fileSafeName(project.name)}.pdf`);
}
