
import React, { useState, useEffect, useMemo } from 'react';
import { 
  SprayBrand, 
  SprayLine, 
  EstimationState, 
  AnalysisResult,
  SprayColor,
  ArtworkItem,
  SavedProject
} from './types';
import { BRAND_COLORS, BRAND_LINES, CAN_COVERAGE } from './constants';
import { analyzeArtworkColors, findNearestColor } from './services/geminiService';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  Cell 
} from 'recharts';

const STORAGE_KEY = 'SPRAYMASTER_PROJECTS';

const createInitialWorkspaceState = (): EstimationState => ({
  items: [{ id: crypto.randomUUID(), width: 2.0, height: 2.5, image: null }],
  brand: SprayBrand.MOLOTOW,
  line: SprayLine.MOLOTOW_PREMIUM,
  results: null,
  totalArea: 0,
  loading: false,
  error: null,
});

const App: React.FC = () => {
  const [state, setState] = useState<EstimationState>(createInitialWorkspaceState());
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [projectName, setProjectName] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showNavOverlay, setShowNavOverlay] = useState(false);
  const [showCopyText, setShowCopyText] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setSavedProjects(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse saved projects");
      }
    }
  }, []);

  const saveProject = () => {
    if (!state.results) return;
    const name = projectName.trim() || `分析檔案_${new Date().toLocaleDateString('zh-TW')}`;
    const newProject: SavedProject = {
      id: crypto.randomUUID(),
      name,
      timestamp: Date.now(),
      state: JSON.parse(JSON.stringify(state))
    };
    
    const updated = [newProject, ...savedProjects];
    setSavedProjects(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setProjectName('');
    setShowSaveModal(false);
  };

  const loadProject = (project: SavedProject) => {
    setState(project.state);
    setShowNavOverlay(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('確定要刪除此存檔嗎？')) {
      const updated = savedProjects.filter(p => p.id !== id);
      setSavedProjects(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
  };

  const addItem = () => {
    setState(prev => ({
      ...prev,
      items: [...prev.items, { id: crypto.randomUUID(), width: 2.0, height: 2.5, image: null }]
    }));
  };

  const removeItem = (id: string) => {
    if (state.items.length <= 1) return;
    setState(prev => ({
      ...prev,
      items: prev.items.filter(item => item.id !== id)
    }));
  };

  const updateItem = (id: string, updates: Partial<ArtworkItem>) => {
    setState(prev => ({
      ...prev,
      items: prev.items.map(item => item.id === id ? { ...item, ...updates } : item)
    }));
  };

  const handleBrandChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const brand = e.target.value as SprayBrand;
    setState(prev => ({
      ...prev,
      brand,
      line: BRAND_LINES[brand][0],
      results: null 
    }));
  };

  const handleImageUpload = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        updateItem(id, { image: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const calculateEstimation = async () => {
    const validItems = state.items.filter(item => item.image && item.width > 0 && item.height > 0);
    if (validItems.length === 0) {
      alert("請上傳圖片並設置尺寸。");
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const brandPalette = BRAND_COLORS.filter(c => c.brand === state.brand && c.line === state.line);
      const mergedMap = new Map<string, { 
        matchedColor: SprayColor, 
        totalAreaCovered: number,
        totalPercentage: number
      }>();

      let totalProjectArea = 0;

      for (const item of validItems) {
        const itemArea = item.width * item.height;
        totalProjectArea += itemArea;
        
        const rawColors = await analyzeArtworkColors(item.image!);
        
        rawColors.forEach((colorData: any) => {
          const matched = findNearestColor(colorData.hex, brandPalette);
          const key = `${matched.brand}-${matched.line}-${matched.code}`;
          const colorAreaContribution = (colorData.percentage / 100) * itemArea;

          if (mergedMap.has(key)) {
            const existing = mergedMap.get(key)!;
            existing.totalAreaCovered += colorAreaContribution;
          } else {
            mergedMap.set(key, {
              matchedColor: matched,
              totalAreaCovered: colorAreaContribution,
              totalPercentage: 0
            });
          }
        });
      }

      const analysisResults: AnalysisResult[] = Array.from(mergedMap.values()).map(data => {
        const cans = Math.max(1, Math.ceil(data.totalAreaCovered / CAN_COVERAGE));
        const percentageOfWhole = (data.totalAreaCovered / totalProjectArea) * 100;
        
        return {
          colorName: data.matchedColor.name,
          hex: data.matchedColor.hex,
          percentage: Math.round(percentageOfWhole * 100) / 100,
          matchedColor: data.matchedColor,
          cansRequired: cans,
        };
      }).sort((a, b) => 
        a.matchedColor!.code.localeCompare(b.matchedColor!.code, undefined, { numeric: true, sensitivity: 'base' })
      );

      setState(prev => ({
        ...prev,
        results: analysisResults,
        totalArea: totalProjectArea,
        loading: false
      }));
    } catch (err: any) {
      setState(prev => ({ ...prev, loading: false, error: "分析失敗。" }));
    }
  };

  const adjustCans = (index: number, delta: number) => {
    setState(prev => {
      if (!prev.results) return prev;
      const newResults = prev.results.map((item, i) => {
        if (i === index) {
          return { ...item, cansRequired: Math.max(0, item.cansRequired + delta) };
        }
        return item;
      });
      return { ...prev, results: newResults };
    });
  };

  const removeResult = (index: number) => {
    setState(prev => {
      if (!prev.results) return prev;
      return {
        ...prev,
        results: prev.results.filter((_, i) => i !== index)
      };
    });
  };

  const addManualColor = (color: SprayColor) => {
    setState(prev => {
      const currentResults = prev.results || [];
      const existingIndex = currentResults.findIndex(r => r.matchedColor?.code === color.code);

      if (existingIndex > -1) {
        const newResults = currentResults.map((item, i) => 
          i === existingIndex ? { ...item, cansRequired: item.cansRequired + 1 } : item
        );
        return { ...prev, results: newResults };
      }

      const newResult: AnalysisResult = {
        colorName: color.name,
        hex: color.hex,
        percentage: 0,
        matchedColor: color,
        cansRequired: 1
      };
      
      const updatedResults = [...currentResults, newResult].sort((a, b) => 
        a.matchedColor!.code.localeCompare(b.matchedColor!.code, undefined, { numeric: true, sensitivity: 'base' })
      );
      
      return { ...prev, results: updatedResults };
    });
  };

  const totalCans = useMemo(() => {
    return state.results?.reduce((sum, item) => sum + item.cansRequired, 0) || 0;
  }, [state.results]);

  const currentBrandPalette = useMemo(() => {
    return BRAND_COLORS.filter(c => c.brand === state.brand && c.line === state.line);
  }, [state.brand, state.line]);

  const purchaseListText = useMemo(() => {
    if (!state.results) return '';
    let text = `SPRAYMASTER PRO - 採購清單\n`;
    text += `品牌: ${state.brand} | 系列: ${state.line}\n`;
    text += `總面積: ${state.totalArea.toFixed(2)} m² | 總罐數: ${totalCans}\n`;
    text += `-----------------------------------\n`;
    state.results.forEach(item => {
      text += `${item.matchedColor?.name} (#${item.matchedColor?.code}): ${item.cansRequired} 罐\n`;
    });
    return text;
  }, [state.results, state.brand, state.line, state.totalArea, totalCans]);

  const handleCopy = () => {
    navigator.clipboard.writeText(purchaseListText);
    setCopyStatus('copied');
    setTimeout(() => setCopyStatus('idle'), 2000);
  };

  return (
    <div className="min-h-screen pb-12 bg-[#020617] text-slate-200">
      {/* Top Header */}
      <header className="py-4 px-6 flex justify-between items-center border-b border-white/5 glass-effect sticky top-0 z-[60] backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-cyan-500 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.4)]">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tighter leading-none">SprayMaster <span className="text-cyan-400">Pro</span></h1>
            <p className="text-[7px] font-black tracking-[0.4em] text-slate-500 mt-1 uppercase">Master Selection System</p>
          </div>
        </div>

        <button 
          onClick={() => setShowNavOverlay(true)}
          className="w-12 h-12 flex flex-col items-center justify-center gap-1.5 rounded-xl hover:bg-white/10 transition-all group"
          title="開啟專案庫"
        >
          <div className="w-6 h-1 bg-cyan-400 rounded-full"></div>
          <div className="w-6 h-1 bg-cyan-400/60 rounded-full"></div>
          <div className="w-6 h-1 bg-cyan-400/30 rounded-full"></div>
        </button>
      </header>

      {/* Floating Navigation Overlay */}
      {showNavOverlay && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowNavOverlay(false)}></div>
          
          <div className="relative w-full max-w-2xl bg-slate-900/70 backdrop-blur-2xl border border-white/10 rounded-[48px] p-8 shadow-[0_0_100px_rgba(0,0,0,0.8)] flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-300">
            <button 
              onClick={() => setShowNavOverlay(false)}
              className="absolute top-6 right-6 text-slate-400 hover:text-white transition-all hover:rotate-90 p-2"
            >
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>

            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1m-6 9h6m-3-3l3 3m0 0l-3 3" /></svg>
              </div>
              <h2 className="text-3xl font-black uppercase tracking-tighter text-white">專案歷史庫</h2>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 overflow-y-auto pr-4 custom-scrollbar">
              {savedProjects.length === 0 ? (
                <div className="col-span-full py-20 text-center">
                  <p className="text-slate-500 font-black uppercase tracking-[0.4em] text-xs">目前暫無任何存檔專案</p>
                </div>
              ) : (
                savedProjects.map((project) => (
                  <div 
                    key={project.id} 
                    onClick={() => loadProject(project)}
                    className="p-5 rounded-[32px] bg-white/5 border border-white/5 hover:bg-white/10 hover:border-cyan-500/40 transition-all cursor-pointer group relative flex flex-col shadow-xl"
                  >
                    <div className="w-full h-32 rounded-2xl bg-slate-950/50 overflow-hidden border border-white/5 mb-4">
                      {project.state.items[0]?.image ? (
                        <img src={project.state.items[0].image} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center opacity-20"><svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div>
                      )}
                    </div>
                    <h3 className="text-sm font-black text-white truncate uppercase tracking-tight">{project.name}</h3>
                    <div className="flex justify-between items-center mt-2">
                      <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">
                        {new Date(project.timestamp).toLocaleDateString('zh-TW')}
                      </p>
                      <p className="text-[8px] font-black text-cyan-500 bg-cyan-950/30 px-2 py-0.5 rounded-full border border-cyan-500/20">
                        {project.state.totalArea.toFixed(1)} m²
                      </p>
                    </div>
                    <button 
                      onClick={(e) => deleteProject(project.id, e)}
                      className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 bg-red-500/80 hover:bg-red-500 text-white w-7 h-7 rounded-full flex items-center justify-center text-[10px] z-20 transition-all shadow-xl font-black"
                    >✕</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-200">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setShowSaveModal(false)}></div>
          <div className="relative w-full max-w-md bg-slate-900/90 border border-white/10 rounded-[40px] p-10 shadow-2xl">
            <h3 className="text-2xl font-black uppercase tracking-tighter mb-2 text-white">命名分析專案</h3>
            <p className="text-slate-400 text-xs mb-8 font-medium leading-relaxed uppercase tracking-widest">儲存後的檔案將保留於「專案歷史庫」中供日後載入。</p>
            <input 
              type="text" 
              autoFocus
              placeholder={`分析檔案_${new Date().toLocaleDateString('zh-TW')}`}
              value={projectName} 
              onChange={(e) => setProjectName(e.target.value)} 
              onKeyDown={(e) => e.key === 'Enter' && saveProject()}
              className="w-full bg-black/50 border border-slate-700 rounded-2xl px-6 h-14 text-sm font-black outline-none focus:border-cyan-500 transition-all mb-8 text-white shadow-inner" 
            />
            <div className="flex gap-4">
              <button onClick={() => setShowSaveModal(false)} className="flex-1 h-14 rounded-2xl bg-slate-800 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-700 transition-all">取消</button>
              <button onClick={saveProject} className="flex-1 h-14 rounded-2xl bg-cyan-500 text-black text-[10px] font-black uppercase tracking-[0.2em] hover:bg-cyan-400 transition-all shadow-lg shadow-cyan-500/20 active:scale-95">確認存檔</button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Workspace Column */}
        <div className="lg:col-span-5 space-y-8">
          <section className="p-6 rounded-[40px] glass-effect border border-white/5 space-y-6">
            <div className="flex justify-between items-center px-2">
              <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-cyan-500">Artwork Configuration</h2>
              <button 
                onClick={addItem}
                className="bg-cyan-500/5 hover:bg-cyan-500/10 text-cyan-400 text-[9px] font-black py-2.5 px-5 rounded-2xl uppercase tracking-widest border border-cyan-500/20 transition-all active:scale-95"
              >
                + ADD SURFACE
              </button>
            </div>
            
            <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              {state.items.map((item) => (
                <div key={item.id} className="p-6 rounded-[32px] bg-slate-950/40 border border-white/5 flex flex-col gap-6 relative group shadow-2xl">
                  <button onClick={() => removeItem(item.id)} className="absolute top-4 right-4 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-2 bg-slate-900 rounded-xl shadow-xl z-10">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                  
                  <div 
                    className={`w-full ${item.image ? 'h-auto' : 'h-56'} rounded-3xl bg-slate-900/80 border-2 border-dashed border-slate-800 flex items-center justify-center cursor-pointer overflow-hidden transition-all hover:border-cyan-500/30 shadow-inner group-hover:bg-slate-800/10`}
                    onClick={() => document.getElementById(`upload-${item.id}`)?.click()}
                  >
                    {item.image ? (
                      <img src={item.image} className="w-full h-auto block" alt="Artwork" />
                    ) : (
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-16 h-16 rounded-[24px] bg-slate-950 flex items-center justify-center border border-slate-800 shadow-2xl">
                           <svg className="w-8 h-8 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        </div>
                        <span className="text-[10px] text-slate-600 uppercase font-black tracking-[0.4em]">Upload Source Image</span>
                      </div>
                    )}
                    <input id={`upload-${item.id}`} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(item.id, e)} />
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block ml-3">Width (M)</label>
                      <input 
                        type="number" 
                        value={item.width} 
                        onChange={(e) => updateItem(item.id, { width: parseFloat(e.target.value) || 0 })} 
                        className="w-full bg-black/40 border border-slate-800 rounded-2xl px-6 text-base outline-none h-14 font-black focus:border-cyan-500 transition-all text-white shadow-inner" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block ml-3">Height (M)</label>
                      <input 
                        type="number" 
                        value={item.height} 
                        onChange={(e) => updateItem(item.id, { height: parseFloat(e.target.value) || 0 })} 
                        className="w-full bg-black/40 border border-slate-800 rounded-2xl px-6 text-base outline-none h-14 font-black focus:border-cyan-500 transition-all text-white shadow-inner" 
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-8 border-t border-white/5 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest ml-3">Brand Selection</span>
                  <select value={state.brand} onChange={handleBrandChange} className="w-full bg-black/30 border border-slate-800 rounded-2xl px-5 text-[11px] font-black uppercase tracking-widest h-14 outline-none focus:border-cyan-500 text-slate-300 shadow-inner">
                    {Object.values(SprayBrand).map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest ml-3">Spray Series</span>
                  <select value={state.line} onChange={(e) => setState(prev => ({ ...prev, line: e.target.value as SprayLine }))} className="w-full bg-black/30 border border-slate-800 rounded-2xl px-5 text-[11px] font-black uppercase tracking-widest h-14 outline-none focus:border-cyan-500 text-slate-300 shadow-inner">
                    {BRAND_LINES[state.brand].map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              <button 
                onClick={calculateEstimation} 
                className="w-full py-6 bg-gradient-to-br from-cyan-600 to-blue-700 text-white font-black text-sm uppercase tracking-[0.3em] rounded-[32px] shadow-[0_15px_40px_rgba(8,145,178,0.5)] active:scale-[0.98] transition-all disabled:opacity-50"
                disabled={state.loading}
              >
                {state.loading ? "CALCULATING NEURAL MATRIX..." : "ANALYZE COLOR DATA"}
              </button>
            </div>
          </section>

          {/* Color Palette Selection */}
          <section className="p-6 rounded-[40px] glass-effect border border-white/5">
            <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-400 mb-6 flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.6)]"></div>
              {state.brand} Master Palette ({currentBrandPalette.length})
            </h2>
            <div className="grid grid-cols-6 sm:grid-cols-8 gap-3.5 max-h-[300px] overflow-y-auto pr-4 custom-scrollbar">
              {currentBrandPalette.map((color, idx) => (
                <button
                  key={`${color.code}-${idx}`}
                  onClick={() => addManualColor(color)}
                  className="group relative aspect-square rounded-2xl border-2 border-white/5 hover:border-white/50 hover:scale-110 transition-all z-0 hover:z-10 shadow-xl"
                  style={{ backgroundColor: color.hex }}
                >
                  <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-2xl transition-all duration-300">
                    <span className="text-[10px] text-white font-black tracking-tighter">{color.code}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* Results Column */}
        <div className="lg:col-span-7 space-y-8">
          {!state.results ? (
            <div className="h-full min-h-[600px] border-2 border-dashed border-slate-800/30 rounded-[60px] flex flex-col items-center justify-center text-slate-700 p-12 text-center bg-slate-950/5 backdrop-blur-3xl">
              <div className="w-28 h-28 mb-10 rounded-[44px] bg-slate-900 flex items-center justify-center border border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative">
                <div className="absolute -inset-4 bg-cyan-500/5 blur-3xl rounded-full"></div>
                <svg className="w-14 h-14 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <h2 className="text-2xl uppercase font-black tracking-[0.5em] text-slate-500">Awaiting Data</h2>
              <p className="text-xs font-bold mt-5 max-w-sm text-slate-600 leading-relaxed uppercase tracking-widest">Upload your artwork and dimensions to activate the high-precision paint estimation engine.</p>
            </div>
          ) : (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-12 duration-1000">
              {/* Stats Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="p-6 rounded-[32px] bg-slate-900/60 border border-white/5 shadow-2xl">
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 block">Total Area</span>
                  <div className="text-2xl font-black text-white">{state.totalArea.toFixed(2)} <span className="text-slate-500 text-sm">m²</span></div>
                </div>
                <div className="p-6 rounded-[32px] bg-cyan-500/5 border border-cyan-500/20 shadow-2xl">
                  <span className="text-[9px] font-black text-cyan-500 uppercase tracking-[0.2em] mb-2 block">Required Cans</span>
                  <div className="text-3xl font-black text-cyan-400">{totalCans} <span className="text-cyan-600 text-sm font-bold">UNITS</span></div>
                </div>
                <div className="p-6 rounded-[32px] bg-indigo-500/5 border border-indigo-500/20 shadow-2xl">
                  <span className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-2 block">Color Index</span>
                  <div className="text-2xl font-black text-white">{state.results.length} <span className="text-slate-500 text-sm">KEYS</span></div>
                </div>
                <div className="flex flex-col gap-3">
                   <button 
                    onClick={() => setShowSaveModal(true)} 
                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 rounded-3xl text-[11px] font-black uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-2 group border border-indigo-400/20 active:scale-95"
                  >
                    <svg className="w-5 h-5 group-hover:scale-125 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                    SAVE PROJECT
                  </button>
                  <button 
                    onClick={() => setShowCopyText(!showCopyText)} 
                    className="flex-1 bg-slate-800 hover:bg-slate-700 rounded-3xl text-[11px] font-black uppercase tracking-widest transition-all border border-white/5 shadow-xl active:scale-95"
                  >
                    EXPORT LIST
                  </button>
                </div>
              </div>

              {showCopyText && (
                <div className="p-8 bg-black/80 rounded-[48px] border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.6)] animate-in zoom-in-95 duration-400 backdrop-blur-3xl">
                  <textarea readOnly value={purchaseListText} className="w-full h-48 bg-transparent text-sm font-mono text-cyan-200 outline-none resize-none custom-scrollbar leading-loose" />
                  <div className="mt-8 flex justify-end gap-4">
                    <button onClick={handleCopy} className="bg-cyan-500 text-black px-10 py-4 rounded-[20px] text-xs font-black uppercase tracking-[0.2em] hover:bg-cyan-400 transition-all shadow-2xl shadow-cyan-500/20 active:scale-95">
                      {copyStatus === 'copied' ? 'COPIED TO CLIPBOARD' : 'COPY ORDER SUMMARY'}
                    </button>
                    <button onClick={() => setShowCopyText(false)} className="bg-slate-800 text-white px-10 py-4 rounded-[20px] text-xs font-black uppercase tracking-[0.2em] hover:bg-slate-700 transition-all active:scale-95">DISMISS</button>
                  </div>
                </div>
              )}

              <div className="h-80 glass-effect p-8 rounded-[60px] shadow-2xl border border-white/5 overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={state.results}>
                    <XAxis dataKey="colorName" stroke="#475569" fontSize={8} tickLine={false} interval={0} angle={-45} textAnchor="end" height={60} />
                    <YAxis stroke="#475569" fontSize={10} tickLine={false} />
                    <Tooltip 
                      cursor={{fill: 'rgba(255,255,255,0.03)'}} 
                      contentStyle={{ backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '32px', fontSize: '13px', fontWeight: '900', boxShadow: '0 35px 70px -15px rgba(0,0,0,0.7)', color: '#fff' }} 
                    />
                    <Bar dataKey="percentage" radius={[10, 10, 0, 0]} barSize={40}>
                      {state.results.map((e, i) => <Cell key={i} fill={e.hex} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* 更新後的詳細清單區塊：縮短高度並移除標籤與陰影 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-20">
                {state.results.map((item, idx) => (
                  <div key={`${item.matchedColor?.code}-${idx}`} className="p-3.5 rounded-[28px] bg-slate-900/50 border border-white/5 flex gap-4 items-center group relative shadow-2xl hover:bg-slate-900/90 hover:border-cyan-500/20 transition-all duration-500">
                    <button onClick={() => removeResult(idx)} className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 bg-red-500/90 text-white w-7 h-7 rounded-full flex items-center justify-center text-[10px] z-20 transition-all hover:scale-110 shadow-2xl font-black">✕</button>
                    
                    {/* 左側顏色預覽：移除陰影層並調整尺寸 */}
                    <div className="w-16 h-16 rounded-[18px] shadow-2xl flex items-center justify-center relative shrink-0 border-2 border-white/10" style={{ backgroundColor: item.hex }}>
                      <span className="text-[12px] text-white font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] z-10">{item.matchedColor?.code}</span>
                    </div>

                    {/* 右側資訊區塊：縮短高度至 h-16 */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between h-16 py-0.5">
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <h4 className="text-[14px] font-black text-white uppercase tracking-tight leading-tight line-clamp-1">
                            {item.matchedColor?.name}
                          </h4>
                          <span className="text-[8px] font-bold text-slate-500 uppercase mt-0.5 block tracking-widest whitespace-nowrap">
                            {item.matchedColor?.line}
                          </span>
                        </div>
                        {/* 移除 FIX/Percentage 標籤 */}
                      </div>
                      
                      {/* 下方控制項：移除 CANS 字樣 */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 bg-black/40 p-1 rounded-xl border border-white/5 shadow-inner">
                          <button onClick={() => adjustCans(idx, -1)} className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-cyan-500 hover:text-black text-white flex items-center justify-center text-md font-black transition-all active:scale-90 shadow-md">−</button>
                          <span className="text-md font-black w-6 text-center text-white">{item.cansRequired}</span>
                          <button onClick={() => adjustCans(idx, 1)} className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-cyan-500 hover:text-black text-white flex items-center justify-center text-md font-black transition-all active:scale-90 shadow-md">+</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="mt-20 text-center py-16 border-t border-white/5 opacity-40">
        <div className="flex flex-col items-center gap-5">
          <div className="w-14 h-14 rounded-[28px] bg-slate-900 flex items-center justify-center border border-white/5 mb-4 shadow-2xl">
            <svg className="w-7 h-7 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <p className="text-[11px] font-black uppercase tracking-[1.4em] text-slate-300">SprayMaster Pro v26.6</p>
          <p className="text-[9px] font-bold tracking-[0.5em] text-slate-600 uppercase">Neural Estimation Engine • Floating Archive OS</p>
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(34, 211, 238, 0.1); border-radius: 40px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(34, 211, 238, 0.4); }
        @keyframes fadeIn { from { opacity: 0; transform: scale(1.02) translateY(20px); filter: blur(10px); } to { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); } }
        .animate-in { animation: fadeIn 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
};

export default App;
