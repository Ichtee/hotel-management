import { useState } from "react";
import { Plus, Pencil, Trash2, Ticket } from "lucide-react";
import { api, dateLabel, inputDate, money } from "../api/client";
import {
  useResource,
  PageHeader,
  ErrorBanner,
  Success,
  Loading,
  Empty,
  SearchToolbar,
  Pagination,
  Modal,
  Field,
  Submit,
  Badge,
} from "../components/UI";
function PromotionForm({ record, close, done }) {
  const [type, setType] = useState(record?.discountType || "percentage");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    for (const key of ["discountValue", "usageLimit", "minimumSpend"])
      body[key] = Number(body[key]);
    body.isActive = body.isActive === "true";
    setBusy(true);
    setError(null);
    try {
      await api(`/promotions${record ? `/${record._id}` : ""}`, {
        method: record ? "PATCH" : "POST",
        body,
      });
      done();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="editor-form">
      <ErrorBanner error={error} />
      <div className="form-grid">
        <Field
          label="Coupon code"
          name="code"
          defaultValue={record?.code}
          required
          minLength={2}
          maxLength={30}
          pattern="[A-Za-z0-9]+"
          hint="Unique letters and numbers only."
          error={error?.fields?.code}
        />
        <Field
          label="Discount type"
          name="discountType"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="percentage">Percentage (%)</option>
          <option value="fixed_amount">Fixed amount (VND)</option>
        </Field>
        <Field
          label="Discount value"
          name="discountValue"
          type="number"
          defaultValue={record?.discountValue}
          required
          min={1}
          max={type === "percentage" ? 100 : undefined}
          step={1}
        />
        <Field
          label="Minimum spend (VND)"
          name="minimumSpend"
          type="number"
          defaultValue={record?.minimumSpend || 0}
          required
          min={0}
          step={1}
        />
        <Field
          label="Usage limit"
          name="usageLimit"
          type="number"
          defaultValue={record?.usageLimit}
          required
          min={Math.max(1, record?.usageCount || 0)}
          step={1}
        />
        <Field
          label="Status"
          name="isActive"
          defaultValue={record?.isActive === false ? "false" : "true"}
        >
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </Field>
        <Field
          label="Starts on"
          name="startDate"
          type="date"
          defaultValue={inputDate(record?.startDate)}
          required
        />
        <Field
          label="Ends on"
          name="endDate"
          type="date"
          defaultValue={inputDate(record?.endDate)}
          required
          hint="Expires at 00:00 on this date, Vietnam time."
        />
      </div>
      <div className="form-footer">
        <button className="button secondary" type="button" onClick={close}>
          Cancel
        </button>
        <Submit busy={busy}>
          {record ? "Save promotion" : "Create promotion"}
        </Submit>
      </div>
    </form>
  );
}
const state = (p) =>
  !p.isActive
    ? "inactive"
    : new Date(p.endDate) <= new Date()
      ? "expired"
      : new Date(p.startDate) > new Date()
        ? "scheduled"
        : p.usageCount >= p.usageLimit
          ? "exhausted"
          : "active";
export default function Promotions() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState(null);
  const [remove, setRemove] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const list = useResource(
    `/promotions?${new URLSearchParams({ q, status, page })}`,
  );
  async function deleteCoupon() {
    setBusy(true);
    setError(null);
    try {
      await api(`/promotions/${remove._id}`, { method: "DELETE", body: {} });
      setRemove(null);
      list.reload();
      setMessage("Promotion deleted.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="YOUR HOTEL / OFFERS"
        title="A reason to stay."
        description="Create considered offers. Keep every discount under control."
        action={
          <button className="button primary" onClick={() => setEditor({})}>
            <Plus size={17} />
            Create promotion
          </button>
        }
      />
      <Success message={message} />
      <section className="panel data-panel">
        <div className="panel-heading">
          <div>
            <h2>
              Promotions{" "}
              <span className="count-pill">{list.meta?.total ?? "—"}</span>
            </h2>
            <p>Voucher codes for your hotel, with clear limits and dates.</p>
          </div>
          <Ticket size={24} strokeWidth={1.5} />
        </div>
        <SearchToolbar
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Find a coupon code"
        >
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="active">Enabled</option>
            <option value="inactive">Disabled</option>
          </select>
        </SearchToolbar>
        <ErrorBanner error={list.error} retry={list.reload} />
        {list.loading ? (
          <Loading />
        ) : !list.error && !list.data?.length ? (
          <Empty
            title="No promotions found"
            text="Create an offer or try another coupon code."
          />
        ) : (
          !list.error && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Coupon</th>
                    <th>Discount</th>
                    <th>Validity</th>
                    <th>Redemptions</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((p) => (
                    <tr key={p._id}>
                      <td>
                        <strong className="coupon-code">{p.code}</strong>
                        <small>Min. {money(p.minimumSpend)}</small>
                      </td>
                      <td>
                        <strong className="discount-value">
                          {p.discountType === "percentage"
                            ? `${p.discountValue}%`
                            : money(p.discountValue)}
                        </strong>
                        <small>
                          {p.discountType === "percentage"
                            ? "off booking value"
                            : "fixed discount"}
                        </small>
                      </td>
                      <td className="nowrap">
                        {dateLabel(p.startDate)}
                        <small>Until {dateLabel(p.endDate)} (exclusive)</small>
                      </td>
                      <td>
                        <span className="tabular">
                          {p.usageCount}{" "}
                          <span className="muted-text">/ {p.usageLimit}</span>
                        </span>
                        <progress
                          max={p.usageLimit}
                          value={p.usageCount}
                          aria-label={`${p.code} redemptions`}
                        />
                      </td>
                      <td>
                        <Badge value={state(p)} />
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-button"
                            aria-label={`Edit ${p.code}`}
                            onClick={() => setEditor(p)}
                          >
                            <Pencil size={17} />
                          </button>
                          <button
                            className="icon-button danger-text"
                            aria-label={`Delete ${p.code}`}
                            onClick={() => {
                              setError(null);
                              setRemove(p);
                            }}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        <Pagination meta={list.meta} setPage={setPage} />
      </section>
      <p className="below-panel">
        Used promotions are kept for booking history. Deactivate an offer to
        stop future use.
      </p>
      <Modal
        title={editor?._id ? "Edit promotion" : "Create a promotion"}
        open={!!editor}
        onClose={() => setEditor(null)}
      >
        <PromotionForm
          record={editor?._id ? editor : null}
          close={() => setEditor(null)}
          done={() => {
            setEditor(null);
            setMessage("Promotion saved.");
            list.reload();
          }}
        />
      </Modal>
      <Modal
        title="Delete promotion?"
        open={!!remove}
        onClose={() => setRemove(null)}
      >
        <div className="editor-form">
          <p>
            Delete {remove?.code}? Only unused promotions can be deleted.
            Otherwise, edit the offer and set it to inactive.
          </p>
          <ErrorBanner error={error} />
          <div className="form-footer">
            <button
              className="button secondary"
              onClick={() => setRemove(null)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={deleteCoupon}
            >
              {busy ? "Deleting…" : "Delete promotion"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
