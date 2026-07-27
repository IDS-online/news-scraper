'use client'

import { useSyncExternalStore, useCallback } from 'react'
import type { ViewMode } from '@/components/dashboard/sources/articles/view-toggle'

const VIEW_MODE_KEY = 'newsgrap3r-view-mode'

// Module-level subscriber set so a change in one component instance re-renders
// every other consumer in the same tab (the `storage` event only fires across
// tabs, not within the tab that made the write).
const listeners = new Set<() => void>()

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

/**
 * View-mode state persisted to localStorage.
 *
 * Uses useSyncExternalStore so the value is read from an external store the
 * React-idiomatic way — no setState-in-effect, and getServerSnapshot returns
 * the SSR default ('list') to avoid a hydration mismatch.
 */
export function usePersistedViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const mode = useSyncExternalStore<ViewMode>(
    subscribe,
    readViewMode,
    () => 'list'
  )

  const setMode = useCallback((next: ViewMode) => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, next)
    } catch {
      // localStorage may be unavailable — keep the UI responsive anyway.
    }
    listeners.forEach((notify) => notify())
  }, [])

  return [mode, setMode]
}
