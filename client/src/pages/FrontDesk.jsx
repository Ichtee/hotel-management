import { useRef, useState } from "react";
import { api, dateLabel, inputDate, money } from "../api/client.js";
import { useAuth } from "../context/Auth.jsx";
import { Badge, DataTable, Field, Notice, PageHead, useApi } from "../ui.jsx";
import StayInvoices from "../StayInvoices.jsx";
import "../stay.css";

const today = () => inputDate(new Date());
const tomorrow = () => inputDate(new Date(Date.now() + 86400000));
const states = [
  "pending",
  "confirmed",
  "checked_in",
  "checked_out",
  "cancellation_requested",
  "cancelled",
  "expired",
  "no_show",
];
const path = (id, action = "") => `/frontdesk/bookings/${id}${action}`;

// Giữ mã thao tác khi thử lại; chỉ tạo mã mới sau khi máy chủ xác nhận thành công.
export function useStayAction(onDone) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(null),
    [ok, setOk] = useState("");
  const running = useRef(false),
    key = useRef(crypto.randomUUID());
  const run = async (url, body = {}, method = "POST", keyed = false) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setOk("");
    try {
      const response = await api(url, {
        method,
        body: { ...body, ...(keyed ? { operationKey: key.current } : {}) },
      });
      key.current = crypto.randomUUID();
      setOk(
        response.data?.invoicePending
          ? "Đã lưu. Hóa đơn chưa phát hành; hãy thử lại tại mục Hóa đơn."
          : response.data?.change > 0
            ? `Đã thu. Tiền thừa trả khách: ${money(response.data.change)}.`
            : "Đã lưu.",
      );
      onDone?.(response);
      return response;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, run, notice: <Notice error={error} ok={ok} /> };
}

function SearchDates({ value, onChange, onSubmit, walkIn = false }) {
  return (
    <form
      className="stay-toolbar"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Field label="Ngày nhận">
        <input
          type="date"
          required
          value={value.checkInDate}
          min={today()}
          readOnly={walkIn}
          onChange={(e) => onChange({ ...value, checkInDate: e.target.value })}
        />
      </Field>
      <Field label="Ngày trả">
        <input
          type="date"
          required
          value={value.checkOutDate}
          min={value.checkInDate}
          onChange={(e) => onChange({ ...value, checkOutDate: e.target.value })}
        />
      </Field>
      <Field label="Số khách">
        <input
          type="number"
          min="1"
          max="100"
          required
          value={value.guests}
          onChange={(e) => onChange({ ...value, guests: e.target.value })}
        />
      </Field>
      <button className="btn" type="submit">
        Kiểm tra phòng
      </button>
    </form>
  );
}

export function Availability({ walkIn = false, onCreated }) {
  const [dates, setDates] = useState({
    checkInDate: today(),
    checkOutDate: tomorrow(),
    guests: 1,
  });
  const [query, setQuery] = useState(new URLSearchParams(dates).toString());
  const [typeId, setTypeId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const customers = useApi("/frontdesk/customers?limit=100", walkIn);
  const s = useApi(`/frontdesk/availability?${query}`);
  const action = useStayAction(onCreated);
  const searched = new URLSearchParams(query);
  const current = query === new URLSearchParams(dates).toString();
  const create = (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    action.run(
      "/frontdesk/bookings",
      {
        ...(customerId ? { customerId, couponCode: data.couponCode } : data),
        roomTypeId: typeId,
        checkInDate: searched.get("checkInDate"),
        checkOutDate: searched.get("checkOutDate"),
        guestCount: Number(searched.get("guests")),
      },
      "POST",
      true,
    );
  };
  return (
    <section className="panel stay-workspace">
      <h2>{walkIn ? "Đặt phòng tại quầy" : "Phòng có thể đặt"}</h2>
      <SearchDates
        value={dates}
        onChange={setDates}
        walkIn={walkIn}
        onSubmit={() => {
          setQuery(new URLSearchParams(dates).toString());
          setTypeId("");
          s.reload();
        }}
      />
      <Notice error={s.error} />
      {s.loading ? (
        <p>Đang kiểm tra…</p>
      ) : (
        <DataTable
          cols={[
            "Loại phòng",
            "Sức chứa",
            "Còn trống",
            "Tiền phòng toàn kỳ",
            "",
          ]}
          rows={(s.data || []).map((r) => [
            r.name,
            r.maxOccupancy,
            r.availableCount,
            money(r.totalPrice),
            walkIn && (
              <button
                className="btn"
                disabled={!r.availableCount || !current}
                onClick={() => setTypeId(r._id)}
              >
                {typeId === r._id ? "Đã chọn" : "Chọn"}
              </button>
            ),
          ])}
        />
      )}
      {!s.loading && !s.error && !s.data?.length && (
        <p>Không có loại phòng phù hợp.</p>
      )}
      {walkIn && typeId && (
        <form className="form" onSubmit={create}>
          <Field label="Khách đã có tài khoản">
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Khách chưa có tài khoản</option>
              {customers.data?.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.customerProfile?.fullName} · {c.phone || c.email}
                </option>
              ))}
            </select>
          </Field>
          {!customerId && (
            <>
              <Field label="Họ tên">
                <input name="fullName" required minLength="2" maxLength="100" />
              </Field>
              <Field label="Điện thoại">
                <input
                  name="phone"
                  required
                  inputMode="tel"
                  pattern="[0-9]{10,11}"
                />
              </Field>
              <Field label="Email (không bắt buộc)">
                <input name="email" type="email" />
              </Field>
            </>
          )}
          <Field label="Mã ưu đãi (không bắt buộc)">
            <input name="couponCode" maxLength="30" />
          </Field>
          <Notice error={customers.error} />
          <button
            className="btn primary"
            disabled={action.busy || !current || s.loading}
          >
            Tạo booking
          </button>
        </form>
      )}
      {action.notice}
    </section>
  );
}

function CheckIn({ b, reload }) {
  const rooms = useApi(path(b._id, "/available-rooms")),
    a = useStayAction(reload);
  return (
    <section className="stay-section">
      <h3>Nhận phòng</h3>
      <Notice error={rooms.error} />
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          a.run(path(b._id, "/check-in"), {
            ...f,
            guestCount: Number(f.guestCount),
          });
        }}
      >
        <Field label="Phòng">
          <select name="roomId" required disabled={rooms.loading}>
            <option value="">Chọn phòng sẵn sàng</option>
            {rooms.data?.map((r) => (
              <option key={r._id} value={r._id}>
                {r.roomNumber}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Số khách thực tế">
          <input
            name="guestCount"
            type="number"
            min="1"
            max="100"
            required
            defaultValue={b.rooms[0].guestCount}
          />
        </Field>
        <Field label="CCCD / Hộ chiếu">
          <input
            name="idDocumentNo"
            minLength="3"
            maxLength="40"
            required
            autoComplete="off"
          />
        </Field>
        <button className="btn primary" disabled={a.busy || rooms.loading}>
          Xác nhận nhận phòng
        </button>
      </form>
      {a.notice}
    </section>
  );
}

function Modify({ b, reload }) {
  const a = useStayAction(reload);
  return (
    <section className="stay-section">
      <h3>Sửa thông tin</h3>
      <p>
        Để trống thông tin khách nếu không thay đổi. Thay đổi cần thêm cọc chỉ
        áp dụng khi thanh toán thành công.
      </p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          for (const k of Object.keys(f)) if (!f[k]) delete f[k];
          if (f.guestCount) f.guestCount = Number(f.guestCount);
          a.run(path(b._id), f, "PATCH");
        }}
      >
        <Field label="Họ tên mới">
          <input name="fullName" maxLength="100" />
        </Field>
        <Field label="Điện thoại mới">
          <input name="phone" pattern="[0-9]{10,11}" />
        </Field>
        {["checked_in", "checked_out"].includes(b.status) && (
          <Field label="CCCD / Hộ chiếu mới">
            <input name="idDocumentNo" minLength="3" maxLength="40" />
          </Field>
        )}
        {b.status !== "checked_out" && (
          <>
            <Field label="Ngày nhận">
              <input
                name="checkInDate"
                type="date"
                defaultValue={inputDate(b.checkInDate)}
                readOnly={b.status === "checked_in"}
                required
              />
            </Field>
            <Field label="Ngày trả">
              <input
                name="checkOutDate"
                type="date"
                defaultValue={inputDate(b.checkOutDate)}
                min={
                  b.status === "checked_in"
                    ? inputDate(b.checkOutDate)
                    : inputDate(b.checkInDate)
                }
                required
              />
            </Field>
            <Field label="Số khách">
              <input
                name="guestCount"
                type="number"
                min="1"
                max="100"
                defaultValue={b.rooms[0].guestCount}
                required
              />
            </Field>
          </>
        )}
        <button className="btn primary" disabled={a.busy}>
          Lưu thay đổi
        </button>
      </form>
      {a.notice}
    </section>
  );
}

function ChangeRoom({ b, reload }) {
  const options = useApi(path(b._id, "/change-room-options")),
    a = useStayAction(reload);
  return (
    <section className="stay-section">
      <h3>Đổi phòng</h3>
      <p>
        Giữ giá đêm đang ở. Giá mới (nếu có) áp dụng từ đêm được ghi trên lựa
        chọn. Không thu thêm cho nâng hạng do khách sạn.
      </p>
      <Notice error={options.error} />
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          a.run(
            path(b._id, "/change-room"),
            { ...f, guestAgreed: f.guestAgreed === "on" },
            "POST",
            true,
          );
        }}
      >
        <Field label="Phòng mới">
          <select name="newRoomId" required disabled={options.loading}>
            <option value="">Chọn phòng</option>
            {options.data?.map((r) => (
              <option key={r._id} value={r._id}>
                {r.roomNumber} · {r.roomTypeName} · {r.direction} ·{" "}
                {money(r.quote)} · từ {r.effectiveFrom}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nguyên nhân">
          <select name="cause">
            <option value="hotel">Do khách sạn</option>
            {b.status === "checked_in" && (
              <option value="guest">Khách yêu cầu</option>
            )}
          </select>
        </Field>
        <Field label="Lý do">
          <textarea name="reason" required minLength="2" maxLength="500" />
        </Field>
        <label className="check">
          <input name="guestAgreed" type="checkbox" />
          Khách đồng ý hạ hạng (nếu áp dụng)
        </label>
        <button className="btn primary" disabled={a.busy || options.loading}>
          Xác nhận đổi phòng
        </button>
      </form>
      {a.notice}
    </section>
  );
}

function Services({ b, reload }) {
  const items = useApi("/frontdesk/services"),
    a = useStayAction(reload);
  return (
    <section className="stay-section">
      <h3>Dịch vụ sử dụng</h3>
      <Notice error={items.error} />
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          a.run(
            path(b._id, "/services"),
            { ...f, quantity: Number(f.quantity) },
            "POST",
            true,
          );
        }}
      >
        <Field label="Dịch vụ">
          <select name="serviceId" required>
            <option value="">Chọn dịch vụ</option>
            {items.data?.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name} · {money(s.unitPrice)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Số lượng">
          <input
            name="quantity"
            type="number"
            defaultValue="1"
            min="1"
            max="1000"
            required
          />
        </Field>
        <button className="btn" disabled={a.busy || items.loading}>
          Ghi nhận dịch vụ
        </button>
      </form>
      {b.services?.map((s) => (
        <div key={s._id}>
          <p>
            {s.name} × {s.quantity}: {money(s.amount)}{" "}
            {s.isVoided && "(Đã hủy)"}
          </p>
          {!s.isVoided && (
            <form
              className="stay-toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                a.run(
                  path(b._id, `/services/${s._id}/void`),
                  { reason: new FormData(e.currentTarget).get("reason") },
                  "PATCH",
                );
              }}
            >
              <Field label={`Lý do hủy ${s.name}`}>
                <input name="reason" required minLength="2" maxLength="500" />
              </Field>
              <button className="btn" disabled={a.busy}>
                Hủy dòng
              </button>
            </form>
          )}
        </div>
      ))}
      {a.notice}
    </section>
  );
}

export function DamageForm({ bookingId, taskId, direct = false, onDone }) {
  const { user } = useAuth();
  const catalog = useApi("/catalog/compensation-items"),
    a = useStayAction(onDone);
  const [item, setItem] = useState("");
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        a.run(
          direct
            ? path(bookingId, "/penalties")
            : `/housekeeping/bookings/${bookingId}/penalties`,
          {
            ...(item
              ? { itemId: item }
              : {
                  description: f.description,
                  ...(direct ? { amount: Number(f.amount) } : {}),
                }),
            quantity: Number(f.quantity),
            roomUnusable: f.roomUnusable === "on",
            ...(taskId ? { taskId } : {}),
          },
          "POST",
          true,
        );
      }}
    >
      <Field label="Hạng mục">
        <select value={item} onChange={(e) => setItem(e.target.value)}>
          <option value="">Khác</option>
          {catalog.data?.map((s) => (
            <option key={s._id} value={s._id}>
              {s.name} · {money(s.unitPrice)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Số lượng">
        <input
          name="quantity"
          type="number"
          min="1"
          max="1000"
          defaultValue="1"
          required
        />
      </Field>
      {!item && (
        <Field label="Mô tả thiệt hại">
          <textarea
            name="description"
            required
            minLength="2"
            maxLength="1000"
          />
        </Field>
      )}
      {!item && direct && (
        <Field label="Số tiền">
          <input name="amount" type="number" min="0" required />
        </Field>
      )}
      {user.permissions.includes("room_issues.report") && (
        <label className="check">
          <input type="checkbox" name="roomUnusable" />
          Phòng không thể sử dụng
        </label>
      )}
      <button className="btn" disabled={a.busy || catalog.loading}>
        {direct ? "Ghi khoản phạt" : "Gửi báo cáo thiệt hại"}
      </button>
      <Notice error={catalog.error} />
      {a.notice}
    </form>
  );
}

function PenaltyDecision({ penalty: p, bookingId, reload, canDecide }) {
  const a = useStayAction(reload);
  return (
    <article className="stay-section">
      <p>
        <b>{p.description}</b> × {p.quantity} ·{" "}
        {p.amount === undefined ? "Chưa chốt số tiền" : money(p.amount)} ·{" "}
        <Badge v={p.status} />
        {p.afterCheckout && " · Sau trả phòng"}
      </p>
      {canDecide && !p.paymentId && p.status !== "waived" && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget));
            a.run(
              `/frontdesk/penalties/${p._id}`,
              { ...f, amount: Number(f.amount) },
              "PATCH",
            );
          }}
        >
          <Field label="Quyết định">
            <select name="status">
              <option value="confirmed">Xác nhận / điều chỉnh</option>
              <option value="waived">Miễn phạt</option>
            </select>
          </Field>
          <Field label="Số tiền xác nhận">
            <input
              name="amount"
              type="number"
              min="0"
              defaultValue={p.amount ?? 0}
              required
            />
          </Field>
          <Field label="Lý do giảm / miễn">
            <input name="reason" maxLength="500" />
          </Field>
          <button className="btn" disabled={a.busy}>
            Lưu quyết định
          </button>
        </form>
      )}
      {p.afterCheckout && p.status === "confirmed" && (
        <>
          <p>
            Khoản phạt phát hiện sau check-out đang chờ xử lý; hóa đơn gốc giữ
            nguyên.
          </p>
          {(p.amount === 0 || p.paymentId) && (
            <button
              className="btn"
              disabled={a.busy}
              onClick={() =>
                a.run(path(bookingId, "/invoices"), { penaltyId: p._id })
              }
            >
              Phát hành hóa đơn bổ sung
            </button>
          )}
        </>
      )}
      {a.notice}
    </article>
  );
}

function Checkout({ b, reload }) {
  const s = useApi(path(b._id, "/bill")),
    a = useStayAction(() => {
      reload();
      s.reload();
    });
  const bill = s.data;
  return (
    <section className="stay-section">
      <h3>Trả phòng</h3>
      <Notice error={s.error} />
      {!b.checkout?.startedAt ? (
        <button
          className="btn"
          disabled={a.busy}
          onClick={() => a.run(path(b._id, "/check-out/start"))}
        >
          Bắt đầu kiểm tra trả phòng
        </button>
      ) : (
        <>
          <p>
            Kiểm tra phòng: {bill?.inspection?.status || "Đang tải"}{" "}
            {bill?.inspection?.inspectionResult}
          </p>
          {b.checkout.skippedAt ? (
            <p>Đã bỏ qua kiểm tra: {b.checkout.skipReason}</p>
          ) : (
            bill?.inspection?.status !== "completed" && (
              <form
                className="stay-toolbar"
                onSubmit={(e) => {
                  e.preventDefault();
                  a.run(path(b._id, "/check-out/skip-inspection"), {
                    reason: new FormData(e.currentTarget).get("reason"),
                  });
                }}
              >
                <Field label="Lý do khách không thể chờ">
                  <input name="reason" required minLength="2" maxLength="500" />
                </Field>
                <button className="btn" disabled={a.busy}>
                  Bỏ qua kiểm tra
                </button>
              </form>
            )
          )}
          <button className="btn" disabled={s.loading} onClick={s.reload}>
            Cập nhật kết quả kiểm tra / công nợ
          </button>
          {bill && (
            <>
              <dl className="stay-summary">
                {[
                  ["Phòng", bill.roomAmount],
                  ["Dịch vụ", bill.serviceAmount],
                  ["Phụ phí", bill.feeAmount],
                  ["Phạt", bill.penaltyAmount],
                  ["Giảm giá", bill.discountAmount],
                  ["Tổng", bill.totalAmount],
                  ["Đã thu ròng", bill.paidAmount],
                  ["Còn thiếu", bill.balance],
                ].map(([l, v]) => (
                  <div key={l}>
                    <dt>{l}</dt>
                    <dd>{money(v)}</dd>
                  </div>
                ))}
              </dl>
              {bill.balance > 0 && (
                <p>
                  Chưa thể trả phòng vì còn công nợ. Sau khi phân hệ thanh toán
                  ghi nhận tiền thu, chọn cập nhật công nợ.
                </p>
              )}

              <button
                className="btn primary"
                disabled={a.busy || bill.balance > 0}
                onClick={() => a.run(path(b._id, "/check-out/complete"))}
              >
                Hoàn tất trả phòng
              </button>
            </>
          )}
        </>
      )}
      {a.notice}
    </section>
  );
}

function BookingDetail({ id, onBack, changed }) {
  const { user } = useAuth();
  const can = (p) => user.permissions.includes(p);
  const s = useApi(`/bookings/${id}`),
    [tab, setTab] = useState("");
  const reload = () => {
    s.reload();
    changed();
  };
  const b = s.data;
  return (
    <section className="panel">
      <button className="btn" onClick={onBack}>
        ← Danh sách
      </button>
      <Notice error={s.error} />
      {s.loading ? (
        <p>Đang tải booking…</p>
      ) : (
        b && (
          <>
            <h2>
              {b.bookingReference} · {b.guestName}
            </h2>
            <p>
              <Badge v={b.status} /> · {dateLabel(b.checkInDate)} →{" "}
              {dateLabel(b.checkOutDate)}
            </p>
            <p>
              {b.rooms
                .map(
                  (r) =>
                    `${r.roomTypeId?.name || "Phòng"} · ${r.roomId?.roomNumber || "Chưa gán phòng"}`,
                )
                .join(", ")}{" "}
              · Điện thoại: {b.guestPhone || "—"}
            </p>
            <p>
              Tổng {money(b.totalAmount)} · Đã thanh toán ròng{" "}
              {money(b.paidAmount)}
            </p>
            <p>
              Giờ nhận {b.policySnapshot?.checkInTime || "Chưa xác minh"} · Giờ
              trả {b.policySnapshot?.checkOutTime || "Chưa xác minh"}
            </p>
            {b.pendingChange && (
              <p role="status">
                Đang chờ cọc bổ sung {money(b.pendingChange.additionalDeposit)}{" "}
                đến{" "}
                {new Date(b.pendingChange.holdExpiresAt).toLocaleString(
                  "vi-VN",
                  { timeZone: "Asia/Ho_Chi_Minh" },
                )}
                . Lịch cũ vẫn có hiệu lực.
              </p>
            )}
            <div className="stay-actions">
              {can("bookings.managed.update") &&
                ["pending", "confirmed", "checked_in", "checked_out"].includes(
                  b.status,
                ) && (
                  <button className="btn" onClick={() => setTab("modify")}>
                    Sửa booking
                  </button>
                )}
              {can("stays.check_in") && b.status === "confirmed" && (
                <button className="btn" onClick={() => setTab("checkin")}>
                  Nhận phòng
                </button>
              )}
              {can("rooms.change") &&
                ["confirmed", "checked_in"].includes(b.status) && (
                  <button className="btn" onClick={() => setTab("change")}>
                    Đổi phòng
                  </button>
                )}
              {can("booking_services.record") && b.status === "checked_in" && (
                <button className="btn" onClick={() => setTab("services")}>
                  Dịch vụ
                </button>
              )}
              {can("penalties.record") &&
                ["checked_in", "checked_out"].includes(b.status) && (
                  <button className="btn" onClick={() => setTab("penalties")}>
                    Khoản phạt
                  </button>
                )}
              {can("stays.check_out") && b.status === "checked_in" && (
                <button className="btn" onClick={() => setTab("checkout")}>
                  Trả phòng
                </button>
              )}
            </div>
            {tab === "modify" && <Modify b={b} reload={reload} />}
            {tab === "checkin" && b.status === "confirmed" && (
              <CheckIn b={b} reload={reload} />
            )}
            {tab === "change" &&
              ["confirmed", "checked_in"].includes(b.status) && (
                <ChangeRoom b={b} reload={reload} />
              )}
            {tab === "services" && b.status === "checked_in" && (
              <Services b={b} reload={reload} />
            )}
            {tab === "penalties" && (
              <section>
                <h3>Khoản phạt</h3>
                {b.status === "checked_in" && (
                  <DamageForm bookingId={b._id} direct onDone={reload} />
                )}
                {!b.penalties?.length && <p>Chưa có khoản phạt.</p>}
                {b.penalties?.map((p) => (
                  <PenaltyDecision
                    key={p._id}
                    penalty={p}
                    bookingId={b._id}
                    reload={reload}
                    canDecide={
                      can("penalties.record") &&
                      (b.status === "checked_in" || p.afterCheckout)
                    }
                  />
                ))}
              </section>
            )}
            {tab === "checkout" && b.status === "checked_in" && (
              <Checkout b={b} reload={reload} />
            )}
            {b.status === "checked_out" && can("invoices.print") && (
              <StayInvoices bookingId={id} canGenerate />
            )}
          </>
        )
      )}
    </section>
  );
}

export default function FrontDesk() {
  const { user } = useAuth();
  const [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(null),
    [mode, setMode] = useState("list");
  const s = useApi(
    `/bookings?${new URLSearchParams({ q: search, ...(status ? { status } : {}), page, limit: 15 })}`,
  );
  return (
    <div className="stay-workspace">
      <PageHead
        title="Lễ tân & lưu trú"
        sub="Đặt phòng, nhận phòng, dịch vụ và trả phòng"
      />
      <div className="stay-actions">
        <button
          className="btn"
          onClick={() => {
            setMode("list");
            setSelected(null);
          }}
        >
          Booking
        </button>
        {user.permissions.includes("bookings.walk_in.create") && (
          <>
            <button
              className="btn"
              onClick={() => {
                setMode("create");
                setSelected(null);
              }}
            >
              Khách tại quầy
            </button>
          </>
        )}
        {user.permissions.includes("rooms.search") && (
          <button
            className="btn"
            onClick={() => {
              setMode("availability");
              setSelected(null);
            }}
          >
            Tra cứu tồn phòng
          </button>
        )}
      </div>
      {selected ? (
        <BookingDetail
          key={selected}
          id={selected}
          onBack={() => setSelected(null)}
          changed={s.reload}
        />
      ) : mode === "create" ? (
        <Availability
          walkIn
          onCreated={(r) => {
            setMode("list");
            setSelected(r.data._id);
            s.reload();
          }}
        />
      ) : mode === "availability" ? (
        <Availability />
      ) : (
        <section className="panel">
          <form
            className="stay-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q);
              setPage(1);
            }}
          >
            <Field label="Mã booking, tên hoặc điện thoại">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                maxLength="100"
              />
            </Field>
            <button className="btn">Tìm</button>
            <Field label="Trạng thái">
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Tất cả</option>
                {states.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <button className="btn" type="button" onClick={s.reload}>
              Tải lại
            </button>
          </form>
          <Notice error={s.error} />
          {s.loading ? (
            <p>Đang tải…</p>
          ) : !s.data?.length ? (
            <p>Không có booking phù hợp.</p>
          ) : (
            <DataTable
              cols={[
                "Mã",
                "Khách",
                "Ngày nhận / trả",
                "Trạng thái",
                "Tổng",
                "",
              ]}
              rows={s.data.map((b) => [
                b.bookingReference,
                b.guestName,
                `${dateLabel(b.checkInDate)} → ${dateLabel(b.checkOutDate)}`,
                <Badge v={b.status} />,
                money(b.totalAmount),
                <button className="btn" onClick={() => setSelected(b._id)}>
                  Chi tiết
                </button>,
              ])}
            />
          )}
          <div className="stay-actions">
            <button
              className="btn"
              disabled={page <= 1 || s.loading}
              onClick={() => setPage(page - 1)}
            >
              Trước
            </button>
            <span>
              Trang {page} / {s.meta?.pages || 1}
            </span>
            <button
              className="btn"
              disabled={page >= (s.meta?.pages || 1) || s.loading}
              onClick={() => setPage(page + 1)}
            >
              Sau
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
