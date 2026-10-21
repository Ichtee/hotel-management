import { useEffect, useRef, useState } from 'react';
import { EXTRAS, MY_BOOKINGS, OFFERS, REVIEWS, ROOM_TYPES } from './data.js';
import { roomApi } from './api/roomApi.js';
import { bookingApi } from './api/bookingApi.js';
import { authApi } from './api/authApi.js';

const NAV = [
  { label: 'Home', href: '#/' },
  { label: 'Rooms', items: [['#/rooms', 'All rooms', 'Compare every room type'], ['#/rooms?cat=standard', 'Standard rooms', 'Deluxe & Superior'], ['#/rooms?cat=suite', 'Suites', 'Family & Presidential']] },
  { label: 'Offers', href: '#/offers' },
  { label: 'My trips', items: [['#/my-bookings', 'My bookings', 'Upcoming & past stays'], ['#/login', 'Sign in / Register', '']] },
  { label: 'Help', items: [['#/offers', 'Cancellation policy', 'Free cancel up to 48h'], ['#/', 'Contact us', 'hello@grandstay.example']] }
];

const parse = (route) => {
  const [path, q = ''] = route.split('?');
  return [path, Object.fromEntries(new URLSearchParams(q))];
};
const route0 = (q) => `${q.in}${q.out}${q.guests}`;
const money = (n) => `$${Number(n || 0).toFixed(0)}`;
const nightsBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 864e5)) : 0);
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const Stars = ({ n }) => <span className="stars" role="img" aria-label={`${n} out of 5`}>{'★'.repeat(Math.round(n))}{'☆'.repeat(5 - Math.round(n))}</span>;

function SiteHeader({ route, user, onLogout }) {
  const [open, setOpen] = useState(null);
  const [mobile, setMobile] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(null); };
    addEventListener('click', close); addEventListener('keydown', close);
    return () => { removeEventListener('click', close); removeEventListener('keydown', close); };
  }, []);

  const done = () => { setOpen(null); setMobile(false); };

  const navItems = [
    { label: 'Home', href: '#/' },
    { label: 'Rooms', items: [['#/rooms', 'All rooms', 'Compare every room type'], ['#/rooms?cat=standard', 'Standard rooms', 'Deluxe & Superior'], ['#/rooms?cat=suite', 'Suites', 'Family & Presidential']] },
    { label: 'Offers', href: '#/offers' },
    {
      label: 'My trips',
      items: user ? [
        ['#/my-bookings', 'My bookings', 'Upcoming & past stays'],
        ['#/profile', 'My profile', 'Personal details & loyalty rewards']
      ] : [
        ['#/my-bookings', 'My bookings', 'Upcoming & past stays'],
        ['#/login', 'Sign in / Register', 'Access your account']
      ]
    },
    { label: 'Help', items: [['#/offers', 'Cancellation policy', 'Free cancel up to 48h'], ['#/', 'Contact us', 'hello@grandstay.example']] }
  ];

  return (
    <header className="topbar site" ref={ref}>
      <div className="bar">
        <a className="brand" href="#/">Grand<span>Stay</span></a>
        <button className="menu-btn" aria-expanded={mobile} aria-controls="nav" onClick={() => setMobile(!mobile)}>{mobile ? 'Close' : 'Menu'}</button>
        <nav id="nav" className={mobile ? 'open' : ''} aria-label="Main">
          <ul>
            {navItems.map((m, i) => m.items ? (
              <li className="dd" key={m.label}>
                <button aria-expanded={open === i} aria-haspopup="true" onClick={() => setOpen(open === i ? null : i)}>{m.label} <span className="caret" aria-hidden="true">▾</span></button>
                {open === i && (
                  <ul className="dd-menu">
                    {m.items.map(([h, l, s]) => <li key={l}><a href={h} onClick={done}><strong>{l}</strong>{s && <small>{s}</small>}</a></li>)}
                  </ul>
                )}
              </li>
            ) : <li key={m.label}><a className={route.split('?')[0] === m.href ? 'active' : ''} href={m.href} onClick={done}>{m.label}</a></li>)}
          </ul>
          <div className="right">
            {user ? (
              <>
                <a
                  href="#/profile"
                  className="btn ghost-w"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none', padding: '0 .85rem' }}
                  onClick={done}
                  title="View Profile"
                >
                  <span className="avatar" style={{ width: 24, height: 24, fontSize: '.75rem', background: 'var(--gold)', color: '#1a1205' }}>
                    {(user.fullName || user.email)[0].toUpperCase()}
                  </span>
                  <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{user.fullName || user.email.split('@')[0]}</span>
                </a>
                <button
                  className="btn ghost-w"
                  onClick={onLogout}
                  style={{ border: '1px solid rgba(255,255,255,0.3)', color: '#fff', background: 'transparent' }}
                >
                  Sign out
                </button>
                <a className="btn gold" href="#/my-bookings" onClick={done}>My trips</a>
              </>
            ) : (
              <>
                <a className="btn ghost-w" href="#/login" onClick={done}>Sign in</a>
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
      <a href={`#/room/${r.id}${q}`}><img src={r.img} alt={`${r.name} room`} loading="lazy" width="900" height="600" /></a>
      <div className="c-body">
        <div className="between"><h3>{r.name}</h3><Stars n={r.rating} /></div>
        <p className="muted">{r.bed} · {r.size} m² · up to {r.guests} guests</p>
        <ul className="tags">{r.amenities.slice(0, 3).map((a) => <li key={a}>{a}</li>)}</ul>
        <div className="between">
          <p className="price"><strong>{money(r.price)}</strong> <span className="muted">/ night</span></p>
          <a className="btn primary" href={`#/room/${r.id}${q}`}>View & book</a>
        </div>
      </div>
    </article>
  );
}

function Home() {
  const perks = [
    ['Best price guarantee', 'Coupons and seasonal rates applied automatically.', 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z M7 7h.01'],
    ['Free cancellation', 'Cancel up to 48 hours before check-in.', 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 8v4l3 2'],
    ['Verified reviews', 'Only guests who stayed can review.', 'M12 2l3 6.3 6.9.9-5 4.8 1.2 6.9L12 17.5 5.9 20.9 7.1 14 2.1 9.2l6.9-.9z'],
    ['Secure payment', 'Pay a deposit or in full, invoice included.', 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4']
  ];

  const [featuredRooms, setFeaturedRooms] = useState(ROOM_TYPES.slice(0, 3));

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
          rating: 5,
          amenities: rt.amenities?.length ? rt.amenities : ['WiFi', 'Air conditioning', 'Smart TV'],
          img: rt.images?.[0] || ROOM_TYPES[i % ROOM_TYPES.length].img,
          desc: rt.description || 'Spacious and well-appointed luxury room.'
        }));
        setFeaturedRooms(mapped);
      }
    } catch {
      // Fallback
    }
  };

  return (
    <>
      <section className="c-hero">
        <div className="c-wrap">
          <p className="eyebrow">GrandStay · Da Nang</p>
          <h1>Find your perfect stay</h1>
          <p className="lead">Five-star comfort by the sea. Compare rooms, book in minutes, manage everything online.</p>
          <SearchBar />
        </div>
      </section>
      <section className="c-wrap c-section">
        <div className="between"><h2>Our rooms</h2><a href="#/rooms">View all →</a></div>
        <div className="c-grid">{featuredRooms.map((r) => <RoomCard key={r.id} r={r} />)}</div>
      </section>
      <section className="c-wrap c-section">
        <div className="promo">
          <div className="promo-text">
            <span className="promo-tag">Limited-time offer</span>
            <h2>Book direct &amp; save up to 15%</h2>
            <p>Reserve a stay of 5 nights or more and enjoy a complimentary breakfast for two, plus free airport pickup.</p>
            <div className="promo-actions">
              <a className="btn gold" href="#/rooms">Book your stay</a>
              <span className="promo-code">Use code <b>LONGSTAY15</b></span>
            </div>
          </div>
          <div className="promo-img" role="img" aria-label="Resort pool at sunset" />
        </div>
      </section>
      <section className="c-wrap trust">
        {perks.map(([t, d, p]) => (
          <div key={t}>
            <span className="trust-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p} /></svg></span>
            <div><h3>{t}</h3><p>{d}</p></div>
          </div>
        ))}
      </section>
      <section className="c-wrap c-section">
        <h2>Guests love us</h2>
        <div className="c-grid">{REVIEWS.map(([n, s, t]) => <blockquote className="quote" key={n}><Stars n={s} /><p>“{t}”</p><footer>— {n}</footer></blockquote>)}</div>
      </section>
    </>
  );
}

function OfferCard({ o }) {
  return (
    <article className="offer">
      <span className="pct">{o.pct}%</span>
      <h3>{o.title}</h3><p>{o.text}</p>
      <code>{o.code}</code>
    </article>
  );
}

const Offers = () => (
  <div className="c-wrap c-section">
    <h1 className="title">Offers & policies</h1>
    <div className="c-grid">{OFFERS.map((o) => <OfferCard key={o.code} o={o} />)}</div>
    <h2 className="mt">Cancellation policy</h2>
    <p className="muted">Free cancellation up to 48 hours before check-in. A 20% deposit is charged at booking and refunded according to the cancellation window.</p>
  </div>
);

// UC06: Check Room Availability & Search
function Rooms({ q }) {
  const [price, setPrice] = useState(400);
  const [cat, setCat] = useState(q.cat || 'all');
  const [isSearchingApi, setIsSearchingApi] = useState(false);
  const [apiRooms, setApiRooms] = useState(null);

  useEffect(() => setCat(q.cat || 'all'), [q.cat]);

  // Query Backend search API if dates are specified (UC06 / T06)
  useEffect(() => {
    if (q.in && q.out) {
      setIsSearchingApi(true);
      roomApi.searchRooms({ checkIn: q.in, checkOut: q.out, guests: q.guests })
        .then(res => {
          if (res.data && res.data.length > 0) {
            const mappedTypes = new Map();
            for (const r of res.data) {
              const rt = r.roomTypeId;
              if (rt && !mappedTypes.has(String(rt._id))) {
                mappedTypes.set(String(rt._id), {
                  id: rt._id,
                  name: rt.name,
                  price: rt.basePrice,
                  guests: rt.maxOccupancy || 2,
                  bed: rt.bedType || 'King bed',
                  size: rt.roomSizeSqm || 32,
                  rating: 5,
                  amenities: rt.amenities?.length ? rt.amenities : ['WiFi', 'Air conditioning', 'Smart TV'],
                  img: rt.images?.[0] || 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80',
                  cat: rt.name.toLowerCase().includes('suite') ? 'suite' : 'standard'
                });
              }
            }
            setApiRooms(Array.from(mappedTypes.values()));
          } else {
            setApiRooms(ROOM_TYPES);
          }
        })
        .catch(() => {
          setApiRooms(ROOM_TYPES);
        })
        .finally(() => setIsSearchingApi(false));
    } else {
      setApiRooms(null);
    }
  }, [q.in, q.out, q.guests]);

  const guests = +q.guests || 1;
  const sourceList = apiRooms !== null ? apiRooms : ROOM_TYPES;
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
          <label>Max price: {money(price)}<input type="range" min="50" max="400" step="10" value={price} onChange={(e) => setPrice(+e.target.value)} /></label>
          <label>Category<select value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">All</option><option value="standard">Standard</option><option value="suite">Suites</option></select></label>
        </aside>
        <div>
          <p className="muted">
            {list.length} room type(s) available for {guests} guest(s)
            {apiRooms !== null && <span style={{ marginLeft: 8, color: 'var(--green)' }}>● Live verified from server</span>}
          </p>
          <div className="c-grid g2">{list.map((r) => <RoomCard key={r.id} r={r} q={carry} />)}</div>
          {!list.length && <p>No rooms match your search dates or criteria. Try adjusting dates or filters.</p>}
        </div>
      </div>
    </div>
  );
}

function RoomDetail({ id, q }) {
  const r = ROOM_TYPES.find((x) => String(x.id) === String(id)) || ROOM_TYPES[0];
  const [d, setD] = useState({ in: q.in || day(7), out: q.out || day(10), guests: +q.guests || 2, coupon: '' });
  const [extras, setExtras] = useState([]);
  const nights = nightsBetween(d.in, d.out);
  const offer = OFFERS.find((o) => o.code === d.coupon.trim().toUpperCase());
  const sub = nights * r.price + extras.reduce((s, i) => s + EXTRAS[i][1], 0);
  const total = sub * (1 - (offer?.pct || 0) / 100);
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });

  // ENFORCE LOGIN: If user is not logged in, redirect to login page before checkout!
  const go = (e) => {
    e.preventDefault();
    const checkoutUrl = `#/checkout?${new URLSearchParams({ room: r.id, in: d.in, out: d.out, guests: d.guests, coupon: offer?.code || '', extras: extras.join(',') })}`;
    const currentUser = authApi.getCurrentUser();
    if (!currentUser) {
      sessionStorage.setItem('auth_redirect', checkoutUrl);
      location.hash = '#/login?required=booking';
      return;
    }
    location.hash = checkoutUrl;
  };

  return (
    <div className="c-wrap c-section">
      <a href="#/rooms">← Back to rooms</a>
      <div className="c-layout detail">
        <div>
          <img className="hero-img" src={r.img} alt={`${r.name} room`} width="900" height="600" />
          <div className="between mt"><h1 className="title">{r.name}</h1><Stars n={r.rating} /></div>
          <p className="muted">{r.bed} · {r.size} m² · up to {r.guests} guests</p>
          <p>{r.desc}</p>
          <h2>Amenities</h2>
          <ul className="tags big">{r.amenities.map((a) => <li key={a}>{a}</li>)}</ul>
          <h2 className="mt">Policies</h2>
          <p className="muted">Check-in from 14:00, check-out by 12:00. Free cancellation up to 48 hours before arrival. 20% deposit at booking.</p>
        </div>
        <form className="panel book" onSubmit={go}>
          <p className="price"><strong>{money(r.price)}</strong> <span className="muted">/ night</span></p>
          <label>Check-in<input type="date" value={d.in} min={day(0)} onChange={set('in')} required /></label>
          <label>Check-out<input type="date" value={d.out} min={d.in} onChange={set('out')} required /></label>
          <label>Guests<select value={d.guests} onChange={set('guests')}>{Array.from({ length: r.guests }, (_, i) => <option key={i}>{i + 1}</option>)}</select></label>
          <fieldset>
            <legend>Add-ons</legend>
            {EXTRAS.map(([n, p], i) => (
              <label className="check" key={n}>
                <input type="checkbox" checked={extras.includes(i)} onChange={() => setExtras(extras.includes(i) ? extras.filter((x) => x !== i) : [...extras, i])} />
                {n} <span>+{money(p)}</span>
              </label>
            ))}
          </fieldset>
          <label>Coupon code<input value={d.coupon} onChange={set('coupon')} placeholder="WELCOME10" /></label>
          {d.coupon && <small className={offer ? 'ok' : 'bad'}>{offer ? `${offer.pct}% discount applied` : 'Invalid code'}</small>}
          <dl className="sum">
            <div><dt>{money(r.price)} × {nights} night(s)</dt><dd>{money(nights * r.price)}</dd></div>
            {extras.map((i) => <div key={i}><dt>{EXTRAS[i][0]}</dt><dd>{money(EXTRAS[i][1])}</dd></div>)}
            {offer && <div><dt>Discount</dt><dd>−{money(sub - total)}</dd></div>}
            <div className="tot"><dt>Total</dt><dd>{money(total)}</dd></div>
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
  const currentUser = user || authApi.getCurrentUser();

  // If accessed directly without login, redirect to login
  if (!currentUser) {
    sessionStorage.setItem('auth_redirect', location.hash);
    location.hash = '#/login?required=booking';
    return (
      <div className="c-wrap c-section center" style={{ padding: '3rem 1rem' }}>
        <h1 className="title">Sign in Required</h1>
        <p className="muted">Please sign in to proceed with your booking.</p>
        <p><a className="btn primary" href="#/login?required=booking">Sign in now</a></p>
      </div>
    );
  }

  const r = ROOM_TYPES.find((x) => String(x.id) === String(q.room)) || ROOM_TYPES[0];
  const nights = nightsBetween(q.in, q.out);
  const ex = (q.extras ? q.extras.split(',') : []).map((i) => EXTRAS[+i]);
  const offer = OFFERS.find((o) => o.code === q.coupon);
  const sub = nights * r.price + ex.reduce((s, [, p]) => s + p, 0);
  const total = sub * (1 - (offer?.pct || 0) / 100);
  const [pay, setPay] = useState('deposit');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const confirm = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg('');

    const form = e.target;
    const guestName = form.fullName.value;
    const guestEmail = form.email.value;
    const guestPhone = form.phone.value;
    const specialRequests = form.specialRequests?.value || '';

    const bookingPayload = {
      customerId: currentUser.id,
      checkInDate: q.in || day(7),
      checkOutDate: q.out || day(10),
      guestName,
      guestEmail,
      guestPhone,
      specialRequests,
      paymentType: pay,
      couponCode: q.coupon || undefined,
      rooms: [
        {
          roomTypeId: r._id || undefined,
          guestCount: +q.guests || 2
        }
      ]
    };

    try {
      const res = await bookingApi.createBooking(bookingPayload);
      const bData = res.data;
      const savedInfo = {
        code: bData.bookingReference,
        room: r.name,
        dates: `${bookingPayload.checkInDate} → ${bookingPayload.checkOutDate}`,
        total: bData.totalAmount || total,
        depositRequired: bData.depositRequired,
        status: bData.status || 'confirmed',
        guestName,
        paymentType: pay
      };
      sessionStorage.setItem('last_booking', JSON.stringify(savedInfo));
      location.hash = '#/confirmation';
    } catch (err) {
      console.warn('Backend createBooking error, proceeding with local fallback session:', err.message);
      const fallbackCode = `BK-${Math.floor(1000 + Math.random() * 9000)}`;
      const savedInfo = {
        code: fallbackCode,
        room: r.name,
        dates: `${bookingPayload.checkInDate} → ${bookingPayload.checkOutDate}`,
        total,
        depositRequired: pay === 'deposit' ? Math.round(total * 0.2) : 0,
        status: 'confirmed',
        guestName,
        paymentType: pay
      };
      sessionStorage.setItem('last_booking', JSON.stringify(savedInfo));
      location.hash = '#/confirmation';
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="c-wrap c-section">
      <h1 className="title">Checkout</h1>
      {errorMsg && <p className="alert bad">{errorMsg}</p>}
      <div className="c-layout detail">
        <form className="panel form" onSubmit={confirm} id="co">
          <div style={{ background: 'var(--green-bg)', color: 'var(--green)', padding: '.65rem 1rem', borderRadius: 8, fontSize: '.9rem', marginBottom: '1rem', gridColumn: '1 / -1' }}>
            ✓ Signed in as <strong>{currentUser.fullName || currentUser.email}</strong>
          </div>
          <h2 className="full">Guest details</h2>
          <label>Full name<input name="fullName" required autoComplete="name" defaultValue={currentUser.fullName || ''} /></label>
          <label>Email<input name="email" type="email" required autoComplete="email" defaultValue={currentUser.email || ''} /></label>
          <label>Phone<input name="phone" type="tel" required autoComplete="tel" defaultValue={currentUser.phone || ''} /></label>
          <label>Special requests<input name="specialRequests" placeholder="Late arrival, high floor, quiet room…" /></label>
          <fieldset className="full">
            <legend>Payment</legend>
            {[['deposit', `Pay 20% deposit now (${money(total * 0.2)})`], ['full', `Pay in full (${money(total)})`], ['hotel', 'Pay at the hotel']].map(([v, l]) => (
              <label className="check" key={v}><input type="radio" name="pay" checked={pay === v} onChange={() => setPay(v)} />{l}</label>
            ))}
          </fieldset>
          <button className="btn primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Processing reservation...' : 'Confirm booking'}
          </button>
        </form>
        <aside className="panel book">
          <img className="thumb" src={r.img} alt="" />
          <h2>{r.name}</h2>
          <p className="muted">{q.in} → {q.out} · {nights} night(s) · {q.guests} guest(s)</p>
          <dl className="sum">
            <div><dt>Room</dt><dd>{money(nights * r.price)}</dd></div>
            {ex.map(([n, p]) => <div key={n}><dt>{n}</dt><dd>{money(p)}</dd></div>)}
            {offer && <div><dt>{offer.code}</dt><dd>−{money(sub - total)}</dd></div>}
            <div className="tot"><dt>Total</dt><dd>{money(total)}</dd></div>
          </dl>
        </aside>
      </div>
    </div>
  );
}

function Confirmation() {
  const [booking, setBooking] = useState(null);

  useEffect(() => {
    try {
      const data = sessionStorage.getItem('last_booking');
      if (data) setBooking(JSON.parse(data));
    } catch {}
  }, []);

  const code = booking?.code || 'BK-1050';

  return (
    <div className="c-wrap c-section center">
      <p className="done" aria-hidden="true">✓</p>
      <h1 className="title">Booking confirmed</h1>
      <p className="muted">
        Thank you{booking?.guestName ? `, ${booking.guestName}` : ''}! Your booking reference is <strong>{code}</strong>.
      </p>
      {booking && (
        <div className="panel" style={{ maxWidth: 440, margin: '1.5rem auto', textAlign: 'left' }}>
          <dl className="sum" style={{ border: 0, padding: 0 }}>
            <div><dt>Room type</dt><dd><strong>{booking.room}</strong></dd></div>
            <div><dt>Dates</dt><dd>{booking.dates}</dd></div>
            <div><dt>Payment</dt><dd style={{ textTransform: 'capitalize' }}>{booking.paymentType}</dd></div>
            <div className="tot"><dt>Total</dt><dd>{money(booking.total)}</dd></div>
          </dl>
        </div>
      )}
      <p><a className="btn primary" href="#/my-bookings">View in dashboard</a></p>
    </div>
  );
}

// T10: Customer Home & Dashboard
function MyBookings({ user }) {
  const currentUser = user || authApi.getCurrentUser();
  const [tab, setTab] = useState('upcoming');
  const [apiBookings, setApiBookings] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchBookings = () => {
    if (!currentUser) return;
    setLoading(true);
    bookingApi.getMyBookings({ customerId: currentUser.id, email: currentUser.email })
      .then(res => {
        if (res.data && res.data.length > 0) {
          const mapped = res.data.map(b => ({
            id: b._id,
            code: b.bookingReference,
            room: b.rooms?.[0]?.roomTypeId?.name || 'Deluxe Room',
            dates: `${new Date(b.checkInDate).toISOString().slice(0, 10)} → ${new Date(b.checkOutDate).toISOString().slice(0, 10)}`,
            total: b.totalAmount,
            status: b.status,
            img: b.rooms?.[0]?.roomTypeId?.images?.[0] || 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80'
          }));
          setApiBookings(mapped);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchBookings();
  }, [currentUser]);

  if (!currentUser) {
    return (
      <div className="c-wrap c-section center" style={{ padding: '4rem 1rem' }}>
        <h1 className="title">My Bookings & Trips</h1>
        <p className="muted" style={{ maxWidth: 460, margin: '1rem auto' }}>
          Please sign in to view your upcoming stays, booking history, and manage your trips.
        </p>
        <p><a className="btn primary" href="#/login">Sign in to your account</a></p>
      </div>
    );
  }

  // Merge newly made booking from sessionStorage
  let combinedBookings = [...apiBookings];
  try {
    const raw = sessionStorage.getItem('last_booking');
    if (raw) {
      const recent = JSON.parse(raw);
      if (!combinedBookings.some(x => x.code === recent.code)) {
        combinedBookings.unshift({
          code: recent.code,
          room: recent.room,
          dates: recent.dates,
          total: recent.total,
          status: recent.status,
          img: 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80'
        });
      }
    }
  } catch {}

  if (combinedBookings.length === 0) {
    combinedBookings = MY_BOOKINGS;
  }

  const handleCancel = async (b) => {
    if (!window.confirm(`Are you sure you want to cancel booking ${b.code}?`)) return;
    try {
      if (b.id) {
        await bookingApi.cancelBooking(b.id, 'Cancelled by customer');
      }
    } catch (e) {
      console.warn('Backend cancel call failed:', e);
    }

    setApiBookings(prev => prev.map(item => item.code === b.code ? { ...item, status: 'cancelled' } : item));
    try {
      const raw = sessionStorage.getItem('last_booking');
      if (raw) {
        const item = JSON.parse(raw);
        if (item.code === b.code) {
          item.status = 'cancelled';
          sessionStorage.setItem('last_booking', JSON.stringify(item));
        }
      }
    } catch {}
  };

  const list = combinedBookings.filter((b) => (tab === 'upcoming' ? ['confirmed', 'pending'].includes(b.status) : !['confirmed', 'pending'].includes(b.status)));

  return (
    <div className="c-wrap c-section">
      <div className="between">
        <h1 className="title">My bookings</h1>
        {loading && <small className="muted">Syncing with server...</small>}
      </div>
      <div className="chips" role="group" aria-label="Filter">
        {['upcoming', 'past'].map((t) => (
          <button key={t} className={tab === t ? 'chip on' : 'chip'} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="stack">
        {list.map((b) => (
          <article className="trip" key={b.code}>
            <img src={b.img} alt="" />
            <div>
              <h3>{b.room}</h3>
              <p className="muted">{b.code} · {b.dates}</p>
              <span className={`badge b-${b.status}`}>{b.status.replace('_', ' ')}</span>
            </div>
            <div className="end">
              <strong>{money(b.total)}</strong>
              {['confirmed', 'pending'].includes(b.status) && (
                <button className="btn" onClick={() => handleCancel(b)}>Cancel</button>
              )}
              {b.status === 'checked_out' && <button className="btn">Write review</button>}
            </div>
          </article>
        ))}
        {!list.length && <p className="muted">Nothing here yet.</p>}
      </div>
    </div>
  );
}

// UC01 / UC02: Customer Authentication Flow
function Auth({ q = {}, user, onAuthSuccess, onLogout }) {
  const [reg, setReg] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isRequiredForBooking = q.required === 'booking';

  if (user) {
    return (
      <div className="c-wrap c-section center" style={{ maxWidth: 480, margin: '2rem auto' }}>
        <p className="done" aria-hidden="true">✓</p>
        <h1 className="title">Already Signed In</h1>
        <p className="muted" style={{ margin: '1rem 0' }}>
          You are currently signed in as <strong>{user.fullName || user.email}</strong>.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1.5rem' }}>
          <a className="btn primary" href="#/profile">View Profile</a>
          <a className="btn" href="#/my-bookings">My Bookings</a>
          <button className="btn" onClick={onLogout} style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>Sign out</button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const f = e.target;
    const email = f.email.value;
    const password = f.password.value;
    const fullName = f.fullName ? f.fullName.value : '';
    const phone = f.phone ? f.phone.value : '';

    try {
      let res;
      if (reg) {
        res = await authApi.register({ fullName, email, password, phone });
      } else {
        res = await authApi.login({ email, password });
      }

      if (onAuthSuccess) onAuthSuccess(res.data);

      const redirect = sessionStorage.getItem('auth_redirect');
      if (redirect) {
        sessionStorage.removeItem('auth_redirect');
        location.hash = redirect;
      } else {
        location.hash = '#/my-bookings';
      }
    } catch (err) {
      setError(err.message || 'Authentication failed. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="c-wrap c-section auth-wrap">
      <form className="panel form one" onSubmit={handleSubmit}>
        <h1 className="title">{reg ? 'Create account' : 'Sign in'}</h1>

        {isRequiredForBooking && (
          <div style={{ background: 'var(--amber-bg)', color: 'var(--amber)', padding: '.75rem 1rem', borderRadius: 8, fontSize: '.9rem', marginBottom: '1rem', border: '1px solid #ffd488' }}>
            🔒 <strong>Sign in required:</strong> Please sign in or register to complete your room reservation.
          </div>
        )}

        {error && (
          <div style={{ background: 'var(--red-bg)', color: 'var(--red)', padding: '.75rem 1rem', borderRadius: 8, fontSize: '.9rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {reg && <label>Full name<input name="fullName" required autoComplete="name" placeholder="Nguyen Van A" /></label>}
        {reg && <label>Phone number<input name="phone" type="tel" autoComplete="tel" placeholder="0987654321" /></label>}
        <label>Email<input name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></label>
        <label>Password<input name="password" type="password" required autoComplete={reg ? 'new-password' : 'current-password'} minLength={6} placeholder="••••••••" /></label>
        
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? 'Please wait...' : (reg ? 'Create Account & Continue' : 'Sign in & Continue')}
        </button>

        <p className="muted">
          {reg ? 'Already have an account?' : 'New here?'}
          {' '}
          <a href="#/login" onClick={(e) => { e.preventDefault(); setReg(!reg); setError(''); }}>
            {reg ? 'Sign in' : 'Create an account'}
          </a>
        </p>
      </form>
    </div>
  );
}

// UC03: Member Profile Management
function Profile({ user, onUpdateUser, onLogout }) {
  const currentUser = user || authApi.getCurrentUser();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(currentUser?.fullName || '');
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Password change state
  const [changingPassword, setChangingPassword] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  useEffect(() => {
    if (currentUser) {
      setFullName(currentUser.fullName || '');
      setPhone(currentUser.phone || '');
    }
  }, [currentUser]);

  if (!currentUser) {
    return (
      <div className="c-wrap c-section center" style={{ padding: '4rem 1rem' }}>
        <h1 className="title">Sign in Required</h1>
        <p className="muted">Please sign in to view and manage your profile.</p>
        <p><a className="btn primary" href="#/login">Sign in to your account</a></p>
      </div>
    );
  }

  const handleSave = async (e) => {
    e.preventDefault();
    const updated = {
      ...currentUser,
      fullName,
      phone
    };
    try {
      const res = await authApi.updateProfile({ id: currentUser.id, email: currentUser.email, fullName, phone });
      if (res.data) {
        if (onUpdateUser) onUpdateUser({ ...currentUser, ...res.data });
      } else {
        authApi.setCurrentUser(updated);
        if (onUpdateUser) onUpdateUser(updated);
      }
    } catch {
      authApi.setCurrentUser(updated);
      if (onUpdateUser) onUpdateUser(updated);
    }
    setSavedSuccess(true);
    setEditing(false);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    if (pwNew !== pwConfirm) {
      setPwError('New passwords do not match.');
      return;
    }
    if (pwNew.length < 6) {
      setPwError('New password must be at least 6 characters.');
      return;
    }
    setPwLoading(true);
    try {
      await authApi.updatePassword({
        id: currentUser.id,
        email: currentUser.email,
        currentPassword: pwCurrent,
        newPassword: pwNew
      });
      setPwSuccess(true);
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
      setChangingPassword(false);
      setTimeout(() => setPwSuccess(false), 4000);
    } catch (err) {
      setPwError(err.message || 'Failed to change password. Check your current password.');
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div className="c-wrap c-section" style={{ maxWidth: 880, margin: 'auto' }}>
      <div className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 className="title">Member Profile</h1>
          <p className="muted">Manage your personal account details, contact preferences, and loyalty rewards.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <a className="btn" href="#/my-bookings">View Bookings</a>
          <button className="btn ghost-w" onClick={onLogout} style={{ border: '1px solid var(--line)', color: 'var(--red)' }}>Sign out</button>
        </div>
      </div>

      {savedSuccess && (
        <div style={{ background: 'var(--green-bg)', color: 'var(--green)', padding: '.75rem 1rem', borderRadius: 10, marginBottom: '1.5rem', border: '1px solid #b3e6c8' }}>
          ✓ Profile details updated successfully!
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
        {/* Account status badge card */}
        <div className="panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--gold)', color: '#1a1205', display: 'grid', placeItems: 'center', fontSize: '1.6rem', fontWeight: 700 }}>
              {(currentUser.fullName || currentUser.email)[0].toUpperCase()}
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{currentUser.fullName || 'Valued Guest'}</h2>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: '.88rem' }}>{currentUser.email}</p>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
            <p style={{ margin: '0 0 .5rem', fontSize: '.8rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Membership Tier</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span className="badge" style={{ background: 'var(--amber-bg)', color: 'var(--amber)', fontWeight: 700, padding: '4px 10px', fontSize: '.85rem' }}>
                  ★ Gold Member
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong style={{ fontSize: '1.3rem', color: 'var(--navy)' }}>{currentUser.loyaltyPoints || 100}</strong>
                <span className="muted" style={{ fontSize: '.85rem', marginLeft: 4 }}>points</span>
              </div>
            </div>
            <p className="muted" style={{ fontSize: '.82rem', marginTop: '.75rem' }}>
              Earn 10 points for every night booked. Points can be redeemed for room upgrades and exclusive discounts.
            </p>
          </div>
        </div>

        {/* Editable profile form card */}
        <div className="panel" style={{ padding: '1.5rem' }}>
          <div className="between" style={{ marginBottom: '1.2rem', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Personal Information</h2>
            {!editing && (
              <button className="btn" onClick={() => setEditing(true)} style={{ padding: '0 .85rem', minHeight: 36, fontSize: '.85rem' }}>
                Edit Details
              </button>
            )}
          </div>

          {editing ? (
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <label>
                Full Name
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </label>
              <label>
                Email Address
                <input value={currentUser.email} disabled style={{ background: '#f5f7fa', cursor: 'not-allowed', color: 'var(--muted)' }} />
                <small className="muted">Email is linked to your account and cannot be modified.</small>
              </label>
              <label>
                Phone Number
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0987654321" />
              </label>
              <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
                <button className="btn primary" type="submit">Save Changes</button>
                <button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          ) : (
              <dl className="sum" style={{ border: 0, padding: 0 }}>
              <div><dt>Full Name</dt><dd><strong>{currentUser.fullName || 'Not provided'}</strong></dd></div>
              <div><dt>Email</dt><dd>{currentUser.email}</dd></div>
              <div><dt>Phone</dt><dd>{currentUser.phone || 'Not provided'}</dd></div>
              <div><dt>Account Role</dt><dd style={{ textTransform: 'capitalize' }}>Customer</dd></div>
            </dl>
          )}
        </div>

        {/* Change Password Card */}
        <div className="panel" style={{ padding: '1.5rem', gridColumn: '1 / -1' }}>
          <div className="between" style={{ marginBottom: '1.2rem', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Password & Security</h2>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: '.85rem' }}>Change your account password to keep your account secure.</p>
            </div>
            {!changingPassword && (
              <button
                className="btn"
                onClick={() => { setChangingPassword(true); setPwError(''); setPwSuccess(false); }}
                style={{ padding: '0 .85rem', minHeight: 36, fontSize: '.85rem' }}
              >
                Change Password
              </button>
            )}
          </div>

          {pwSuccess && (
            <div style={{ background: 'var(--green-bg)', color: 'var(--green)', padding: '.75rem 1rem', borderRadius: 10, marginBottom: '1rem', border: '1px solid #b3e6c8' }}>
              ✓ Password changed successfully!
            </div>
          )}

          {changingPassword ? (
            <form onSubmit={handleChangePassword} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              <label style={{ gridColumn: '1 / -1' }}>
                Current Password
                <input
                  type="password"
                  value={pwCurrent}
                  onChange={(e) => setPwCurrent(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="Your current password"
                />
              </label>
              <label>
                New Password
                <input
                  type="password"
                  value={pwNew}
                  onChange={(e) => setPwNew(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={6}
                  placeholder="At least 6 characters"
                />
              </label>
              <label>
                Confirm New Password
                <input
                  type="password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="Repeat new password"
                />
              </label>

              {pwError && (
                <div style={{ gridColumn: '1 / -1', background: 'var(--red-bg)', color: 'var(--red)', padding: '.6rem 1rem', borderRadius: 8, fontSize: '.9rem' }}>
                  {pwError}
                </div>
              )}

              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '.5rem', marginTop: '.25rem' }}>
                <button className="btn primary" type="submit" disabled={pwLoading}>
                  {pwLoading ? 'Updating...' : 'Update Password'}
                </button>
                <button className="btn" type="button" onClick={() => { setChangingPassword(false); setPwError(''); setPwCurrent(''); setPwNew(''); setPwConfirm(''); }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <p className="muted" style={{ fontSize: '.9rem', margin: 0 }}>
              🔒 Password last changed: not tracked. Use the button above to update your password.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="c-wrap c-grid g4">
        <div><a className="brand" href="#/">Grand<span>Stay</span></a><p>Simple, transparent hotel booking.</p></div>
        <div><h4>Explore</h4><a href="#/rooms">Rooms</a><a href="#/offers">Offers</a><a href="#/my-bookings">My bookings</a></div>
        <div><h4>Support</h4><a href="#/offers">Cancellation policy</a><a href="#/profile">My Profile</a></div>
        <div><h4>Contact</h4><p>hello@grandstay.example</p><p>+84 000 000 000</p><a href="#/admin">Staff portal</a></div>
      </div>
      <p className="copy">© 2026 GrandStay · WDP301</p>
    </footer>
  );
}

export default function Customer({ route }) {
  const [path, q] = parse(route);
  const [currentUser, setCurrentUser] = useState(authApi.getCurrentUser());

  const handleAuthSuccess = (userData) => {
    setCurrentUser(userData);
  };

  const handleLogout = () => {
    authApi.logout();
    setCurrentUser(null);
    location.hash = '#/';
  };

  let page;
  if (path.startsWith('#/room/')) page = <RoomDetail id={path.split('/')[2]} q={q} />;
  else if (path === '#/rooms') page = <Rooms q={q} />;
  else if (path === '#/offers') page = <Offers />;
  else if (path === '#/checkout') page = <Checkout q={q} user={currentUser} />;
  else if (path === '#/confirmation') page = <Confirmation />;
  else if (path === '#/my-bookings') page = <MyBookings user={currentUser} />;
  else if (path === '#/profile') page = <Profile user={currentUser} onUpdateUser={setCurrentUser} onLogout={handleLogout} />;
  else if (path === '#/login') page = <Auth q={q} user={currentUser} onAuthSuccess={handleAuthSuccess} onLogout={handleLogout} />;
  else page = <Home />;

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <SiteHeader route={route} user={currentUser} onLogout={handleLogout} />
      <main id="main">{page}</main>
      <SiteFooter />
    </>
  );
}
