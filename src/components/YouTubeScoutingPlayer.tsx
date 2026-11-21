import { useEffect, useRef, useState } from 'react';
import {
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  ExternalLink,
} from 'lucide-react';
import {
  AttackEvent,
  formatOutcomeLabel,
  formatSecondsToMMSS,
} from '../types/scouting';

interface YTPlayerInstance {
  destroy: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  setPlaybackRate: (rate: number) => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        config: Record<string, unknown>
      ) => YTPlayerInstance;
      PlayerState?: {
        PLAYING: number;
        PAUSED: number;
        ENDED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface VideoPlayerHandle {
  seekAndPlay: (seconds: number) => void;
  getCurrentSeconds: () => number;
}

interface YouTubeScoutingPlayerProps {
  videoId: string | null;
  youtubeUrl: string;
  startSeconds: number;
  endSeconds: number;
  attacks: AttackEvent[];
  activeAttackId: string | null;
  onSelectAttack: (attack: AttackEvent) => void;
  onTimeUpdate: (seconds: number) => void;
  playerHandleRef: React.MutableRefObject<VideoPlayerHandle | null>;
}

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.5];

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve) => {
    const existing = document.getElementById('yt-iframe-api-script');
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevReady) prevReady();
      resolve();
    };
    if (!existing) {
      const script = document.createElement('script');
      script.id = 'yt-iframe-api-script';
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return ytApiPromise;
}

export function YouTubeScoutingPlayer({
  videoId,
  youtubeUrl,
  startSeconds,
  endSeconds,
  attacks,
  activeAttackId,
  onSelectAttack,
  onTimeUpdate,
  playerHandleRef,
}: YouTubeScoutingPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(startSeconds);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    setCurrentSeconds(startSeconds);
  }, [startSeconds]);

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    setIsReady(false);

    loadYouTubeIframeApi().then(() => {
      if (cancelled || !containerRef.current || !window.YT?.Player) return;

      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore cleanup error
        }
        playerRef.current = null;
      }

      const mountEl = document.createElement('div');
      mountEl.className = 'w-full h-full';
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(mountEl);

      playerRef.current = new window.YT.Player(mountEl, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          start: startSeconds,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            setIsReady(true);
            setCurrentSeconds(startSeconds);
            onTimeUpdate(startSeconds);
          },
          onStateChange: (event: { data: number }) => {
            if (cancelled) return;
            const playingState = window.YT?.PlayerState?.PLAYING ?? 1;
            setIsPlaying(event.data === playingState);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }
    };
  }, [videoId, startSeconds]);

  useEffect(() => {
    playerHandleRef.current = {
      seekAndPlay: (seconds: number) => {
        const clamped = Math.max(0, Math.round(seconds));
        setCurrentSeconds(clamped);
        onTimeUpdate(clamped);
        if (playerRef.current && isReady) {
          playerRef.current.seekTo(clamped, true);
          playerRef.current.playVideo();
        }
      },
      getCurrentSeconds: () => {
        if (playerRef.current && isReady) {
          try {
            const t = playerRef.current.getCurrentTime();
            if (Number.isFinite(t)) return Math.round(t);
          } catch {
            // fallback
          }
        }
        return currentSeconds;
      },
    };
  }, [isReady, currentSeconds, onTimeUpdate, playerHandleRef]);

  useEffect(() => {
    if (!isReady) return;
    const timer = window.setInterval(() => {
      if (!playerRef.current) return;
      try {
        const t = playerRef.current.getCurrentTime();
        if (Number.isFinite(t)) {
          const rounded = Math.floor(t);
          setCurrentSeconds(rounded);
          onTimeUpdate(rounded);
        }
      } catch {
        // ignore transient player state
      }
    }, 350);
    return () => window.clearInterval(timer);
  }, [isReady, onTimeUpdate]);

  const handleTogglePlay = () => {
    if (!playerRef.current || !isReady) return;
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  const handleNudge = (delta: number) => {
    if (!playerRef.current || !isReady) return;
    const base = playerRef.current.getCurrentTime() || currentSeconds;
    const target = Math.max(0, base + delta);
    playerRef.current.seekTo(target, true);
    setCurrentSeconds(Math.round(target));
    onTimeUpdate(Math.round(target));
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (playerRef.current && isReady) {
      playerRef.current.setPlaybackRate(rate);
    }
  };

  const handleJumpToStart = () => {
    if (!playerRef.current || !isReady) return;
    playerRef.current.seekTo(startSeconds, true);
    setCurrentSeconds(startSeconds);
    onTimeUpdate(startSeconds);
  };

  const rangeDuration = Math.max(1, endSeconds - startSeconds);
  const clampedProgress = Math.max(
    0,
    Math.min(100, ((currentSeconds - startSeconds) / rangeDuration) * 100)
  );

  const outcomeDotColor = (outcome: AttackEvent['outcome']) => {
    switch (outcome) {
      case 'Direct punt':
        return 'bg-emerald-600';
      case 'Fout':
        return 'bg-red-600';
      case 'Geblokt':
        return 'bg-amber-600';
      case 'Kill-blok mee':
        return 'bg-sky-600';
      default:
        return 'bg-slate-500';
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 truncate">
            Wedstrijdbeelden — Fragment {formatSecondsToMMSS(startSeconds)} tot{' '}
            {formatSecondsToMMSS(endSeconds)}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            Klik op een tijdstip in de tabel of op de tijdlijn om het exacte balcontact in slow-motion te controleren.
          </p>
        </div>
        <a
          href={`${youtubeUrl}${youtubeUrl.includes('?') ? '&' : '?'}t=${currentSeconds}s`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
        >
          <span>Open op YouTube</span>
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
      </div>

      <div className="relative w-full aspect-video bg-slate-950">
        {videoId ? (
          <div ref={containerRef} className="w-full h-full" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-slate-400 px-6 text-center">
            Vul een geldige YouTube-URL in om de wedstrijdbeelden te laden.
          </div>
        )}
      </div>

      {/* Controls & Fragment Timeline */}
      <div className="p-4 space-y-3.5 bg-slate-50/70 border-t border-slate-200">
        {/* Timeline scrubber within startSeconds..endSeconds */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-500">
            <span>{formatSecondsToMMSS(startSeconds)}</span>
            <span className="text-slate-900 font-semibold">
              Huidig: {formatSecondsToMMSS(currentSeconds)}
            </span>
            <span>{formatSecondsToMMSS(endSeconds)}</span>
          </div>

          <div
            className="relative h-7 bg-slate-200/80 rounded-md cursor-pointer select-none overflow-hidden"
            role="slider"
            aria-label="Tijdlijn binnen geanalyseerd fragment"
            aria-valuemin={startSeconds}
            aria-valuemax={endSeconds}
            aria-valuenow={Math.max(startSeconds, Math.min(endSeconds, currentSeconds))}
            tabIndex={0}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const target = Math.round(startSeconds + ratio * rangeDuration);
              if (playerRef.current && isReady) {
                playerRef.current.seekTo(target, true);
              }
              setCurrentSeconds(target);
              onTimeUpdate(target);
            }}
          >
            {/* Progress fill */}
            <div
              className="absolute inset-y-0 left-0 bg-amber-500/20 border-r-2 border-amber-600 pointer-events-none"
              style={{ width: `${clampedProgress}%` }}
            />

            {/* Attack markers */}
            {attacks.map((attack) => {
              const pct = ((attack.timestampSeconds - startSeconds) / rangeDuration) * 100;
              if (pct < 0 || pct > 100) return null;
              const isActive = attack.id === activeAttackId;
              return (
                <button
                  key={attack.id}
                  type="button"
                  title={`${attack.timestamp} · ${attack.positionZone} · ${formatOutcomeLabel(attack.outcome)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectAttack(attack);
                  }}
                  style={{ left: `${pct}%` }}
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-5 rounded-xs transition-transform cursor-pointer ${outcomeDotColor(
                    attack.outcome
                  )} ${
                    isActive
                      ? 'ring-2 ring-slate-900 scale-125 z-10'
                      : 'opacity-85 hover:opacity-100 hover:scale-110'
                  }`}
                />
              );
            })}
          </div>
        </div>

        {/* Transport + Speed row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleJumpToStart}
              title={`Terug naar start (${formatSecondsToMMSS(startSeconds)})`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="font-mono tabular-nums">{formatSecondsToMMSS(startSeconds)}</span>
            </button>

            <button
              type="button"
              onClick={() => handleNudge(-5)}
              className="px-2.5 py-1.5 text-xs font-mono tabular-nums font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              -5s
            </button>

            <button
              type="button"
              onClick={() => handleNudge(-2)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono tabular-nums font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <SkipBack className="w-3 h-3" aria-hidden="true" />
              <span>-2s</span>
            </button>

            <button
              type="button"
              onClick={handleTogglePlay}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Pauze</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                  <span>Afspelen</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleNudge(2)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono tabular-nums font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>+2s</span>
              <SkipForward className="w-3 h-3" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => handleNudge(5)}
              className="px-2.5 py-1.5 text-xs font-mono tabular-nums font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              +5s
            </button>
          </div>

          <div className="flex items-center gap-1 bg-slate-200/70 p-0.5 rounded-md">
            <span className="text-[11px] font-medium text-slate-500 px-2">Snelheid</span>
            {PLAYBACK_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => handleRateChange(rate)}
                className={`px-2 py-1 text-xs font-mono tabular-nums rounded-sm transition-colors cursor-pointer ${
                  playbackRate === rate
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
