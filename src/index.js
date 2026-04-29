// CRA requires the entry point at src/index.js
// We just re-export from our actual renderer directory.
export { default } from './renderer/App';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './renderer/App';
import './renderer/styles/global.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
