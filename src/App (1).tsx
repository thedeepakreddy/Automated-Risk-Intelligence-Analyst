import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DashboardPage from './pages/Dashboard.js';
import { FLogo } from './components/Logo.js';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-indigo-500/30">
        <header className="border-b border-zinc-900 bg-black px-8 py-5 flex items-center justify-between sticky top-0 z-50">
          <div className="flex items-center gap-4">
            <FLogo className="w-7 h-7 drop-shadow-md" />
            <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Risk Intelligence</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs uppercase tracking-widest text-zinc-500 font-semibold">Live Systems</span>
            </div>
          </div>
        </header>

        <main className="p-8 max-w-7xl mx-auto border-x border-zinc-900 min-h-[calc(100vh-73px)]">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
