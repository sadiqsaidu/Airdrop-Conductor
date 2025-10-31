import React from 'react';
import { Zap } from 'lucide-react';
import { View } from '../App';

interface HeaderProps {
  setActiveView: (view: View) => void;
  activeView: View;
}

const Header: React.FC<HeaderProps> = ({ setActiveView, activeView }) => {
  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    e.preventDefault();

    const scrollToAction = () => {
      const element = document.getElementById(sectionId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    };

    if (activeView !== 'home') {
      setActiveView('home');
      // Timeout ensures the home view is rendered before we try to scroll
      setTimeout(scrollToAction, 100);
    } else {
      scrollToAction();
    }
  };
  
  return (
    <header className="border-b border-white/5 backdrop-blur-sm relative z-20 sticky top-0">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div 
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => setActiveView('home')}
          >
            <div className="w-9 h-9 bg-gradient-to-br from-zinc-200 to-white rounded-lg flex items-center justify-center shadow-lg shadow-white/20">
              <Zap className="w-5 h-5 text-zinc-900" />
            </div>
            <h1 className="text-xl font-medium tracking-tight text-zinc-50">
              Conductor
            </h1>
          </div>
          <nav className="hidden md:flex gap-8 text-sm">
            <a href="#features" onClick={(e) => handleNavClick(e, 'features')} className="text-zinc-500 hover:text-zinc-300 transition-all">
              Features
            </a>
             <a href="#how-it-works" onClick={(e) => handleNavClick(e, 'how-it-works')} className="text-zinc-500 hover:text-zinc-300 transition-all">
              How It Works
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <div className="px-3 py-1.5 border border-white/10 rounded-lg text-xs flex items-center gap-2 bg-white/5">
              <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full"></div>
              <span className="text-zinc-400">Devnet</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;