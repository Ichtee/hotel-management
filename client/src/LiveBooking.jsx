import { useRef, useState } from "react";
import { api, inputDate, money } from "./api/client.js";
import { Field, Notice, useApi } from "./ui.jsx";

const today = () => inputDate(new Date());
const tomorrow = () => inputDate(new Date(Date.now() + 86400000));
const params = (q) =>
  new URLSearchParams({
    checkInDate: q.in || today(),
    checkOutDate: q.out || tomorrow(),
    guests: q.guests || "1",
  });

export function LiveRooms({ q }) {
  const s = useApi(`/rooms/search?${params(q)}`);
  const [maxPrice, setMaxPrice] = useState("");
  const query = new URLSearchParams({
    in: q.in || today(),
    out: q.out || tomorrow(),
    guests: q.guests || "1",
  });
  const rows = (s.data || []).filter(
    (r) => !maxPrice || r.totalPrice <= Number(maxPrice),
  );
  return (
    <div className="c-wrap c-section stay-workspace">
      <h1 className="title">Tìm phòng</h1>
      <form
        key={query.toString()}
        className="stay-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          location.hash = `#/rooms?${new URLSearchParams(new FormData(e.currentTarget))}`;
        }}
      >
        <Field label="Ngày nhận">
          <input
            name="in"
            type="date"
            min={today()}
            defaultValue={q.in || today()}
            required
          />
        </Field>
        <Field label="Ngày trả">
          <input
            name="out"
            type="date"
            min={today()}
            defaultValue={q.out || tomorrow()}
            required
          />
        </Field>
        <Field label="Số khách">
          <input
            name="guests"
            type="number"
            min="1"
            max="100"
            defaultValue={q.guests || 1}
            required
          />
        </Field>
        <button className="btn primary">Tìm phòng</button>
      </form>
      <Field label="Tổng tiền phòng tối đa (VND)">
        <input
          type="number"
          min="0"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
        />
      </Field>
      <Notice error={s.error} />
      {s.loading ? (
        <p>Đang kiểm tra phòng…</p>
      ) : !rows.length ? (
        <p>Không có phòng phù hợp.</p>
      ) : (
        <div className="c-grid">
          {rows.map((r) => (
            <article className="panel" key={r._id}>
              {r.images?.[0] && (
                <img className="thumb" src={r.images[0]} alt={r.name} />
              )}
              <h2>{r.name}</h2>
              <p>
                Tối đa {r.maxOccupancy} khách · Còn {r.availableCount} phòng
              </p>
              <p>
                Tiền phòng toàn kỳ: <b>{money(r.totalPrice)}</b>
              </p>
              <a className="btn primary" href={`#/room/${r._id}?${query}`}>
                Xem & đặt
              </a>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function LiveRoomDetail({ id, q }) {
  const s = useApi(`/public/room-types/${id}`),
    [dates, setDates] = useState({
      in: q.in || today(),
      out: q.out || tomorrow(),
      guests: q.guests || 1,
    });
  const quote = useApi(`/rooms/search?${params(dates)}`);
  const room = quote.data?.find((r) => r._id === id);
  return (
    <div className="c-wrap c-section stay-workspace">
      <a href="#/rooms">← Tìm phòng</a>
      <Notice error={s.error || quote.error} />
      {s.loading ? (
        <p>Đang tải…</p>
      ) : (
        s.data && (
          <div className="c-layout detail">
            <section>
              <h1>{s.data.name}</h1>
              {s.data.images?.[0] && (
                <img
                  className="hero-img"
                  src={s.data.images[0]}
                  alt={s.data.name}
                />
              )}
              <p>{s.data.description}</p>
              <ul>
                {s.data.amenities?.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </section>
            <form
              className="panel book"
              onSubmit={(e) => {
                e.preventDefault();
                const coupon = new FormData(e.currentTarget).get("coupon");
                location.hash = `#/checkout?${new URLSearchParams({ ...dates, room: id, coupon })}`;
              }}
            >
              <Field label="Ngày nhận">
                <input
                  type="date"
                  value={dates.in}
                  min={today()}
                  required
                  onChange={(e) => setDates({ ...dates, in: e.target.value })}
                />
              </Field>
              <Field label="Ngày trả">
                <input
                  type="date"
                  value={dates.out}
                  min={dates.in}
                  required
                  onChange={(e) => setDates({ ...dates, out: e.target.value })}
                />
              </Field>
              <Field label="Số khách">
                <input
                  type="number"
                  min="1"
                  max={s.data.maxOccupancy}
                  value={dates.guests}
                  required
                  onChange={(e) =>
                    setDates({ ...dates, guests: e.target.value })
                  }
                />
              </Field>
              <Field label="Mã ưu đãi">
                <input name="coupon" maxLength="30" />
              </Field>
              {quote.loading ? (
                <p>Đang kiểm tra…</p>
              ) : room ? (
                <p>
                  Tổng tiền phòng: {money(room.totalPrice)}. Ưu đãi được kiểm
                  tra khi tạo booking.
                </p>
              ) : (
                <p>Không có phòng cho lịch đã chọn.</p>
              )}
              <button
                className="btn primary"
                disabled={!room || quote.loading || Boolean(quote.error)}
              >
                Tiếp tục đặt phòng
              </button>
            </form>
          </div>
        )
      )}
    </div>
  );
}

export function LiveCheckout({ q, user }) {
  const s = useApi(`/rooms/search?${params(q)}`),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null);
  const operationKey = useRef(crypto.randomUUID()),
    running = useRef(false);
  const room = s.data?.find((r) => r._id === q.room);
  const submit = async (e) => {
    e.preventDefault();
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api("/bookings", {
        method: "POST",
        body: {
          roomTypeId: q.room,
          checkInDate: q.in,
          checkOutDate: q.out,
          guestCount: Number(q.guests),
          couponCode: q.coupon || undefined,
          paymentOption: "deposit",
          operationKey: operationKey.current,
        },
      });
      location.hash =
        r.data.status === "pending"
          ? `#/pay/${r.data._id}?kind=deposit`
          : "#/my-bookings";
    } catch (e) {
      setError(e);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="c-wrap c-section stay-workspace">
      <h1>Xác nhận đặt phòng</h1>
      <Notice error={error || s.error} />
      {s.loading ? (
        <p>Đang kiểm tra…</p>
      ) : !room ? (
        <p>
          Phòng không còn phù hợp với lịch đã chọn.{" "}
          <a href="#/rooms">Tìm lại phòng</a>
        </p>
      ) : (
        <form className="panel" onSubmit={submit}>
          <h2>{room.name}</h2>
          <p>
            {q.in} → {q.out} · {q.guests} khách
          </p>
          <p>
            Tiền phòng trước ưu đãi: <b>{money(room.totalPrice)}</b>
          </p>
          <p>
            Khách đặt: {user.customerProfile?.fullName || user.username} ·{" "}
            {user.email} · {user.phone}
          </p>
          <a href="#/profile">Cập nhật thông tin liên hệ</a>
          <p>
            Thanh toán cọc theo chính sách khách sạn ở bước tiếp theo; phần còn
            lại thanh toán tại quầy khi trả phòng.
          </p>
          {q.coupon && <p>Mã ưu đãi: {q.coupon}</p>}
          <button className="btn primary" disabled={busy}>
            {busy ? "Đang tạo…" : "Tạo booking & thanh toán cọc"}
          </button>
        </form>
      )}
    </div>
  );
}
