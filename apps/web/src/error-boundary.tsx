import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* details remain in the developer console only */ }
  render() { return this.state.failed ? <main className="error-boundary"><h1>Something went wrong</h1><p>The workspace could not be rendered safely.</p><button onClick={() => window.location.reload()}>Reload</button></main> : this.props.children; }
}
