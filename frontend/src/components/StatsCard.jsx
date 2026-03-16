export default function StatsCard({ icon: Icon, label, value, color = 'primary', sub, extra }) {
  const colorMap = {
    primary: 'bg-primary-50 text-primary-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    teal: 'bg-teal-50 text-teal-600',
  }

  return (
    <div className="card flex items-start gap-3 sm:gap-4">
      <div className={`p-2 sm:p-3 rounded-lg shrink-0 ${colorMap[color]}`}>
        <Icon size={20} className="sm:w-[22px] sm:h-[22px]" />
      </div>
      <div className="min-w-0">
        <p className="text-xs sm:text-sm text-gray-500 font-medium">{label}</p>
        <div className="flex items-baseline gap-2 mt-0.5">
          <p className="text-lg sm:text-2xl font-bold text-gray-900">{value}</p>
          {extra}
        </div>
        {sub && <p className="text-[10px] sm:text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    </div>
  )
}
