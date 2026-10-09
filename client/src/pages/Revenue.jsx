import { useState } from "react";
import {
  Download,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
} from "lucide-react";
import { money, inputDate } from "../api/client";
import {
  useResource,
  PageHeader,
  ErrorBanner,
  Loading,
  Empty,
  Field,
  Pagination,
} from "../components/UI";
function Chart({ series }) {
  const values = series.map((r) => r.net);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const h = 180;
  const w = 860;
  const y = (v) => 20 + ((max - v) / (max - min)) * h;
  const x = (i) => 12 + (i / Math.max(1, values.length - 1)) * (w - 24);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const compact = (value) =>
    new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  return (
    <div className="chart-wrap">
      <div className="chart-scale">
        <span>{compact(max)}</span>
        <span>{compact((max + min) / 2)}</span>
        <span>{compact(min)}</span>
      </div>
      <div className="chart-body">
        <svg
          viewBox={`0 0 ${w} 220`}
          role="img"
          aria-label="Net revenue trend in VND. Exact values are available in the table below."
          preserveAspectRatio="none"
        >
          <line x1="0" x2={w} y1="20" y2="20" className="chart-grid" />
          <line x1="0" x2={w} y1="110" y2="110" className="chart-grid" />
          <line x1="0" x2={w} y1="200" y2="200" className="chart-grid" />
          <line x1="0" x2={w} y1={y(0)} y2={y(0)} className="chart-zero" />
          <polygon
            points={`${x(0)},${y(0)} ${points} ${x(values.length - 1)},${y(0)}`}
            className="chart-fill"
          />
          <polyline points={points} className="chart-line" />
          {values.length <= 31 &&
            values.map((v, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(v)}
                r="3.5"
                className="chart-point"
              >
                <title>
                  {series[i].date}: {money(v)}
                </title>
              </circle>
            ))}
        </svg>
        <div className="chart-dates">
          <span>{series[0]?.date}</span>
          <span>{series[Math.floor(series.length / 2)]?.date}</span>
          <span>{series.at(-1)?.date}</span>
        </div>
      </div>
    </div>
  );
}
export default function Revenue() {
  const today = inputDate(new Date());
  const [range, setRange] = useState({
    from: `${today.slice(0, 7)}-01`,
    to: today,
    groupBy: "day",
  });
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const query = new URLSearchParams(range).toString();
  const report = useResource(`/reports/revenue?${query}`);
  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/revenue?${query}&format=csv`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error.message);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `revenue-${range.from}-${range.to}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e);
    } finally {
      setExporting(false);
    }
  }
  const data = report.data;
  return (
    <>
      <PageHeader
        eyebrow="YOUR HOTEL / PERFORMANCE"
        title="Revenue report"
        description="The full picture, down to the last detail. All amounts in VND."
        action={
          <button
            className="button secondary"
            disabled={report.loading || !!report.error || exporting}
            onClick={exportCsv}
          >
            <Download size={17} />
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        }
      />
      <form
        className="report-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const b = Object.fromEntries(new FormData(e.currentTarget));
          setRange(b);
          setPage(1);
        }}
      >
        <CalendarDays size={20} />
        <Field
          label="From"
          name="from"
          type="date"
          required
          defaultValue={range.from}
        />
        <Field
          label="To"
          name="to"
          type="date"
          required
          defaultValue={range.to}
        />
        <Field label="Group by" name="groupBy" defaultValue="day">
          <option value="day">Day</option>
          <option value="month">Month</option>
        </Field>
        <button className="button primary" type="submit">
          Apply period
        </button>
      </form>
      <ErrorBanner
        error={error || report.error}
        retry={report.error ? report.reload : undefined}
      />
      {report.loading ? (
        <Loading />
      ) : (
        !report.error &&
        data && (
          <>
            <div className="revenue-summary">
              <div className="net-revenue">
                <p className="eyebrow">NET REVENUE</p>
                <strong>{money(data.totals.net)}</strong>
                <span>Receipts less completed refunds</span>
              </div>
              <div className="revenue-support">
                <div>
                  <span>
                    <ArrowDownLeft size={17} />
                    Payments received
                  </span>
                  <strong>{money(data.totals.received)}</strong>
                  <small>
                    {data.totals.paymentCount} successful transactions
                  </small>
                </div>
                <div>
                  <span>
                    <ArrowUpRight size={17} />
                    Refunds completed
                  </span>
                  <strong>{money(data.totals.refunded)}</strong>
                  <small>{data.totals.refundCount} completed refunds</small>
                </div>
              </div>
            </div>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Revenue over time</h2>
                  <p>
                    {data.from} to {data.to} · Vietnam time (UTC+7)
                  </p>
                </div>
                <span className="chart-legend">
                  <i />
                  Net revenue
                </span>
              </div>
              {!data.totals.paymentCount && !data.totals.refundCount ? (
                <Empty
                  title="No transactions in this period"
                  text="Try another date range. Only completed financial transactions appear here."
                />
              ) : (
                <Chart series={data.series} />
              )}
            </section>
            <section className="panel data-panel report-table">
              <div className="panel-heading">
                <div>
                  <h2>Transaction summary</h2>
                  <p>
                    Grouped by {data.groupBy}. Refunds are counted on their
                    processing date.
                  </p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th className="numeric">Payments</th>
                      <th className="numeric">Received</th>
                      <th className="numeric">Refunded</th>
                      <th className="numeric">Net revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.series.slice((page - 1) * 10, page * 10).map((r) => (
                      <tr key={r.date}>
                        <td>{r.date}</td>
                        <td className="numeric">{r.paymentCount}</td>
                        <td className="numeric">{money(r.received)}</td>
                        <td className="numeric">{money(r.refunded)}</td>
                        <td
                          className={`numeric ${r.net < 0 ? "danger-text" : ""}`}
                        >
                          <strong>{money(r.net)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Total</th>
                      <td className="numeric">{data.totals.paymentCount}</td>
                      <td className="numeric">{money(data.totals.received)}</td>
                      <td className="numeric">{money(data.totals.refunded)}</td>
                      <td className="numeric">{money(data.totals.net)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <Pagination
                meta={{
                  total: data.series.length,
                  page,
                  limit: 10,
                  pages: Math.max(1, Math.ceil(data.series.length / 10)),
                }}
                setPage={setPage}
              />
            </section>
            <p className="below-panel">
              Successful payments − completed refunds. Pending, failed and
              cancelled transactions are excluded.
            </p>
          </>
        )
      )}
    </>
  );
}
