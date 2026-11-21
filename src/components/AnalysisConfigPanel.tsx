import { useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  AnalysisChunk,
  AnalysisSpeedMode,
  MatchConfig,
  parseTimestampToSeconds,
} from '../types/scouting';

interface AnalysisConfigPanelProps {
  config: MatchConfig;
  chunks: AnalysisChunk[];
  isAnalyzing: boolean;
  globalError: string | null;
  onUpdateConfig: (next: MatchConfig) => void;
  onAnalyzeAll: () => void;
  onAnalyzeSingleChunk: (chunkIndex: number) => void;
  onJumpToTime: (seconds: number) => void;
}

export function AnalysisConfigPanel({
  config,
  chunks,
  isAnalyzing,
  globalError,
  onUpdateConfig,
  onAnalyzeAll,
  onAnalyzeSingleChunk,
  onJumpToTime,
}: AnalysisConfigPanelProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState(config.youtubeUrl);
  const [draftStart, setDraftStart] = useState(config.startTime);
  const [draftEnd, setDraftEnd] = useState(config.endTime);
  const [draftTeam, setDraftTeam] = useState(config.teamDescription);
  const [validationError, setValidationError] = useState<string | null>(null);

  const completedCount = chunks.filter((c) => c.status === 'done').length;
  const activeCount = chunks.filter((c) => c.status === 'analyzing').length;
  const parallelWorkers =
    config.speedMode === 'turbo' && config.fps === 1 ? 2 : 1;

  const handleSelectSpeedMode = (mode: AnalysisSpeedMode) => {
    if (mode === 'turbo') {
      onUpdateConfig({ ...config, speedMode: 'turbo', fps: 1, chunkDurationSeconds: 180 });
    } else if (mode === 'balanced') {
      onUpdateConfig({ ...config, speedMode: 'balanced', fps: 1, chunkDurationSeconds: 150 });
    } else {
      onUpdateConfig({ ...config, speedMode: 'precise', fps: 2, chunkDurationSeconds: 90 });
    }
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    const s = parseTimestampToSeconds(draftStart);
    const en = parseTimestampToSeconds(draftEnd);
    if (s === null || en === null || en <= s) {
      setValidationError('Gebruik geldige MM:SS tijdstippen waarbij het eindtijdstip later is dan het starttijdstip.');
      return;
    }
    setValidationError(null);
    onUpdateConfig({
      ...config,
      youtubeUrl: draftUrl.trim(),
      startTime: draftStart.trim(),
      endTime: draftEnd.trim(),
      teamDescription: draftTeam.trim(),
    });
    setSettingsOpen(false);
  };

  return (
    <aside className="bg-white border border-slate-200 rounded-xl flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            AI Video-analyse &amp; Deelfragmenten
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {completedCount} van {chunks.length} blokken geanalyseerd · {config.fps} FPS
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen((prev) => !prev)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Instellingen</span>
          {settingsOpen ? (
            <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Collapsible Config Form */}
      {settingsOpen && (
        <form
          onSubmit={handleSaveSettings}
          className="p-5 bg-slate-50 border-b border-slate-200 space-y-3"
        >
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              YouTube-wedstrijdlink
            </label>
            <input
              type="url"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-amber-600"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Start (MM:SS)
              </label>
              <input
                type="text"
                value={draftStart}
                onChange={(e) => setDraftStart(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-amber-600"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Einde (MM:SS)
              </label>
              <input
                type="text"
                value={draftEnd}
                onChange={(e) => setDraftEnd(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-amber-600"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Doelteam &amp; tenue-omschrijving
            </label>
            <textarea
              rows={2}
              value={draftTeam}
              onChange={(e) => setDraftTeam(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-amber-600"
              required
            />
          </div>
          {validationError && (
            <p className="text-xs text-red-700">{validationError}</p>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Annuleren
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer"
            >
              Toepassen
            </button>
          </div>
        </form>
      )}

      {/* Focus summary & Speed / FPS selectors */}
      <div className="px-5 py-3.5 border-b border-slate-200 space-y-3">
        <div className="text-xs text-slate-600 leading-relaxed">
          <span className="font-semibold text-slate-900">Focus: </span>
          {config.teamDescription}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-slate-700">Snelheid</span>
          <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
            {(
              [
                { id: 'turbo', label: 'Turbo' },
                { id: 'balanced', label: 'Snel' },
                { id: 'precise', label: 'Detail' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={isAnalyzing}
                onClick={() => handleSelectSpeedMode(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap ${
                  config.speedMode === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-slate-700">Beelddichtheid</span>
          <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
            {([1, 2, 3] as const).map((rate) => (
              <button
                key={rate}
                type="button"
                disabled={isAnalyzing}
                onClick={() => onUpdateConfig({ ...config, fps: rate })}
                className={`px-2.5 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap ${
                  config.fps === rate
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {rate} FPS
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-slate-700">Debug-modus (coördinaten)</span>
          <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
            {(
              [
                { val: false, label: 'Uit' },
                { val: true, label: 'Aan' },
              ] as const
            ).map((opt) => (
              <button
                key={String(opt.val)}
                type="button"
                onClick={() => onUpdateConfig({ ...config, debugMode: opt.val })}
                className={`px-2.5 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer whitespace-nowrap ${
                  config.debugMode === opt.val
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Global error banner if API call fails */}
      {globalError && (
        <div
          role="alert"
          className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5 text-xs text-red-800"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" aria-hidden="true" />
          <p className="leading-relaxed">{globalError}</p>
        </div>
      )}

      {/* Chunk list */}
      <div className="divide-y divide-slate-100 flex-1 overflow-y-auto max-h-[380px]">
        {chunks.map((chunk) => (
          <div
            key={chunk.index}
            className="px-5 py-3 flex items-start justify-between gap-3 hover:bg-slate-50/80 transition-colors"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => onJumpToTime(chunk.startSeconds)}
                  className="font-mono tabular-nums font-semibold text-slate-900 hover:text-amber-700 underline-offset-2 hover:underline cursor-pointer"
                >
                  {chunk.label}
                </button>
                <span className="text-slate-300" aria-hidden="true">
                  ·
                </span>
                {chunk.status === 'analyzing' && (
                  <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                    <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                    Bezig met analyseren…
                  </span>
                )}
                {chunk.status === 'done' && (
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium tabular-nums">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    {chunk.attackCount} {chunk.attackCount === 1 ? 'aanval' : 'aanvallen'}
                  </span>
                )}
                {chunk.status === 'error' && (
                  <span className="text-red-700 font-medium">Mislukt</span>
                )}
                {chunk.status === 'idle' && (
                  <span className="text-slate-400">Nog niet gescand</span>
                )}
              </div>

              {chunk.cameraNote && (
                <p className="text-[11px] text-slate-500 leading-snug">
                  {chunk.cameraNote}
                </p>
              )}
              {chunk.errorMessage && (
                <p className="text-[11px] text-red-700 leading-snug">
                  {chunk.errorMessage}
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={isAnalyzing}
              onClick={() => onAnalyzeSingleChunk(chunk.index)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 rounded-md transition-colors disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {chunk.status === 'done' ? (
                <>
                  <RefreshCw className="w-3 h-3" aria-hidden="true" />
                  <span>Opnieuw</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-current" aria-hidden="true" />
                  <span>Scan</span>
                </>
              )}
            </button>
          </div>
        ))}
      </div>

      {/* Footer primary scan CTA inside panel */}
      <div className="p-4 border-t border-slate-200 bg-slate-50/70">
        <button
          type="button"
          disabled={isAnalyzing}
          onClick={onAnalyzeAll}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 rounded-lg transition-colors cursor-pointer"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span className="tabular-nums">
                {activeCount > 1
                  ? `${activeCount} blokken tegelijk aan het scannen…`
                  : 'Fragment wordt geanalyseerd…'}
              </span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
              <span>
                {chunks.some((c) => c.status === 'error')
                  ? 'Herprobeer mislukte & open blokken'
                  : completedCount > 0 && completedCount < chunks.length
                  ? `Scan resterende ${chunks.length - completedCount} blokken`
                  : completedCount === chunks.length && chunks.length > 0
                  ? 'Alle blokken opnieuw scannen'
                  : `Analyseer volledig fragment (${config.startTime} – ${config.endTime})`}
              </span>
            </>
          )}
        </button>
        <p className="text-[11px] text-slate-500 mt-2 leading-relaxed tabular-nums">
          {chunks.length} blokken van ~{Math.round((config.chunkDurationSeconds / 60) * 10) / 10} min (+8s uitloop voor blok/juichen/opslag; {parallelWorkers === 2 ? '2 parallelle' : '1 rustige'} scan-stroom met quotum-bescherming).
        </p>
      </div>
    </aside>
  );
}
