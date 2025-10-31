import React from 'react';
import { Zap, Shield, CheckCircle, Upload, UploadCloud, Database, Cpu, Rocket, Monitor } from 'lucide-react';
import { View } from '../../App';

interface HomeViewProps {
  setActiveView: (view: View) => void;
  jobId: string | null;
}

const FeatureCard: React.FC<{ icon: React.ElementType; title: string; children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <div className="p-6 border border-white/10 rounded-2xl bg-white/5 backdrop-blur-sm hover:bg-white/10 transition-all group max-w-xs flex flex-col items-center text-center">
    <div className="w-11 h-11 bg-gradient-to-br from-zinc-200 to-white rounded-xl flex items-center justify-center mb-5 shadow-lg shadow-white/10 group-hover:shadow-white/20 transition-all">
      <Icon className="w-5 h-5 text-zinc-900" />
    </div>
    <h3 className="text-lg font-medium mb-2">{title}</h3>
    <p className="text-zinc-400 text-sm leading-relaxed font-light">{children}</p>
  </div>
);

const howItWorksSteps = [
  { icon: UploadCloud, title: "1. Upload & Configure", description: "Upload a CSV with recipient addresses and amounts, provide your devnet key, and choose a delivery mode." },
  { icon: Database, title: "2. Secure Job Creation", description: "The backend validates your data, checks token balances, and creates a secure job queue to begin processing." },
  { icon: Cpu, title: "3. Transaction Building", description: "Conductor builds each transaction, automatically creating token accounts for recipients if needed." },
  { icon: Rocket, title: "4. Intelligent Delivery", description: "Sanctum Gateway optimizes and routes each transaction via Jito or RPCs for maximum success rate." },
  { icon: Monitor, title: "5. Real-Time Monitoring", description: "Track the entire distribution live from the dashboard, with on-chain signatures for transparency." },
];

const HomeView: React.FC<HomeViewProps> = ({ setActiveView, jobId }) => {
  return (
    <div className="relative z-10">
      {/* Hero Section */}
      <section className="min-h-screen flex items-center justify-center">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h1 className="text-6xl font-light mb-6 leading-[1.1] tracking-tight max-w-4xl">
            Bulk Token Distribution
            <br />
            <span className="text-zinc-400">on Solana</span>
          </h1>
          
          <p className="text-lg text-zinc-400 mb-10 leading-relaxed font-light max-w-2xl mx-auto">
            High-performance token distribution with optimized transaction delivery. 
            Own your data, control access, verify signatures—all on-chain.
          </p>
          
          <div className="flex justify-center gap-4">
            <button
              onClick={() => setActiveView('upload')}
              className="px-7 py-3.5 bg-gradient-to-br from-zinc-200 to-white text-zinc-900 rounded-lg font-medium flex items-center gap-2 hover:shadow-lg hover:shadow-white/20 transition-all hover:scale-[1.02]"
            >
              Get Started
              <Upload className="w-4 h-4" />
            </button>
            {jobId && (
              <button
                onClick={() => setActiveView('dashboard')}
                className="px-7 py-3.5 border border-white/20 rounded-lg font-medium hover:border-white/40 hover:bg-white/5 transition-all"
              >
                View Dashboard
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="min-h-screen flex items-center justify-center py-24">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-light mb-4 tracking-tight">Powerful Features</h2>
          <p className="text-lg text-zinc-400 max-w-3xl mx-auto mb-16 leading-relaxed font-light">
            Designed for reliability and efficiency, ensuring your distributions succeed every time.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 justify-center">
            <FeatureCard icon={Shield} title="High Assurance">
              Leverages Sanctum Sender and Jito for maximum reliability and the highest success rates.
            </FeatureCard>
            
            <FeatureCard icon={Zap} title="Cost Saver">
              Utilizes standard RPC delivery for budget-conscious distributions without compromising on core functionality.
            </FeatureCard>
            
            <FeatureCard icon={CheckCircle} title="Auto Retry">
              Benefit from intelligent, automatic retry logic with detailed, real-time status tracking for every single task.
            </FeatureCard>
          </div>
        </div>
      </section>
      
      {/* How It Works Section */}
      <section id="how-it-works" className="min-h-screen flex items-center justify-center py-24">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-light mb-4 tracking-tight">How It Works</h2>
          <p className="text-lg text-zinc-400 max-w-3xl mx-auto mb-20 leading-relaxed font-light">
            A simple, powerful, and reliable process from start to finish, powered by Sanctum Gateway.
          </p>
          
          <div className="relative max-w-2xl mx-auto">
             <div className="absolute left-1/2 top-0 h-full w-px bg-white/10 -translate-x-1/2" aria-hidden="true"></div>
              <div className="space-y-16">
                {howItWorksSteps.map((step, index) => {
                  const Icon = step.icon;
                  const isEven = index % 2 === 0;
                  return (
                    <div key={step.title} className="relative flex items-center">
                      <div className={`w-[calc(50%-2rem)] ${isEven ? 'order-1 text-right' : 'order-3 text-left'}`}>
                        <div className="inline-block p-6 border border-white/10 rounded-2xl bg-white/5 backdrop-blur-sm">
                          <h4 className="font-medium mb-2 text-zinc-100">{step.title}</h4>
                          <p className="text-zinc-400 text-sm leading-relaxed font-light">{step.description}</p>
                        </div>
                      </div>
                      <div className="order-2 w-16 h-16 flex items-center justify-center border-2 border-white/10 rounded-full bg-zinc-950 mx-auto">
                        <Icon className="w-7 h-7 text-zinc-300" />
                      </div>
                    </div>
                  );
                })}
              </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomeView;