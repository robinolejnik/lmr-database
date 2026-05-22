import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { useAuth } from "react-oidc-context";

export const Route = createRootRoute({
  component: () => {
    const auth = useAuth();
    const name =
      auth.user?.profile?.name ||
      auth.user?.profile?.preferred_username ||
      auth.user?.profile?.email ||
      "anon";

    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
        <header
          style={{
            marginBottom: "1.5rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ margin: 0 }}>LMR Database</h1>
            <nav style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
              <Link to="/">Home</Link>
              <Link to="/signals">Signals</Link>
              <Link to="/receivers">Receivers</Link>
              <Link to="/transmitters">Transmitters</Link>
              <Link to="/antennas">Antennas (legacy)</Link>
            </nav>
          </div>
          <div style={{ fontSize: 14, color: "#666" }}>
            Signed in as <strong>{name}</strong>{" "}
            <button
              type="button"
              onClick={() => void auth.signoutRedirect()}
              style={{
                marginLeft: 8,
                background: "none",
                border: "1px solid #ccc",
                padding: "2px 8px",
                cursor: "pointer",
                borderRadius: 3,
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    );
  },
});
