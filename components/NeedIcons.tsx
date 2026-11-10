// PICTURES FOR THE NEED LIST (Jon, 2026-11-10: "give a sample photo so they know what we are asking").
// One small drawing per item on lib/need-list.ts, so "salad / side plate" or "ladle" is unmistakable to
// an owner who reads English as a second language or has never stocked a rental. Line drawings on a
// 48×48 grid, stroke in currentColor, so they sit in any theme and print cleanly.
//
// A REAL PHOTO WINS: put a square image at public/need-list/<item key>.jpg and add the key to
// NEED_PHOTOS below; the list shows the photo instead of the drawing.
import type { ReactNode } from 'react'

export const NEED_PHOTOS: Record<string, string> = {}

const P = (d: string) => <path d={d} />
const C = (cx: number, cy: number, r: number) => <circle cx={cx} cy={cy} r={r} />
const R = (x: number, y: number, w: number, h: number, rx = 2) => <rect x={x} y={y} width={w} height={h} rx={rx} />
const E = (cx: number, cy: number, rx: number, ry: number) => <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />

// shared shapes
const plate = (r: number) => <>{C(24, 24, r)}{C(24, 24, r * 0.62)}</>
const fork = (x = 24) => <>{P(`M${x - 4} 6v9a4 4 0 0 0 8 0V6M${x} 6v9M${x} 19v23`)}</>
const knife = (x = 24) => <>{P(`M${x - 2} 42V24h4V6c-3 2-5 7-5 13v5`)}</>
const spoon = (x = 24, s = 1) => <>{E(x, 12 * s + 2, 5 * s, 7 * s)}{P(`M${x} ${19 * s + 2}v${42 - (19 * s + 2)}`)}</>
const glass = (top: number, w: number) => <>{P(`M${24 - w} ${top}h${w * 2}l-2 ${42 - top}h${-(w * 2 - 4)}z`)}</>
const pan = (r: number) => <>{E(20, 26, r, r * 0.45)}{P(`M${20 + r} 26h${22 - r}`)}</>

const ICONS: Record<string, ReactNode> = {
  'dinner-plates': plate(19),
  'side-plates': plate(14),
  bowls: <>{P('M6 22h36a18 14 0 0 1-36 0z')}{P('M18 40h12')}</>,
  mugs: <>{P('M10 12h22v22a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6z')}{P('M32 18h4a5 5 0 0 1 0 10h-4')}</>,
  'tall-glasses': glass(6, 9),
  'wine-glasses': <>{P('M15 6h18c0 10-3 16-9 16s-9-6-9-16z')}{P('M24 22v16M17 42h14')}</>,
  'short-glasses': glass(18, 11),
  'serving-bowls': <>{P('M4 20h40a20 16 0 0 1-40 0z')}{P('M16 40h16')}</>,
  'serving-platter': <>{E(24, 24, 21, 13)}{E(24, 24, 15, 8)}</>,
  'cocktail-glasses': <>{P('M8 8h32L24 26z')}{P('M24 26v12M17 42h14')}</>,
  'shot-glasses': glass(22, 7),
  forks: fork(),
  'salad-forks': <>{P('M21 10v7a3 3 0 0 0 6 0v-7M24 10v7M24 20v20')}</>,
  'table-knives': knife(),
  spoons: spoon(),
  teaspoons: <>{E(24, 14, 4, 5.5)}{P('M24 19.5V40')}</>,
  'steak-knives': <>{P('M22 42V24h5V6c-4 2-6 7-6 13v5')}{P('M26 10l-2 2M26 14l-2 2M26 18l-2 2')}</>,
  'serving-utensils': <>{E(16, 12, 5, 7)}{P('M16 19v23')}{P('M28 6v9a4 4 0 0 0 8 0V6M32 6v9M32 19v23')}</>,
  'fry-large': pan(15),
  'fry-small': <>{E(20, 26, 10, 4.5)}{P('M30 26h12')}</>,
  saucepans: <>{R(8, 18, 24, 18, 3)}{P('M32 22h12M8 18h24')}{P('M14 14h12')}</>,
  'stock-pot': <>{R(8, 14, 32, 26, 3)}{P('M4 18h4M40 18h4M14 10h20')}</>,
  'sheet-pans': <>{R(4, 14, 40, 20, 2)}{R(8, 18, 32, 12, 1)}</>,
  'baking-dish': <>{R(6, 16, 36, 18, 5)}{P('M2 22h4M42 22h4')}</>,
  'muffin-tin': <>{R(4, 12, 40, 24, 3)}{C(14, 20, 3.5)}{C(24, 20, 3.5)}{C(34, 20, 3.5)}{C(14, 29, 3.5)}{C(24, 29, 3.5)}{C(34, 29, 3.5)}</>,
  'mixing-bowls': <>{P('M4 20h40a20 18 0 0 1-40 0z')}{P('M12 20a12 10 0 0 0 24 0')}</>,
  colander: <>{P('M6 18h36a18 16 0 0 1-36 0z')}{P('M2 18h4M42 18h4')}{C(16, 25, 1)}{C(24, 27, 1)}{C(32, 25, 1)}{C(20, 31, 1)}{C(28, 31, 1)}</>,
  'chef-knife': <>{P('M6 30c10-1 22-8 32-20l2 6-26 16z')}{R(4, 30, 10, 5, 2)}</>,
  'paring-knife': <>{P('M14 30c8-1 14-5 22-14l2 5-16 11z')}{R(8, 29, 9, 5, 2)}</>,
  'bread-knife': <>{P('M6 26h32l4 4H14')}{P('M14 26l2 2 2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2 2-2')}{R(2, 26, 10, 5, 2)}</>,
  'cutting-boards': <>{R(6, 10, 30, 30, 4)}{P('M36 20h6v10h-6')}</>,
  spatulas: <>{R(16, 6, 16, 14, 2)}{P('M24 20v22M20 10v6M24 10v6M28 10v6')}</>,
  'wooden-spoons': <>{E(24, 12, 6, 8)}{P('M23 20h2v22h-2z')}</>,
  ladle: <>{P('M10 32a10 8 0 0 0 20 0z')}{P('M30 32C30 18 32 8 38 6')}</>,
  tongs: <>{P('M16 6l6 34M32 6l-6 34M20 24h8')}</>,
  whisk: <>{P('M24 26v16')}{P('M24 26c-8-4-8-18 0-20 8 2 8 16 0 20z')}{P('M24 26c-3-4-3-16 0-20M24 26c3-4 3-16 0-20')}</>,
  peeler: <>{R(20, 24, 8, 18, 3)}{P('M20 24V8h8v16M24 10v10')}</>,
  grater: <>{P('M14 42l4-30h12l4 30z')}{P('M20 6h8v6')}{P('M19 20h2M27 20h2M18 28h2M28 28h2M23 24h2M23 32h2')}</>,
  'can-opener': <>{C(16, 16, 7)}{C(16, 16, 2)}{P('M20 22l18 18M14 22l-6 18')}</>,
  corkscrew: <>{P('M8 10h32M24 10v8')}{P('M24 18c4 1 4 4 0 5s-4 4 0 5 4 4 0 5-4 4 0 5')}</>,
  shears: <>{C(14, 34, 6)}{C(30, 36, 6)}{P('M18 30L40 8M26 31L20 12')}</>,
  'measuring-cups': <>{P('M8 16h18l-2 20H10z')}{P('M26 20h8')}{P('M30 26h12l-2 12H32z')}</>,
  'measuring-spoons': <>{E(14, 20, 6, 5)}{P('M20 20h20')}{E(16, 32, 4, 3.5)}{P('M20 32h18')}</>,
  'oven-mitts': <>{P('M14 42V18a8 8 0 0 1 16 0v4l4-4a3 3 0 0 1 4 4l-8 10v10z')}{P('M14 36h16')}</>,
  trivets: <>{C(24, 24, 16)}{C(24, 24, 9)}{P('M24 8v32M8 24h32')}</>,
  'utensil-holder': <>{R(14, 20, 20, 22, 3)}{P('M18 20V6M24 20V8M30 20V6')}</>,
  'coffee-maker': <>{R(10, 6, 26, 8, 2)}{P('M12 14v28h22V14')}{R(18, 28, 10, 10, 1)}{P('M20 18h6')}</>,
  toaster: <>{R(6, 16, 36, 24, 6)}{P('M16 16v-4M30 16v-4M42 26h3')}</>,
  kettle: <>{P('M12 40l3-24h18l3 24z')}{P('M15 16c0-6 4-9 9-9s9 3 9 9')}{P('M36 22l6-6')}</>,
  blender: <>{P('M14 6h20l-3 24H17z')}{R(12, 30, 24, 12, 3)}{C(24, 36, 2)}</>,
  'dish-rack': <>{R(4, 24, 40, 14, 3)}{P('M10 24V12M16 24V10M22 24V12M30 24c0-4 3-10 8-12')}</>,
  'kitchen-trash': <>{P('M10 14h28l-3 28H13z')}{R(8, 8, 32, 6, 2)}{P('M20 20v16M28 20v16')}</>,
  recycling: <>{P('M10 14h28l-3 28H13z')}{P('M20 24l4-5 4 5M24 19v12M18 33h12')}</>,
  'paper-towel-holder': <>{R(14, 8, 20, 30, 6)}{P('M24 8V4M10 42h28')}{P('M14 16h20')}</>,
  'food-storage': <>{R(6, 20, 22, 16, 3)}{R(4, 16, 26, 4, 2)}{R(30, 24, 14, 12, 3)}{R(28, 21, 18, 3, 1.5)}</>,
  'hair-dryer': <>{P('M8 12h22a8 8 0 0 1 0 16H8z')}{P('M16 28l-2 14h8l2-14')}{P('M38 16h4M38 24h4')}</>,
  'bath-trash': <>{P('M12 16h24l-3 26H15z')}{P('M10 16c4-6 24-6 28 0')}</>,
  plunger: <>{P('M24 4v24')}{P('M12 40c0-8 5-12 12-12s12 4 12 12z')}</>,
  'toilet-brush': <>{P('M24 4v22')}{R(16, 26, 16, 8, 4)}{P('M18 34v6M24 34v6M30 34v6')}</>,
  'soap-dispensers': <>{R(14, 18, 20, 24, 5)}{P('M24 18v-6h10M24 12h-4')}</>,
  hangers: <>{P('M24 14a4 4 0 1 0-4-4')}{P('M24 14v4L4 34h40L24 18')}</>,
  'luggage-rack': <>{R(6, 14, 36, 6, 2)}{P('M10 20l20 22M38 20L18 42M12 14V10')}</>,
  iron: <>{P('M6 36c2-12 10-18 22-18h14v18z')}{P('M18 18c0-6 4-8 10-8h8v8')}</>,
  'ironing-board': <>{P('M4 18h32c6 0 8 3 8 5s-2 5-8 5H4z')}{P('M14 28l16 16M30 28L14 44')}</>,
  vacuum: <>{R(18, 22, 10, 14, 4)}{P('M24 22V4h6M14 42h20M23 36v6')}</>,
  broom: <>{P('M24 4v20')}{P('M14 44l4-20h12l4 20z')}{P('M20 32v12M24 32v12M28 32v12')}</>,
  mop: <>{P('M24 4v24')}{R(12, 28, 24, 5, 2)}{P('M14 33l-2 10M20 33v10M28 33v10M34 33l2 10')}</>,
  'smoke-alarms': <>{C(24, 24, 18)}{C(24, 24, 11)}{C(24, 24, 2)}{P('M24 6v3')}</>,
  'co-alarm': <>{R(8, 8, 32, 32, 8)}{P('M18 20a5 5 0 1 0 0 8M27 24a4 4 0 1 0 0 .1')}</>,
  extinguisher: <>{R(16, 16, 14, 26, 6)}{P('M20 16V9h8l8-3M26 9v-3')}{P('M30 9c6 0 8 4 8 10')}</>,
  'first-aid': <>{R(6, 14, 36, 26, 4)}{P('M18 14V9h12v5M24 21v12M18 27h12')}</>,
  flashlight: <>{P('M16 6h16l-4 12v24h-8V18z')}{P('M16 6l-2-2M32 6l2-2M24 24v4')}</>,
  'pack-n-play': <>{R(6, 14, 36, 24, 3)}{P('M6 22h36M14 22v16M24 22v16M34 22v16M8 38v4M40 38v4')}</>,
  'high-chair': <>{P('M14 8h20v16H14zM10 24h28M14 24l-4 18M34 24l4 18M16 34h16')}</>,
  'playing-cards': <>{R(8, 10, 20, 28, 3)}{R(20, 6, 20, 28, 3)}{P('M30 16l3 4-3 4-3-4z')}</>,
  uno: <>{R(10, 6, 28, 36, 4)}{E(24, 24, 9, 13)}</>,
  'board-games': <>{R(4, 18, 40, 20, 3)}{R(8, 10, 32, 8, 2)}{C(16, 28, 3)}{C(32, 28, 3)}</>,
}

/** The picture for one item: a photo when there is one, otherwise its drawing. */
export function NeedPicture({ k, name, size = 44 }: { k: string; name: string; size?: number }) {
  const photo = NEED_PHOTOS[k]
  if (photo) return <img src={photo} alt={name} width={size} height={size} style={{ objectFit: 'cover', borderRadius: 10 }} />
  const shape = ICONS[k]
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={name}>
      {shape || <rect x={10} y={10} width={28} height={28} rx={6} />}
    </svg>
  )
}
