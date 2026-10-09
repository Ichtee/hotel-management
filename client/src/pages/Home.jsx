import { Link, useOutletContext } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  CalendarDays,
} from "lucide-react";
import { useAuth } from "../context/Auth";
import { links } from "../components/Shell";
import { useResource, ErrorBanner, Loading } from "../components/UI";
import { money, dateLabel } from "../api/client";
function RevenuePreview() {
  const report = useResource("/reports/revenue?groupBy=month");
  return (
    <div className="home-insight">
      <p className="eyebrow">THIS MONTH / NET REVENUE</p>
      {report.loading ? (
        <Loading />
      ) : report.error ? (
        <ErrorBanner error={report.error} retry={report.reload} />
      ) : (
        <>
          <strong className="insight-number">
            {money(report.data.totals.net)}
          </strong>
          <p>Successful payments, less completed refunds.</p>
          <Link to="/revenue">
            View the full report <ArrowUpRight size={16} />
          </Link>
        </>
      )}
    </div>
  );
}
function AccountPreview() {
  const list = useResource("/users?limit=1");
  return (
    <div className="home-insight">
      <p className="eyebrow">YOUR SYSTEM / PEOPLE</p>
      {list.loading ? (
        <Loading />
      ) : list.error ? (
        <ErrorBanner error={list.error} retry={list.reload} />
      ) : (
        <>
          <strong className="insight-number">
            {String(list.meta.total).padStart(2, "0")} <small>accounts</small>
          </strong>
          <p>One place to keep access clear and considered.</p>
          <Link to="/accounts">
            Manage accounts <ArrowUpRight size={16} />
          </Link>
        </>
      )}
    </div>
  );
}
export default function Home() {
  const { user } = useAuth();
  const { hotel } = useOutletContext();
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );
  const greeting = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const name = (user.customerProfile?.fullName || user.username).split(" ")[0];
  const available = links.filter(
    (l) =>
      l.to !== "/" &&
      (!l.permission || user.permissions.includes(l.permission)),
  );
  return (
    <>
      <div className="home-date">
        <CalendarDays size={15} />
        {new Intl.DateTimeFormat("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Asia/Ho_Chi_Minh",
        }).format(new Date())}
      </div>
      <header className="home-heading">
        <p className="eyebrow">
          {hotel
            ? `${hotel.name.toUpperCase()} / YOUR DAILY DESK`
            : "YOUR PERSONAL DESK"}
        </p>
        <h1>
          Good {greeting}, <em>{name}.</em>
        </h1>
        <p>
          {user.scope === "hotel"
            ? "A clear desk. A little perspective. Everything you need to take care of the details."
            : user.scope === "system"
              ? "Keep the right people connected to the right parts of your hotel."
              : "Welcome in. Make yourself at home and keep your details up to date."}
        </p>
      </header>
      <section className="home-banner">
        <div>
          <p className="eyebrow">
            {user.scope === "self"
              ? "A STAY STARTS WITH YOU"
              : "HOSPITALITY, WELL CONSIDERED"}
          </p>
          <h2>
            {user.scope === "self" ? (
              <>
                Your next chapter
                <br />
                starts here.
              </>
            ) : (
              <>
                Room for the details.
                <br />
                <em>Space for your people.</em>
              </>
            )}
          </h2>
          <Link className="button light" to={available[0].to}>
            {user.scope === "self"
              ? "Complete your profile"
              : `Open ${available[0].label.toLowerCase()}`}
            <ArrowRight size={17} />
          </Link>
        </div>
        <div className="banner-ledger" aria-hidden="true">
          <span className="ledger-top">
            HOTEL DESK <span>01 / DAILY EDITION</span>
          </span>
          <div className="ledger-arch">
            <span>h.</span>
          </div>
          <span className="ledger-bottom">CARE IS IN THE DETAILS.</span>
        </div>
      </section>
      <div className="home-bottom">
        <section className="workspace-links">
          <div className="section-heading">
            <h2>Your workspace</h2>
            <span>
              {String(available.length).padStart(2, "0")} destinations
            </span>
          </div>
          {available.map((l, i) => (
            <Link to={l.to} className="destination" key={l.to}>
              <span className="destination-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <l.icon size={21} strokeWidth={1.5} />
              <div>
                <h3>{l.label}</h3>
                <p>{l.description}</p>
              </div>
              <ArrowUpRight size={20} />
            </Link>
          ))}
        </section>
        <aside className="home-aside">
          {user.permissions.includes("revenue.read") ? (
            <RevenuePreview />
          ) : user.permissions.includes("users.manage") ? (
            <AccountPreview />
          ) : (
            <div className="home-insight">
              <p className="eyebrow">A PERSONAL TOUCH</p>
              <h2>All about you.</h2>
              <p>
                A current phone number and profile help your hotel stay in
                touch.
              </p>
              <Link to="/profile">
                Review your details <ArrowUpRight size={16} />
              </Link>
            </div>
          )}
          <div className="security-note">
            <ShieldCheck size={21} />
            <div>
              <strong>Your account is protected</strong>
              <p>
                Signed in as {user.roleName.toLowerCase()}.<br />
                Last sign-in: {dateLabel(user.lastLogin)}.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
