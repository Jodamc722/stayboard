// Loading state for PUBLIC owner report links.
//
// Without this file Next falls back to app/loading.tsx, which wraps every route in <Shell> —
// the internal STAYBOARD sidebar (Command Center, Guests, Reservations, Messages, Settings…).
// /r/<code> is the link we send to owners, and the page is force-dynamic, so that skeleton is
// streamed as the Suspense fallback and an owner sees Stay's internal navigation flash before
// the report swaps in. Hydrating that client-component fallback and then replacing it is also
// what produced the React #422 / #425 errors logged on the report page.
//
// A segment-level loading.tsx overrides the root one for /r/*. Keep it a plain server component
// with no client hooks: nothing to hydrate, nothing to mismatch, and nothing internal on show.
// Colours are hard-coded rather than themed because the report's own theme (Capri / Minimal /
// Dark / Luxe) is not known until the report itself loads.
export default function ReportLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#f7f7f8' }}>
      <div className="flex items-center gap-4">
        <div className="h-11 w-1.5 rounded-full" style={{ background: '#e2725b' }} />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: '#9a9aa4' }}>
            Stay Hospitality
          </p>
          <p className="mt-1.5 text-[13px] font-semibold" style={{ color: '#4a4a55' }}>
            Preparing your report…
          </p>
        </div>
      </div>
    </div>
  )
}
