import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  ATTACK_OUTCOMES,
  ATTACK_ZONES,
  AttackEvent,
  AttackOutcome,
  AttackZone,
  formatOutcomeOptionLabel,
  formatSecondsToMMSS,
} from '../types/scouting';

interface QuickTagBarProps {
  currentSeconds: number;
  onAddManualAttack: (attack: Omit<AttackEvent, 'id'>) => void;
}

export function QuickTagBar({
  currentSeconds,
  onAddManualAttack,
}: QuickTagBarProps) {
  const [zone, setZone] = useState<AttackZone>('Buiten (Pos 4)');
  const [outcome, setOutcome] = useState<AttackOutcome>('Direct punt');
  const [uncertain, setUncertain] = useState(false);
  const [note, setNote] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAddManualAttack({
      timestampSeconds: currentSeconds,
      timestamp: formatSecondsToMMSS(currentSeconds),
      positionZone: zone,
      outcome,
      confidence: uncertain ? 'Onzeker' : 'Zeker',
      note:
        note.trim() ||
        (uncertain
          ? 'Balcontact door camerahoek of snelheid niet 100% zeker te zien'
          : ''),
      source: 'handmatig',
    });
    setNote('');
    setUncertain(false);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 no-print"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-slate-900">
            Handmatig aanval toevoegen op huidige videotijd
          </span>
          <span className="text-slate-300" aria-hidden="true">
            ·
          </span>
          <span className="font-mono tabular-nums font-semibold text-amber-700">
            {formatSecondsToMMSS(currentSeconds)}
          </span>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={uncertain}
            onChange={(e) => setUncertain(e.target.checked)}
            className="rounded border-slate-300 text-amber-600 focus:ring-amber-600"
          />
          <span>Balcontact niet 100% zeker (camerahoek/snelheid)</span>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
        <div className="md:col-span-3">
          <label className="sr-only" htmlFor="quick-zone">
            Positie of Zone
          </label>
          <select
            id="quick-zone"
            value={zone}
            onChange={(e) => setZone(e.target.value as AttackZone)}
            className="w-full px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-amber-600 focus:bg-white"
          >
            {ATTACK_ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-3">
          <label className="sr-only" htmlFor="quick-outcome">
            Uitkomst
          </label>
          <select
            id="quick-outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as AttackOutcome)}
            className="w-full px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-amber-600 focus:bg-white"
          >
            {ATTACK_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {formatOutcomeOptionLabel(o)}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-4">
          <label className="sr-only" htmlFor="quick-note">
            Toelichting
          </label>
          <input
            id="quick-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optionele notitie (bijv. touché blok, langs lijn, tipbal…)"
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-amber-600 focus:bg-white"
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Log aanval</span>
          </button>
        </div>
      </div>
    </form>
  );
}
