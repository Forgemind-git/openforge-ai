// Forge AI beside an open panel (Calendar, Chats, Tasks, Mail, Drafts): the
// blinking logo leaves the centre of the office, floats next to the panel and
// says in one line what the panel is for. Styles live in forge-guide.css.
import './forge-guide.css';

const LINES = {
  calendar: 'Your week at a glance. Ask me to add or move an event.',
  chats: 'WhatsApp and Telegram in one inbox. I can draft any reply.',
  tasks: 'Your Google Tasks board. Tell me what to add or tick off.',
  mail: 'Your Gmail inbox. Pick an email and I can help you reply.',
  drafts: 'Everything I have prepared. Nothing goes out until you press Send.',
};

export default function ForgeAiGuide({ view }) {
  const line = LINES[view];
  if (!line) return null;
  return (
    <div className="forge-guide" data-testid="forge-guide" aria-hidden="true">
      <div className="logo-float-anim forge-guide-logo"><img src="/forge-ai-blink.gif" alt="" /></div>
      <div className="forge-guide-bubble"><strong>Forge AI</strong>{line}</div>
    </div>
  );
}
