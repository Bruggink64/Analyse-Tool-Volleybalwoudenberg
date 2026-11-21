import { Loader2, Play, Square } from 'lucide-react';

interface TopBarProps {
  isAnalyzing: boolean;
  onStartFullAnalysis: () => void;
  onStopAnalysis: () => void;
}

export function TopBar({
  isAnalyzing,
  onStartFullAnalysis,
  onStopAnalysis,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        <a
          href="#top"
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-[var(--font-display)]"
        >
          VolleyScout
        </a>

        <nav
          aria-label="Hoofdnavigatie"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
        >
          <a
            href="#video-analyse"
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:border-amber-500"
          >
            Video &amp; Analyse
          </a>
          <a
            href="#aanvalstabel"
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:border-amber-500"
          >
            Aanvalstabel
          </a>
          <a
            href="#samenvatting"
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:border-amber-500"
          >
            Samenvatting
          </a>
          <a
            href="#zone-overzicht"
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:border-amber-500"
          >
            Zone-overzicht
          </a>
        </nav>

        <div className="flex items-center shrink-0">
          {isAnalyzing ? (
            <button
              type="button"
              onClick={onStopAnalysis}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-700 hover:bg-red-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
            >
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <Square className="w-3 h-3 fill-current" aria-hidden="true" />
              <span>Stop analyse</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartFullAnalysis}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
            >
              <Play className="w-3.5 h-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
              <span>Start AI-analyse</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
