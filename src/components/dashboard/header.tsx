'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, LogOut, Newspaper, Settings, BarChart2, Tags, Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DashboardHeaderProps {
  email: string
  role: string
}

const navLinks = [
  { href: '/dashboard/news', label: 'News', icon: Newspaper },
  { href: '/dashboard/statistics', label: 'Statistiken', icon: BarChart2 },
  { href: '/dashboard/categories', label: 'Kategorien', icon: Tags },
]

const adminLinks = [
  { href: '/dashboard/sources', label: 'Quellen', icon: Settings },
]

export default function DashboardHeader({ email, role }: DashboardHeaderProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const isAdmin = role === 'admin'
  const allLinks = isAdmin ? [...navLinks, ...adminLinks] : navLinks

  async function handleLogout() {
    setLoggingOut(true)
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <header className="bg-ids-dark text-white shadow-md sticky top-0 z-50">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex items-center justify-between h-14">
          {/* Brand */}
          <Link href="/dashboard" className="flex items-center gap-2.5 shrink-0">
            <Image
              src="/ids-logo.svg"
              alt="ids.online logo"
              width={60}
              height={20}
              className="h-5 w-auto"
              priority
            />
            <span className="text-xl font-bold">
              News<span className="text-ids-orange">grap3r</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 flex-1 ml-8">
            {allLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors',
                  pathname.startsWith(href)
                    ? 'bg-ids-orange text-ids-dark'
                    : 'text-ids-grey hover:text-white hover:bg-white/10'
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>

          {/* User menu */}
          <div className="hidden md:flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="flex items-center gap-2 text-ids-grey hover:text-white hover:bg-white/10 h-8 px-2"
                >
                  <span className="text-sm max-w-[180px] truncate">{email}</span>
                  {isAdmin && (
                    <Badge className="bg-ids-orange text-ids-dark text-[10px] px-1.5 py-0 h-4 font-bold rounded-full">
                      Admin
                    </Badge>
                  )}
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5">
                  <p className="text-xs text-muted-foreground truncate">{email}</p>
                  <p className="text-xs font-medium capitalize">{role}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="text-destructive focus:text-destructive cursor-pointer"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  {loggingOut ? 'Abmelden…' : 'Abmelden'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Mobile menu toggle */}
          <button
            className="md:hidden text-ids-grey hover:text-white p-1"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Menü öffnen"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <div className="md:hidden pb-3 border-t border-white/10 mt-1 pt-2 space-y-1">
            {allLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold transition-colors',
                  pathname.startsWith(href)
                    ? 'bg-ids-orange text-ids-dark'
                    : 'text-ids-grey hover:text-white hover:bg-white/10'
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
            <div className="pt-2 border-t border-white/10">
              <p className="px-3 py-1 text-xs text-ids-grey truncate">{email}</p>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex items-center gap-2 px-3 py-2 text-sm text-ids-pink hover:text-white w-full"
              >
                <LogOut className="h-4 w-4" />
                {loggingOut ? 'Abmelden…' : 'Abmelden'}
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
