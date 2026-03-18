import React, { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { Download, X, Share2, Github, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- Types (Duplicated from App.tsx for independence) ---
type Elements = { metal: number; wood: number; water: number; fire: number; earth: number };

interface OracleResult {
  elements: Elements;
  hexagram: string;
  judgment: string;
  forecast: string;
  advice: string;
  repoStars?: number;
  repoForks?: number;
  repoLanguage?: string;
  repoCreatedAt?: string;
  repoPushedAt?: string;
  repoOpenIssues?: number;
  repoSize?: number;
  repoLicense?: string;
  repoSubscribersCount?: number;
  bazi?: string;
  destiny_type?: string;
  innate_elements?: Elements;
  acquired_elements?: Elements;
  analysis?: any[];
  lifecycle?: { stage: string; hexagram: string; ageYears: number; focus: string; warning: string };
}

interface ShareCardProps {
  data: OracleResult;
  repoUrl?: string; // Optional, derived from context or passed
  onClose: () => void;
  isOpen: boolean;
}

const ELEMENT_LABELS: Record<string, string> = {
  wood: '木',
  fire: '火',
  earth: '土',
  metal: '金',
  water: '水',
};

// Five Elements Generating Cycle order for the chart
const ORDER = ['wood', 'fire', 'earth', 'metal', 'water'] as const;

export default function ShareCard({ data, repoUrl, onClose, isOpen }: ShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // --- Radar Chart Logic ---
  const size = 200;
  const center = size / 2;
  const radius = size * 0.4;
  
  const getPoint = (index: number, value: number) => {
    const angle = (Math.PI * 2 * index) / 5 - Math.PI / 2; // Start from top
    const r = radius * value; // value is 0-1
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  const points = ORDER.map((key, i) => {
    const val = data.elements[key] || 0.2; // minimal value for visibility
    return getPoint(i, Math.max(0.2, val)); // Ensure shape doesn't collapse
  }).map(p => `${p.x},${p.y}`).join(' ');

  const bgPoints = ORDER.map((_, i) => getPoint(i, 1.0)).map(p => `${p.x},${p.y}`).join(' ');
  const gridPoints = [0.2, 0.4, 0.6, 0.8].map(scale => 
    ORDER.map((_, i) => getPoint(i, scale)).map(p => `${p.x},${p.y}`).join(' ')
  );

  // --- Image Generation ---
  const handleDownload = async () => {
    if (!cardRef.current) return;
    setIsGenerating(true);
    try {
      // Small delay to ensure rendering
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: '#050505',
        scale: 2, // High res
        useCORS: true,
        logging: false,
      });

      const image = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = image;
      link.download = `oracle-card-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to generate image:', err);
      alert('生成灵符失败，请重试');
    } finally {
      setIsGenerating(false);
    }
  };

  // Determine "Divine Status" based on overall score or specific traits
  const totalScore = Object.values(data.elements).reduce((a, b) => a + b, 0);
  const divineStatus = totalScore > 3.5 ? '天选' : totalScore > 2.5 ? '吉兆' : '凡品';
  const statusColor = divineStatus === '天选' ? 'text-yellow-400' : divineStatus === '吉兆' ? 'text-blue-400' : 'text-gray-400';

  const repoName = repoUrl ? repoUrl.replace(/^https?:\/\/github\.com\//, '') : 'Unknown/Repo';
  const [owner, name] = repoName.split('/');

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
          onClick={(e) => {
             // Close on backdrop click
             if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="relative flex flex-col items-center gap-6 max-h-full">
            {/* Controls */}
            <div className="flex items-center gap-4 z-10 w-full justify-between max-w-[450px]">
               <h3 className="text-white/60 text-sm font-mono tracking-widest">赛博灵符预览</h3>
               <div className="flex gap-3">
                 <button 
                   onClick={handleDownload}
                   disabled={isGenerating}
                   className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 rounded text-xs tracking-widest transition-colors disabled:opacity-50"
                 >
                   {isGenerating ? <Loader2 className="animate-spin w-3 h-3" /> : <Download className="w-3 h-3" />}
                   {isGenerating ? '绘制中...' : '保存灵符'}
                 </button>
                 <button 
                   onClick={onClose}
                   className="p-2 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded transition-colors"
                 >
                   <X className="w-4 h-4" />
                 </button>
               </div>
            </div>

            {/* The Card (Target for html2canvas) */}
            <div 
              ref={cardRef}
              className="w-[450px] bg-[#050505] text-white overflow-hidden relative border border-white/10 shadow-2xl flex-shrink-0"
              style={{ minHeight: '800px' }} // Fixed min height for scroll look
            >
              {/* Decorative Background Elements */}
              <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none" 
                   style={{ 
                     backgroundImage: 'radial-gradient(circle at 50% 0%, #D4AF37 0%, transparent 40%)'
                   }} 
              />
              <div className="absolute top-[100px] right-[-50px] w-[200px] h-[200px] rounded-full border border-white/5 opacity-20 blur-xl" />
              <div className="absolute bottom-[100px] left-[-50px] w-[150px] h-[150px] rounded-full border border-yellow-500/10 opacity-20 blur-xl" />

              {/* Header */}
              <div className="relative p-8 pb-4 border-b border-white/5">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-4">
                    {/* Fake Avatar based on owner name initial or actual image if available */}
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-gray-800 to-black border border-white/20 flex items-center justify-center text-xl font-serif text-white/80 shadow-[0_0_15px_rgba(255,255,255,0.1)]">
                       {owner ? owner[0].toUpperCase() : 'G'}
                    </div>
                    <div>
                      <div className="text-[10px] text-yellow-500/60 tracking-[0.2em] mb-1">PROJECT ORACLE</div>
                      <h1 className="text-xl font-serif tracking-wide text-white leading-tight">
                        {owner} / <br/>
                        <span className="text-white font-light opacity-90">{name}</span>
                      </h1>
                    </div>
                  </div>
                  <div className={`px-3 py-1 border border-white/10 text-[10px] tracking-widest ${statusColor} bg-white/5 backdrop-blur-md`}>
                    {divineStatus}
                  </div>
                </div>
                
                <div className="flex gap-4 text-[10px] text-white/40 font-mono tracking-wider">
                  {data.repoStars !== undefined && <span>★ {data.repoStars}</span>}
                  {data.repoForks !== undefined && <span>⑂ {data.repoForks}</span>}
                  <span>{data.repoLanguage || 'Unknown'}</span>
                </div>
              </div>

              {/* Visual Center: Radar Chart */}
              <div className="relative py-8 flex flex-col items-center justify-center border-b border-white/5 bg-white/[0.01]">
                <div className="absolute top-4 left-6 text-[10px] text-white/30 tracking-[0.2em]">ELEMENTAL CHART / 五行图谱</div>
                <div className="w-[200px] h-[200px] relative">
                   <svg width="200" height="200" viewBox="0 0 200 200" className="overflow-visible">
                      {/* Grid */}
                      {gridPoints.map((pointsStr, idx) => (
                        <polygon key={idx} points={pointsStr} fill="none" stroke="#ffffff" strokeOpacity={0.05 + idx * 0.05} strokeWidth="1" />
                      ))}
                      {/* Axes */}
                      {ORDER.map((_, i) => {
                        const p = getPoint(i, 1.0);
                        return <line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke="#ffffff" strokeOpacity="0.1" />;
                      })}
                      {/* Data Shape */}
                      <polygon points={points} fill="rgba(212, 175, 55, 0.2)" stroke="#D4AF37" strokeWidth="1.5" />
                      {/* Labels */}
                      {ORDER.map((key, i) => {
                        const p = getPoint(i, 1.25);
                        return (
                          <text 
                            key={i} 
                            x={p.x} 
                            y={p.y} 
                            textAnchor="middle" 
                            dominantBaseline="middle" 
                            fill="#9ca3af" 
                            className="text-[10px] font-serif"
                            style={{ fontSize: '10px' }}
                          >
                            {ELEMENT_LABELS[key]}
                          </text>
                        );
                      })}
                   </svg>
                </div>
              </div>

              {/* The Oracle Content */}
              <div className="p-8 relative min-h-[300px]">
                <div className="absolute top-8 right-8 text-6xl font-serif text-white/[0.03] pointer-events-none select-none">
                  {data.hexagram}
                </div>
                
                <div className="mb-8">
                  <h3 className="text-yellow-500/80 text-xs tracking-[0.3em] mb-3 uppercase border-l-2 border-yellow-500/30 pl-3">
                    Destiny / 命格
                  </h3>
                  <p className="text-lg text-white/90 font-serif leading-relaxed">
                    {data.destiny_type || '未知命格'} · {data.hexagram}
                  </p>
                </div>

                <div className="mb-8">
                  <h3 className="text-blue-400/80 text-xs tracking-[0.3em] mb-3 uppercase border-l-2 border-blue-400/30 pl-3">
                    Judgment / 判词
                  </h3>
                  <p className="text-sm text-gray-300 font-serif leading-7 text-justify tracking-wide opacity-90">
                    {data.judgment}
                  </p>
                </div>

                {data.advice && (
                   <div className="mb-6">
                    <h3 className="text-emerald-400/80 text-xs tracking-[0.3em] mb-3 uppercase border-l-2 border-emerald-400/30 pl-3">
                      Guidance / 建议
                    </h3>
                    <p className="text-sm text-gray-300 font-serif leading-7 text-justify tracking-wide opacity-90">
                      {data.advice}
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="mt-auto border-t border-white/10 bg-white/[0.02] p-6 flex items-end justify-between">
                 <div>
                    <div className="flex items-center gap-2 mb-2 text-white/80">
                      <Share2 className="w-3 h-3 text-yellow-500" />
                      <span className="text-xs font-bold tracking-widest">SOFTWARE ORACLE</span>
                    </div>
                    <p className="text-[9px] text-white/30 max-w-[200px] leading-relaxed">
                      Generated by DeepSeek AI & Five Elements Algorithm.
                      <br/>
                      Design by Juni.
                    </p>
                 </div>
                 
                 {/* QR Code Placeholder */}
                 <div className="flex flex-col items-center gap-1">
                    <div className="w-16 h-16 bg-white p-1">
                      {/* Simple visual placeholder for QR */}
                      <div className="w-full h-full border border-black flex items-center justify-center bg-white overflow-hidden relative">
                         {/* Actual QR Code using user's deployment URL (fallback to GitHub if local) */}
                         <div className="absolute inset-0 bg-white p-1">
                           <img 
                             src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent('https://software-oracle.vercel.app/')}`}
                             alt="QR Code"
                             className="w-full h-full mix-blend-multiply opacity-90"
                           />
                         </div>
                      </div>
                    </div>
                    <span className="text-[8px] text-white/20 tracking-widest">SCAN TO DIVINE</span>
                 </div>
              </div>
            </div>
            
            <p className="text-white/30 text-[10px] font-mono animate-pulse">
               Tip: 点击保存灵符即可下载高清图片
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
