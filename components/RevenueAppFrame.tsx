'use client'
// The Revenue App in a frame that fills the page under a one-line header. Reload re-mounts the
// frame; Open in a new tab is the escape hatch when the app refuses to be framed.
import { useState } from 'react'
import { ExternalLink, RefreshCw, BarChart3 } from 'lucide-react'

export function RevenueAppFrame({ url }: { url: string }) {
  const [n, setN] = useState(0)
  const [loaded, setLoaded] = useState(false)
  return (
    // -mt/-mx pull the frame to the Shell's edges so the app gets the whole pane beside the sidebar.
    <div className="flex flex-col -mx-3 -mt-4 sm:-m-6 lg:-m-8" style={{ height: 'calc(100dvh - 8px)' }}>
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-line bg-white">
        <BarChart3 size={15} className="text-brand-600" />
        <span className="text-[13.5px] font-bold text-ink">Revenue App</span>
        <span className="text-[12px] text-muted truncate hidden sm:inline">stay-hospitalitydrr.netlify.app · its own login</span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <button onClick={() => { setLoaded(false); setN(x => x + 1) }} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink hover:border-ink/30"><RefreshCw size={12} /> Reload</button>
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2.5 py-1 text-[12px] font-semibold hover:bg-ink/85"><ExternalLink size={12} /> Open in a new tab</a>
        </span>
      </div>
      <div className="relative flex-1 min-h-0 bg-app">
        {!loaded && <div className="absolute inset-0 flex items-center justify-center text-[12.5px] text-muted px-6 text-center">Loading the Revenue App… if it asks you to sign in here, use Open in a new tab, sign in there, then Reload this frame.</div>}
        <iframe key={n} src={url} title="Revenue App" onLoad={() => setLoaded(true)}
          className="relative w-full h-full border-0" allow="clipboard-write" referrerPolicy="no-referrer-when-downgrade" />
      </div>
    </div>
  )
}
