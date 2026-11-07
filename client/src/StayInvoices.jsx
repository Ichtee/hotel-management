import { useState } from "react";
import { api, money, dateLabel } from "./api/client.js";
import { Notice, useApi } from "./ui.jsx";
import "./stay.css";

export default function StayInvoices({ bookingId, canGenerate = false }) {
  const s = useApi(`/bookings/${bookingId}/invoices`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/frontdesk/bookings/${bookingId}/invoices`, {
        method: "POST",
        body: {},
      });
      s.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const print = (id) => {
    setSelected(id);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };
  return (
    <section className="stay-invoices">
      <h3>Hóa đơn</h3>
      <Notice error={s.error || error} />
      {s.loading && <p>Đang tải hóa đơn…</p>}
      {!s.loading && !s.error && !s.data?.length && <p>Chưa có hóa đơn.</p>}
      {canGenerate && (
        <button className="btn" disabled={busy} onClick={generate}>
          {busy ? "Đang phát hành…" : "Phát hành / tải lại hóa đơn"}
        </button>
      )}
      {s.data?.map((invoice) => (
        <article
          key={invoice._id}
          className={`stay-invoice ${selected === invoice._id ? "print-selected" : ""}`}
        >
          <h3>{invoice.hotelName || "Hóa đơn lưu trữ"}</h3>
          <p>{invoice.hotelAddress}</p>
          <p>
            <b>{invoice.invoiceNumber || invoice._id}</b> ·{" "}
            {invoice.type === "supplementary" ? "Bổ sung" : "Lưu trú"} ·{" "}
            {dateLabel(invoice.issuedAt)}
          </p>
          <p>
            {invoice.guestName} · {invoice.bookingReference}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nội dung</th>
                  <th>Số lượng</th>
                  <th>Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines?.map((line, i) => (
                  <tr key={i}>
                    <td>{line.description}</td>
                    <td>{line.quantity ?? "—"}</td>
                    <td>{money(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <b>Tổng: {money(invoice.totalAmount)}</b> · Đã thu:{" "}
            {money(invoice.paidAmount)} · Còn lại: {money(invoice.balance)}
          </p>
          {invoice.payments?.map((p, i) => (
            <p key={i}>
              {p.method} · {money(p.amount)} · {dateLabel(p.paidAt)}
            </p>
          ))}
          <button className="btn no-print" onClick={() => print(invoice._id)}>
            In hóa đơn
          </button>
        </article>
      ))}
    </section>
  );
}
