import { useState, type ChangeEvent } from 'react';
import { analyzeMenuPages, MAX_PAGES, MenuUploadError, type Stage } from '../lib/analyzeMenu';
import type { MenuResponse } from '../types/menu';

interface MenuUploadProps {
  /** Called with the analysis AND every page key behind it (old + new). */
  onResult: (result: MenuResponse, s3Keys: string[]) => void;
  // Lets the parent react to progress — the mascot uses this to switch to 'thinking'.
  onStageChange?: (stage: Stage | null) => void;
  /** Pages already analyzed this session — new uploads append to these. */
  existingKeys: readonly string[];
  /** Clears the session's accumulated menu ("new lounge, new menu"). */
  onReset: () => void;
}

// Friendly status text for each step of the flow.
const STAGE_LABEL: Record<Stage, string> = {
  uploading: 'Uploading your menu…',
  analyzing: 'Reading the menu… 🐾',
};

export function MenuUpload({ onResult, onStageChange, existingKeys, onReset }: MenuUploadProps) {
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
      const outcome = await analyzeMenuPages(files, {
        onStage: updateStage,
        previousKeys: existingKeys,
      });
      // Clear the stage BEFORE handing the result up, so the parent's "done" reaction
      // (mascot -> happy) lands after the "busy" one (mascot -> idle) and wins.
      updateStage(null);
      onResult(outcome.response, outcome.s3Keys);
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
        {existingKeys.length > 0
          ? `I'm holding ${existingKeys.length} of ${MAX_PAGES} pages — new photos get added to the same menu.`
          : `JPEG, PNG, or WebP — up to 10 MB each. Menu runs over several pages? Pick them all (up to ${MAX_PAGES}) and I'll read them as one.`}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <label
          className={`cursor-pointer rounded-full bg-petal px-6 py-3 font-medium text-espresso transition hover:brightness-95 ${
            busy ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          {busy ? 'Working…' : existingKeys.length > 0 ? 'Add menu photos' : 'Choose menu photos'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={handleFile}
            disabled={busy}
          />
        </label>

        {existingKeys.length > 0 && !busy && (
          <button
            type="button"
            onClick={() => {
              setFileNames([]);
              setError('');
              onReset();
            }}
            className="rounded-full px-4 py-2 text-sm text-espresso-soft underline-offset-2 transition hover:bg-petal-soft hover:underline"
          >
            New menu
          </button>
        )}

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
