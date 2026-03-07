import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import VisualSourceWizard from '@/components/dashboard/sources/wizard/visual-source-wizard'

export const metadata = {
  title: 'Visueller Einrichtungsassistent | Newsgrap3r',
}

export default async function VisualWizardPage() {
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

  if (profile?.role !== 'admin') {
    redirect('/dashboard/sources')
  }

  return <VisualSourceWizard />
}
