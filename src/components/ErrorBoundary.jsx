// Top-level error boundary. A render error in any descendant component
// would otherwise white-screen the whole app (no header, no nav, no way
// to recover). This catches it, shows a minimal reset surface, and lets
// the facilitator reload without losing the Supabase session.

import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] caught:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '100vh',
        padding: '40px 24px', textAlign: 'center',
        background: '#f8f3ea', color: '#3b342c',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{ maxWidth: 520 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Something went wrong.</h1>
          <p style={{ fontSize: 14, color: '#7a6e60', lineHeight: 1.5, marginBottom: 20 }}>
            A component crashed and took the app with it. Your data is safe on the server. A reload should get you back.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 24 }}>
            <button
              style={{
                padding: '8px 18px', background: '#c8956c', color: '#fff',
                border: 'none', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
              onClick={() => window.location.reload()}
            >Reload</button>
          </div>
          <details style={{ fontSize: 12, color: '#7a6e60', textAlign: 'left' }}>
            <summary style={{ cursor: 'pointer' }}>Show error details</summary>
            <pre style={{
              marginTop: 10, padding: 12, background: '#fff', border: '1px solid #e0d9cf',
              borderRadius: 6, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>
          </details>
        </div>
      </div>
    );
  }
}
