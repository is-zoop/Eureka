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

The desktop frame uses two child WebViews in one native window: a packaged local titlebar and the independently navigating Eureka frontend. The titlebar does not wait for the Node service, page hydration, or authentication. This uses Tauri's `unstable` multi-WebView feature with the SDK versions locked in `Cargo.lock`.

Normal window width and height (in logical pixels), maximized state, and theme preference are saved in `window-state.json` in the application's config directory. Closing a minimized or maximized window preserves its previous normal dimensions. A separate development app identifier keeps testing preferences separate from the installed application.

Haze OAuth opens in the system browser and uses the configured loopback callback at `127.0.0.1:8080`; Eureka therefore reserves port 8080 while it is open. The callback retains a short-lived, single-use result on the local server, and only the initiating desktop can claim it and receive its own HttpOnly session cookie. The claim secret and Haze tokens never enter browser URLs. Closing the desktop login page cancels the request; pending requests expire after ten minutes. The build copies the repository `.env.local` into the bundled server resources so its server-only identity configuration is available after installation.
