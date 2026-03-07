import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import SourceArticles from '@/components/dashboard/sources/articles/source-articles'

type PageProps = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: source } = await supabase
    .from('sources')
    .select('name')
    .eq('id', id)
    .single()

  return {
    title: source ? `${source.name} - Artikel | Newsgrap3r` : 'Artikel | Newsgrap3r',
  }
}

export default async function SourceArticlesPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(id)) {
    notFound()
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'

  return <SourceArticles sourceId={id} isAdmin={isAdmin} />
}
