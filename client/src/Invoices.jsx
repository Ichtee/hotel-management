import { useState } from 'react';
import { dateLabel, money } from './api/client.js';
import { DataTable, Notice, PageHead, Screen, useApi, useScreen } from './ui.jsx';

export default function Invoices() {
  const list = useApi('/frontdesk/invoices?limit=100'); const sc = useScreen();
  if (sc.name === 'view') return <InvoiceDetail id={sc.id} onClose={sc.close} />;
  return <><PageHead title="Invoices" sub="Invoices generated at checkout. Open an invoice to review or print it." /><Notice error={list.error} />
    {list.loading ? <p className="muted">Loading invoices...</p> : <DataTable cols={['Invoice', 'Booking', 'Guest', 'Amount', 'Issued', '']} rows={(list.data || []).map((invoice) => [invoice.kind === 'supplementary' ? `${invoice.invoiceNumber} (supplementary)` : invoice.invoiceNumber, invoice.bookingId?.bookingReference || '—', invoice.bookingId?.guestName || 'Guest', money(invoice.totalAmount), dateLabel(invoice.issuedAt), <button className="btn sm" onClick={() => sc.go('view', invoice._id)}>View / print</button>])} />}
  </>;
}
function InvoiceDetail({ id, onClose }) {
  const invoice = useApi(`/frontdesk/invoices/${id}`); const i = invoice.data; const b = i?.bookingId;
  return <Screen title="Invoice" onClose={onClose}><div id="invoice-print">
    {invoice.loading ? <p>Loading invoice...</p> : invoice.error ? <Notice error={invoice.error} /> : <>
      {i.hotelName && <p><b>{i.hotelName}</b>{i.hotelAddress ? <><br /><span className="muted">{i.hotelAddress}</span></> : null}</p>}
      <h3>{i.invoiceNumber}{i.kind === 'supplementary' ? ' (supplementary)' : ''}</h3><p>{b?.guestName || 'Guest'} · {b?.guestPhone || ''}</p><p className="muted">Stay: {dateLabel(b?.checkInDate)} - {dateLabel(b?.checkOutDate)} · issued {dateLabel(i.issuedAt)}</p>
      {/* Ưu tiên dòng hóa đơn đã chốt; hóa đơn cũ dùng tổng tiền booking. */}
      <DataTable cols={['Item', 'Amount']} rows={i.lines?.length
        ? [...i.lines.map((l) => [i.kind === 'supplementary' ? `Damage / loss: ${l.name}` : l.name.replace(/Night of (\d{4}-\d{2}-\d{2})/, (_, d) => `Night of ${dateLabel(d)}`), money(l.amount)]), ['Total', money(i.totalAmount)], ...(i.kind === 'supplementary' ? [] : [['Paid (deposit and front desk)', money(i.paidAmount ?? i.totalAmount)], ['Balance', money(i.balance ?? 0)]])]
        : [['Room charges', money(b?.roomAmount)], ['Additional services', money(b?.serviceAmount)], ...(b?.feeAmount ? [['Fees', money(b.feeAmount)]] : []), ...(b?.services || []).map((s) => [`${s.name} x${s.quantity}`, money(s.amount)]), ['Total paid', money(i.totalAmount)]]} />
    </>}
  </div><div className="modal-actions"><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => window.print()} disabled={!i}>Print</button></div></Screen>;
}
