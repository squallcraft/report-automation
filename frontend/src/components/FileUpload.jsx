import { useState, useRef } from 'react'
import { Upload, FileSpreadsheet, X } from 'lucide-react'

export default function FileUpload({ onUpload, loading, accept = '.xlsx,.xls' }) {
  const [file, setFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef()

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }

  const handleSubmit = () => {
    if (file) onUpload(file)
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all
          ${dragOver ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => setFile(e.target.files[0])}
        />
        <Upload size={40} className="mx-auto text-gray-400 mb-3" />
        <p className="text-sm font-medium text-gray-700">
          Arrastra el archivo Excel aquí o haz clic para seleccionar
        </p>
        <p className="text-xs text-gray-400 mt-1">Formatos: .xlsx, .xls</p>
      </div>

      {file && (
        <div className="flex items-center justify-between bg-primary-50 border border-primary-200 rounded-lg px-4 py-3">
          <div className="flex items-center gap-3">
            <FileSpreadsheet size={20} className="text-primary-600" />
            <div>
              <p className="text-sm font-medium text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setFile(null)} className="p-1 hover:bg-primary-100 rounded">
              <X size={16} className="text-gray-500" />
            </button>
            <button onClick={handleSubmit} disabled={loading} className="btn-primary text-sm">
              {loading ? 'Procesando...' : 'Procesar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
