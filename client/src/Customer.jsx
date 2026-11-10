import { useEffect, useRef, useState } from 'react';
import { useAuth } from './context/Auth.jsx';
import { AuthShell, AuthTabs, SignIn, Register, ForgotPassword, Captcha } from './AuthForms.jsx';
import { ChangePassword, Profile } from './AdminPages.jsx';
import { MyBookings } from './Bookings.jsx';
import { roomApi } from './api/roomApi.js';
import { PaymentPage, PaymentResult, SandboxGateway } from './Payments.jsx';
import { api, dateLabel, money } from './api/client.js';
import './resort.css';
import NotificationBell, { NotificationsPage } from './Notifications.jsx';
import { Notice } from './ui.jsx';

const NAV = [
  { label: 'Home', href: '#/' },
  { label: 'Rooms', href: '#/rooms' },
  { label: 'Offers & policies', href: '#/offers' }
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
            {staff ? (
              <>
                <a className="btn gold" href="#/admin" onClick={done}>Staff portal</a>
                <button className="signin" onClick={async () => { done(); await signOut(); location.hash = '#/'; }}>Sign out</button>
              </>
            ) : user ? (
              <>
                <a className="btn gold" href="#/rooms" onClick={done}>Book now</a>
                <NotificationBell bookingHref="#/my-bookings" allHref="#/notifications" />
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
      <label>Check-in<input name="in" type="date" min={day(0)} defaultValue={q.in || day(7)} required /></label>
      <label>Check-out<input name="out" type="date" min={day(1)} defaultValue={q.out || day(10)} required /></label>
      <label>Guests<select name="guests" defaultValue={q.guests || "2"}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></label>
      <button className="btn gold" type="submit">Search rooms</button>
    </form>
  );
}

// `q` carries the searched stay ("?in=…&out=…&guests=…"): the card then shows the price of that stay, the rooms left and "Book now" (UC04).
function RoomCard({ r, q = '' }) {
  const { user } = useAuth();
  const canBook = !user || user.scope === 'self'; // staff and Admin accounts do not book online (BR-26)
  return (
    <article className="c-card">
      <a className="c-media" href={`#/room/${r.id}${q}`} tabIndex={-1} aria-hidden="true">
        <Pic src={r.img} alt="" loading="lazy" width="900" height="1125" />
        <span className="c-price">{r.nights ? <><b>{money(r.stayAmount)}</b> for {r.nights} night{r.nights > 1 ? 's' : ''}</> : <>From <b>{money(r.price)}</b> / night</>}</span>
      </a>
      <div className="c-body">
        <p className="kicker">{[r.bed, r.size && `${r.size} m²`, `Up to ${r.guests} guests`].filter(Boolean).join(' · ')}</p>
        <h3><a href={`#/room/${r.id}${q}`}>{r.name}</a></h3>
        {r.amenities.length > 0 && <ul className="tags">{r.amenities.map((a) => <li key={a}>{a}</li>)}</ul>}
        {r.nights > 0 && <p className="muted">{r.roomsLeft} room{r.roomsLeft > 1 ? 's' : ''} left for these dates</p>}
        <div className="promo-actions">
          {r.nights > 0 && canBook && <a className="btn gold" href={`#/checkout${q}&room=${r.id}`}>Book now</a>}
          <a className="more-link" href={`#/room/${r.id}${q}`}>View room <span aria-hidden="true">→</span></a>
        </div>
      </div>
    </article>
  );
}

let hotelReq;
// The hotel's own name, city and contact details (Hotel & policies screen), fetched once.
function useHotel() {
  const [h, setH] = useState(null);
  useEffect(() => {
    hotelReq ??= api('/hotel-info').then((x) => x.data).catch(() => { hotelReq = null; return null; });
    hotelReq.then(setH);
  }, []);
  return h;
}
function usePromos() {
  const [list, setList] = useState([]);
  useEffect(() => { api('/public/promotions').then((x) => setList(x.data)).catch(() => {}); }, []);
  return list;
}
const off = (c) => (c.discountType === 'fixed' ? money(c.discountValue) : `${c.discountValue}%`);
const Pic = ({ src, ...p }) => (src ? <img src={src} {...p} /> : <div className="img-ph" />);

function Home() {
  const perks = [
    ['Best price guarantee', 'Seasonal rates are applied automatically; enter a promo code at checkout.', 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z M7 7h.01'],
    ['Verified reviews', 'Only guests who stayed can review.', 'M12 2l3 6.3 6.9.9-5 4.8 1.2 6.9L12 17.5 5.9 20.9 7.1 14 2.1 9.2l6.9-.9z'],
    ['Secure payment', 'Pay a deposit online, the rest when you check out.', 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4']
  ];

  const hotel = useHotel();
  const promos = usePromos();
  const policy = usePolicies();
  const fullRefundHours = Math.max(...(policy?.cancellationTiers || []).filter((t) => t.refundPercent === 100).map((t) => t.minHoursBeforeCheckIn), -1);
  if (fullRefundHours >= 0) perks.splice(1, 0, ['Free cancellation', `Full deposit back when you cancel ${fullRefundHours ? `at least ${fullRefundHours} hours before check-in` : 'in time'}.`, 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 8v4l3 2']);
  const [featuredRooms, setFeaturedRooms] = useState([]);
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    roomTypeServiceFetch();
  }, []);

  const roomTypeServiceFetch = async () => {
    try {
      const res = await roomApi.getRoomTypes({ isActive: true });
      if (res.data && res.data.length > 0) {
        const mapped = res.data.slice(0, 3).map(toCard);
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
          {hotel && <p className="eyebrow">{[hotel.name, hotel.city].filter(Boolean).join(' · ')}</p>}
          <h1>Where the sea<br />meets stillness</h1>
          <p className="lead">Ocean-view rooms and suites, a quiet pool above the beach, and a team that takes care of the details.</p>
        </div>
        <div className="c-wrap"><SearchBar /></div>
      </section>

      <section className="c-wrap c-section intro">
        <div>
          <p className="eyebrow ink">Welcome</p>
          <h2 className="display">A five-star retreat{hotel?.city ? ` in ${hotel.city}` : ''}</h2>
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

      {promos[0] && (
        <section className="band">
          <div className="c-wrap band-copy">
            <p className="eyebrow">Book direct</p>
            <h2 className="display light">Save {off(promos[0])} when you book with us</h2>
            <p>{off(promos[0])} off{promos[0].minimumSpend ? ` stays from ${money(promos[0].minimumSpend)}` : ' your stay'}, applied when you enter the code at checkout.</p>
            <div className="promo-actions">
              <a className="btn gold" href="#/rooms">Book your stay</a>
              <span className="promo-code">Code <b>{promos[0].code}</b></span>
            </div>
          </div>
        </section>
      )}

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
  const promos = usePromos();
  return (
    <div className="c-wrap c-section narrow">
      <h1 className="title">Booking policies</h1>
      <div className="panel"><h2>Deposit &amp; cancellation</h2><PolicyText p={p} /></div>
      {promos.length > 0 && <div className="panel mt"><h2>Promo codes</h2><ul className="policy-list">{promos.map((c) => <li key={c.code}><b>{c.code}</b>: {off(c)} off{c.minimumSpend ? ` stays from ${money(c.minimumSpend)}` : ''}, valid until {new Date(c.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}. Enter it at checkout.</li>)}</ul></div>}
    </div>
  );
}

// Room-type card shape used by the room list, detail and checkout pages. A search result also has the price of the
// stay, its nights and the rooms left (GET /public/availability).
const toCard = (rt) => ({
  id: rt._id, _id: rt._id, name: rt.name, price: rt.basePrice, guests: rt.maxOccupancy,
  bed: rt.bedType || '', size: rt.roomSizeSqm || null, amenities: rt.amenities || [],
  img: rt.images?.[0] || '', desc: rt.description || '',
  stayAmount: rt.stayAmount, nights: rt.nights, roomsLeft: rt.roomsLeft,
});
const availability = (d) => api(`/public/availability?${new URLSearchParams({ checkIn: d.in, checkOut: d.out, guests: d.guests || 1 })}`).then((res) => res.data || []);

// The amenity tags are typed by the Hotel Manager (Room types); the filter groups them without caring about case or spaces.
const tagKey = (t) => t.trim().toLowerCase();
const NO_FILTER = { text: '', min: '', max: '', size: '', guests: '', beds: [], tags: [], sort: 'price_asc' };
const SORTS = { price_asc: ['Price: low to high', (a, b, cost) => cost(a) - cost(b)], price_desc: ['Price: high to low', (a, b, cost) => cost(b) - cost(a)], size_desc: ['Largest first', (a, b) => (b.size || 0) - (a.size || 0)], guests_desc: ['Most guests first', (a, b) => b.guests - a.guests], name: ['Name A-Z', (a, b) => a.name.localeCompare(b.name)] };
function Rooms({ q }) {
  const [f, setF] = useState(NO_FILTER);
  const [state, setState] = useState({ rooms: null, error: '' });

  // With dates: only room types that still have a free room for the whole stay (UC04). Without dates: every active room type.
  useEffect(() => {
    setState({ rooms: null, error: '' });
    (q.in && q.out ? availability(q) : api('/public/room-types').then((res) => res.data || []))
      .then((types) => setState({ rooms: types.map(toCard), error: '' }))
      .catch((x) => setState({ rooms: [], error: x.status === 400 ? x.message : 'Rooms could not be loaded. Please try again in a moment.' }));
  }, [q.in, q.out, q.guests]);

  const rooms = state.rooms || [];
  const searched = Boolean(q.in && q.out);
  const cost = (r) => (searched ? r.stayAmount : r.price);
  const set = (patch) => setF({ ...f, ...patch });
  const toggle = (key, value) => set({ [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value] });
  // Filter options come from the rooms themselves, so a tag the manager adds shows up here without a code change.
  const tags = [...new Map(rooms.flatMap((r) => r.amenities).map((t) => [tagKey(t), t.trim()])).values()].sort((x, y) => x.localeCompare(y));
  const beds = [...new Set(rooms.map((r) => r.bed).filter(Boolean))].sort();
  const sizes = [...new Set(rooms.map((r) => r.size).filter(Boolean))].sort((x, y) => x - y);
  const capacities = [...new Set(rooms.map((r) => r.guests))].sort((x, y) => x - y);
  const text = f.text.trim().toLowerCase();
  const list = rooms
    .filter((r) => (!q.guests || r.guests >= +q.guests) && (!f.guests || r.guests >= +f.guests)
      && (!f.min || cost(r) >= +f.min) && (!f.max || cost(r) <= +f.max)
      && (!f.size || (r.size || 0) >= +f.size) && (!f.beds.length || f.beds.includes(r.bed))
      && f.tags.every((t) => r.amenities.some((a) => tagKey(a) === tagKey(t)))
      && (!text || `${r.name} ${r.desc}`.toLowerCase().includes(text)))
    .sort((x, y) => SORTS[f.sort][1](x, y, cost));
  const active = ['text', 'min', 'max', 'size', 'guests'].filter((k) => f[k]).length + f.beds.length + f.tags.length;
  const carry = searched ? `?${new URLSearchParams({ in: q.in, out: q.out, guests: q.guests || 1 })}` : '';
  const unit = searched ? 'for the stay' : 'per night';

  return (
    <div className="c-wrap c-section">
      <div className="between">
        <h1 className="title">{searched ? 'Available rooms' : 'Rooms & suites'}</h1>
        {!state.rooms && <small className="muted">Checking room availability live...</small>}
      </div>
      <SearchBar key={route0(q)} q={q} />
      {!searched && <p className="muted">Choose your dates and search to see prices, rooms left and book.</p>}
      <div className="c-layout">
        {/* On a phone the filters start folded so the rooms come first; on a wide screen they start open. */}
        <details className="panel filters" open={window.matchMedia('(min-width: 1000px)').matches}>
          <summary><h2>Filters{active > 0 ? ` (${active})` : ''}</h2></summary>
          <label>Search by name<input type="search" value={f.text} onChange={(e) => set({ text: e.target.value })} placeholder="e.g. Suite" /></label>
          <fieldset>
            <legend>{searched ? 'Stay price' : 'Night price'} (VND)</legend>
            <div className="price-row">
              <input type="number" min="0" step="100000" aria-label={`Minimum price ${unit}`} placeholder="From" value={f.min} onChange={(e) => set({ min: e.target.value })} />
              <input type="number" min="0" step="100000" aria-label={`Maximum price ${unit}`} placeholder="To" value={f.max} onChange={(e) => set({ max: e.target.value })} />
            </div>
          </fieldset>
          <label>Guests<select value={f.guests} onChange={(e) => set({ guests: e.target.value })}><option value="">Any</option>{capacities.map((n) => <option key={n} value={n}>{n}+ guests</option>)}</select></label>
          {sizes.length > 0 && <label>Room size<select value={f.size} onChange={(e) => set({ size: e.target.value })}><option value="">Any</option>{sizes.map((n) => <option key={n} value={n}>{n} m² or more</option>)}</select></label>}
          {beds.length > 0 && <fieldset><legend>Bed type</legend>{beds.map((b) => <label className="check" key={b}><input type="checkbox" checked={f.beds.includes(b)} onChange={() => toggle('beds', b)} /> {b}</label>)}</fieldset>}
          {tags.length > 0 && <fieldset><legend>Amenities</legend>{tags.map((t) => <label className="check" key={t}><input type="checkbox" checked={f.tags.some((x) => tagKey(x) === tagKey(t))} onChange={() => toggle('tags', t)} /> {t}</label>)}</fieldset>}
          {active > 0 && <button type="button" className="btn" onClick={() => setF({ ...NO_FILTER, sort: f.sort })}>Clear all filters</button>}
        </details>
        <div>
          <div className="between">
            <p className="muted" role="status">{state.rooms ? `${list.length} of ${rooms.length} room type${rooms.length === 1 ? '' : 's'}` : ''}</p>
            <label className="sort">Sort by<select value={f.sort} onChange={(e) => set({ sort: e.target.value })}>{Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}</select></label>
          </div>
          <div className="c-grid g2">{list.map((r) => <RoomCard key={r.id} r={r} q={carry} />)}</div>
          {state.rooms && !list.length && <p className="empty" role={state.error ? 'alert' : undefined}>{state.error || 'No rooms match your dates or filters. Try other dates, fewer guests or fewer filters.'}{active > 0 && !state.error && <> <button type="button" className="more-link" onClick={() => setF({ ...NO_FILTER, sort: f.sort })}>Clear all filters</button></>}</p>}
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
  const { user: viewer } = useAuth();
  const staffViewer = viewer && viewer.scope !== 'self';

  const [d, setD] = useState({ in: q.in || day(7), out: q.out || day(10), guests: +q.guests || 2 });
  const policies = usePolicies();
  const nights = nightsBetween(d.in, d.out);
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  // UC05: the price of the selected dates and the rooms left; "Book now" only while the room type is available (BR-10).
  const [stay, setStay] = useState({ loading: true });
  useEffect(() => {
    if (!nights) { setStay({}); return undefined; }
    let live = true;
    setStay({ loading: true });
    availability(d).then((types) => live && setStay({ found: types.find((t) => t._id === id) || null })).catch((x) => live && setStay({ error: x.message }));
    return () => { live = false; };
  }, [id, d.in, d.out, d.guests]);
  const [reviews, setReviews] = useState(null);
  useEffect(() => { api(`/public/room-types/${id}/reviews?limit=5`).then(setReviews).catch(() => setReviews(null)); }, [id]);

  const go = (e) => {
    e.preventDefault();
    location.hash = `#/checkout?${new URLSearchParams({ room: r._id, in: d.in, out: d.out, guests: d.guests })}`;
  };

  if (roomLoading) return <div className="c-wrap c-section"><p className="muted">Loading room details…</p></div>;
  if (!r) return <div className="c-wrap c-section"><p className="empty">This room is no longer available. <a href="#/rooms">See all rooms</a></p></div>;
  const summary = reviews?.meta?.summary;
  const rated = summary?.count > 0;

  return (
    <div className="c-wrap c-section">
      <a className="more-link" href="#/rooms"><span aria-hidden="true">←</span> All rooms</a>
      <div className="c-layout detail">
        <div>
          <Pic className="hero-img" src={r.img} alt={`${r.name} room`} width="900" height="600" />
          <div className="between mt"><h1 className="title">{r.name}</h1>{rated && <span><Stars n={summary.averageRating} /> <small className="muted">{summary.averageRating.toFixed(1)} · {summary.count} review{summary.count > 1 ? 's' : ''}</small></span>}</div>
          <p className="kicker">{[r.bed, r.size && `${r.size} m²`, `Up to ${r.guests} guests`].filter(Boolean).join(' · ')}</p>
          <p>{r.desc}</p>
          <h2>Amenities</h2>
          <ul className="tags big">{r.amenities.map((a) => <li key={a}>{a}</li>)}</ul>
          <h2 className="mt">Policies</h2>
          <PolicyText p={policies} />
          <h2 className="mt">Guest reviews</h2>
          {rated
            ? <ul className="policy-list">{reviews.data.map((v) => <li key={v._id}><Stars n={v.rating} /> <small className="muted">{dateLabel(v.createdAt)}</small>{(v.comment || v.title) && <p>{v.comment || v.title}</p>}</li>)}</ul>
            : <p className="muted">No reviews yet. Only guests who completed a stay can review.</p>}
        </div>
        <form className="panel book" onSubmit={go}>
          <p className="price"><strong>{money(r.price)}</strong> <span className="muted">/ night</span></p>
          <label>Check-in<input type="date" value={d.in} min={day(0)} onChange={set('in')} required /></label>
          <label>Check-out<input type="date" value={d.out} min={d.in} onChange={set('out')} required /></label>
          <label>Guests<select value={d.guests} onChange={set('guests')}>{Array.from({ length: r.guests }, (_, i) => <option key={i}>{i + 1}</option>)}</select></label>
          {stay.found && <dl className="sum">
            <div className="tot"><dt>{nights} night{nights > 1 ? 's' : ''}</dt><dd>{money(stay.found.stayAmount)}</dd></div>
            <div><dt>Rooms left</dt><dd>{stay.found.roomsLeft}</dd></div>
          </dl>}
          {stay.found === null && <p className="note bad-note" role="alert">No room of this type is available for these dates. Try other dates.</p>}
          {stay.error && <p className="note bad-note" role="alert">{stay.error}</p>}
          <button className="btn primary" type="submit" disabled={!stay.found || staffViewer}>
            {staffViewer ? 'Staff accounts do not book online' : !nights ? 'Choose valid dates' : stay.loading ? 'Checking availability…' : stay.found ? 'Book now' : 'Not available'}
          </button>
          <small className="muted">Promo codes are entered at checkout.</small>
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
  const policies = usePolicies();
  const nights = nightsBetween(q.in, q.out);
  const [saving, setSaving] = useState(false);
  // UC06 steps 2-4: the server prices the stay (every night at its rate, coupon, deposit). A coupon that is not valid is
  // reported and the booking continues without the discount (4a).
  const [typed, setTyped] = useState(q.coupon || ''); const [coupon, setCoupon] = useState(q.coupon || '');
  const [quote, setQuote] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setQuote({ loading: true });
    api('/bookings/quote', { method: 'POST', body: { roomTypeId: q.room, checkInDate: q.in, checkOutDate: q.out, ...(coupon ? { couponCode: coupon } : {}) } })
      .then((res) => live && setQuote({ data: res.data })).catch((x) => live && setQuote({ error: x.message }));
    return () => { live = false; };
  }, [q.room, q.in, q.out, coupon]);
  const price = quote.data;
  const [error, setError] = useState('');
  const [token, setToken] = useState(''); const [tries, setTries] = useState(0);
  // UC06 steps 3-5: contact data (pre-filled from the profile), privacy consent (CR-21) and CAPTCHA (BR-29).
  const confirm = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    setSaving(true);
    setError('');

    try {
      const created = await api('/bookings', { method: 'POST', body: {
        roomTypeId: r._id, checkInDate: q.in, checkOutDate: q.out,
        guestCount: Number(q.guests), couponCode: coupon && !price?.couponError ? coupon : undefined,
        fullName: f.fullName, email: f.email, phone: f.phone, consent: f.consent === 'on', captchaToken: token || undefined,
      } });
      // A pending booking goes straight to the deposit payment (UC10); one with nothing to pay is already confirmed.
      location.hash = created.data.status === 'pending' ? `#/pay/${created.data._id}?kind=deposit` : `#/confirmation?${new URLSearchParams({ ref: created.data.bookingReference })}`;
    } catch (err) { setError(err.message || 'Unable to create your booking.'); setTries((t) => t + 1); }
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
          <label>Phone<input name="phone" type="tel" required autoComplete="tel" pattern="([0-9]{10,11}|\+[0-9]{8,15})" title="10–11 digits, or + and 8–15 digits with the country code." defaultValue={currentUser?.phone || ''} /></label>
          <fieldset className="full">
            <legend>Payment</legend>
            <p className="muted">Pay the deposit online now to confirm your booking. The room is held for 15 minutes while you pay. The rest is paid at the front desk when you check out.</p>
          </fieldset>
          <div className="full"><h2>Cancellation &amp; refund policy</h2><PolicyText p={policies} /></div>
          <label className="check full"><input type="checkbox" name="consent" required /><span className="consent-text">I agree to the processing of my personal data (<a href="#/offers" target="_blank" rel="noreferrer">privacy notice</a>) *</span></label>
          <div className="full"><Captcha onToken={setToken} resetKey={tries} /></div>
          {error && <p className="note bad-note full" role="alert">{error}</p>}
          <button className="btn primary" type="submit" disabled={saving || !price?.available}>{saving ? 'Creating booking…' : 'Continue to deposit payment'}</button>
        </form>
        <aside className="panel book">
          <Pic className="thumb" src={r.img} alt="" />
          <h2>{r.name}</h2>
          <p className="muted">{dateLabel(q.in)} → {dateLabel(q.out)} · {nights} night(s) · {q.guests} guest(s)</p>
          <div className="promo-actions">
            <input aria-label="Promo code" placeholder="Promo code" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" />
            <button type="button" className="btn" onClick={() => setCoupon(typed.trim().toUpperCase())} disabled={quote.loading}>Apply</button>
          </div>
          {price?.couponError && <p className="note bad-note" role="alert">{price.couponError} The booking continues without the discount.</p>}
          {quote.error && <p className="note bad-note" role="alert">{quote.error}</p>}
          {price && !price.available && <p className="note bad-note" role="alert">This room type is no longer available for these dates. <a href={`#/rooms?${new URLSearchParams({ in: q.in, out: q.out, guests: q.guests })}`}>See what is available</a></p>}
          {quote.loading ? <p className="muted">Calculating the price…</p> : price && <dl className="sum">
            {price.nights.map((n) => <div key={n.date}><dt>Night of {dateLabel(n.date)}</dt><dd>{money(n.price)}</dd></div>)}
            {price.discountAmount > 0 && <div><dt>Promo code {coupon}</dt><dd>−{money(price.discountAmount)}</dd></div>}
            <div className="tot"><dt>Total</dt><dd>{money(price.totalAmount)}</dd></div>
            <div><dt>Deposit to pay now ({price.depositPercent}%)</dt><dd>{money(price.depositRequired)}</dd></div>
            <div><dt>Pay at check-out</dt><dd>{money(price.totalAmount - price.depositRequired)}</dd></div>
          </dl>}
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

// Target of the link in the password-reset e-mail: #/reset-password?token=…&email=…
function ResetPassword({ token, email }) {
  return (
    <AuthShell>
      <h1>Choose a new password</h1>
      <ForgotPassword link={{ token: token || '', email: email || '' }} onDone={() => { location.hash = '#/login'; }} onCancel={() => { location.hash = '#/login'; }} />
    </AuthShell>
  );
}

function SiteFooter() {
  const hotel = useHotel();
  return (
    <footer className="site-foot">
      <div className="c-wrap c-grid g4">
        <div><a className="brand" href="#/">Grand<span>Stay</span></a>{hotel?.description && <p>{hotel.description}</p>}</div>
        <div><h4>Explore</h4><a href="#/rooms">Rooms &amp; suites</a><a href="#/offers">Booking policies</a><a href="#/my-bookings">My bookings</a></div>
        <div><h4>Guests</h4><a href="#/login">Sign in or register</a><a href="#/profile">My profile</a></div>
        <div><h4>Contact</h4>{hotel?.address && <p>{hotel.address}</p>}{hotel?.email && <p>{hotel.email}</p>}{hotel?.phone && <p>{hotel.phone}</p>}<a href="#/admin">Staff portal</a></div>
      </div>
      {hotel?.name && <p className="copy">© {new Date().getFullYear()} {hotel.name}</p>}
    </footer>
  );
}

const PROTECTED = ['#/checkout', '#/confirmation', '#/my-bookings', '#/profile', '#/profile/password', '#/notifications'];

export default function Customer({ route }) {
  const { user, loading } = useAuth();
  const [path, q] = parse(route);

  let page;
  const customerPage = PROTECTED.includes(path) || path.startsWith('#/pay/');
  if (loading) page = <p className="muted c-wrap c-section">Loading…</p>;
  else if (customerPage && user && user.scope !== 'self') {
    location.replace('#/admin');
    page = <p className="muted c-wrap c-section">This page is for customers. Opening the staff portal…</p>;
  } else if (customerPage && !user) { sessionStorage.setItem('next', route); page = <Auth note="Please sign in to continue." />; }
  else if (path === '#/notifications') page = <div className="c-wrap c-section acct"><NotificationsPage bookingHref="#/my-bookings" /></div>;
  else if (path === '#/profile') page = <div className="c-wrap c-section acct"><Profile base="#/profile" /></div>;
  else if (path === '#/profile/password') page = <div className="c-wrap c-section acct"><ChangePassword base="#/profile" /></div>;
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
  else if (path === '#/reset-password') page = <ResetPassword token={q.token} email={q.email} />;
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
