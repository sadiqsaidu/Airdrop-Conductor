import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="relative z-10 border-t border-white/5 mt-24">
      <div className="max-w-7xl mx-auto px-6 py-8 text-center text-sm text-zinc-500">
        <p className="mb-2">
          Powered by{' '}
          <a
            href="https://www.sanctum.so/gateway"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-white transition-colors underline decoration-zinc-700 hover:decoration-zinc-400"
          >
            Sanctum Gateway
          </a>
        </p>
        <p>&copy; {new Date().getFullYear()} Conductor. All rights reserved.</p>
      </div>
    </footer>
  );
};

export default Footer;