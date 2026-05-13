export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 32, maxWidth: 720 }}>
      <h1>Browser Automation API</h1>
      <p>
        This service exposes JSON routes for the Chrome extension. Configure <code>EXTENSION_API_KEY</code> and use
        the extension side panel to run tasks.
      </p>
      <ul>
        <li>
          <code>GET /api/health</code>
        </li>
        <li>
          <code>POST /api/session</code>
        </li>
        <li>
          <code>POST /api/tasks</code>
        </li>
        <li>
          <code>POST /api/agent/step</code>
        </li>
      </ul>
    </main>
  );
}
