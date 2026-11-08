import { useEffect, useRef, useState } from 'react';
import { useAuth } from './context/Auth.jsx';
import { AuthShell, AuthTabs, SignIn, Register, ForgotPassword } from './AuthForms.jsx';
import { Profile } from './AdminPages.jsx';
import { ROOM_TYPES } from './data.js';
import { MyBookings } from './Bookings.jsx';
import { roomApi } from './api/roomApi.js';
import { PaymentPage, PaymentResult, SandboxGateway } from './Payments.jsx';
import { api, money } from './api/client.js';
import './resort.css';
import NotificationBell from './Notifications.jsx';
import { Notice } from './ui.jsx';

const NAV = [
  { label: 'Home', href: '#/' },
  { label: 'Rooms', items: [['#/rooms', 'All rooms', 'Compare every room type'], ['#/rooms?cat=standard', 'Standard rooms', 'Deluxe & Superior'], ['#/rooms?cat=suite', 'Suites', 'Family & Presidential']] },
  { label: 'Offers', href: '#/offers' },
  { label: 'Help', items: [['#/offers', 'Booking policies', 'Deposit and cancellation'], ['#/', 'Contact us', 'hello@grandstay.example']] }
];

const parse = (route) => {
  const [path, q = ''] = route.split('?');
  return [path, Object.fromEntries(new URLSearchParams(q))];
};
const route0 = (q) => `${q.in}${q.out}${q.guests}`;
const nightsBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 864e5)) : 0);
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const Stars = ({ n }) => <span className="stars" role="img" aria-label={`${n} out of 5`}>{'★'.repeat(Math.round(n))}{'☆'.repeat(5 - Math.round(n))}</span>;

function SiteHeader({ route }) {
  const { user, signOut } = useAuth();
  const staff = user && user.scope !== 'self';
  const [open, setOpen] = useState(null);
  const [mobile, setMobile] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(null); };
    addEventListener('click', close); addEventListener('keydown', close);
    return () => { removeEventListener('click', close); removeEventListener('keydown', close); };
  }, []);

  const done = () => { setOpen(null); setMobile(false); };
  const name = user?.customerProfile?.fullName || user?.username || '';

  return (
    <header className="topbar site" ref={ref}>
      <div className="bar">
        <a className="brand" href="#/">Grand<span>Stay</span></a>
        <button className="menu-btn" aria-expanded={mobile} aria-controls="nav" onClick={() => setMobile(!mobile)}>{mobile ? 'Close' : 'Menu'}</button>
        <nav id="nav" className={mobile ? 'open' : ''} aria-label="Main">
          <ul>
            {NAV.map((m, i) => m.items ? (
              <li className="dd" key={m.label}>
                <button aria-expanded={open === i} aria-haspopup="true" onClick={() => setOpen(open === i ? null : i)}>{m.label} <span className="caret" aria-hidden="true">▾</span></button>
                {open === i && (
                  <ul className="dd-menu">
                    {m.items.map(([h, l, s]) => <li key={l}><a href={h} onClick={done}><strong>{l}</strong>{s && <small>{s}</small>}</a></li>)}
                    {/* My trips dropdown sign out */ user && m.label === "My trips" && (
                      <li style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 4, paddingTop: 4 }}>
                        <button type="button" onClick={async () => { done(); await signOut(); location.hash = "#/"; }} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: ".5rem 1rem", color: "#ff6b6b", cursor: "pointer", fontSize: ".9rem", fontWeight: 600 }}>Sign out</button>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            ) : <li key={m.label}><a className={route.split('?')[0] === m.href ? 'active' : ''} href={m.href} onClick={done}>{m.label}</a></li>)}
          </ul>
          <div className="right">
            {user ? (
              <>
                <a className="btn gold" href="#/rooms" onClick={done}>Book now</a>
                <NotificationBell bookingHref="#/my-bookings" />
                <div className="dd account">
                  <button className="acct" aria-expanded={open === 'acct'} aria-haspopup="true" onClick={() => setOpen(open === 'acct' ? null : 'acct')}>
                    <span className="avatar" aria-hidden="true">{(name || 'U')[0].toUpperCase()}</span>
                    <span className="acct-name">{name}</span>
                    <span className="caret" aria-hidden="true">▾</span>
                  </button>
                  {open === 'acct' && (
                    <ul className="dd-menu end">
                      <li className="acct-head"><strong>{name}</strong><small>{user.email}</small></li>
                      <li><a href="#/my-bookings" onClick={done}><strong>My bookings</strong></a></li>
                      <li><a href="#/profile" onClick={done}><strong>My profile</strong></a></li>
                      {staff && <li><a href="#/admin" onClick={done}><strong>Staff portal</strong></a></li>}
                      <li><button className="signout" onClick={async () => { done(); await signOut(); location.hash = '#/'; }}>Sign out</button></li>
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <>
                <a className="signin" href="#/login" onClick={done}>Sign in</a>
                <a className="btn gold" href="#/rooms" onClick={done}>Book now</a>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}

function SearchBar({ q = {} }) {
  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    location.hash = `#/rooms?${new URLSearchParams({ in: f.get('in'), out: f.get('out'), guests: f.get('guests') })}`;
  };
  return (
    <form className="c-search" onSubmit={submit}>
      <label>Destination<input defaultValue="GrandStay Da Nang" readOnly /></label>
      <label>Check-in<input name="in" type="date" min={day(0)} defaultValue={q.in || day(7)} required /></label>
      <label>Check-out<input name="out" type="date" min={day(1)} defaultValue={q.out || day(10)} required /></label>
      <label>Guests<select name="guests" defaultValue={q.guests || "2"}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></label>
      <button className="btn gold" type="submit">Search rooms</button>
    </form>
  );
}

function RoomCard({ r, q = '' }) {
  return (
    <article className="c-card">
      <a className="c-media" href={`#/room/${r.id}${q}`} tabIndex={-1} aria-hidden="true">
        <img src={r.img} alt="" loading="lazy" width="900" height="1125" />
        <span className="c-price">From <b>{money(r.price)}</b> / night</span>
      </a>
      <div className="c-body">
        <p className="kicker">{[r.bed, r.size && `${r.size} m²`, `Up to ${r.guests} guests`].filter(Boolean).join(' · ')}</p>
        <h3><a href={`#/room/${r.id}${q}`}>{r.name}</a></h3>
        {r.rating && <Stars n={r.rating} />}
        {r.amenities.length > 0 && <ul className="tags">{r.amenities.slice(0, 3).map((a) => <li key={a}>{a}</li>)}</ul>}
        <a className="more-link" href={`#/room/${r.id}${q}`}>View room <span aria-hidden="true">→</span></a>
      </div>
    </article>
  );
}

function Home() {
  const perks = [
    ['Best price guarantee', 'Coupons and seasonal rates applied automatically.', 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z M7 7h.01'],
    ['Free cancellation', 'Cancel up to 48 hours before check-in.', 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 8v4l3 2'],
    ['Verified reviews', 'Only guests who stayed can review.', 'M12 2l3 6.3 6.9.9-5 4.8 1.2 6.9L12 17.5 5.9 20.9 7.1 14 2.1 9.2l6.9-.9z'],
    ['Secure payment', 'Pay a deposit online, the rest when you check out.', 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4']
  ];

  const [featuredRooms, setFeaturedRooms] = useState([]);
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    roomTypeServiceFetch();
  }, []);

  const roomTypeServiceFetch = async () => {
    try {
      const res = await roomApi.getRoomTypes({ isActive: true });
      if (res.data && res.data.length > 0) {
        const mapped = res.data.slice(0, 3).map((rt, i) => ({
          id: rt._id,
          name: rt.name,
          price: rt.basePrice,
          guests: rt.maxOccupancy || 2,
          bed: rt.bedType || 'King bed',
          size: rt.roomSizeSqm || 32,
          rating: rt.rating || null,
          amenities: rt.amenities || [],
          img: rt.images?.[0] || ROOM_TYPES[i % ROOM_TYPES.length].img,
          desc: rt.description || 'Spacious and well-appointed luxury room.'
        }));
        setFeaturedRooms(mapped);
        const lists = await Promise.all(res.data.map((t) => api(`/public/room-types/${t._id}/reviews?limit=2`).then((x) => x.data.map((v) => ({ ...v, room: t.name }))).catch(() => [])));
        setReviews(lists.flat().slice(0, 3));
      }
    } catch {
      // Fallback
    }
  };

  return (
    <>
      <section className="c-hero">
        <div className="c-wrap hero-copy">
          <p className="eyebrow">GrandStay · Da Nang, Vietnam</p>
          <h1>Where the sea<br />meets stillness</h1>
          <p className="lead">Ocean-view rooms and suites, a quiet pool above the beach, and a team that takes care of the details.</p>
        </div>
        <div className="c-wrap"><SearchBar /></div>
      </section>

      <section className="c-wrap c-section intro">
        <div>
          <p className="eyebrow ink">Welcome</p>
          <h2 className="display">A five-star retreat on the coast of Da Nang</h2>
          <p className="lead-ink">Wake up to the sound of the waves, spend the afternoon by the pool and end the day with dinner by the sea. Book online in a few minutes and manage your stay from your account.</p>
          <a className="more-link" href="#/rooms">Explore rooms &amp; suites <span aria-hidden="true">→</span></a>
        </div>
        <div className="intro-img" role="img" aria-label="Pool surrounded by palm trees" />
      </section>

      <section className="c-wrap c-section">
        <div className="sec-head">
          <div><p className="eyebrow ink">Stay</p><h2 className="display">Rooms &amp; suites</h2></div>
          <a className="more-link" href="#/rooms">View all rooms <span aria-hidden="true">→</span></a>
        </div>
        <div className="c-grid">{featuredRooms.map((r) => <RoomCard key={r.id} r={r} />)}</div>
      </section>

      <section className="band">
        <div className="c-wrap band-copy">
          <p className="eyebrow">Book direct</p>
          <h2 className="display light">Save 15% when you book with us</h2>
          <p>Our best rate is always on this website: 15% off stays from ₫1,500,000.</p>
          <div className="promo-actions">
            <a className="btn gold" href="#/rooms">Book your stay</a>
            <span className="promo-code">Code <b>DIRECT15</b></span>
          </div>
        </div>
      </section>

      <section className="c-wrap c-section perks">
        {perks.map(([t, d, p]) => (
          <div key={t}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p} /></svg>
            <h3>{t}</h3><p>{d}</p>
          </div>
        ))}
      </section>

      {reviews.length > 0 && <section className="reviews">
        <div className="c-wrap c-section">
          <p className="eyebrow ink center">Guest stories</p>
          <h2 className="display center">What our guests say</h2>
          <div className="quotes">{reviews.map((v) => <blockquote key={v._id}><Stars n={v.rating} /><p>“{v.comment || v.title}”</p><footer>Verified guest · {v.room}</footer></blockquote>)}</div>
        </div>
      </section>}
    </>
  );
}

function usePolicies() {
  const [p, setP] = useState(null);
  useEffect(() => { api('/public/policies').then((x) => setP(x.data)).catch(() => {}); }, []);
  return p;
}
const tierText = (t) => `${t.refundPercent}% of the deposit back when you cancel ${t.minHoursBeforeCheckIn ? `at least ${t.minHoursBeforeCheckIn} hours before check-in` : 'later than that'}`;
function PolicyText({ p }) {
  if (!p) return <p className="muted">Loading policies…</p>;
  return (
    <ul className="policy-list">
      {p.depositPercent != null && <li>A deposit of <b>{p.depositPercent}%</b> is paid online to confirm the booking; the rest is paid at the front desk at check-out.</li>}
      {[...p.cancellationTiers].sort((x, y) => y.minHoursBeforeCheckIn - x.minHoursBeforeCheckIn).map((t) => <li key={t.minHoursBeforeCheckIn}>{tierText(t)}.</li>)}
      <li>Check-in from <b>{p.checkInTime}</b>{p.checkOutTime && <>, check-out by <b>{p.checkOutTime}</b></>}.</li>
    </ul>
  );
}

function Offers() {
  const p = usePolicies();
  return (
    <div className="c-wrap c-section narrow">
      <h1 className="title">Booking policies</h1>
      <div className="panel"><h2>Deposit &amp; cancellation</h2><PolicyText p={p} /></div>
      <div className="panel mt"><h2>Promo codes</h2><p className="muted">Enter a promo code at checkout, for example <b>DIRECT15</b> (15% off stays from ₫1,500,000). The discount is checked and applied when your booking is created.</p></div>
    </div>
  );
}

// Room-type card shape used by the room list, detail and checkout pages.
const toCard = (rt) => ({
  id: rt._id, _id: rt._id, name: rt.name, price: rt.basePrice, guests: rt.maxOccupancy || 2,
  bed: rt.bedType || '', size: rt.roomSizeSqm || null, rating: rt.rating || null, amenities: rt.amenities || [],
  img: rt.images?.[0] || 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80',
  desc: rt.description || '', cat: rt.name.toLowerCase().includes('suite') ? 'suite' : 'standard',
});

function Rooms({ q }) {
  const [price, setPrice] = useState(10000000);
  const [cat, setCat] = useState(q.cat || 'all');
  const [isSearchingApi, setIsSearchingApi] = useState(false);
  const [apiRooms, setApiRooms] = useState(null);

  useEffect(() => setCat(q.cat || 'all'), [q.cat]);

  const [loadError, setLoadError] = useState(false);
  // With dates: only room types that still have a free room (UC04 / T06). Without dates: every active room type.
  useEffect(() => {
    setIsSearchingApi(true); setLoadError(false);
    const load = q.in && q.out
      ? roomApi.searchRooms({ checkIn: q.in, checkOut: q.out, guests: q.guests }).then((res) => {
          const types = new Map();
          for (const r of res.data || []) if (r.roomTypeId && !types.has(String(r.roomTypeId._id))) types.set(String(r.roomTypeId._id), r.roomTypeId);
          return [...types.values()];
        })
      : api('/public/room-types').then((res) => res.data || []);
    load.then((types) => setApiRooms(types.map(toCard)))
      .catch(() => { setApiRooms([]); setLoadError(true); })
      .finally(() => setIsSearchingApi(false));
  }, [q.in, q.out, q.guests]);

  const guests = +q.guests || 2;
  const sourceList = apiRooms || [];
  const list = sourceList.filter((r) => r.price <= price && r.guests >= guests && (cat === 'all' || r.cat === cat));
  const carry = q.in ? `?${new URLSearchParams({ in: q.in, out: q.out, guests: q.guests })}` : '';

  return (
    <div className="c-wrap c-section">
      <div className="between">
        <h1 className="title">Available rooms</h1>
        {isSearchingApi && <small className="muted">Checking room availability live...</small>}
      </div>
      <SearchBar key={route0(q)} q={q} />
      <div className="c-layout">
        <aside className="panel filters" aria-label="Filters">
          <h2>Filters</h2>
          <label>Max price: {money(price)}<input type="range" min="1000000" max="10000000" step="500000" value={price} onChange={(e) => setPrice(+e.target.value)} /></label>
          <label>Category<select value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">All</option><option value="standard">Standard</option><option value="suite">Suites</option></select></label>
        </aside>
        <div>
          <p className="muted">
            {list.length} room type(s) available for {guests} guest(s)
            {apiRooms !== null && <span style={{ marginLeft: 8, color: 'var(--green)' }}>● Live verified from server</span>}
          </p>
          <div className="c-grid g2">{list.map((r) => <RoomCard key={r.id} r={r} q={carry} />)}</div>
          {!isSearchingApi && !list.length && <p className="empty">{loadError ? 'Rooms could not be loaded. Please try again in a moment.' : 'No rooms match your dates or filters. Try other dates or raise the maximum price.'}</p>}
        </div>
      </div>
    </div>
  );
}

// Room types are public (no staff endpoint), so customers always see the real name, photos and price.
function useRoomType(id) {
  const [state, setState] = useState({ room: null, loading: true });
  useEffect(() => {
    setState({ room: null, loading: true });
    api('/public/room-types')
      .then((res) => { const rt = (res.data || []).find((t) => t._id === id); setState({ room: rt ? toCard(rt) : null, loading: false }); })
      .catch(() => setState({ room: null, loading: false }));
  }, [id]);
  return state;
}

function RoomDetail({ id, q }) {
  const { room: r, loading: roomLoading } = useRoomType(id);

  const [d, setD] = useState({ in: q.in || day(7), out: q.out || day(10), guests: +q.guests || 2, coupon: '' });
  const policies = usePolicies();
  const nights = nightsBetween(d.in, d.out);
  const coupon = d.coupon.trim().toUpperCase();
  const total = nights * (r?.price || 0);
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });

  const go = (e) => {
    e.preventDefault();
    // Use MongoDB _id when available so Checkout can send correct roomTypeId to backend
    const roomKey = r._id || r.id;
    location.hash = `#/checkout?${new URLSearchParams({ room: roomKey, in: d.in, out: d.out, guests: d.guests, coupon })}`;
  };

  if (roomLoading) return <div className="c-wrap c-section"><p className="muted">Loading room details…</p></div>;
  if (!r) return <div className="c-wrap c-section"><p className="empty">This room is no longer available. <a href="#/rooms">See all rooms</a></p></div>;

  return (
    <div className="c-wrap c-section">
      <a className="more-link" href="#/rooms"><span aria-hidden="true">←</span> All rooms</a>
      <div className="c-layout detail">
        <div>
          <img className="hero-img" src={r.img} alt={`${r.name} room`} width="900" height="600" />
          <div className="between mt"><h1 className="title">{r.name}</h1>{r.rating && <Stars n={r.rating} />}</div>
          <p className="kicker">{[r.bed, r.size && `${r.size} m²`, `Up to ${r.guests} guests`].filter(Boolean).join(' · ')}</p>
          <p>{r.desc}</p>
          <h2>Amenities</h2>
          <ul className="tags big">{r.amenities.map((a) => <li key={a}>{a}</li>)}</ul>
          <h2 className="mt">Policies</h2>
          <PolicyText p={policies} />
        </div>
        <form className="panel book" onSubmit={go}>
          <p className="price"><strong>{money(r.price)}</strong> <span className="muted">/ night</span></p>
          <label>Check-in<input type="date" value={d.in} min={day(0)} onChange={set('in')} required /></label>
          <label>Check-out<input type="date" value={d.out} min={d.in} onChange={set('out')} required /></label>
          <label>Guests<select value={d.guests} onChange={set('guests')}>{Array.from({ length: r.guests }, (_, i) => <option key={i}>{i + 1}</option>)}</select></label>
          <label>Promo code (optional)<input value={d.coupon} onChange={set('coupon')} placeholder="DIRECT15" autoCapitalize="characters" /></label>
          {coupon && <small className="muted">The code is checked when your booking is created.</small>}
          <dl className="sum">
            <div><dt>{money(r.price)} × {nights} night(s)</dt><dd>{money(nights * r.price)}</dd></div>
            <div className="tot"><dt>{coupon ? 'Total before discount' : 'Total'}</dt><dd>{money(total)}</dd></div>
          </dl>
          <button className="btn primary" type="submit" disabled={!nights}>
            {nights ? 'Continue to checkout' : 'Choose valid dates'}
          </button>
        </form>
      </div>
    </div>
  );
}

// UC07: Make Reservation (Core)
function Checkout({ q, user }) {
  const { user: authUser } = useAuth();
  const currentUser = user || authUser;

  const { room: r, loading: checkoutLoading } = useRoomType(q.room);
  const nights = nightsBetween(q.in, q.out);
  const total = nights * (r?.price || 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const confirm = async (e) => {
    e.preventDefault();

    setSaving(true);
    setError('');

    try {
      const created = await api('/bookings', { method: 'POST', body: {
        roomTypeId: r._id, checkInDate: q.in, checkOutDate: q.out,
        guestCount: Number(q.guests), couponCode: q.coupon || undefined
      } });
      // A pending booking goes straight to the deposit payment (UC10); one with nothing to pay is already confirmed.
      location.hash = created.data.status === 'pending' ? `#/pay/${created.data._id}?kind=deposit` : `#/confirmation?${new URLSearchParams({ ref: created.data.bookingReference })}`;
    } catch (err) { setError(err.message || 'Unable to create your booking.'); }
    finally { setSaving(false); }
  };


  if (checkoutLoading) return <div className="c-wrap c-section"><p className="muted">Loading room details…</p></div>;
  if (!r) return <div className="c-wrap c-section"><p className="empty">This room is no longer available. <a href="#/rooms">See all rooms</a></p></div>;



  return (
    <div className="c-wrap c-section">
      <h1 className="title">Checkout</h1>
      <div className="c-layout detail">
        <form className="panel form" onSubmit={confirm} id="co">
          {currentUser && (
            <div style={{ background: 'var(--green-bg)', color: 'var(--green)', padding: '.65rem 1rem', borderRadius: 8, fontSize: '.9rem', marginBottom: '1rem', gridColumn: '1 / -1' }}>
              ✓ Signed in as <strong>{currentUser.fullName || currentUser.email}</strong>
            </div>
          )}
          <h2 className="full">Guest details</h2>
          <label>Full name<input name="fullName" required autoComplete="name" defaultValue={currentUser?.customerProfile?.fullName || currentUser?.fullName || ''} /></label>
          <label>Email<input name="email" type="email" required autoComplete="email" defaultValue={currentUser?.email || ''} /></label>
          <label>Phone<input name="phone" type="tel" required autoComplete="tel" defaultValue={currentUser?.phone || ''} /></label>
          <label>Special requests<input name="specialRequests" placeholder="Late arrival, high floor, quiet room…" /></label>
          <fieldset className="full">
            <legend>Payment</legend>
            <p className="muted">Pay the deposit online now to confirm your booking. The room is held for 15 minutes while you pay. The rest is paid at the front desk when you check out.</p>
          </fieldset>
          {error && <p className="note bad-note full" role="alert">{error}</p>}
          <button className="btn primary" type="submit" disabled={saving}>{saving ? 'Creating booking…' : 'Continue to deposit payment'}</button>
        </form>
        <aside className="panel book">
          <img className="thumb" src={r.img} alt="" />
          <h2>{r.name}</h2>
          <p className="muted">{q.in} → {q.out} · {nights} night(s) · {q.guests} guest(s)</p>
          <dl className="sum">
            <div><dt>Room</dt><dd>{money(nights * r.price)}</dd></div>
            {q.coupon && <div><dt>Promo code</dt><dd>{q.coupon}</dd></div>}
            <div className="tot"><dt>{q.coupon ? 'Total before discount' : 'Total'}</dt><dd>{money(total)}</dd></div>
          </dl>
        </aside>
      </div>
    </div>
  );
}

const Confirmation = ({ q }) => (
  <div className="c-wrap c-section center">
    <p className="done" aria-hidden="true">✓</p>
    <h1 className="title">Booking confirmed</h1>
    <p className="muted">Your booking code is <strong>{q.ref || 'confirmed'}</strong>. A confirmation email is on its way.</p>
    <p><a className="btn primary" href="#/my-bookings">View my bookings</a></p>
  </div>
);

function Auth({ note }) {
  const [mode, setMode] = useState('login');
  const [resetSuccess, setResetSuccess] = useState(null);
  const { user, signOut } = useAuth();
  const done = () => { location.hash = sessionStorage.getItem('next') || '#/my-bookings'; sessionStorage.removeItem('next'); };
  if (user) {
    return (
      <AuthShell>
        <h1>Already signed in</h1>
        <p className="muted">You are currently signed in as <strong>{user.customerProfile?.fullName || user.fullName || user.email}</strong>.</p>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
          <button className="btn primary" onClick={done}>Go to My bookings</button>
          <button className="btn" style={{ color: "#d32f2f", borderColor: "#d32f2f", background: "transparent" }} onClick={async () => { await signOut(); location.hash = "#/login"; }}>Sign out</button>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell>
      <h1>{mode === 'login' ? 'Welcome back' : mode === 'register' ? 'Create your account' : 'Reset password'}</h1>
      <p className="muted">
        {mode === 'login' ? 'Sign in to manage your bookings.' : mode === 'register' ? 'Book faster and keep every stay in one place.' : 'Enter your details to reset your password.'}
      </p>
      {mode !== 'forgot' && <AuthTabs mode={mode} onChange={(m) => { setMode(m); setResetSuccess(null); }} />}
      {resetSuccess && <p role="status" className="note ok-note">{resetSuccess}</p>}
      {note && <p className="note">{note}</p>}
      {mode === 'login' && <SignIn onDone={done} onForgot={() => { setMode('forgot'); setResetSuccess(null); }} />}
      {mode === 'register' && <Register onDone={(email) => { setMode('login'); setResetSuccess(`Account created. We sent a verification link to ${email}. Open it, then sign in.`); }} />}
      {mode === 'forgot' && (
        <ForgotPassword
          onDone={() => {
            setMode('login');
            setResetSuccess('Password has been reset successfully. Please sign in with your new password.');
          }}
          onCancel={() => setMode('login')}
        />
      )}
    </AuthShell>
  );
}

// Target of the link in the verification email: #/verify-email?token=…&email=…
function VerifyEmail({ token, email }) {
  const [state, setState] = useState({ busy: true });
  useEffect(() => {
    api('/auth/verify-email', { method: 'POST', body: { token: token || '', ...(email ? { email } : {}) } })
      .then((r) => setState({ ok: r.data.message }))
      .catch((x) => setState({ error: x }));
  }, [token, email]);
  return (
    <AuthShell>
      <h1>Email verification</h1>
      {state.busy ? <p className="muted">Verifying your email…</p> : <Notice error={state.error} ok={state.ok} />}
      {state.error && <p className="muted">If the link expired, try signing in and choose "Resend verification email".</p>}
      <p><a className="btn primary" href="#/login">Go to sign in</a></p>
    </AuthShell>
  );
}

function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="c-wrap c-grid g4">
        <div><a className="brand" href="#/">Grand<span>Stay</span></a><p>A seaside retreat in Da Nang, Vietnam.</p></div>
        <div><h4>Explore</h4><a href="#/rooms">Rooms &amp; suites</a><a href="#/offers">Booking policies</a><a href="#/my-bookings">My bookings</a></div>
        <div><h4>Guests</h4><a href="#/login">Sign in or register</a><a href="#/profile">My profile</a></div>
        <div><h4>Contact</h4><p>hello@grandstay.example</p><p>+84 000 000 000</p><a href="#/admin">Staff portal</a></div>
      </div>
      <p className="copy">© 2026 GrandStay · WDP301</p>
    </footer>
  );
}

const PROTECTED = ['#/checkout', '#/confirmation', '#/my-bookings', '#/profile'];

export default function Customer({ route }) {
  const { user, loading } = useAuth();
  const [path, q] = parse(route);

  let page;
  if (loading) page = <p className="muted c-wrap c-section">Loading…</p>;
  else if ((PROTECTED.includes(path) || path.startsWith('#/pay/')) && !user) { sessionStorage.setItem('next', route); page = <Auth note="Please sign in to continue." />; }
  else if (path === '#/profile') page = <div className="c-wrap c-section"><Profile /></div>;
  else
  if (path === '#/pay/result') page = <PaymentResult paymentId={q.payment} back={q.r} />;
  else if (path.startsWith('#/pay/sandbox/')) page = <SandboxGateway orderId={path.split('/')[3]} paymentId={q.payment} />;
  else if (path.startsWith('#/pay/')) page = <PaymentPage id={path.split('/')[2]} kind={q.kind} />;
  else if (path.startsWith('#/room/')) page = <RoomDetail id={path.split('/')[2]} q={q} />;
  else if (path === '#/rooms') page = <Rooms q={q} />;
  else if (path === '#/offers') page = <Offers />;
  else if (path === '#/checkout') page = <Checkout q={q} user={user} />;
  else if (path === '#/confirmation') page = <Confirmation q={q} />;
  else if (path === '#/my-bookings') page = <MyBookings />;
  else if (path === '#/login') page = <Auth />;
  else if (path === '#/verify-email') page = <VerifyEmail token={q.token} email={q.email} />;
  else page = <Home />;

  return (
    <div className="cx">
      <a className="skip" href="#main">Skip to content</a>
      <SiteHeader route={route} />
      <main id="main">{page}</main>
      <SiteFooter />
    </div>
  );
}
