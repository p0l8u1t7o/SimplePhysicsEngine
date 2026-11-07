import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './styles.css';

// 任何一頁渲染時丟例外，React 會卸載整個 root（整頁空白）；這裡接住，至少顯示錯誤並能重新載入
class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error(error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="page" role="alert" style={{ padding: 24 }}>
      <h2>畫面發生錯誤</h2>
      <p className="mute">這一頁的資料沒辦法顯示。可以先重新載入；如果一直發生，把下面的訊息給維護的人。</p>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error?.message || this.state.error)}</pre>
      <button className="primary" onClick={() => location.reload()}>重新載入</button>
    </div>;
  }
}

createRoot(document.getElementById('root')).render(<Boundary><App /></Boundary>);
