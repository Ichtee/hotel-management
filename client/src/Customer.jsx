import { useEffect, useRef, useState } from 'react';
import { useAuth } from './context/Auth.jsx';
import { AuthShell, AuthTabs, SignIn, Register } from './AuthForms.jsx';
import { Profile } from './AdminPages.jsx';
import { EXTRAS, MY_BOOKINGS, OFFERS, REVIEWS, ROOM_TYPES } from './data.js';

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
const money = (n) => `$${n.toFixed(0)}`;
const nightsBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 864e5)) : 0);
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const Stars = ({ n }) => <span className="stars" role="img" aria-label={`${n} out of 5`}>{'★'.repeat(Math.round(n))}{'☆'.repeat(5 - Math.round(n))}</span>;

function SiteHeader({ route }) {
  const { user, signOut } = useAuth();
  const staff = user && user.scope !== 'self';
  const nav = NAV.map((m) => (m.label === 'My trips' ? { ...m, items: m.items.filter(([h]) => (user ? h !== '#/login' : true)).concat(user ? [['#/profile', 'My profile', user.email]] : []) } : m));
  const [open, setOpen] = useState(null);
  const [mobile, setMobile] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(null); };
    addEventListener('click', close); addEventListener('keydown', close);
    return () => { removeEventListener('click', close); removeEventListener('keydown', close); };
  }, []);
  const done = () => { setOpen(null); setMobile(false); };
  return (
    <header className="topbar site" ref={ref}>
      <div className="bar">
        <a className="brand" href="#/">Grand<span>Stay</span></a>
        <button className="menu-btn" aria-expanded={mobile} aria-controls="nav" onClick={() => setMobile(!mobile)}>{mobile ? 'Close' : 'Menu'}</button>
        <nav id="nav" className={mobile ? 'open' : ''} aria-label="Main">
          <ul>
            {nav.map((m, i) => m.items ? (
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
            {user ? <>
              {staff && <a className="btn ghost-w" href="#/admin" onClick={done}>Staff portal</a>}
              <button className="btn ghost-w" onClick={async () => { done(); await signOut(); location.hash = '#/'; }}>Sign out</button>
            </> : <a className="btn ghost-w" href="#/login" onClick={done}>Sign in</a>}
            <a className="btn gold" href="#/rooms" onClick={done}>Book now</a>
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
        <div className="c-grid">{ROOM_TYPES.slice(0, 3).map((r) => <RoomCard key={r.id} r={r} />)}</div>
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

function Rooms({ q }) {
  const [price, setPrice] = useState(400);
  const [cat, setCat] = useState(q.cat || 'all');
  useEffect(() => setCat(q.cat || 'all'), [q.cat]);
  const guests = +q.guests || 1;
  const list = ROOM_TYPES.filter((r) => r.price <= price && r.guests >= guests && (cat === 'all' || r.cat === cat));
  const carry = q.in ? `?${new URLSearchParams({ in: q.in, out: q.out, guests: q.guests })}` : '';
  return (
    <div className="c-wrap c-section">
      <h1 className="title">Available rooms</h1>
      <SearchBar key={route0(q)} q={q} />
      <div className="c-layout">
        <aside className="panel filters" aria-label="Filters">
          <h2>Filters</h2>
          <label>Max price: {money(price)}<input type="range" min="50" max="400" step="10" value={price} onChange={(e) => setPrice(+e.target.value)} /></label>
          <label>Category<select value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">All</option><option value="standard">Standard</option><option value="suite">Suites</option></select></label>
        </aside>
        <div>
          <p className="muted">{list.length} room type(s) for {guests} guest(s)</p>
          <div className="c-grid g2">{list.map((r) => <RoomCard key={r.id} r={r} q={carry} />)}</div>
          {!list.length && <p>No rooms match. Try widening your filters.</p>}
        </div>
      </div>
    </div>
  );
}

function RoomDetail({ id, q }) {
  const r = ROOM_TYPES.find((x) => x.id === +id) || ROOM_TYPES[0];
  const [d, setD] = useState({ in: q.in || day(7), out: q.out || day(10), guests: +q.guests || 2, coupon: '' });
  const [extras, setExtras] = useState([]);
  const nights = nightsBetween(d.in, d.out);
  const offer = OFFERS.find((o) => o.code === d.coupon.trim().toUpperCase());
  const sub = nights * r.price + extras.reduce((s, i) => s + EXTRAS[i][1], 0);
  const total = sub * (1 - (offer?.pct || 0) / 100);
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  const go = (e) => {
    e.preventDefault();
    location.hash = `#/checkout?${new URLSearchParams({ room: r.id, in: d.in, out: d.out, guests: d.guests, coupon: offer?.code || '', extras: extras.join(',') })}`;
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
          <button className="btn primary" type="submit" disabled={!nights}>{nights ? 'Continue to checkout' : 'Choose valid dates'}</button>
        </form>
      </div>
    </div>
  );
}

function Checkout({ q }) {
  const r = ROOM_TYPES.find((x) => x.id === +q.room) || ROOM_TYPES[0];
  const nights = nightsBetween(q.in, q.out);
  const ex = (q.extras ? q.extras.split(',') : []).map((i) => EXTRAS[+i]);
  const offer = OFFERS.find((o) => o.code === q.coupon);
  const sub = nights * r.price + ex.reduce((s, [, p]) => s + p, 0);
  const total = sub * (1 - (offer?.pct || 0) / 100);
  const [pay, setPay] = useState('deposit');
  const confirm = (e) => { e.preventDefault(); location.hash = '#/confirmation'; };
  return (
    <div className="c-wrap c-section">
      <h1 className="title">Checkout</h1>
      <div className="c-layout detail">
        <form className="panel form" onSubmit={confirm} id="co">
          <h2 className="full">Guest details</h2>
          <label>Full name<input required autoComplete="name" /></label>
          <label>Email<input type="email" required autoComplete="email" /></label>
          <label>Phone<input type="tel" required autoComplete="tel" /></label>
          <label>Special requests<input placeholder="Late arrival, high floor…" /></label>
          <fieldset className="full">
            <legend>Payment</legend>
            {[['deposit', `Pay 20% deposit now (${money(total * 0.2)})`], ['full', `Pay in full (${money(total)})`], ['hotel', 'Pay at the hotel']].map(([v, l]) => (
              <label className="check" key={v}><input type="radio" name="pay" checked={pay === v} onChange={() => setPay(v)} />{l}</label>
            ))}
          </fieldset>
          <button className="btn primary" type="submit">Confirm booking</button>
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

const Confirmation = () => (
  <div className="c-wrap c-section center">
    <p className="done" aria-hidden="true">✓</p>
    <h1 className="title">Booking confirmed</h1>
    <p className="muted">Your booking code is <strong>BK-1050</strong>. A confirmation email is on its way.</p>
    <p><a className="btn primary" href="#/my-bookings">View my bookings</a></p>
  </div>
);

function MyBookings() {
  const [tab, setTab] = useState('upcoming');
  const list = MY_BOOKINGS.filter((b) => (tab === 'upcoming' ? b.status === 'confirmed' : b.status !== 'confirmed'));
  return (
    <div className="c-wrap c-section">
      <h1 className="title">My bookings</h1>
      <div className="chips" role="group" aria-label="Filter">
        {['upcoming', 'past'].map((t) => <button key={t} className={tab === t ? 'chip on' : 'chip'} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}
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
            <div className="end"><strong>{money(b.total)}</strong>
              {b.status === 'confirmed' && <button className="btn">Cancel</button>}
              {b.status === 'checked_out' && <button className="btn">Write review</button>}
            </div>
          </article>
        ))}
        {!list.length && <p className="muted">Nothing here yet.</p>}
      </div>
    </div>
  );
}

function Auth({ note }) {
  const [mode, setMode] = useState('login');
  const { user } = useAuth();
  const done = () => { location.hash = sessionStorage.getItem('next') || '#/my-bookings'; sessionStorage.removeItem('next'); };
  if (user) { if (user.scope === 'self') done(); else location.hash = '#/admin'; return null; }
  return (
    <AuthShell>
      <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="muted">{mode === 'login' ? 'Sign in to manage your bookings.' : 'Book faster and keep every stay in one place.'}</p>
      <AuthTabs mode={mode} onChange={setMode} />
      {note && <p className="note">{note}</p>}
      {mode === 'login' ? <SignIn onDone={done} /> : <Register onDone={done} />}
    </AuthShell>
  );
}

function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="c-wrap c-grid g4">
        <div><a className="brand" href="#/">Grand<span>Stay</span></a><p>Simple, transparent hotel booking.</p></div>
        <div><h4>Explore</h4><a href="#/rooms">Rooms</a><a href="#/offers">Offers</a><a href="#/my-bookings">My bookings</a></div>
        <div><h4>Support</h4><a href="#/offers">Cancellation policy</a><a href="#/login">Account</a></div>
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
  else if (PROTECTED.includes(path) && !user) { sessionStorage.setItem('next', route); page = <Auth note="Please sign in to continue." />; }
  else if (path === '#/profile') page = <div className="c-wrap c-section"><Profile /></div>;
  else
  if (path.startsWith('#/room/')) page = <RoomDetail id={path.split('/')[2]} q={q} />;
  else if (path === '#/rooms') page = <Rooms q={q} />;
  else if (path === '#/offers') page = <Offers />;
  else if (path === '#/checkout') page = <Checkout q={q} />;
  else if (path === '#/confirmation') page = <Confirmation />;
  else if (path === '#/my-bookings') page = <MyBookings />;
  else if (path === '#/login') page = <Auth />;
  else page = <Home />;
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <SiteHeader route={route} />
      <main id="main">{page}</main>
      <SiteFooter />
    </>
  );
}
