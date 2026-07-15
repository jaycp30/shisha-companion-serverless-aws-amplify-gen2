import { useState, type ChangeEvent } from 'react';
import { analyzeMenuPages, MAX_PAGES, MenuUploadError, type Stage } from '../lib/analyzeMenu';
import type { MenuResponse } from '../types/menu';

interface MenuUploadProps {
  onResult: (result: MenuResponse) => void;
  // Lets the parent react to progress — the mascot uses this to switch to 'thinking'.
  onStageChange?: (stage: Stage | null) => void;
}

// Friendly status text for each step of the flow.
const STAGE_LABEL: Record<Stage, string> = {
  uploading: 'Uploading your menu…',
  analyzing: 'Reading the menu… 🐾',
};

export function MenuUpload({ onResult, onStageChange }: MenuUploadProps) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState('');
  const [fileNames, setFileNames] = useState<string[]>([]);

  const busy = stage !== null;

  // Keep local state and the parent notification in one place.
  function updateStage(next: Stage | null): void {
    setStage(next);
    onStageChange?.(next);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    // The picker hands back a FileList; sort by name so page order survives an OS that
    // returns them in selection order rather than filename order.
    const files = Array.from(event.target.files ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    if (files.length === 0) return;

    setFileNames(files.map((file) => file.name));
    setError('');

    try {
      const result = await analyzeMenuPages(files, { onStage: updateStage });
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
      <h2 className="text-xl font-semibold">Upload your menu</h2>
      <p className="mt-2 text-espresso-soft">
        JPEG, PNG, or WebP — up to 10 MB each. Menu runs over several pages? Pick them all
        (up to {MAX_PAGES}) and I&apos;ll read them as one.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <label
          className={`cursor-pointer rounded-full bg-petal px-6 py-3 font-medium text-espresso transition hover:brightness-95 ${
            busy ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          {busy ? 'Working…' : 'Choose menu photos'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={handleFile}
            disabled={busy}
          />
        </label>

        {fileNames.length > 0 && !busy && !error && (
          <span className="text-sm text-espresso-soft">
            {fileNames.length === 1
              ? fileNames[0]
              : `${fileNames.length} pages: ${fileNames.join(', ')}`}
          </span>
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
