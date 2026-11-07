import { useState } from 'react';
import { dateLabel, money } from './api/client.js';
import { DataTable, Modal, Notice, PageHead, useApi } from './ui.jsx';

export default function Invoices() {
  const list = useApi('/frontdesk/invoices?limit=100'); const [id, setId] = useState(null);
  return <><PageHead title="Invoices" sub="Invoices generated at checkout. Open an invoice to review or print it." /><Notice error={list.error} />
    {list.loading ? <p className="muted">Loading invoices...</p> : <DataTable cols={['Invoice', 'Booking', 'Guest', 'Amount', 'Issued', '']} rows={(list.data || []).map((invoice) => [invoice.invoiceNumber, invoice.bookingId?.bookingReference || '—', invoice.bookingId?.guestName || 'Guest', money(invoice.totalAmount), dateLabel(invoice.issuedAt), <button className="btn sm" onClick={() => setId(invoice._id)}>View / print</button>])} />}
    {id && <InvoiceDetail id={id} onClose={() => setId(null)} />}
  </>;
}
function InvoiceDetail({ id, onClose }) {
  const invoice = useApi(`/frontdesk/invoices/${id}`); const i = invoice.data; const b = i?.bookingId;
  return <Modal title="Invoice" onClose={onClose}><div id="invoice-print">
    {invoice.loading ? <p>Loading invoice...</p> : invoice.error ? <Notice error={invoice.error} /> : <><h3>{i.invoiceNumber}</h3><p>{b?.guestName || 'Guest'} · {b?.guestPhone || ''}</p><p className="muted">Stay: {dateLabel(b?.checkInDate)} - {dateLabel(b?.checkOutDate)}</p><DataTable cols={['Item', 'Amount']} rows={[["Room charges", money(b?.roomAmount)], ["Additional services", money(b?.serviceAmount)], ...(b?.feeAmount ? [["Late check-out fee", money(b.feeAmount)]] : []), ...(b?.services || []).map((s) => [`${s.name} x${s.quantity}`, money(s.amount)]), ["Total paid", money(i.totalAmount)]]} /></>}
  </div><div className="modal-actions"><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => window.print()} disabled={!i}>Print</button></div></Modal>;
}
