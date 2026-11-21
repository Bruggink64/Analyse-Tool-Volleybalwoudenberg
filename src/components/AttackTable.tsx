import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  X,
  XCircle,
  ArrowRightCircle,
} from 'lucide-react';
import {
  ATTACK_OUTCOMES,
  ATTACK_ZONES,
  AttackEvent,
  AttackOutcome,
  AttackZone,
  ConfidenceLevel,
  formatSecondsToMMSS,
  parseTimestampToSeconds,
} from '../types/scouting';

interface AttackTableProps {
  attacks: AttackEvent[];
  activeAttackId: string | null;
  isAnalyzing: boolean;
  verifyingId: string | null;
  onJumpToAttack: (attack: AttackEvent) => void;
  onUpdateAttack: (id: string, patch: Partial<AttackEvent>) => void;
  onDeleteAttack: (id: string) => void;
  onVerifyAttack: (attack: AttackEvent) => void;
  onClearAll: () => void;
  onCopyMarkdown: () => void;
  onDownloadCsv: () => void;
  onStartFullAnalysis: () => void;
  copiedFeedback: boolean;
}

function OutcomeDisplay({ outcome }: { outcome: AttackOutcome }) {
  switch (outcome) {
    case 'Direct punt':
      return (
        <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Direct punt</span>
        </span>
      );
    case 'Fout':
      return (
        <span className="inline-flex items-center gap-1.5 text-red-700 font-semibold whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Fout</span>
        </span>
      );
    case 'Geblokt':
      return (
        <span className="inline-flex items-center gap-1.5 text-amber-700 font-semibold whitespace-nowrap">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Geblokt</span>
        </span>
      );
    case 'Verdedigd/doorgespeeld':
      return (
        <span className="inline-flex items-center gap-1.5 text-slate-600 font-medium whitespace-nowrap">
          <ArrowRightCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Verdedigd/doorgespeeld</span>
        </span>
      );
  }
}

export function AttackTable({
  attacks,
  activeAttackId,
  isAnalyzing,
  verifyingId,
  onJumpToAttack,
  onUpdateAttack,
  onDeleteAttack,
  onVerifyAttack,
  onClearAll,
  onCopyMarkdown,
  onDownloadCsv,
  onStartFullAnalysis,
  copiedFeedback,
}: AttackTableProps) {
  const [outcomeFilter, setOutcomeFilter] = useState<'Alle' | AttackOutcome>('Alle');
  const [zoneFilter, setZoneFilter] = useState<'Alle' | AttackZone>('Alle');
  const [onlyUncertain, setOnlyUncertain] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Edit draft state
  const [editTime, setEditTime] = useState('');
  const [editZone, setEditZone] = useState<AttackZone>('Buiten (Pos 4)');
  const [editOutcome, setEditOutcome] = useState<AttackOutcome>('Direct punt');
  const [editConfidence, setEditConfidence] = useState<ConfidenceLevel>('Zeker');
  const [editNote, setEditNote] = useState('');

  const sortedAttacks = useMemo(
    () => [...attacks].sort((a, b) => a.timestampSeconds - b.timestampSeconds),
    [attacks]
  );

  const filteredAttacks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedAttacks.filter((a) => {
      if (outcomeFilter !== 'Alle' && a.outcome !== outcomeFilter) return false;
      if (zoneFilter !== 'Alle' && a.positionZone !== zoneFilter) return false;
      if (onlyUncertain && a.confidence !== 'Onzeker') return false;
      if (q) {
        const hay = `${a.timestamp} ${a.positionZone} ${a.outcome} ${a.note}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sortedAttacks, outcomeFilter, zoneFilter, onlyUncertain, searchQuery]);

  const startEdit = (attack: AttackEvent) => {
    setEditingId(attack.id);
    setEditTime(attack.timestamp);
    setEditZone(attack.positionZone);
    setEditOutcome(attack.outcome);
    setEditConfidence(attack.confidence);
    setEditNote(attack.note);
  };

  const commitEdit = (id: string) => {
    const parsedSec = parseTimestampToSeconds(editTime);
    onUpdateAttack(id, {
      ...(parsedSec !== null
        ? { timestampSeconds: parsedSec, timestamp: formatSecondsToMMSS(parsedSec) }
        : {}),
      positionZone: editZone,
      outcome: editOutcome,
      confidence: editConfidence,
      note: editNote.trim(),
      source: 'geverifieerd',
    });
    setEditingId(null);
  };

  const uncertainTotal = attacks.filter((a) => a.confidence === 'Onzeker').length;

  return (
    <section id="aanvalstabel" className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header & Export Actions */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            1. Aanvalstabel — Team met rug naar camera (zwart/geel)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {filteredAttacks.length} van {attacks.length} aanvallen zichtbaar
            {uncertainTotal > 0 ? ` · ${uncertainTotal} met onzeker balcontact` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            type="button"
            onClick={onCopyMarkdown}
            disabled={attacks.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 rounded-md transition-colors disabled:opacity-45 whitespace-nowrap cursor-pointer"
          >
            {copiedFeedback ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                <span>Markdown gekopieerd</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Kopieer Markdown</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onDownloadCsv}
            disabled={attacks.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 rounded-md transition-colors disabled:opacity-45 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Exporteer CSV</span>
          </button>

          {attacks.length > 0 &&
            (confirmClear ? (
              <div className="inline-flex items-center gap-1.5 pl-2 border-l border-slate-200">
                <span className="text-xs text-red-700 font-medium">Alles wissen?</span>
                <button
                  type="button"
                  onClick={() => {
                    onClearAll();
                    setConfirmClear(false);
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md cursor-pointer"
                >
                  Ja, wis
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Annuleer
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-red-700 bg-white border border-slate-200 hover:border-red-200 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Wis lijst</span>
              </button>
            ))}
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex flex-wrap items-center gap-1 p-0.5 bg-slate-200/70 rounded-lg">
          {(['Alle', ...ATTACK_OUTCOMES] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setOutcomeFilter(option)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                outcomeFilter === option
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Filter op Positie of Zone"
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value as 'Alle' | AttackZone)}
            className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:border-amber-600"
          >
            <option value="Alle">Alle zones</option>
            {ATTACK_ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setOnlyUncertain((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
              onlyUncertain
                ? 'bg-amber-50 border-amber-400 text-amber-900'
                : 'bg-white border-slate-200 text-slate-700 hover:text-slate-900'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
            <span>Alleen onzeker ({uncertainTotal})</span>
          </button>

          <div className="relative">
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Zoek tijdstip of notitie…"
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-amber-600 w-48"
            />
          </div>
        </div>
      </div>

      {/* Table Content / States */}
      {attacks.length === 0 && isAnalyzing ? (
        <div className="p-5 space-y-2.5" aria-busy="true">
          <div className="flex items-center gap-2 text-xs text-amber-800 font-medium pb-2">
            <Loader2 className="w-4 h-4 animate-spin text-amber-600" aria-hidden="true" />
            <span>Eerste wedstrijdfragment wordt door Gemini geanalyseerd… Resultaten verschijnen direct per blok.</span>
          </div>
          {[0, 1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="h-10 bg-slate-100 rounded-md animate-pulse"
            />
          ))}
        </div>
      ) : attacks.length === 0 ? (
        <div className="px-6 py-12 text-center max-w-lg mx-auto space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Nog geen aanvallen geregistreerd voor 31:44 – 53:00
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Start de geautomatiseerde AI-videoanalyse om alle aanvallen van het zwart/gele team (met de rug naar de camera) per tijdsblok uit de YouTube-video te scannen, of log aanvallen handmatig tijdens het bekijken.
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={onStartFullAnalysis}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
              <span>Start AI-analyse (31:44 – 53:00)</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50 text-slate-500 font-semibold">
                <th className="py-2.5 px-4 w-12 text-right">#</th>
                <th className="py-2.5 px-4 w-28">Tijdstip</th>
                <th className="py-2.5 px-4 w-44">Positie/Zone</th>
                <th className="py-2.5 px-4 w-48">Uitkomst</th>
                <th className="py-2.5 px-4">Zekerheid &amp; toelichting</th>
                <th className="py-2.5 px-4 w-44 text-right no-print">Acties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAttacks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 px-4 text-center text-slate-500">
                    Geen aanvallen gevonden voor de gekozen filters.
                  </td>
                </tr>
              ) : (
                filteredAttacks.map((attack, idx) => {
                  const isEditing = editingId === attack.id;
                  const isActive = activeAttackId === attack.id;
                  const isVerifying = verifyingId === attack.id;

                  return (
                    <tr
                      key={attack.id}
                      className={`transition-colors ${
                        isActive
                          ? 'bg-amber-50/70'
                          : attack.confidence === 'Onzeker'
                          ? 'bg-amber-50/25 hover:bg-amber-50/50'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-400">
                        {idx + 1}
                      </td>

                      <td className="py-2.5 px-4">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editTime}
                            onChange={(e) => setEditTime(e.target.value)}
                            className="w-20 px-2 py-1 font-mono tabular-nums text-xs bg-white border border-slate-300 rounded"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => onJumpToAttack(attack)}
                            title="Spring in video naar 3 seconden voor dit balcontact"
                            className="inline-flex items-center gap-1.5 font-mono tabular-nums font-semibold text-slate-900 hover:text-amber-700 cursor-pointer"
                          >
                            <Play className="w-3 h-3 text-amber-600 fill-amber-500" aria-hidden="true" />
                            <span>{attack.timestamp}</span>
                          </button>
                        )}
                      </td>

                      <td className="py-2.5 px-4 font-medium text-slate-800">
                        {isEditing ? (
                          <select
                            value={editZone}
                            onChange={(e) => setEditZone(e.target.value as AttackZone)}
                            className="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded"
                          >
                            {ATTACK_ZONES.map((z) => (
                              <option key={z} value={z}>
                                {z}
                              </option>
                            ))}
                          </select>
                        ) : (
                          attack.positionZone
                        )}
                      </td>

                      <td className="py-2.5 px-4">
                        {isEditing ? (
                          <select
                            value={editOutcome}
                            onChange={(e) => setEditOutcome(e.target.value as AttackOutcome)}
                            className="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded"
                          >
                            {ATTACK_OUTCOMES.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <OutcomeDisplay outcome={attack.outcome} />
                        )}
                      </td>

                      <td className="py-2.5 px-4 text-slate-600">
                        {isEditing ? (
                          <div className="flex flex-col sm:flex-row gap-2">
                            <select
                              value={editConfidence}
                              onChange={(e) =>
                                setEditConfidence(e.target.value as ConfidenceLevel)
                              }
                              className="px-2 py-1 text-xs bg-white border border-slate-300 rounded shrink-0"
                            >
                              <option value="Zeker">Zeker</option>
                              <option value="Onzeker">Niet 100% zeker</option>
                            </select>
                            <input
                              type="text"
                              value={editNote}
                              onChange={(e) => setEditNote(e.target.value)}
                              placeholder="Toelichting…"
                              className="flex-1 px-2 py-1 text-xs bg-white border border-slate-300 rounded"
                            />
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-snug">
                            {attack.confidence === 'Onzeker' && (
                              <span className="inline-flex items-center gap-1 text-amber-800 font-semibold whitespace-nowrap">
                                <AlertTriangle className="w-3 h-3 text-amber-600" aria-hidden="true" />
                                Niet 100% zeker
                              </span>
                            )}
                            {attack.confidence === 'Onzeker' && attack.note && (
                              <span className="text-slate-300" aria-hidden="true">
                                ·
                              </span>
                            )}
                            <span className="text-slate-600">
                              {attack.note ||
                                (attack.confidence === 'Onzeker'
                                  ? 'Balcontact moeilijk te zien door camerahoek of snelheid'
                                  : 'Helder zichtbaar')}
                            </span>
                            {attack.source === 'geverifieerd' && (
                              <>
                                <span className="text-slate-300" aria-hidden="true">
                                  ·
                                </span>
                                <span className="text-[11px] text-slate-400">Geverifieerd</span>
                              </>
                            )}
                            {attack.source === 'handmatig' && (
                              <>
                                <span className="text-slate-300" aria-hidden="true">
                                  ·
                                </span>
                                <span className="text-[11px] text-slate-400">Handmatig</span>
                              </>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-4 text-right no-print">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => commitEdit(attack.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded cursor-pointer"
                            >
                              <Check className="w-3 h-3" aria-hidden="true" />
                              <span>Opslaan</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
                              aria-label="Annuleer bewerken"
                            >
                              <X className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isVerifying || isAnalyzing}
                              onClick={() => onVerifyAttack(attack)}
                              title="Controleer dit 16-secondenfragment opnieuw met 4 FPS"
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors disabled:opacity-45 whitespace-nowrap cursor-pointer"
                            >
                              {isVerifying ? (
                                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                              ) : (
                                <RefreshCw className="w-3 h-3" aria-hidden="true" />
                              )}
                              <span>4 FPS check</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => startEdit(attack)}
                              aria-label={`Bewerk aanval op ${attack.timestamp}`}
                              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteAttack(attack.id)}
                              aria-label={`Verwijder aanval op ${attack.timestamp}`}
                              className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
