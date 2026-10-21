import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useData } from "./data";
import { Icon } from "./ui";

const NAV = [
  { to: "/", icon: "chat", label: "Home" },
  { to: "/profile", icon: "id", label: "Profile" },
  { to: "/schedule", icon: "calendar", label: "Schedule" },
  { to: "/medications", icon: "pill", label: "Medications" },
  { to: "/conditions", icon: "flask", label: "Conditions & tests" },
  { to: "/diet", icon: "scale", label: "Diet" },
  { to: "/documents", icon: "folder", label: "Documents" },
  { to: "/settings", icon: "settings", label: "Settings" },
] as const;

function Logo() {
  return (
    <Link to="/" className="brand" aria-label="ClearCare home">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#2f6f5e" />
        <path d="M16 24s-7-4.4-7-9.6A4 4 0 0 1 16 12a4 4 0 0 1 7 2.4C23 19.6 16 24 16 24z" fill="#fff" />
      </svg>
      ClearCare
    </Link>
  );
}

/** Every page sits under one top bar; the pages are in a panel behind the menu button, left of the logo. */
export function Shell() {
  const { payload } = useData();
  const { viewer } = payload;
  const location = useLocation();
  const section = `/${location.pathname.split("/")[1] ?? ""}`;
  const home = section === "/" || section === "/chat";
  const title = NAV.find((n) => n.to === section)?.label ?? "";
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDialogElement>(null);

  // A modal dialog keeps focus inside the panel, closes on Escape, and returns focus to the button.
  useEffect(() => {
    const d = panel.current;
    if (d === null) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <header className={home ? "top bare" : "top"}>
        <button type="button" className="icon-btn" aria-label="Menu" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          <Icon name="menu" size={22} />
        </button>
        <Logo />
      </header>
      <main className={home ? "content home" : "content"}>
        {home || section === "/schedule" || section === "/profile" ? null : <h1 className="page-title">{title}</h1>}
        <Outlet />
      </main>

      <dialog
        ref={panel}
        className="drawer"
        aria-label="Pages"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // A click on the dimmed area outside the panel lands on the dialog itself.
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div className="drawer-in">
          <div className="drawer-head">
            <button type="button" className="icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}>
              <Icon name="x" size={22} />
            </button>
            <Logo />
          </div>
          <nav className="drawer-nav" aria-label="ClearCare">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => (isActive || (item.to === "/" && home) ? "active" : "")}
                onClick={() => setOpen(false)}
              >
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="drawer-foot">{viewer.local ? viewer.name : `Signed in as ${viewer.name}`}</div>
        </div>
      </dialog>
    </div>
  );
}
