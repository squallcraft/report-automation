import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

const ROW_HEIGHT = 33
const OVERSCAN = 20

export default function DataTable({
  columns, data, onRowClick, emptyMessage = 'No hay datos',
  sortable = false, columnFilters, onColumnFilterChange,
  maxHeight,
  onSort, externalSortKey, externalSortDir,
  // ── Selección múltiple opcional ──
  // Si `selectable` es true, se renderiza una columna izquierda con checkboxes.
  // El estado vive en el padre (Set de ids) para que persista al scrollear el virtualizer.
  selectable = false,
  selectedIds,
  onSelectionChange,
  getRowId = (row) => row?.id,
  isRowSelectable = () => true,
}) {
  const [localSortKey, setLocalSortKey] = useState(null)
  const [localSortDir, setLocalSortDir] = useState('asc')
  const parentRef = useRef(null)

  const isServerSort = !!onSort
  const activeSortKey = isServerSort ? externalSortKey : localSortKey
  const activeSortDir = isServerSort ? externalSortDir : localSortDir

  const handleSort = useCallback((key) => {
    if (!sortable) return
    if (key === 'actions' || key === 'acciones') return

    if (isServerSort) {
      const newDir = activeSortKey === key && activeSortDir === 'asc' ? 'desc' : 'asc'
      onSort(key, activeSortKey === key ? newDir : 'asc')
    } else {
      if (localSortKey === key) {
        setLocalSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setLocalSortKey(key)
        setLocalSortDir('asc')
      }
    }
  }, [sortable, isServerSort, activeSortKey, activeSortDir, onSort, localSortKey])

  const sorted = useMemo(() => {
    if (!sortable || isServerSort || !localSortKey || !data) return data
    return [...data].sort((a, b) => {
      let va = a[localSortKey]
      let vb = b[localSortKey]
      if (va == null) va = ''
      if (vb == null) vb = ''
      if (typeof va === 'number' && typeof vb === 'number') {
        return localSortDir === 'asc' ? va - vb : vb - va
      }
      const sa = String(va).toLowerCase()
      const sb = String(vb).toLowerCase()
      if (sa < sb) return localSortDir === 'asc' ? -1 : 1
      if (sa > sb) return localSortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [data, localSortKey, localSortDir, sortable, isServerSort])

  const displayData = isServerSort ? data : sorted

  const hasFilters = columnFilters && onColumnFilterChange
  const useVirtual = maxHeight && displayData && displayData.length > 100

  const rowVirtualizer = useVirtualizer({
    count: displayData?.length || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    enabled: !!useVirtual,
    // Medir la altura REAL de cada fila renderizada (las descripciones largas
    // wrapean a 2-3 líneas). Sin esto, el virtualizer asume todas miden 33px
    // y los offsets quedan desincronizados → "salto" visual al scrollear.
    measureElement:
      typeof window !== 'undefined' && navigator.userAgent.indexOf('Firefox') === -1
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
  })

  const virtualItems = useVirtual ? rowVirtualizer.getVirtualItems() : null
  const totalSize = useVirtual ? rowVirtualizer.getTotalSize() : 0
  const paddingTop = virtualItems?.length > 0 ? virtualItems[0].start : 0
  const paddingBottom = virtualItems?.length > 0
    ? totalSize - virtualItems[virtualItems.length - 1].end
    : 0

  const scrollStyle = maxHeight ? { maxHeight, overflowY: 'auto' } : {}

  // ── Selección múltiple ──
  const selectableRows = useMemo(
    () => (selectable && displayData ? displayData.filter(isRowSelectable) : []),
    [selectable, displayData, isRowSelectable],
  )
  const selectedCount = useMemo(() => {
    if (!selectable || !selectedIds) return 0
    return selectableRows.reduce((acc, r) => acc + (selectedIds.has(getRowId(r)) ? 1 : 0), 0)
  }, [selectable, selectedIds, selectableRows, getRowId])
  const allChecked = selectable && selectableRows.length > 0 && selectedCount === selectableRows.length
  const someChecked = selectable && selectedCount > 0 && selectedCount < selectableRows.length

  const headerCheckboxRef = useRef(null)
  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someChecked
  }, [someChecked])

  const toggleAll = useCallback(() => {
    if (!onSelectionChange) return
    const next = new Set(selectedIds || [])
    if (allChecked) {
      selectableRows.forEach((r) => next.delete(getRowId(r)))
    } else {
      selectableRows.forEach((r) => next.add(getRowId(r)))
    }
    onSelectionChange(next)
  }, [allChecked, onSelectionChange, selectedIds, selectableRows, getRowId])

  const toggleOne = useCallback((row) => {
    if (!onSelectionChange) return
    const id = getRowId(row)
    if (id == null) return
    const next = new Set(selectedIds || [])
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectionChange(next)
  }, [onSelectionChange, selectedIds, getRowId])

  const totalCols = columns.length + (selectable ? 1 : 0)

  if (!data || data.length === 0) {
    return (
      <div className="card text-center py-12 text-gray-500">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="card overflow-hidden p-0 h-full flex flex-col">
      <div
        ref={parentRef}
        className={`overflow-x-auto -mx-4 sm:mx-0 ${maxHeight ? '' : 'flex-1 overflow-y-auto'}`}
        style={scrollStyle}
      >
        <table className="w-full text-xs sm:text-sm min-w-[480px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-gray-200 bg-gray-50">
              {selectable && (
                <th className="px-2 py-2 sm:py-3 bg-gray-50 w-8">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="Seleccionar todos"
                    title={allChecked ? 'Deseleccionar todos' : 'Seleccionar todos los visibles'}
                  />
                </th>
              )}
              {columns.map((col) => {
                const isSortable = sortable && col.key !== 'actions' && col.key !== 'acciones' && col.label
                const isActive = activeSortKey === col.key
                return (
                  <th
                    key={col.key}
                    onClick={() => isSortable && handleSort(col.key)}
                    className={`px-2 sm:px-4 py-2 sm:py-3 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider bg-gray-50
                      ${col.align === 'right' ? 'text-right' : ''}
                      ${col.align === 'center' ? 'text-center' : ''}
                      ${isSortable ? 'cursor-pointer select-none hover:text-gray-900 hover:bg-gray-100 transition-colors' : ''}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {isSortable && (
                        isActive
                          ? (activeSortDir === 'asc' ? <ChevronUp size={14} className="text-primary-600" /> : <ChevronDown size={14} className="text-primary-600" />)
                          : <ChevronsUpDown size={14} className="text-gray-300" />
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
            {hasFilters && (
              <tr className="border-b border-gray-200 bg-gray-50">
                {selectable && <th className="px-2 py-1.5 bg-gray-50 w-8" />}
                {columns.map((col) => {
                  const filter = columnFilters[col.key]
                  if (!filter) return <th key={col.key} className="px-2 py-1.5 bg-gray-50" />
                  return (
                    <th key={col.key} className="px-2 py-1.5 bg-gray-50">
                      {filter.type === 'select' ? (
                        <select
                          value={filter.value || ''}
                          onChange={(e) => onColumnFilterChange(col.key, e.target.value)}
                          className="w-full text-xs font-normal border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
                        >
                          <option value="">{filter.placeholder || 'Todos'}</option>
                          {(filter.options || []).map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={filter.value || ''}
                          onChange={(e) => onColumnFilterChange(col.key, e.target.value)}
                          placeholder={filter.placeholder || 'Filtrar...'}
                          className="w-full text-xs font-normal border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
                        />
                      )}
                    </th>
                  )
                })}
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-gray-100">
            {useVirtual ? (
              <>
                {paddingTop > 0 && <tr aria-hidden="true"><td colSpan={totalCols} style={{ height: paddingTop, padding: 0, border: 0 }} /></tr>}
                {virtualItems.map((virtualRow) => {
                  const row = displayData[virtualRow.index]
                  const rowId = selectable ? getRowId(row) : null
                  const isSelected = selectable && rowId != null && selectedIds?.has(rowId)
                  const canSelect = selectable && isRowSelectable(row)
                  return (
                    <tr
                      key={row.id ?? virtualRow.index}
                      data-index={virtualRow.index}
                      ref={(node) => node && rowVirtualizer.measureElement(node)}
                      onClick={() => onRowClick?.(row)}
                      className={`transition-colors ${isSelected ? 'bg-primary-50/60' : ''} ${onRowClick ? 'cursor-pointer hover:bg-primary-50' : 'hover:bg-gray-50'}`}
                    >
                      {selectable && (
                        <td className="px-2 py-1.5 sm:py-2 align-top w-8" onClick={(e) => e.stopPropagation()}>
                          {canSelect ? (
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                              checked={!!isSelected}
                              onChange={() => toggleOne(row)}
                              aria-label="Seleccionar fila"
                            />
                          ) : null}
                        </td>
                      )}
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`px-2 sm:px-3 py-1.5 sm:py-2 whitespace-nowrap text-xs sm:text-sm
                            ${col.align === 'right' ? 'text-right' : ''}
                            ${col.align === 'center' ? 'text-center' : ''}
                            ${col.className || ''}`}
                        >
                          {col.render ? col.render(row[col.key], row) : row[col.key]}
                        </td>
                      ))}
                    </tr>
                  )
                })}
                {paddingBottom > 0 && <tr aria-hidden="true"><td colSpan={totalCols} style={{ height: paddingBottom, padding: 0, border: 0 }} /></tr>}
              </>
            ) : (
              displayData.map((row, idx) => {
                const rowId = selectable ? getRowId(row) : null
                const isSelected = selectable && rowId != null && selectedIds?.has(rowId)
                const canSelect = selectable && isRowSelectable(row)
                return (
                  <tr
                    key={row.id || idx}
                    onClick={() => onRowClick?.(row)}
                    className={`transition-colors ${isSelected ? 'bg-primary-50/60' : ''} ${onRowClick ? 'cursor-pointer hover:bg-primary-50' : 'hover:bg-gray-50'}`}
                  >
                    {selectable && (
                      <td className="px-2 py-1.5 sm:py-2 w-8" onClick={(e) => e.stopPropagation()}>
                        {canSelect ? (
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                            checked={!!isSelected}
                            onChange={() => toggleOne(row)}
                            aria-label="Seleccionar fila"
                          />
                        ) : null}
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-2 sm:px-3 py-1.5 sm:py-2 whitespace-nowrap text-xs sm:text-sm
                          ${col.align === 'right' ? 'text-right' : ''}
                          ${col.align === 'center' ? 'text-center' : ''}
                          ${col.className || ''}`}
                      >
                        {col.render ? col.render(row[col.key], row) : row[col.key]}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
