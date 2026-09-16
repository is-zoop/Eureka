# Eureka Desktop

The desktop application wraps the existing Eureka Next.js server in a Tauri 2 Windows shell. It shares the existing `~/.pi/agent` data directory with the Pi CLI.

## Prerequisites

- Node.js 22.19 or newer
- Rust stable (`rustup default stable`)
- Windows C++ Build Tools and WebView2

Install the desktop development dependency with `npm install --prefix desktop`, then use these root commands:

- `npm run desktop:dev` starts the local Next development server and Eureka.
- `npm run desktop:build` produces the NSIS installer after building a bundled Node runtime and standalone Next service.
- `npm run desktop:bundle` is an alias for the production bundle.

The production resource preparation script copies the Node executable from the machine running the build. Build on the same Windows architecture you intend to distribute.

Haze OAuth uses the configured loopback callback at `127.0.0.1:8080`; Eureka therefore reserves port 8080 while it is open. The build copies the repository `.env.local` into the bundled server resources so its server-only identity configuration is available after installation.
