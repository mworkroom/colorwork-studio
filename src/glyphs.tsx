import type { SymbolKind } from './model';

export function Glyph({ kind, x = 0, y = 0, size = 24, stroke = '#171717', halo = true }: { kind: SymbolKind; x?: number; y?: number; size?: number; stroke?: string; halo?: boolean }) {
  const paths: Record<SymbolKind, React.ReactNode> = {
    YO: <circle cx="12" cy="12" r="7.5" />,
    SSK: <path d="M5 4 L19 20" />,
    K2tog: <path d="M5 20 L19 4" />,
    M1L: <path d="M5 4 L17 15 M17 6 L17 20" />,
    M1R: <path d="M19 4 L7 15 M7 6 L7 20" />,
    M1: <path d="M12 4 C15 8 18 10 18 14 C18 18 15 20 12 20 C9 20 6 18 6 14 C6 10 9 8 12 4 Z M6 14 L18 14" />,
  };
  return <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" aria-label={kind} role="img" overflow="visible">
    {halo ? <g fill="none" stroke="#fff" strokeWidth="4.3" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</g> : null}
    <g fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</g>
  </svg>;
}
