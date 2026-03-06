import { Newspaper } from 'lucide-react'

export default function NewsPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
      <div className="rounded-full bg-ids-ice p-5">
        <Newspaper className="h-10 w-10 text-ids-slate" />
      </div>
      <h2 className="text-xl font-bold text-ids-dark">News-Feed</h2>
      <p className="text-ids-slate text-sm max-w-xs">
        Das News-Dashboard wird in NEWS-7 implementiert.
      </p>
    </div>
  )
}
