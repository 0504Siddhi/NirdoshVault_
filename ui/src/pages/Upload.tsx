import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { UploadCloud, Trash2, Search, Loader2, AlertCircle, FileText, Image } from 'lucide-react';

// ─── File validation ──────────────────────────────────────────────
const ACCEPTED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'application/pdf',
]);
const ACCEPTED_EXT = new Set(['.png', '.jpg', '.jpeg', '.pdf']);

function getExt(filename: string) {
  return filename.slice(filename.lastIndexOf('.')).toLowerCase();
}

function validateFiles(files: File[]): { valid: File[]; errors: string[] } {
  const valid: File[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const ext = getExt(f.name);
    if (ACCEPTED_MIME.has(f.type) && ACCEPTED_EXT.has(ext)) {
      valid.push(f);
    } else {
      errors.push(`"${f.name}" is not supported. Only PNG, JPG, and PDF are allowed.`);
    }
  }
  return { valid, errors };
}

// ─── File preview helper ─────────────────────────────────────────
function FileIcon({ file }: { file: File }) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);

  if (preview) {
    return <img src={preview} alt={file.name} className="w-full h-20 object-cover rounded-lg mb-2" />;
  }
  const ext = getExt(file.name);
  if (ext === '.pdf') return <div className="w-full h-20 rounded-lg bg-red-500/10 flex items-center justify-center mb-2"><FileText size={32} className="text-red-400" /></div>;
  return <div className="w-full h-20 rounded-lg bg-slate-500/10 flex items-center justify-center mb-2"><Image size={32} className="text-slate-400" /></div>;
}

// ─── Pending file preview card ────────────────────────────────────
function PendingFileCard({ file, onRemove }: { file: File; onRemove: () => void }) {
  return (
    <div className="card p-3 relative">
      <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`} className="absolute top-2 right-2 z-10 min-h-11 min-w-11 text-slate-500 hover:text-red-400 p-0.5">
        <Trash2 size={12} />
      </button>
      <FileIcon file={file} />
      <div className="text-xs font-medium truncate" title={file.name}>{file.name}</div>
      <div className="text-[10px] text-slate-500">{(file.size / 1024).toFixed(0)} KB</div>
    </div>
  );
}

export default function Upload() {
  const [docs, setDocs] = useState<any[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const navigate = useNavigate();
  
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchDocs(); }, []);

  // ─── Real-time status polling ───────────────────────────────────
  useEffect(() => {
    const hasProcessing = docs.some(d => d.status === 'processing');
    if (hasProcessing && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const { data } = await api.get('/documents');
        const fresh = data.documents || [];
        setDocs(fresh);
        if (!fresh.some((d: any) => d.status === 'processing')) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      }, 2000);
    } else if (!hasProcessing && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [docs]);

  const fetchDocs = async () => {
    try {
      const { data } = await api.get('/documents');
      setDocs(data.documents || []);
    } catch (err) { console.error(err); }
  };

  // ─── Add files (from input or drop) ────────────────────────────
  const addFiles = useCallback((files: File[]) => {
    setFileErrors([]);
    const { valid, errors } = validateFiles(files);
    if (errors.length > 0) setFileErrors(errors);
    if (valid.length > 0) {
      setPendingFiles(prev => {
        const existing = new Set(prev.map(f => f.name));
        return [...prev, ...valid.filter(f => !existing.has(f.name))];
      });
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  // ─── Drag & Drop handlers ────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (uploading) return;
    addFiles(Array.from(e.dataTransfer.files));
  };

  // ─── Upload queued files in single batch ─────────────────────────
  const handleUpload = async () => {
    if (pendingFiles.length === 0 || uploading) return;
    const formData = new FormData();
    pendingFiles.forEach(f => formData.append('documents', f));
    setUploading(true);
    try {
      await api.post('/documents', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPendingFiles([]);
      await fetchDocs();
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Upload failed. Please try again.';
      setFileErrors(prev => [...prev, msg]);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/documents/${id}`);
      setDocs(docs.filter(d => d._id !== id));
    } catch (err) { console.error('Delete failed', err); }
  };

  const handleAnalyze = async () => {
    const readyDocs = docs.filter(d => d.status === 'ready');
    if (readyDocs.length < 2) { alert('Please upload at least 2 documents to proceed.'); return; }
    setAnalyzing(true);
    try {
      const { data } = await api.post('/analysis/analyze');
      navigate(`/report/${data._id}`);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Analysis failed. Please try again.');
    } finally { setAnalyzing(false); }
  };

  const readyCount = docs.filter(d => d.status === 'ready').length;
  const processingCount = docs.filter(d => d.status === 'processing').length;

  return (
    <div className="pt-24 px-6 max-w-4xl mx-auto min-h-screen relative z-10 pb-20">
      {/* Header */}
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-saffron-500 bg-saffron-500/10 border border-saffron-500/20 mb-3">
          📁 Document Upload
        </div>
        <h2 className="text-3xl font-bold mb-2">Upload documents for comparison</h2>
        <p className="text-slate-500">Upload 2–5 synthetic or redacted identity documents. The engine compares only shared fields and never treats one document as automatic legal truth.</p>
      </div>

      {/* Streamlined Info Banner */}
      <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center gap-3 mb-3 text-xs text-slate-700">
        <span className="text-blue-500 text-base shrink-0">ℹ️</span>
        <div>
          <strong className="text-navy-950">Active Templates:</strong> Optimized for Aadhaar, PAN, and certificates. Always use synthetic or redacted sample files.
        </div>
      </div>

      {/* Photo quality tip */}
      <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center gap-3 mb-6 text-xs text-slate-700">
        <span className="text-blue-500 text-base shrink-0">📷</span>
        <div>
          For best results, upload the <strong className="text-navy-950">original photo</strong> rather than one shared via WhatsApp or another chat app — those apps compress images and can reduce extraction accuracy.
        </div>
      </div>

      {/* File errors */}
      {fileErrors.length > 0 && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex gap-3 mb-6">
          <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            {fileErrors.map((err, i) => <p key={i} className="text-sm text-red-300">{err}</p>)}
          </div>
          <button onClick={() => setFileErrors([])} aria-label="Dismiss upload errors" className="text-red-400 hover:text-red-200 shrink-0">✕</button>
        </div>
      )}

      {/* Uploaded doc grid */}
      {docs.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-slate-500 uppercase tracking-wider">Uploaded Documents</h3>
            {processingCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-saffron-400">
                <Loader2 size={12} className="animate-spin" />
                Processing {processingCount} document{processingCount > 1 ? 's' : ''}…
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {docs.map(doc => (
              <div
                key={doc._id}
                className={`card p-4 relative transition-all ${
                  doc.status === 'ready' ? 'border-green-500/40 bg-green-500/5' :
                  doc.status === 'failed' ? 'border-red-500/30 bg-red-500/5' :
                  'border-saffron-500/20 bg-saffron-500/5'
                }`}
              >
                <button onClick={() => handleDelete(doc._id)} aria-label={`Remove ${doc.title}`} className="absolute top-2 right-2 min-h-11 min-w-11 text-slate-500 hover:text-red-400 p-1">
                  <Trash2 size={14} />
                </button>
                <div className="text-3xl mb-3">📄</div>
                <div className="font-semibold text-sm truncate pr-5" title={doc.title}>{doc.title}</div>
                <div className="text-xs mt-1 font-medium">
                  {doc.status === 'processing' && <span className="text-saffron-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" />Processing…</span>}
                  {doc.status === 'ready' && <span className="text-green-400">✓ Ready</span>}
                  {doc.status === 'failed' && (
                    <span className="text-red-400">
                      ✗{' '}
                      {doc.quality?.warnings?.length
                        ? doc.quality.warnings[0]
                        : "Couldn't extract readable information — try a clearer photo or a different file"}
                    </span>
                  )}
                </div>
                {doc.docType && doc.docType !== 'unknown' && (
                  <div className="text-[10px] mt-1 text-slate-500 capitalize">{doc.docType.replace(/_/g, ' ')}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending files queue (before upload) */}
      {pendingFiles.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold text-sm text-slate-500 uppercase tracking-wider mb-3">
            Ready to Upload ({pendingFiles.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
            {pendingFiles.map((f, i) => (
              <PendingFileCard key={i} file={f} onRemove={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} />
            ))}
          </div>
          <button onClick={handleUpload} disabled={uploading} className="btn btn-primary flex items-center gap-2">
            {uploading
              ? <><Loader2 size={16} className="animate-spin" /> Extracting Batch…</>
              : <><UploadCloud size={16} /> Upload {pendingFiles.length} File{pendingFiles.length > 1 ? 's' : ''}</>
            }
          </button>
        </div>
      )}

      {/* Progress bar during upload */}
      {uploading && (
        <div className="mb-6 rounded-xl border border-saffron-500/30 bg-saffron-500/10 p-4" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <Loader2 className="animate-spin text-saffron-500" aria-hidden="true" />
            <div>
              <p className="font-semibold">Extracting and validating document fields...</p>
              <p className="text-sm text-slate-600">Checking quality, reading fields and preparing documents for comparison.</p>
            </div>
          </div>
        </div>
      )}

      {/* Drop zone */}
      <div
        id="upload-dropzone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={uploading ? -1 : 0}
        aria-disabled={uploading}
        aria-describedby="upload-help"
        onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && !uploading) { event.preventDefault(); inputRef.current?.click(); } }}
        onClick={() => !uploading && inputRef.current?.click()}
        className={`card flex flex-col items-center justify-center p-12 border-2 border-dashed transition-all mb-8 text-center cursor-pointer ${
          isDragOver
            ? 'border-saffron-500/80 bg-saffron-500/10 scale-[1.01]'
            : uploading
            ? 'border-slate-600 opacity-60 cursor-not-allowed'
            : 'border-slate-300 hover:border-saffron-500/50 hover:bg-saffron-500/5'
        }`}
      >
        <UploadCloud
          size={48}
          className={`mb-4 transition-all ${isDragOver ? 'text-saffron-400 scale-110' : uploading ? 'text-saffron-400 animate-bounce' : 'text-slate-500 group-hover:text-saffron-400'}`}
        />
        <div className="text-lg font-bold mb-2">
          {isDragOver ? 'Drop files here!' : uploading ? 'Extracting your documents…' : 'Drag & Drop or Click to Select Files'}
        </div>
        <div className="text-sm text-slate-500">
          {uploading
            ? 'Extracting all documents in a single high-speed AI request.'
            : 'PNG, JPG, PDF · Max 10 MB · Files are previewed before upload'}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
          accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
          disabled={uploading}
        />
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-slate-200">
        <div className="text-sm text-slate-500">
          <span className="font-semibold text-slate-800">{readyCount}</span> document{readyCount !== 1 ? 's' : ''} ready · need at least 2 to analyse
        </div>
        <button
          id="run-analysis-btn"
          onClick={handleAnalyze}
          disabled={readyCount < 2 || analyzing || processingCount > 0}
          className="btn btn-primary w-full sm:w-auto"
        >
          {analyzing
            ? <><Loader2 size={18} className="animate-spin" /> Running Consensus Engine…</>
            : <><Search size={18} /> Run Consensus Analysis</>
          }
        </button>
      </div>
    </div>
  );
}