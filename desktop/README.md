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

Desktop build outputs and local caches are excluded from Next's traces and from
the standalone resource copy, so repeated packaging cannot embed a previous
installer's resources inside the next one. To retry only resource preparation
and installer generation after a successful production compilation, reuse the
existing standalone build:

```bash
npm --prefix desktop run prepare-resources -- --skip-build
cd desktop
npx tauri bundle --bundles nsis --ci
```

The reuse option requires an existing `.next/standalone/server.js`; it does not
compile changed frontend code. Do not run a production Next build while the
development server is using the same `.next` directory.

The production resource preparation script copies the Node executable from the machine running the build. Build on the same Windows architecture you intend to distribute.

The desktop frame uses two child WebViews in one native window: a packaged local titlebar and the independently navigating Eureka frontend. The titlebar does not wait for the Node service, page hydration, or authentication. This uses Tauri's `unstable` multi-WebView feature with the SDK versions locked in `Cargo.lock`.

The top five pixels of the local caption forward resize drags to the native
window, including both upper corners. This keeps the caption WebView from
blocking the frameless window's top sizing edge. Resize regions are disabled
while maximized or fullscreen; ordinary caption drags still move the window.

Closing the window (including Alt+F4) hides Eureka to the system tray. The
existing window, conversations and local service remain alive. Left-click the
tray icon, choose **显示 Eureka**, or launch Eureka again to restore the same
window. The right-click menu has three groups: **最近** (up to three sessions,
newest activity first), **新建任务 / 打开 Eureka / 设置**, and **退出 Eureka**.
Recent sessions reuse the sidebar's list without starting an AgentSession or
adding a polling request. Selecting one restores the window and opens that
session through the normal app navigation. Long titles are shortened, and app
actions remain disabled until the frontend is ready. Both the tray's exit action
and **File → 退出 Eureka** exit the
application and stop its bundled local service. If tray creation fails, closing
the window keeps the normal exit behavior so the application remains accessible.
This native feature requires recompiling the desktop shell; refreshing the web
page alone does not install it.

The tray uses a packaged, local-only WebView popup instead of the Windows native
menu, matching the app's shadcn dropdown styling, 9px corner radius and light/dark
palette. Its 220px window (including shadow padding) opens near the tray icon
within the monitor's work area. It dismisses on outside clicks, focus loss or
Escape, and supports arrow-key navigation. Windows also checks actual outside
button presses only while the menu is visible, covering taskbar/desktop clicks
that do not produce a WebView focus-loss event. Its separate
capability allows only reading menu metadata and predefined tray actions.
Truncated session titles show their full text after 450ms using the app tooltip's
5px radius and inverted light/dark colors, rather than a native `title` tooltip.

The titlebar back/forward buttons (also Alt+Left / Alt+Right) traverse in-app session, extension-center, and settings visits. Navigation availability is synchronized from the frontend; startup/auth pages have no app history. Switching between chat and extensions preserves the running chat, and a new visit after going back clears the forward branch.

The File, Edit, View, and Help menus are opened from the native titlebar, with popups rendered in the content WebView so they can extend below the caption. Recent projects use the sidebar's real project list. Edit operations restore the original input selection; normal editing shortcuts retain WebView behavior. Ctrl+Alt+N creates a task, Ctrl+, opens settings, Ctrl+B toggles the sidebar, and Ctrl+Shift+B toggles the file panel. Ctrl++ / Ctrl+- / Ctrl+0 control content zoom, F11 toggles native fullscreen, and F10 opens the menus. Menu readiness and translated labels synchronize after the frontend mounts; actions needing a workspace remain disabled on login pages.

Normal window width and height (in logical pixels), maximized state, and theme preference are saved in `window-state.json` in the application's config directory. Closing a minimized or maximized window preserves its previous normal dimensions. A separate development app identifier keeps testing preferences separate from the installed application.

The composer opens the Windows file picker directly for attachments, starting in the current project directory on every opening. Files can be multi-selected; the picker also includes an Add current folder button. File and folder selections become reference chips, while images retain their thumbnail previews. Browser-only sessions use the browser's file input, whose initial directory is controlled by the browser.

Custom project paths also use the Windows folder picker, starting at the selected project directory. Cancellation keeps the current project; selected directories still pass through `/api/cwd/validate` before switching. Browser-only sessions retain the in-app directory picker, starting at the current project path.

Haze OAuth opens in the system browser and uses the configured loopback callback at `127.0.0.1:8080`; Eureka therefore reserves port 8080 while it is open. The callback retains a short-lived, single-use result on the local server, and only the initiating desktop can claim it and receive its own HttpOnly session cookie. The claim secret and Haze tokens never enter browser URLs. Closing the desktop login page cancels the request; pending requests expire after ten minutes. The build copies the repository `.env.local` into the bundled server resources so its server-only identity configuration is available after installation.
