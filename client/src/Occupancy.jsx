import { useState } from 'react';
import { DataTable, Notice, PageHead, useApi } from './ui.jsx';

const day = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + offset * 864e5));

export default function Occupancy() {
  const [from, setFrom] = useState(day(-29));
  const [to, setTo] = useState(day(0));
  const report = useApi(`/reports/occupancy?from=${from}&to=${to}`);
  const d = report.data;
  return <>
    <PageHead title="Occupancy" sub="Occupied room-nights divided by rooms available for sale in the selected period." />
    <form className="chips" onSubmit={(event) => event.preventDefault()}><label>From <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label>To <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label></form>
    <Notice error={report.error} />
    {report.loading ? <p className="muted">Loading occupancy...</p> : d && <>
      <div className="kpis"><div className="kpi"><p>Occupancy rate</p><strong>{d.totals.rate}%</strong><small>{d.from} to {d.to}</small></div><div className="kpi"><p>Occupied room-nights</p><strong>{d.totals.occupiedRoomNights}</strong></div><div className="kpi"><p>Available room-nights</p><strong>{d.totals.availableRoomNights}</strong></div></div>
      <DataTable cols={['Date', 'Occupied', 'Available', 'Rate']} rows={d.series.map((row) => [row.date, String(row.occupiedRoomNights), String(row.availableRoomNights), `${row.rate}%`])} />
    </>}
  </>;
}
