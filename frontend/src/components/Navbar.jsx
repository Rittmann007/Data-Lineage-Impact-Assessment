import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

// Loads the app's type system once, app-wide (Navbar is always mounted
// outside <Routes>, so this is the one safe place to do it without
// touching index.html). Manrope carries headings/UI; IBM Plex Mono is
// used for asset IDs, stat figures, and enum-like values (Table,
// reads_from, prod...) since those are literal schema values, not prose.
function useAppFonts() {
  useEffect(() => {
    if (document.getElementById("app-font-system")) return;

    const link = document.createElement("link");
    link.id = "app-font-system";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(link);

    const style = document.createElement("style");
    style.id = "app-font-vars";
    style.textContent = `
      :root {
        --font-sans: 'Manrope', ui-sans-serif, system-ui, sans-serif;
        --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
      }
      body { font-family: var(--font-sans); }
    `;
    document.head.appendChild(style);
  }, []);
}

function Navbar() {
  const location = useLocation();
  useAppFonts();

  const navItems = [
    { name: "Dashboard", path: "/dashboard" },
    { name: "Graphs", path: "/graph" },
  ];

  return (
    <nav className="fixed left-1/2 top-3 z-50 flex w-[92%] max-w-6xl -translate-x-1/2 items-center justify-between rounded-xl border border-white/20 bg-black/20 px-4 py-2 backdrop-blur-xl shadow-lg shadow-black/10">

      {/* Logo / Home */}
      <Link
        to="/"
        className="text-[15px] font-semibold tracking-wide text-white transition-opacity hover:opacity-80"
      >
        DataLineage
      </Link>

      {/* Navigation */}
      <div className="flex items-center gap-1.5">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`rounded-lg border px-4 py-1.5 text-[13px] font-medium transition-all duration-300 ${
                isActive
                  ? "border-white/30 bg-white/20 text-white shadow-md backdrop-blur-md"
                  : "border-transparent bg-white/5 text-white/80 hover:border-white/20 hover:bg-white/10 hover:text-white"
              }`}
            >
              {item.name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default Navbar;