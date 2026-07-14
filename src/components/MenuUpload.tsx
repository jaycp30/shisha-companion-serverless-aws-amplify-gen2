import { useState, type ChangeEvent } from 'react';
import { analyzeMenuPhoto, MenuUploadError, type Stage } from '../lib/analyzeMenu';
import type { MenuResponse } from '../types/menu';

interface MenuUploadProps {
  onResult: (result: MenuResponse) => void;
  // Lets the parent react to progress — the mascot uses this to switch to 'thinking'.
  onStageChange?: (stage: Stage | null) => void;
}

// Friendly status text for each step of the flow.
const STAGE_LABEL: Record<Stage, string> = {
  presigning: 'Getting ready…',
  uploading: 'Uploading your menu…',
  analyzing: 'Reading the menu… 🐾',
};

export function MenuUpload({ onResult, onStageChange }: MenuUploadProps) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  const busy = stage !== null;

  // Keep local state and the parent notification in one place.
  function updateStage(next: Stage | null): void {
    setStage(next);
    onStageChange?.(next);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError('');

    try {
      const result = await analyzeMenuPhoto(file, { onStage: updateStage });
      // Clear the stage BEFORE handing the result up, so the parent's "done" reaction
      // (mascot -> happy) lands after the "busy" one (mascot -> idle) and wins.
      updateStage(null);
      onResult(result);
    } catch (err) {
      updateStage(null);
      // Deliberate errors carry a user-safe message. Anything else is almost always
      // a dropped connection — the AI lives in the cloud, so no network means no cat.
      setError(
        err instanceof MenuUploadError
          ? err.message
          : "Can't reach the cat's brain right now — check your connection and try again. 🐾",
      );
    } finally {
      // Let the same file be picked again after an error.
      event.target.value = '';
    }
  }

  return (
    <section className="rounded-2xl border border-petal bg-cream p-8">
      <h2 className="text-xl font-semibold">Upload a menu photo</h2>
      <p className="mt-2 text-espresso-soft">
        JPEG, PNG, or WebP — up to 10 MB. I&apos;ll pick out flavors, mixes, and drink pairings.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <label
          className={`cursor-pointer rounded-full bg-petal px-6 py-3 font-medium text-espresso transition hover:brightness-95 ${
            busy ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          {busy ? 'Working…' : 'Choose menu photo'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={handleFile}
            disabled={busy}
          />
        </label>

        {fileName && !busy && !error && (
          <span className="text-sm text-espresso-soft">{fileName}</span>
        )}
      </div>

      {stage && (
        <p className="mt-5 text-espresso-soft" role="status">
          {STAGE_LABEL[stage]}
        </p>
      )}

      {error && (
        <p className="mt-5 rounded-xl bg-petal-soft px-4 py-3 text-espresso" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
