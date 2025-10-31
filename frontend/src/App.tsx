import { useState } from 'react';
import WalletContextProvider from './contexts/WalletContextProvider';
import Header from './components/Header';
import StarryBackground from './components/StarryBackground';
import HomeView from './components/views/HomeView';
import UploadView from './components/views/UploadView';
import DashboardView from './components/views/DashboardView';
import Footer from './components/Footer';

export type View = 'home' | 'upload' | 'dashboard';

export default function App() {
  const [activeView, setActiveView] = useState<View>('home');
  const [jobId, setJobId] = useState<string | null>(null);

  const renderView = () => {
    switch (activeView) {
      case 'upload':
        return <UploadView setActiveView={setActiveView} setJobId={setJobId} />;
      case 'dashboard':
        return <DashboardView setActiveView={setActiveView} jobId={jobId} />;
      case 'home':
      default:
        return <HomeView setActiveView={setActiveView} jobId={jobId} />;
    }
  };

  return (
    <WalletContextProvider>
      <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-neutral-950 to-black text-zinc-100 flex flex-col">
        <StarryBackground />
        <Header setActiveView={setActiveView} activeView={activeView} />
        <main className="relative z-10 flex-grow">
          {renderView()}
        </main>
        <Footer />
      </div>
    </WalletContextProvider>
  );
}