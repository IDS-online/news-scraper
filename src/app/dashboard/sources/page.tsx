import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SourceList from '@/components/dashboard/sources/source-list'

export const metadata = {
  title: 'Quellen-Verwaltung | Newsgrap3r',
}

export default async function SourcesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'

  return <SourceList isAdmin={isAdmin} />
}
