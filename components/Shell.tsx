'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

const NAV = [
  { to: '/',             label: 'Home',         icon: '🏠' },
  { to: '/reservations', label: 'Reservations', icon: '📅' },
  { to: '/listings',     label: 'Properties',   icon: '🏘️' },
  { to: '/messages',     label: 'Messages',     icon: '💬' }
]

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || null))
  }, [])

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 bg-slate-900 text-slate-100 flex flex-col p-4">
        <div className="flex items-center gap-2 pb-6 pt-2">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center font-bold">S</div>
          <span className="font-bold text-lg">STAYBOARD</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(item => {
            const active = path === item.to || (item.to !== '/' && path?.startsWith(item.to))
            return (
              <Link
                key={item.to}
                href={item.to}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  active ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto border-t border-white/10 pt-4">
          <div className="text-xs text-slate-400 truncate">{email}</div>
          <button onClick={signOut} className="text-xs text-slate-300 hover:text-white mt-1">Sign out</button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-8">{children}</div>
      </main>
    </div>
  )
}
