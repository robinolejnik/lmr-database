import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>LMR Database</h1>
        <nav style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
          <Link to="/">Home</Link>
          <Link to="/antennas">Antennas</Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  ),
});
