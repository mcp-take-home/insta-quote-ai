import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createClient } from '@nghien-ot/rux'
import { DocumentResponseSchema, type DocumentResponse, type Evidence, type SourcedText } from '@insta-quote/shared'
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
      <p className="lede">Upload a quote PDF. Extracted values include their page and source text; uncertain table rows are marked for review.</p>
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

type CompletedDocument = Extract<DocumentResponse, { status: 'completed' }>

function SourcedTextList({ values }: { values: SourcedText[] }) {
  return <ul className="sourced-text-list">{values.map((field, index) => <li key={`${field.value}-${index}`}><p>{field.value}</p><Source evidence={field.evidence} /></li>)}</ul>
}

function displayLabel(key: string) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
}

type DocumentNote = CompletedDocument['notes'][number]

function NoteSource({ note }: { note: DocumentNote }) {
  const page = note.evidence?.page ?? note.page
  const line = note.evidence?.line ?? note.line
  const sourceText = note.evidence?.sourceText ?? note.sourceText
  const contextText = note.evidence?.contextText ?? note.contextText
  const lines = note.lines?.length ? note.lines : undefined
  if (page === undefined && line === undefined && !lines && !sourceText && !contextText) return null
  const location = page !== undefined ? `Page ${page}` : ''
  const lineLabel = lines ? `lines ${lines.join(', ')}` : line !== undefined ? `line ${line}` : ''
  return <div className="note-source">
    {(location || lineLabel || sourceText) && <p className="source">{[location, lineLabel].filter(Boolean).join(' · ')}{sourceText && <>{location || lineLabel ? ' · ' : ''}<q>{sourceText}</q></>}</p>}
    {contextText && <p className="context">Context: <q>{contextText}</q></p>}
  </div>
}

function NotesList({ notes }: { notes: DocumentNote[] }) {
  return <ul className="notes-list">{notes.map((note, index) => (
    <li className={note.error ? 'note-error' : undefined} key={`${note.value}-${index}`}>
      <p className="note-value">{note.value}</p>
      {note.error && note.error.message !== note.value && <p className="note-error-message">{note.error.message}</p>}
      <NoteSource note={note} />
    </li>
  ))}</ul>
}

function notePage(note: DocumentNote) {
  return note.evidence?.page ?? note.page
}

function PageDetails({ details, notes, page }: { details: CompletedDocument['details']; notes: DocumentNote[]; page: number }) {
  const fields = Object.entries(details)
    .map(([key, values]) => [key, values.filter((value) => value.evidence.page === page)] as const)
    .filter(([, values]) => values.length > 0)

  return <section className="document-details" aria-labelledby={`details-${page}-title`}>
    <h4 id={`details-${page}-title`}>Details</h4>
    {fields.length > 0 ? <dl className="details-list">
      {fields.map(([key, values]) => <div className="detail-field" key={key}>
        <dt>{displayLabel(key)}</dt>
        <dd><SourcedTextList values={values} /></dd>
      </div>)}
    </dl> : <p className="empty-note">No details were extracted for this page.</p>}
    {notes.length > 0 && <section className="notes" aria-label={`Notes for page ${page}`}><h5>Notes</h5><NotesList notes={notes} /></section>}
  </section>
}

function ItemList({ items, label = 'Extracted items' }: { items: CompletedDocument['items']; label?: string }) {
  if (!items.length) return <p className="empty-note">No line items were extracted.</p>
  return (
    <div className="items-table-wrap" role="region" aria-label={label} tabIndex={0}>
      <table className="items-table">
        <thead><tr><th scope="col">Description</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Line total</th></tr></thead>
        <tbody>{items.map((item, index) => (
          <tr className={item.error ? 'item-error' : undefined} title={item.error?.message} key={`${item.description ?? item.error?.code ?? 'item'}-${index}`}>
            <th scope="row">
              {item.description ?? 'Description unavailable'}
              {item.error && <p className="item-error-message">{item.error.message}</p>}
              <Source evidence={item.evidence} />
            </th>
            <td>{item.quantity ? <>{item.quantity.value.toLocaleString(undefined, { maximumFractionDigits: 4 })}<Source evidence={item.quantity.evidence} /></> : '—'}</td>
            <td>{item.unitPrice ? <>{`$${item.unitPrice.value.toFixed(2)}`}<Source evidence={item.unitPrice.evidence} /></> : '—'}</td>
            <td>{item.lineTotal ? <>{`$${item.lineTotal.value.toFixed(2)}`}<Source evidence={item.lineTotal.evidence} /></> : '—'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function PageGroupedItems({ document }: { document: CompletedDocument }) {
  const pages = Array.from(new Set([
    ...Array.from({ length: document.pageCount ?? 0 }, (_, index) => index + 1),
    ...Object.values(document.details).flatMap((values) => values.map((value) => value.evidence.page)),
    ...document.items.map((item) => item.evidence.page),
    ...document.notes.map(notePage).filter((page): page is number => page !== undefined),
  ])).sort((a, b) => a - b)

  return <section className="result-section" aria-labelledby="items-title">
    <h2 id="items-title">Extracted items <span className="count">{document.items.length}</span></h2>
    {pages.map((page) => {
      const items = document.items.filter((item) => item.evidence.page === page)
      const notes = document.notes.filter((note) => notePage(note) === page)
      return <section className="page-group" key={page} aria-labelledby={`page-${page}-title`}>
        <h3 id={`page-${page}-title`}>Page {page}</h3>
        <PageDetails details={document.details} notes={notes} page={page} />
        <h4 className="page-items-heading">Items <span className="count">{items.length}</span></h4>
        {items.length ? <ItemList items={items} label={`Extracted items on page ${page}`} /> : <p className="empty-note">No line items on this page.</p>}
      </section>
    })}
    {document.notes.some((note) => notePage(note) === undefined) && <section className="unpaged-notes" aria-label="Notes without page reference">
      <h3>Notes without page reference</h3>
      <NotesList notes={document.notes.filter((note) => notePage(note) === undefined)} />
    </section>}
    {pages.length === 0 && <ItemList items={[]} />}
  </section>
}

function DocumentPage() {
  const { id = '' } = useParams()
  const [activeTab, setActiveTab] = useState<'items' | 'json'>('items')
  const [copyStatus, setCopyStatus] = useState('')
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
  const completed = document.data?.status === 'completed' ? document.data : undefined
  const jsonText = completed ? JSON.stringify(completed, null, 2) : ''

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(jsonText)
      setCopyStatus('JSON copied.')
    } catch {
      setCopyStatus('Could not copy JSON. Select and copy it from this panel.')
    }
  }

  function downloadJson() {
    const url = URL.createObjectURL(new Blob([jsonText], { type: 'application/json' }))
    const link = window.document.createElement('a')
    link.href = url
    link.download = `document-${id}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
    const currentIndex = tabs.indexOf(event.currentTarget)
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : event.key === 'ArrowRight' ? (currentIndex + 1) % tabs.length
          : event.key === 'ArrowLeft' ? (currentIndex - 1 + tabs.length) % tabs.length
            : -1
    if (nextIndex < 0) return
    event.preventDefault()
    const nextTab = tabs[nextIndex]
    setActiveTab(nextTab.id === 'items-tab' ? 'items' : 'json')
    nextTab.focus()
  }

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
      {completed && (
        <>
          <p className="complete-note" role="status">Review complete. Extracted items and page details are listed below.</p>
          <div className="result-tabs" role="tablist" aria-label="Document result">
            <button type="button" id="items-tab" role="tab" aria-selected={activeTab === 'items'} aria-controls="items-panel" tabIndex={activeTab === 'items' ? 0 : -1} onClick={() => setActiveTab('items')} onKeyDown={handleTabKeyDown}>
              <svg className="control-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m2.5 3.5 1 1 1.5-1.5M7 3.5h6.5m-11 4 1 1L5 7m2 1h6.5m-11 4 1 1L5 11.5m2 0h6.5" /></svg>
              <span>Extracted items</span>
            </button>
            <button type="button" id="json-tab" role="tab" aria-selected={activeTab === 'json'} aria-controls="json-panel" tabIndex={activeTab === 'json' ? 0 : -1} onClick={() => setActiveTab('json')} onKeyDown={handleTabKeyDown}>
              <svg className="control-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M6 2.5H5A1.5 1.5 0 0 0 3.5 4v2A2.5 2.5 0 0 1 2 8a2.5 2.5 0 0 1 1.5 2v2A1.5 1.5 0 0 0 5 13.5h1m4-11h1A1.5 1.5 0 0 1 12.5 4v2A2.5 2.5 0 0 0 14 8a2.5 2.5 0 0 0-1.5 2v2a1.5 1.5 0 0 1-1.5 1.5h-1" /></svg>
              <span>JSON response</span>
            </button>
          </div>
          <section id="items-panel" role="tabpanel" aria-labelledby="items-tab" tabIndex={0} hidden={activeTab !== 'items'}>
            <PageGroupedItems document={completed} />
          </section>
          <section id="json-panel" role="tabpanel" aria-labelledby="json-tab" tabIndex={0} hidden={activeTab !== 'json'}>
            <div className="json-actions">
              <button type="button" onClick={copyJson}>
                <svg className="control-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><rect x="5.5" y="5.5" width="8" height="9" rx="1.25" /><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v7A1.5 1.5 0 0 0 4 12.5h1.5" /></svg>
                <span>Copy JSON</span>
              </button>
              <button type="button" onClick={downloadJson}>
                <svg className="control-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M8 2.5v7m0 0 2.5-2.5M8 9.5 5.5 7M3 11.5v1A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-1" /></svg>
                <span>Download JSON</span>
              </button>
            </div>
            <p className="sr-only" role="status" aria-live="polite">{copyStatus}</p>
            <pre className="json-response"><code>{jsonText}</code></pre>
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
