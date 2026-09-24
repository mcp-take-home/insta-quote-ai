import { useState, type FormEvent } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createClient } from '@nghien-ot/rux'
import { DocumentResponseSchema, type DocumentResponse, type Evidence, type SourcedNumber } from '@insta-quote/shared'
import './App.css'

class ApiError extends Error {}

const api = createClient({
  baseUrl: window.location.origin,
  endpoints: {
    getDocument: {
      method: 'GET',
      path: '/api/docs/:id[string]',
      response: DocumentResponseSchema,
    },
  },
})

async function readError(response: Response) {
  const body: unknown = await response.json().catch(() => null)
  if (body && typeof body === 'object' && 'error' in body) {
    const error = body.error
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  }
  return `The request failed (${response.status}). Please try again.`
}

async function uploadPdf(file: File) {
  const form = new FormData()
  form.set('file', file)
  // Rux JSON-serializes endpoint bodies; this endpoint requires multipart form data.
  const response = await fetch('/api/docs', { method: 'POST', body: form })
  if (!response.ok) throw new ApiError(await readError(response))
  return (await response.json()) as { id: string }
}

async function getDocument(id: string): Promise<DocumentResponse> {
  const result = await api.getDocument({ params: { id } })
  if (result.ok) return result.value
  if (result.error.type === 'http' && result.error.data && typeof result.error.data === 'object' && 'error' in result.error.data && typeof result.error.data.error === 'string') {
    throw new ApiError(result.error.data.error)
  }
  throw new ApiError(result.error.message)
}

function UploadPage() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [validationError, setValidationError] = useState('')
  const upload = useMutation({
    mutationFn: uploadPdf,
    onSuccess: ({ id }) => navigate(`/documents/${encodeURIComponent(id)}`),
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setValidationError('')
    if (!file) {
      setValidationError('Choose a PDF file to upload.')
      return
    }
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type !== '' && file.type !== 'application/pdf')) {
      setValidationError('Choose a PDF file. Other file types are not supported.')
      return
    }
    upload.mutate(file)
  }

  return (
    <main className="page">
      <header className="brand"><span className="brand-mark" aria-hidden="true">IQ</span><span>Insta Quote AI</span></header>
      <section className="intro" aria-labelledby="upload-title">
        <h1 id="upload-title">Turn a quote PDF into clear line items.</h1>
        <p className="lede">Upload a text based PDF. Every extracted number comes with its page and source text; anything uncertain stays in the attention list.</p>
      </section>
      <form className="upload-form" onSubmit={submit}>
        <label htmlFor="pdf-file">Choose a PDF</label>
        <input
          id="pdf-file"
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0] ?? null)
            setValidationError('')
            upload.reset()
          }}
          aria-describedby="file-help upload-error"
          disabled={upload.isPending}
        />
        <p id="file-help" className="hint">PDF files only. Maximum file size: 15 MB.</p>
        {(validationError || upload.isError) && <p id="upload-error" className="error" role="alert">{validationError || upload.error?.message || 'The upload failed. Please try again.'}</p>}
        <button className="primary-button" type="submit" disabled={upload.isPending}>
          {upload.isPending ? 'Uploading PDF…' : 'Upload and review'}
        </button>
      </form>
      <p className="privacy-note">Your document is processed locally for this assessment.</p>
    </main>
  )
}

type LineEvidence = Evidence & { line?: number }

function Source({ evidence }: { evidence: LineEvidence }) {
  return <p className="source">Page {evidence.page}{evidence.line !== undefined && ` · line ${evidence.line}`} · <q>{evidence.sourceText}</q></p>
}

function NumberField({ label, sourced }: { label: string; sourced: SourcedNumber }) {
  const displayValue = label === 'Quantity'
    ? sourced.value.toLocaleString(undefined, { maximumFractionDigits: 4 })
    : `$${sourced.value.toFixed(2)}`
  return (
    <div className="value-field">
      <dt>{label}</dt>
      <dd>{displayValue}</dd>
      <Source evidence={sourced.evidence} />
    </div>
  )
}

function ItemList({ items }: { items: Extract<DocumentResponse, { status: 'completed' }>['items'] }) {
  if (!items.length) return <p className="empty-note">No line items could be verified in this document.</p>
  return (
    <ol className="items-list">
      {items.map((item, index) => (
        <li className="item" key={`${item.description}-${index}`}>
          <h3>{item.description}</h3>
          {item.evidence && <Source evidence={item.evidence} />}
          <dl className="values">
            <NumberField label="Quantity" sourced={item.quantity} />
            <NumberField label="Unit price" sourced={item.unitPrice} />
            <NumberField label="Line total" sourced={item.lineTotal} />
          </dl>
        </li>
      ))}
    </ol>
  )
}

type MetadataKey = 'companyName' | 'documentType' | 'documentNumber' | 'deliveredTo' | 'orderedBy' | 'disclaimer'
type SourcedMetadata = { value: string; evidence: LineEvidence }
type DocumentMetadata = Partial<Record<MetadataKey, SourcedMetadata>>

const metadataFields: { key: MetadataKey; label: string }[] = [
  { key: 'companyName', label: 'Company name' },
  { key: 'documentType', label: 'Document type' },
  { key: 'documentNumber', label: 'Document number' },
  { key: 'deliveredTo', label: 'Delivered to' },
  { key: 'orderedBy', label: 'Ordered by' },
  { key: 'disclaimer', label: 'Disclaimer' },
]

function DocumentDetails({ metadata }: { metadata?: DocumentMetadata }) {
  if (!metadata) {
    return (
      <section className="result-section document-details" aria-labelledby="details-title">
        <h2 id="details-title">Document details</h2>
        <p className="metadata-unavailable">Details unavailable for this earlier upload.</p>
      </section>
    )
  }

  return (
    <section className="result-section document-details" aria-labelledby="details-title">
      <h2 id="details-title">Document details</h2>
      <dl className="metadata-grid">
        {metadataFields.map(({ key, label }) => {
          const field = metadata?.[key]
          return (
            <div className="metadata-field" key={key}>
              <dt>{label}</dt>
              <dd className={field ? undefined : 'missing-value'}>
                {field?.value ?? 'Not found in document'}
                {field && <Source evidence={field.evidence} />}
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

function RefusalList({ refusals }: { refusals: Extract<DocumentResponse, { status: 'completed' }>['refusals'] }) {
  if (!refusals.length) return <p className="empty-note">No items need attention.</p>
  return (
    <ul className="refusals-list">
      {refusals.map((refusal, index) => {
        const lines = refusal.lines?.length ? refusal.lines : undefined
        const location = refusal.page !== undefined
          ? `Page ${refusal.page}${lines ? ` · lines ${lines.join(', ')}` : refusal.line !== undefined ? ` · line ${refusal.line}` : ''}`
          : lines ? `Lines ${lines.join(', ')}` : refusal.line !== undefined ? `Line ${refusal.line}` : ''
        return (
          <li className="refusal" key={`${refusal.code}-${refusal.page ?? 'document'}-${index}`}>
            <p>{refusal.message}</p>
            {location && <p className="source">{location}</p>}
            {refusal.sourceText && <p className="source">Source: <q>{refusal.sourceText}</q></p>}
            {refusal.contextText && <p className="context">Context: <q>{refusal.contextText}</q></p>}
          </li>
        )
      })}
    </ul>
  )
}

function DocumentPage() {
  const { id = '' } = useParams()
  const document = useQuery({
    queryKey: ['document', id],
    queryFn: () => getDocument(id),
    refetchInterval: (query) => {
      if (query.state.error) return false
      const status = query.state.data?.status
      return status === 'completed' || status === 'failed' ? false : 1000
    },
    retry: false,
  })

  return (
    <main className="page result-page">
      <header className="brand"><span className="brand-mark" aria-hidden="true">IQ</span><span>Insta Quote AI</span></header>
      <Link className="back-link" to="/">← Upload another PDF</Link>
      <section className="result-heading" aria-labelledby="result-title">
        <h1 id="result-title">Your document</h1>
        <p className="document-id">Reference {id}</p>
      </section>

      {document.isPending && <p className="status-message" role="status">Waiting to process document…</p>}
      {document.isError && <div className="error-panel" role="alert"><h2>Could not load this document</h2><p>{document.error.message}</p></div>}
      {document.data?.status === 'queued' && <p className="status-message" role="status">Waiting to process document…</p>}
      {document.data?.status === 'processing' && <p className="status-message" role="status">Reading and validating document…</p>}
      {document.data?.status === 'failed' && (
        <div className="error-panel" role="alert"><h2>Processing could not be completed</h2><p>{document.data.error.message}</p></div>
      )}
      {document.data?.status === 'completed' && (
        <>
          <p className="complete-note" role="status">Review complete. Verified items and anything that needs attention are listed below.</p>
          <DocumentDetails metadata={document.data.metadata} />
          <section className="result-section" aria-labelledby="items-title">
            <h2 id="items-title">Extracted items <span className="count">{document.data.items.length}</span></h2>
            <ItemList items={document.data.items} />
          </section>
          <section className="result-section attention" aria-labelledby="refusals-title">
            <h2 id="refusals-title">Needs attention <span className="count">{document.data.refusals.length}</span></h2>
            <RefusalList refusals={document.data.refusals} />
          </section>
        </>
      )}
    </main>
  )
}

function App() {
  return <Routes><Route path="/" element={<UploadPage />} /><Route path="/documents/:id" element={<DocumentPage />} /><Route path="*" element={<main className="page"><h1>Page not found</h1><Link to="/">Upload a PDF</Link></main>} /></Routes>
}

export default App
