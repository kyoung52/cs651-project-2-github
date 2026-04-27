import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './hooks/useAuth.jsx';
import { ConfigProvider } from './hooks/useConfig.jsx';
import { WorkspaceProvider } from './hooks/useWorkspace.jsx';
import { ToastProvider } from './components/ui/Toast.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConfigProvider>
        <ToastProvider>
          <AuthProvider>
            <WorkspaceProvider>
              <App />
            </WorkspaceProvider>
          </AuthProvider>
        </ToastProvider>
      </ConfigProvider>
    </BrowserRouter>
  </React.StrictMode>
);
