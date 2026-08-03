import { Analyzer } from "@/components/Analyzer";

export default function Home() {
  return (
    <>
      <header className="shell site-header">
        <div className="brand">WhatsApp Chat Analyzer</div>
        <a className="nav-link" href="#analyze">
          Analyze chat
        </a>
      </header>

      <main className="shell main">
        <section className="hero">
          <div className="hero__visual" aria-hidden="true">
            <div className="bubble bubble--a">Who is free this weekend?</div>
            <div className="bubble bubble--b">Count me in 🎉</div>
            <div className="bubble bubble--c">Sharing the notes link…</div>
          </div>

          <div className="hero__content">
            <h1 className="hero__brand">WhatsApp Chat Analyzer</h1>
            <p className="hero__headline">
              Turn exported chats into clear timelines and conversation insights.
            </p>
            <p className="hero__support">
              Upload a WhatsApp `.txt` export and explore activity, words, and
              emoji patterns — all processed locally in your browser.
            </p>
            <div className="hero__actions">
              <a className="button button--primary" href="#analyze">
                Start analyzing
              </a>
              <a className="button button--ghost" href="#how">
                How to export
              </a>
            </div>
          </div>
        </section>

        <Analyzer />

        <section className="how" id="how">
          <h2>How to export a chat</h2>
          <ol>
            <li>Open WhatsApp and go to the chat you want to analyze.</li>
            <li>Tap the chat name → Export chat → Without media.</li>
            <li>Save the `.txt` file and upload it above.</li>
          </ol>
        </section>
      </main>

      <footer className="shell site-footer">
        <p>Private by default · Runs in your browser · Ready for Vercel in 2026</p>
      </footer>
    </>
  );
}
