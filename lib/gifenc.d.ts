// gifenc (1.0.3) ships no types — the three calls Ad Studio uses for animated GIF export.
declare module 'gifenc' {
  export function GIFEncoder(): { writeFrame(index: Uint8Array, w: number, h: number, opts?: { palette?: number[][]; delay?: number; repeat?: number }): void; finish(): void; bytes(): Uint8Array }
  export function quantize(rgba: Uint8ClampedArray | Uint8Array, maxColors: number, opts?: any): number[][]
  export function applyPalette(rgba: Uint8ClampedArray | Uint8Array, palette: number[][], format?: string): Uint8Array
}
