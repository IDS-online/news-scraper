import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CategoryList from '@/components/dashboard/categories/category-list'

export const metadata = {
  title: 'Kategorien | Newsgrap3r',
}

export default async function CategoriesPage() {
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

  return <CategoryList isAdmin={isAdmin} />
}
