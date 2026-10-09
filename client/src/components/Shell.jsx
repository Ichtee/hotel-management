import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, Navigate } from "react-router-dom";
import {
  ArrowUpRight,
  House,
  UserRound,
  UsersRound,
  ShieldCheck,
  BadgePercent,
  ChartNoAxesCombined,
  ContactRound,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "../context/Auth";
import { ErrorBanner, useResource } from "./UI";
export const links = [
  {
    to: "/",
    label: "Home",
    icon: House,
    description: "Your day, at a glance.",
  },
  {
    to: "/accounts",
    label: "Accounts",
    icon: UsersRound,
    permission: "users.manage",
    description: "People and their access to the system.",
  },
  {
    to: "/roles",
    label: "Roles & permissions",
    icon: ShieldCheck,
    permission: "roles.manage",
    description: "Give every person the right access.",
  },
  {
    to: "/staff",
    label: "Staff",
    icon: ContactRound,
    permission: "staff.manage",
    description: "Keep your hotel team in sync.",
  },
  {
    to: "/promotions",
    label: "Promotions",
    icon: BadgePercent,
    permission: "promotions.manage",
    description: "Thoughtful offers for your next guests.",
  },
  {
    to: "/revenue",
    label: "Revenue",
    icon: ChartNoAxesCombined,
    permission: "revenue.read",
    description: "A clear view of receipts and refunds.",
  },
  {
    to: "/profile",
    label: "My profile",
    icon: UserRound,
    description: "Your details, contact information and security.",
  },
];
export function Allowed({ permission, children }) {
  const { user } = useAuth();
  return user.permissions.includes(permission) ? (
    children
  ) : (
    <div className="empty">
      <ShieldCheck size={32} />
      <h1>Access restricted</h1>
      <p>Your role does not have access to this page.</p>
      <NavLink className="button primary" to="/">
        Back to Home
      </NavLink>
    </div>
  );
}
export default function Shell() {
  const { user, signOut, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 720px)").matches,
  );
  const sidebar = useRef(null);
  const menuButton = useRef(null);
  const [error, setError] = useState(null);
  const location = useLocation();
  const options = useResource("/options");
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const resize = () => {
      setMobile(media.matches);
      if (!media.matches) setOpen(false);
    };
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    if (!open || !mobile) return;
    const nav = sidebar.current;
    const focusable = () => [
      ...nav.querySelectorAll("a[href], button:not([disabled])"),
    ];
    focusable()[0]?.focus();
    const keydown = (e) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab") {
        const items = focusable(),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    nav.addEventListener("keydown", keydown);
    return () => {
      nav.removeEventListener("keydown", keydown);
      menuButton.current?.focus();
    };
  }, [open, mobile]);
  useEffect(() => {
    setOpen(false);
    refresh();
  }, [location.pathname, refresh]);
  if (!user) return <Navigate to="/login" replace />;
  const available = links.filter(
    (l) => !l.permission || user.permissions.includes(l.permission),
  );
  const hotel = user.scope === "hotel" ? options.data?.hotels[0] : null;
  const name = user.customerProfile?.fullName || user.username;
  return (
    <div className="app-shell">
      {open && (
        <button
          className="sidebar-backdrop"
          tabIndex={-1}
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        ref={sidebar}
        inert={mobile && !open}
        className={`sidebar ${open ? "is-open" : ""}`}
      >
        <NavLink to="/" className="brand">
          <span className="brand-mark">h.</span>
          <span>
            hotel desk<small>HOSPITALITY WORKSPACE</small>
          </span>
        </NavLink>
        <button
          className="mobile-close icon-button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        >
          <X size={20} />
        </button>
        <div className="property-label">
          <span className="property-dot" />
          <div>
            {hotel?.name || "Hotel Management"}
            <small>
              {hotel?.city ||
                (user.scope === "system"
                  ? "System administration"
                  : "Your personal workspace")}
            </small>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {available.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
            >
              <l.icon size={19} strokeWidth={1.65} />
              <span>{l.label}</span>
              {l.to === "/" && <span className="nav-home-dot" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p className="sidebar-note">
            A little more clarity.
            <br />A better guest experience.
          </p>
          <div className="user-card">
            <span className="avatar">
              {name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              <strong>{name}</strong>
              <small>{user.roleName}</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                try {
                  await signOut();
                } catch (e) {
                  setError(e);
                }
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace" inert={mobile && open}>
        <header className="topbar">
          <div className="topbar-path">
            <button
              className="icon-button mobile-menu"
              ref={menuButton}
              aria-label="Open navigation"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span className="path-separator">/</span>
            <strong>
              {links.find((l) => l.to === location.pathname)?.label || "Page"}
            </strong>
          </div>
          <span className="topbar-status">
            <span />
            {user.roleName}
            <ArrowUpRight size={15} />
          </span>
        </header>
        <main id="main-content" className="main-content">
          <ErrorBanner error={error} />
          <Outlet context={{ hotel }} />
        </main>
        <footer className="workspace-footer">
          <span>HOTEL DESK</span>
          <span>Thoughtful hospitality starts here.</span>
        </footer>
      </div>
    </div>
  );
}
