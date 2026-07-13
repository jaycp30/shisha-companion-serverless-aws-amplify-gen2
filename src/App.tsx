import { useState } from 'react';
import { client } from './lib/amplify';

// TEMPORARY smoke screen — replaced by the real UI in the next steps.
// Its only job: prove the typed Amplify client can reach the deployed chat Lambda
// from the browser.
function App() {
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(false);

  async function askCat(): Promise<void> {
    setLoading(true);
    setReply('');
    try {
      const messages = [{ role: 'user', text: 'hey! suggest one relaxing shisha vibe' }];
      const res = await client.queries.chat({ messagesJson: JSON.stringify(messages) });
      if (res.errors?.length) {
        setReply(`Error: ${res.errors.map((e) => e.message).join('; ')}`);
      } else {
        setReply(res.data ?? '(no reply)');
      }
    } catch (err) {
      setReply(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '4rem auto', padding: '0 1rem', fontFamily: 'system-ui' }}>
      <h1>Shisha Companion — backend smoke test</h1>
      <button type="button" onClick={askCat} disabled={loading}>
        {loading ? 'Thinking…' : 'Talk to the cat 🐾'}
      </button>
      {reply && <p style={{ marginTop: '1.5rem', lineHeight: 1.6 }}>{reply}</p>}
    </main>
  );
}

export default App;
