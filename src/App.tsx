import { useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MenuUpload } from './components/MenuUpload';
import { Recommendations } from './components/Recommendations';
import { isNotAMenu, type MenuResponse } from './types/menu';

function App() {
  const [result, setResult] = useState<MenuResponse | null>(null);

  return (
    <div className="min-h-dvh bg-linen text-espresso">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10">
          <h1 className="text-5xl font-semibold tracking-tight">Shisha Companion</h1>
          <p className="mt-3 text-lg text-espresso-soft">
            Snap a menu, get flavor picks, and hang out with your session buddy.
          </p>
        </header>

        <ErrorBoundary>
          <MenuUpload onResult={setResult} />

          {result && (
            <div className="mt-12">
              {isNotAMenu(result) ? (
                <p className="rounded-2xl border border-petal bg-cream p-6 leading-relaxed">
                  Hmm, that doesn&apos;t look like a shisha menu to me. Try a photo of the
                  flavor list? 🐾
                </p>
              ) : (
                <Recommendations analysis={result} />
              )}
            </div>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}

export default App;
